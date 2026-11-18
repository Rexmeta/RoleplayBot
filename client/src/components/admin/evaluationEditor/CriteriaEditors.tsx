import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertCircle, Bot, ClipboardList, FileText, Gauge, ListChecks, MessagesSquare, Palette, Settings, Settings2, Sparkles } from "lucide-react";
import { FewShotLearningTab } from "../FewShotLearningTab";
import { ContentEditor, ContentEditorRegion, type EditorSectionDef } from "../contentEditor/ContentEditor";
import { EditorGroup, Field, FieldGrid, ToggleRow, AiGenerateButton } from "../contentEditor/EditorPrimitives";
import { AVAILABLE_ICONS, DIMENSION_TYPE_OPTIONS, RubricItemsEditor, getIconComponent, type ScoringRubric } from "./shared";

type Category = { id: string; name: string };

export type CriteriaSetFormData = {
  name: string; description: string; isDefault: boolean; isActive: boolean; categoryId: string;
  useDefaultDimensions: boolean; autoTranslate: boolean;
};

export const CRITERIA_SET_SECTIONS: readonly EditorSectionDef[] = [
  { id: 'basic', label: '기본 정보', description: '평가 기준 세트의 이름과 설명입니다. 운영자가 목록에서 이 세트를 구분합니다.', group: '평가 기준', icon: FileText },
  { id: 'evaluation', label: '평가 구성', description: '적용할 카테고리와 처음 포함할 평가 차원을 정합니다.', group: '평가 기준', icon: ListChecks },
  { id: 'publish', label: '공개 설정', description: '활성 상태, 기본 기준 지정과 번역을 관리합니다.', group: '배포', icon: Settings2 },
];

