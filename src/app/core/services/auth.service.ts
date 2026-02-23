import { Injectable, inject, signal, computed } from '@angular/core';
import {
  Auth,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  User,
  getIdTokenResult,
} from '@angular/fire/auth';
import { Router } from '@angular/router';
import { AppUser, UserRole } from '../models';
import { FirestoreService } from './firestore.service';
import { firstValueFrom } from 'rxjs';

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

  async login(email: string, password: string): Promise<void> {
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

  /** Get custom claims (role, companyId) from the ID token */
  async getClaims(): Promise<Record<string, any>> {
    const user = this.auth.currentUser;
    if (!user) return {};
    const result = await getIdTokenResult(user);
    return result.claims;
  }

  hasRole(role: UserRole): boolean {
    return this.userRole() === role;
  }

  isAdmin(): boolean {
    return this.userRole() === 'admin';
  }

  private async loadUserProfile(uid: string): Promise<void> {
    try {
      const user = await firstValueFrom(
        this.db.getDocument<AppUser>(`users/${uid}`)
      );
      this.appUser.set(user);
    } catch {
      console.error('Failed to load user profile');
    }
  }
}
