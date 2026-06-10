import WebSocket from 'ws';
import { RealtimeSession } from './types';
import { filterThinkingText, isThinkingText } from './textFilter';
import { analyzeEmotion } from './emotionAnalyzer';
import { GoogleGenAI } from '@google/genai';
import { handleToolCall } from '../simulation/simulationToolHandler';
import { getOrCreateSessionContext, applySimulationPatch, getSessionState, setSessionState, getSessionEvaluationHarness, getSessionHarnessConfig, getSessionFlowGraph } from '../simulation/simulationEngine';
import { evaluateUserResponse } from '../simulation/evaluateUserResponse';
import { buildRuleFallbackPatch, inferIncidentCandidate, resolveStageTransition } from '../simulation/simulationRules';
import { checkIncidentCooldown, recordIncidentCooldown } from '../simulation/simulationEngine';
import { createDefaultSimulationState, SimulationDirective } from '../simulation/simulationTypes';
import { storage } from '../../storage';
import { v4 as uuidv4 } from 'uuid';
import { getSoftClosingInstruction } from '../conversationDifficultyPolicy';

type SendToClient = (session: RealtimeSession, message: any) => void;
type ProactiveReconnect = (session: RealtimeSession) => void;

// Voice-mode switch announcement check: allow switch_persona when the current AI
// transcript contains switch keywords + a non-active persona name/position.
// Prevents permanent blocking when the heuristic announcement flags were missed.
const VOICE_SWITCH_KEYWORDS = [
  // Korean
  '연결', '바꿔', '담당', '전달', '연결해드', '부탁드릴', '도움을 받으실',
  // English
  'connect', 'transfer', 'switch', 'bring in', 'hand over', 'hand you', 'get someone',
  // Japanese
  'つなぎ', '代わり', '担当', '切り替え', 'おつなぎ', 'お繋ぎ', 'かわり',
  // Chinese
  '转接', '切换', '联系', '转给', '帮您转',
];

function transcriptHasSwitchIntent(
  transcript: string,
  personas: Array<{ name?: string; position?: string; [key: string]: any }> | null,
  currentPersonaIndex: number
): boolean {
  if (!transcript || !personas || personas.length <= 1) return false;
  const textLower = transcript.toLowerCase();
  if (!VOICE_SWITCH_KEYWORDS.some(kw => textLower.includes(kw))) return false;
  const nonActive = personas.filter((_, i) => i !== currentPersonaIndex);
  return nonActive.some(p =>
    (p.name && transcript.includes(p.name)) ||
    (p.position && transcript.includes(p.position))
  );
}

