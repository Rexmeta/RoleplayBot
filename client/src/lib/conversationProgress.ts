export type ProgressStage = 'early' | 'mid' | 'nearEnd' | 'complete';

export interface ProgressInfo {
  stage: ProgressStage;
  progressBarClass: string;
  endButtonClass: string;
  endButtonLabelKey: string;
  showWarningIcon: boolean;
  showBadge: boolean;
  isAmber: boolean;
  isGreen: boolean;
}

export function getProgressStage(progressPercentage: number): ProgressStage {
  if (progressPercentage >= 100) return 'complete';
  if (progressPercentage >= 80) return 'nearEnd';
  if (progressPercentage >= 50) return 'mid';
  return 'early';
}

export function getProgressInfo(progressPercentage: number): ProgressInfo {
  const stage = getProgressStage(progressPercentage);

  switch (stage) {
    case 'complete':
      return {
        stage,
        progressBarClass: 'bg-green-400',
        endButtonClass: 'bg-green-600 hover:bg-green-700 text-white border-green-600',
        endButtonLabelKey: 'chat.getFeedback',
        showWarningIcon: false,
        showBadge: false,
        isAmber: false,
        isGreen: true,
      };
    case 'nearEnd':
      return {
        stage,
        progressBarClass: 'bg-amber-400',
        endButtonClass: 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500',
        endButtonLabelKey: 'chat.almostDoneEnd',
        showWarningIcon: false,
        showBadge: false,
        isAmber: true,
        isGreen: false,
      };
    case 'mid':
      return {
        stage,
        progressBarClass: 'bg-blue-400',
        endButtonClass: 'text-slate-600 border-slate-300 hover:bg-slate-50',
        endButtonLabelKey: 'chat.endConversation',
        showWarningIcon: false,
        showBadge: true,
        isAmber: false,
        isGreen: false,
      };
    case 'early':
    default:
      return {
        stage,
        progressBarClass: 'bg-white/60',
        endButtonClass: 'text-slate-400 border-slate-200 hover:bg-slate-50 opacity-70',
        endButtonLabelKey: 'chat.endEarly',
        showWarningIcon: true,
        showBadge: false,
        isAmber: false,
        isGreen: false,
      };
  }
}
