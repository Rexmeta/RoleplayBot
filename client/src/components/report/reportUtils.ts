import type { TFunction } from "i18next";

export const toTenPoint = (rawScore: number, maxScore: number): number => {
  const m = maxScore || 10;
  if (m === 10) return rawScore;
  return Math.round((rawScore / m) * 10 * 10) / 10;
};

export const getDisplayValue = (value: number) => Number(value).toFixed(1);

export const getProgressWidth = (value: number) => value;

export const escapeHtml = (text: string | null | undefined): string => {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export const getTranslatedDimensionName = (
  t: TFunction,
  key: string | undefined,
  fallbackName: string
): string => {
  if (!key) return fallbackName;
  const translatedName = t(`evaluationDimensions.${key}.name`, { defaultValue: '' });
  return translatedName || fallbackName;
};

export const getOverallGrade = (score: number) => {
  if (score >= 90) return { grade: "A+", color: "text-green-600", bg: "bg-green-50" };
  if (score >= 80) return { grade: "A", color: "text-green-600", bg: "bg-green-50" };
  if (score >= 70) return { grade: "B", color: "text-blue-600", bg: "bg-blue-50" };
  if (score >= 60) return { grade: "C", color: "text-yellow-600", bg: "bg-yellow-50" };
  return { grade: "D", color: "text-red-600", bg: "bg-red-50" };
};

export const getScoreColor = (score: number) => {
  if (score >= 8) return "indigo";
  if (score >= 6) return "sky";
  if (score >= 4) return "amber";
  return "rose";
};

export const getScoreBorderColor = (score: number) => {
  if (score >= 8) return "border-l-indigo-500";
  if (score >= 6) return "border-l-sky-400";
  if (score >= 4) return "border-l-amber-400";
  return "border-l-rose-400";
};

export const getScoreHex = (score: number) => {
  if (score >= 8) return "#4f46e5";
  if (score >= 6) return "#0ea5e9";
  if (score >= 4) return "#f59e0b";
  return "#f43f5e";
};

export const getScoreLabel = (t: TFunction, score: number) => {
  if (score >= 9) return t('report.scoreExcellent', '탁월');
  if (score >= 7) return t('report.scoreGood', '우수');
  if (score >= 5) return t('report.scoreAverage', '보통');
  if (score >= 3) return t('report.scoreNeedsImprovement', '개선 필요');
  return t('report.scorePoor', '미흡');
};

export const getDifficultyTag = (item: { goal: string; actions: string[] }) => {
  const totalLen = item.goal.length + item.actions.join('').length;
  const actionCount = item.actions.length;
  if (totalLen > 150 || actionCount >= 4) return { label: '도전', cls: 'bg-red-100 text-red-700 border-red-200' };
  if (totalLen > 80 || actionCount >= 3) return { label: '보통', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' };
  return { label: '쉬움', cls: 'bg-green-100 text-green-700 border-green-200' };
};

export const extractSentences = (text: string, maxSentences: number = 2): string => {
  if (!text) return '';
  const sentenceEndings = /(?<=[.!?。。！？])\s+/g;
  const sentences = text.split(sentenceEndings).filter(s => s.trim());
  if (sentences.length <= maxSentences) return text;
  return sentences.slice(0, maxSentences).join(' ');
};

export const getPersonaFullInfo = (persona: any): string => {
  const p = persona as any;

  const isValidShortField = (value: string | undefined, maxLength: number = 30): string => {
    if (!value || typeof value !== 'string') return '';
    if (value.length > maxLength) return '';
    return value;
  };

  const department = isValidShortField(p.department, 20) ||
                     isValidShortField(p.personaSnapshot?.department, 20) ||
                     isValidShortField(p.affiliation, 20) || '';

  const position = isValidShortField(p.position, 30) ||
                   isValidShortField(p.personaSnapshot?.position, 30) || '';

  const role = isValidShortField(p.role, 30) ||
               isValidShortField(p.personaSnapshot?.role, 30) ||
               isValidShortField(p.currentSituation?.position, 30) || '';

  const name = isValidShortField(p.name, 20) ||
               isValidShortField(p.personaSnapshot?.name, 20) || '';

  const parts: string[] = [];

  if (department) parts.push(department);
  if (position) {
    parts.push(position);
  } else if (role && !role.includes(department)) {
    parts.push(role);
  }
  if (name) parts.push(name);

  return parts.join(' ') || name || '';
};
