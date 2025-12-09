import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';

interface DifficultyGuidelines {
  level: number;
  name: string;
  description: string;
  responseLength: string;
  tone: string;
  pressure: string;
  feedback: string;
  constraints: string[];
}

const defaultDifficultySettings: Record<number, DifficultyGuidelines> = {
  1: {
    level: 1,
    name: '매우 쉬움 / 튜토리얼',
    description: '초보자를 위한 친절하고 교육적인 대화',
    responseLength: '1-3문장, 짧고 명확하게. 필요 시 예시 추가.',
    tone: '매우 친절하고 격려적, 천천히 설명',
    pressure: '압박감 없음. 실수해도 긍정적 피드백 제공.',
    feedback: '좋은 예시를 들어주고, 부드럽게 가이드. "좋은 생각이에요!", "이렇게 해보시는 건 어떨까요?"',
    constraints: ['상대방을 많이 배려하며 대화', '갈등 상황 거의 없음', '반복 확인과 명확한 설명', '긍정적이고 격려하는 말투', '상세한 설명과 예시 제공']
  },
  2: {
    level: 2,
    name: '기본 난이도',
    description: '친절하지만 현실적인 대화',
    responseLength: '1-2문장, 명확하고 현실적으로',
    tone: '친절하지만 어느 정도 현실적인 반응',
    pressure: '약한 갈등과 압박 존재. 실수해도 다시 기회를 줌.',
    feedback: '설명은 해주되, 사용자가 스스로 생각해보도록 유도.',
    constraints: ['배려심은 있으나 현실적 반응', '약한 갈등 상황 존재', '설명 제공하되 스스로 생각 유도', '공감과 논리의 균형', '조화롭지만 명확한 입장 유지']
  },
  3: {
    level: 3,
    name: '도전형',
    description: '논리적 근거를 요구하는 도전적 대화',
    responseLength: '1-2문장, 핵심만 간결하게. 논리와 근거 요구.',
    tone: '현실적이고 비판적. 약간의 압박감 있는 질문.',
    pressure: '중간 압박. 감정과 이해관계 문제 등장, 설득/협상 필요.',
    feedback: '논리와 근거를 요구. 비판적 질문.',
    constraints: ['논리적 허점 지적', '비판적이고 분석적 질문', '구체적 근거와 계획 요구', '감정보다 논리 중시', '설득과 협상 능력 필요']
  },
  4: {
    level: 4,
    name: '고난도 / 실전형',
    description: '실전과 같은 압박감 있는 대화',
    responseLength: '1-2문장, 매우 짧고 직설적. 10-15단어 이내 권장.',
    tone: '바쁘고 여유 없음. 직설적이고 때로는 비판적.',
    pressure: '강한 압박. 시간 제약, 갈등, 이해관계 충돌. 빠른 결정 요구.',
    feedback: '애매하면 "그래서 결론이 뭔가요?" 같은 압박. 반박과 비판적 반응.',
    constraints: ['**최대 1-2문장만**: 절대로 3문장 이상 말하지 마세요', '**즉각 반응**: 긴 설명 없이 핵심만 빠르게', '**압박 표현 필수**: "빨리", "지금", "급해요" 포함', '**공격적 반응**: 느린 반응에 답답해하고 짜증', '**감정 폭발 가능**: 필요하면 화내고 목소리 높임', '**비판적 태도**: 근거 없으면 즉시 반박']
  }
};

