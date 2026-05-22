import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import {
  TurnScore,
  SimulationState,
  calcTurnScoreTotal,
} from './simulationTypes';
import { inferEmotionPatchFromEvaluation, applyNpcBehaviorHarnessModifiers } from './simulationRules';
import { buildSimulationStateBlock } from './simulationPrompt';
import type { EvaluationHarness, EvaluationHarnessDimension, NpcBehaviorHarness } from '../../../shared/schema/scenarios';

const EVAL_TIMEOUT_MS = 8000;

export interface EvaluationInput {
  personaRunId: string;
  turnId: string;
  turnIndex: number;
  userText: string;
  aiText: string;
  simulationState: SimulationState;
  language?: 'ko' | 'en' | 'ja' | 'zh';
  evaluationMode?: 'fast' | 'quality';
  evaluationHarness?: EvaluationHarness | null;
  npcBehaviorHarness?: NpcBehaviorHarness | null;
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
      const baseDelta = inferEmotionPatchFromEvaluation(llmScore, simulationState);
      const emotionDelta = applyNpcBehaviorHarnessModifiers(baseDelta, input.npcBehaviorHarness, simulationState);
      return { turnScore: llmScore, emotionDelta, skipped: false, method: 'llm' };
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.warn('[evaluateUserResponse] LLM evaluation failed, using rule-based fallback', {
      personaRunId,
      turnIndex,
      evaluationMode: evaluationMode ?? 'fast',
      errorMessage: error.message,
      errorStack: error.stack,
    });
  }

  const ruleScore = runRuleBasedEvaluation(input);
  const baseDelta = inferEmotionPatchFromEvaluation(ruleScore, simulationState);
  const emotionDelta = applyNpcBehaviorHarnessModifiers(baseDelta, input.npcBehaviorHarness, simulationState);
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
    const total = calcWeightedTotal({ clarity, empathy, logic, ownership, actionPlan }, input.evaluationHarness);

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
  const text = userText.trim();
  const len = text.length;

  // Language-neutral heuristics
  const sentences = text.split(/[.!?。！？\n]+/).filter(s => s.trim().length > 2).length;
  const hasQuestion = /[?？]/.test(text);

  let clarity = 50;
  let empathy = 50;
  let logic = 50;
  let ownership = 50;
  let actionPlan = 50;

  // Clarity: based on length and structure
  if (len >= 200) clarity += 20;
  else if (len >= 100) clarity += 10;
  else if (len < 30) clarity -= 20;
  if (sentences >= 3) clarity += 5;
  if (hasQuestion) clarity += 5; // asking questions shows engagement

  // Empathy keywords (Korean, English, Japanese, Chinese)
  const empathyKeywords = [
    '이해', '공감', '죄송', '알겠', '감사', '고맙', '걱정', '힘드', '어렵',
    'understand', 'sorry', 'appreciate', 'empathize', 'concern', 'difficult',
    '感謝', '理解', 'ご迷惑', '申し訳',
  ];
  const empathyMatches = empathyKeywords.filter(k => text.includes(k)).length;
  empathy += empathyMatches * 12;

  // Logic keywords: causal/explanatory connectors
  const logicKeywords = [
    '왜냐하면', '때문에', '따라서', '그러므로', '이유는', '결과적으로', '즉', '다시 말해',
    'because', 'therefore', 'since', 'thus', 'as a result', 'due to', 'hence',
    'なぜなら', 'したがって', '因为', '所以',
  ];
  const logicMatches = logicKeywords.filter(k => text.includes(k)).length;
  logic += logicMatches * 12;
  if (sentences >= 2) logic += 5; // multiple sentences suggest structured reasoning

  // Ownership keywords: first-person responsibility
  const ownershipKeywords = [
    '제가', '저는', '저희가', '저희는', '책임', '담당', '맡',
    'I will', 'I am', 'I\'ll', 'my responsibility', 'I take',
    '私が', '私は', '我来', '我负责',
  ];
  const ownershipMatches = ownershipKeywords.filter(k => text.includes(k)).length;
  ownership += ownershipMatches * 12;

  // Action plan keywords: concrete next steps
  const actionKeywords = [
    '하겠습니다', '드리겠습니다', '진행하', '방법', '조치', '계획', '단계', '해결',
    '확인하', '검토하', '수정하', '개선',
    'will do', "I'll", 'plan', 'step', 'action', 'resolve', 'fix', 'implement', 'schedule',
    'します', '対応', '解決', '计划', '措施',
  ];
  const actionMatches = actionKeywords.filter(k => text.includes(k)).length;
  actionPlan += actionMatches * 10;
  if (len >= 150) actionPlan += 5; // longer responses tend to include more details

  clarity = clampScore(clarity);
  empathy = clampScore(empathy);
  logic = clampScore(logic);
  ownership = clampScore(ownership);
  actionPlan = clampScore(actionPlan);
  const total = calcWeightedTotal({ clarity, empathy, logic, ownership, actionPlan }, input.evaluationHarness);

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
    evaluationConfidence: 40,
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

function calcWeightedTotal(
  s: { clarity: number; empathy: number; logic: number; ownership: number; actionPlan: number },
  harness?: EvaluationHarness | null
): number {
  if (!harness?.dimensions || harness.dimensions.length === 0) {
    return calcTurnScoreTotal(s);
  }
  const dims = harness.dimensions;
  const totalWeight = dims.reduce((acc, d) => acc + d.weight, 0);
  if (totalWeight === 0) return calcTurnScoreTotal(s);
  const weighted = dims.reduce((acc, d) => {
    const score = (s as Record<string, number>)[d.key] ?? 50;
    return acc + score * d.weight;
  }, 0);
  return Math.round(weighted / totalWeight);
}

function buildHarnessBlock(harness: EvaluationHarness | null | undefined): string {
  if (!harness?.dimensions || harness.dimensions.length === 0) return '';
  const lines: string[] = ['\nScenario-specific evaluation guidance:'];
  for (const dim of harness.dimensions) {
    const parts: string[] = [`  ${dim.key} (weight=${dim.weight.toFixed(2)})`];
    if (dim.scenarioSpecificDefinition) parts.push(`    Definition: ${dim.scenarioSpecificDefinition}`);
    if (dim.positiveSignals?.length) parts.push(`    Positive signals: ${dim.positiveSignals.join(', ')}`);
    if (dim.negativeSignals?.length) parts.push(`    Negative signals (penalize): ${dim.negativeSignals.join(', ')}`);
    lines.push(parts.join('\n'));
  }
  return lines.join('\n') + '\n';
}

function buildEvaluationPrompt(input: EvaluationInput): string {
  const { userText, simulationState, language, evaluationHarness } = input;
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

  const harnessBlock = buildHarnessBlock(evaluationHarness);

  return `Evaluate this workplace conversation response on 5 dimensions (0-100 each):
1. clarity: How clear and organized is the communication?
2. empathy: How empathetic and understanding toward the other party?
3. logic: How logical and evidence-based is the reasoning?
4. ownership: How much does the speaker take responsibility?
5. actionPlan: How specific and actionable is the proposed solution?

${stateBlock}
${directivesBlock}${harnessBlock}
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
