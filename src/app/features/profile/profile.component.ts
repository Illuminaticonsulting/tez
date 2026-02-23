import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonToolbar, IonTitle,
  IonButton, IonIcon, IonList, IonItem, IonLabel,
  IonToggle, IonNote,
} from '@ionic/angular/standalone';
import { AuthService, UiService } from '../../core/services';
import { addIcons } from 'ionicons';
import {
  logOutOutline, moonOutline, notificationsOutline, shieldOutline,
  analyticsOutline, chatboxOutline, settingsOutline,
} from 'ionicons/icons';

@Component({
  selector: 'app-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    IonContent, IonHeader, IonToolbar, IonTitle,
    IonButton, IonIcon, IonList, IonItem, IonLabel,
    IonToggle, IonNote,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>Profile</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="profile-card">
        <div class="avatar" role="img" [attr.aria-label]="'Avatar for ' + (auth.appUser()?.displayName || 'User')">
          {{ initials() }}
        </div>
        <h2 class="name">{{ auth.appUser()?.displayName || 'Operator' }}</h2>
        <p class="email">{{ auth.appUser()?.email }}</p>
        <span class="role-badge">{{ auth.userRole() | uppercase }}</span>
      </div>

      <div class="settings-section">
        <h3 class="section-title">Settings</h3>
        <ion-list [inset]="true">
          <ion-item>
            <ion-icon name="notifications-outline" slot="start" aria-hidden="true"></ion-icon>
            <ion-label>Push Notifications</ion-label>
            <ion-toggle slot="end" [(ngModel)]="pushEnabled" (ionChange)="onTogglePush()"></ion-toggle>
          </ion-item>
          <ion-item>
            <ion-icon name="moon-outline" slot="start" aria-hidden="true"></ion-icon>
            <ion-label>Dark Mode</ion-label>
            <ion-toggle slot="end" [(ngModel)]="darkMode" (ionChange)="onToggleDark()"></ion-toggle>
          </ion-item>
        </ion-list>
      </div>

      @if (auth.isAdmin()) {
        <div class="settings-section">
          <h3 class="section-title">Admin</h3>
          <ion-list [inset]="true">
            <ion-item button detail routerLink="/tabs/analytics">
              <ion-icon name="analytics-outline" slot="start" aria-hidden="true"></ion-icon>
              <ion-label>Reports & Analytics</ion-label>
            </ion-item>
            <ion-item button detail>
              <ion-icon name="shield-outline" slot="start" aria-hidden="true"></ion-icon>
              <ion-label>Manage Users</ion-label>
            </ion-item>
            <ion-item button detail>
              <ion-icon name="chatbox-outline" slot="start" aria-hidden="true"></ion-icon>
              <ion-label>SMS Templates</ion-label>
              <ion-note slot="end">Configure exit messages</ion-note>
            </ion-item>
            <ion-item button detail>
              <ion-icon name="settings-outline" slot="start" aria-hidden="true"></ion-icon>
              <ion-label>Company Settings</ion-label>
            </ion-item>
          </ion-list>
        </div>
      }

      <div class="logout-section">
        <ion-button expand="block" color="danger" fill="outline" (click)="onLogout()">
          <ion-icon name="log-out-outline" slot="start"></ion-icon>
          Sign Out
        </ion-button>
      </div>

      <div class="version">Tez v1.0.0</div>
    </ion-content>
  `,
  styles: [`
    .profile-card { text-align: center; padding: 32px 24px; }
    .avatar {
      width: 80px; height: 80px; border-radius: 50%;
      background: linear-gradient(135deg, #1a1a2e, #0f3460);
      color: white; font-size: 28px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px;
    }
    .name { font-size: 20px; font-weight: 700; color: #1a1a2e; margin: 0 0 4px; }
    .email { font-size: 14px; color: #888; margin: 0 0 12px; }
    .role-badge {
      display: inline-block; padding: 4px 14px; border-radius: 12px;
      background: #e8eaf6; color: #3949ab; font-size: 12px; font-weight: 600;
    }
    .settings-section { padding: 0 16px; }
    .section-title {
      font-size: 13px; font-weight: 600; color: #999; text-transform: uppercase;
      letter-spacing: .5px; margin: 24px 0 8px 4px;
    }
    .logout-section { padding: 24px 16px; }
    .version { text-align: center; font-size: 12px; color: #ccc; padding: 16px; }
  `],
})
export class ProfileComponent {
  readonly auth = inject(AuthService);
  private ui = inject(UiService);

  pushEnabled = false;
  darkMode = false;

  constructor() {
    addIcons({ logOutOutline, moonOutline, notificationsOutline, shieldOutline, analyticsOutline, chatboxOutline, settingsOutline });
    // #35 fix — persist dark mode from localStorage
    this.darkMode = localStorage.getItem('tez_dark_mode') === 'true';
    if (this.darkMode) {
      document.body.classList.add('dark');
    }
  }

  /** #45 fix — initials as computed signal, not a regular method */
  readonly initials = computed(() => {
    const name = this.auth.appUser()?.displayName || '';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
  });

  async onLogout(): Promise<void> {
    const ok = await this.ui.confirm('Sign Out', 'Are you sure you want to sign out?');
    if (ok) await this.auth.logout();
  }

  onTogglePush(): void {
    this.ui.toast(this.pushEnabled ? 'Notifications enabled' : 'Notifications disabled');
  }

  /** #35 fix — persist dark mode */
  onToggleDark(): void {
    document.body.classList.toggle('dark', this.darkMode);
    localStorage.setItem('tez_dark_mode', String(this.darkMode));
  }
}
