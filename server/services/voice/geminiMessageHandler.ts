import WebSocket from 'ws';
import { RealtimeSession } from './types';
import { filterThinkingText, isThinkingText } from './textFilter';
import { analyzeEmotion } from './emotionAnalyzer';
import { GoogleGenAI } from '@google/genai';

type SendToClient = (session: RealtimeSession, message: any) => void;
type ProactiveReconnect = (session: RealtimeSession) => void;

export function handleGeminiMessage(
  session: RealtimeSession,
  message: any,
  sendToClient: SendToClient,
  genAI: GoogleGenAI | null,
  proactiveReconnect: ProactiveReconnect
): void {
  session.lastActivityTime = Date.now();

  if (message.goAway) {
    const timeLeft = message.goAway.timeLeft || 0;
    console.log(`⚠️ GoAway 경고 수신: ${timeLeft}초 후 연결 종료 예정`);
    session.goAwayWarningTime = Date.now();

    if (timeLeft > 3 && !session.isReconnecting) {
      console.log(`🔄 GoAway 선제 재연결 시작 (${timeLeft}s 여유)`);
      sendToClient(session, {
        type: 'session.refreshing',
        message: '연결을 자동으로 갱신하고 있습니다...',
        timeLeft: timeLeft,
      });
      proactiveReconnect(session);
    } else {
      sendToClient(session, {
        type: 'session.warning',
        message: `연결이 ${timeLeft}초 후 종료됩니다. 대화를 마무리해 주세요.`,
        timeLeft: timeLeft,
      });
    }
    return;
  }

  if (message.sessionResumption) {
    const token = message.sessionResumption.handle;
    if (token) {
      session.sessionResumptionToken = token;
      console.log(`🔑 Session resumption token 저장됨`);
    }
  }

  const msgType = message.serverContent ? 'serverContent' : message.data ? 'audio data' : 'other';
  console.log(`📨 Gemini message type: ${msgType}`);

  if (msgType === 'other' && !message.goAway && !message.sessionResumption) {
    console.log(`🔍 Unknown message structure:`, JSON.stringify(message, null, 2).substring(0, 500));
  }

  if (message.data) {
    if (session.isInterrupted) {
      console.log(`🔇 Suppressing audio (barge-in active)`);
      return;
    }
    console.log('🔊 Audio data received (top-level)');
    sendToClient(session, {
      type: 'audio.delta',
      delta: message.data,
      turnSeq: session.turnSeq,
    });
    return;
  }

  if (message.serverContent) {
    const { serverContent } = message;

    const hasModelTurn = !!serverContent.modelTurn;
    const hasTurnComplete = !!serverContent.turnComplete;
    const hasInputTranscription = !!serverContent.inputTranscription;
    const hasOutputTranscription = !!serverContent.outputTranscription;
    console.log(`📋 serverContent: modelTurn=${hasModelTurn}, turnComplete=${hasTurnComplete}, inputTx=${hasInputTranscription}, outputTx=${hasOutputTranscription}`);

    if (serverContent.inputTranscription) {
      const transcript = serverContent.inputTranscription.text || '';
      console.log(`🎤 User transcript delta: ${transcript}`);

      if (session.userTranscriptBuffer.length === 0 && transcript.length > 0) {
        console.log('🎙️ User started speaking - notifying client');
        sendToClient(session, { type: 'user.speaking.started' });
      }

      session.userTranscriptBuffer += transcript;
      session.totalUserTranscriptLength += transcript.length;

      if (transcript.length > 0) {
        sendToClient(session, {
          type: 'user.transcription.delta',
          text: transcript,
          accumulated: session.userTranscriptBuffer,
        });
      }
    }

    if (serverContent.turnComplete) {
      console.log('✅ Turn complete');

      session.turnSeq++;
      console.log(`📊 Turn seq incremented to ${session.turnSeq}`);

      if (session.isInterrupted && session.turnSeq > session.cancelledTurnSeq) {
        console.log(`🔊 New turn ${session.turnSeq} > cancelled ${session.cancelledTurnSeq} - clearing barge-in flag`);
        session.isInterrupted = false;
        sendToClient(session, {
          type: 'response.ready',
          turnSeq: session.turnSeq,
        });
      }

      if (!session.hasReceivedFirstAIResponse && !session.currentTranscript && session.firstGreetingRetryCount < 3) {
        session.firstGreetingRetryCount++;
        console.log(`⚠️ 첫 인사 응답 없음, 재시도 ${session.firstGreetingRetryCount}/3...`);
        sendToClient(session, {
          type: 'greeting.retry',
          retryCount: session.firstGreetingRetryCount,
          maxRetries: 3,
        });

        if (session.geminiSession) {
          const retryMessages = [`네, 안녕하세요`, `여기 있습니다`, `말씀하세요`];
          const retryMessage = retryMessages[session.firstGreetingRetryCount - 1] || retryMessages[0];

          session.geminiSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: retryMessage }] }],
            turnComplete: true,
          });
          console.log(`🔄 인사 트리거 재전송: "${retryMessage}"`);
          session.geminiSession.sendRealtimeInput({ event: 'END_OF_TURN' });
        }
        return;
      }

      if (!session.hasReceivedFirstAIResponse && !session.currentTranscript && session.firstGreetingRetryCount >= 3) {
        console.log(`❌ 3회 시도 후에도 AI 인사 응답 없음 - 사용자가 먼저 시작하도록 안내`);
        sendToClient(session, { type: 'greeting.failed' });
      }

      sendToClient(session, { type: 'response.done' });

      if (session.userTranscriptBuffer.trim()) {
        const userText = session.userTranscriptBuffer.trim();
        console.log(`🎤 User turn complete (VAD): "${userText}"`);
        sendToClient(session, { type: 'user.transcription', transcript: userText });
        session.recentMessages.push({ role: 'user', text: userText.slice(0, 300) });
        if (session.recentMessages.length > 10) session.recentMessages.shift();
        session.userTranscriptBuffer = '';
      }

      if (session.currentTranscript) {
        const filteredTranscript = filterThinkingText(session.currentTranscript, session.userLanguage);
        console.log(`📝 Filtered transcript (${session.userLanguage}): "${filteredTranscript.substring(0, 100)}..."`);

        if (filteredTranscript) {
          session.recentMessages.push({ role: 'ai', text: filteredTranscript.slice(0, 300) });
          if (session.recentMessages.length > 10) session.recentMessages.shift();

          setImmediate(() => {
            analyzeEmotion(filteredTranscript, session.personaName, session.userLanguage, genAI)
              .then(({ emotion, emotionReason }) => {
                console.log(`😊 Emotion analyzed: ${emotion} (${emotionReason})`);
                sendToClient(session, {
                  type: 'ai.transcription.done',
                  text: filteredTranscript,
                  emotion,
                  emotionReason,
                });
              })
              .catch(error => {
                console.error('❌ Failed to analyze emotion:', error);
                sendToClient(session, {
                  type: 'ai.transcription.done',
                  text: filteredTranscript,
                  emotion: '중립',
                  emotionReason: '감정 분석 실패',
                });
              });
          });
        }
        session.currentTranscript = '';
      }
    }

    if (serverContent.modelTurn) {
      if (!session.hasReceivedFirstAIResponse) {
        session.hasReceivedFirstAIResponse = true;
        console.log(`⏱️ [TIMING] 첫 AI 응답 수신: ${new Date().toISOString()}`);
        console.log('🎉 첫 AI 응답 수신!');
      }

      const parts = serverContent.modelTurn.parts || [];
      console.log(`🎭 modelTurn parts count: ${parts.length}`);

      let hasThinkingText = false;
      for (const part of parts) {
        if (part.text && isThinkingText(part.text)) {
          hasThinkingText = true;
          console.log(`⚠️ Thinking text detected in modelTurn - will suppress audio for this chunk`);
          break;
        }
      }

      for (const part of parts) {
        if (part.text) {
          console.log(`🤖 AI transcript (raw): ${part.text.substring(0, 100)}...`);
          session.currentTranscript += part.text;
          const filteredText = filterThinkingText(part.text, session.userLanguage);
          if (filteredText) {
            sendToClient(session, { type: 'ai.transcription.delta', text: filteredText });
          }
        }

        if (part.inlineData) {
          if (session.isInterrupted) {
            console.log(`🔇 Suppressing inline audio (barge-in active)`);
            continue;
          }
          if (hasThinkingText) {
            console.log(`🔇 Suppressing inline audio (thinking text detected)`);
            continue;
          }
          const audioData = part.inlineData.data;
          const mimeType = part.inlineData.mimeType || 'audio/pcm';
          console.log(`🔊 Audio data received (inlineData), mimeType: ${mimeType}, length: ${audioData?.length || 0}`);
          if (audioData) {
            sendToClient(session, {
              type: 'audio.delta',
              delta: audioData,
              turnSeq: session.turnSeq,
            });
          }
        }
      }
    }

    if (serverContent.outputTranscription) {
      const transcript = serverContent.outputTranscription.text || '';
      console.log(`🤖 AI transcript delta (raw): ${transcript}`);

      if (session.isInterrupted && transcript.length > 0) {
        console.log(`🔊 New AI response started - clearing barge-in flag immediately`);
        session.isInterrupted = false;
        sendToClient(session, { type: 'response.ready', turnSeq: session.turnSeq });
      }

      if (!serverContent.modelTurn) {
        session.currentTranscript += transcript;
      }
      session.totalAiTranscriptLength += transcript.length;

      const filteredTranscript = filterThinkingText(transcript, session.userLanguage);
      if (filteredTranscript) {
        sendToClient(session, { type: 'ai.transcription.delta', text: filteredTranscript });
      }
    }
  }
}
