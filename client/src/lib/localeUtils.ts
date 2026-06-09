import { useQuery } from '@tanstack/react-query';
import i18n, { SUPPORTED_LANGUAGES } from '@/lib/i18n';
import type { SupportedLanguage } from '@shared/schema';

const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map(l => l.code) as string[];

export function getDefaultSourceLocale(): string {
  const lang = i18n.language || 'ko';
  const base = lang.split('-')[0].split('_')[0];
  return SUPPORTED_CODES.includes(base) ? base : 'ko';
}

export function useDefaultSourceLocale(): string {
  const { data: languages } = useQuery<SupportedLanguage[]>({
    queryKey: ['/api/languages'],
  });

  const activeCodes = languages?.map(l => l.code) ?? [];
  if (activeCodes.length === 0) {
    return getDefaultSourceLocale();
  }

  const lang = i18n.language || 'ko';
  const base = lang.split('-')[0].split('_')[0];
  return activeCodes.includes(base) ? base : (activeCodes[0] ?? 'ko');
}
