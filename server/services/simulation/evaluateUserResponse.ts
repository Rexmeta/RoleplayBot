import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import {
  TurnScore,
  SimulationState,
  calcTurnScoreTotal,
} from './simulationTypes';
import { inferEmotionPatchFromEvaluation } from './simulationRules';
import { buildSimulationStateBlock } from './simulationPrompt';

const EVAL_TIMEOUT_MS = 3000;

export interface EvaluationInput {
  personaRunId: string;
  turnId: string;
  turnIndex: number;
  userText: string;
  aiText: string;
  simulationState: SimulationState;
  language?: 'ko' | 'en' | 'ja' | 'zh';
  evaluationMode?: 'fast' | 'quality';
}

export interface EvaluationResult {
  turnScore: TurnScore;
  emotionDelta: Partial<Record<'anger' | 'trust' | 'confusion' | 'interest', number>>;
  skipped: boolean;
  method: 'llm' | 'rule' | 'skipped';
}

export async function evaluateUserResponse(input: EvaluationInput): Promise<EvaluationResult> {
  const { personaRunId, turnId, turnIndex, userText, simulationState, evaluationMode } = input;

  if (userText.trim().length < 10) {
    return {
      turnScore: makeSkipScore(turnId, turnIndex),
      emotionDelta: {},
      skipped: true,
      method: 'skipped',
    };
  }

  // Both fast and quality modes use LLM with timeout fallback.
  // Orchestration (parallel vs sequential) is handled by the caller.
  // fast: caller runs this concurrently with AI generation (non-blocking response)
  // quality: caller awaits this first, then injects [SIMULATION_STATE] into AI prompt
  try {
    const llmScore = await runLLMEvaluation(input);
    if (llmScore) {
      const emotionDelta = inferEmotionPatchFromEvaluation(llmScore, simulationState);
      return { turnScore: llmScore, emotionDelta, skipped: false, method: 'llm' };
    }
  } catch (err) {
    console.warn('[evaluateUserResponse] LLM evaluation failed, using rule-based fallback:', err);
  }

  const ruleScore = runRuleBasedEvaluation(input);
  const emotionDelta = inferEmotionPatchFromEvaluation(ruleScore, simulationState);
  return { turnScore: ruleScore, emotionDelta, skipped: false, method: 'rule' };
}

async function runLLMEvaluation(input: EvaluationInput): Promise<TurnScore | null> {
  const geminiApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!geminiApiKey) return null;

  const genAI = new GoogleGenAI({ apiKey: geminiApiKey });

  const prompt = buildEvaluationPrompt(input);

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('LLM evaluation timeout')), EVAL_TIMEOUT_MS)
    );
    const llmPromise = genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 512,
        temperature: 0.3,
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const response = await Promise.race([llmPromise, timeoutPromise]);

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    const data = JSON.parse(text);

    const clarity = clampScore(data.clarity ?? 50);
    const empathy = clampScore(data.empathy ?? 50);
    const logic = clampScore(data.logic ?? 50);
    const ownership = clampScore(data.ownership ?? 50);
    const actionPlan = clampScore(data.actionPlan ?? 50);
    const total = calcTurnScoreTotal({ clarity, empathy, logic, ownership, actionPlan });

    return {
      turnId: input.turnId,
      turnIndex: input.turnIndex,
      clarity,
      empathy,
      logic,
      ownership,
      actionPlan,
      total,
      hint: data.hint,
      evaluationMethod: 'llm',
      evaluationConfidence: clampScore(data.confidence ?? 70),
    };
  } catch (err) {
    throw err;
  }
}

function runRuleBasedEvaluation(input: EvaluationInput): TurnScore {
  const { userText, turnId, turnIndex } = input;
  const len = userText.trim().length;
  const words = userText.trim().split(/\s+/).length;

  let clarity = 50;
  let empathy = 50;
  let logic = 50;
  let ownership = 50;
  let actionPlan = 50;

  if (len >= 100) clarity += 10;
  if (len >= 200) clarity += 10;
  if (len < 30) clarity -= 20;

  const empathyKeywords = ['이해', '공감', '죄송', '알겠', 'understand', 'sorry', 'appreciate', '感謝', '理解'];
  if (empathyKeywords.some(k => userText.includes(k))) empathy += 15;

  const logicKeywords = ['왜냐하면', '때문에', '따라서', 'because', 'therefore', 'since', '그러므로'];
  if (logicKeywords.some(k => userText.includes(k))) logic += 15;

  const ownershipKeywords = ['제가', '저는', '책임', 'I will', 'I am', '저희가', '我'];
  if (ownershipKeywords.some(k => userText.includes(k))) ownership += 10;

  const actionKeywords = ['하겠습니다', '드리겠습니다', 'will do', 'I\'ll', '진행하', '방법', 'plan', '조치'];
  if (actionKeywords.some(k => userText.includes(k))) actionPlan += 15;

  clarity = clampScore(clarity);
  empathy = clampScore(empathy);
  logic = clampScore(logic);
  ownership = clampScore(ownership);
  actionPlan = clampScore(actionPlan);
  const total = calcTurnScoreTotal({ clarity, empathy, logic, ownership, actionPlan });

  return {
    turnId,
    turnIndex,
    clarity,
    empathy,
    logic,
    ownership,
    actionPlan,
    total,
    evaluationMethod: 'rule',
    evaluationConfidence: 50,
  };
}

function makeSkipScore(turnId: string, turnIndex: number): TurnScore {
  return {
    turnId,
    turnIndex,
    clarity: 0,
    empathy: 0,
    logic: 0,
    ownership: 0,
    actionPlan: 0,
    total: 0,
    evaluationMethod: 'rule',
    evaluationConfidence: 0,
  };
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function buildEvaluationPrompt(input: EvaluationInput): string {
  const { userText, simulationState, language } = input;
  const lang = language ?? 'ko';

  const stateBlock = buildSimulationStateBlock({
    stage: simulationState.stage,
    pressureLevel: simulationState.pressureLevel,
    npcEmotions: simulationState.npcEmotions,
    currentScore: simulationState.currentScore,
    recentTurnScores: simulationState.recentTurnScores.slice(-2),
  });

  const activeDirectives = (simulationState.simulationDirectives ?? [])
    .filter(d => !d.expiresAtTurnIndex || d.expiresAtTurnIndex > simulationState.summary.totalTurns);
  const directivesBlock = activeDirectives.length > 0
    ? `\nActive simulation directives:\n${activeDirectives.map(d => `- ${d.instruction}`).join('\n')}\n`
    : '';

  return `Evaluate this workplace conversation response on 5 dimensions (0-100 each):
1. clarity: How clear and organized is the communication?
2. empathy: How empathetic and understanding toward the other party?
3. logic: How logical and evidence-based is the reasoning?
4. ownership: How much does the speaker take responsibility?
5. actionPlan: How specific and actionable is the proposed solution?

${stateBlock}
${directivesBlock}
User response (language: ${lang}):
"""
${userText.substring(0, 500)}
"""

Respond ONLY with JSON:
{"clarity": 65, "empathy": 70, "logic": 55, "ownership": 60, "actionPlan": 45, "confidence": 80, "hint": "Brief tip to improve (in ${LANG_NAMES[lang] ?? 'English'})"}`;
}

const LANG_NAMES: Record<string, string> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
};
