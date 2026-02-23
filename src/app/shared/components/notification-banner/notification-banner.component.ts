import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService } from '../../../core/services';

@Component({
  selector: 'app-notification-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    @for (banner of notify.banners(); track banner.id) {
      <div
        class="banner"
        [class]="'banner banner--' + banner.type"
        role="alert"
        [attr.aria-live]="banner.type === 'error' ? 'assertive' : 'polite'"
      >
        <div class="banner__icon">
          @switch (banner.type) {
            @case ('warning') { ⚠️ }
            @case ('error') { ❌ }
            @case ('success') { ✅ }
            @default { ℹ️ }
          }
        </div>
        <span class="banner__text">{{ banner.message }}</span>
        <button
          class="banner__close"
          (click)="notify.dismissBanner(banner.id)"
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      </div>
    }
  `,
  styles: [`
    :host {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px 16px;
      pointer-events: none;
    }

    .banner {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      pointer-events: all;
      animation: slideDown 0.3s ease-out;
    }

    .banner--info { background: #e3f2fd; color: #1565c0; }
    .banner--warning { background: #fff3e0; color: #e65100; }
    .banner--error { background: #ffebee; color: #c62828; }
    .banner--success { background: #e8f5e9; color: #2e7d32; }

    .banner__text { flex: 1; }

    .banner__close {
      background: none;
      border: none;
      font-size: 16px;
      cursor: pointer;
      opacity: 0.7;
      padding: 4px;
      &:hover { opacity: 1; }
    }

    @keyframes slideDown {
      from { transform: translateY(-100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `],
})
export class NotificationBannerComponent {
  protected notify = inject(NotificationService);
}
