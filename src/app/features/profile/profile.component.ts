import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonContent, IonHeader, IonToolbar, IonTitle,
  IonButton, IonIcon, IonList, IonItem, IonLabel,
  IonToggle,
} from '@ionic/angular/standalone';
import { AuthService, UiService } from '../../core/services';
import { addIcons } from 'ionicons';
import {
  logOutOutline, moonOutline, notificationsOutline, shieldOutline,
  analyticsOutline, chatboxOutline, settingsOutline, callOutline,
} from 'ionicons/icons';

@Component({
  selector: 'app-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, RouterLink,
    IonContent, IonHeader, IonToolbar, IonTitle,
    IonButton, IonIcon, IonList, IonItem, IonLabel,
    IonToggle,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title><span class="page-title">Profile</span></ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Profile Card -->
      <div class="profile-card">
        <div class="avatar" role="img" [attr.aria-label]="'Avatar for ' + (auth.appUser()?.displayName || 'User')">
          {{ initials() }}
        </div>
        <h2 class="name">{{ auth.appUser()?.displayName || 'Operator' }}</h2>
        <p class="email">{{ auth.appUser()?.email }}</p>
        <span class="role-badge">{{ auth.userRole() | uppercase }}</span>
      </div>

      <!-- Quick Stats -->
      <div class="quick-stats">
        <div class="stat-item">
          <span class="stat-value">—</span>
          <span class="stat-label">Today</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <span class="stat-value">—</span>
          <span class="stat-label">This Week</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <span class="stat-value">—</span>
          <span class="stat-label">Rating</span>
        </div>
      </div>

      <!-- Settings -->
      <div class="settings-section">
        <h3 class="section-title">Preferences</h3>
        <ion-list [inset]="true" class="settings-list">
          <ion-item detail="false">
            <ion-icon name="notifications-outline" slot="start" aria-hidden="true" color="primary"></ion-icon>
            <ion-label>
              <h3>Push Notifications</h3>
              <p>Get alerted on new tickets</p>
            </ion-label>
            <ion-toggle slot="end" [(ngModel)]="pushEnabled" (ionChange)="onTogglePush()" aria-label="Toggle push notifications"></ion-toggle>
          </ion-item>
          <ion-item detail="false">
            <ion-icon name="moon-outline" slot="start" aria-hidden="true" color="medium"></ion-icon>
            <ion-label>
              <h3>Dark Mode</h3>
              <p>Easier on the eyes at night</p>
            </ion-label>
            <ion-toggle slot="end" [(ngModel)]="darkMode" (ionChange)="onToggleDark()" aria-label="Toggle dark mode"></ion-toggle>
          </ion-item>
        </ion-list>
      </div>

      @if (auth.isAdmin()) {
        <div class="settings-section">
          <h3 class="section-title">Administration</h3>
          <ion-list [inset]="true" class="settings-list">
            <ion-item button detail routerLink="/tabs/analytics">
              <ion-icon name="analytics-outline" slot="start" aria-hidden="true" color="success"></ion-icon>
              <ion-label>
                <h3>Reports & Analytics</h3>
                <p>Revenue, performance, trends</p>
              </ion-label>
            </ion-item>
            <ion-item button detail routerLink="/tabs/phone-settings">
              <ion-icon name="call-outline" slot="start" aria-hidden="true" color="warning"></ion-icon>
              <ion-label>
                <h3>AI Phone Agent</h3>
                <p>Automated call handling, logs</p>
              </ion-label>
            </ion-item>
            <ion-item button detail>
              <ion-icon name="shield-outline" slot="start" aria-hidden="true" color="tertiary"></ion-icon>
              <ion-label>
                <h3>Manage Users</h3>
                <p>Add operators, set roles</p>
              </ion-label>
            </ion-item>
            <ion-item button detail>
              <ion-icon name="chatbox-outline" slot="start" aria-hidden="true" color="warning"></ion-icon>
              <ion-label>
                <h3>SMS Templates</h3>
                <p>Configure exit messages</p>
              </ion-label>
            </ion-item>
            <ion-item button detail>
              <ion-icon name="settings-outline" slot="start" aria-hidden="true" color="dark"></ion-icon>
              <ion-label>
                <h3>Company Settings</h3>
                <p>Locations, pricing, hours</p>
              </ion-label>
            </ion-item>
          </ion-list>
        </div>
      }

      <!-- Sign Out -->
      <div class="logout-section">
        <ion-button expand="block" color="danger" fill="outline" (click)="onLogout()" class="logout-btn">
          <ion-icon name="log-out-outline" slot="start"></ion-icon>
          Sign Out
        </ion-button>
      </div>

      <div class="version">Tez v1.0.0 — Built with ❤️</div>
    </ion-content>
  `,
  styles: [`
    .page-title { font-weight: 800; font-size: 22px; }
    .profile-card {
      text-align: center; padding: 36px 24px 24px;
      background: linear-gradient(180deg, #f5f6fa 0%, transparent 100%);
    }
    .avatar {
      width: 88px; height: 88px; border-radius: 50%;
      background: linear-gradient(145deg, #1a1a2e, #0f3460);
      color: white; font-size: 32px; font-weight: 800;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px;
      box-shadow: 0 8px 24px rgba(26,26,46,.25);
      letter-spacing: 1px;
    }
    .name { font-size: 22px; font-weight: 800; color: #1a1a2e; margin: 0 0 4px; letter-spacing: -0.3px; }
    .email { font-size: 14px; color: #888; margin: 0 0 14px; font-weight: 500; }
    .role-badge {
      display: inline-block; padding: 6px 16px; border-radius: 20px;
      background: linear-gradient(135deg, #e8eaf6, #c5cae9); color: #3949ab;
      font-size: 12px; font-weight: 700; letter-spacing: .5px;
    }
    .quick-stats {
      display: flex; align-items: center; justify-content: center;
      gap: 0; padding: 16px 24px; margin: 0 16px 8px;
      background: white; border-radius: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,.04);
    }
    .stat-item { flex: 1; text-align: center; }
    .stat-value { display: block; font-size: 22px; font-weight: 800; color: #1a1a2e; }
    .stat-label { display: block; font-size: 11px; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: .5px; margin-top: 2px; }
    .stat-divider { width: 1px; height: 36px; background: #e8e9ed; }
    .settings-section { padding: 0 16px; }
    .section-title {
      font-size: 13px; font-weight: 700; color: #999; text-transform: uppercase;
      letter-spacing: .5px; margin: 24px 0 10px 4px;
    }
    .settings-list {
      ion-item {
        --min-height: 64px;
        --padding-start: 16px;
        --inner-padding-end: 16px;
        ion-icon { font-size: 22px; }
        h3 { font-size: 15px !important; font-weight: 600 !important; margin: 0 0 2px !important; }
        p { font-size: 13px !important; color: #999 !important; margin: 0 !important; }
      }
    }
    .logout-section { padding: 28px 16px 8px; }
    .logout-btn {
      --border-radius: 14px;
      font-weight: 700; font-size: 16px; min-height: 52px;
    }
    .version {
      text-align: center; font-size: 12px; color: #ccc; padding: 20px;
      font-weight: 500;
    }
  `],
})
export class ProfileComponent {
  readonly auth = inject(AuthService);
  private ui = inject(UiService);

  pushEnabled = false;
  darkMode = false;

  constructor() {
    addIcons({ logOutOutline, moonOutline, notificationsOutline, shieldOutline, analyticsOutline, chatboxOutline, settingsOutline, callOutline });
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
