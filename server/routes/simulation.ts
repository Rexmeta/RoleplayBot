import { Router } from "express";
import { storage } from "../storage";
import { asyncHandler, createHttpError, verifyPersonaRunOwnership } from "./routerHelpers";
import {
  getSessionState,
  setSessionState,
  applySimulationPatch,
  getOrCreateSessionContext,
} from "../services/simulation/simulationEngine";
import {
  createDefaultSimulationState,
  SimulationState,
  SimulationStatePatch,
} from "../services/simulation/simulationTypes";
import { evaluateUserResponse } from "../services/simulation/evaluateUserResponse";
import { buildRuleFallbackPatch, inferStagePatchFromState } from "../services/simulation/simulationRules";
import { v4 as uuidv4 } from "uuid";

export default function createSimulationRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/:personaRunId/state", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const { personaRunId } = req.params;

    const { personaRun } = await verifyPersonaRunOwnership(personaRunId, userId, req.user?.role);

    let state = getSessionState(personaRunId);
    let isNewState = false;

    if (!state) {
      const stored = await storage.getSimulationState(personaRunId);
      if (stored) {
        state = stored as unknown as SimulationState;
        setSessionState(personaRunId, state);
        storage.createSimulationEvent({
          personaRunId,
          scenarioRunId: personaRun?.scenarioRunId ?? null,
          turnIndex: state.summary.totalTurns,
          turnId: uuidv4(),
          eventType: 'state_restore',
          toolName: null,
          args: { version: state.version },
          result: null,
          stateBefore: null,
          stateAfter: state,
          stateVersionBefore: null,
          stateVersionAfter: state.version,
          includeInReport: false,
        }).catch(() => {});
      } else {
        state = createDefaultSimulationState();
        setSessionState(personaRunId, state);
        isNewState = true;
        await storage.saveSimulationState(personaRunId, state as unknown as Record<string, unknown>);
        storage.createSimulationEvent({
          personaRunId,
          scenarioRunId: personaRun?.scenarioRunId ?? null,
          turnIndex: 0,
          turnId: uuidv4(),
          eventType: 'state_init',
          toolName: null,
          args: {},
          result: null,
          stateBefore: null,
          stateAfter: state,
          stateVersionBefore: null,
          stateVersionAfter: state.version,
          includeInReport: false,
        }).catch(() => {});
      }
    }

    res.json({ state, personaRunId, isNewState });
  }));

  router.post("/:personaRunId/state/reset", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const { personaRunId } = req.params;

    await verifyPersonaRunOwnership(personaRunId, userId, req.user?.role);

    const freshState = createDefaultSimulationState();
    setSessionState(personaRunId, freshState);
    await storage.saveSimulationState(personaRunId, freshState as unknown as Record<string, unknown>);

    res.json({ success: true, state: freshState });
  }));

  router.post("/:personaRunId/evaluate", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const { personaRunId } = req.params;
    const { personaRun } = await verifyPersonaRunOwnership(personaRunId, userId, req.user?.role);

    const { userText, aiText, turnIndex, language } = req.body;

    if (typeof userText !== 'string' || userText.trim().length === 0) {
      throw createHttpError(400, "userText is required");
    }

    let state = getSessionState(personaRunId);
    if (!state) {
      const stored = await storage.getSimulationState(personaRunId);
      state = stored ? (stored as unknown as SimulationState) : createDefaultSimulationState();
      setSessionState(personaRunId, state);
    }

    const turnId = uuidv4();
    const turnIdx = turnIndex ?? (state.summary.totalTurns);
    const lang = (language ?? 'ko') as 'ko' | 'en' | 'ja' | 'zh';

    const evalResult = await evaluateUserResponse({
      personaRunId,
      turnId,
      turnIndex: turnIdx,
      userText,
      aiText: aiText ?? '',
      simulationState: state,
      language: lang,
    });

    let newState = applySimulationPatch(personaRunId, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId,
      patch: {
        turnScoresToAdd: [evalResult.turnScore],
        npcEmotionDelta: evalResult.emotionDelta,
      },
    });

    const rulePatch = buildRuleFallbackPatch(evalResult.turnScore, newState, 0);
    if (rulePatch) {
      newState = applySimulationPatch(personaRunId, {
        source: 'server_rule',
        priority: 'low',
        turnId,
        patch: rulePatch,
      });
    }

    const stageTransition = inferStagePatchFromState(newState);
    if (stageTransition) {
      newState = applySimulationPatch(personaRunId, {
        source: 'server_rule',
        priority: 'normal',
        turnId,
        patch: { targetStage: stageTransition },
      });
    }

    await storage.saveSimulationState(personaRunId, newState as unknown as Record<string, unknown>);

    try {
      await storage.createSimulationEvent({
        personaRunId,
        scenarioRunId: personaRun?.scenarioRunId ?? null,
        turnIndex: turnIdx,
        turnId,
        eventType: 'auto_evaluation',
        toolName: null,
        args: { userTextLength: userText.length, method: evalResult.method },
        result: { turnScore: evalResult.turnScore },
        stateBefore: state,
        stateAfter: newState,
        stateVersionBefore: state.version,
        stateVersionAfter: newState.version,
        includeInReport: true,
      });
    } catch (e) {
      console.warn('[simulation] Failed to log evaluation event:', e);
    }

    res.json({
      success: true,
      turnScore: evalResult.turnScore,
      method: evalResult.method,
      state: newState,
    });
  }));

  router.get("/:personaRunId/has-data", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const { personaRunId } = req.params;

    await verifyPersonaRunOwnership(personaRunId, userId, req.user?.role);

    const hasData = await storage.hasSimulationData(personaRunId);
    res.json({ hasData });
  }));

  router.get("/:personaRunId/events", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const { personaRunId } = req.params;

    await verifyPersonaRunOwnership(personaRunId, userId, req.user?.role);

    const events = await storage.getSimulationEventsByPersonaRun(personaRunId);
    const debug = {
      totalEvents: events.length,
      autoEvalSummary: events
        .filter(e => e.eventType === 'auto_evaluation')
        .map(e => ({
          turnIndex: e.turnIndex,
          evalMode: (e.args as Record<string, unknown> | null)?.evalMode ?? 'unknown',
          includeInReport: e.includeInReport,
          hasTurnScore: !!(e.result as Record<string, unknown> | null)?.turnScore,
          total: ((e.result as Record<string, unknown> | null)?.turnScore as Record<string, unknown> | null)?.total ?? null,
        })),
    };
    res.json({ events, debug });
  }));

  return router;
}
