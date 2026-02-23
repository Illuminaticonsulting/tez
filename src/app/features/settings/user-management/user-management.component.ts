import {
  Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
  IonBackButton, IonList, IonItem,
  IonLabel, IonSearchbar, IonSelect,
  IonSelectOption, IonRefresher, IonRefresherContent,
  IonSkeletonText, IonSpinner,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  shieldOutline, personCircleOutline, searchOutline,
  ellipsisVerticalOutline,
} from 'ionicons/icons';
import { AuthService, FirestoreService, UiService, ApiService } from '../../../core/services';
import { AppUser, UserRole } from '../../../core/models';
import { where, orderBy } from '@angular/fire/firestore';
import { SearchbarCustomEvent } from '@ionic/angular';

@Component({
  selector: 'app-user-management',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonBackButton, IonList, IonItem,
    IonLabel, IonSearchbar, IonSelect,
    IonSelectOption, IonRefresher, IonRefresherContent,
    IonSkeletonText, IonSpinner,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/profile"></ion-back-button>
        </ion-buttons>
        <ion-title>User Management</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          placeholder="Search users..."
          [debounce]="300"
          (ionInput)="onSearch($event)"
          animated
          aria-label="Search users"
        ></ion-searchbar>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <!-- Stats Row -->
      <div class="stats-row">
        <div class="stat-card">
          <span class="stat-val">{{ users().length }}</span>
          <span class="stat-lbl">Total</span>
        </div>
        <div class="stat-card">
          <span class="stat-val">{{ adminCount() }}</span>
          <span class="stat-lbl">Admins</span>
        </div>
        <div class="stat-card">
          <span class="stat-val">{{ operatorCount() }}</span>
          <span class="stat-lbl">Operators</span>
        </div>
        <div class="stat-card">
          <span class="stat-val">{{ viewerCount() }}</span>
          <span class="stat-lbl">Viewers</span>
        </div>
      </div>

      <!-- User List -->
      @if (loading()) {
        @for (i of [1,2,3]; track i) {
          <div class="skeleton-user">
            <ion-skeleton-text [animated]="true" style="width: 48px; height: 48px; border-radius: 50%"></ion-skeleton-text>
            <div>
              <ion-skeleton-text [animated]="true" style="width: 140px; height: 18px"></ion-skeleton-text>
              <ion-skeleton-text [animated]="true" style="width: 200px; height: 14px; margin-top: 6px"></ion-skeleton-text>
            </div>
          </div>
        }
      } @else if (filtered().length === 0) {
        <div class="empty-state">
          <span class="empty-icon">👥</span>
          <h3>No Users Found</h3>
          <p>
            @if (searchTerm()) {
              No users match "{{ searchTerm() }}"
            } @else {
              No team members yet
            }
          </p>
        </div>
      } @else {
        <ion-list class="user-list">
          @for (user of filtered(); track user.uid) {
            <ion-item class="user-item" [detail]="false" lines="none">
              <div class="user-avatar" slot="start">
                {{ getInitials(user) }}
              </div>
              <ion-label>
                <h2 class="user-name">
                  {{ user.displayName || user.email }}
                  @if (user.uid === currentUid()) {
                    <span class="you-badge">You</span>
                  }
                </h2>
                <p class="user-email">{{ user.email }}</p>
              </ion-label>
              <div slot="end" class="user-actions">
                <ion-select
                  [value]="user.role"
                  interface="action-sheet"
                  [interfaceOptions]="{ header: 'Set Role for ' + (user.displayName || user.email) }"
                  (ionChange)="onRoleChange(user, $event)"
                  [disabled]="updatingUserId() === user.uid || user.uid === currentUid()"
                  class="role-select"
                  aria-label="Change role"
                >
                  <ion-select-option value="admin">Admin</ion-select-option>
                  <ion-select-option value="operator">Operator</ion-select-option>
                  <ion-select-option value="viewer">Viewer</ion-select-option>
                </ion-select>
                @if (updatingUserId() === user.uid) {
                  <ion-spinner name="dots" class="role-spinner"></ion-spinner>
                }
              </div>
            </ion-item>
          }
        </ion-list>
      }
    </ion-content>
  `,
  styles: [`
    .stats-row {
      display: flex; gap: 8px; padding: 16px 16px 8px; overflow-x: auto;
    }
    .stat-card {
      flex: 1; min-width: 70px; background: white; border-radius: 14px;
      padding: 14px 8px; text-align: center;
      box-shadow: 0 1px 4px rgba(0,0,0,.04);
    }
    .stat-val { display: block; font-size: 22px; font-weight: 800; color: #1a1a2e; }
    .stat-lbl { display: block; font-size: 11px; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: .3px; margin-top: 2px; }

    .skeleton-user {
      display: flex; gap: 12px; align-items: center;
      padding: 16px; margin: 0 16px 8px;
      background: white; border-radius: 16px;
    }

    .empty-state { text-align: center; padding: 60px 20px; color: #999; }
    .empty-icon { font-size: 48px; }
    .empty-state h3 { margin: 16px 0 8px; color: #555; }

    .user-list { padding: 0 16px; }

    .user-item {
      --background: white;
      --border-radius: 16px;
      --padding-start: 12px;
      --padding-end: 12px;
      --inner-padding-end: 8px;
      margin-bottom: 8px;
      border-radius: 16px;
      box-shadow: 0 1px 4px rgba(0,0,0,.04);
    }

    .user-avatar {
      width: 48px; height: 48px; border-radius: 50%;
      background: linear-gradient(145deg, #1a1a2e, #0f3460);
      color: white; font-size: 16px; font-weight: 800;
      display: flex; align-items: center; justify-content: center;
      letter-spacing: 1px; flex-shrink: 0;
    }

    .user-name {
      font-size: 16px !important; font-weight: 700 !important;
      color: #1a1a2e !important; margin: 0 0 2px !important;
    }
    .user-email {
      font-size: 13px !important; color: #999 !important; margin: 0 !important;
    }
    .you-badge {
      display: inline-block; background: #e8f5e9; color: #2e7d32;
      font-size: 10px; font-weight: 700; padding: 2px 8px;
      border-radius: 10px; margin-left: 8px;
      vertical-align: middle; text-transform: uppercase;
    }

    .user-actions {
      display: flex; align-items: center; gap: 4px;
    }

    .role-select {
      --placeholder-color: #666;
      font-size: 13px; font-weight: 600;
      min-width: 90px;
    }

    .role-spinner { width: 20px; height: 20px; }
  `],
})
export class UserManagementComponent implements OnInit {
  private auth = inject(AuthService);
  private db = inject(FirestoreService);
  private api = inject(ApiService);
  private ui = inject(UiService);
  private destroyRef = inject(DestroyRef);

  readonly users = signal<AppUser[]>([]);
  readonly loading = signal(true);
  readonly searchTerm = signal('');
  readonly updatingUserId = signal<string | null>(null);

  readonly currentUid = computed(() => this.auth.firebaseUser()?.uid ?? '');

  readonly adminCount = computed(() => this.users().filter(u => u.role === 'admin').length);
  readonly operatorCount = computed(() => this.users().filter(u => u.role === 'operator').length);
  readonly viewerCount = computed(() => this.users().filter(u => u.role === 'viewer').length);

  readonly filtered = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const all = this.users();
    if (!term) return all;
    return all.filter(u =>
      u.displayName?.toLowerCase().includes(term) ||
      u.email?.toLowerCase().includes(term) ||
      u.role?.toLowerCase().includes(term)
    );
  });

  constructor() {
    addIcons({ shieldOutline, personCircleOutline, searchOutline, ellipsisVerticalOutline });
  }

  ngOnInit(): void {
    this.loadUsers();
  }

  private loadUsers(): void {
    const companyId = this.auth.companyId();
    if (!companyId) { this.loading.set(false); return; }

    this.db.getCollection<AppUser>('users', [
      where('companyId', '==', companyId),
    ]).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (users) => {
        this.users.set(users);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.ui.toast('Failed to load users', 'danger');
      },
    });
  }

  onSearch(event: SearchbarCustomEvent): void {
    this.searchTerm.set(event.detail.value ?? '');
  }

  getInitials(user: AppUser): string {
    const name = user.displayName || user.email || '';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
  }

  async onRoleChange(user: AppUser, event: CustomEvent): Promise<void> {
    const newRole = event.detail.value as UserRole;
    if (newRole === user.role) return;

    const ok = await this.ui.confirm(
      'Change Role',
      `Change ${user.displayName || user.email}'s role to ${newRole}?`
    );
    if (!ok) return;

    this.updatingUserId.set(user.uid);
    try {
      await this.api.call('setUserRole', { userId: user.uid, role: newRole });
      this.ui.toast(`${user.displayName || user.email} is now ${newRole}`, 'success');
      // Update local state immediately
      this.users.update(users =>
        users.map(u => u.uid === user.uid ? { ...u, role: newRole } : u)
      );
    } catch (err: any) {
      this.ui.toast(err?.message || 'Failed to update role', 'danger');
    } finally {
      this.updatingUserId.set(null);
    }
  }

  onRefresh(event: CustomEvent): void {
    this.loading.set(true);
    this.loadUsers();
    setTimeout(() => (event.target as HTMLIonRefresherElement).complete(), 500);
  }
}
