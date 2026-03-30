import { useTranslation } from "react-i18next";
import { toMediaUrl } from "@/lib/mediaUrl";
import type { ConversationMessage } from "@shared/schema";
import { emotionEmojis } from "@/hooks/chat/useEmotionState";

interface MessageListProps {
  messages: ConversationMessage[];
  pendingAiMessage: boolean;
  pendingUserMessage: boolean;
  pendingUserText: string;
  isLoading: boolean;
  personaName: string;
  personaImage?: string;
  currentEmotion: string;
  isAdmin?: boolean;
  getCharacterImage: (emotion: string) => string | null;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

export function MessageList({
  messages,
  pendingAiMessage,
  pendingUserMessage,
  pendingUserText,
  isLoading,
  personaName,
  personaImage,
  currentEmotion,
  isAdmin,
  getCharacterImage,
  messagesEndRef,
}: MessageListProps) {
  const { t } = useTranslation();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-6 space-y-5 bg-gradient-to-b from-slate-50 to-white scroll-smooth" data-testid="chat-messages">
      {messages.map((message: ConversationMessage, index: number) => (
        <div
          key={index}
          className={`flex items-end space-x-3 ${
            message.sender === "user" ? "justify-end" : ""
          }`}
        >
          {message.sender === "ai" && (
            <div className="relative flex-shrink-0 self-stretch flex items-end">
              <div className="w-10 sm:w-16 h-full min-h-[3rem] sm:min-h-[4rem] rounded-xl ring-2 ring-white shadow-lg overflow-hidden bg-slate-100">
                <img
                  src={getCharacterImage(message.emotion || '중립') || toMediaUrl(personaImage || '')}
                  alt={personaName}
                  className="w-full h-full object-cover object-top"
                />
              </div>
              {isAdmin && message.emotion && (
                <div
                  className="absolute -bottom-1 -right-1 text-xs bg-white rounded-lg w-6 h-6 flex items-center justify-center shadow-sm border-2 border-white"
                  title={message.emotionReason || message.emotion}
                >
                  {emotionEmojis[message.emotion] || '😐'}
                </div>
              )}
            </div>
          )}

          <div className={`flex flex-col ${message.sender === "user" ? "items-end" : "items-start"} max-w-[85%] sm:max-w-[70%]`}>
            {message.sender === "ai" && (
              <span className="text-xs text-slate-500 mb-1 ml-1 font-medium">{personaName}</span>
            )}
            <div className={`rounded-2xl px-4 py-3 shadow-sm ${
              message.sender === "user"
                ? "bg-gradient-to-br from-corporate-600 to-corporate-700 text-white rounded-br-md"
                : `bg-white border border-slate-100 rounded-bl-md shadow-md ${
                    message.emotion === '분노' ? 'border-l-4 border-l-red-400' :
                    message.emotion === '슬픔' ? 'border-l-4 border-l-blue-400' :
                    message.emotion === '기쁨' ? 'border-l-4 border-l-green-400' :
                    message.emotion === '놀람' ? 'border-l-4 border-l-yellow-400' :
                    message.emotion === '호기심' ? 'border-l-4 border-l-purple-400' :
                    message.emotion === '불안' ? 'border-l-4 border-l-orange-400' :
                    message.emotion === '단호' ? 'border-l-4 border-l-slate-400' :
                    message.emotion === '실망' ? 'border-l-4 border-l-indigo-400' :
                    message.emotion === '당혹' ? 'border-l-4 border-l-pink-400' :
                    message.emotion === '중립' ? 'border-l-4 border-l-gray-300' : ''
                  }`
            }`}>
              <p className={`leading-relaxed ${message.sender === "user" ? "text-white" : "text-slate-700"}`}>
                {message.message}
              </p>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 mx-1">
              {new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {message.sender === "user" && (
            <div className="w-10 h-10 bg-gradient-to-br from-corporate-500 to-corporate-700 rounded-full flex items-center justify-center text-white text-sm font-semibold shadow-md ring-2 ring-white flex-shrink-0">
              나
            </div>
          )}
        </div>
      ))}

      {isLoading && (
        <div className="flex items-start space-x-3">
          <div className="w-14 h-14 rounded-xl ring-2 ring-white shadow-lg overflow-hidden bg-slate-100 flex-shrink-0">
            <img src={getCharacterImage('중립') || toMediaUrl(personaImage || '')} alt={personaName} className="w-full h-full object-cover object-top scale-110" />
          </div>
          <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-md border border-slate-100 mt-1">
            <div className="flex space-x-1.5">
              <div className="w-2.5 h-2.5 bg-slate-300 rounded-full animate-bounce"></div>
              <div className="w-2.5 h-2.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "0.15s" }}></div>
              <div className="w-2.5 h-2.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "0.3s" }}></div>
            </div>
          </div>
        </div>
      )}

      {pendingAiMessage && (
        <div className="flex items-end space-x-3 animate-in fade-in duration-300">
          <div className="w-10 h-10 rounded-xl ring-2 ring-white shadow-lg overflow-hidden bg-slate-100 flex-shrink-0">
            <img src={getCharacterImage(currentEmotion) || toMediaUrl(personaImage || '')} alt={personaName} className="w-full h-full object-cover object-top scale-110" />
          </div>
          <div className="flex flex-col max-w-[75%]">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl rounded-bl-md px-4 py-3 shadow-md border border-blue-100 mt-1">
              <div className="flex items-center space-x-2 text-blue-600">
                <i className="fas fa-volume-up animate-pulse"></i>
                <span className="text-sm">{t('chat.aiSpeaking') || 'AI가 말하는 중...'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingUserMessage && (
        <div className="flex items-end space-x-3 justify-end animate-in fade-in duration-300">
          <div className="flex flex-col items-end max-w-[75%]">
            <div className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-2xl rounded-br-md px-4 py-3 shadow-md mt-1">
              {pendingUserText ? (
                <p className="leading-relaxed text-white">{pendingUserText}</p>
              ) : (
                <div className="flex items-center space-x-2 text-white">
                  <i className="fas fa-microphone animate-pulse"></i>
                  <span className="text-sm">{t('chat.recognizing') || '음성 인식 중...'}</span>
                </div>
              )}
            </div>
          </div>
          <div className="w-10 h-10 bg-gradient-to-br from-corporate-500 to-corporate-700 rounded-full flex items-center justify-center text-white text-sm font-semibold shadow-md ring-2 ring-white flex-shrink-0">
            나
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
