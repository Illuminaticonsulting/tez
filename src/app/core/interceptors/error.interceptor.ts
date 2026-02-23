import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notify = inject(NotificationService);
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      let message = 'An error occurred';

      switch (error.status) {
        case 0:
          message = 'Network error — check your connection';
          break;
        case 401:
          message = 'Session expired — please log in again';
          auth.logout();
          router.navigateByUrl('/auth/login');
          break;
        case 403:
          message = 'You do not have permission for this action';
          break;
        case 404:
          message = 'Resource not found';
          break;
        case 429:
          message = 'Too many requests — please slow down';
          break;
        case 500:
          message = 'Server error — please try again later';
          break;
        default:
          message = error.error?.message ?? `Error ${error.status}`;
      }

      notify.showBanner(message, 'error');
      return throwError(() => error);
    })
  );
};
