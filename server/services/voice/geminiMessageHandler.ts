import WebSocket from 'ws';
import { RealtimeSession } from './types';
import { filterThinkingText, isThinkingText } from './textFilter';
import { analyzeEmotion } from './emotionAnalyzer';
import { GoogleGenAI } from '@google/genai';
import { handleToolCall } from '../simulation/simulationToolHandler';
import { getOrCreateSessionContext, applySimulationPatch, getSessionState } from '../simulation/simulationEngine';
import { evaluateUserResponse } from '../simulation/evaluateUserResponse';
import { buildRuleFallbackPatch, inferStagePatchFromState, inferIncidentCandidate } from '../simulation/simulationRules';
import { checkIncidentCooldown, recordIncidentCooldown } from '../simulation/simulationEngine';
import { createDefaultSimulationState, SimulationDirective } from '../simulation/simulationTypes';
import { storage } from '../../storage';
import { v4 as uuidv4 } from 'uuid';

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
    const lastConsumed = message.sessionResumption.lastConsumedClientMessageIndex
      ?? message.sessionResumption.last_consumed_client_message_index;
    if (typeof lastConsumed === 'number') {
      const before = session.pendingMessages.length;
      session.pendingMessages = session.pendingMessages.filter(m => m.index > lastConsumed);
      console.log(`🧹 Pruned ${before - session.pendingMessages.length} acknowledged pending messages (lastConsumed=${lastConsumed}, remaining=${session.pendingMessages.length})`);
    }
  }

  const msgType = message.serverContent ? 'serverContent' : message.data ? 'audio data' : 'other';
  console.log(`📨 Gemini message type: ${msgType}`);

  if (msgType === 'other' && !message.goAway && !message.sessionResumption) {
    console.log(`🔍 Unknown message structure:`, JSON.stringify(message, null, 2).substring(0, 500));
  }

  if (message.toolCall) {
    const toolCallList = message.toolCall.functionCalls || [];
    for (const fc of toolCallList) {
      console.log(`🔧 Tool call received: ${fc.name}`, JSON.stringify(fc.args).substring(0, 200));
      // Use stable per-user-turn ID so engine same-turn conflict rule works across
      // tool calls and server_evaluation (which uses the same format at turnComplete).
      const turnId = `turn:${session.userTurnsCompleted}`;
      const personaRunId = session.personaRunId;
      // Capture state BEFORE the tool call for audit trail
      const stateBeforeTool = getSessionState(personaRunId);
      const result = handleToolCall(
        fc.name,
        fc.args,
        {
          personaRunId,
          turnId,
          turnIndex: session.userTurnsCompleted,
          currentTurnIncidentFired: session.currentTurnIncidentFired,
          toolCallCountThisTurn: session.toolCallCountThisTurn,
          emotionCallCountThisTurn: session.emotionCallCountThisTurn,
          language: session.userLanguage,
          scenarioContext: session.scenarioId,
        }
      );

      if (result.success) {
        session.toolCallCountThisTurn++;
        if (fc.name === 'update_npc_emotion') session.emotionCallCountThisTurn++;
        if (result.incident) session.currentTurnIncidentFired = true;
        if (result.currentState) session.simulationState = result.currentState;

        // Persist behaviorInstruction as a SimulationDirective with turn-based expiry (+2 turns per spec)
        if (result.behaviorInstruction && result.currentState) {
          const directive: SimulationDirective = {
            id: uuidv4(),
            createdTurnIndex: session.userTurnsCompleted,
            expiresAtTurnIndex: session.userTurnsCompleted + 2,
            instruction: result.behaviorInstruction,
            source: 'tool',
          };
          const stateWithDirective = applySimulationPatch(personaRunId, {
            source: 'gemini_tool', priority: 'normal', turnId,
            patch: { directivesToAdd: [directive] },
          });
          session.simulationState = stateWithDirective;
        }

        const stateAfterTool = session.simulationState ?? result.currentState;
        if (stateAfterTool) {
          // Best-effort DB persistence + audit event for tool calls
          setImmediate(async () => {
            try {
              await storage.saveSimulationState(personaRunId, stateAfterTool as unknown as Record<string, unknown>);
              await storage.createSimulationEvent({
                personaRunId,
                scenarioRunId: session.scenarioRunId ?? null,
                turnIndex: session.userTurnsCompleted,
                turnId,
                eventType: 'tool_call',
                toolName: fc.name,
                args: fc.args,
                result: { success: true, ...(result.statePatch ? { statePatch: result.statePatch } : {}), ...(result.incident ? { incident: result.incident } : {}) },
                stateBefore: stateBeforeTool,
                stateAfter: stateAfterTool,
                stateVersionBefore: stateBeforeTool?.version ?? null,
                stateVersionAfter: stateAfterTool.version,
                includeInReport: true,
              });
            } catch (e) {
              console.warn('[geminiMessageHandler] Failed to persist tool call state/event:', e);
            }
          });
        }

        // Use stateAfterTool (post-directive) so client always receives the latest version
        const finalStateForBroadcast = stateAfterTool ?? result.currentState;
        sendToClient(session, {
          type: 'simulation_update',
          personaRunId,
          turnId,
          eventType: 'tool_call',
          statePatch: result.statePatch,
          currentState: finalStateForBroadcast,
          incident: result.incident,
          version: finalStateForBroadcast?.version ?? 0,
          timestamp: new Date().toISOString(),
        });

        if (result.incident) {
          sendToClient(session, {
            type: 'simulation.incident',
            incident: result.incident,
          });
        }

        if (session.geminiSession && fc.id) {
          try {
            session.geminiSession.sendToolResponse?.({
              functionResponses: [{
                id: fc.id,
                name: fc.name,
                response: {
                  success: true,
                  ...(result.statePatch ? { statePatch: result.statePatch } : {}),
                  ...(result.currentState ? { currentState: { stage: result.currentState.stage, pressureLevel: result.currentState.pressureLevel, npcEmotions: result.currentState.npcEmotions } } : {}),
                  ...(result.behaviorInstruction ? { behaviorInstruction: result.behaviorInstruction } : {}),
                },
              }],
            });
          } catch (e) {
            console.warn('[geminiMessageHandler] Failed to send tool response:', e);
          }
        }
      } else {
        console.warn(`[geminiMessageHandler] Tool call failed: ${fc.name}`, result.error);
        if (session.geminiSession && fc.id) {
          try {
            session.geminiSession.sendToolResponse?.({
              functionResponses: [{
                id: fc.id,
                name: fc.name,
                response: { success: false, error: result.error },
              }],
            });
          } catch (e) {
            console.warn('[geminiMessageHandler] Failed to send tool error response:', e);
          }
        }
      }
    }
    return;
  }

  if (message.data) {
    if (session.isInterrupted) {
      console.log(`🔇 Suppressing audio (barge-in active)`);
      return;
    }
    if (!session.hasReceivedFirstAIAudio) {
      session.hasReceivedFirstAIAudio = true;
      session.hasReceivedFirstAIResponse = true;
      console.log(`🔊 [TIMING] 첫 AI 오디오 수신 (top-level): ${new Date().toISOString()}`);
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
        if (session.isInterrupted) {
          console.log(`🔄 User speech confirmed by VAD — clearing barge-in state (cancelledTurn=${session.cancelledTurnSeq})`);
          session.isInterrupted = false;
          session.cancelledTurnSeq = -1;
        }
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
          // strictMode on turn 0: aggressively strip reasoning preambles that
          // Gemini often emits at the start of the very first response.
          const filteredText = filterThinkingText(part.text, session.userLanguage, { strictMode: session.turnSeq === 0 });
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
            if (!session.hasReceivedFirstAIAudio) {
              session.hasReceivedFirstAIAudio = true;
              session.hasReceivedFirstAIResponse = true;
              console.log(`🔊 [TIMING] 첫 AI 오디오 수신 (inlineData): ${new Date().toISOString()}`);
            }
            sendToClient(session, {
              type: 'audio.delta',
              delta: audioData,
              turnSeq: session.turnSeq,
            });
          }
        }
      }
    }

    if (serverContent.turnComplete) {
      console.log('✅ Turn complete');

      session.turnSeq++;
      // Capture counters BEFORE reset so evaluation/fallback gates use actual values
      const toolCallsThisTurn = session.toolCallCountThisTurn;
      // Capture incident flag BEFORE reset so server-rule inference cannot fire when
      // a Gemini tool already triggered an incident during this logical user turn.
      const incidentFiredThisTurn = session.currentTurnIncidentFired;
      session.toolCallCountThisTurn = 0;
      session.emotionCallCountThisTurn = 0;
      session.currentTurnIncidentFired = false;
      console.log(`📊 Turn seq incremented to ${session.turnSeq}`);

      if (session.isInterrupted && session.turnSeq > session.cancelledTurnSeq) {
        console.log(`🔊 New turn ${session.turnSeq} > cancelled ${session.cancelledTurnSeq} - clearing barge-in flag`);
        session.isInterrupted = false;
        session.cancelledTurnSeq = -1;
        sendToClient(session, {
          type: 'response.ready',
          turnSeq: session.turnSeq,
        });
      }

      if (!session.hasReceivedFirstAIResponse && !session.hasReceivedFirstAIAudio && !session.currentTranscript && !hasModelTurn && !session.hasReceivedFirstTranscriptDelta && session.firstGreetingRetryCount < 3) {
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

      if (!session.hasReceivedFirstAIResponse && !session.hasReceivedFirstAIAudio && !session.currentTranscript && !hasModelTurn && session.firstGreetingRetryCount >= 3) {
        console.log(`❌ 3회 시도 후에도 AI 인사 응답 없음 - 사용자가 먼저 시작하도록 안내`);
        sendToClient(session, { type: 'greeting.failed' });
      }

      sendToClient(session, { type: 'response.done' });

      if (session.userTranscriptBuffer.trim()) {
        const userText = session.userTranscriptBuffer.trim();
        console.log(`🎤 User turn complete (VAD): "${userText}"`);
        sendToClient(session, { type: 'user.transcription', transcript: userText });
        session.recentMessages.push({ role: 'user', text: userText.slice(0, 300) });
        if (session.recentMessages.length > 30) session.recentMessages.shift();
        session.userTranscriptBuffer = '';
        session.userTurnsCompleted++;

        const isPersonaXSession = session.scenarioId.startsWith('__user_persona__:') ||
          session.scenarioId.startsWith('__free_chat__') ||
          session.scenarioId.startsWith('__mbti_persona__:');

        const currentTurnId = `turn:${session.userTurnsCompleted}`;
        // Robust djb2 hash of normalized transcript — resistant to turn/length collisions
        const normalizedText = userText.trim().toLowerCase().replace(/\s+/g, ' ');
        let _h = 5381;
        for (let _i = 0; _i < normalizedText.length; _i++) { _h = (_h * 33) ^ normalizedText.charCodeAt(_i); }
        const transcriptHash = `${session.userTurnsCompleted}:${(_h >>> 0).toString(16)}`;
        // Primary gate: turnId-based idempotency; secondary: content-hash dedup
        const alreadyEvaluated = session.lastEvaluatedUserTurnId === currentTurnId ||
          session.lastFinalizedUserTranscriptHash === transcriptHash;

        // Evaluation always runs for valid finalized turns; toolCallsThisTurn===0
        // only gates buildRuleFallbackPatch (not the evaluation call itself)
        if (!isPersonaXSession && !alreadyEvaluated) {
          session.lastEvaluatedUserTurnId = currentTurnId;  // Mark evaluated by turnId (primary gate)
          session.lastFinalizedUserTranscriptHash = transcriptHash;  // Secondary hash guard
          session.lastEvaluatedUserTurnIndex = session.userTurnsCompleted;
          const personaRunId = session.personaRunId;
          // Reuse currentTurnId so all patches (tool_call, server_evaluation, server_rule)
          // within the same logical user turn share one stable ID. This enables the engine's
          // same-turn conflict cap (gemini_tool limited to ±10 after server_evaluation) to fire.
          const turnId = currentTurnId;
          const turnIndex = session.userTurnsCompleted - 1;
          const aiText = session.recentMessages.filter(m => m.role === 'ai').slice(-1)[0]?.text ?? '';

          setImmediate(async () => {
            try {
              let state = getSessionState(personaRunId);
              if (!state) state = createDefaultSimulationState();
              const stateBefore = state;

              const evalResult = await evaluateUserResponse({
                personaRunId,
                turnId,
                turnIndex,
                userText,
                aiText,
                simulationState: state,
                language: session.userLanguage,
              });

              // Short utterances (<10 chars) are skipped by evaluateUserResponse per spec:
              // turn index has already been incremented; only skip patch/log/broadcast.
              if (!evalResult.skipped) {
                let newState = applySimulationPatch(personaRunId, {
                  source: 'server_evaluation',
                  priority: 'normal',
                  turnId,
                  patch: {
                    turnScoresToAdd: [evalResult.turnScore],
                    npcEmotionDelta: evalResult.emotionDelta,
                  },
                });

                const rulePatch = buildRuleFallbackPatch(evalResult.turnScore, newState, toolCallsThisTurn);
                if (rulePatch) {
                  newState = applySimulationPatch(personaRunId, {
                    source: 'server_rule', priority: 'low', turnId, patch: rulePatch,
                  });
                }

                const stageTransition = inferStagePatchFromState(newState);
                if (stageTransition) {
                  newState = applySimulationPatch(personaRunId, {
                    source: 'server_rule', priority: 'normal', turnId,
                    patch: { targetStage: stageTransition },
                  });
                }

                // Only infer a server-rule incident if Gemini tool did NOT already fire one
                // during this logical user turn (enforces one-incident-per-turn constraint
                // across both the tool and rule pipelines).
                if (!incidentFiredThisTurn) {
                  const incidentCandidate = inferIncidentCandidate(newState, personaRunId, turnIndex, session.userLanguage, session.scenarioId);
                  if (incidentCandidate) {
                    const cooldownCheck = checkIncidentCooldown(personaRunId, incidentCandidate.type);
                    if (cooldownCheck.allowed) {
                      recordIncidentCooldown(personaRunId, incidentCandidate.type);
                      newState = applySimulationPatch(personaRunId, {
                        source: 'server_rule', priority: 'normal', turnId,
                        patch: { incidentsToAdd: [incidentCandidate] },
                      });
                      sendToClient(session, { type: 'simulation.incident', incident: incidentCandidate });
                    }
                  }
                }

                session.simulationState = newState;

                const { storage } = await import('../../storage');
                await storage.saveSimulationState(personaRunId, newState as unknown as Record<string, unknown>);

                storage.createSimulationEvent({
                  personaRunId,
                  scenarioRunId: null,
                  turnIndex,
                  turnId,
                  eventType: 'auto_evaluation',
                  toolName: null,
                  args: { userTextLength: userText.length, method: evalResult.method },
                  result: { turnScore: evalResult.turnScore },
                  stateBefore: stateBefore,
                  stateAfter: newState,
                  stateVersionBefore: stateBefore.version,
                  stateVersionAfter: newState.version,
                  includeInReport: true,
                }).catch(e => console.warn('[geminiMessageHandler] Failed to log eval event:', e));

                sendToClient(session, {
                  type: 'simulation_update',
                  personaRunId,
                  turnId,
                  eventType: 'auto_evaluation',
                  currentState: newState,
                  turnScore: evalResult.turnScore,
                  version: newState.version,
                  timestamp: new Date().toISOString(),
                });
              }
            } catch (e) {
              console.warn('[geminiMessageHandler] Rule-fallback evaluation failed:', e);
            }
          });
        }
      }

      if (session.currentTranscript) {
        // turnSeq has already been incremented by the time we reach here, so
        // the first completed turn has turnSeq === 1.  Use <= 1 to keep strict
        // mode active for the first turn's accumulated transcript.
        const filteredTranscript = filterThinkingText(session.currentTranscript, session.userLanguage, { strictMode: session.turnSeq <= 1 });
        console.log(`📝 Filtered transcript (${session.userLanguage}): "${filteredTranscript.substring(0, 100)}..."`);

        if (filteredTranscript) {
          // Last-resort greeting dedup guard: while the user has not yet spoken
          // (greeting phase), only one AI response is allowed. Any additional
          // response in this phase is a duplicate from the retry race condition.
          // This guard is scoped to the greeting turn and does not affect subsequent
          // turns where the user has already spoken.
          if (session.userTurnsCompleted === 0) {
            if (session.greetingResponseCount >= 1) {
              console.log(`⚠️ Suppressing duplicate greeting response (greetingResponseCount guard, userTurnsCompleted=0)`);
              session.currentTranscript = '';
              return;
            }
            session.greetingResponseCount++;
          }

          session.recentMessages.push({ role: 'ai', text: filteredTranscript.slice(0, 300) });
          if (session.recentMessages.length > 30) session.recentMessages.shift();

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

    if (serverContent.outputTranscription) {
      const transcript = serverContent.outputTranscription.text || '';
      console.log(`🤖 AI transcript delta (raw): ${transcript}`);

      if (session.isInterrupted && transcript.length > 0) {
        console.log(`🔊 New AI response started - clearing barge-in flag immediately`);
        session.isInterrupted = false;
        session.cancelledTurnSeq = -1;
        sendToClient(session, { type: 'response.ready', turnSeq: session.turnSeq });
      }

      if (transcript.length > 0 && !session.hasReceivedFirstTranscriptDelta) {
        session.hasReceivedFirstTranscriptDelta = true;
        // Exhaust the retry budget so no retry triggers can fire after this point,
        // even if turnComplete arrives before Gemini finishes the turn.
        session.firstGreetingRetryCount = 3;
        console.log(`✅ First transcript delta received — retry gate closed`);
      }

      if (!serverContent.modelTurn) {
        session.currentTranscript += transcript;
      }
      session.totalAiTranscriptLength += transcript.length;

      const filteredTranscript = filterThinkingText(transcript, session.userLanguage, { strictMode: session.turnSeq === 0 });
      if (filteredTranscript) {
        sendToClient(session, { type: 'ai.transcription.delta', text: filteredTranscript });
      }
    }
  }
}
