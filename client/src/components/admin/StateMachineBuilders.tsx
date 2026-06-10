import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea';
import { Plus, Trash2, ChevronDown, ChevronUp, Code2, ArrowUp, ArrowDown } from 'lucide-react';
import type {
  FlowGraph, PersonaSwitchRules, TerminationRules,
  FlowStage, ExitCondition, SwitchRule, SwitchCondition, TerminationConditionGroup,
  EvaluationHarness, EvaluationDimensionKey,
} from '@shared/schema/scenarios';
import { flowGraphSchema, personaSwitchRulesSchema, terminationRulesSchema, evaluationHarnessSchema } from '@shared/schema/scenarios';

const OPERATORS = ['gte', 'lte', 'gt', 'lt', 'eq'] as const;
const OPERATOR_LABELS: Record<string, string> = { gte: '≥', lte: '≤', gt: '>', lt: '<', eq: '=' };

function uid() { return Math.random().toString(36).slice(2, 9); }

// ─── Shared Raw JSON Panel ────────────────────────────────────────────────────
interface RawJsonPanelProps {
  value: unknown;
  onImport?: (raw: unknown) => void;
}

function RawJsonPanel({ value, onImport }: RawJsonPanelProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rawText, setRawText] = useState('');
  const [importError, setImportError] = useState('');

  const prettyJson = useMemo(() => {
    if (value === null || value === undefined) return '(비어 있음)';
    try { return JSON.stringify(value, null, 2); } catch { return ''; }
  }, [value]);

  function handleStartEdit() {
    setRawText(value !== null && value !== undefined ? JSON.stringify(value, null, 2) : '');
    setImportError('');
    setEditing(true);
  }

  function handleImport() {
    if (!rawText.trim()) {
      onImport?.(null);
      setEditing(false);
      return;
    }
    try {
      const parsed = JSON.parse(rawText);
      onImport?.(parsed);
      setEditing(false);
      setImportError('');
    } catch {
      setImportError('JSON 구문 오류 — 형식을 확인하세요.');
    }
  }

  return (
    <div className="mt-3 border border-slate-200 rounded-md">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setEditing(false); setImportError(''); }}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 rounded-md transition-colors"
      >
        <span className="flex items-center gap-1.5"><Code2 className="h-3.5 w-3.5" /> Raw JSON 보기/편집</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="border-t border-slate-200 p-3 space-y-2">
          {!editing ? (
            <>
              <pre className="bg-slate-50 rounded p-2 text-xs font-mono overflow-auto max-h-40 whitespace-pre-wrap text-slate-700">{prettyJson}</pre>
              {onImport && (
                <Button type="button" variant="outline" size="sm" className="text-xs h-7" onClick={handleStartEdit}>
                  Raw JSON으로 편집
                </Button>
              )}
            </>
          ) : (
            <>
              <Textarea
                value={rawText}
                onChange={e => { setRawText(e.target.value); setImportError(''); }}
                rows={8}
                className="font-mono text-xs bg-white"
                placeholder="JSON 직접 입력..."
              />
              {importError && <p className="text-xs text-red-500">{importError}</p>}
              <div className="flex gap-2">
                <Button type="button" size="sm" className="text-xs h-7" onClick={handleImport}>적용</Button>
                <Button type="button" variant="outline" size="sm" className="text-xs h-7" onClick={() => { setEditing(false); setImportError(''); }}>취소</Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── FlowGraphBuilder ────────────────────────────────────────────────────────

interface ExitCondRow {
  _id: string;
  type: 'turn_count' | 'turn_score' | 'npc_emotion';
  metric: string;
  operator: string;
  value: string;
  windowTurns: string;
}

interface FlowStageRow {
  _id: string;
  id: string;
  goal: string;
  exitConditions: ExitCondRow[];
  exitConditionsLogic: 'all' | 'any';
  nextStage: string;
}

function flowGraphToRows(fg: FlowGraph | null): FlowStageRow[] {
  if (!fg) return [];
  return fg.stages.map(s => ({
    _id: uid(),
    id: s.id,
    goal: s.goal,
    exitConditionsLogic: s.exitConditionsLogic ?? 'all',
    nextStage: s.nextStage,
    exitConditions: (s.exitConditions ?? []).map(ec => ({
      _id: uid(),
      type: ec.type,
      metric: ec.metric ?? '',
      operator: ec.operator,
      value: String(ec.value),
      windowTurns: ec.windowTurns !== undefined ? String(ec.windowTurns) : '',
    })),
  }));
}

function rowsToFlowGraph(rows: FlowStageRow[]): FlowGraph | null {
  if (rows.length === 0) return null;
  const stages: FlowStage[] = rows.map(r => ({
    id: r.id.trim() || r._id,
    goal: r.goal,
    exitConditionsLogic: r.exitConditionsLogic,
    nextStage: r.nextStage,
    exitConditions: r.exitConditions.map(ec => {
      const cond: ExitCondition = {
        type: ec.type,
        operator: ec.operator as any,
        value: parseFloat(ec.value) || 0,
      };
      if (ec.metric) cond.metric = ec.metric;
      const wt = parseInt(ec.windowTurns);
      if (!isNaN(wt) && wt > 0) cond.windowTurns = wt;
      return cond;
    }),
  }));
  return { stages };
}

function newExitCondRow(): ExitCondRow {
  return { _id: uid(), type: 'turn_count', metric: '', operator: 'gte', value: '3', windowTurns: '' };
}

function newStageRow(): FlowStageRow {
  return { _id: uid(), id: '', goal: '', exitConditions: [newExitCondRow()], exitConditionsLogic: 'all', nextStage: '' };
}

interface FlowGraphBuilderProps {
  defaultValue: FlowGraph | null;
  onChange: (value: FlowGraph | null) => void;
}

export function FlowGraphBuilder({ defaultValue, onChange }: FlowGraphBuilderProps) {
  const [stages, setStages] = useState<FlowStageRow[]>(() => flowGraphToRows(defaultValue));

  function update(newStages: FlowStageRow[]) {
    setStages(newStages);
    onChange(rowsToFlowGraph(newStages));
  }

  function addStage() { update([...stages, newStageRow()]); }

  function removeStage(idx: number) {
    update(stages.filter((_, i) => i !== idx));
  }

  function moveStage(idx: number, dir: -1 | 1) {
    const next = [...stages];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    update(next);
  }

  function updateStage(idx: number, patch: Partial<FlowStageRow>) {
    const next = stages.map((s, i) => i === idx ? { ...s, ...patch } : s);
    update(next);
  }

  function addCond(stageIdx: number) {
    const next = stages.map((s, i) => i === stageIdx ? { ...s, exitConditions: [...s.exitConditions, newExitCondRow()] } : s);
    update(next);
  }

  function removeCond(stageIdx: number, condIdx: number) {
    const next = stages.map((s, i) => i === stageIdx
      ? { ...s, exitConditions: s.exitConditions.filter((_, j) => j !== condIdx) }
      : s
    );
    update(next);
  }

  function updateCond(stageIdx: number, condIdx: number, patch: Partial<ExitCondRow>) {
    const next = stages.map((s, i) => i === stageIdx
      ? { ...s, exitConditions: s.exitConditions.map((c, j) => j === condIdx ? { ...c, ...patch } : c) }
      : s
    );
    update(next);
  }

  function handleImport(raw: unknown) {
    if (raw === null || raw === undefined) {
      update([]);
      return;
    }
    const result = flowGraphSchema.safeParse(raw);
    if (result.success) {
      update(flowGraphToRows(result.data));
    }
  }

  const stageIds = stages.map(s => s.id.trim()).filter(Boolean);

  return (
    <div className="space-y-3">
      {stages.length === 0 && (
        <p className="text-xs text-slate-400 italic">스테이지 없음 — 아래 버튼으로 추가하세요.</p>
      )}

      {stages.map((stage, si) => (
        <div key={stage._id} className="border border-slate-200 rounded-lg bg-slate-50 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600">스테이지 {si + 1}</span>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700" onClick={() => moveStage(si, -1)} disabled={si === 0} title="위로">
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700" onClick={() => moveStage(si, 1)} disabled={si === stages.length - 1} title="아래로">
                <ArrowDown className="h-3 w-3" />
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-600" onClick={() => removeStage(si)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-slate-600 mb-0.5 block">스테이지 ID</Label>
              <Input
                value={stage.id}
                onChange={e => updateStage(si, { id: e.target.value })}
                placeholder="intro, conflict, resolution…"
                className="h-7 text-xs bg-white"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-600 mb-0.5 block">다음 스테이지</Label>
              {stageIds.length > 1 ? (
                <Select value={stage.nextStage} onValueChange={v => updateStage(si, { nextStage: v })}>
                  <SelectTrigger className="h-7 text-xs bg-white">
                    <SelectValue placeholder="선택..." />
                  </SelectTrigger>
                  <SelectContent>
                    {stageIds.filter(id => id !== stage.id.trim()).map(id => (
                      <SelectItem key={id} value={id}>{id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={stage.nextStage}
                  onChange={e => updateStage(si, { nextStage: e.target.value })}
                  placeholder="다음 스테이지 ID"
                  className="h-7 text-xs bg-white"
                />
              )}
            </div>
          </div>

          <div>
            <Label className="text-xs text-slate-600 mb-0.5 block">목표 설명</Label>
            <Input
              value={stage.goal}
              onChange={e => updateStage(si, { goal: e.target.value })}
              placeholder="이 단계에서 달성할 목표..."
              className="h-7 text-xs bg-white"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs text-slate-600">종료 조건</Label>
              {stage.exitConditions.length > 1 && (
                <Select value={stage.exitConditionsLogic} onValueChange={v => updateStage(si, { exitConditionsLogic: v as 'all' | 'any' })}>
                  <SelectTrigger className="h-6 text-xs w-24 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">모두 (AND)</SelectItem>
                    <SelectItem value="any">하나라도 (OR)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              {stage.exitConditions.map((cond, ci) => (
                <div key={cond._id} className="flex items-center gap-1.5 flex-wrap bg-white border border-slate-200 rounded px-2 py-1.5">
                  <Select value={cond.type} onValueChange={v => updateCond(si, ci, { type: v as any, metric: '', windowTurns: '' })}>
                    <SelectTrigger className="h-6 text-xs w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="turn_count">턴 수</SelectItem>
                      <SelectItem value="turn_score">점수</SelectItem>
                      <SelectItem value="npc_emotion">NPC 감정</SelectItem>
                    </SelectContent>
                  </Select>

                  {cond.type === 'turn_score' && (
                    <Select value={cond.metric || 'total'} onValueChange={v => updateCond(si, ci, { metric: v })}>
                      <SelectTrigger className="h-6 text-xs w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {['total', 'clarity', 'empathy', 'logic', 'ownership', 'actionPlan'].map(m => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {cond.type === 'npc_emotion' && (
                    <Select value={cond.metric || 'anger'} onValueChange={v => updateCond(si, ci, { metric: v })}>
                      <SelectTrigger className="h-6 text-xs w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {['anger', 'trust', 'confusion', 'interest'].map(m => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <Select value={cond.operator} onValueChange={v => updateCond(si, ci, { operator: v })}>
                    <SelectTrigger className="h-6 text-xs w-14">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map(op => <SelectItem key={op} value={op}>{OPERATOR_LABELS[op]}</SelectItem>)}
                    </SelectContent>
                  </Select>

                  <Input
                    type="number"
                    value={cond.value}
                    onChange={e => updateCond(si, ci, { value: e.target.value })}
                    className="h-6 text-xs w-14 bg-white"
                  />

                  {cond.type === 'turn_score' && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400">윈도우</span>
                      <Input
                        type="number"
                        value={cond.windowTurns}
                        onChange={e => updateCond(si, ci, { windowTurns: e.target.value })}
                        placeholder="전체"
                        className="h-6 text-xs w-14 bg-white"
                      />
                    </div>
                  )}

                  <button type="button" onClick={() => removeCond(si, ci)} className="ml-auto text-red-400 hover:text-red-600 flex-shrink-0">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-6 text-xs mt-1 text-slate-500" onClick={() => addCond(si)}>
              <Plus className="h-3 w-3 mr-1" /> 조건 추가
            </Button>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" className="text-xs" onClick={addStage}>
        <Plus className="h-3.5 w-3.5 mr-1" /> 스테이지 추가
      </Button>

      <RawJsonPanel value={rowsToFlowGraph(stages)} onImport={handleImport} />
    </div>
  );
}

// ─── TerminationRulesBuilder ──────────────────────────────────────────────────

type TermCondType = 'npcEmotion' | 'currentScore' | 'stage' | 'totalTurns' | 'consecutiveTurnsBelow';

interface TermCondRow {
  _id: string;
  condType: TermCondType;
  emotion: string;
  operator: string;
  value: string;
  stage: string;
  scoreThreshold: string;
  turns: string;
}

interface TermFormState {
  successEnabled: boolean;
  successConditions: TermCondRow[];
  successLogic: 'all' | 'any';
  failureEnabled: boolean;
  failureConditions: TermCondRow[];
  failureLogic: 'all' | 'any';
  timeoutEnabled: boolean;
  maxTurns: string;
  maxTimeSec: string;
}

function newTermCondRow(condType: TermCondType = 'totalTurns'): TermCondRow {
  return { _id: uid(), condType, emotion: 'anger', operator: 'gte', value: '70', stage: '', scoreThreshold: '40', turns: '3' };
}

function termGroupToRows(group: TerminationConditionGroup | undefined): TermCondRow[] {
  if (!group) return [];
  const rows: TermCondRow[] = [];
  if (group.npcEmotions) {
    for (const [emotion, cond] of Object.entries(group.npcEmotions)) {
      if (cond) rows.push({ _id: uid(), condType: 'npcEmotion', emotion, operator: cond.operator, value: String(cond.value), stage: '', scoreThreshold: '40', turns: '3' });
    }
  }
  if (group.currentScore) {
    rows.push({ _id: uid(), condType: 'currentScore', emotion: 'anger', operator: group.currentScore.operator, value: String(group.currentScore.value), stage: '', scoreThreshold: '40', turns: '3' });
  }
  if (group.stage) {
    rows.push({ _id: uid(), condType: 'stage', emotion: 'anger', operator: 'eq', value: '0', stage: group.stage, scoreThreshold: '40', turns: '3' });
  }
  if (group.totalTurns) {
    rows.push({ _id: uid(), condType: 'totalTurns', emotion: 'anger', operator: group.totalTurns.operator, value: String(group.totalTurns.value), stage: '', scoreThreshold: '40', turns: '3' });
  }
  if (group.consecutiveTurnsBelow) {
    rows.push({ _id: uid(), condType: 'consecutiveTurnsBelow', emotion: 'anger', operator: 'lt', value: '0', stage: '', scoreThreshold: String(group.consecutiveTurnsBelow.scoreThreshold), turns: String(group.consecutiveTurnsBelow.turns) });
  }
  return rows;
}

function rowsToTermGroup(rows: TermCondRow[], logic: 'all' | 'any'): TerminationConditionGroup | undefined {
  if (rows.length === 0) return undefined;
  const group: TerminationConditionGroup = { logic };
  for (const row of rows) {
    if (row.condType === 'npcEmotion') {
      if (!group.npcEmotions) group.npcEmotions = {};
      (group.npcEmotions as any)[row.emotion] = { operator: row.operator as any, value: parseFloat(row.value) || 0 };
    } else if (row.condType === 'currentScore') {
      group.currentScore = { operator: row.operator as any, value: parseFloat(row.value) || 0 };
    } else if (row.condType === 'stage') {
      group.stage = row.stage;
    } else if (row.condType === 'totalTurns') {
      group.totalTurns = { operator: row.operator as any, value: parseFloat(row.value) || 0 };
    } else if (row.condType === 'consecutiveTurnsBelow') {
      group.consecutiveTurnsBelow = { scoreThreshold: parseFloat(row.scoreThreshold) || 0, turns: parseInt(row.turns) || 1 };
    }
  }
  return group;
}

function terminationRulesToForm(tr: TerminationRules | null): TermFormState {
  if (!tr) {
    return {
      successEnabled: false, successConditions: [], successLogic: 'all',
      failureEnabled: false, failureConditions: [], failureLogic: 'all',
      timeoutEnabled: false, maxTurns: '', maxTimeSec: '',
    };
  }
  return {
    successEnabled: tr.success !== undefined,
    successConditions: termGroupToRows(tr.success),
    successLogic: tr.success?.logic ?? 'all',
    failureEnabled: tr.failure !== undefined,
    failureConditions: termGroupToRows(tr.failure),
    failureLogic: tr.failure?.logic ?? 'all',
    timeoutEnabled: tr.timeout !== undefined,
    maxTurns: tr.timeout?.maxTurns !== undefined ? String(tr.timeout.maxTurns) : '',
    maxTimeSec: tr.timeout?.maxTimeSec !== undefined ? String(tr.timeout.maxTimeSec) : '',
  };
}

function formToTerminationRules(form: TermFormState): TerminationRules | null {
  const rules: TerminationRules = {};
  if (form.successEnabled) {
    const g = rowsToTermGroup(form.successConditions, form.successLogic);
    if (g) rules.success = g;
  }
  if (form.failureEnabled) {
    const g = rowsToTermGroup(form.failureConditions, form.failureLogic);
    if (g) rules.failure = g;
  }
  if (form.timeoutEnabled) {
    const mt = parseInt(form.maxTurns);
    const ms = parseFloat(form.maxTimeSec);
    if (!isNaN(mt) && mt > 0) {
      rules.timeout = { maxTurns: mt };
    }
    if (!isNaN(ms) && ms > 0) {
      rules.timeout = { ...(rules.timeout ?? {}), maxTimeSec: ms };
    }
    if (!rules.timeout) rules.timeout = {};
  }
  if (!rules.success && !rules.failure && !rules.timeout) return null;
  return rules;
}

interface ConditionRowEditorProps {
  row: TermCondRow;
  onChange: (patch: Partial<TermCondRow>) => void;
  onRemove: () => void;
}

function TermCondRowEditor({ row, onChange, onRemove }: ConditionRowEditorProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap bg-white border border-slate-200 rounded px-2 py-1.5">
      <Select value={row.condType} onValueChange={v => onChange({ condType: v as TermCondType })}>
        <SelectTrigger className="h-6 text-xs w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="npcEmotion">NPC 감정</SelectItem>
          <SelectItem value="currentScore">현재 점수</SelectItem>
          <SelectItem value="stage">스테이지</SelectItem>
          <SelectItem value="totalTurns">총 턴 수</SelectItem>
          <SelectItem value="consecutiveTurnsBelow">연속 저점 턴</SelectItem>
        </SelectContent>
      </Select>

      {row.condType === 'npcEmotion' && (
        <Select value={row.emotion} onValueChange={v => onChange({ emotion: v })}>
          <SelectTrigger className="h-6 text-xs w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['anger', 'trust', 'confusion', 'interest'].map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {row.condType === 'stage' ? (
        <Input value={row.stage} onChange={e => onChange({ stage: e.target.value })} placeholder="스테이지 ID" className="h-6 text-xs w-28 bg-white" />
      ) : row.condType === 'consecutiveTurnsBelow' ? (
        <>
          <span className="text-xs text-slate-500">점수 임계값</span>
          <Input type="number" value={row.scoreThreshold} onChange={e => onChange({ scoreThreshold: e.target.value })} className="h-6 text-xs w-14 bg-white" />
          <span className="text-xs text-slate-500">연속</span>
          <Input type="number" value={row.turns} onChange={e => onChange({ turns: e.target.value })} className="h-6 text-xs w-12 bg-white" />
          <span className="text-xs text-slate-500">턴</span>
        </>
      ) : (
        <>
          <Select value={row.operator} onValueChange={v => onChange({ operator: v })}>
            <SelectTrigger className="h-6 text-xs w-14">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map(op => <SelectItem key={op} value={op}>{OPERATOR_LABELS[op]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="number" value={row.value} onChange={e => onChange({ value: e.target.value })} className="h-6 text-xs w-14 bg-white" />
        </>
      )}

      <button type="button" onClick={onRemove} className="ml-auto text-red-400 hover:text-red-600">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

interface SectionBuilderProps {
  label: string;
  color: string;
  enabled: boolean;
  onToggleEnabled: (v: boolean) => void;
  conditions: TermCondRow[];
  logic: 'all' | 'any';
  onLogicChange: (v: 'all' | 'any') => void;
  onAddCond: (type: TermCondType) => void;
  onUpdateCond: (idx: number, patch: Partial<TermCondRow>) => void;
  onRemoveCond: (idx: number) => void;
}

function TermSectionBuilder({ label, color, enabled, onToggleEnabled, conditions, logic, onLogicChange, onAddCond, onUpdateCond, onRemoveCond }: SectionBuilderProps) {
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${color}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <Switch checked={enabled} onCheckedChange={onToggleEnabled} />
      </div>
      {enabled && (
        <>
          {conditions.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">조건 결합:</span>
              <Select value={logic} onValueChange={v => onLogicChange(v as 'all' | 'any')}>
                <SelectTrigger className="h-6 text-xs w-28 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">모두 만족 (AND)</SelectItem>
                  <SelectItem value="any">하나라도 (OR)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            {conditions.map((c, i) => (
              <TermCondRowEditor key={c._id} row={c} onChange={p => onUpdateCond(i, p)} onRemove={() => onRemoveCond(i)} />
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-6 text-xs text-slate-500" onClick={() => onAddCond('totalTurns')}>
            <Plus className="h-3 w-3 mr-1" /> 조건 추가
          </Button>
        </>
      )}
    </div>
  );
}

function TerminationRulesSummary({ value }: { value: TerminationRules | null }) {
  if (!value) return null;
  const hasSuccess = value.success != null && Object.keys(value.success).length > 0;
  const hasFailure = value.failure != null && Object.keys(value.failure).length > 0;
  const hasTimeout = value.timeout != null && (value.timeout.maxTurns != null || value.timeout.maxTimeSec != null);
  if (!hasSuccess && !hasFailure && !hasTimeout) return null;

  function groupBadges(group: TerminationConditionGroup, color: string) {
    const items: string[] = [];
    if (group.npcEmotions) {
      for (const [em, cond] of Object.entries(group.npcEmotions)) {
        if (cond) items.push(`${em} ${OPERATOR_LABELS[cond.operator] ?? cond.operator} ${cond.value}`);
      }
    }
    if (group.currentScore) items.push(`점수 ${OPERATOR_LABELS[group.currentScore.operator] ?? group.currentScore.operator} ${group.currentScore.value}`);
    if (group.totalTurns) items.push(`턴 ${OPERATOR_LABELS[group.totalTurns.operator] ?? group.totalTurns.operator} ${group.totalTurns.value}`);
    if (group.consecutiveTurnsBelow) items.push(`연속저점 <${group.consecutiveTurnsBelow.scoreThreshold} × ${group.consecutiveTurnsBelow.turns}턴`);
    if (group.stage) items.push(`stage = ${group.stage}`);
    return items.map((item, i) => (
      <Badge key={i} variant="outline" className={`text-xs ${color}`}>{item}</Badge>
    ));
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 space-y-1.5">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">현재 설정 요약</p>
      {hasSuccess && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-emerald-700 font-medium">✓ 성공:</span>
          {groupBadges(value.success!, 'border-emerald-300 text-emerald-700')}
        </div>
      )}
      {hasFailure && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-red-700 font-medium">✗ 실패:</span>
          {groupBadges(value.failure!, 'border-red-300 text-red-700')}
        </div>
      )}
      {hasTimeout && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-amber-700 font-medium">⏱ 타임아웃:</span>
          {value.timeout!.maxTurns != null && (
            <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">최대 {value.timeout!.maxTurns}턴</Badge>
          )}
          {value.timeout!.maxTimeSec != null && (
            <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">최대 {value.timeout!.maxTimeSec}초</Badge>
          )}
        </div>
      )}
    </div>
  );
}

interface TerminationRulesBuilderProps {
  defaultValue: TerminationRules | null;
  onChange: (value: TerminationRules | null) => void;
}

export function TerminationRulesBuilder({ defaultValue, onChange }: TerminationRulesBuilderProps) {
  const [form, setForm] = useState<TermFormState>(() => terminationRulesToForm(defaultValue));

  function update(patch: Partial<TermFormState>) {
    const next = { ...form, ...patch };
    setForm(next);
    onChange(formToTerminationRules(next));
  }

  function updateSuccessCond(idx: number, patch: Partial<TermCondRow>) {
    update({ successConditions: form.successConditions.map((c, i) => i === idx ? { ...c, ...patch } : c) });
  }
  function updateFailureCond(idx: number, patch: Partial<TermCondRow>) {
    update({ failureConditions: form.failureConditions.map((c, i) => i === idx ? { ...c, ...patch } : c) });
  }

  function handleImport(raw: unknown) {
    if (raw === null || raw === undefined) {
      const next = terminationRulesToForm(null);
      setForm(next);
      onChange(null);
      return;
    }
    const result = terminationRulesSchema.safeParse(raw);
    if (result.success) {
      const next = terminationRulesToForm(result.data);
      setForm(next);
      onChange(result.data);
    }
  }

  const currentValue = formToTerminationRules(form);

  return (
    <div className="space-y-3">
      <TermSectionBuilder
        label="✓ 성공 조건"
        color="bg-emerald-50 border-emerald-200"
        enabled={form.successEnabled}
        onToggleEnabled={v => update({ successEnabled: v, successConditions: v && form.successConditions.length === 0 ? [newTermCondRow('totalTurns')] : form.successConditions })}
        conditions={form.successConditions}
        logic={form.successLogic}
        onLogicChange={v => update({ successLogic: v })}
        onAddCond={type => update({ successConditions: [...form.successConditions, newTermCondRow(type)] })}
        onUpdateCond={updateSuccessCond}
        onRemoveCond={idx => update({ successConditions: form.successConditions.filter((_, i) => i !== idx) })}
      />

      <TermSectionBuilder
        label="✗ 실패 조건"
        color="bg-red-50 border-red-200"
        enabled={form.failureEnabled}
        onToggleEnabled={v => update({ failureEnabled: v, failureConditions: v && form.failureConditions.length === 0 ? [newTermCondRow('consecutiveTurnsBelow')] : form.failureConditions })}
        conditions={form.failureConditions}
        logic={form.failureLogic}
        onLogicChange={v => update({ failureLogic: v })}
        onAddCond={type => update({ failureConditions: [...form.failureConditions, newTermCondRow(type)] })}
        onUpdateCond={updateFailureCond}
        onRemoveCond={idx => update({ failureConditions: form.failureConditions.filter((_, i) => i !== idx) })}
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">⏱ 타임아웃</span>
          <Switch checked={form.timeoutEnabled} onCheckedChange={v => update({ timeoutEnabled: v })} />
        </div>
        {form.timeoutEnabled && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-slate-600 whitespace-nowrap">최대 턴 수</Label>
              <Input
                type="number"
                value={form.maxTurns}
                onChange={e => update({ maxTurns: e.target.value })}
                placeholder="예: 10"
                className="h-7 text-xs w-20 bg-white"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-slate-600 whitespace-nowrap">최대 시간(초)</Label>
              <Input
                type="number"
                value={form.maxTimeSec}
                onChange={e => update({ maxTimeSec: e.target.value })}
                placeholder="예: 600"
                className="h-7 text-xs w-20 bg-white"
              />
            </div>
          </div>
        )}
      </div>

      <TerminationRulesSummary value={currentValue} />

      <RawJsonPanel value={currentValue} onImport={handleImport} />
    </div>
  );
}

// ─── PersonaSwitchRulesBuilder ────────────────────────────────────────────────

interface SwitchCondRow {
  _id: string;
  metric: string;
  operator: string;
  value: string;
  consecutiveTurns: string;
}

interface SwitchRuleRow {
  _id: string;
  id: string;
  targetPersonaIndex: number;
  conditions: SwitchCondRow[];
  reason: string;
  lockAfterSwitch: boolean;
}

const SWITCH_METRICS = [
  { value: 'npcEmotions.anger', label: 'NPC 분노' },
  { value: 'npcEmotions.trust', label: 'NPC 신뢰' },
  { value: 'npcEmotions.confusion', label: 'NPC 혼란' },
  { value: 'npcEmotions.interest', label: 'NPC 흥미' },
  { value: 'currentScore', label: '현재 점수' },
  { value: 'totalTurns', label: '총 턴 수' },
];

function newSwitchCondRow(): SwitchCondRow {
  return { _id: uid(), metric: 'npcEmotions.anger', operator: 'gte', value: '70', consecutiveTurns: '' };
}

function newSwitchRuleRow(personaCount: number): SwitchRuleRow {
  return {
    _id: uid(),
    id: `rule-${uid()}`,
    targetPersonaIndex: Math.min(1, personaCount - 1),
    conditions: [newSwitchCondRow()],
    reason: '',
    lockAfterSwitch: false,
  };
}

function personaSwitchRulesToRows(psr: PersonaSwitchRules | null): SwitchRuleRow[] {
  if (!psr) return [];
  return psr.rules.map(r => ({
    _id: uid(),
    id: r.id,
    targetPersonaIndex: r.targetPersonaIndex,
    conditions: r.conditions.map(c => ({
      _id: uid(),
      metric: c.metric,
      operator: c.operator,
      value: String(c.value),
      consecutiveTurns: c.consecutiveTurns !== undefined ? String(c.consecutiveTurns) : '',
    })),
    reason: r.reason,
    lockAfterSwitch: r.lockAfterSwitch ?? false,
  }));
}

function rowsToPersonaSwitchRules(rows: SwitchRuleRow[]): PersonaSwitchRules | null {
  if (rows.length === 0) return null;
  return {
    rules: rows.map(r => {
      const rule: SwitchRule = {
        id: r.id.trim() || r._id,
        targetPersonaIndex: r.targetPersonaIndex,
        conditions: r.conditions.map(c => {
          const sc: SwitchCondition = {
            metric: c.metric,
            operator: c.operator as any,
            value: parseFloat(c.value) || 0,
          };
          const ct = parseInt(c.consecutiveTurns);
          if (!isNaN(ct) && ct > 0) sc.consecutiveTurns = ct;
          return sc;
        }),
        reason: r.reason,
      };
      if (r.lockAfterSwitch) rule.lockAfterSwitch = true;
      return rule;
    }),
  };
}

interface PersonaSwitchRulesBuilderProps {
  defaultValue: PersonaSwitchRules | null;
  onChange: (value: PersonaSwitchRules | null) => void;
  personaCount?: number;
}

export function PersonaSwitchRulesBuilder({ defaultValue, onChange, personaCount = 2 }: PersonaSwitchRulesBuilderProps) {
  const [rules, setRules] = useState<SwitchRuleRow[]>(() => personaSwitchRulesToRows(defaultValue));

  function update(newRules: SwitchRuleRow[]) {
    setRules(newRules);
    onChange(rowsToPersonaSwitchRules(newRules));
  }

  function addRule() { update([...rules, newSwitchRuleRow(personaCount)]); }
  function removeRule(idx: number) { update(rules.filter((_, i) => i !== idx)); }

  function moveRule(idx: number, dir: -1 | 1) {
    const next = [...rules];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    update(next);
  }

  function updateRule(idx: number, patch: Partial<SwitchRuleRow>) {
    update(rules.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function addCond(ruleIdx: number) {
    update(rules.map((r, i) => i === ruleIdx ? { ...r, conditions: [...r.conditions, newSwitchCondRow()] } : r));
  }

  function removeCond(ruleIdx: number, condIdx: number) {
    update(rules.map((r, i) => i === ruleIdx ? { ...r, conditions: r.conditions.filter((_, j) => j !== condIdx) } : r));
  }

  function updateCond(ruleIdx: number, condIdx: number, patch: Partial<SwitchCondRow>) {
    update(rules.map((r, i) => i === ruleIdx
      ? { ...r, conditions: r.conditions.map((c, j) => j === condIdx ? { ...c, ...patch } : c) }
      : r
    ));
  }

  function handleImport(raw: unknown) {
    if (raw === null || raw === undefined) { update([]); return; }
    const result = personaSwitchRulesSchema.safeParse(raw);
    if (result.success) update(personaSwitchRulesToRows(result.data));
  }

  return (
    <div className="space-y-3">
      {rules.length === 0 && (
        <p className="text-xs text-slate-400 italic">규칙 없음 — 아래 버튼으로 추가하세요.</p>
      )}

      {rules.map((rule, ri) => (
        <div key={rule._id} className="border border-slate-200 rounded-lg bg-slate-50 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600">규칙 {ri + 1}</span>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700" onClick={() => moveRule(ri, -1)} disabled={ri === 0} title="위로">
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700" onClick={() => moveRule(ri, 1)} disabled={ri === rules.length - 1} title="아래로">
                <ArrowDown className="h-3 w-3" />
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-600" onClick={() => removeRule(ri)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-slate-600 mb-0.5 block">규칙 ID</Label>
              <Input
                value={rule.id}
                onChange={e => updateRule(ri, { id: e.target.value })}
                placeholder="rule-1"
                className="h-7 text-xs bg-white"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-600 mb-0.5 block">대상 페르소나 인덱스</Label>
              <Select value={String(rule.targetPersonaIndex)} onValueChange={v => updateRule(ri, { targetPersonaIndex: parseInt(v) })}>
                <SelectTrigger className="h-7 text-xs bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: personaCount }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>페르소나 {i + 1} (index {i})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs text-slate-600 mb-0.5 block">전환 이유</Label>
            <Input
              value={rule.reason}
              onChange={e => updateRule(ri, { reason: e.target.value })}
              placeholder="전환 발생 이유 설명..."
              className="h-7 text-xs bg-white"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={rule.lockAfterSwitch}
              onCheckedChange={v => updateRule(ri, { lockAfterSwitch: v })}
            />
            <Label className="text-xs text-slate-600">전환 후 잠금 (재전환 불가)</Label>
          </div>

          <div>
            <Label className="text-xs text-slate-600 mb-1.5 block">전환 조건</Label>
            <div className="space-y-1.5">
              {rule.conditions.map((cond, ci) => (
                <div key={cond._id} className="flex items-center gap-1.5 flex-wrap bg-white border border-slate-200 rounded px-2 py-1.5">
                  <Select value={cond.metric} onValueChange={v => updateCond(ri, ci, { metric: v })}>
                    <SelectTrigger className="h-6 text-xs w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SWITCH_METRICS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>

                  <Select value={cond.operator} onValueChange={v => updateCond(ri, ci, { operator: v })}>
                    <SelectTrigger className="h-6 text-xs w-14">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map(op => <SelectItem key={op} value={op}>{OPERATOR_LABELS[op]}</SelectItem>)}
                    </SelectContent>
                  </Select>

                  <Input
                    type="number"
                    value={cond.value}
                    onChange={e => updateCond(ri, ci, { value: e.target.value })}
                    className="h-6 text-xs w-14 bg-white"
                  />

                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-400">연속</span>
                    <Input
                      type="number"
                      value={cond.consecutiveTurns}
                      onChange={e => updateCond(ri, ci, { consecutiveTurns: e.target.value })}
                      placeholder="—"
                      className="h-6 text-xs w-12 bg-white"
                    />
                    <span className="text-xs text-slate-400">턴</span>
                  </div>

                  <button type="button" onClick={() => removeCond(ri, ci)} className="ml-auto text-red-400 hover:text-red-600">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-6 text-xs mt-1 text-slate-500" onClick={() => addCond(ri)}>
              <Plus className="h-3 w-3 mr-1" /> 조건 추가
            </Button>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" className="text-xs" onClick={addRule}>
        <Plus className="h-3.5 w-3.5 mr-1" /> 규칙 추가
      </Button>

      <RawJsonPanel value={rowsToPersonaSwitchRules(rules)} onImport={handleImport} />
    </div>
  );
}

// ─── EvaluationHarnessBuilder ─────────────────────────────────────────────────

const EVAL_DIMENSION_KEYS: EvaluationDimensionKey[] = ['clarity', 'empathy', 'logic', 'ownership', 'actionPlan'];
const EVAL_DIMENSION_LABELS: Record<EvaluationDimensionKey, string> = {
  clarity: '명확성 (Clarity)',
  empathy: '공감 (Empathy)',
  logic: '논리 (Logic)',
  ownership: '책임감 (Ownership)',
  actionPlan: '행동계획 (Action Plan)',
};

interface EvalDimRow {
  _id: string;
  key: EvaluationDimensionKey;
  weight: string;
  scenarioSpecificDefinition: string;
  positiveSignals: string;
  negativeSignals: string;
  expanded: boolean;
}

interface RequiredDimRow {
  _id: string;
  key: EvaluationDimensionKey;
  minScore: string;
}

interface EvalHarnessForm {
  dimensions: EvalDimRow[];
  passingRuleEnabled: boolean;
  minAverageScore: string;
  requiredDimensions: RequiredDimRow[];
}

function evalHarnessToForm(eh: EvaluationHarness | null): EvalHarnessForm {
  return {
    dimensions: (eh?.dimensions ?? []).map(d => ({
      _id: uid(),
      key: d.key,
      weight: String(d.weight),
      scenarioSpecificDefinition: d.scenarioSpecificDefinition ?? '',
      positiveSignals: (d.positiveSignals ?? []).join('\n'),
      negativeSignals: (d.negativeSignals ?? []).join('\n'),
      expanded: !!(d.scenarioSpecificDefinition || (d.positiveSignals?.length ?? 0) > 0 || (d.negativeSignals?.length ?? 0) > 0),
    })),
    passingRuleEnabled: !!eh?.passingRule,
    minAverageScore: String(eh?.passingRule?.minAverageScore ?? 60),
    requiredDimensions: (eh?.passingRule?.requiredDimensions ?? []).map(rd => ({
      _id: uid(),
      key: rd.key,
      minScore: String(rd.minScore),
    })),
  };
}

function formToEvalHarness(form: EvalHarnessForm): EvaluationHarness | null {
  const dimensions = form.dimensions.map(d => {
    const dim: EvaluationHarness['dimensions'] extends (infer T)[] | undefined ? T : never = {
      key: d.key,
      weight: parseFloat(d.weight) || 0,
    };
    if (d.scenarioSpecificDefinition.trim()) {
      (dim as any).scenarioSpecificDefinition = d.scenarioSpecificDefinition.trim();
    }
    const pos = d.positiveSignals.split('\n').map(s => s.trim()).filter(Boolean);
    if (pos.length > 0) (dim as any).positiveSignals = pos;
    const neg = d.negativeSignals.split('\n').map(s => s.trim()).filter(Boolean);
    if (neg.length > 0) (dim as any).negativeSignals = neg;
    return dim as any;
  });

  const passingRule = form.passingRuleEnabled ? (() => {
    const pr: any = { minAverageScore: parseFloat(form.minAverageScore) || 0 };
    const rds = form.requiredDimensions
      .filter(rd => rd.key)
      .map(rd => ({ key: rd.key, minScore: parseFloat(rd.minScore) || 0 }));
    if (rds.length > 0) pr.requiredDimensions = rds;
    return pr;
  })() : undefined;

  if (dimensions.length === 0 && !passingRule) return null;
  const result: EvaluationHarness = {};
  if (dimensions.length > 0) result.dimensions = dimensions;
  if (passingRule) result.passingRule = passingRule;
  return result;
}

function newDimRow(): EvalDimRow {
  return { _id: uid(), key: 'clarity', weight: '1', scenarioSpecificDefinition: '', positiveSignals: '', negativeSignals: '', expanded: false };
}

function newRequiredDimRow(): RequiredDimRow {
  return { _id: uid(), key: 'clarity', minScore: '60' };
}

interface EvaluationHarnessBuilderProps {
  defaultValue: EvaluationHarness | null;
  onChange: (value: EvaluationHarness | null) => void;
  readOnly?: boolean;
}

export function EvaluationHarnessBuilder({ defaultValue, onChange, readOnly }: EvaluationHarnessBuilderProps) {
  const [form, setForm] = useState<EvalHarnessForm>(() => evalHarnessToForm(defaultValue));

  function update(next: EvalHarnessForm) {
    setForm(next);
    onChange(formToEvalHarness(next));
  }

  function updateDim(idx: number, patch: Partial<EvalDimRow>) {
    const next: EvalHarnessForm = { ...form, dimensions: form.dimensions.map((d, i) => i === idx ? { ...d, ...patch } : d) };
    update(next);
  }

  function addDim() {
    update({ ...form, dimensions: [...form.dimensions, newDimRow()] });
  }

  function removeDim(idx: number) {
    update({ ...form, dimensions: form.dimensions.filter((_, i) => i !== idx) });
  }

  function moveDim(idx: number, dir: -1 | 1) {
    const next = [...form.dimensions];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    update({ ...form, dimensions: next });
  }

  function updatePassingRule(patch: Partial<Pick<EvalHarnessForm, 'passingRuleEnabled' | 'minAverageScore'>>) {
    update({ ...form, ...patch });
  }

  function updateReqDim(idx: number, patch: Partial<RequiredDimRow>) {
    const next = form.requiredDimensions.map((rd, i) => i === idx ? { ...rd, ...patch } : rd);
    update({ ...form, requiredDimensions: next });
  }

  function addReqDim() {
    update({ ...form, requiredDimensions: [...form.requiredDimensions, newRequiredDimRow()] });
  }

  function removeReqDim(idx: number) {
    update({ ...form, requiredDimensions: form.requiredDimensions.filter((_, i) => i !== idx) });
  }

  function handleImport(raw: unknown) {
    if (raw === null || raw === undefined) {
      update(evalHarnessToForm(null));
      return;
    }
    const result = evaluationHarnessSchema.safeParse(raw);
    if (result.success) {
      update(evalHarnessToForm(result.data));
    }
  }

  return (
    <div className="space-y-3">
      {/* Dimensions */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold text-slate-600 block">평가 차원 (Dimensions)</Label>
        {form.dimensions.length === 0 && (
          <p className="text-xs text-slate-400 italic">{readOnly ? '평가 차원 없음' : '평가 차원 없음 — 아래 버튼으로 추가하세요.'}</p>
        )}
        {form.dimensions.map((dim, di) => (
          <div key={dim._id} className="border border-slate-200 rounded-lg bg-slate-50 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">차원 {di + 1}</span>
              {!readOnly && (
                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700" onClick={() => moveDim(di, -1)} disabled={di === 0} title="위로">
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700" onClick={() => moveDim(di, 1)} disabled={di === form.dimensions.length - 1} title="아래로">
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-600" onClick={() => removeDim(di)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-slate-600 mb-0.5 block">항목 (Key)</Label>
                {readOnly ? (
                  <p className="text-xs bg-white border border-slate-200 rounded px-2 py-1">{EVAL_DIMENSION_LABELS[dim.key as EvaluationDimensionKey] ?? dim.key}</p>
                ) : (
                  <Select value={dim.key} onValueChange={v => updateDim(di, { key: v as EvaluationDimensionKey })}>
                    <SelectTrigger className="h-7 text-xs bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVAL_DIMENSION_KEYS.map(k => (
                        <SelectItem key={k} value={k}>{EVAL_DIMENSION_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <Label className="text-xs text-slate-600 mb-0.5 block">가중치 (Weight, 0–10)</Label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={dim.weight}
                  onChange={e => updateDim(di, { weight: e.target.value })}
                  className="h-7 text-xs bg-white"
                  readOnly={readOnly}
                  disabled={readOnly}
                />
              </div>
            </div>

            <div>
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                onClick={() => updateDim(di, { expanded: !dim.expanded })}
              >
                {dim.expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {dim.expanded ? '상세 숨기기' : '상세 신호 · 정의 보기'}
              </button>

              {dim.expanded && (
                <div className="mt-2 space-y-2 pl-2 border-l-2 border-slate-200">
                  <div>
                    <Label className="text-xs text-slate-600 mb-0.5 block">시나리오별 정의 (선택)</Label>
                    <Input
                      value={dim.scenarioSpecificDefinition}
                      onChange={e => updateDim(di, { scenarioSpecificDefinition: e.target.value })}
                      placeholder="이 시나리오에서의 구체적 정의..."
                      className="h-7 text-xs bg-white"
                      readOnly={readOnly}
                      disabled={readOnly}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-slate-600 mb-0.5 block">긍정 신호 (한 줄에 하나)</Label>
                      <AutoResizeTextarea
                        value={dim.positiveSignals}
                        onChange={e => updateDim(di, { positiveSignals: e.target.value })}
                        placeholder={"고객의 감정을 인정한다\n해결책을 제안한다"}
                        className="text-xs bg-white font-mono"
                        readOnly={readOnly}
                        disabled={readOnly}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-600 mb-0.5 block">부정 신호 (한 줄에 하나)</Label>
                      <AutoResizeTextarea
                        value={dim.negativeSignals}
                        onChange={e => updateDim(di, { negativeSignals: e.target.value })}
                        placeholder={"고객을 무시한다\n책임을 회피한다"}
                        className="text-xs bg-white font-mono"
                        readOnly={readOnly}
                        disabled={readOnly}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {!readOnly && (
          <Button type="button" variant="outline" size="sm" className="text-xs" onClick={addDim}>
            <Plus className="h-3.5 w-3.5 mr-1" /> 차원 추가
          </Button>
        )}
      </div>

      {/* Passing Rule */}
      <div className="border border-slate-200 rounded-lg bg-slate-50 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Switch
            checked={form.passingRuleEnabled}
            onCheckedChange={v => !readOnly && updatePassingRule({ passingRuleEnabled: v })}
            id="passing-rule-toggle"
            disabled={readOnly}
          />
          <Label htmlFor="passing-rule-toggle" className="text-xs font-semibold text-slate-600 cursor-pointer">
            통과 기준 (Passing Rule) 설정
          </Label>
        </div>

        {form.passingRuleEnabled && (
          <div className="space-y-2 pl-2 border-l-2 border-slate-200">
            <div>
              <Label className="text-xs text-slate-600 mb-0.5 block">최소 평균 점수 (0–100)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.minAverageScore}
                onChange={e => updatePassingRule({ minAverageScore: e.target.value })}
                className="h-7 text-xs bg-white w-28"
                readOnly={readOnly}
                disabled={readOnly}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs text-slate-600">필수 통과 차원 (선택)</Label>
                {!readOnly && (
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs text-slate-500" onClick={addReqDim}>
                    <Plus className="h-3 w-3 mr-1" /> 추가
                  </Button>
                )}
              </div>
              {form.requiredDimensions.length === 0 && (
                <p className="text-xs text-slate-400 italic">없음 (전체 평균만 적용)</p>
              )}
              <div className="space-y-1.5">
                {form.requiredDimensions.map((rd, ri) => (
                  <div key={rd._id} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded px-2 py-1.5">
                    {readOnly ? (
                      <span className="text-xs w-40">{EVAL_DIMENSION_LABELS[rd.key as EvaluationDimensionKey] ?? rd.key}</span>
                    ) : (
                      <Select value={rd.key} onValueChange={v => updateReqDim(ri, { key: v as EvaluationDimensionKey })}>
                        <SelectTrigger className="h-6 text-xs w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EVAL_DIMENSION_KEYS.map(k => (
                            <SelectItem key={k} value={k}>{EVAL_DIMENSION_LABELS[k]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <span className="text-xs text-slate-500">최소</span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={rd.minScore}
                      onChange={e => updateReqDim(ri, { minScore: e.target.value })}
                      className="h-6 text-xs w-16 bg-white"
                      readOnly={readOnly}
                      disabled={readOnly}
                    />
                    <span className="text-xs text-slate-400">점</span>
                    {!readOnly && (
                      <button type="button" onClick={() => removeReqDim(ri)} className="ml-auto text-red-400 hover:text-red-600">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {!readOnly && <RawJsonPanel value={formToEvalHarness(form)} onImport={handleImport} />}
    </div>
  );
}
