import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { ApiService } from '../../../core/services';
import {
  Auth, createUserWithEmailAndPassword, updateProfile,
} from '@angular/fire/auth';

@Component({
  selector: 'app-register',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, IonContent, IonSpinner],
  template: `
    <ion-content class="register-content" [fullscreen]="true">
      <div class="register-wrapper">
        <div class="register-card" role="form" aria-label="Create your account">
          <div class="header">
            <div class="logo-circle" aria-hidden="true">
              <span class="logo-icon">🅿️</span>
            </div>
            <h1 class="app-name">Tez</h1>
            <p class="app-tagline">Create Your Account</p>
          </div>

          @if (error()) {
            <div class="error-msg" role="alert">⚠️ {{ error() }}</div>
          }

          @if (success()) {
            <div class="success-msg" role="status">
              ✅ Account created! Redirecting...
            </div>
          }

          <form (ngSubmit)="onSubmit()" class="form">
            <div class="form-group">
              <label for="name">Full Name</label>
              <div class="input-wrapper">
                <span class="input-icon" aria-hidden="true">👤</span>
                <input id="name" type="text" [(ngModel)]="name" name="name"
                  placeholder="John Smith" required autocomplete="name"
                  class="form-input" />
              </div>
            </div>

            <div class="form-group">
              <label for="email">Email</label>
              <div class="input-wrapper">
                <span class="input-icon" aria-hidden="true">✉️</span>
                <input id="email" type="email" [(ngModel)]="email" name="email"
                  placeholder="you@company.com" required autocomplete="email"
                  class="form-input" inputmode="email" />
              </div>
            </div>

            <div class="form-group">
              <label for="password">Password</label>
              <div class="input-wrapper">
                <span class="input-icon" aria-hidden="true">🔒</span>
                <input id="password" type="password" [(ngModel)]="password" name="password"
                  placeholder="Min 8 characters" required autocomplete="new-password"
                  minlength="8" class="form-input" />
              </div>
            </div>

            <div class="form-group">
              <label for="confirmPassword">Confirm Password</label>
              <div class="input-wrapper">
                <span class="input-icon" aria-hidden="true">🔒</span>
                <input id="confirmPassword" type="password" [(ngModel)]="confirmPassword"
                  name="confirmPassword" placeholder="Re-enter password" required
                  autocomplete="new-password" class="form-input" />
              </div>
            </div>

            <div class="form-group">
              <label for="companyCode">Company Code <span class="optional">(optional)</span></label>
              <div class="input-wrapper">
                <span class="input-icon" aria-hidden="true">🏢</span>
                <input id="companyCode" type="text" [(ngModel)]="companyCode" name="companyCode"
                  placeholder="Ask your admin" class="form-input" />
              </div>
            </div>

            <button type="submit" class="submit-btn" [disabled]="loading()">
              @if (loading()) {
                <ion-spinner name="crescent" color="dark"></ion-spinner>
                <span>Creating Account...</span>
              } @else {
                <span>Create Account</span>
              }
            </button>
          </form>

          <div class="footer">
            <p>Already have an account? <a routerLink="/auth/login" class="link">Sign In</a></p>
          </div>
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .register-content {
      --background: linear-gradient(145deg, #0d0d1a 0%, #1a1a2e 35%, #16213e 65%, #0f3460 100%);
    }
    .register-wrapper {
      display: flex; align-items: center; justify-content: center;
      min-height: 100%; padding: 24px;
    }
    .register-card {
      background: white; border-radius: 28px; padding: 36px 28px 32px;
      width: 100%; max-width: 420px;
      box-shadow: 0 24px 48px rgba(0,0,0,.25);
      animation: cardSlide .5s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes cardSlide {
      from { opacity: 0; transform: translateY(30px) scale(.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .header { text-align: center; margin-bottom: 28px; }
    .logo-circle {
      width: 64px; height: 64px; border-radius: 50%;
      background: linear-gradient(145deg, #fcc00b, #ff9100);
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 12px;
      box-shadow: 0 8px 32px rgba(252,192,11,.35);
    }
    .logo-icon { font-size: 28px; }
    .app-name { font-size: 28px; font-weight: 900; color: #1a1a2e; margin: 0; }
    .app-tagline { font-size: 14px; color: #888; margin: 4px 0 0; font-weight: 500; }
    .error-msg { background: #fff0f0; border: 1px solid #ffcdd2; color: #c62828; padding: 12px 16px; border-radius: 12px; font-size: 14px; margin-bottom: 16px; }
    .success-msg { background: #e8f5e9; border: 1px solid #a5d6a7; color: #2e7d32; padding: 12px 16px; border-radius: 12px; font-size: 14px; margin-bottom: 16px; }
    .form { display: flex; flex-direction: column; gap: 16px; }
    .form-group { position: relative; }
    .form-group label { display: block; font-size: 12px; font-weight: 700; color: #444; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .5px; }
    .optional { font-size: 10px; color: #bbb; text-transform: none; font-weight: 500; }
    .input-wrapper { position: relative; display: flex; align-items: center; }
    .input-icon { position: absolute; left: 14px; font-size: 16px; pointer-events: none; z-index: 1; }
    .form-input {
      width: 100%; padding: 14px 16px 14px 42px; border: 2px solid #e8e9ed; border-radius: 14px;
      font-size: 15px; font-weight: 500; outline: none; transition: all .25s ease;
      box-sizing: border-box; background: #fafbfc; color: #1a1a2e;
      &:focus { border-color: #fcc00b; box-shadow: 0 0 0 4px rgba(252,192,11,.12); background: white; }
      &::placeholder { color: #bbb; font-weight: 400; }
    }
    .submit-btn {
      width: 100%; padding: 16px; background: linear-gradient(145deg, #fcc00b, #ff9100);
      color: #1a1a2e; border: none; border-radius: 16px; font-size: 17px; font-weight: 800;
      cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px;
      min-height: 52px; box-shadow: 0 6px 20px rgba(252,192,11,.3);
      transition: all .25s;
      &:hover:not(:disabled) { transform: translateY(-2px); }
      &:disabled { opacity: .7; cursor: not-allowed; }
    }
    .footer { text-align: center; margin-top: 20px; font-size: 14px; color: #888; }
    .footer p { margin: 0; }
    .link { color: #0f3460; text-decoration: none; font-weight: 700; &:hover { text-decoration: underline; } }
  `],
})
export class RegisterComponent {
  private auth = inject(Auth);
  private router = inject(Router);

  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  companyCode = '';

  loading = signal(false);
  error = signal('');
  success = signal(false);

  async onSubmit(): Promise<void> {
    this.error.set('');

    if (!this.name.trim()) { this.error.set('Name is required'); return; }
    if (!this.email.trim()) { this.error.set('Email is required'); return; }
    if (this.password.length < 8) { this.error.set('Password must be at least 8 characters'); return; }
    if (this.password !== this.confirmPassword) { this.error.set('Passwords do not match'); return; }

    this.loading.set(true);
    try {
      const cred = await createUserWithEmailAndPassword(this.auth, this.email, this.password);
      await updateProfile(cred.user, { displayName: this.name.trim() });

      this.success.set(true);
      // Navigate after a brief delay so user sees success message
      setTimeout(() => this.router.navigateByUrl('/tabs/issued'), 1500);
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/email-already-in-use') {
        this.error.set('An account with this email already exists');
      } else if (code === 'auth/weak-password') {
        this.error.set('Password is too weak. Use at least 8 characters');
      } else if (code === 'auth/invalid-email') {
        this.error.set('Invalid email address');
      } else {
        this.error.set(err?.message || 'Failed to create account');
      }
    } finally {
      this.loading.set(false);
    }
  }
}
