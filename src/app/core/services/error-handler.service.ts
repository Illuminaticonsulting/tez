import { ErrorHandler, Injectable, inject } from '@angular/core';
import { NotificationService } from './notification.service';

export interface AppError {
  code: string;
  message: string;
  context?: string;
  timestamp: number;
  stack?: string;
}

@Injectable({ providedIn: 'root' })
export class GlobalErrorHandler implements ErrorHandler {
  private notificationService = inject(NotificationService);

  private readonly recentErrors: AppError[] = [];
  private readonly MAX_STORED = 50;

  handleError(error: unknown): void {
    const appError = this.normalizeError(error);
    this.storeError(appError);
    this.logError(appError);
    this.notifyUser(appError);

    // TODO: Replace with Sentry or Datadog once integrated
    // Sentry.captureException(error);
  }

  getRecentErrors(): ReadonlyArray<AppError> {
    return this.recentErrors;
  }

  clearErrors(): void {
    this.recentErrors.length = 0;
  }

  private normalizeError(error: unknown): AppError {
    if (error instanceof Error) {
      return {
        code: error.name || 'UNKNOWN_ERROR',
        message: error.message,
        stack: error.stack,
        timestamp: Date.now(),
      };
    }
    if (typeof error === 'object' && error !== null) {
      const obj = error as Record<string, unknown>;
      return {
        code: (obj['code'] as string) || 'UNKNOWN_ERROR',
        message: (obj['message'] as string) || JSON.stringify(error),
        context: obj['context'] as string | undefined,
        timestamp: Date.now(),
      };
    }
    return {
      code: 'UNKNOWN_ERROR',
      message: String(error),
      timestamp: Date.now(),
    };
  }

  private storeError(err: AppError): void {
    this.recentErrors.unshift(err);
    if (this.recentErrors.length > this.MAX_STORED) {
      this.recentErrors.pop();
    }
  }

  private logError(err: AppError): void {
    console.error(`[${err.code}] ${err.message}`, err.stack ?? '');
  }

  private notifyUser(err: AppError): void {
    // Avoid spamming users with chunk-load / network noise
    if (err.code === 'ChunkLoadError') {
      this.notificationService.showBanner(
        'A new version is available. Please refresh.',
        'warning'
      );
      return;
    }
    this.notificationService.showBanner(
      'Something went wrong. Please try again.',
      'error'
    );
  }
}