export function DifficultySettingsTab() {
  const { toast } = useToast();
  const [editingLevel, setEditingLevel] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<DifficultyGuidelines | null>(null);

  const { data: difficultySettings, isLoading } = useQuery<Record<number, DifficultyGuidelines>>({
    queryKey: ['/api/admin/difficulty-settings'],
    staleTime: 1000 * 60 * 5,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ level, settings }: { level: number; settings: DifficultyGuidelines }) => {
      const res = await apiRequest('PUT', `/api/admin/difficulty-settings/${level}`, settings);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: '저장 완료', description: '난이도 설정이 저장되었습니다.' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/difficulty-settings'] });
      setEditingLevel(null);
      setEditForm(null);
    },
    onError: (error: any) => {
      toast({ title: '저장 실패', description: error.message || '난이도 설정 저장에 실패했습니다.', variant: 'destructive' });
    }
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/admin/difficulty-settings/reset', {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: '초기화 완료', description: '난이도 설정이 기본값으로 복원되었습니다.' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/difficulty-settings'] });
    },
    onError: (error: any) => {
      toast({ title: '초기화 실패', description: error.message || '초기화에 실패했습니다.', variant: 'destructive' });
    }
  });

  const currentSettings = difficultySettings && Object.keys(difficultySettings).length > 0 
    ? difficultySettings 
    : defaultDifficultySettings;

  const handleEdit = (level: number) => {
    setEditingLevel(level);
    setEditForm({ ...currentSettings[level] });
  };

  const handleCancel = () => {
    setEditingLevel(null);
    setEditForm(null);
  };

  const handleSave = () => {
    if (!editForm || editingLevel === null) return;
    saveMutation.mutate({ level: editingLevel, settings: editForm });
  };

  const handleConstraintChange = (index: number, value: string) => {
    if (!editForm) return;
    const newConstraints = [...editForm.constraints];
    newConstraints[index] = value;
    setEditForm({ ...editForm, constraints: newConstraints });
  };

  const handleAddConstraint = () => {
    if (!editForm) return;
    setEditForm({ ...editForm, constraints: [...editForm.constraints, ''] });
  };

  const handleRemoveConstraint = (index: number) => {
    if (!editForm) return;
    const newConstraints = editForm.constraints.filter((_, i) => i !== index);
    setEditForm({ ...editForm, constraints: newConstraints });
  };

  const levelColors: Record<number, string> = {
    1: 'bg-green-100 text-green-800 border-green-300',
    2: 'bg-blue-100 text-blue-800 border-blue-300',
    3: 'bg-orange-100 text-orange-800 border-orange-300',
    4: 'bg-red-100 text-red-800 border-red-300'
  };

  const levelIcons: Record<number, string> = {
    1: 'fa-seedling',
    2: 'fa-leaf',
    3: 'fa-fire',
    4: 'fa-bolt'
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <i className="fas fa-spinner fa-spin text-2xl text-slate-400"></i>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">대화 난이도 설정</h2>
          <p className="text-sm text-slate-600 mt-1">
            AI 캐릭터의 대화 스타일을 난이도별로 설정합니다. 이 설정은 텍스트, TTS, 실시간 음성 모든 대화 모드에 적용됩니다.
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending}
          data-testid="button-reset-difficulty"
        >
          <i className="fas fa-undo mr-2"></i>
          기본값으로 초기화
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map((level) => {
          const settings = currentSettings[level];
          const isEditing = editingLevel === level;
          const formData = isEditing ? editForm : settings;

          return (
            <Card key={level} className={`border-2 ${levelColors[level]}`} data-testid={`card-difficulty-level-${level}`}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <i className={`fas ${levelIcons[level]}`}></i>
                    Level {level}: {isEditing ? (
                      <Input 
                        value={formData?.name || ''} 
                        onChange={(e) => setEditForm({ ...formData!, name: e.target.value })}
                        className="w-48 h-8 text-sm"
                        data-testid={`input-difficulty-name-${level}`}
                      />
                    ) : (
                      <span>{settings?.name}</span>
                    )}
                  </CardTitle>
                  <div className="flex gap-2">
                    {isEditing ? (
                      <>
                        <Button size="sm" variant="outline" onClick={handleCancel} data-testid={`button-cancel-${level}`}>
                          취소
                        </Button>
                        <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending} data-testid={`button-save-${level}`}>
                          {saveMutation.isPending ? <i className="fas fa-spinner fa-spin mr-1"></i> : null}
                          저장
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => handleEdit(level)} data-testid={`button-edit-${level}`}>
                        <i className="fas fa-edit"></i>
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs font-semibold text-slate-600">설명</Label>
                  {isEditing ? (
                    <Input 
                      value={formData?.description || ''} 
                      onChange={(e) => setEditForm({ ...formData!, description: e.target.value })}
                      className="mt-1"
                      data-testid={`input-difficulty-description-${level}`}
                    />
                  ) : (
                    <p className="text-sm mt-1">{settings?.description}</p>
                  )}
                </div>

                <div>
                  <Label className="text-xs font-semibold text-slate-600">응답 길이</Label>
                  {isEditing ? (
                    <Input 
                      value={formData?.responseLength || ''} 
                      onChange={(e) => setEditForm({ ...formData!, responseLength: e.target.value })}
                      className="mt-1"
                      data-testid={`input-difficulty-responseLength-${level}`}
                    />
                  ) : (
                    <p className="text-sm mt-1">{settings?.responseLength}</p>
                  )}
                </div>

                <div>
                  <Label className="text-xs font-semibold text-slate-600">말투/톤</Label>
                  {isEditing ? (
                    <Textarea 
                      value={formData?.tone || ''} 
                      onChange={(e) => setEditForm({ ...formData!, tone: e.target.value })}
                      className="mt-1"
                      rows={2}
                      data-testid={`input-difficulty-tone-${level}`}
                    />
                  ) : (
                    <p className="text-sm mt-1">{settings?.tone}</p>
                  )}
                </div>

                <div>
                  <Label className="text-xs font-semibold text-slate-600">압박감</Label>
                  {isEditing ? (
                    <Textarea 
                      value={formData?.pressure || ''} 
                      onChange={(e) => setEditForm({ ...formData!, pressure: e.target.value })}
                      className="mt-1"
                      rows={2}
                      data-testid={`input-difficulty-pressure-${level}`}
                    />
                  ) : (
                    <p className="text-sm mt-1">{settings?.pressure}</p>
                  )}
                </div>

                <div>
                  <Label className="text-xs font-semibold text-slate-600">피드백 방식</Label>
                  {isEditing ? (
                    <Textarea 
                      value={formData?.feedback || ''} 
                      onChange={(e) => setEditForm({ ...formData!, feedback: e.target.value })}
                      className="mt-1"
                      rows={2}
                      data-testid={`input-difficulty-feedback-${level}`}
                    />
                  ) : (
                    <p className="text-sm mt-1">{settings?.feedback}</p>
                  )}
                </div>

                <div>
                  <Label className="text-xs font-semibold text-slate-600">제약사항 ({formData?.constraints?.length || 0}개)</Label>
                  {isEditing ? (
                    <div className="space-y-2 mt-2">
                      {formData?.constraints?.map((constraint, index) => (
                        <div key={index} className="flex gap-2">
                          <Input 
                            value={constraint}
                            onChange={(e) => handleConstraintChange(index, e.target.value)}
                            className="flex-1"
                            data-testid={`input-difficulty-constraint-${level}-${index}`}
                          />
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => handleRemoveConstraint(index)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <i className="fas fa-times"></i>
                          </Button>
                        </div>
                      ))}
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={handleAddConstraint}
                        className="w-full"
                        data-testid={`button-add-constraint-${level}`}
                      >
                        <i className="fas fa-plus mr-2"></i>
                        제약사항 추가
                      </Button>
                    </div>
                  ) : (
                    <ul className="text-sm mt-1 space-y-1">
                      {settings?.constraints?.slice(0, 3).map((constraint, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <span className="text-slate-400">•</span>
                          <span>{constraint}</span>
                        </li>
                      ))}
                      {(settings?.constraints?.length || 0) > 3 && (
                        <li className="text-slate-500 text-xs">+{(settings?.constraints?.length || 0) - 3}개 더...</li>
                      )}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <i className="fas fa-info-circle text-blue-500 mt-1"></i>
            <div>
              <h4 className="font-semibold text-blue-800">난이도 설정 안내</h4>
              <ul className="text-sm text-blue-700 mt-2 space-y-1">
                <li>• <strong>Level 1</strong>: 처음 사용자를 위한 친절한 튜토리얼 모드</li>
                <li>• <strong>Level 2</strong>: 기본적인 대화 연습 (기본 선택 난이도)</li>
                <li>• <strong>Level 3</strong>: 논리적 근거와 설득력을 요구하는 도전 모드</li>
                <li>• <strong>Level 4</strong>: 실전과 같은 압박감, 빠른 대응이 필요한 고급 모드</li>
              </ul>
              <p className="text-sm text-blue-600 mt-2">
                변경된 설정은 새로 시작되는 대화부터 적용됩니다.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
