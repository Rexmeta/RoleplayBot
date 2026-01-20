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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Loader2, Languages, CheckCircle, AlertCircle, Bot, Save, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { SupportedLanguage } from '@shared/schema';

interface PersonaTranslation {
  id: number;
  personaId: string;
  sourceLocale: string;
  locale: string;
  name: string;
  position: string | null;
  department: string | null;
  role: string | null;
  stance: string | null;
  goal: string | null;
  tradeoff: string | null;
  personalityTraits: string[] | null;
  communicationStyle: string | null;
  motivation: string | null;
  fears: string[] | null;
  personalityDescription: string | null;
  education: string | null;
  previousExperience: string | null;
  majorProjects: string[] | null;
  expertise: string[] | null;
  background: string | null;
  isMachineTranslated: boolean;
  isReviewed: boolean;
}

interface PersonaSourceData {
  name: string;
  position?: string;
  department?: string;
  role?: string;
  stance?: string;
  goal?: string;
  tradeoff?: string;
  mbti?: string;
  personality?: {
    traits?: string[];
    communicationStyle?: string;
    motivation?: string;
    fears?: string[];
  };
  background?: {
    education?: string;
    previousExperience?: string;
    majorProjects?: string[];
    expertise?: string[];
  } | string;
}

interface PersonaTranslationEditorProps {
  personaId: string;
  personaMbti: string;
  personaTraits: string[];
  sourceData?: PersonaSourceData;
}