/** Single create/edit implementation for an evaluation criteria set. */
export function CriteriaSetEditor({ isNew, formData, onChange, categories, pending, onClose, onSave, onTranslate, translatePending, canTranslate }: {
  isNew: boolean; formData: CriteriaSetFormData; onChange: (next: CriteriaSetFormData) => void; categories: Category[];
  pending: boolean; onClose: () => void; onSave: () => void; onTranslate: () => void; translatePending: boolean; canTranslate: boolean;
}) {
  const { t } = useTranslation();
  const patch = (next: Partial<CriteriaSetFormData>) => onChange({ ...formData, ...next });
  const idp = isNew ? '' : 'edit-';
  return (
    <ContentEditor
      title={formData.name}
      revision={JSON.stringify(formData)}
      pending={pending}
      isNew={isNew}
      sections={CRITERIA_SET_SECTIONS}
      breadcrumb="평가 기준 관리"
      newTitle="새 평가 기준 세트"
      formId="evaluation-editor-form"
      saveTestId="button-save-evaluation"
      testId="evaluation-editor"
      saveLabel={isNew ? t('common.create') : t('common.save')}
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); onSave(); }}
    >
      <ContentEditorRegion sections="basic" className="se-stack">
        <EditorGroup title="세트 정보" description="대화 피드백에 사용될 평가 기준 세트입니다.">
          <Field label="이름" htmlFor={`${idp}name`} required>
            <Input id={`${idp}name`} required value={formData.name} onChange={(e) => patch({ name: e.target.value })} placeholder="예: 영업팀 평가 기준" />
          </Field>
          <Field label="설명" htmlFor={`${idp}description`} optional>
            <AutoResizeTextarea id={`${idp}description`} value={formData.description} onChange={(e) => patch({ description: e.target.value })} placeholder="이 평가 기준 세트에 대한 설명" />
          </Field>
        </EditorGroup>
      </ContentEditorRegion>

      <ContentEditorRegion sections="evaluation" className="se-stack">
        <EditorGroup title="적용 범위">
          <Field label="연결 카테고리" htmlFor={`${idp}category`} hint="특정 카테고리에 연결하면 해당 카테고리의 시나리오에서만 이 기준이 사용됩니다.">
            <Select value={formData.categoryId || 'none'} onValueChange={(value) => patch({ categoryId: value === 'none' ? '' : value })}>
              <SelectTrigger id={`${idp}category`}><SelectValue placeholder="선택 없음 (모든 카테고리)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">선택 없음</SelectItem>
                {categories.map((cat) => <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </EditorGroup>
        {isNew ? (
          <EditorGroup title="초기 평가 차원" description="세트를 만든 뒤에도 차원을 추가하거나 수정할 수 있습니다.">
            <ToggleRow id="useDefault" label="기본 5개 평가 차원 포함" checked={formData.useDefaultDimensions}
              description={formData.useDefaultDimensions ? '명확성, 경청, 상황대응, 설득력, 전략적 소통 차원이 루브릭과 함께 추가됩니다.' : '빈 세트로 시작합니다.'}
              onCheckedChange={(checked) => patch({ useDefaultDimensions: checked })} />
          </EditorGroup>
        ) : (
          <EditorGroup title="평가 차원" description="차원은 세트 상세 화면의 평가 차원 목록에서 추가하고 수정합니다." flat>
            <p className="text-sm text-slate-500">저장 후 목록에서 이 세트를 펼쳐 차원을 관리하세요.</p>
          </EditorGroup>
        )}
      </ContentEditorRegion>

      <ContentEditorRegion sections="publish" className="se-stack">
        <EditorGroup title="상태">
          {!isNew && <ToggleRow id="edit-isActive" label="활성화" checked={formData.isActive}
            description={formData.isActive ? '시나리오 평가에 사용할 수 있습니다.' : '비활성 상태에서는 선택할 수 없습니다.'}
            onCheckedChange={(checked) => patch({ isActive: checked })} />}
          <ToggleRow id={isNew ? 'isDefault' : 'edit-isDefault'} label="기본 기준으로 설정" checked={formData.isDefault}
            description="별도 지정이 없는 시나리오에 이 기준이 적용됩니다."
            onCheckedChange={(checked) => patch({ isDefault: checked })} />
        </EditorGroup>
        <EditorGroup title={<span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-500" />{t('admin.evaluationCriteria.autoTranslate')}</span>}
          description={t('admin.evaluationCriteria.autoTranslateDescription')}>
          {isNew ? (
            <ToggleRow id="autoTranslate" label="생성 후 자동 번역" checked={formData.autoTranslate} onCheckedChange={(checked) => patch({ autoTranslate: checked })} />
          ) : (
            <div>
              <Button type="button" variant="outline" size="sm" onClick={onTranslate} disabled={translatePending || !canTranslate}>
                {translatePending ? t('admin.common.loading') : t('admin.evaluationCriteria.triggerAutoTranslate')}
              </Button>
            </div>
          )}
        </EditorGroup>
      </ContentEditorRegion>
    </ContentEditor>
  );
}

export type DimensionFormData = {
  key: string; name: string; description: string; weight: number; dimensionType: 'core' | 'standard' | 'bonus';
  minScore: number; maxScore: number; icon: string; color: string; isActive: boolean;
  scoringRubric: ScoringRubric[]; evaluationPrompt: string;
};

export const DIMENSION_SECTIONS: readonly EditorSectionDef[] = [
  { id: 'basic', label: '기본 정보', description: '차원의 키, 이름, 설명과 유형입니다. 키는 생성 후 변경할 수 없습니다.', group: '평가 차원', icon: FileText },
  { id: 'scoring', label: '점수와 가중치', description: '전체 점수에서 차지하는 비중과 점수 범위를 정합니다.', group: '평가 차원', icon: Gauge },
  { id: 'rubric', label: '루브릭', description: '점수대별 행동 기준과 AI 평가 지침을 정합니다. 증거 기반 채점에 사용됩니다.', group: '평가 방식', icon: ClipboardList },
  { id: 'appearance', label: '표시와 상태', description: '피드백 화면에 쓰일 아이콘, 색상과 활성 상태입니다.', group: '배포', icon: Palette },
];

/** Add/edit implementation for an evaluation dimension, inside the shared editor shell. */
const FEW_SHOT_SECTION: EditorSectionDef = { id: 'fewshot', label: '퓨샷 예시', description: '이 차원의 채점 예시 대화를 관리합니다. 예시는 각각 바로 저장되며 차원 저장과 별개입니다.', group: '평가 방식', icon: MessagesSquare };

export function DimensionEditor({ isNew, dimensionId, formData, onChange, rubricOverview, onRubricOverviewChange, presetColors, pending, generating, onGenerate, onClose, onSave }: {
  isNew: boolean;
  /** Existing dimension id; enables the few-shot examples section (edit only). */
  dimensionId?: string;
  formData: DimensionFormData; onChange: (next: DimensionFormData) => void;
  rubricOverview: { positiveOverview: string; negativeOverview: string };
  onRubricOverviewChange: (next: { positiveOverview: string; negativeOverview: string }) => void;
  presetColors: string[]; pending: boolean; generating: boolean; onGenerate: () => void; onClose: () => void; onSave: () => void;
}) {
  const patch = (next: Partial<DimensionFormData>) => onChange({ ...formData, ...next });
  const rangeInvalid = formData.minScore < 1 || formData.maxScore > 10 || formData.minScore >= formData.maxScore;
  const missingAnchors = formData.scoringRubric.filter(r => !r.behaviorAnchor?.trim()).length;
  const anchorsBlocking = formData.scoringRubric.length >= 5 && missingAnchors > 0;
  const noOverview = !rubricOverview.positiveOverview.trim() && !rubricOverview.negativeOverview.trim();
  const IconComp = getIconComponent(formData.icon || 'Star');
  const sections = dimensionId
    ? [...DIMENSION_SECTIONS.slice(0, 3), FEW_SHOT_SECTION, DIMENSION_SECTIONS[3]]
    : DIMENSION_SECTIONS;
  return (
    <ContentEditor
      title={formData.name}
      revision={JSON.stringify({ formData, rubricOverview })}
      pending={pending}
      isNew={isNew}
      sections={sections}
      breadcrumb="평가 기준 관리"
      newTitle="새 평가 차원"
      formId="evaluation-dimension-editor-form"
      saveTestId="button-save-evaluation-dimension"
      testId="evaluation-dimension-editor"
      saveDisabled={anchorsBlocking}
      footerActions={anchorsBlocking ? <span className="text-xs text-amber-700">행동 기준 {missingAnchors}개 미입력</span> : undefined}
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); onSave(); }}
    >
      <ContentEditorRegion sections="basic" className="se-stack">
        <EditorGroup title="차원 정보">
          <FieldGrid>
            <Field label="키 (영문)" htmlFor="dim-key" required hint={isNew ? undefined : '기존 차원의 키는 변경할 수 없습니다.'}>
              <Input id="dim-key" required value={formData.key} onChange={(e) => patch({ key: e.target.value })} placeholder="clarityLogic" disabled={!isNew} />
            </Field>
            <Field label="이름" htmlFor="dim-name" required>
              <Input id="dim-name" required value={formData.name} onChange={(e) => patch({ name: e.target.value })} placeholder="명확성 & 논리성" />
            </Field>
          </FieldGrid>
          <Field label="설명" htmlFor="dim-description" optional>
            <AutoResizeTextarea id="dim-description" value={formData.description} onChange={(e) => patch({ description: e.target.value })} placeholder="이 평가 차원에 대한 상세 설명" />
          </Field>
          <Field label="차원 유형" htmlFor="dim-type">
            <Select value={formData.dimensionType} onValueChange={(value: 'core' | 'standard' | 'bonus') => patch({ dimensionType: value })}>
              <SelectTrigger id="dim-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DIMENSION_TYPE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex items-center gap-2"><span className={opt.color}>{opt.label}</span><span className="text-xs text-slate-400">- {opt.description}</span></div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </EditorGroup>
      </ContentEditorRegion>

      <ContentEditorRegion sections="scoring" className="se-stack">
        <EditorGroup title="가중치" description="모든 활성 차원의 가중치 합계가 100%가 되도록 설정하세요."
          actions={<span className="text-lg font-bold text-blue-600">{formData.weight}%</span>}>
          <Slider id="dim-weight" aria-label="가중치 (%)" min={0} max={100} step={5} value={[formData.weight]} onValueChange={(values) => patch({ weight: values[0] })} className="my-2" />
        </EditorGroup>
        <EditorGroup title="점수 범위" description="1~10점 척도입니다. 종합 점수는 가중치 환산을 통해 100점으로 표시됩니다.">
          <FieldGrid>
            <Field label="최소 점수" htmlFor="dim-minScore">
              <Input id="dim-minScore" type="number" min={1} max={10} value={formData.minScore}
                onChange={(e) => patch({ minScore: parseInt(e.target.value) || 1 })}
                className={formData.minScore < 1 || formData.minScore >= formData.maxScore ? 'border-red-400 focus-visible:ring-red-400' : ''} />
            </Field>
            <Field label="최대 점수" htmlFor="dim-maxScore">
              <Input id="dim-maxScore" type="number" min={1} max={10} value={formData.maxScore}
                onChange={(e) => patch({ maxScore: parseInt(e.target.value) || 10 })}
                className={formData.maxScore > 10 || formData.minScore >= formData.maxScore ? 'border-red-400 focus-visible:ring-red-400' : ''} />
            </Field>
          </FieldGrid>
          {rangeInvalid && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>점수 범위는 최소 1점, 최대 10점이어야 하며 최소 점수는 최대 점수보다 작아야 합니다. 종합 점수는 가중치 환산을 통해 100점으로 표시됩니다.</span>
            </div>
          )}
        </EditorGroup>
      </ContentEditorRegion>

      <ContentEditorRegion sections="rubric" className="se-stack">
        {formData.scoringRubric.length < 5 && (
          <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>채점 루브릭은 최소 5단계 이상 입력해야 합니다 (현재: {formData.scoringRubric.length}단계).</span>
          </div>
        )}
        {anchorsBlocking && (
          <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>루브릭 {missingAnchors}개 항목에 행동 기준(Behavior Anchor)이 누락되었습니다. 저장 전 모두 입력해 주세요.</span>
          </div>
        )}
        {formData.scoringRubric.length > 0 && (
          <EditorGroup title={<span className="inline-flex items-center gap-1.5"><Bot className="h-4 w-4 text-indigo-500" />행동 기준 개요 (AI 자동 생성용)</span>}
            description="긍정·부정 행동 개요를 입력한 뒤 AI 생성 버튼을 누르면 각 점수대의 행동 기준·지표가 자동으로 채워집니다.">
            <Field label="긍정적 행동 개요" htmlFor="dim-positiveOverview">
              <AutoResizeTextarea id="dim-positiveOverview" value={rubricOverview.positiveOverview}
                onChange={(e) => onRubricOverviewChange({ ...rubricOverview, positiveOverview: e.target.value })}
                className="text-xs min-h-[52px]"
                placeholder="높은 점수를 받는 사람이 보이는 구체적인 행동 패턴을 설명하세요. (예: 핵심 메시지를 먼저 제시하고 구체적 근거를 들어 논리적으로 설명한다)" />
            </Field>
            <Field label="부정적 행동 개요" htmlFor="dim-negativeOverview">
              <AutoResizeTextarea id="dim-negativeOverview" value={rubricOverview.negativeOverview}
                onChange={(e) => onRubricOverviewChange({ ...rubricOverview, negativeOverview: e.target.value })}
                className="text-xs min-h-[52px]"
                placeholder="낮은 점수를 받는 사람이 보이는 구체적인 행동 패턴을 설명하세요. (예: 주장만 반복하고 근거 없이 강압적으로 요구한다)" />
            </Field>
            <AiGenerateButton block variant="primary" label="AI로 루브릭 생성" loadingLabel="AI가 생성 중..." loading={generating}
              disabled={noOverview || generating} blockedReason={noOverview ? '긍정 또는 부정 행동 개요를 먼저 입력해 주세요' : undefined}
              onClick={onGenerate} />
          </EditorGroup>
        )}
        <RubricItemsEditor rubric={formData.scoringRubric} onChange={(updated) => patch({ scoringRubric: updated })} />
        <EditorGroup title={<span className="inline-flex items-center gap-2">평가 요청 스크립트<Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-300 text-amber-600 bg-amber-50">AI 전용</Badge></span>}
          description="이 스크립트는 AI가 해당 차원을 평가할 때 참고하는 지침입니다. 일반 유저에게 노출되지 않습니다.">
          <AutoResizeTextarea id="dim-evaluationPrompt" aria-label="평가 요청 스크립트" value={formData.evaluationPrompt}
            onChange={(e) => patch({ evaluationPrompt: e.target.value })}
            className="font-mono text-xs bg-slate-50 border-dashed"
            placeholder="AI 모델에 전달할 평가 지침을 입력하세요. 이 내용은 피드백 생성 시 AI에 전달되며 일반 유저에게는 보이지 않습니다." />
        </EditorGroup>
      </ContentEditorRegion>

      <ContentEditorRegion sections="appearance" className="se-stack">
        <EditorGroup title="표시">
          <FieldGrid>
            <Field label="아이콘" htmlFor="dim-icon">
              <Popover>
                <PopoverTrigger asChild>
                  <Button id="dim-icon" type="button" variant="outline" className="w-full justify-start gap-2">
                    <IconComp className="h-4 w-4" /><span>{formData.icon || '아이콘 선택'}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-3" align="start">
                  <div className="grid grid-cols-6 gap-2">
                    {AVAILABLE_ICONS.map(({ name, icon: Ico }) => (
                      <Button key={name} type="button" aria-label={name} variant={formData.icon === name ? "default" : "ghost"} size="icon" className="h-9 w-9" onClick={() => patch({ icon: name })}>
                        <Ico className="h-4 w-4" />
                      </Button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </Field>
            <Field label="색상" htmlFor="dim-color">
              <Popover>
                <PopoverTrigger asChild>
                  <Button id="dim-color" type="button" variant="outline" className="w-full justify-between px-3">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <div className="w-4 h-4 rounded-full shrink-0 border border-slate-200" style={{ backgroundColor: formData.color || '#6366f1' }} />
                      <span className="truncate text-xs font-mono">{formData.color || '#6366f1'}</span>
                    </div>
                    <Settings className="h-4 w-4 opacity-50 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[220px] p-3" align="end">
                  <div className="space-y-3">
                    <div className="grid grid-cols-4 gap-2">
                      {presetColors.map((color) => (
                        <button key={color} type="button" aria-label={color} title={color}
                          className={`w-8 h-8 rounded-md border border-slate-200 hover:scale-110 transition-transform ${formData.color === color ? 'ring-2 ring-slate-950 ring-offset-1' : ''}`}
                          style={{ backgroundColor: color }} onClick={() => patch({ color })} />
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t">
                      <Input type="color" value={formData.color || '#6366f1'} onChange={(e) => patch({ color: e.target.value })} className="w-10 h-8 p-1 cursor-pointer shrink-0 border-none bg-transparent" />
                      <Input type="text" value={formData.color || '#6366f1'} onChange={(e) => patch({ color: e.target.value })} className="h-8 text-xs font-mono" placeholder="#000000" />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </Field>
          </FieldGrid>
        </EditorGroup>
        <EditorGroup title="상태">
          <ToggleRow id="dim-isActive" label="활성화" checked={formData.isActive}
            description={formData.isActive ? '이 차원이 평가에 포함됩니다.' : '비활성 차원은 평가와 가중치 합계에서 제외됩니다.'}
            onCheckedChange={(checked) => patch({ isActive: checked })} />
        </EditorGroup>
      </ContentEditorRegion>

      {dimensionId && (
        <ContentEditorRegion sections="fewshot" className="se-stack">
          {/* Few-shot rows save independently; keep Enter in their inputs from submitting the dimension form. */}
          <div onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault(); }}>
            <FewShotLearningTab dimensionId={dimensionId} />
          </div>
        </ContentEditorRegion>
      )}
    </ContentEditor>
  );
}
