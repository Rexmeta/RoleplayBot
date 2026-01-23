import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Loader2, Languages, CheckCircle, AlertCircle, Bot, Save, Trash2, Plus, X, Star } from 'lucide-react';
import { SupportedLanguage } from '@shared/schema';

// 시나리오별 페르소나 컨텍스트 번역 타입
interface PersonaContextTranslation {
  personaId: string;
  position?: string;
  department?: string;
  role?: string;
  stance?: string;
  goal?: string;
  tradeoff?: string;
}

interface ScenarioTranslation {
  id: number;
  scenarioId: string;
  locale: string;
  title: string;
  description: string | null;
  situation: string | null;
  timeline: string | null;
  stakes: string | null;
  playerRole: string | null;
  objectives: string[] | null;
  skills: string[] | null;
  successCriteriaOptimal: string | null;
  successCriteriaGood: string | null;
  successCriteriaAcceptable: string | null;
  successCriteriaFailure: string | null;
  personaContexts: PersonaContextTranslation[] | null;
  isMachineTranslated: boolean;
  isReviewed: boolean;
}

interface ScenarioContext {
  situation?: string;
  timeline?: string;
  stakes?: string;
  playerRole?: string;
}

interface ScenarioSuccessCriteria {
  optimal?: string;
  good?: string;
  acceptable?: string;
  failure?: string;
}

// 시나리오에 포함된 페르소나 정보
interface ScenarioPersonaInfo {
  id: string;
  name: string;
  position?: string;
  department?: string;
  role?: string;
  stance?: string;
  goal?: string;
  tradeoff?: string;
}

interface ScenarioTranslationEditorProps {
  scenarioId: string;
  scenarioTitle: string;
  scenarioDescription: string;
  scenarioContext?: ScenarioContext;
  scenarioObjectives?: string[];
  scenarioSkills?: string[];
  scenarioSuccessCriteria?: ScenarioSuccessCriteria;
  scenarioPersonas?: ScenarioPersonaInfo[];
  sourceLocale?: string;
}

