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
        <div class="login-card" role="form" aria-label="Sign in form">
          <div class="login-header">
            <div class="logo-circle" aria-hidden="true"><span class="logo-icon">🅿️</span></div>
            <h1 class="app-name">Tez</h1>
            <p class="app-tagline">Valet Parking Management</p>
          </div>

          @if (error()) {
            <div class="error-message" role="alert"><span>⚠️</span> {{ error() }}</div>
          }

          <form (ngSubmit)="onLogin()" class="login-form">
            <div class="form-group">
              <label for="email">Email</label>
              <input id="email" type="email" [(ngModel)]="email" name="email"
                placeholder="operator@company.com" required autocomplete="email" class="form-input" />
            </div>

            <div class="form-group">
              <label for="password">Password</label>
              <input id="password" [type]="showPassword() ? 'text' : 'password'"
                [(ngModel)]="password" name="password" placeholder="Enter password"
                required autocomplete="current-password" class="form-input" />
              <button type="button" class="toggle-password" (click)="showPassword.set(!showPassword())"
                [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'">
                {{ showPassword() ? '🙈' : '👁️' }}
              </button>
            </div>

            <div class="form-options">
              <label class="remember-me">
                <input type="checkbox" [(ngModel)]="rememberMe" name="remember" />
                Remember me
              </label>
              <a routerLink="/auth/forgot-password" class="forgot-link">Forgot password?</a>
            </div>

            <button type="submit" class="login-button" [disabled]="loading()">
              @if (loading()) {
                <ion-spinner name="crescent" color="light"></ion-spinner>
              } @else {
                Sign In
              }
            </button>
          </form>

          <div class="login-footer"><p>Powered by <strong>VCR Tech</strong></p></div>
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .login-content { --background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); }
    .login-wrapper { display: flex; align-items: center; justify-content: center; min-height: 100%; padding: 24px; }
    .login-card {
      background: white; border-radius: 24px; padding: 40px 32px;
      width: 100%; max-width: 400px; box-shadow: 0 20px 60px rgba(0,0,0,.3);
    }
    .login-header { text-align: center; margin-bottom: 32px; }
    .logo-circle {
      width: 72px; height: 72px; border-radius: 50%;
      background: linear-gradient(135deg, #fcc00b, #ff9800);
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px; box-shadow: 0 8px 24px rgba(252,192,11,.3);
    }
    .logo-icon { font-size: 32px; }
    .app-name { font-size: 28px; font-weight: 800; color: #1a1a2e; margin: 0; letter-spacing: -.5px; }
    .app-tagline { font-size: 14px; color: #888; margin: 4px 0 0; }
    .error-message {
      background: #fff3f3; border: 1px solid #ffcdd2; color: #c62828;
      padding: 12px 16px; border-radius: 12px; font-size: 14px; margin-bottom: 16px;
      display: flex; align-items: center; gap: 8px;
    }
    .login-form { display: flex; flex-direction: column; gap: 20px; }
    .form-group {
      position: relative;
      label { display: block; font-size: 13px; font-weight: 600; color: #555; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .5px; }
    }
    .form-input {
      width: 100%; padding: 14px 16px; border: 2px solid #e0e0e0; border-radius: 12px;
      font-size: 16px; outline: none; transition: border-color .2s; box-sizing: border-box;
      &:focus { border-color: #fcc00b; box-shadow: 0 0 0 3px rgba(252,192,11,.15); }
      &::placeholder { color: #bbb; }
    }
    .toggle-password { position: absolute; right: 12px; bottom: 12px; background: none; border: none; font-size: 18px; cursor: pointer; padding: 4px; }
    .form-options { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
    .remember-me { display: flex; align-items: center; gap: 6px; color: #666; cursor: pointer; }
    .forgot-link { color: #0f3460; text-decoration: none; font-weight: 500; &:hover { text-decoration: underline; } }
    .login-button {
      width: 100%; padding: 16px; background: linear-gradient(135deg, #fcc00b, #ff9800);
      color: #1a1a2e; border: none; border-radius: 12px; font-size: 16px; font-weight: 700;
      cursor: pointer; transition: all .2s; display: flex; align-items: center; justify-content: center; gap: 8px;
      &:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(252,192,11,.4); }
      &:disabled { opacity: .7; cursor: not-allowed; }
    }
    .login-footer { text-align: center; margin-top: 24px; font-size: 12px; color: #aaa; }
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