export function PersonaTranslationEditor({ 
  personaId, 
  personaMbti, 
  personaTraits,
  sourceData
}: PersonaTranslationEditorProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>('');
  const [translationData, setTranslationData] = useState<Record<string, Partial<PersonaTranslation>>>({});
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    basic: true,
    context: true,
    personality: true,
    background: true
  });

  const { data: languages = [], isLoading: languagesLoading } = useQuery<SupportedLanguage[]>({
    queryKey: ['/api/languages'],
  });

  const { data: translations = [], isLoading: translationsLoading } = useQuery<PersonaTranslation[]>({
    queryKey: ['/api/personas', personaId, 'translations'],
    enabled: !!personaId,
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
      const data: Record<string, Partial<PersonaTranslation>> = {};
      translations.forEach(t => {
        data[t.locale] = t;
      });
      setTranslationData(data);
    }
  }, [translations]);

  const saveMutation = useMutation({
    mutationFn: async ({ locale, data }: { locale: string; data: Partial<PersonaTranslation> }) => {
      const res = await apiRequest('PUT', `/api/admin/personas/${personaId}/translations/${locale}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/personas', personaId, 'translations'] });
      toast({ title: '저장 완료', description: '번역이 저장되었습니다.' });
    },
    onError: (error: Error) => {
      toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (locale: string) => {
      const res = await apiRequest('POST', `/api/admin/personas/${personaId}/translations/${locale}/review`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/personas', personaId, 'translations'] });
      toast({ title: '검토 완료', description: '번역이 검토됨으로 표시되었습니다.' });
    },
    onError: (error: Error) => {
      toast({ title: '검토 실패', description: error.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (locale: string) => {
      const res = await apiRequest('DELETE', `/api/admin/personas/${personaId}/translations/${locale}`);
      return res.json();
    },
    onSuccess: (_, locale) => {
      queryClient.invalidateQueries({ queryKey: ['/api/personas', personaId, 'translations'] });
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
      const res = await apiRequest('POST', `/api/admin/personas/${personaId}/generate-translation`, {
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

  const handleFieldChange = (locale: string, field: string, value: string | string[]) => {
    setTranslationData(prev => ({
      ...prev,
      [locale]: {
        ...prev[locale],
        [field]: value,
      },
    }));
  };

  const handleArrayFieldChange = (locale: string, field: string, value: string) => {
    const items = value.split('\n').filter(item => item.trim());
    handleFieldChange(locale, field, items);
  };

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
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

  const getSourceBackground = (): string => {
    if (!sourceData?.background) return '';
    if (typeof sourceData.background === 'string') return sourceData.background;
    const bg = sourceData.background as any;
    const parts: string[] = [];
    if (bg.education) parts.push(`학력: ${bg.education}`);
    if (bg.previousExperience) parts.push(`경력: ${bg.previousExperience}`);
    if (bg.majorProjects?.length) parts.push(`주요 프로젝트: ${bg.majorProjects.join(', ')}`);
    if (bg.expertise?.length) parts.push(`전문분야: ${bg.expertise.join(', ')}`);
    return parts.join('\n');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="h-5 w-5" />
          다국어 번역 - {personaMbti} ({sourceData?.name || ''})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 flex-wrap">
            {nonDefaultLanguages.map((lang) => {
              const translation = translationData[lang.code];
              const hasTranslation = !!translation?.name;
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
              <TabsContent key={lang.code} value={lang.code}>
                <ScrollArea className="h-[600px] pr-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-4 sticky top-0 bg-background z-10 py-2">
                      <div className="flex items-center gap-2">
                        {translation.name && (
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
                        {translation.name && !isReviewed && (
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
                        {translation.name && (
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

                    <Collapsible open={openSections.basic} onOpenChange={() => toggleSection('basic')}>
                      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 bg-muted rounded-t hover:bg-muted/80">
                        {openSections.basic ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        <span className="font-medium">기본 정보</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="border border-t-0 rounded-b p-4 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 이름</Label>
                            <div className="p-2 bg-muted rounded text-sm">{sourceData?.name || personaMbti}</div>
                          </div>
                          <div className="space-y-2">
                            <Label>이름 ({lang.nativeName}) *</Label>
                            <Input
                              value={translation.name || ''}
                              onChange={(e) => handleFieldChange(lang.code, 'name', e.target.value)}
                              placeholder={`${lang.nativeName} 이름 입력...`}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 직책</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[38px]">{sourceData?.position || '-'}</div>
                          </div>
                          <div className="space-y-2">
                            <Label>직책 ({lang.nativeName})</Label>
                            <Input
                              value={translation.position || ''}
                              onChange={(e) => handleFieldChange(lang.code, 'position', e.target.value)}
                              placeholder={`${lang.nativeName} 직책...`}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 부서</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[38px]">{sourceData?.department || '-'}</div>
                          </div>
                          <div className="space-y-2">
                            <Label>부서 ({lang.nativeName})</Label>
                            <Input
                              value={translation.department || ''}
                              onChange={(e) => handleFieldChange(lang.code, 'department', e.target.value)}
                              placeholder={`${lang.nativeName} 부서...`}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 역할</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[38px]">{sourceData?.role || '-'}</div>
                          </div>
                          <div className="space-y-2">
                            <Label>역할 ({lang.nativeName})</Label>
                            <Input
                              value={translation.role || ''}
                              onChange={(e) => handleFieldChange(lang.code, 'role', e.target.value)}
                              placeholder={`${lang.nativeName} 역할...`}
                            />
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    <Collapsible open={openSections.context} onOpenChange={() => toggleSection('context')}>
                      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 bg-muted rounded-t hover:bg-muted/80">
                        {openSections.context ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        <span className="font-medium">시나리오 컨텍스트</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="border border-t-0 rounded-b p-4 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 입장/태도</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[60px] whitespace-pre-wrap">{sourceData?.stance || '-'}</div>
                          </div>
                          <div className="space-y-2">
                            <Label>입장/태도 ({lang.nativeName})</Label>
                            <Textarea
                              value={translation.stance || ''}
                              onChange={(e) => handleFieldChange(lang.code, 'stance', e.target.value)}
                              placeholder={`${lang.nativeName} 입장/태도...`}
                              rows={2}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 목표</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[60px] whitespace-pre-wrap">{sourceData?.goal || '-'}</div>
                          </div>
                          <div className="space-y-2">
                            <Label>목표 ({lang.nativeName})</Label>
                            <Textarea
                              value={translation.goal || ''}
                              onChange={(e) => handleFieldChange(lang.code, 'goal', e.target.value)}
                              placeholder={`${lang.nativeName} 목표...`}
                              rows={2}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 협상 가능 범위</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[60px] whitespace-pre-wrap">{sourceData?.tradeoff || '-'}</div>
                          </div>
                          <div className="space-y-2">
                            <Label>협상 가능 범위 ({lang.nativeName})</Label>
                            <Textarea
                              value={translation.tradeoff || ''}
                              onChange={(e) => handleFieldChange(lang.code, 'tradeoff', e.target.value)}
                              placeholder={`${lang.nativeName} 협상 가능 범위...`}
                              rows={2}
                            />
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    <Collapsible open={openSections.personality} onOpenChange={() => toggleSection('personality')}>
                      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 bg-muted rounded-t hover:bg-muted/80">
                        {openSections.personality ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        <span className="font-medium">성격 정보</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="border border-t-0 rounded-b p-4 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 성격 특성</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[60px]">
                              {(sourceData?.personality?.traits || personaTraits || []).join('\n') || '-'}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>성격 특성 ({lang.nativeName}) - 줄바꿈으로 구분</Label>
                            <Textarea
                              value={(translation.personalityTraits || []).join('\n')}
                              onChange={(e) => handleArrayFieldChange(lang.code, 'personalityTraits', e.target.value)}
                              placeholder={`특성1\n특성2\n특성3`}
                              rows={3}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 커뮤니케이션 스타일</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[60px] whitespace-pre-wrap">
                              {sourceData?.personality?.communicationStyle || '-'}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>커뮤니케이션 스타일 ({lang.nativeName})</Label>
                            <Textarea
                              value={translation.communicationStyle || ''}
                              onChange={(e) => handleFieldChange(lang.code, 'communicationStyle', e.target.value)}
                              placeholder={`${lang.nativeName} 커뮤니케이션 스타일...`}
                              rows={2}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 동기</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[60px] whitespace-pre-wrap">
                              {sourceData?.personality?.motivation || '-'}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>동기 ({lang.nativeName})</Label>
                            <Textarea
                              value={translation.motivation || ''}
                              onChange={(e) => handleFieldChange(lang.code, 'motivation', e.target.value)}
                              placeholder={`${lang.nativeName} 동기...`}
                              rows={2}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 두려움</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[60px]">
                              {(sourceData?.personality?.fears || []).join('\n') || '-'}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>두려움 ({lang.nativeName}) - 줄바꿈으로 구분</Label>
                            <Textarea
                              value={(translation.fears || []).join('\n')}
                              onChange={(e) => handleArrayFieldChange(lang.code, 'fears', e.target.value)}
                              placeholder={`두려움1\n두려움2`}
                              rows={2}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 성격 설명 (요약)</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[60px] whitespace-pre-wrap">
                              {(sourceData?.personality?.traits || personaTraits || []).join(', ') || '-'}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>성격 설명 ({lang.nativeName})</Label>
                            <Textarea
                              value={translation.personalityDescription || ''}
                              onChange={(e) => handleFieldChange(lang.code, 'personalityDescription', e.target.value)}
                              placeholder={`${lang.nativeName} 성격 설명...`}
                              rows={2}
                            />
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    <Collapsible open={openSections.background} onOpenChange={() => toggleSection('background')}>
                      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 bg-muted rounded-t hover:bg-muted/80">
                        {openSections.background ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        <span className="font-medium">배경 정보</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="border border-t-0 rounded-b p-4 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 학력</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[38px]">
                              {(typeof sourceData?.background === 'object' ? sourceData?.background?.education : '') || '-'}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>학력 ({lang.nativeName})</Label>
                            <Input
                              value={translation.education || ''}
                              onChange={(e) => handleFieldChange(lang.code, 'education', e.target.value)}
                              placeholder={`${lang.nativeName} 학력...`}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 이전 경력</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[60px] whitespace-pre-wrap">
                              {(typeof sourceData?.background === 'object' ? sourceData?.background?.previousExperience : '') || '-'}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>이전 경력 ({lang.nativeName})</Label>
                            <Textarea
                              value={translation.previousExperience || ''}
                              onChange={(e) => handleFieldChange(lang.code, 'previousExperience', e.target.value)}
                              placeholder={`${lang.nativeName} 이전 경력...`}
                              rows={2}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 주요 프로젝트</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[60px]">
                              {(typeof sourceData?.background === 'object' ? (sourceData?.background?.majorProjects || []).join('\n') : '') || '-'}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>주요 프로젝트 ({lang.nativeName}) - 줄바꿈으로 구분</Label>
                            <Textarea
                              value={(translation.majorProjects || []).join('\n')}
                              onChange={(e) => handleArrayFieldChange(lang.code, 'majorProjects', e.target.value)}
                              placeholder={`프로젝트1\n프로젝트2`}
                              rows={2}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 전문분야</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[60px]">
                              {(typeof sourceData?.background === 'object' ? (sourceData?.background?.expertise || []).join('\n') : '') || '-'}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>전문분야 ({lang.nativeName}) - 줄바꿈으로 구분</Label>
                            <Textarea
                              value={(translation.expertise || []).join('\n')}
                              onChange={(e) => handleArrayFieldChange(lang.code, 'expertise', e.target.value)}
                              placeholder={`전문분야1\n전문분야2`}
                              rows={2}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">원본 배경 (요약)</Label>
                            <div className="p-2 bg-muted rounded text-sm min-h-[80px] whitespace-pre-wrap">
                              {getSourceBackground() || '-'}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>배경 ({lang.nativeName})</Label>
                            <Textarea
                              value={translation.background || ''}
                              onChange={(e) => handleFieldChange(lang.code, 'background', e.target.value)}
                              placeholder={`${lang.nativeName} 배경 정보...`}
                              rows={3}
                            />
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
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
