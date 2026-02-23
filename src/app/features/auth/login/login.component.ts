import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { AuthService } from '../../../core/services';

@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink, IonContent, IonSpinner],
  template: `
    <ion-content class="login-content" [fullscreen]="true">
      <div class="login-wrapper">
        <div class="login-card" role="form" aria-label="Sign in to Tez">
          <!-- Brand Header -->
          <div class="login-header">
            <div class="logo-circle" aria-hidden="true">
              <span class="logo-icon">🅿️</span>
            </div>
            <h1 class="app-name">Tez</h1>
            <p class="app-tagline">Valet Parking Management</p>
          </div>

          <!-- Error Banner -->
          @if (error()) {
            <div class="error-message" role="alert" aria-live="polite">
              <span class="error-icon">⚠️</span>
              <span>{{ error() }}</span>
            </div>
          }

          <form (ngSubmit)="onLogin()" class="login-form">
            <!-- Email Field -->
            <div class="form-group">
              <label for="email" class="form-label">Email address</label>
              <div class="input-wrapper">
                <span class="input-icon" aria-hidden="true">✉️</span>
                <input id="email" type="email" [(ngModel)]="email" name="email"
                  placeholder="you@company.com" required autocomplete="email"
                  class="form-input" inputmode="email"
                  aria-describedby="email-hint" />
              </div>
              <span id="email-hint" class="form-hint">Use your company email</span>
            </div>

            <!-- Password Field -->
            <div class="form-group">
              <label for="password" class="form-label">Password</label>
              <div class="input-wrapper">
                <span class="input-icon" aria-hidden="true">🔒</span>
                <input id="password" [type]="showPassword() ? 'text' : 'password'"
                  [(ngModel)]="password" name="password" placeholder="Enter your password"
                  required autocomplete="current-password" class="form-input" />
                <button type="button" class="toggle-password" (click)="showPassword.set(!showPassword())"
                  [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
                  [attr.aria-pressed]="showPassword()">
                  {{ showPassword() ? '🙈' : '👁️' }}
                </button>
              </div>
            </div>

            <!-- Options Row -->
            <div class="form-options">
              <label class="remember-me">
                <input type="checkbox" [(ngModel)]="rememberMe" name="remember" aria-label="Remember me on this device" />
                <span class="checkbox-label">Remember me</span>
              </label>
              <a routerLink="/auth/forgot-password" class="forgot-link" aria-label="Forgot your password? Get a reset link">Forgot password?</a>
            </div>

            <!-- Submit Button -->
            <button type="submit" class="login-button" [disabled]="loading()" aria-label="Sign in to your account">
              @if (loading()) {
                <ion-spinner name="crescent" color="light"></ion-spinner>
                <span>Signing in...</span>
              } @else {
                <span>Sign In</span>
              }
            </button>
          </form>

          <div class="login-footer">
            <p>Powered by <strong>VCR Tech</strong></p>
          </div>
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .login-content {
      --background: linear-gradient(145deg, #0d0d1a 0%, #1a1a2e 35%, #16213e 65%, #0f3460 100%);
    }
    .login-wrapper {
      display: flex; align-items: center; justify-content: center;
      min-height: 100%; padding: 24px;
    }
    .login-card {
      background: white; border-radius: 28px; padding: 44px 32px 36px;
      width: 100%; max-width: 420px;
      box-shadow: 0 24px 48px rgba(0,0,0,.25), 0 8px 16px rgba(0,0,0,.15);
      animation: cardSlide .5s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes cardSlide {
      from { opacity: 0; transform: translateY(30px) scale(.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .login-header { text-align: center; margin-bottom: 36px; }
    .logo-circle {
      width: 80px; height: 80px; border-radius: 50%;
      background: linear-gradient(145deg, #fcc00b, #ff9100);
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px;
      box-shadow: 0 8px 32px rgba(252,192,11,.35);
      animation: logoPulse 3s ease-in-out infinite;
    }
    @keyframes logoPulse {
      0%,100% { box-shadow: 0 8px 32px rgba(252,192,11,.35); }
      50% { box-shadow: 0 8px 40px rgba(252,192,11,.5); }
    }
    .logo-icon { font-size: 36px; }
    .app-name { font-size: 32px; font-weight: 900; color: #1a1a2e; margin: 0; letter-spacing: -1px; }
    .app-tagline { font-size: 14px; color: #888; margin: 6px 0 0; font-weight: 500; }
    .error-message {
      background: #fff0f0; border: 1.5px solid #ffcdd2; color: #c62828;
      padding: 14px 16px; border-radius: 14px; font-size: 14px; margin-bottom: 20px;
      display: flex; align-items: center; gap: 10px; font-weight: 500;
      animation: errorShake .4s ease;
    }
    @keyframes errorShake {
      0%,100% { transform: translateX(0); }
      20% { transform: translateX(-8px); }
      40% { transform: translateX(8px); }
      60% { transform: translateX(-4px); }
      80% { transform: translateX(4px); }
    }
    .error-icon { font-size: 20px; }
    .login-form { display: flex; flex-direction: column; gap: 22px; }
    .form-group { position: relative; }
    .form-label {
      display: block; font-size: 13px; font-weight: 700; color: #444;
      margin-bottom: 8px; text-transform: uppercase; letter-spacing: .5px;
    }
    .input-wrapper {
      position: relative; display: flex; align-items: center;
    }
    .input-icon {
      position: absolute; left: 14px; font-size: 18px; pointer-events: none; z-index: 1;
    }
    .form-input {
      width: 100%; padding: 16px 16px 16px 44px; border: 2px solid #e8e9ed; border-radius: 14px;
      font-size: 16px; font-weight: 500; outline: none; transition: all .25s ease;
      box-sizing: border-box; background: #fafbfc; color: #1a1a2e;
      &:focus { border-color: #fcc00b; box-shadow: 0 0 0 4px rgba(252,192,11,.12); background: white; }
      &::placeholder { color: #bbb; font-weight: 400; }
    }
    .toggle-password {
      position: absolute; right: 14px; background: none; border: none;
      font-size: 20px; cursor: pointer; padding: 8px; border-radius: 8px;
      min-height: 44px; min-width: 44px; display: flex; align-items: center; justify-content: center;
      &:hover { background: #f0f0f0; }
    }
    .form-hint { font-size: 11px; color: #bbb; margin-top: 4px; display: block; }
    .form-options {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 14px; padding: 0 2px;
    }
    .remember-me {
      display: flex; align-items: center; gap: 8px; color: #555; cursor: pointer;
      font-weight: 500;
      input[type="checkbox"] { width: 20px; height: 20px; accent-color: #fcc00b; cursor: pointer; }
    }
    .checkbox-label { font-size: 14px; }
    .forgot-link {
      color: #0f3460; text-decoration: none; font-weight: 600; font-size: 14px;
      padding: 4px; border-radius: 4px;
      &:hover { text-decoration: underline; }
      &:focus-visible { outline: 2px solid #fcc00b; outline-offset: 2px; }
    }
    .login-button {
      width: 100%; padding: 18px; background: linear-gradient(145deg, #fcc00b, #ff9100);
      color: #1a1a2e; border: none; border-radius: 16px; font-size: 17px; font-weight: 800;
      cursor: pointer; transition: all .25s cubic-bezier(0.34, 1.56, 0.64, 1);
      display: flex; align-items: center; justify-content: center; gap: 10px;
      letter-spacing: .3px; min-height: 56px;
      box-shadow: 0 6px 20px rgba(252,192,11,.3);
      &:hover:not(:disabled) { transform: translateY(-3px); box-shadow: 0 10px 30px rgba(252,192,11,.4); }
      &:active:not(:disabled) { transform: translateY(0) scale(.98); }
      &:disabled { opacity: .7; cursor: not-allowed; box-shadow: none; }
    }
    .login-footer {
      text-align: center; margin-top: 28px; font-size: 12px; color: #aaa;
      p { margin: 0; }
      strong { color: #888; }
    }
  `],
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  email = '';
  password = '';
  rememberMe = true;
  loading = signal(false);
  error = signal('');
  showPassword = signal(false);

  async onLogin(): Promise<void> {
    if (!this.email || !this.password) {
      this.error.set('Please enter email and password');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    try {
      // #11 fix — pass rememberMe to auth service
      await this.authService.login(this.email, this.password, this.rememberMe);
      this.router.navigateByUrl('/tabs/issued');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const msg =
        code === 'auth/invalid-credential' ? 'Invalid email or password'
        : code === 'auth/too-many-requests' ? 'Too many attempts — try again later'
        : 'Login failed. Please try again.';
      this.error.set(msg);
    } finally {
      this.loading.set(false);
    }
  }
}
