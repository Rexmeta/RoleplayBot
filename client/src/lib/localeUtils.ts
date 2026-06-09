import i18n, { SUPPORTED_LANGUAGES } from '@/lib/i18n';

const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map(l => l.code) as string[];

export function getDefaultSourceLocale(): string {
  const lang = i18n.language || 'ko';
  const base = lang.split('-')[0].split('_')[0];
  return SUPPORTED_CODES.includes(base) ? base : 'ko';
}
