import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { 
  Loader2, Languages, FileText, Users, FolderTree, 
  CheckCircle, AlertCircle, Bot, RefreshCw, BarChart, ArrowRight
} from 'lucide-react';
import { SupportedLanguage } from '@shared/schema';

interface TranslationStatus {
  scenarios: {
    total: number;
    translated: Record<string, { count: number; reviewed: number; machine: number }>;
  };
  personas: {
    total: number;
    translated: Record<string, { count: number; reviewed: number; machine: number }>;
  };
  categories: {
    total: number;
    translated: Record<string, { count: number; reviewed: number; machine: number }>;
  };
}

export function TranslationDashboard() {
  const { toast } = useToast();
  const [isGeneratingAll, setIsGeneratingAll] = useState<string | null>(null);
  const [sourceLocale, setSourceLocale] = useState<string>('ko');

  const { data: languages = [], isLoading: languagesLoading } = useQuery<SupportedLanguage[]>({
    queryKey: ['/api/languages'],
  });

  const { data: status, isLoading: statusLoading, refetch } = useQuery<TranslationStatus>({
    queryKey: ['/api/admin/translation-status'],
  });

  const handleGenerateAllTranslations = async (locale: string, contentType: 'scenarios' | 'personas' | 'categories') => {
    setIsGeneratingAll(`${contentType}-${locale}`);
    try {
      const res = await apiRequest('POST', '/api/admin/generate-all-translations', {
        targetLocale: locale,
        contentType,
        sourceLocale,
      });
      const data = await res.json();
      
      if (data.success) {
        toast({
          title: '일괄 번역 완료',
          description: `${data.count}개 항목이 번역되었습니다.`,
        });
        refetch();
        queryClient.invalidateQueries({ queryKey: ['/api/scenarios'] });
        queryClient.invalidateQueries({ queryKey: ['/api/personas'] });
        queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      } else {
        throw new Error(data.error || '번역 생성 실패');
      }
    } catch (error: any) {
      toast({
        title: '일괄 번역 실패',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingAll(null);
    }
  };

  if (languagesLoading || statusLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const targetLanguages = languages.filter(l => l.code !== sourceLocale);
  const sourceLanguageOptions = languages.filter(l => l.isActive);

  if (targetLanguages.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Languages className="h-12 w-12 mx-auto mb-4" />
          <p className="text-lg font-medium">번역할 언어가 없습니다</p>
          <p className="text-sm mt-2">시스템 설정에서 지원 언어를 추가하세요.</p>
        </CardContent>
      </Card>
    );
  }

  const getProgressPercent = (translated: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((translated / total) * 100);
  };

  const renderContentTypeCard = (
    title: string,
    icon: JSX.Element,
    contentType: 'scenarios' | 'personas' | 'categories',
    total: number,
    translated: Record<string, { count: number; reviewed: number; machine: number }>
  ) => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>총 {total}개 항목</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {targetLanguages.map((lang) => {
          const langStatus = translated[lang.code] || { count: 0, reviewed: 0, machine: 0 };
          const percent = getProgressPercent(langStatus.count, total);
          const reviewedPercent = getProgressPercent(langStatus.reviewed, langStatus.count);
          const needsReview = langStatus.machine - langStatus.reviewed;
          const missing = total - langStatus.count;

          return (
            <div key={lang.code} className="space-y-2 p-3 border rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{lang.nativeName}</span>
                  <Badge variant="outline" className="text-xs">
                    {langStatus.count}/{total}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {langStatus.reviewed > 0 && (
                    <Badge variant="outline" className="text-green-600 border-green-200">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      {langStatus.reviewed} 검토됨
                    </Badge>
                  )}
                  {needsReview > 0 && (
                    <Badge variant="outline" className="text-amber-600 border-amber-200">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {needsReview} 검토 필요
                    </Badge>
                  )}
                </div>
              </div>
              
              <Progress value={percent} className="h-2" />
              
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>번역 진행률: {percent}%</span>
                {missing > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleGenerateAllTranslations(lang.code, contentType)}
                    disabled={isGeneratingAll === `${contentType}-${lang.code}`}
                  >
                    {isGeneratingAll === `${contentType}-${lang.code}` ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Bot className="h-3 w-3 mr-1" />
                    )}
                    미번역 {missing}개 자동 생성
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <BarChart className="h-6 w-6" />
            번역 현황 대시보드
          </h2>
          <p className="text-muted-foreground mt-1">
            콘텐츠 번역 상태를 확인하고 일괄 번역을 실행할 수 있습니다.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">원문 언어:</span>
            <Select value={sourceLocale} onValueChange={setSourceLocale}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sourceLanguageOptions.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.nativeName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">번역 대상</span>
          </div>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            새로고침
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {status?.scenarios && renderContentTypeCard(
          '시나리오',
          <FileText className="h-5 w-5 text-blue-600" />,
          'scenarios',
          status.scenarios.total,
          status.scenarios.translated
        )}
        
        {status?.personas && renderContentTypeCard(
          '페르소나',
          <Users className="h-5 w-5 text-purple-600" />,
          'personas',
          status.personas.total,
          status.personas.translated
        )}
        
        {status?.categories && renderContentTypeCard(
          '카테고리',
          <FolderTree className="h-5 w-5 text-green-600" />,
          'categories',
          status.categories.total,
          status.categories.translated
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>번역 가이드</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <Languages className="h-4 w-4 mt-0.5 text-blue-600" />
            <div>
              <span className="font-medium text-foreground">양방향 번역</span>: 원문 언어를 선택하면 해당 언어에서 다른 모든 언어로 번역할 수 있습니다. 영어/일본어/중국어를 원문으로 선택하면 한국어 번역도 가능합니다.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Bot className="h-4 w-4 mt-0.5 text-amber-600" />
            <div>
              <span className="font-medium text-foreground">AI 번역</span>: Gemini AI가 자동으로 생성한 번역입니다. 운영자 검토가 필요합니다.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="h-4 w-4 mt-0.5 text-green-600" />
            <div>
              <span className="font-medium text-foreground">검토됨</span>: 운영자가 확인하고 승인한 번역입니다.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 text-amber-600" />
            <div>
              <span className="font-medium text-foreground">검토 필요</span>: AI가 생성했지만 아직 운영자가 확인하지 않은 번역입니다.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
