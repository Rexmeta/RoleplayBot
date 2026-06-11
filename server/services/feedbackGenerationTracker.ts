const generatingSet = new Set<string>();
const errorMap = new Map<string, string>();

export function markGenerating(id: string): void {
  generatingSet.add(id);
  errorMap.delete(id);
}

export function isGenerating(id: string): boolean {
  return generatingSet.has(id);
}

export function unmarkGenerating(id: string): void {
  generatingSet.delete(id);
}

export function markGenerationError(id: string, message: string): void {
  generatingSet.delete(id);
  errorMap.set(id, message);
}

export function getGenerationError(id: string): string | undefined {
  return errorMap.get(id);
}

export function clearGenerationError(id: string): void {
  errorMap.delete(id);
}
