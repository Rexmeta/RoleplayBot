import React from 'react';
import { FileText, Flag, Image, ListChecks, MessagesSquare, Settings2, Users, Workflow } from 'lucide-react';
import { ContentEditor, ContentEditorRegion, useContentEditorNavigation, revealContentEditorTarget, type EditorSectionDef } from '../contentEditor/ContentEditor';

export type { EditorSectionDef } from '../contentEditor/ContentEditor';

export const EDITOR_SECTIONS = [
  { id: 'basic', label: '기본 정보', description: '학습자가 처음 보게 될 시나리오의 개요와 연습할 역량입니다.', group: '교육 내용', icon: FileText },
  { id: 'situation', label: '상황과 학습자 역할', description: '어떤 상황에서, 누구의 입장으로 대화할지 정합니다.', group: '교육 내용', icon: MessagesSquare },
  { id: 'actors', label: '대화 상대', description: '각 인물의 입장과 목표를 정합니다. 세부 반응과 문화 설정도 여기에서 편집합니다.', group: '교육 내용', icon: Users },
  { id: 'goals', label: '학습 목표와 성공 기준', description: '이번 연습에서 달성할 목표와 좋은 대화의 기준을 정합니다.', group: '교육 내용', icon: Flag },
  { id: 'flow', label: '대화 흐름', description: '전체 흐름을 보면서 한 단계씩 편집하세요. 자동 전환과 종료 규칙은 필요한 경우에만 설정합니다.', group: '진행 방식', icon: Workflow },
  { id: 'assessment', label: '평가 방식', description: '대화 시간, 평가 기준과 피드백 방식을 정합니다.', group: '진행 방식', icon: ListChecks },
  { id: 'media', label: '이미지·영상', description: '시나리오 이미지와 시작 영상을 관리합니다. 교육 내용과 별도로 설정할 수 있습니다.', group: '배포', icon: Image },
  { id: 'publish', label: '공개 설정', description: '공개 범위, 체험 모드와 언어 설정을 확인합니다.', group: '배포', icon: Settings2 },
] as const;
export type EditorSection = typeof EDITOR_SECTIONS[number]['id'];

/** Backward-compatible aliases: the shell itself lives in admin/contentEditor. */
export const useScenarioEditorNavigation = useContentEditorNavigation;
export const revealScenarioEditorTarget = revealContentEditorTarget;
export const ScenarioEditorRegion = ContentEditorRegion;

/** Thin wrapper keeping the scenario defaults stable. */
export function ScenarioEditor({ sections = EDITOR_SECTIONS, breadcrumb = '시나리오 관리', newTitle = '새 시나리오',
  formId = 'scenario-editor-form', saveTestId = 'button-save-scenario', ...rest }: {
  title: string; revision: string; pending: boolean; onClose: () => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>; children: React.ReactNode; isNew: boolean;
  sections?: readonly EditorSectionDef[]; breadcrumb?: string; newTitle?: string; formId?: string; saveTestId?: string;
  baseline?: string; testId?: string;
}) {
  return <ContentEditor {...rest} sections={sections} breadcrumb={breadcrumb} newTitle={newTitle} formId={formId} saveTestId={saveTestId} />;
}
