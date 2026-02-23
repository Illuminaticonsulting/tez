import { Injectable, ErrorHandler, inject } from '@angular/core';
import { NotificationService } from './notification.service';

@Injectable({ providedIn: 'root' })
export class GlobalErrorHandler implements ErrorHandler {
  private notify = inject(NotificationService);

  handleError(error: any): void {
    // Extract useful message
    const message = error?.rejection?.message ?? error?.message ?? 'An unexpected error occurred';
    const code = error?.code ?? error?.status ?? '';

    // Log to console in non-production
    console.error('[Tez Error]', { message, code, error });

    // Show user-facing notification
    if (this.isUserFacingError(code, message)) {
      this.notify.showBanner(message, 'error', true, 8000);
    }

    // TODO: In production, send to a logging service (e.g., Sentry, Cloud Logging)
    // this.loggingService.log({ message, code, stack: error?.stack });
  }

  private isUserFacingError(code: string | number, message: string): boolean {
    // Suppress certain benign errors
    const suppressPatterns = [
      'ExpressionChangedAfterItHasBeenCheckedError',
      'ResizeObserver loop',
      'Loading chunk',
    ];
    return !suppressPatterns.some((p) => message.includes(p));
  }
}
