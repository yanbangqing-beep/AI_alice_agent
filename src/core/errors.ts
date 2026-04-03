import type { ModelId } from "./types.js";

// ─── Error Types ─────────────────────────────────────────────────

export class AliceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "AliceError";
  }
}

export class ProviderError extends AliceError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly model?: ModelId,
  ) {
    const retryable = statusCode
      ? [429, 500, 502, 503, 529].includes(statusCode)
      : false;
    super(message, "PROVIDER_ERROR", retryable);
    this.name = "ProviderError";
  }
}

export class ToolError extends AliceError {
  constructor(
    message: string,
    public readonly toolName: string,
  ) {
    super(message, "TOOL_ERROR", false);
    this.name = "ToolError";
  }
}

export class SafetyError extends AliceError {
  constructor(message: string) {
    super(message, "SAFETY_ERROR", false);
    this.name = "SafetyError";
  }
}

export class ContextOverflowError extends AliceError {
  constructor(message: string) {
    super(message, "CONTEXT_OVERFLOW", false);
    this.name = "ContextOverflowError";
  }
}

// ─── Retry with Exponential Backoff ──────────────────────────────

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number; // ms
  maxDelay: number; // ms
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}

const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (error instanceof AliceError && !error.retryable) {
        throw error;
      }

      if (attempt === opts.maxRetries) break;

      const delay = Math.min(
        opts.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
        opts.maxDelay,
      );
      opts.onRetry?.(attempt + 1, lastError, delay);
      await Bun.sleep(delay);
    }
  }

  throw lastError;
}

// ─── Model Degradation ──────────────────────────────────────────

export class ModelDegrader {
  private currentIndex = 0;

  constructor(private readonly models: ModelId[]) {
    if (models.length === 0) {
      throw new AliceError("At least one model must be provided", "CONFIG_ERROR");
    }
  }

  get current(): ModelId {
    return this.models[this.currentIndex]!;
  }

  degrade(): ModelId | null {
    if (this.currentIndex >= this.models.length - 1) return null;
    this.currentIndex++;
    return this.current;
  }

  reset(): void {
    this.currentIndex = 0;
  }

  get isAtLowest(): boolean {
    return this.currentIndex >= this.models.length - 1;
  }
}
