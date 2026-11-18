import React from 'react';
import { AudioLines, BookUser, Brain, Clapperboard, IdCard, Images, MessagesSquare, ScanFace, Settings2 } from 'lucide-react';
import { ScenarioEditor, ScenarioEditorRegion, type EditorSectionDef } from '../scenarioEditor/ScenarioEditor';

/** Persona-specific section map rendered inside the shared scenario editor shell. */
export const PERSONA_EDITOR_SECTIONS: readonly EditorSectionDef[] = [
  { id: 'basic', label: '기본 정보', description: '페르소나를 식별하는 ID와 성격 유형입니다. 시나리오에서 이 ID로 페르소나를 불러옵니다.', group: '인물 설정', icon: IdCard },
  { id: 'personality', label: '성격과 동기', description: '대화 중 드러나는 성격 특성, 말투, 동기와 두려움을 정합니다.', group: '인물 설정', icon: Brain },
  { id: 'background', label: '배경', description: '가치관, 취미와 사회적 성향으로 인물의 맥락을 채웁니다.', group: '인물 설정', icon: BookUser },
  { id: 'communication', label: '의사소통 패턴', description: '대화를 여는 방식, 자주 쓰는 표현과 설득되는 조건을 정합니다.', group: '인물 설정', icon: MessagesSquare },
  { id: 'voice', label: '음성과 성별', description: '음성 톤과 속도, 표정 이미지와 영상에 쓰일 성별을 정합니다.', group: '인물 설정', icon: AudioLines },
  { id: 'images', label: '표정 이미지', description: '기본 이미지와 감정별 표정 이미지를 관리합니다. 생성 결과는 바로 저장됩니다.', group: '표현', icon: Images },
  { id: 'avatar', label: '아바타 표시', description: '대화 화면에 이미지, 영상 또는 라이브 아바타 중 무엇을 보여줄지 정합니다.', group: '표현', icon: ScanFace },
  { id: 'video', label: '비디오 클립', description: '행동과 감정 조합별 영상 클립을 성별마다 관리합니다.', group: '표현', icon: Clapperboard },
  { id: 'publish', label: '공개 설정', description: '자유 대화 노출과 콘텐츠 스토어 등록을 설정합니다.', group: '배포', icon: Settings2 },
];

export type PersonaEditorSection = 'basic' | 'personality' | 'background' | 'communication' | 'voice' | 'images' | 'avatar' | 'video' | 'publish';

export function PersonaEditorRegion({ section, children, id }: { section: PersonaEditorSection; children: React.ReactNode; id?: string }) {
  return <ScenarioEditorRegion sections={section} id={id} className="se-stack">{children}</ScenarioEditorRegion>;
}

export function PersonaEditor(props: {
  title: string; revision: string; baseline: string; pending: boolean; isNew: boolean;
  onClose: () => void; onSubmit: React.FormEventHandler<HTMLFormElement>; children: React.ReactNode;
}) {
  return <ScenarioEditor {...props} sections={PERSONA_EDITOR_SECTIONS} breadcrumb="페르소나 관리" newTitle="새 페르소나"
    formId="persona-editor-form" saveTestId="button-save-persona" testId="persona-editor" />;
}
