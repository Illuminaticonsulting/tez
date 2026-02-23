import { Injectable, inject, signal, computed } from '@angular/core';
import {
  Auth,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  User,
  getIdTokenResult,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from '@angular/fire/auth';
import { Router } from '@angular/router';
import { AppUser, UserRole } from '../models';
import { FirestoreService } from './firestore.service';
import { firstValueFrom, timeout, catchError, of } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private router = inject(Router);
  private db = inject(FirestoreService);

  // Reactive signals
  readonly firebaseUser = signal<User | null>(null);
  readonly appUser = signal<AppUser | null>(null);
  readonly loading = signal(true);
  readonly isAuthenticated = computed(() => !!this.firebaseUser());
  readonly userRole = computed(() => this.appUser()?.role ?? 'viewer');
  readonly companyId = computed(() => this.appUser()?.companyId ?? '');

  constructor() {
    onAuthStateChanged(this.auth, async (user) => {
      this.firebaseUser.set(user);
      if (user) {
        await this.loadUserProfile(user.uid);
      } else {
        this.appUser.set(null);
      }
      this.loading.set(false);
    });
  }

  /** Login with optional persistence control (#11 rememberMe) */
  async login(email: string, password: string, rememberMe = true): Promise<void> {
    await setPersistence(
      this.auth,
      rememberMe ? browserLocalPersistence : browserSessionPersistence
    );
    const cred = await signInWithEmailAndPassword(this.auth, email, password);
    await this.loadUserProfile(cred.user.uid);
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
    this.appUser.set(null);
    this.firebaseUser.set(null);
    this.router.navigateByUrl('/auth/login');
  }

  async resetPassword(email: string): Promise<void> {
    await sendPasswordResetEmail(this.auth, email);
  }

  async getIdToken(): Promise<string | null> {
    const user = this.auth.currentUser;
    if (!user) return null;
    return user.getIdToken();
  }

  async getClaims(): Promise<Record<string, unknown>> {
    const user = this.auth.currentUser;
    if (!user) return {};
    const result = await getIdTokenResult(user);
    return result.claims as Record<string, unknown>;
  }

  hasRole(role: UserRole): boolean {
    return this.userRole() === role;
  }

  isAdmin(): boolean {
    return this.userRole() === 'admin';
  }

  /** Load user profile with timeout to prevent infinite hang (#47) */
  private async loadUserProfile(uid: string): Promise<void> {
    try {
      const user = await firstValueFrom(
        this.db.getDocument<AppUser>(`users/${uid}`).pipe(
          timeout(5000), // 5 second timeout prevents infinite hang
          catchError(() => {
            // User doc doesn't exist yet — build from auth claims
            return of(null);
          })
        )
      );

      if (user) {
        this.appUser.set(user);
      } else {
        // Fallback: build minimal AppUser from Firebase Auth + claims
        const fbUser = this.auth.currentUser;
        const claims = await this.getClaims();
        if (fbUser) {
          this.appUser.set({
            uid: fbUser.uid,
            email: fbUser.email || '',
            displayName: fbUser.displayName || fbUser.email || 'User',
            companyId: (claims['companyId'] as string) || '',
            role: (claims['role'] as UserRole) || 'viewer',
            isActive: true,
          });
        }
      }
    } catch (err) {
      console.error('[Tez] Failed to load user profile:', err);
    }
  }
}
