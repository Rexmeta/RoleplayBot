import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Loader2, Languages, CheckCircle, AlertCircle, Bot, Save, Trash2 } from 'lucide-react';
import { SupportedLanguage } from '@shared/schema';

interface ScenarioTranslation {
  id: number;
  scenarioId: string;
  locale: string;
  title: string;
  description: string;
  contextSituation: string | null;
  contextTimeline: string | null;
  contextStakes: string | null;
  objectives: string[];
  successCriteriaOptimal: string | null;
  successCriteriaGood: string | null;
  successCriteriaAcceptable: string | null;
  successCriteriaFailure: string | null;
  isMachineTranslated: boolean;
  isReviewed: boolean;
}

interface ScenarioTranslationEditorProps {
  scenarioId: string;
  scenarioTitle: string;
  scenarioDescription: string;
}

export function ScenarioTranslationEditor({ scenarioId, scenarioTitle, scenarioDescription }: ScenarioTranslationEditorProps) {
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
      const nonDefault = languages.filter(l => !l.isDefault);
      if (nonDefault.length > 0) {
        setActiveTab(nonDefault[0].code);
      }
    }
  }, [languages, activeTab]);

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

  if (languagesLoading || translationsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const nonDefaultLanguages = languages.filter(l => !l.isDefault);

  if (nonDefaultLanguages.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Languages className="h-8 w-8 mx-auto mb-2" />
          <p>번역할 언어가 없습니다.</p>
          <p className="text-sm">시스템 설정에서 지원 언어를 추가하세요.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="h-5 w-5" />
          다국어 번역
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            {nonDefaultLanguages.map((lang) => {
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

          {nonDefaultLanguages.map((lang) => {
            const translation = translationData[lang.code] || {};
            const isReviewed = translation.isReviewed;
            const isMachine = translation.isMachineTranslated;

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

                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-muted-foreground text-xs">원본 제목 (한국어)</Label>
                      <div className="p-2 bg-muted rounded text-sm">{scenarioTitle}</div>
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
                      <Label className="text-muted-foreground text-xs">원본 설명 (한국어)</Label>
                      <div className="p-2 bg-muted rounded text-sm min-h-[80px]">{scenarioDescription}</div>
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

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-muted-foreground text-xs">상황 설명</Label>
                    </div>
                    <div className="space-y-2">
                      <Label>번역 상황 설명</Label>
                      <Textarea
                        value={translation.contextSituation || ''}
                        onChange={(e) => handleFieldChange(lang.code, 'contextSituation', e.target.value)}
                        placeholder={`${lang.nativeName} 상황 설명...`}
                        rows={2}
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      </CardContent>
    </Card>
  );
}
