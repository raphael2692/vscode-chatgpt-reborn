import React, { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import "react-tooltip/dist/react-tooltip.css";
import { v4 as uuidv4 } from "uuid";
import "../../styles/main.css";
import { setChatGPTModels, setExtensionSettings } from "./actions/app";
import {
  addMessage,
  setCurrentConversation,
  setInProgress,
  updateMessageContent,
} from "./actions/conversation";
import Tabs from "./components/Tabs";
import { useAppDispatch, useAppSelector } from "./hooks";
import { Conversation, Message, Model, Role } from "./types";
import { unEscapeHTML } from "./utils";
import Chat from "./views/chat";

export default function Layout({ vscode }: { vscode: any }) {
  const dispatch = useAppDispatch();
  const currentConversationId = useAppSelector(
    (state: any) => state.conversation.currentConversationId
  );
  const conversationList = Object.values(
    useAppSelector((state: any) => state.conversation.conversations)
  ) as Conversation[];
  const debug = useAppSelector((state: any) => state.app.debug);

  useEffect(() => {
    // ask for the extension settings
    vscode.postMessage({
      type: "getSettings",
    });
    // Ask for ChatGPT models
    vscode.postMessage({
      type: "getChatGPTModels",
    });
  }, []);

  // Handle messages sent from the extension to the webview
  const handleMessages = (event: any) => {
    const data = event.data as {
      type: string;
      value?: any;
      id?: string;
      // In the case of the addResponse event
      done?: boolean;
      // In the case of the showInProgress event
      inProgress?: boolean;
      conversationId?: string;
      responseInMarkdown?: boolean;
    };

    if (debug) {
      console.log("Renderer - Received message from main process: ", data);
    }

    switch (data.type) {
      case "showInProgress":
        if (debug) {
          console.log("in progress: ", data.inProgress);
        }

        dispatch(
          setInProgress({
            conversationId: data?.conversationId ?? currentConversationId,
            inProgress: data?.inProgress ?? true,
          })
        );
        break;
      case "addQuestion":
        const question = {
          id: uuidv4(),
          role: Role.user,
          content: data.value,
          createdAt: Date.now(),
          done: true,
        } as Message;

        dispatch(
          addMessage({
            conversationId: data?.conversationId ?? currentConversationId,
            message: question,
          })
        );

        break;
      case "addResponse":
        if (data.value === "") {
          return;
        }

        if (debug) {
          console.log("Renderer - Adding response: ", data);
        }

        let existingMessage =
          data.id &&
          conversationList
            .find((conversation) => conversation.id === currentConversationId)
            ?.messages.find((message) => message.id === data.id);

        const markedResponse = (window as any)?.marked.parse(
          !data.responseInMarkdown
            ? "```\r\n" + unEscapeHTML(data.value) + " \r\n ```"
            : (data?.value ?? "").split("```").length % 2 === 1
            ? data.value
            : data.value + "\n\n```\n\n"
        );

        if (existingMessage) {
          if (data.id) {
            dispatch(
              updateMessageContent({
                conversationId: data?.conversationId ?? currentConversationId,
                messageId: data.id,
                content: markedResponse,
                rawContent: data.value,
                done: data.done === undefined ? true : data.done,
              })
            );
          } else {
            console.error(
              "Renderer - Cannot updated message - No message id found"
            );
          }
        } else {
          const botResponse = {
            id: data.id,
            role: Role.assistant,
            content: markedResponse,
            rawContent: data.value,
            createdAt: Date.now(),
            // Check if message.done exists, only streaming if .done exists and is false
            done: data.done === undefined ? true : data.done,
          } as Message;

          if (debug) {
            console.log(
              "dispatching addMessage with botResponse: ",
              botResponse,
              "\nconversationId: ",
              data?.conversationId
            );
          }

          dispatch(
            addMessage({
              conversationId: data?.conversationId ?? currentConversationId,
              message: botResponse,
            })
          );
        }
        break;
      case "addError":
        const messageValue =
          data.value ||
          "An error occurred. If this issue persists please clear your session token with `ChatGPT: Reset session` command and/or restart your Visual Studio Code. If you still experience issues, it may be due to an OpenAI outage. Take a look at https://status.openai.com to see if there's an OpenAI outage.";

        const errorMessage = {
          id: data.id,
          role: Role.assistant,
          content: messageValue,
          createdAt: Date.now(),
          isError: true,
        } as Message;

        dispatch(
          addMessage({
            conversationId: data?.conversationId ?? currentConversationId,
            message: errorMessage,
          })
        );
        break;
      case "settingsUpdate":
        if (debug) {
          console.log("Renderer - Settings update: ", data.value);
        }

        dispatch(setExtensionSettings({ newSettings: data.value }));

        // Ask for ChatGPT models (api key may have changed)
        vscode.postMessage({
          type: "getChatGPTModels",
        });
        break;
      case "chatGPTModels":
        if (debug) {
          console.log("Renderer - ChatGPT models: ", data.value);
        }

        //  convert model object array from OpenAI to array of Model objects
        if (data?.value?.map) {
          dispatch(
            setChatGPTModels({
              models: data?.value as Model[],
            })
          );
        } else {
          console.error(
            "Renderer - Could not get ChatGPT models, data.value is not an array"
          );
        }
        break;
      default:
        console.log('Renderer - Uncaught message type: "' + data.type + '"');
    }
  };

  const location = useLocation();
  React.useEffect(() => {
    if (location.pathname.startsWith("/chat/") && conversationList?.find) {
      dispatch(
        setCurrentConversation({
          conversationId:
            conversationList?.find(
              (conversation: Conversation) =>
                location.pathname === `/chat/${encodeURI(conversation.id)}`
            )?.id ?? conversationList[0]?.id,
        })
      );
    }
  }, [location.pathname]);

  // Only add the event listener once
  useEffect(() => {
    // Remove in case it's already added, re-adding the event listener will cause the handler to be called twice
    window.removeEventListener("message", handleMessages);

    console.log("Renderer - Adding message event listener");
    window.addEventListener("message", handleMessages);

    return () => {
      // unmount cleanup function
      window.removeEventListener("message", handleMessages);
    };
  }, [conversationList, currentConversationId]); // These are important or the handler uses outdated state data

  return (
    <>
      <Tabs
        conversationList={conversationList}
        currentConversationId={currentConversationId}
      />
      <Routes>
        {/* <Route path="/prompts" element={<Prompts vscode={vscode} />} /> */}
        {/* <Route path="/actions" element={<Actions vscode={vscode} />} /> */}
        {conversationList &&
          conversationList.map &&
          conversationList.map((conversation: Conversation) => (
            <Route
              key={conversation.id}
              path={`/chat/${conversation.id}`}
              index={conversation.id === currentConversationId}
              element={
                <Chat
                  conversation={conversation}
                  vscode={vscode}
                  conversationList={conversationList}
                />
              }
            />
          ))}
        <Route
          path="/"
          element={
            <Navigate
              to={`/chat/${conversationList[0]?.id ?? "chat"}`}
              replace={true}
            />
          }
        />
        {/* <Route path="/options" element={<Options vscode={vscode} />} /> */}
      </Routes>
    </>
  );
}
