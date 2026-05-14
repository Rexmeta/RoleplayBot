import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

export interface NpcEmotions {
  anger: number;
  trust: number;
  confusion: number;
  interest: number;
}

export interface TurnScore {
  turnId: string;
  turnIndex: number;
  clarity: number;
  empathy: number;
  logic: number;
  ownership: number;
  actionPlan: number;
  total: number;
  hint?: string;
  evaluationMethod: 'llm' | 'rule' | 'hybrid';
  evaluationConfidence: number;
}

export interface Incident {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  turnIndex: number;
  triggeredBy: string;
  createdAt: string;
  resolved?: boolean;
}

export interface SimulationState {
  version: number;
  stage: 'intro' | 'conflict' | 'negotiation' | 'escalation' | 'resolution';
  pressureLevel: number;
  npcEmotions: NpcEmotions;
  timer: {
    enabled: boolean;
    timeLimitSec: number;
    startedAt: string | null;
    pausedAt: string | null;
    elapsedSec: number;
  };
  currentScore: number;
  recentTurnScores: TurnScore[];
  recentIncidents: Incident[];
  summary: {
    totalTurns: number;
    totalIncidents: number;
    averageScore: number;
    maxAnger: number;
    minTrust: number;
  };
}

export interface SimulationUpdate {
  type: 'simulation_update';
  personaRunId: string;
  eventType: string;
  currentState: SimulationState;
  incident?: Incident;
  turnScore?: TurnScore;
  version: number;
  timestamp: string;
}

const STORAGE_KEY_PREFIX = 'sim_state_v1_';

function loadLocalState(personaRunId: string): SimulationState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + personaRunId);
    if (!raw) return null;
    return JSON.parse(raw) as SimulationState;
  } catch {
    return null;
  }
}

function saveLocalState(personaRunId: string, state: SimulationState): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + personaRunId, JSON.stringify(state));
  } catch {}
}

interface UseSimulationStateOptions {
  personaRunId: string | null;
  enabled?: boolean;
  onIncident?: (incident: Incident) => void;
}

export function useSimulationState({ personaRunId, enabled = true, onIncident }: UseSimulationStateOptions) {
  const queryClient = useQueryClient();
  const [localState, setLocalState] = useState<SimulationState | null>(() => {
    if (!personaRunId) return null;
    return loadLocalState(personaRunId);
  });
  const [newIncident, setNewIncident] = useState<Incident | null>(null);
  const [latestTurnScore, setLatestTurnScore] = useState<TurnScore | null>(null);
  const incidentTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const seenIncidentIdsRef = useRef<Set<string>>(new Set());
  // Ref keeps latest localState accessible in applyUpdate without stale closure risk
  const localStateRef = useRef<SimulationState | null>(null);

  const { data: fetchedState, isLoading } = useQuery({
    queryKey: ['/api/simulation', personaRunId, 'state'],
    queryFn: async () => {
      if (!personaRunId) return null;
      const res = await fetch(`/api/simulation/${personaRunId}/state`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.state as SimulationState;
    },
    enabled: !!personaRunId && enabled,
    staleTime: 5000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    localStateRef.current = localState;
  }, [localState]);

  useEffect(() => {
    if (!fetchedState) return;
    setLocalState(prev => {
      if (prev && fetchedState.version <= prev.version) return prev;
      if (personaRunId) saveLocalState(personaRunId, fetchedState);
      return fetchedState;
    });
  }, [fetchedState, personaRunId]);

  const applyUpdate = useCallback((update: SimulationUpdate) => {
    // State update: only when currentState is present (incident-only events have no currentState)
    if (update.currentState) {
      setLocalState(prev => {
        if (prev && update.currentState.version <= prev.version) return prev;
        if (personaRunId) saveLocalState(personaRunId, update.currentState);
        return update.currentState;
      });
      if (personaRunId) {
        queryClient.setQueryData(['/api/simulation', personaRunId, 'state'], update.currentState);
      }
    }

    // Incident processing always runs — even for simulation.incident messages that
    // arrive without a currentState payload (e.g. server-rule fallback incidents).
    if (update.incident) {
      const incidentId = update.incident.id;
      // Use ref (not closed-over localState) to read the current version and totalTurns
      // without stale closure risk when applyUpdate is called in rapid succession
      const currentSnap = localStateRef.current;
      const incomingVersion = update.currentState?.version ?? -1;
      const isStaleVersion = !!currentSnap && incomingVersion <= currentSnap.version;
      const isUnseen = !seenIncidentIdsRef.current.has(incidentId);
      // Stale-version exception: show incident even if version is stale when ALL 3 conditions met:
      // 1. incident id is unseen
      // 2. incident.createdAt is within the last 10 seconds (fresh event)
      // 3. incident.turnIndex >= totalTurns - 1 (it's from the current or previous turn)
      const incidentAgeMs = Date.now() - new Date(update.incident.createdAt).getTime();
      const currentTotalTurns = currentSnap?.summary.totalTurns ?? 0;
      const incidentException = isStaleVersion && isUnseen &&
        incidentAgeMs <= 10000 &&
        update.incident.turnIndex >= currentTotalTurns - 1;
      // No currentState means incident came directly (rule-based); always show if unseen
      const noStateContext = !update.currentState;
      if (isUnseen && (noStateContext || !isStaleVersion || incidentException)) {
        seenIncidentIdsRef.current.add(incidentId);
        setNewIncident(update.incident);
        onIncident?.(update.incident);
        if (incidentTimeoutRef.current) clearTimeout(incidentTimeoutRef.current);
        incidentTimeoutRef.current = setTimeout(() => setNewIncident(null), 5000);
      }
    }

    if (update.turnScore) {
      setLatestTurnScore(update.turnScore);
    }
  }, [onIncident, queryClient, personaRunId]);

  const evaluateMutation = useMutation({
    mutationFn: async (params: { userText: string; aiText?: string; turnIndex?: number; language?: string }) => {
      if (!personaRunId) throw new Error('No personaRunId');
      const res = await apiRequest('POST', `/api/simulation/${personaRunId}/evaluate`, params);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.state) {
        setLocalState(prev => {
          if (prev && data.state.version <= prev.version) return prev;
          if (personaRunId) saveLocalState(personaRunId, data.state);
          return data.state;
        });
      }
      if (data.turnScore) setLatestTurnScore(data.turnScore);
      queryClient.invalidateQueries({ queryKey: ['/api/simulation', personaRunId, 'state'] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!personaRunId) throw new Error('No personaRunId');
      const res = await apiRequest('POST', `/api/simulation/${personaRunId}/state/reset`, {});
      return res.json();
    },
    onSuccess: (data) => {
      if (data.state) {
        setLocalState(data.state);
        if (personaRunId) saveLocalState(personaRunId, data.state);
      }
      setLatestTurnScore(null);
      setNewIncident(null);
      seenIncidentIdsRef.current.clear();
      queryClient.invalidateQueries({ queryKey: ['/api/simulation', personaRunId, 'state'] });
    },
  });

  useEffect(() => {
    return () => {
      if (incidentTimeoutRef.current) clearTimeout(incidentTimeoutRef.current);
    };
  }, []);

  return {
    state: localState,
    isLoading,
    newIncident,
    latestTurnScore,
    applyUpdate,
    evaluate: evaluateMutation.mutateAsync,
    isEvaluating: evaluateMutation.isPending,
    reset: resetMutation.mutateAsync,
    isResetting: resetMutation.isPending,
  };
}
