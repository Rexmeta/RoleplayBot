import { Input } from "@/components/ui/input";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
import { Label } from "@/components/ui/label";
import { Star, Check, Settings, MessageCircle, Target, Lightbulb, Heart, Users, Award, Brain, Zap, Shield, TrendingUp, Eye, Ear, HandHeart, Compass, Flag, ThumbsUp, Megaphone, PenTool, BookOpen, Sparkles } from "lucide-react";

export const AVAILABLE_ICONS = [
  { name: 'Star', icon: Star },
  { name: 'MessageCircle', icon: MessageCircle },
  { name: 'Target', icon: Target },
  { name: 'Lightbulb', icon: Lightbulb },
  { name: 'Heart', icon: Heart },
  { name: 'Users', icon: Users },
  { name: 'Award', icon: Award },
  { name: 'Brain', icon: Brain },
  { name: 'Zap', icon: Zap },
  { name: 'Shield', icon: Shield },
  { name: 'TrendingUp', icon: TrendingUp },
  { name: 'Eye', icon: Eye },
  { name: 'Ear', icon: Ear },
  { name: 'HandHeart', icon: HandHeart },
  { name: 'Compass', icon: Compass },
  { name: 'Flag', icon: Flag },
  { name: 'ThumbsUp', icon: ThumbsUp },
  { name: 'Megaphone', icon: Megaphone },
  { name: 'PenTool', icon: PenTool },
  { name: 'BookOpen', icon: BookOpen },
  { name: 'Sparkles', icon: Sparkles },
  { name: 'Check', icon: Check },
  { name: 'Settings', icon: Settings },
];

export const getIconComponent = (iconName: string) => {
  const found = AVAILABLE_ICONS.find(i => i.name === iconName);
  return found ? found.icon : Star;
};

export interface ScoringRubric {
  score: number;
  label: string;
  description: string;
  behaviorAnchor?: string;
  positiveIndicators?: string[];
  negativeIndicators?: string[];
}

export const DIMENSION_TYPE_OPTIONS = [
  { value: 'core', label: '필수 기준', description: '반드시 충족해야 하는 핵심 평가 항목', color: 'text-red-600' },
  { value: 'standard', label: '일반 기준', description: '표준 평가 항목', color: 'text-blue-600' },
  { value: 'bonus', label: '가점 기준', description: '추가 가점을 받을 수 있는 항목', color: 'text-green-600' },
];

export function RubricItemsEditor({
  rubric,
  onChange,
}: {
  rubric: ScoringRubric[];
  onChange: (updated: ScoringRubric[]) => void;
}) {
  if (rubric.length === 0) return null;
  const missingAnchorCount = rubric.filter(r => !r.behaviorAnchor?.trim()).length;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-xs font-semibold">루브릭 행동 기준 (Behavior Anchors)</Label>
        {missingAnchorCount > 0 && (
          <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
            {missingAnchorCount}개 미입력
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-500">각 점수대에서 관찰되는 구체적인 행동 패턴을 입력하세요. 증거 기반 채점에 필수입니다.</p>
      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {rubric.map((item, idx) => (
          <div key={idx} className={`border rounded-md p-2.5 bg-white space-y-1.5 ${!item.behaviorAnchor?.trim() ? 'border-amber-300' : 'border-slate-200'}`}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{item.score}점</span>
              <span className="text-xs font-medium text-slate-700">{item.label}</span>
              {!item.behaviorAnchor?.trim() && (
                <span className="text-[10px] text-amber-600 ml-auto">행동 기준 필요</span>
              )}
            </div>
            <div>
              <label className="text-[11px] text-slate-500 font-medium">행동 기준 *</label>
              <AutoResizeTextarea
                value={item.behaviorAnchor || ''}
                onChange={(e) => {
                  const updated = [...rubric];
                  updated[idx] = { ...updated[idx], behaviorAnchor: e.target.value };
                  onChange(updated);
                }}
                className={`text-xs mt-0.5 min-h-[48px] ${!item.behaviorAnchor?.trim() ? 'border-amber-300 focus-visible:ring-amber-300' : ''}`}
                placeholder="이 점수대에서 관찰되는 구체적 행동 패턴 (예: 핵심 메시지를 명확히 전달하고 논리적 근거를 3가지 이상 제시함)"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-500">긍정 지표 (쉼표 구분, 선택)</label>
                <Input
                  value={(item.positiveIndicators || []).join(', ')}
                  onChange={(e) => {
                    const updated = [...rubric];
                    updated[idx] = { ...updated[idx], positiveIndicators: e.target.value.split(',').map(s => s.trim()).filter(Boolean) };
                    onChange(updated);
                  }}
                  className="h-7 text-xs mt-0.5"
                  placeholder="구체적 발화, 공감 표현..."
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500">부정 지표 (쉼표 구분, 선택)</label>
                <Input
                  value={(item.negativeIndicators || []).join(', ')}
                  onChange={(e) => {
                    const updated = [...rubric];
                    updated[idx] = { ...updated[idx], negativeIndicators: e.target.value.split(',').map(s => s.trim()).filter(Boolean) };
                    onChange(updated);
                  }}
                  className="h-7 text-xs mt-0.5"
                  placeholder="논리 비약, 상대 무시..."
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
