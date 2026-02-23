import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { AuthService } from '../../../core/services';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonContent, IonSpinner],
  template: `
    <ion-content class="forgot-content" [fullscreen]="true">
      <div class="forgot-wrapper">
        <div class="forgot-card">
          <div class="header">
            <h1>Reset Password</h1>
            <p>Enter your email and we'll send you a reset link</p>
          </div>

          @if (sent()) {
            <div class="success-msg">
              ✅ Password reset email sent! Check your inbox.
            </div>
          }

          @if (error()) {
            <div class="error-msg">⚠️ {{ error() }}</div>
          }

          <form (ngSubmit)="onSubmit()" class="form">
            <div class="form-group">
              <label for="email">Email</label>
              <input
                id="email"
                type="email"
                [(ngModel)]="email"
                name="email"
                placeholder="your@email.com"
                required
                class="form-input"
              />
            </div>

            <button type="submit" class="submit-btn" [disabled]="loading()">
              @if (loading()) {
                <ion-spinner name="crescent"></ion-spinner>
              } @else {
                Send Reset Link
              }
            </button>
          </form>

          <a routerLink="/auth/login" class="back-link">← Back to Login</a>
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .forgot-content {
      --background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    }
    .forgot-wrapper {
      display: flex; align-items: center; justify-content: center;
      min-height: 100%; padding: 24px;
    }
    .forgot-card {
      background: white; border-radius: 24px; padding: 40px 32px;
      width: 100%; max-width: 400px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .header { text-align: center; margin-bottom: 24px; }
    .header h1 { font-size: 24px; font-weight: 700; color: #1a1a2e; margin: 0 0 8px; }
    .header p { font-size: 14px; color: #888; margin: 0; }
    .success-msg {
      background: #e8f5e9; border: 1px solid #a5d6a7; color: #2e7d32;
      padding: 12px 16px; border-radius: 12px; font-size: 14px; margin-bottom: 16px;
    }
    .error-msg {
      background: #fff3f3; border: 1px solid #ffcdd2; color: #c62828;
      padding: 12px 16px; border-radius: 12px; font-size: 14px; margin-bottom: 16px;
    }
    .form { display: flex; flex-direction: column; gap: 20px; }
    .form-group label {
      display: block; font-size: 13px; font-weight: 600; color: #555;
      margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%; padding: 14px 16px; border: 2px solid #e0e0e0;
      border-radius: 12px; font-size: 16px; outline: none; box-sizing: border-box;
      &:focus { border-color: #fcc00b; }
    }
    .submit-btn {
      width: 100%; padding: 16px; background: linear-gradient(135deg, #fcc00b, #ff9800);
      color: #1a1a2e; border: none; border-radius: 12px; font-size: 16px;
      font-weight: 700; cursor: pointer;
      &:disabled { opacity: 0.7; }
    }
    .back-link {
      display: block; text-align: center; margin-top: 20px;
      color: #0f3460; text-decoration: none; font-weight: 500;
    }
  `],
})
export class ForgotPasswordComponent {
  private auth = inject(AuthService);

  email = '';
  loading = signal(false);
  error = signal('');
  sent = signal(false);

  async onSubmit(): Promise<void> {
    if (!this.email) { this.error.set('Please enter your email'); return; }
    this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.resetPassword(this.email);
      this.sent.set(true);
    } catch {
      this.error.set('Failed to send reset email');
    } finally {
      this.loading.set(false);
    }
  }
}