export function ScenarioTranslationEditor({ 
  scenarioId, 
  scenarioTitle, 
  scenarioDescription,
  scenarioContext = {},
  scenarioObjectives = [],
  scenarioSkills = [],
  scenarioSuccessCriteria = {},
  scenarioPersonas = [],
  sourceLocale = 'ko'
}: ScenarioTranslationEditorProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>('');
  const [translationData, setTranslationData] = useState<Record<string, Partial<ScenarioTranslation>>>({});
  const [isGenerating, setIsGenerating] = useState<string | null>(null);

  const { data: languages = [], isLoading: languagesLoading } = useQuery<SupportedLanguage[]>({
    queryKey: ['/api/languages'],
  });

  const { data: translations = [], isLoading: translationsLoading } = useQuery<ScenarioTranslation[]>({
    queryKey: ['/api/scenarios', scenarioId, 'translations'],
    enabled: !!scenarioId,
  });

  useEffect(() => {
    if (languages.length > 0 && !activeTab) {
      const targetLanguages = languages.filter(l => l.code !== sourceLocale);
      if (targetLanguages.length > 0) {
        setActiveTab(targetLanguages[0].code);
      } else if (languages.length > 0) {
        setActiveTab(sourceLocale);
      }
    }
  }, [languages, activeTab, sourceLocale]);

  useEffect(() => {
    if (translations.length > 0) {
      const data: Record<string, Partial<ScenarioTranslation>> = {};
      translations.forEach(t => {
        data[t.locale] = t;
      });
      setTranslationData(data);
    }
  }, [translations]);

  const saveMutation = useMutation({
    mutationFn: async ({ locale, data }: { locale: string; data: Partial<ScenarioTranslation> }) => {
      const res = await apiRequest('PUT', `/api/admin/scenarios/${scenarioId}/translations/${locale}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scenarios', scenarioId, 'translations'] });
      toast({ title: '저장 완료', description: '번역이 저장되었습니다.' });
    },
    onError: (error: Error) => {
      toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (locale: string) => {
      const res = await apiRequest('POST', `/api/admin/scenarios/${scenarioId}/translations/${locale}/review`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scenarios', scenarioId, 'translations'] });
      toast({ title: '검토 완료', description: '번역이 검토됨으로 표시되었습니다.' });
    },
    onError: (error: Error) => {
      toast({ title: '검토 실패', description: error.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (locale: string) => {
      const res = await apiRequest('DELETE', `/api/admin/scenarios/${scenarioId}/translations/${locale}`);
      return res.json();
    },
    onSuccess: (_, locale) => {
      queryClient.invalidateQueries({ queryKey: ['/api/scenarios', scenarioId, 'translations'] });
      setTranslationData(prev => {
        const newData = { ...prev };
        delete newData[locale];
        return newData;
      });
      toast({ title: '삭제 완료', description: '번역이 삭제되었습니다.' });
    },
    onError: (error: Error) => {
      toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
    },
  });

  const handleGenerateTranslation = async (locale: string) => {
    setIsGenerating(locale);
    try {
      const res = await apiRequest('POST', `/api/admin/scenarios/${scenarioId}/generate-translation`, {
        targetLocale: locale,
      });
      const data = await res.json();
      
      if (data.success && data.translation) {
        setTranslationData(prev => ({
          ...prev,
          [locale]: {
            ...prev[locale],
            ...data.translation,
            isMachineTranslated: true,
            isReviewed: false,
          },
        }));
        toast({ title: 'AI 번역 생성 완료', description: `${locale} 번역이 생성되었습니다.` });
      } else {
        throw new Error(data.error || '번역 생성 실패');
      }
    } catch (error: any) {
      toast({ title: 'AI 번역 실패', description: error.message, variant: 'destructive' });
    } finally {
      setIsGenerating(null);
    }
  };

  const handleSave = (locale: string) => {
    const data = translationData[locale];
    if (data) {
      saveMutation.mutate({ locale, data });
    }
  };

  const handleFieldChange = (locale: string, field: string, value: string) => {
    setTranslationData(prev => ({
      ...prev,
      [locale]: {
        ...prev[locale],
        [field]: value,
      },
    }));
  };

  const handleObjectiveChange = (locale: string, index: number, value: string) => {
    setTranslationData(prev => {
      const current = prev[locale]?.objectives || [];
      const newObjectives = [...current];
      newObjectives[index] = value;
      return {
        ...prev,
        [locale]: {
          ...prev[locale],
          objectives: newObjectives,
        },
      };
    });
  };

  const handleAddObjective = (locale: string) => {
    setTranslationData(prev => {
      const current = prev[locale]?.objectives || [];
      return {
        ...prev,
        [locale]: {
          ...prev[locale],
          objectives: [...current, ''],
        },
      };
    });
  };

  const handleRemoveObjective = (locale: string, index: number) => {
    setTranslationData(prev => {
      const current = prev[locale]?.objectives || [];
      return {
        ...prev,
        [locale]: {
          ...prev[locale],
          objectives: current.filter((_, i) => i !== index),
        },
      };
    });
  };

  // Skills (핵심역량) 핸들러
  const handleSkillChange = (locale: string, index: number, value: string) => {
    setTranslationData(prev => {
      const current = prev[locale]?.skills || [];
      const newSkills = [...current];
      newSkills[index] = value;
      return {
        ...prev,
        [locale]: {
          ...prev[locale],
          skills: newSkills,
        },
      };
    });
  };

  const handleAddSkill = (locale: string) => {
    setTranslationData(prev => {
      const current = prev[locale]?.skills || [];
      return {
        ...prev,
        [locale]: {
          ...prev[locale],
          skills: [...current, ''],
        },
      };
    });
  };

  const handleRemoveSkill = (locale: string, index: number) => {
    setTranslationData(prev => {
      const current = prev[locale]?.skills || [];
      return {
        ...prev,
        [locale]: {
          ...prev[locale],
          skills: current.filter((_, i) => i !== index),
        },
      };
    });
  };

  // 페르소나 컨텍스트 번역 핸들러
  const handlePersonaContextChange = (locale: string, personaId: string, field: string, value: string) => {
    setTranslationData(prev => {
      const currentContexts = prev[locale]?.personaContexts || [];
      const existingIndex = currentContexts.findIndex(c => c.personaId === personaId);
      
      let newContexts: PersonaContextTranslation[];
      if (existingIndex >= 0) {
        newContexts = [...currentContexts];
        newContexts[existingIndex] = { ...newContexts[existingIndex], [field]: value };
      } else {
        newContexts = [...currentContexts, { personaId, [field]: value }];
      }
      
      return {
        ...prev,
        [locale]: {
          ...prev[locale],
          personaContexts: newContexts,
        },
      };
    });
  };

  const getPersonaContext = (locale: string, personaId: string): PersonaContextTranslation => {
    const contexts = translationData[locale]?.personaContexts || [];
    return contexts.find(c => c.personaId === personaId) || { personaId };
  };

  if (languagesLoading || translationsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sourceLanguage = languages.find(l => l.code === sourceLocale);
  const targetLanguages = languages.filter(l => l.code !== sourceLocale);
  const originalTranslation = translationData[sourceLocale] || {};

  if (languages.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Languages className="h-8 w-8 mx-auto mb-2" />
          <p>지원 언어가 없습니다.</p>
          <p className="text-sm">시스템 설정에서 지원 언어를 추가하세요.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-h-[80vh]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Languages className="h-5 w-5" />
          다국어 번역 - 전체 필드
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 flex-wrap">
            {sourceLanguage && (
              <TabsTrigger
                value={sourceLocale}
                className="flex items-center gap-2"
              >
                <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                {sourceLanguage.nativeName}
                <Badge variant="secondary" className="text-xs px-1.5 py-0">원어</Badge>
              </TabsTrigger>
            )}
            {targetLanguages.map((lang) => {
              const translation = translationData[lang.code];
              const hasTranslation = !!translation?.title;
              const isReviewed = translation?.isReviewed;
              const isMachine = translation?.isMachineTranslated && !isReviewed;

              return (
                <TabsTrigger
                  key={lang.code}
                  value={lang.code}
                  className="flex items-center gap-2"
                >
                  {lang.nativeName}
                  {hasTranslation && (
                    isReviewed ? (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    ) : isMachine ? (
                      <AlertCircle className="h-3 w-3 text-amber-500" />
                    ) : null
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {sourceLanguage && (
            <TabsContent key={sourceLocale} value={sourceLocale} className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <Badge variant="secondary" className="text-yellow-700 bg-yellow-100 border-yellow-200">
                  <Star className="h-3 w-3 mr-1 fill-yellow-500" />
                  원어 (원본 데이터)
                </Badge>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleSave(sourceLocale)}
                  disabled={saveMutation.isPending}
                >
                  <Save className="h-4 w-4 mr-2" />
                  저장
                </Button>
              </div>

              <ScrollArea className="h-[60vh] pr-4">
                <div className="grid gap-6">
                  <div className="space-y-4">
                    <h4 className="font-semibold text-sm text-slate-700 border-b pb-2">기본 정보</h4>
                    
                    <div className="space-y-2">
                      <Label>제목</Label>
                      <Input
                        value={originalTranslation.title || scenarioTitle || ''}
                        onChange={(e) => handleFieldChange(sourceLocale, 'title', e.target.value)}
                        placeholder="제목 입력..."
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>설명</Label>
                      <Textarea
                        value={originalTranslation.description || scenarioDescription || ''}
                        onChange={(e) => handleFieldChange(sourceLocale, 'description', e.target.value)}
                        placeholder="설명 입력..."
                        rows={3}
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h4 className="font-semibold text-sm text-slate-700 border-b pb-2">상황 설정 (Context)</h4>
                    
                    <div className="space-y-2">
                      <Label>상황 설명</Label>
                      <Textarea
                        value={originalTranslation.situation || scenarioContext?.situation || ''}
                        onChange={(e) => handleFieldChange(sourceLocale, 'situation', e.target.value)}
                        placeholder="상황 설명..."
                        rows={2}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>시간적 제약</Label>
                      <Input
                        value={originalTranslation.timeline || scenarioContext?.timeline || ''}
                        onChange={(e) => handleFieldChange(sourceLocale, 'timeline', e.target.value)}
                        placeholder="시간적 제약..."
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>이해관계</Label>
                      <Input
                        value={originalTranslation.stakes || scenarioContext?.stakes || ''}
                        onChange={(e) => handleFieldChange(sourceLocale, 'stakes', e.target.value)}
                        placeholder="이해관계..."
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>플레이어 역할</Label>
                      <Input
                        value={originalTranslation.playerRole || scenarioContext?.playerRole || ''}
                        onChange={(e) => handleFieldChange(sourceLocale, 'playerRole', e.target.value)}
                        placeholder="플레이어 역할..."
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h4 className="font-semibold text-sm text-slate-700 border-b pb-2">목표 (Objectives)</h4>
                    <div className="flex items-center justify-between">
                      <Label>목표 목록</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleAddObjective(sourceLocale)}
                        className="h-6 px-2"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        추가
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {(originalTranslation.objectives || scenarioObjectives || []).map((obj, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-4">{idx + 1}.</span>
                          <Input
                            value={obj}
                            onChange={(e) => handleObjectiveChange(sourceLocale, idx, e.target.value)}
                            placeholder={`목표 ${idx + 1}...`}
                            className="flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveObjective(sourceLocale, idx)}
                            className="h-8 w-8 p-0"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
          )}

          {targetLanguages.map((lang) => {
            const translation = translationData[lang.code] || {};
            const isReviewed = translation.isReviewed;
            const isMachine = translation.isMachineTranslated;
            const objectives = translation.objectives || [];
            const origTitle = originalTranslation.title || scenarioTitle;
            const origDescription = originalTranslation.description || scenarioDescription;
            const origSituation = originalTranslation.situation || scenarioContext?.situation;
            const origTimeline = originalTranslation.timeline || scenarioContext?.timeline;
            const origStakes = originalTranslation.stakes || scenarioContext?.stakes;
            const origPlayerRole = originalTranslation.playerRole || scenarioContext?.playerRole;
            const origObjectives = originalTranslation.objectives || scenarioObjectives || [];

            return (
              <TabsContent key={lang.code} value={lang.code} className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    {translation.title && (
                      <>
                        {isReviewed && (
                          <Badge variant="outline" className="text-green-600 border-green-200">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            검토됨
                          </Badge>
                        )}
                        {isMachine && !isReviewed && (
                          <Badge variant="outline" className="text-amber-600 border-amber-200">
                            <Bot className="h-3 w-3 mr-1" />
                            AI 번역
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleGenerateTranslation(lang.code)}
                      disabled={isGenerating === lang.code}
                    >
                      {isGenerating === lang.code ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Bot className="h-4 w-4 mr-2" />
                      )}
                      AI 번역 생성
                    </Button>
                    {translation.title && !isReviewed && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => reviewMutation.mutate(lang.code)}
                        disabled={reviewMutation.isPending}
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        검토 완료
                      </Button>
                    )}
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleSave(lang.code)}
                      disabled={saveMutation.isPending}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      저장
                    </Button>
                    {translation.title && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteMutation.mutate(lang.code)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <ScrollArea className="h-[60vh] pr-4">
                  <div className="grid gap-6">
                    <div className="space-y-4">
                      <h4 className="font-semibold text-sm text-slate-700 border-b pb-2">기본 정보</h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">원본 제목 ({sourceLanguage?.nativeName})</Label>
                          <div className="p-2 bg-muted rounded text-sm">{origTitle}</div>
                        </div>
                        <div className="space-y-2">
                          <Label>번역 제목 ({lang.name})</Label>
                          <Input
                            value={translation.title || ''}
                            onChange={(e) => handleFieldChange(lang.code, 'title', e.target.value)}
                            placeholder={`${lang.nativeName} 제목 입력...`}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">원본 설명 ({sourceLanguage?.nativeName})</Label>
                          <div className="p-2 bg-muted rounded text-sm min-h-[80px] whitespace-pre-wrap">{origDescription}</div>
                        </div>
                        <div className="space-y-2">
                          <Label>번역 설명 ({lang.name})</Label>
                          <Textarea
                            value={translation.description || ''}
                            onChange={(e) => handleFieldChange(lang.code, 'description', e.target.value)}
                            placeholder={`${lang.nativeName} 설명 입력...`}
                            rows={3}
                          />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-4">
                      <h4 className="font-semibold text-sm text-slate-700 border-b pb-2">상황 설정 (Context)</h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">원본 상황 설명</Label>
                          <div className="p-2 bg-muted rounded text-sm min-h-[60px] whitespace-pre-wrap">
                            {origSituation || '(미설정)'}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>번역 상황 설명 ({lang.name})</Label>
                          <Textarea
                            value={translation.situation || ''}
                            onChange={(e) => handleFieldChange(lang.code, 'situation', e.target.value)}
                            placeholder={`${lang.nativeName} 상황 설명...`}
                            rows={2}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">원본 시간적 제약</Label>
                          <div className="p-2 bg-muted rounded text-sm min-h-[40px]">
                            {origTimeline || '(미설정)'}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>번역 시간적 제약 ({lang.name})</Label>
                          <Input
                            value={translation.timeline || ''}
                            onChange={(e) => handleFieldChange(lang.code, 'timeline', e.target.value)}
                            placeholder={`${lang.nativeName} 시간적 제약...`}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">원본 이해관계</Label>
                          <div className="p-2 bg-muted rounded text-sm min-h-[40px]">
                            {scenarioContext?.stakes || '(미설정)'}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>번역 이해관계 ({lang.name})</Label>
                          <Input
                            value={translation.stakes || ''}
                            onChange={(e) => handleFieldChange(lang.code, 'stakes', e.target.value)}
                            placeholder={`${lang.nativeName} 이해관계...`}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">원본 플레이어 역할</Label>
                          <div className="p-2 bg-muted rounded text-sm min-h-[40px]">
                            {scenarioContext?.playerRole || '(미설정)'}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>번역 플레이어 역할 ({lang.name})</Label>
                          <Input
                            value={translation.playerRole || ''}
                            onChange={(e) => handleFieldChange(lang.code, 'playerRole', e.target.value)}
                            placeholder={`${lang.nativeName} 플레이어 역할...`}
                          />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-4">
                      <h4 className="font-semibold text-sm text-slate-700 border-b pb-2">목표 (Objectives)</h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">원본 목표</Label>
                          <div className="p-2 bg-muted rounded text-sm space-y-1">
                            {scenarioObjectives.length > 0 ? (
                              scenarioObjectives.map((obj, idx) => (
                                <div key={idx} className="flex items-start gap-2">
                                  <span className="text-xs text-muted-foreground">{idx + 1}.</span>
                                  <span>{obj}</span>
                                </div>
                              ))
                            ) : (
                              <span className="text-muted-foreground">(목표 미설정)</span>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="flex items-center justify-between">
                            <span>번역 목표 ({lang.name})</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleAddObjective(lang.code)}
                              className="h-6 px-2"
                            >
                              <Plus className="h-3 w-3 mr-1" />
                              추가
                            </Button>
                          </Label>
                          <div className="space-y-2">
                            {objectives.length > 0 ? (
                              objectives.map((obj, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground w-4">{idx + 1}.</span>
                                  <Input
                                    value={obj}
                                    onChange={(e) => handleObjectiveChange(lang.code, idx, e.target.value)}
                                    placeholder={`목표 ${idx + 1}...`}
                                    className="flex-1"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemoveObjective(lang.code, idx)}
                                    className="h-8 w-8 p-0"
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ))
                            ) : (
                              <p className="text-sm text-muted-foreground">번역할 목표를 추가하세요</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* 핵심역량 (Skills) 번역 섹션 */}
                    <div className="space-y-4">
                      <h4 className="font-semibold text-sm text-slate-700 border-b pb-2">핵심역량 (Key Competencies)</h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">원본 핵심역량</Label>
                          <div className="p-2 bg-slate-50 border rounded text-sm min-h-[60px]">
                            {scenarioSkills.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {scenarioSkills.map((skill, idx) => (
                                  <Badge key={idx} variant="secondary" className="text-xs">{skill}</Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">(미설정)</span>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label>번역 핵심역량 ({lang.name})</Label>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleAddSkill(lang.code)}
                              className="h-6 px-2"
                            >
                              <Plus className="h-3 w-3 mr-1" />
                              추가
                            </Button>
                          </div>
                          <div className="space-y-2 max-h-[200px] overflow-y-auto">
                            {(translation.skills || []).length > 0 ? (
                              (translation.skills || []).map((skill, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground w-4">{idx + 1}.</span>
                                  <Input
                                    value={skill}
                                    onChange={(e) => handleSkillChange(lang.code, idx, e.target.value)}
                                    placeholder={`역량 ${idx + 1}...`}
                                    className="flex-1 h-8"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemoveSkill(lang.code, idx)}
                                    className="h-8 w-8 p-0"
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              ))
                            ) : (
                              <p className="text-sm text-muted-foreground">번역할 핵심역량을 추가하세요</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-4">
                      <h4 className="font-semibold text-sm text-slate-700 border-b pb-2">성공 기준 (Success Criteria)</h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">원본 최적 (Optimal)</Label>
                          <div className="p-2 bg-green-50 border border-green-200 rounded text-sm min-h-[40px]">
                            {scenarioSuccessCriteria?.optimal || '(미설정)'}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-green-700">번역 최적 ({lang.name})</Label>
                          <Textarea
                            value={translation.successCriteriaOptimal || ''}
                            onChange={(e) => handleFieldChange(lang.code, 'successCriteriaOptimal', e.target.value)}
                            placeholder={`${lang.nativeName} 최적 기준...`}
                            rows={2}
                            className="border-green-200 focus:border-green-400"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">원본 양호 (Good)</Label>
                          <div className="p-2 bg-blue-50 border border-blue-200 rounded text-sm min-h-[40px]">
                            {scenarioSuccessCriteria?.good || '(미설정)'}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-blue-700">번역 양호 ({lang.name})</Label>
                          <Textarea
                            value={translation.successCriteriaGood || ''}
                            onChange={(e) => handleFieldChange(lang.code, 'successCriteriaGood', e.target.value)}
                            placeholder={`${lang.nativeName} 양호 기준...`}
                            rows={2}
                            className="border-blue-200 focus:border-blue-400"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">원본 수용가능 (Acceptable)</Label>
                          <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-sm min-h-[40px]">
                            {scenarioSuccessCriteria?.acceptable || '(미설정)'}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-yellow-700">번역 수용가능 ({lang.name})</Label>
                          <Textarea
                            value={translation.successCriteriaAcceptable || ''}
                            onChange={(e) => handleFieldChange(lang.code, 'successCriteriaAcceptable', e.target.value)}
                            placeholder={`${lang.nativeName} 수용가능 기준...`}
                            rows={2}
                            className="border-yellow-200 focus:border-yellow-400"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">원본 실패 (Failure)</Label>
                          <div className="p-2 bg-red-50 border border-red-200 rounded text-sm min-h-[40px]">
                            {scenarioSuccessCriteria?.failure || '(미설정)'}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-red-700">번역 실패 ({lang.name})</Label>
                          <Textarea
                            value={translation.successCriteriaFailure || ''}
                            onChange={(e) => handleFieldChange(lang.code, 'successCriteriaFailure', e.target.value)}
                            placeholder={`${lang.nativeName} 실패 기준...`}
                            rows={2}
                            className="border-red-200 focus:border-red-400"
                          />
                        </div>
                      </div>
                    </div>

                    {/* 시나리오별 페르소나 컨텍스트 번역 섹션 */}
                    {scenarioPersonas.length > 0 && (
                      <>
                        <Separator />
                        <div className="space-y-4">
                          <h4 className="font-semibold text-sm text-slate-700 border-b pb-2">
                            페르소나 컨텍스트 번역 (Persona Contexts)
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            시나리오에서 정의된 페르소나의 직책, 부서, 역할, 입장, 목표, 협상범위를 번역합니다.
                          </p>
                          
                          {scenarioPersonas.map((persona) => {
                            const ctx = getPersonaContext(lang.code, persona.id);
                            return (
                              <div key={persona.id} className="border rounded-lg p-4 space-y-3 bg-slate-50">
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                                  <span className="bg-primary/10 text-primary px-2 py-1 rounded">{persona.name || persona.id}</span>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-muted-foreground text-xs">원본 직책</Label>
                                    <div className="p-2 bg-white border rounded text-sm min-h-[32px]">{persona.position || '-'}</div>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">직책 ({lang.nativeName})</Label>
                                    <Input
                                      value={ctx.position || ''}
                                      onChange={(e) => handlePersonaContextChange(lang.code, persona.id, 'position', e.target.value)}
                                      placeholder={`${lang.nativeName} 직책...`}
                                      className="h-8"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-muted-foreground text-xs">원본 부서</Label>
                                    <div className="p-2 bg-white border rounded text-sm min-h-[32px]">{persona.department || '-'}</div>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">부서 ({lang.nativeName})</Label>
                                    <Input
                                      value={ctx.department || ''}
                                      onChange={(e) => handlePersonaContextChange(lang.code, persona.id, 'department', e.target.value)}
                                      placeholder={`${lang.nativeName} 부서...`}
                                      className="h-8"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-muted-foreground text-xs">원본 역할</Label>
                                    <div className="p-2 bg-white border rounded text-sm min-h-[32px]">{persona.role || '-'}</div>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">역할 ({lang.nativeName})</Label>
                                    <Input
                                      value={ctx.role || ''}
                                      onChange={(e) => handlePersonaContextChange(lang.code, persona.id, 'role', e.target.value)}
                                      placeholder={`${lang.nativeName} 역할...`}
                                      className="h-8"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-muted-foreground text-xs">원본 입장/태도</Label>
                                    <div className="p-2 bg-white border rounded text-sm min-h-[40px] whitespace-pre-wrap">{persona.stance || '-'}</div>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">입장/태도 ({lang.nativeName})</Label>
                                    <Textarea
                                      value={ctx.stance || ''}
                                      onChange={(e) => handlePersonaContextChange(lang.code, persona.id, 'stance', e.target.value)}
                                      placeholder={`${lang.nativeName} 입장/태도...`}
                                      rows={2}
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-muted-foreground text-xs">원본 목표</Label>
                                    <div className="p-2 bg-white border rounded text-sm min-h-[40px] whitespace-pre-wrap">{persona.goal || '-'}</div>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">목표 ({lang.nativeName})</Label>
                                    <Textarea
                                      value={ctx.goal || ''}
                                      onChange={(e) => handlePersonaContextChange(lang.code, persona.id, 'goal', e.target.value)}
                                      placeholder={`${lang.nativeName} 목표...`}
                                      rows={2}
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-muted-foreground text-xs">원본 협상 가능 범위</Label>
                                    <div className="p-2 bg-white border rounded text-sm min-h-[40px] whitespace-pre-wrap">{persona.tradeoff || '-'}</div>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">협상 가능 범위 ({lang.nativeName})</Label>
                                    <Textarea
                                      value={ctx.tradeoff || ''}
                                      onChange={(e) => handlePersonaContextChange(lang.code, persona.id, 'tradeoff', e.target.value)}
                                      placeholder={`${lang.nativeName} 협상 가능 범위...`}
                                      rows={2}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            );
          })}
        </Tabs>
      </CardContent>
    </Card>
  );
}
