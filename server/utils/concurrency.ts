export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryableErrors?: (error: any) => boolean;
  onRetry?: (attempt: number, error: any, delayMs: number) => void;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 15000,
  retryableErrors: (error: any) => {
    const message = error?.message || error?.toString() || '';
    const status = error?.status || error?.statusCode || error?.httpCode || 0;

    if (status === 429) return true;
    if (status === 503) return true;
    if (status === 500) return true;

    if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) return true;
    if (message.includes('503') || message.includes('overloaded')) return true;
    if (message.includes('500') || message.includes('INTERNAL')) return true;
    if (message.includes('quota') || message.includes('rate limit') || message.includes('Rate limit')) return true;
    if (message.includes('ECONNRESET') || message.includes('ETIMEDOUT') || message.includes('ENOTFOUND')) return true;
    if (message.includes('socket hang up') || message.includes('network')) return true;

    return false;
  },
  onRetry: (attempt, error, delayMs) => {
    console.warn(`🔄 API retry attempt ${attempt} after ${delayMs}ms delay: ${error?.message || error}`);
  },
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt >= opts.maxRetries || !opts.retryableErrors(error)) {
        throw error;
      }

      const jitter = Math.random() * 0.3 + 0.85;
      const delayMs = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt) * jitter,
        opts.maxDelayMs
      );

      opts.onRetry(attempt + 1, error, Math.round(delayMs));
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

export class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.maxConcurrent) {
      this.current++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.current;
  }
}

export const feedbackSemaphore = new Semaphore(10);
export const conversationSemaphore = new Semaphore(20);
