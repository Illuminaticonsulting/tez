import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
  IonBackButton, IonButton, IonIcon, IonList, IonItem,
  IonLabel, IonToggle, IonInput, IonTextarea, IonNote,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chatboxOutline, mailOutline, saveOutline, checkmarkCircleOutline,
  notificationsOutline, informationCircleOutline,
} from 'ionicons/icons';
import { AuthService, UiService, FirestoreService, ApiService } from '../../../core/services';

interface NotifyConfig {
  autoSendSms: boolean;
  autoSendEmail: boolean;
  smsTextCheckIn: string;
  smsTextExitOut: string;
  twilioPhoneNumber: string;
  sendgridFromEmail: string;
}

@Component({
  selector: 'app-notification-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonBackButton, IonButton, IonIcon, IonList, IonItem,
    IonLabel, IonToggle, IonInput, IonTextarea, IonNote,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/profile"></ion-back-button>
        </ion-buttons>
        <ion-title>Notification Settings</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="settings-wrapper">
        <!-- SMS Settings -->
        <div class="section-card">
          <div class="section-header">
            <ion-icon name="chatbox-outline" color="primary"></ion-icon>
            <div>
              <h3>SMS Notifications</h3>
              <p>Send text messages to customers at each step</p>
            </div>
          </div>

          <ion-list>
            <ion-item detail="false">
              <ion-label>
                <h3>Auto-Send SMS</h3>
                <p>Automatically text customers on status changes</p>
              </ion-label>
              <ion-toggle slot="end" [(ngModel)]="config.autoSendSms" aria-label="Toggle auto SMS"></ion-toggle>
            </ion-item>

            <ion-item>
              <ion-label position="stacked">Twilio Phone Number</ion-label>
              <ion-input [(ngModel)]="config.twilioPhoneNumber" placeholder="+1234567890" type="tel"></ion-input>
              <ion-note slot="helper">The number SMS messages are sent from</ion-note>
            </ion-item>
          </ion-list>
        </div>

        <!-- SMS Templates -->
        <div class="section-card">
          <div class="section-header">
            <ion-icon name="chatbox-outline" color="warning"></ion-icon>
            <div>
              <h3>SMS Templates</h3>
              <p>Customize messages sent to customers</p>
            </div>
          </div>

          <ion-list>
            <ion-item>
              <ion-label position="stacked">Check-In Message</ion-label>
              <ion-textarea
                [(ngModel)]="config.smsTextCheckIn"
                [placeholder]="'Your vehicle (PLATE) has been checked in. Ticket #TICKET.'"
                [rows]="3"
                [autoGrow]="true"
              ></ion-textarea>
              <ion-note slot="helper">Use {{ '{' }}ticketNumber{{ '}' }} and {{ '{' }}plate{{ '}' }} as placeholders</ion-note>
            </ion-item>

            <ion-item>
              <ion-label position="stacked">Vehicle Ready / Exit Message</ion-label>
              <ion-textarea
                [(ngModel)]="config.smsTextExitOut"
                [placeholder]="'🚗 Your vehicle is on its way! Ticket #TICKET. Head to the pickup area.'"
                [rows]="3"
                [autoGrow]="true"
              ></ion-textarea>
              <ion-note slot="helper">Sent when the vehicle is ready for pickup</ion-note>
            </ion-item>
          </ion-list>
        </div>

        <!-- Email Settings -->
        <div class="section-card">
          <div class="section-header">
            <ion-icon name="mail-outline" color="success"></ion-icon>
            <div>
              <h3>Email Notifications</h3>
              <p>Send email confirmations and receipts</p>
            </div>
          </div>

          <ion-list>
            <ion-item detail="false">
              <ion-label>
                <h3>Auto-Send Emails</h3>
                <p>Confirmation on booking, receipt on completion</p>
              </ion-label>
              <ion-toggle slot="end" [(ngModel)]="config.autoSendEmail" aria-label="Toggle auto email"></ion-toggle>
            </ion-item>

            <ion-item>
              <ion-label position="stacked">From Email Address</ion-label>
              <ion-input [(ngModel)]="config.sendgridFromEmail" placeholder="noreply@yourcompany.com" type="email"></ion-input>
              <ion-note slot="helper">Must be verified in SendGrid</ion-note>
            </ion-item>
          </ion-list>
        </div>

        <!-- Journey Overview -->
        <div class="section-card">
          <div class="section-header">
            <ion-icon name="information-circle-outline" color="medium"></ion-icon>
            <div>
              <h3>Customer Journey Notifications</h3>
              <p>What gets sent at each stage</p>
            </div>
          </div>

          <div class="journey-table">
            <div class="journey-row journey-header">
              <span class="journey-stage">Stage</span>
              <span class="journey-sms">SMS</span>
              <span class="journey-email">Email</span>
            </div>
            <div class="journey-row">
              <span class="journey-stage">📋 Booking Created</span>
              <span class="journey-sms">✅</span>
              <span class="journey-email">✅ Confirmation</span>
            </div>
            <div class="journey-row">
              <span class="journey-stage">🔑 Check-In</span>
              <span class="journey-sms">✅</span>
              <span class="journey-email">—</span>
            </div>
            <div class="journey-row">
              <span class="journey-stage">🅿️ Vehicle Parked</span>
              <span class="journey-sms">✅</span>
              <span class="journey-email">—</span>
            </div>
            <div class="journey-row">
              <span class="journey-stage">🚗 Vehicle Ready</span>
              <span class="journey-sms">✅ Custom</span>
              <span class="journey-email">—</span>
            </div>
            <div class="journey-row">
              <span class="journey-stage">✅ Completed</span>
              <span class="journey-sms">✅ Receipt</span>
              <span class="journey-email">✅ Receipt</span>
            </div>
            <div class="journey-row">
              <span class="journey-stage">❌ Cancelled</span>
              <span class="journey-sms">✅</span>
              <span class="journey-email">✅</span>
            </div>
          </div>
        </div>

        <!-- Save -->
        <ion-button expand="block" (click)="save()" [disabled]="saving()" class="save-btn">
          <ion-icon name="save-outline" slot="start"></ion-icon>
          {{ saving() ? 'Saving...' : 'Save Notification Settings' }}
        </ion-button>
      </div>
    </ion-content>
  `,
  styles: [`
    .settings-wrapper { max-width: 600px; margin: 0 auto; }
    .section-card {
      background: white; border-radius: 16px; padding: 20px;
      margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.05);
    }
    .section-header {
      display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px;
      ion-icon { font-size: 24px; margin-top: 2px; flex-shrink: 0; }
      h3 { margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #1a1a2e; }
      p { margin: 0; font-size: 13px; color: #999; }
    }
    ion-list { margin: 0; padding: 0; --ion-item-background: transparent; }
    ion-item { --padding-start: 0; --inner-padding-end: 0; }
    .journey-table { border-radius: 8px; overflow: hidden; border: 1px solid #f0f0f0; }
    .journey-row {
      display: grid; grid-template-columns: 1fr 60px 100px;
      padding: 10px 14px; border-bottom: 1px solid #f5f5f5;
      font-size: 13px; align-items: center;
    }
    .journey-row:last-child { border-bottom: none; }
    .journey-header { background: #f8f9fa; font-weight: 700; color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
    .journey-sms, .journey-email { text-align: center; }
    .save-btn {
      margin-top: 24px; margin-bottom: 40px;
      --border-radius: 14px;
      font-weight: 700; font-size: 16px; min-height: 52px;
    }
  `],
})
export class NotificationSettingsComponent implements OnInit {
  private auth = inject(AuthService);
  private ui = inject(UiService);
  private db = inject(FirestoreService);
  private api = inject(ApiService);

  readonly saving = signal(false);

  config: NotifyConfig = {
    autoSendSms: true,
    autoSendEmail: true,
    smsTextCheckIn: '',
    smsTextExitOut: '',
    twilioPhoneNumber: '',
    sendgridFromEmail: '',
  };

  constructor() {
    addIcons({ chatboxOutline, mailOutline, saveOutline, checkmarkCircleOutline, notificationsOutline, informationCircleOutline });
  }

  ngOnInit(): void {
    this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    const companyId = this.auth.companyId();
    if (!companyId) return;

    try {
      const { firstValueFrom } = await import('rxjs');
      const companyDoc = await firstValueFrom(
        this.db.getDocument<Record<string, unknown>>(`companies/${companyId}`)
      );
      if (companyDoc) {
        const settings = (companyDoc as Record<string, unknown>)['settings'] as Record<string, unknown> || {};
        this.config = {
          autoSendSms: (settings['autoSendSms'] as boolean) ?? true,
          autoSendEmail: (settings['autoSendEmail'] as boolean) ?? true,
          smsTextCheckIn: ((companyDoc as Record<string, unknown>)['smsTextCheckIn'] as string) || '',
          smsTextExitOut: ((companyDoc as Record<string, unknown>)['smsTextExitOut'] as string) || '',
          twilioPhoneNumber: ((companyDoc as Record<string, unknown>)['twilioPhoneNumber'] as string) || '',
          sendgridFromEmail: ((companyDoc as Record<string, unknown>)['sendgridFromEmail'] as string) || '',
        };
      }
    } catch {
      // Use defaults
    }
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      const companyId = this.auth.companyId();
      if (!companyId) throw new Error('No company');

      await this.db.updateDocument(`companies/${companyId}`, {
        'settings.autoSendSms': this.config.autoSendSms,
        'settings.autoSendEmail': this.config.autoSendEmail,
        smsTextCheckIn: this.config.smsTextCheckIn,
        smsTextExitOut: this.config.smsTextExitOut,
        twilioPhoneNumber: this.config.twilioPhoneNumber,
        sendgridFromEmail: this.config.sendgridFromEmail,
      });

      this.ui.toast('Notification settings saved!', 'success');
    } catch {
      this.ui.toast('Failed to save settings', 'danger');
    } finally {
      this.saving.set(false);
    }
  }
}
