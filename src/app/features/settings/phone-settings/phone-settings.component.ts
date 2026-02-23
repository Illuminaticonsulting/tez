import { Component, inject, signal, computed, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
  IonBackButton, IonButton, IonIcon, IonItem,
  IonLabel, IonToggle, IonInput, IonTextarea, IonCard,
  IonCardContent, IonBadge,
  IonSpinner, IonChip, IonAccordionGroup, IonAccordion,
} from '@ionic/angular/standalone';
import { AuthService, ApiService, UiService, FirestoreService } from '../../../core/services';
import { addIcons } from 'ionicons';
import {
  callOutline, settingsOutline, saveOutline, refreshOutline,
  chatbubblesOutline, timeOutline, checkmarkCircleOutline,
  arrowForwardOutline, closeCircleOutline, personOutline,
  informationCircleOutline, flashOutline,
} from 'ionicons/icons';

interface CallLog {
  id: string;
  callerPhone: string;
  startedAt: string | null;
  turns: number;
  transcript: Array<{ role: string; content: string }>;
  actionsPerformed: string[];
  summary: string;
  status: string;
}

interface PhoneConfig {
  enabled: boolean;
  twilioPhoneNumber: string;
  transferNumber: string;
  greeting: string;
  businessHours: string;
  pricingInfo: string;
  locationInfo: string;
}

