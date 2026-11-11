/** Stable internal keys; translated labels are accepted only at the boundary. */
export const emotionToEnglish: Record<string, string> = {
  '중립': 'neutral', '기쁨': 'happy', '슬픔': 'sad', '분노': 'angry', '놀람': 'surprised',
  '호기심': 'curious', '불안': 'anxious', '피로': 'tired', '실망': 'disappointed', '당혹': 'confused',
  '단호': 'determined', '무표정': 'neutral', 'flat': 'neutral',
  neutral: 'neutral', happy: 'happy', sad: 'sad', angry: 'angry', surprised: 'surprised',
  curious: 'curious', anxious: 'anxious', tired: 'tired', disappointed: 'disappointed',
  confused: 'confused', determined: 'determined', concerned: 'concerned', excited: 'excited',
  '中立': 'neutral', '喜悦': 'happy', '悲伤': 'sad', '愤怒': 'angry', '惊讶': 'surprised',
  '好奇': 'curious', '焦虑': 'anxious', '疲劳': 'tired', '失望': 'disappointed', '困惑': 'confused',
  '喜び': 'happy', '悲しみ': 'sad', '怒り': 'angry', '驚き': 'surprised',
  '好奇心': 'curious', '不安': 'anxious', '疲労': 'tired',
};
export function normalizePresentationEmotion(label: string): string {
  return emotionToEnglish[label.trim().toLowerCase()] ?? 'neutral';
}
