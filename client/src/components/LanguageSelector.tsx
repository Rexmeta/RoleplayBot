import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { SUPPORTED_LANGUAGES, type LanguageCode } from '@/lib/i18n';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export function LanguageSelector() {
  const { i18n, t } = useTranslation();
  const { toast } = useToast();

  const { data: userProfile } = useQuery<any>({
    queryKey: ['/api/auth/user'],
  });

  const updateLanguageMutation = useMutation({
    mutationFn: async (language: LanguageCode) => {
      const response = await apiRequest('PATCH', '/api/auth/user/language', { language });
      if (!response.ok) {
        throw new Error('Failed to update language');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
  });

  const handleLanguageChange = async (langCode: LanguageCode) => {
    if (!userProfile) {
      i18n.changeLanguage(langCode);
      localStorage.setItem('preferredLanguage', langCode);
      return;
    }
    
    const previousLang = i18n.language;
    i18n.changeLanguage(langCode);
    localStorage.setItem('preferredLanguage', langCode);
    
    try {
      await updateLanguageMutation.mutateAsync(langCode);
    } catch (error) {
      i18n.changeLanguage(previousLang);
      localStorage.setItem('preferredLanguage', previousLang);
      toast({
        title: t('common.error'),
        description: t('settings.languageUpdateFailed'),
        variant: "destructive"
      });
    }
  };

  const currentLang = SUPPORTED_LANGUAGES.find(lang => lang.code === i18n.language) || SUPPORTED_LANGUAGES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <span className="text-lg">{currentLang.flag}</span>
          <span className="hidden sm:inline text-sm">{currentLang.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => handleLanguageChange(lang.code)}
            className={`gap-2 cursor-pointer ${i18n.language === lang.code ? 'bg-slate-100' : ''}`}
          >
            <span className="text-lg">{lang.flag}</span>
            <span>{lang.name}</span>
            {i18n.language === lang.code && (
              <i className="fas fa-check ml-auto text-green-500"></i>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