@Component({
  selector: 'app-phone-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonBackButton, IonButton, IonIcon, IonItem,
    IonLabel, IonToggle, IonInput, IonTextarea, IonCard,
    IonCardContent, IonBadge,
    IonSpinner, IonChip, IonAccordionGroup, IonAccordion,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/profile"></ion-back-button>
        </ion-buttons>
        <ion-title><span class="page-title">AI Phone Agent</span></ion-title>
        <ion-buttons slot="end">
          @if (hasChanges()) {
            <ion-button (click)="saveConfig()" [disabled]="saving()">
              <ion-icon name="save-outline" slot="icon-only"></ion-icon>
            </ion-button>
          }
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Hero Card -->
      <div class="hero-card">
        <div class="hero-icon">
          <ion-icon name="call-outline"></ion-icon>
        </div>
        <h2>AI-Powered Phone System</h2>
        <p>Let AI answer calls, check bookings, request vehicles, and handle cancellations automatically.</p>
      </div>

      <!-- Enable/Disable -->
      <ion-card class="config-card">
        <ion-card-content>
          <ion-item lines="none" detail="false">
            <ion-icon name="flash-outline" slot="start" color="warning" aria-hidden="true"></ion-icon>
            <ion-label>
              <h2>Enable AI Phone Agent</h2>
              <p>When enabled, incoming calls are handled by AI</p>
            </ion-label>
            <ion-toggle
              slot="end"
              [(ngModel)]="config.enabled"
              (ionChange)="markChanged()"
              aria-label="Enable AI phone agent">
            </ion-toggle>
          </ion-item>
        </ion-card-content>
      </ion-card>

      @if (config.enabled) {
        <!-- Phone Numbers -->
        <div class="section-label">Phone Numbers</div>
        <ion-card class="config-card">
          <ion-card-content>
            <ion-item>
              <ion-icon name="call-outline" slot="start" color="primary" aria-hidden="true"></ion-icon>
              <ion-input
                label="Twilio Phone Number"
                labelPlacement="floating"
                type="tel"
                placeholder="+1 (555) 123-4567"
                [(ngModel)]="config.twilioPhoneNumber"
                (ionInput)="markChanged()">
              </ion-input>
            </ion-item>
            <ion-item lines="none">
              <ion-icon name="person-outline" slot="start" color="success" aria-hidden="true"></ion-icon>
              <ion-input
                label="Transfer Number (Human Fallback)"
                labelPlacement="floating"
                type="tel"
                placeholder="+1 (555) 987-6543"
                [(ngModel)]="config.transferNumber"
                (ionInput)="markChanged()">
              </ion-input>
            </ion-item>
            <div class="field-hint">
              Calls that need a human will transfer to this number.
            </div>
          </ion-card-content>
        </ion-card>

        <!-- AI Greeting -->
        <div class="section-label">Greeting & Company Info</div>
        <ion-card class="config-card">
          <ion-card-content>
            <ion-item>
              <ion-textarea
                label="Custom Greeting"
                labelPlacement="floating"
                [autoGrow]="true"
                rows="3"
                placeholder="Thank you for calling... How can I help you today?"
                [(ngModel)]="config.greeting"
                (ionInput)="markChanged()">
              </ion-textarea>
            </ion-item>
            <div class="field-hint">Leave blank for default greeting.</div>

            <ion-item>
              <ion-textarea
                label="Business Hours"
                labelPlacement="floating"
                [autoGrow]="true"
                rows="2"
                placeholder="Monday-Friday 6am-11pm, Saturday-Sunday 7am-10pm"
                [(ngModel)]="config.businessHours"
                (ionInput)="markChanged()">
              </ion-textarea>
            </ion-item>

            <ion-item>
              <ion-textarea
                label="Pricing Information"
                labelPlacement="floating"
                [autoGrow]="true"
                rows="2"
                placeholder="$12/hour, $45 daily max, first 30 min free"
                [(ngModel)]="config.pricingInfo"
                (ionInput)="markChanged()">
              </ion-textarea>
            </ion-item>

            <ion-item lines="none">
              <ion-textarea
                label="Location & Directions"
                labelPlacement="floating"
                [autoGrow]="true"
                rows="2"
                placeholder="123 Main St, Terminal B pickup area, look for the gold TEZ signs"
                [(ngModel)]="config.locationInfo"
                (ionInput)="markChanged()">
              </ion-textarea>
            </ion-item>
          </ion-card-content>
        </ion-card>

        <!-- Webhook URL Info -->
        <div class="section-label">Twilio Setup</div>
        <ion-card class="config-card info-card">
          <ion-card-content>
            <div class="info-row">
              <ion-icon name="information-circle-outline" color="primary"></ion-icon>
              <div>
                <p class="info-text">Set this as your Twilio Voice webhook URL:</p>
                <code class="webhook-url">https://us-central1-YOUR_PROJECT.cloudfunctions.net/phoneWebhook?action=incoming</code>
                <p class="info-hint">Replace YOUR_PROJECT with your Firebase project ID.</p>
              </div>
            </div>
          </ion-card-content>
        </ion-card>

        <!-- AI Capabilities -->
        <div class="section-label">What AI Can Do</div>
        <ion-card class="config-card">
          <ion-card-content class="capabilities">
            <div class="capability">
              <ion-icon name="checkmark-circle-outline" color="success"></ion-icon>
              <span>Look up bookings by ticket # or plate</span>
            </div>
            <div class="capability">
              <ion-icon name="checkmark-circle-outline" color="success"></ion-icon>
              <span>Report booking status to caller</span>
            </div>
            <div class="capability">
              <ion-icon name="checkmark-circle-outline" color="success"></ion-icon>
              <span>Request vehicle retrieval</span>
            </div>
            <div class="capability">
              <ion-icon name="checkmark-circle-outline" color="success"></ion-icon>
              <span>Cancel bookings with confirmation</span>
            </div>
            <div class="capability">
              <ion-icon name="checkmark-circle-outline" color="success"></ion-icon>
              <span>Answer pricing, hours & location questions</span>
            </div>
            <div class="capability">
              <ion-icon name="checkmark-circle-outline" color="success"></ion-icon>
              <span>Transfer to human when needed</span>
            </div>
          </ion-card-content>
        </ion-card>
      }

      <!-- Save Button -->
      @if (hasChanges()) {
        <div class="save-section">
          <ion-button
            expand="block"
            (click)="saveConfig()"
            [disabled]="saving()"
            class="save-btn">
            @if (saving()) {
              <ion-spinner name="crescent" slot="start"></ion-spinner>
              Saving...
            } @else {
              <ion-icon name="save-outline" slot="start"></ion-icon>
              Save Configuration
            }
          </ion-button>
        </div>
      }

      <!-- Call Logs -->
      <div class="section-label" style="margin-top: 24px;">
        Recent Calls
        <ion-button fill="clear" size="small" (click)="loadCallLogs()">
          <ion-icon name="refresh-outline" slot="icon-only"></ion-icon>
        </ion-button>
      </div>

      @if (loadingLogs()) {
        <div class="loading-center">
          <ion-spinner name="crescent"></ion-spinner>
        </div>
      } @else if (callLogs().length === 0) {
        <ion-card class="config-card">
          <ion-card-content class="empty-logs">
            <ion-icon name="chatbubbles-outline" color="medium"></ion-icon>
            <p>No call history yet</p>
            <p class="subtitle">Calls handled by the AI will appear here</p>
          </ion-card-content>
        </ion-card>
      } @else {
        <ion-accordion-group class="call-log-accordion">
          @for (call of callLogs(); track call.id) {
            <ion-accordion [value]="call.id">
              <ion-item slot="header">
                <div class="call-status-dot" [class]="call.status"></div>
                <ion-label>
                  <h3>{{ call.callerPhone || 'Unknown' }}</h3>
                  <p>{{ formatDate(call.startedAt) }} · {{ call.turns }} turns</p>
                </ion-label>
                @if (call.actionsPerformed.length > 0) {
                  <ion-badge color="primary" slot="end">{{ call.actionsPerformed.length }}</ion-badge>
                }
              </ion-item>
              <div slot="content" class="call-detail">
                <!-- Summary -->
                @if (call.summary) {
                  <div class="call-summary">
                    <strong>Summary:</strong> {{ call.summary }}
                  </div>
                }
                <!-- Actions -->
                @if (call.actionsPerformed.length > 0) {
                  <div class="call-actions">
                    <strong>Actions Taken:</strong>
                    @for (action of call.actionsPerformed; track action) {
                      <ion-chip size="small" color="warning">
                        <ion-icon name="flash-outline"></ion-icon>
                        <ion-label>{{ action }}</ion-label>
                      </ion-chip>
                    }
                  </div>
                }
                <!-- Transcript -->
                <div class="transcript">
                  <strong>Transcript:</strong>
                  @for (msg of call.transcript; track $index) {
                    <div class="transcript-msg" [class]="msg.role">
                      <span class="msg-role">{{ msg.role === 'user' ? 'Caller' : 'AI' }}:</span>
                      <span class="msg-text">{{ msg.content }}</span>
                    </div>
                  }
                </div>
              </div>
            </ion-accordion>
          }
        </ion-accordion-group>
      }

      <div class="bottom-spacer"></div>
    </ion-content>
  `,
  styles: [`
    .page-title { font-weight: 800; font-size: 20px; }

    .hero-card {
      text-align: center;
      padding: 32px 24px 28px;
      background: linear-gradient(145deg, #1a1a2e 0%, #16213e 100%);
      margin: 16px;
      border-radius: 20px;
      color: white;
    }
    .hero-icon {
      width: 64px; height: 64px;
      border-radius: 50%;
      background: rgba(252, 192, 11, 0.2);
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px;
      ion-icon { font-size: 28px; color: #fcc00b; }
    }
    .hero-card h2 {
      font-size: 20px; font-weight: 800; margin: 0 0 8px;
    }
    .hero-card p {
      font-size: 14px; opacity: 0.8; margin: 0;
      line-height: 1.5;
    }

    .section-label {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 13px; font-weight: 700; color: #999;
      text-transform: uppercase; letter-spacing: .5px;
      margin: 20px 20px 8px;
    }

    .config-card {
      margin: 0 16px 12px;
      border-radius: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
      --background: white;

      ion-item {
        --min-height: 56px;
        --padding-start: 0;
        ion-icon { font-size: 20px; margin-right: 12px; }
        h2 { font-size: 15px !important; font-weight: 600 !important; }
        p { font-size: 13px !important; color: #999 !important; }
      }
    }

    .field-hint {
      font-size: 12px; color: #aaa;
      padding: 4px 16px 8px; font-style: italic;
    }

    .info-card { background: #f0f4ff; }
    .info-row {
      display: flex; gap: 12px; align-items: flex-start;
      ion-icon { font-size: 22px; margin-top: 2px; flex-shrink: 0; }
    }
    .info-text { font-size: 13px; color: #333; margin: 0 0 8px; font-weight: 600; }
    .webhook-url {
      display: block; font-size: 11px; background: #e8edf5;
      padding: 8px 10px; border-radius: 8px; word-break: break-all;
      color: #1a1a2e; font-family: monospace; margin-bottom: 6px;
    }
    .info-hint { font-size: 11px; color: #888; margin: 0; }

    .capabilities {
      display: flex; flex-direction: column; gap: 10px;
    }
    .capability {
      display: flex; align-items: center; gap: 10px;
      font-size: 14px; color: #333; font-weight: 500;
      ion-icon { font-size: 20px; flex-shrink: 0; }
    }

    .save-section { padding: 16px; }
    .save-btn {
      --border-radius: 14px;
      font-weight: 700; font-size: 16px; min-height: 52px;
    }

    .loading-center {
      display: flex; justify-content: center; padding: 32px;
    }

    .empty-logs {
      text-align: center; padding: 32px 16px;
      ion-icon { font-size: 48px; margin-bottom: 12px; }
      p { font-size: 15px; font-weight: 600; color: #666; margin: 0 0 4px; }
      .subtitle { font-size: 13px; color: #aaa; font-weight: 400; }
    }

    .call-log-accordion {
      margin: 0 16px 16px;
    }

    .call-status-dot {
      width: 10px; height: 10px; border-radius: 50%;
      margin-right: 12px; flex-shrink: 0;
      &.completed { background: #00c853; }
      &.transferred { background: #ff9100; }
      &.error { background: #ff1744; }
      &.no-input { background: #999; }
    }

    .call-detail {
      padding: 16px;
      background: #fafafa;
    }

    .call-summary {
      font-size: 13px; color: #444;
      padding: 10px 12px; background: white;
      border-radius: 10px; margin-bottom: 12px;
      border-left: 3px solid #fcc00b;
    }

    .call-actions {
      margin-bottom: 12px;
      strong { font-size: 12px; color: #666; display: block; margin-bottom: 6px; }
      ion-chip {
        font-size: 11px; height: 28px;
        --padding-start: 8px; --padding-end: 10px;
        ion-icon { font-size: 14px; }
      }
    }

    .transcript {
      strong { font-size: 12px; color: #666; display: block; margin-bottom: 8px; }
    }

    .transcript-msg {
      padding: 8px 12px; border-radius: 10px; margin-bottom: 6px;
      font-size: 13px; line-height: 1.5;
      &.user {
        background: #e3f2fd; margin-left: 0; margin-right: 24px;
      }
      &.assistant {
        background: #f5f5f5; margin-left: 24px; margin-right: 0;
      }
      .msg-role {
        font-weight: 700; font-size: 11px;
        text-transform: uppercase; letter-spacing: .3px;
        display: block; margin-bottom: 2px;
        color: #888;
      }
      .msg-text { color: #333; }
    }

    .bottom-spacer { height: 40px; }
  `],
})
export class PhoneSettingsComponent implements OnInit {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private ui = inject(UiService);
  private db = inject(FirestoreService);

  saving = signal(false);
  loadingLogs = signal(false);
  callLogs = signal<CallLog[]>([]);
  hasChanges = signal(false);

  config: PhoneConfig = {
    enabled: false,
    twilioPhoneNumber: '',
    transferNumber: '',
    greeting: '',
    businessHours: '',
    pricingInfo: '',
    locationInfo: '',
  };

  private originalConfig = '';

  constructor() {
    addIcons({
      callOutline, settingsOutline, saveOutline, refreshOutline,
      chatbubblesOutline, timeOutline, checkmarkCircleOutline,
      arrowForwardOutline, closeCircleOutline, personOutline,
      informationCircleOutline, flashOutline,
    });
  }

  ngOnInit(): void {
    this.loadConfig();
    this.loadCallLogs();
  }

  markChanged(): void {
    this.hasChanges.set(JSON.stringify(this.config) !== this.originalConfig);
  }

  async loadConfig(): Promise<void> {
    try {
      const companyId = this.auth.companyId();
      if (!companyId) return;

      const doc$ = this.db.getDocument<PhoneConfig>(`companies/${companyId}/meta/phoneAgent`);
      const { firstValueFrom, timeout, catchError, of } = await import('rxjs');
      const saved = await firstValueFrom(
        doc$.pipe(timeout(5000), catchError(() => of(null)))
      );
      if (saved) {
        this.config = {
          enabled: saved.enabled ?? false,
          twilioPhoneNumber: saved.twilioPhoneNumber ?? '',
          transferNumber: saved.transferNumber ?? '',
          greeting: saved.greeting ?? '',
          businessHours: saved.businessHours ?? '',
          pricingInfo: saved.pricingInfo ?? '',
          locationInfo: saved.locationInfo ?? '',
        };
        this.originalConfig = JSON.stringify(this.config);
      }
    } catch {
      // Use defaults on error
    }
  }

  async saveConfig(): Promise<void> {
    this.saving.set(true);
    try {
      await this.api.call('savePhoneConfig', {
        enabled: this.config.enabled,
        twilioPhoneNumber: this.config.twilioPhoneNumber,
        transferNumber: this.config.transferNumber,
        greeting: this.config.greeting,
        businessHours: this.config.businessHours,
        pricingInfo: this.config.pricingInfo,
        locationInfo: this.config.locationInfo,
      });
      this.originalConfig = JSON.stringify(this.config);
      this.hasChanges.set(false);
      await this.ui.toast('Phone agent settings saved!', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save settings';
      await this.ui.toast(msg, 'danger');
    } finally {
      this.saving.set(false);
    }
  }

  async loadCallLogs(): Promise<void> {
    this.loadingLogs.set(true);
    try {
      const result = await this.api.call<{ calls: CallLog[] }>('getCallLog', { limit: 25 });
      this.callLogs.set(result.calls || []);
    } catch {
      // Silently fail — maybe no logs yet
      this.callLogs.set([]);
    } finally {
      this.loadingLogs.set(false);
    }
  }

  formatDate(iso: string | null): string {
    if (!iso) return 'Unknown';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }
}
