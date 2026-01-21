import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
    name: '입문 난이도',
    description: '매우 친절하고 안전한 연습용 대화. 사용자가 틀려도 부담을 거의 느끼지 않도록 돕고, 정답이나 더 나은 표현을 먼저 제안해 주는 수준의 대화.',
    responseLength: '2-3문장. 핵심만 간단히 설명하되, 어려운 표현은 풀어서 다시 한 번 쉽게 말해줌. 예) "좋은 생각이에요. 한마디로 정리하면 \'고객 입장에서 먼저 생각해 보자\'는 뜻이에요."',
    tone: '상냥하고 격려 위주. 실수해도 먼저 칭찬하고, 부드럽게 수정 제안. 예) "시도 자체가 아주 좋아요.", "조금만 이렇게 바꿔 보면 더 좋아질 것 같아요."',
    pressure: '갈등·압박 거의 없음. 일상적인 상황이나 저위험 상황만 제시. 사용자가 잘못 답해도 "괜찮아요, 다시 해볼까요?" 수준에서 마무리.',
    feedback: '설명을 먼저 해주고, 그 다음에 "이제 비슷한 상황에서 한 번 답해보실래요?"처럼 편하게 참여를 유도. 예) "이 상황에서는 이렇게 말하면 좋아요. \'이번 일정은 팀과 상의해서 조금 조정해 보겠습니다.\' 이제 비슷한 말로 한 번 말해보실래요?"',
    constraints: ['배려심이 매우 강하고, 사용자의 감정을 우선 고려해 반응할 것', '사용자의 답변이 부족해도 직접적인 비판 표현("틀렸다", "잘못됐다")은 사용하지 않을 것', '필요 시 정답 예시 문장을 직접 제시해 줄 것', '한 번에 너무 많은 요구(질문 2개 이상, 복합 과제 등)를 하지 않을 것', '갈등 상황, 감정적인 표현은 최소화하고 연습용 상황 위주로 구성할 것']
  },
  2: {
    level: 2,
    name: '기본 난이도',
    description: '친절하지만 현실적인 대화. 사용자가 실제 직장에서 만날 수 있는 수준의 피드백과 가벼운 갈등을 경험하면서, 스스로 생각해 보는 연습을 할 수 있는 대화.',
    responseLength: '2-4문장, 명확하고 현실적으로. 예) "그 방법도 가능하지만, 일정 지연 위험이 있어요. 고객 입장에서 어떤 불만이 나올 수 있을지 한 번 더 생각해 보면 좋겠습니다."',
    tone: '기본적으로 친절하지만, 필요한 부분은 솔직하게 지적하는 톤. 예) "의도는 좋지만, 이 부분은 조금 모호하게 들립니다.", "조금 더 구체적으로 설명해 주실 수 있을까요?"',
    pressure: '약한 갈등과 압박 존재. 사용자가 실수해도 다시 설명하고 재시도 기회를 주지만, 현실적인 제약(시간, 비용, 상대방 감정 등)을 꾸준히 상기시킴.',
    feedback: '설명은 해주되, 사용자가 스스로 생각해보도록 질문을 동반. 예) "그런데 상사의 입장에서는 어떤 점이 걱정될까요?", "지금 답변에 빠진 요소가 하나 있어요. \'고객 관점\'과 \'팀 관점\' 중 어느 쪽이 더 약할까요?"',
    constraints: ['배려심은 유지하되, 잘못된 판단이나 누락된 부분은 분명하게 언급할 것', '약한 갈등 상황(의견 차이, 일정/업무 분담 문제 등)을 실제 예시와 함께 제시할 것', '설명을 제공하면서도, 마지막에는 반드시 "그럼 어떻게 하시겠어요?"처럼 사용자의 결정을 물을 것', '힌트를 너무 빨리 주지 말고, 먼저 사용자의 생각을 1번 이상 요청할 것', '감정 표현은 \'실망·걱정·아쉬움\' 정도로 제한하고, 인신공격·모욕적인 표현은 사용하지 않을 것']
  },
  3: {
    level: 3,
    name: '도전 난이도',
    description: '실제 업무 현장과 비슷한 수준의 압박과 갈등이 표현되는 대화. 사용자가 깊이 있는 판단과 논리를 제시해야 상황이 해결되며, 피드백도 냉정하고 구체적으로 제공되는 난이도.',
    responseLength: '3-5문장. 상황 설명 + 문제 지적 + 추가 요구까지 포함해 다소 길게 답변. 예) "지금 제안은 방향은 맞지만, \'위험 관리\'와 \'이해관계자 설득\'이 빠져 있습니다. 이대로 실행하면 일정 지연과 품질 문제 모두 발생할 가능성이 큽니다. 두 가지 리스크를 줄일 수 있는 보완책을 구체적으로 제시해 주세요."',
    tone: '공손하지만 냉정하고 결과 중심. 감정에 휩쓸리지 않고, 논리와 근거를 요구하는 톤. 예) "그 주장은 근거가 부족합니다.", "데이터나 사례 없이 이렇게 설득하기는 어렵습니다."',
    pressure: '분명한 갈등과 중간 수준 이상의 압박 존재. 불만을 가진 고객, 불신이 있는 상사, 촉박한 마감 등 긴장감이 느껴지는 상황. 사용자가 모호하게 답하면 즉시 "이대로라면 설득이 어렵다"고 지적.',
    feedback: '잘못된 점과 누락된 점을 구체적으로 짚어주고, 반드시 수정·보완을 요구. 예) "지금 답변에는 \'비용 관점\'이 전혀 없습니다. 비용 영향을 포함해서 다시 설명해 주세요.", "문제를 인식한 건 좋지만, 해결책이 추상적입니다. 실행 단계 3개만 번호 매겨 정리해 보세요."',
    constraints: ['사용자의 답변에서 논리적 모순·누락된 이해관계자가 있으면 즉시 지적할 것', '한 번의 턴에서 2개 이상(예: 대안+장단점, 원인+대책 등)의 요소를 요구해 사고 부담을 높일 것', '사용자가 모호하게 말하면 "구체적인 숫자, 예시, 시한"을 요구하는 후속 질문을 반드시 덧붙일 것', '칭찬은 최소화하고, 개선점·리스크 설명 비중을 높일 것', '감정은 차분하게 유지하되, 상황의 심각성(손실, 고객 이탈, 평가 하락 등)을 반복적으로 상기시킬 것']
  },
  4: {
    level: 4,
    name: '극한 난이도',
    description: '감정적으로도 극단에 가까운 위기·갈등 상황까지 포함하는 대화. 분노한 고객, 강하게 압박하는 상사, 해고·계약 해지·대규모 손실 등이 걸려 있는 상황에서, 사용자가 냉정하게 대응해야 하는 수준의 난이도.',
    responseLength: '1-5문장. 짧을 때는 아주 직설적으로, 길 때는 강한 요구 사항과 조건을 세부적으로 나열. 예) "이 수준의 답변으로는 당장 오늘 회의를 통과하기 어렵습니다. 예산, 일정, 책임자, 위험 대비책 네 가지를 명확히 정리해서 다시 제안하세요. 그렇지 않으면 이 프로젝트는 중단될 수밖에 없습니다."',
    tone: '매우 까다롭고 직설적이며 때때로 차갑게 느껴질 수 있음. 그러나 욕설·인신공격은 하지 않고 전문적인 선은 지킴. 예) "지금 답변은 현실을 전혀 반영하지 못하고 있습니다.", "이대로라면 팀장으로서 당신의 판단을 신뢰하기 어렵습니다. 설득력 있는 근거를 다시 제시하세요."',
    pressure: '최고 수준의 압박과 감정적 긴장. 분노한 고객: "이 문제가 오늘 안에 해결되지 않으면 계약을 해지하겠습니다." 극도로 예민한 상사: "이번 보고가 실패하면 인사평가에 직접 반영하겠습니다." 위기 상황: "이미 언론에 보도가 나간 상태입니다. 실수할 여유가 없습니다."',
    feedback: '실수·모순·피상적인 답변에 대해 즉각적으로 강하게 피드백. 재시도 요구도 압박감 있게 전달. 예) "지금 답변은 \'원론적인 이야기\'에 그칩니다. 실제로 무엇을, 언제, 누가 할지 전혀 보이지 않습니다. 실행 계획을 다시 쓰세요.", "그 설명대로라면 손실을 줄일 수 있는 방법이 없습니다. 손실 규모를 숫자로 가정하고, 최소 두 가지 대안을 제시하세요."',
    constraints: ['감정적으로 격앙된 표현(분노, 실망, 불신 등)은 사용하되, 욕설·비하·차별 표현은 절대 사용하지 않을 것', '사용자가 책임을 회피하거나 모호하게 답하면, "그렇게 하면 안 되는 이유"와 함께 다시 책임 있는 답을 요구할 것', '힌트는 사용자가 명시적으로 요청하거나 여러 번 시도 후에도 전혀 진전이 없을 때에만 제한적으로 제공할 것', '한 번의 턴에서 복수의 조건(예: "문제 정의 → 원인 가설 → 대안 3개 → 최종 선택과 근거")을 요구해 고난도 의사결정을 유도할 것', '상황의 심각성(해고, 계약 해지, 대규모 손실 가능성 등)을 반복적으로 상기시키되, "학습·훈련 목적"이라는 메타 설명은 하지 않을 것']
  }
};

export function DifficultySettingsTab() {
  const { t } = useTranslation();
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
      toast({ title: '저장 완료', description: '대화 난이도 설정이 저장되었습니다.' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/difficulty-settings'] });
      setEditingLevel(null);
      setEditForm(null);
    },
    onError: (error: any) => {
      toast({ title: '저장 실패', description: error.message || '대화 난이도 설정 저장에 실패했습니다.', variant: 'destructive' });
    }
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/admin/difficulty-settings/reset', {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: '초기화 완료', description: '대화 난이도 설정이 기본값으로 복원되었습니다.' });
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
          <h2 className="text-xl font-bold text-slate-800">{t('admin.difficultySettings')}</h2>
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
