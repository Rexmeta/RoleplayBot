import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
          title: t('admin.translationDashboard.batchComplete'),
          description: t('admin.translationDashboard.batchCompleteDesc', { count: data.count }),
        });
        refetch();
        queryClient.invalidateQueries({ queryKey: ['/api/scenarios'] });
        queryClient.invalidateQueries({ queryKey: ['/api/personas'] });
        queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      } else {
        throw new Error(data.error || t('admin.translationDashboard.batchFailed'));
      }
    } catch (error: any) {
      toast({
        title: t('admin.translationDashboard.batchFailed'),
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
          <p className="text-lg font-medium">{t('admin.translationDashboard.noLanguages')}</p>
          <p className="text-sm mt-2">{t('admin.translationDashboard.addLanguagesHint')}</p>
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
        <CardDescription>{t('admin.translationDashboard.totalItems', { count: total })}</CardDescription>
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
                      {langStatus.reviewed} {t('admin.translationDashboard.reviewed')}
                    </Badge>
                  )}
                  {needsReview > 0 && (
                    <Badge variant="outline" className="text-amber-600 border-amber-200">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {needsReview} {t('admin.translationDashboard.needsReview')}
                    </Badge>
                  )}
                </div>
              </div>
              
              <Progress value={percent} className="h-2" />
              
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('admin.translationDashboard.translationProgress')}: {percent}%</span>
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
                    {t('admin.translationDashboard.autoGenerate', { count: missing })}
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
            {t('admin.translationDashboard.title')}
          </h2>
          <p className="text-muted-foreground mt-1">
            {t('admin.translationDashboard.description')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('admin.translationDashboard.sourceLanguage')}:</span>
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
            <span className="text-sm text-muted-foreground">{t('admin.translationDashboard.targetLanguages')}</span>
          </div>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('admin.translationDashboard.refresh')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {status?.scenarios && renderContentTypeCard(
          t('admin.scenarios'),
          <FileText className="h-5 w-5 text-blue-600" />,
          'scenarios',
          status.scenarios.total,
          status.scenarios.translated
        )}
        
        {status?.personas && renderContentTypeCard(
          t('admin.personas'),
          <Users className="h-5 w-5 text-purple-600" />,
          'personas',
          status.personas.total,
          status.personas.translated
        )}
        
        {status?.categories && renderContentTypeCard(
          t('admin.categories'),
          <FolderTree className="h-5 w-5 text-green-600" />,
          'categories',
          status.categories.total,
          status.categories.translated
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.translationDashboard.guide.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <Languages className="h-4 w-4 mt-0.5 text-blue-600" />
            <div>
              <span className="font-medium text-foreground">{t('admin.translationDashboard.guide.bidirectional')}</span>: {t('admin.translationDashboard.guide.bidirectionalDesc')}
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Bot className="h-4 w-4 mt-0.5 text-amber-600" />
            <div>
              <span className="font-medium text-foreground">{t('admin.translationDashboard.guide.aiTranslation')}</span>: {t('admin.translationDashboard.guide.aiTranslationDesc')}
            </div>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="h-4 w-4 mt-0.5 text-green-600" />
            <div>
              <span className="font-medium text-foreground">{t('admin.translationDashboard.guide.reviewedLabel')}</span>: {t('admin.translationDashboard.guide.reviewedDesc')}
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 text-amber-600" />
            <div>
              <span className="font-medium text-foreground">{t('admin.translationDashboard.guide.needsReviewLabel')}</span>: {t('admin.translationDashboard.guide.needsReviewDesc')}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
