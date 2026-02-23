import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** Wait for Firebase auth to initialize before checking state */
function waitForAuth(auth: AuthService): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!auth.loading()) { resolve(); return; }
    const check = setInterval(() => {
      if (!auth.loading()) { clearInterval(check); resolve(); }
    }, 50);
    // Safety timeout — don't wait forever
    setTimeout(() => { clearInterval(check); resolve(); }, 5000);
  });
}

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await waitForAuth(auth);
  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/auth/login']);
};

export const noAuthGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await waitForAuth(auth);
  if (!auth.isAuthenticated()) return true;
  return router.createUrlTree(['/tabs/issued']);
};

export const roleGuard = (allowedRoles: string[]): CanActivateFn => {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    await waitForAuth(auth);
    if (!auth.isAuthenticated()) return router.createUrlTree(['/auth/login']);
    const role = auth.userRole();
    if (role && allowedRoles.includes(role)) return true;
    return router.createUrlTree(['/tabs/issued']);
  };
};