async function handleTerminationIfNeeded(
  session: RealtimeSession,
  newState: import('../simulation/simulationTypes').SimulationState,
  sendToClient: SendToClient
): Promise<void> {
  const terminationReason = newState.terminationReason;
  if (!terminationReason || session.terminationHandled) return;
  session.terminationHandled = true;

  console.log(`[geminiMessageHandler] terminationRules fired in voice: reason=${terminationReason}, personaRunId=${session.personaRunId}`);

  try {
    const { storage: st } = await import('../../storage');
    const personaRun = await st.getPersonaRun(session.personaRunId);
    if (personaRun && personaRun.status !== 'completed') {
      await st.updatePersonaRun(session.personaRunId, { status: 'completed', completedAt: new Date() });
    }

    if (session.scenarioRunId) {
      const { checkAndCompleteScenario } = await import('../../routes/routerHelpers');
      await checkAndCompleteScenario(session.scenarioRunId);
    }

    await st.createSimulationEvent({
      personaRunId: session.personaRunId,
      scenarioRunId: session.scenarioRunId ?? null,
      turnIndex: session.userTurnsCompleted,
      turnId: `turn:${session.userTurnsCompleted}`,
      eventType: 'session_end',
      toolName: null,
      args: null,
      result: { reason: `termination_${terminationReason}` },
      stateBefore: null,
      stateAfter: newState,
      stateVersionBefore: null,
      stateVersionAfter: newState.version,
      includeInReport: true,
    }).catch(e => console.warn('[geminiMessageHandler] Failed to log termination session_end event:', e));
  } catch (e) {
    console.warn('[geminiMessageHandler] Failed to complete persona run on termination:', e);
  }

  sendToClient(session, {
    type: 'termination',
    reason: terminationReason,
    personaRunId: session.personaRunId,
    timestamp: new Date().toISOString(),
  });
}

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

  const hasData = !!message.data;
  const hasServerContent = !!message.serverContent;
  // Pre-check: does this message contain inlineData audio inside modelTurn?
  // When true, we use inlineData as the authoritative audio source and skip
  // the top-level message.data bytes to avoid double-playback.
  const hasInlineDataInModelTurn = !!(
    message.serverContent?.modelTurn?.parts?.some((p: any) => !!p.inlineData)
  );
  const msgType = hasServerContent && hasData ? 'audio+serverContent' : hasServerContent ? 'serverContent' : hasData ? 'audio data' : 'other';
  console.log(`📨 Gemini message type: ${msgType}`);

  if (msgType === 'other' && !message.goAway && !message.sessionResumption && !message.usageMetadata) {
    console.log(`🔍 Unknown message structure:`, JSON.stringify(message, null, 2).substring(0, 500));
  }

  if (message.usageMetadata) {
    const cached = message.usageMetadata.cachedContentTokenCount ?? 0;
    if (cached > 0) {
      session.totalCachedTokens += cached;
      console.log(`⚡ Cache hit (voice): ${cached} cached tokens (session total: ${session.totalCachedTokens})`);
    }
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
          currentPersonaIndex: session.activePersonaIndex,
          scenarioPersonas: session.scenarioPersonas ?? undefined,
          harness: session.simulationHarness,
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

        if (finalStateForBroadcast) {
          setImmediate(() => handleTerminationIfNeeded(session, finalStateForBroadcast, sendToClient));
        }

        if (result.incident) {
          sendToClient(session, {
            type: 'simulation.incident',
            incident: result.incident,
          });
        }

        // 2-step persona switch guard: block only if ALL three allow-conditions are false:
        //  1. personaSwitchPending — user consent keyword was detected
        //  2. awaitingPersonaSwitch — AI announcement was previously detected and tracked
        //  3. transcriptHasSwitchIntent — current AI transcript contains switch keywords +
        //     a non-active persona name/position (heuristic-miss recovery, Bug 2 fix)
        const _transcriptHasIntent = transcriptHasSwitchIntent(
          session.currentTranscript,
          session.scenarioPersonas,
          session.activePersonaIndex
        );
        if (fc.name === 'switch_persona' && result.personaSwitched && !session.personaSwitchPending && !session.awaitingPersonaSwitch && !_transcriptHasIntent) {
          console.warn(`[geminiMessageHandler] Blocking premature switch_persona — neither personaSwitchPending nor awaitingPersonaSwitch is set. Forcing AI to announce first.`);
          const blockMessages: Record<string, string> = {
            ko: '먼저 대화 속에서 전환 의사를 자연스럽게 말한 뒤 사용자의 동의를 기다리세요. 아직 switch_persona를 호출하지 마세요.',
            en: 'You must first announce the persona switch in natural conversation and wait for the user to agree. Do not call switch_persona yet.',
            ja: 'まず会話の中で自然に切り替え意図を伝え、ユーザーの同意を待ってください。まだswitch_personaを呼び出さないでください。',
            zh: '请先在对话中自然地表明切换意图，等待用户同意后再调用switch_persona。',
          };
          if (session.geminiSession && fc.id) {
            try {
              session.geminiSession.sendToolResponse?.({
                functionResponses: [{
                  id: fc.id,
                  name: fc.name,
                  response: {
                    success: false,
                    error: blockMessages[session.userLanguage] ?? blockMessages.en,
                  },
                }],
              });
            } catch (e) {
              console.warn('[geminiMessageHandler] Failed to send switch_persona block response:', e);
            }
          }
          // Skip further processing for this tool call — announcement must come first
          continue;
        }

        if (result.personaSwitched) {
          const switched = result.personaSwitched;
          // Reset both switch-state flags now that the confirmed switch is executing
          session.personaSwitchPending = false;
          session.awaitingPersonaSwitch = false;
          console.log(`🔄 [Voice] Persona switch: ${switched.fromIndex} → ${switched.toIndex} (${switched.toPersonaId})`);
          session.activePersonaIndex = switched.toIndex;
          const newPersona = session.scenarioPersonas?.[switched.toIndex];
          if (newPersona) {
            session.personaName = newPersona.name;
            session.voiceGender = newPersona.gender === 'female' ? 'female' : 'male';
            session.voiceId = newPersona.voiceId ?? null;
            session.selectedVoice = null;
            session.personaId = newPersona.id;
          }
          const fromPersonaForEvent = session.scenarioPersonas?.[switched.fromIndex];
          sendToClient(session, {
            type: 'persona.switched',
            personaRunId: session.personaRunId,
            switched,
            newPersonaName: newPersona?.name ?? switched.toPersonaId,
            fromPersonaName: fromPersonaForEvent?.name,
          });
          // Rebuild system instructions for the new persona so proactiveReconnect uses the correct prompt
          if (session.personaSystemInstructions?.[switched.toIndex]) {
            session.systemInstructions = session.personaSystemInstructions[switched.toIndex];
            console.log(`🔧 [Voice] System instructions rebuilt for persona[${switched.toIndex}]: ${newPersona?.name}`);
          }
          // Emit transition line as a text overlay so the client shows it while Gemini finishes the turn
          if (switched.transitionLine) {
            sendToClient(session, {
              type: 'ai.transcription.done',
              text: switched.transitionLine,
              turnSeq: session.turnSeq,
            });
          }
          // Defer proactiveReconnect to turnComplete so Gemini finishes any in-flight audio
          // output (including the transitionLine the model will speak) before the session switches.
          session.pendingPersonaSwitch = {
            fromIndex: switched.fromIndex,
            toIndex: switched.toIndex,
            fromPersonaId: switched.fromPersonaId,
            toPersonaId: switched.toPersonaId,
            reason: switched.reason,
            transitionLine: switched.transitionLine ?? '',
          };
          console.log(`⏳ [Voice] Persona switch deferred to turnComplete for persona[${switched.toIndex}]`);
          // Persist to DB best-effort
          setImmediate(async () => {
            try {
              const existing = (await storage.getPersonaRun(session.personaRunId))?.personaSwitchLog as any[] ?? [];
              await storage.updatePersonaRun(session.personaRunId, {
                activePersonaIndex: switched.toIndex,
                personaSwitchLog: [
                  ...existing,
                  {
                    turn: session.userTurnsCompleted,
                    fromPersonaIndex: switched.fromIndex,
                    toPersonaIndex: switched.toIndex,
                    fromPersonaId: switched.fromPersonaId,
                    toPersonaId: switched.toPersonaId,
                    reason: switched.reason,
                    transitionLine: switched.transitionLine,
                    timestamp: new Date().toISOString(),
                  },
                ],
              });
            } catch (e) {
              console.warn('[geminiMessageHandler] Failed to persist persona switch to DB:', e);
            }
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
    if (hasInlineDataInModelTurn) {
      // The same audio bytes will arrive via serverContent.modelTurn.parts[].inlineData.
      // Skip top-level message.data to prevent double-playback.
      console.log(`🔇 Skipping top-level audio — inlineData present in modelTurn (will use inlineData)`);
    } else if (session.isInterrupted) {
      if (session.turnSeq > session.cancelledTurnSeq) {
        console.log(`🔄 Audio arrived for new turn (turnSeq=${session.turnSeq} > cancelledTurnSeq=${session.cancelledTurnSeq}) — clearing isInterrupted`);
        session.isInterrupted = false;
        session.cancelledTurnSeq = -1;
      } else {
        console.log(`🔇 Suppressing audio (barge-in active)`);
        // Do NOT return early — fall through so serverContent (e.g. outputTranscription,
        // turnComplete) in the same message is still processed.
      }
    }
    if (!session.isInterrupted && !hasInlineDataInModelTurn) {
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
    }
    // Only skip further processing when there is no serverContent attached to this message.
    // gemini-3.1-flash-live-preview may send outputTranscription / turnComplete
    // in the same message object alongside the raw audio bytes.
    if (!message.serverContent) {
      return;
    }
  }

  if (message.serverContent) {
    const { serverContent } = message;

    const hasModelTurn = !!serverContent.modelTurn;
    const hasTurnComplete = !!serverContent.turnComplete;
    const hasInputTranscription = !!serverContent.inputTranscription;
    const hasOutputTranscription = !!serverContent.outputTranscription;
    // outputTranscription is the authoritative spoken-text source when present.
    // Avoid double-counting: if outputTranscription is in this same message,
    // modelTurn part.text should NOT also be added to currentTranscript.
    const preferOutputTranscription = hasOutputTranscription && !!serverContent.outputTranscription?.text?.length;
    console.log(`📋 serverContent: modelTurn=${hasModelTurn}, turnComplete=${hasTurnComplete}, inputTx=${hasInputTranscription}, outputTx=${hasOutputTranscription}, preferOutputTx=${preferOutputTranscription}`);

    if (serverContent.inputTranscription) {
      const transcript = serverContent.inputTranscription.text || '';
      console.log(`🎤 User transcript delta: ${transcript}`);

      if (session.userTranscriptBuffer.length === 0 && transcript.length > 0) {
        if (session.isInterrupted) {
          console.log(`🔄 User speech confirmed by VAD — clearing barge-in state (cancelledTurn=${session.cancelledTurnSeq})`);
          session.isInterrupted = false;
          session.cancelledTurnSeq = -1;
        }
        if (!session.userSpeechStarted) {
          session.userSpeechStarted = true;
          console.log('🎙️ User speech started — userSpeechStarted=true');
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
          // Only accumulate modelTurn text to currentTranscript when
          // outputTranscription is NOT present in this same message.
          // outputTranscription is the authoritative transcription source;
          // using both would cause double-counting.
          if (!preferOutputTranscription) {
            session.currentTranscript += part.text;
          }
          // Always send as delta to the client UI (for live streaming display),
          // but only when outputTranscription is not already handling it.
          if (!preferOutputTranscription) {
            // strictMode on turn 0: aggressively strip reasoning preambles that
            // Gemini often emits at the start of the very first response.
            const filteredText = filterThinkingText(part.text, session.userLanguage, { strictMode: session.turnSeq === 0 });
            if (filteredText) {
              sendToClient(session, { type: 'ai.transcription.delta', text: filteredText });
            }
          }
        }

        if (part.inlineData) {
          if (session.suppressAIUntilUserSpeaks) {
            console.log(`🔇 Suppressing inline audio (awaiting user speech after context injection)`);
            continue;
          }
          if (session.isInterrupted) {
            if (session.turnSeq > session.cancelledTurnSeq) {
              console.log(`🔄 Inline audio arrived for new turn (turnSeq=${session.turnSeq} > cancelledTurnSeq=${session.cancelledTurnSeq}) — clearing isInterrupted`);
              session.isInterrupted = false;
              session.cancelledTurnSeq = -1;
            } else {
              console.log(`🔇 Suppressing inline audio (barge-in active)`);
              continue;
            }
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

    // outputTranscription MUST be processed before turnComplete.
    // Gemini-live-2.5-flash frequently sends both fields in the same message
    // for non-greeting turns. If turnComplete runs first it clears
    // session.currentTranscript before outputTranscription has a chance to
    // accumulate into it, causing all AI speech after the first greeting to be
    // silently dropped from the conversation history.
    if (serverContent.outputTranscription) {
      const transcript = serverContent.outputTranscription.text || '';
      console.log(`🤖 AI transcript delta (raw): ${transcript}`);

      if (session.suppressAIUntilUserSpeaks) {
        console.log(`🔇 Suppressing outputTranscription (awaiting user speech after context injection): "${transcript.substring(0, 80)}"`);
        // Still accumulate so turnComplete can clear it cleanly, but do NOT forward to client
        session.currentTranscript += transcript;
      } else {
        if (session.isInterrupted && transcript.length > 0) {
          console.log(`🔊 New AI response started - clearing barge-in flag immediately`);
          session.isInterrupted = false;
          session.cancelledTurnSeq = -1;
          sendToClient(session, { type: 'response.ready', turnSeq: session.turnSeq });
        }

        if (transcript.length > 0 && !session.hasReceivedFirstTranscriptDelta) {
          session.hasReceivedFirstTranscriptDelta = true;
          console.log(`✅ First transcript delta received`);
        }

        // Always accumulate outputTranscription: it is the authoritative
        // transcription of what the AI actually spoke (produced by Gemini's
        // outputAudioTranscription feature). Previously this was gated on
        // `!serverContent.modelTurn` to avoid double-counting with
        // modelTurn.parts[].text, but gemini-live-2.5-flash sends both fields
        // in the same message for every non-greeting turn — causing the
        // transcription to be silently dropped and never sent as
        // ai.transcription.done. modelTurn accumulation is now suppressed
        // when outputTranscription is present (see preferOutputTranscription).
        session.currentTranscript += transcript;
        session.totalAiTranscriptLength += transcript.length;

        const filteredTranscript = filterThinkingText(transcript, session.userLanguage, { strictMode: session.turnSeq === 0 });
        if (filteredTranscript) {
          sendToClient(session, { type: 'ai.transcription.delta', text: filteredTranscript });
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

      // Deferred persona switch: fire proactiveReconnect now that audio for this turn is done
      if (session.pendingPersonaSwitch) {
        const pending = session.pendingPersonaSwitch;
        session.pendingPersonaSwitch = undefined;
        console.log(`🔄 [Voice] Executing deferred proactiveReconnect for persona[${pending.toIndex}] after turnComplete`);
        proactiveReconnect(session);
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

        // If the AI announced a pending switch, analyze user's response for consent.
        // Positive consent → allow the next switch_persona tool call.
        // Clear decline → cancel the pending switch and notify the client.
        // Off-topic / ambiguous → stay in awaitingPersonaSwitch, keep waiting.
        if (session.awaitingPersonaSwitch) {
          const consentKw: Record<string, string[]> = {
            ko: ['네', '응', '좋아요', '알겠어요', '그래요', '부탁해요', '연결해주세요', '좋습니다', '해주세요', '바꿔주세요'],
            en: ['yes', 'sure', 'okay', 'ok', 'please', 'go ahead', "that's fine", 'connect me', 'sounds good', 'alright'],
            ja: ['はい', 'いいです', 'わかりました', 'おねがいします', 'つないでください', 'よろしく'],
            zh: ['好的', '可以', '行', '好', '请', '没问题', '转接吧', '麻烦你'],
          };
          const declineKw: Record<string, string[]> = {
            ko: ['아니요', '아니', '지금은', '나중에', '필요없어요', '됐어요', '괜찮습니다'],
            en: ['no', 'not now', 'later', "i'd rather", 'never mind', 'no thanks', "that's ok", 'that is ok'],
            ja: ['いいえ', '大丈夫です', '後で', '今は', 'けっこうです'],
            zh: ['不用', '没关系', '以后', '不需要', '算了', '不了'],
          };
          const lang = session.userLanguage;
          const userLower = userText.toLowerCase();
          const hasConsent = (consentKw[lang] ?? consentKw.en).some(kw => userLower.includes(kw));
          const hasDecline = (declineKw[lang] ?? declineKw.en).some(kw => userLower.includes(kw));

          if (hasConsent && !hasDecline) {
            console.log(`✅ [Voice] User consented to persona switch — setting personaSwitchPending=true`);
            session.personaSwitchPending = true;
          } else if (hasDecline) {
            console.log(`❌ [Voice] User declined persona switch — clearing pending state`);
            session.awaitingPersonaSwitch = false;
            session.personaSwitchPending = false;
            sendToClient(session, { type: 'persona.switch_pending_cleared' });
          }
          // Off-topic / ambiguous: stay in awaitingPersonaSwitch=true, keep waiting
        }

        // Soft-close: send a one-time wrapping-up instruction when 80% of targetTurns is reached
        if (
          session.targetTurns &&
          !session.softCloseSent &&
          session.geminiSession
        ) {
          const softClose = getSoftClosingInstruction(session.userTurnsCompleted, session.targetTurns, session.userLanguage);
          if (softClose) {
            session.softCloseSent = true;
            console.log(`🔔 [SoftClose] Sending soft-close instruction at turn ${session.userTurnsCompleted}/${session.targetTurns}`);
            const softClosePayload = {
              turns: [{ role: 'user', parts: [{ text: `[SYSTEM CONTEXT UPDATE — DO NOT READ ALOUD] ${softClose}` }] }],
              turnComplete: false,
            };
            session.geminiSession.sendClientContent(softClosePayload);
          }
        }

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

          if (session.evaluationInProgress) {
            console.warn(`[geminiMessageHandler] Skipping evaluation for turn ${session.userTurnsCompleted} — previous evaluation still in progress (personaRunId=${personaRunId})`);
          } else {
          session.evaluationInProgress = true;
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
                evaluationHarness: getSessionEvaluationHarness(personaRunId) ?? null,
                npcBehaviorHarness: getSessionHarnessConfig(personaRunId).npcBehaviorHarness ?? null,
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

                const stageTransition = resolveStageTransition(newState, getSessionFlowGraph(personaRunId));
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

                await handleTerminationIfNeeded(session, newState, sendToClient);
              }
            } catch (e) {
              const evalError = e instanceof Error ? e : new Error(String(e));
              console.error('[geminiMessageHandler] Rule-fallback evaluation failed', {
                personaRunId,
                turnIndex,
                evaluationMode: 'fast',
                errorMessage: evalError.message,
                errorStack: evalError.stack,
              });
              // Always send a simulation_update so the client panel doesn't stay empty.
              // Even without a turnScore, the client can at least render the current state.
              // Fall through to createDefaultSimulationState() so the broadcast is unconditional.
              const fallbackState =
                session.simulationState ?? getSessionState(personaRunId) ?? createDefaultSimulationState();
              // Sync both session and in-memory store to avoid UI/server divergence.
              if (!session.simulationState) {
                session.simulationState = fallbackState;
                setSessionState(personaRunId, fallbackState);
              }
              sendToClient(session, {
                type: 'simulation_update',
                personaRunId,
                turnId,
                eventType: 'auto_evaluation',
                currentState: fallbackState,
                version: fallbackState.version,
                timestamp: new Date().toISOString(),
              });
            } finally {
              session.evaluationInProgress = false;
            }
          });
          }
        }
      }

      if (session.suppressAIUntilUserSpeaks) {
        // Gemini generated an unsolicited turn after our turnComplete:false context
        // injection (a known Gemini Live quirk). Discard transcript + audio silently.
        console.log(`🔇 [turnComplete] Discarding suppressed AI turn (awaiting user speech) — transcript: "${session.currentTranscript.substring(0, 80)}"`);
        session.currentTranscript = '';
        // Keep suppressAIUntilUserSpeaks=true; it is cleared only when actual user audio arrives.
      } else if (session.currentTranscript) {
        // turnSeq has already been incremented by the time we reach here, so
        // the first completed turn has turnSeq === 1.  Use <= 1 to keep strict
        // mode active for the first turn's accumulated transcript.
        const filteredTranscript = filterThinkingText(session.currentTranscript, session.userLanguage, { strictMode: session.turnSeq <= 1 });
        console.log(`📝 Filtered transcript (${session.userLanguage}): "${filteredTranscript.substring(0, 100)}..."`);

        // Detect persona switch announcement: the AI told the user it will connect
        // them to another persona and is awaiting the user's confirmation.
        // Detection heuristic: a non-active persona's name appears in the AI's
        // transcript alongside transfer-language keywords.
        // Sets awaitingPersonaSwitch=true; personaSwitchPending is only set later
        // once the user's consent is detected in the user transcript.
        if (
          filteredTranscript &&
          session.scenarioPersonas && session.scenarioPersonas.length > 1 &&
          !session.awaitingPersonaSwitch &&
          !session.personaSwitchPending
        ) {
          const nonActivePersonas = session.scenarioPersonas.filter((_, i) => i !== session.activePersonaIndex);
          const switchKeywords: Record<string, string[]> = {
            ko: ['연결', '바꿔', '담당', '전달', '연결해드', '부탁드릴', '도움을 받으실'],
            en: ['connect', 'transfer', 'switch', 'bring in', 'hand over', 'hand you', 'get someone'],
            ja: ['つなぎ', '代わり', '担当', '切り替え', 'おつなぎ', 'お繋ぎ', 'かわり'],
            zh: ['转接', '切换', '换', '联系', '转给', '帮您转'],
          };
          const lang = session.userLanguage;
          const keywords = switchKeywords[lang] ?? switchKeywords.en;
          const textLower = filteredTranscript.toLowerCase();
          const hasTransferKeyword = keywords.some(kw => textLower.includes(kw));
          const nonActivePersonaMentioned = nonActivePersonas.some(p =>
            filteredTranscript.includes(p.name) ||
            (p.position && filteredTranscript.includes(p.position))
          );
          if (hasTransferKeyword && nonActivePersonaMentioned) {
            console.log(`📢 [Voice] Persona switch announcement detected — awaiting user consent`);
            session.awaitingPersonaSwitch = true;
            sendToClient(session, {
              type: 'persona.switch_announced',
              announcingPersonaName: session.personaName,
            });
          }
        }

        if (filteredTranscript) {
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
        } else if (session.hasReceivedFirstAIAudio) {
          // currentTranscript was non-empty but filterThinkingText stripped it entirely
          // (e.g. all outputTranscription text was reasoning/thinking with no target-language chars).
          // Must still send ai.transcription.done so isWaitingForGreeting is cleared and
          // the mic/text input becomes visible.
          console.log(`⚠️ [turnComplete] Transcript filtered to empty — sending empty ai.transcription.done to unblock UI`);
          sendToClient(session, {
            type: 'ai.transcription.done',
            text: '',
            emotion: '중립',
            emotionReason: '',
          });
        }
        session.currentTranscript = '';
      } else if (session.hasReceivedFirstAIAudio) {
        // Audio arrived this turn but currentTranscript is empty — the model did not produce
        // any text/transcription (e.g. gemini-3.1-flash-live-preview in pure audio-to-audio mode
        // may omit outputTranscription and modelTurn text for some turns).
        // Send an empty ai.transcription.done so the client can:
        //   1. Clear isWaitingForGreeting → mic+text input becomes visible
        //   2. Mark conversation as started
        // No message is added to conversation history since text is empty.
        console.log(`⚠️ [turnComplete] Audio received but no transcript — sending empty ai.transcription.done to unblock UI`);
        sendToClient(session, {
          type: 'ai.transcription.done',
          text: '',
          emotion: '중립',
          emotionReason: '',
        });
      }
    }

  }
}
