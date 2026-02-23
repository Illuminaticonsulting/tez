import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';

/**
 * HTTP error interceptor — minimal since we primarily use httpsCallable.
 * Still useful for any remaining REST calls (e.g., static assets, external APIs).
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notification = inject(NotificationService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 0) {
        notification.showBanner('Network error. Check your connection.', 'error');
      } else if (error.status === 401) {
        notification.showBanner('Session expired. Please log in again.', 'warning');
      } else if (error.status >= 500) {
        notification.showBanner('Server error. Please try again later.', 'error');
      }
      return throwError(() => error);
    })
  );
};
