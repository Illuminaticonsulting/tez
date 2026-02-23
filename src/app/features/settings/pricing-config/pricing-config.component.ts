import { Component, inject, signal, computed, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonBackButton, IonButtons,
  IonList, IonItem, IonLabel, IonInput, IonButton,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonBadge,
  IonSegment, IonSegmentButton, IonRange, IonSelect, IonSelectOption,
  IonNote, IonSpinner, IonChip,
} from '@ionic/angular/standalone';
import { AuthService, UiService } from '../../../core/services';
import { FirestoreService } from '../../../core/services/firestore.service';
import { ApiService } from '../../../core/services/api.service';

interface PricingFactor {
  name: string;
  description: string;
  multiplier: number;
  applied: boolean;
}

interface PriceQuote {
  baseHourlyRate: number;
  baseDailyRate: number;
  currency: string;
  factors: PricingFactor[];
  rawMultiplier: number;
  cappedMultiplier: number;
  smoothedMultiplier: number;
  effectiveHourlyRate: number;
  subtotal: number;
  taxAmount: number;
  taxRate: number;
  totalPrice: number;
  dailyCap: number;
  dailyCapApplied: boolean;
  savingsFromLoyalty: number;
  savingsFromAdvance: number;
  quotedAt: string;
  quoteId: string;
  estimatedHours: number;
  vehicleType: string;
}

@Component({
  selector: 'app-pricing-config',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, CurrencyPipe,
    IonContent, IonHeader, IonToolbar, IonTitle, IonBackButton, IonButtons,
    IonList, IonItem, IonLabel, IonInput, IonButton,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonBadge,
    IonSegment, IonSegmentButton, IonRange, IonSelect, IonSelectOption,
    IonNote, IonSpinner, IonChip,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/profile"></ion-back-button>
        </ion-buttons>
        <ion-title>Dynamic Pricing</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-segment [value]="activeTab()" (ionChange)="activeTab.set($any($event).detail.value)">
          <ion-segment-button value="config">
            <ion-label>Configuration</ion-label>
          </ion-segment-button>
          <ion-segment-button value="simulator">
            <ion-label>Live Simulator</ion-label>
          </ion-segment-button>
          <ion-segment-button value="factors">
            <ion-label>Factor Matrix</ion-label>
          </ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- ═══ CONFIG TAB ═══ -->
      @if (activeTab() === 'config') {
        <div class="section-container">
          <!-- Base Rates -->
          <ion-card>
            <ion-card-header>
              <ion-card-title>
                <span class="card-icon">💰</span> Base Rates
              </ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <ion-list lines="none">
                <ion-item>
                  <ion-input
                    label="Hourly Rate ($)"
                    labelPlacement="stacked"
                    type="number"
                    [value]="config()['baseHourlyRate']"
                    (ionInput)="updateConfig('baseHourlyRate', $any($event).detail.value)"
                    [placeholder]="'5.00'"
                  ></ion-input>
                </ion-item>
                <ion-item>
                  <ion-input
                    label="Daily Maximum ($)"
                    labelPlacement="stacked"
                    type="number"
                    [value]="config()['baseDailyRate']"
                    (ionInput)="updateConfig('baseDailyRate', $any($event).detail.value)"
                    [placeholder]="'30.00'"
                  ></ion-input>
                </ion-item>
                <ion-item>
                  <ion-input
                    label="Tax Rate (%)"
                    labelPlacement="stacked"
                    type="number"
                    [value]="config()['taxRate'] * 100"
                    (ionInput)="updateConfig('taxRate', $any($event).detail.value / 100)"
                    [placeholder]="'8'"
                  ></ion-input>
                </ion-item>
                <ion-item>
                  <ion-select
                    label="Currency"
                    labelPlacement="stacked"
                    [value]="config()['currency']"
                    (ionChange)="updateConfig('currency', $any($event).detail.value)"
                  >
                    <ion-select-option value="USD">USD</ion-select-option>
                    <ion-select-option value="EUR">EUR</ion-select-option>
                    <ion-select-option value="GBP">GBP</ion-select-option>
                    <ion-select-option value="CAD">CAD</ion-select-option>
                    <ion-select-option value="AED">AED</ion-select-option>
                  </ion-select>
                </ion-item>
              </ion-list>
            </ion-card-content>
          </ion-card>

          <!-- Fairness Caps -->
          <ion-card>
            <ion-card-header>
              <ion-card-title>
                <span class="card-icon">🛡️</span> Fairness Controls
              </ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <ion-list lines="none">
                <ion-item>
                  <ion-label>
                    <h3>Maximum Price Multiplier</h3>
                    <p>Cap: {{ config()['maxTotalMultiplier'] }}x — Price never exceeds this multiple of base rate</p>
                  </ion-label>
                  <ion-range
                    [min]="1" [max]="5" [step]="0.25" [pin]="true"
                    [value]="config()['maxTotalMultiplier']"
                    (ionInput)="updateConfig('maxTotalMultiplier', $any($event).detail.value)"
                    aria-label="Max multiplier"
                  ></ion-range>
                </ion-item>
                <ion-item>
                  <ion-label>
                    <h3>Minimum Price Multiplier</h3>
                    <p>Floor: {{ config()['minTotalMultiplier'] }}x — Price never drops below this</p>
                  </ion-label>
                  <ion-range
                    [min]="0.2" [max]="1" [step]="0.05" [pin]="true"
                    [value]="config()['minTotalMultiplier']"
                    (ionInput)="updateConfig('minTotalMultiplier', $any($event).detail.value)"
                    aria-label="Min multiplier"
                  ></ion-range>
                </ion-item>
                <ion-item>
                  <ion-label>
                    <h3>Price Smoothing</h3>
                    <p>{{ smoothingLabel() }} — Prevents jarring price swings</p>
                  </ion-label>
                  <ion-range
                    [min]="0" [max]="1" [step]="0.05" [pin]="true"
                    [value]="config()['smoothingFactor']"
                    (ionInput)="updateConfig('smoothingFactor', $any($event).detail.value)"
                    aria-label="Smoothing factor"
                  ></ion-range>
                </ion-item>
              </ion-list>
            </ion-card-content>
          </ion-card>

          <!-- Time of Day -->
          <ion-card>
            <ion-card-header>
              <ion-card-title>
                <span class="card-icon">🕐</span> Time-of-Day Multipliers
              </ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <div class="hour-grid">
                @for (hour of hours; track hour) {
                  <div class="hour-cell" [class.peak]="config()['hourlyMultipliers'][hour] > 1.1" [class.offpeak]="config()['hourlyMultipliers'][hour] < 0.9">
                    <span class="hour-label">{{ hour }}:00</span>
                    <span class="hour-value">{{ config()['hourlyMultipliers'][hour] }}x</span>
                  </div>
                }
              </div>
            </ion-card-content>
          </ion-card>

          <!-- Day of Week -->
          <ion-card>
            <ion-card-header>
              <ion-card-title>
                <span class="card-icon">📅</span> Day-of-Week Multipliers
              </ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <div class="day-grid">
                @for (day of dayNames; track day; let i = $index) {
                  <div class="day-cell" [class.premium]="config()['dayOfWeekMultipliers'][i] > 1.1">
                    <span class="day-name">{{ day }}</span>
                    <span class="day-value">{{ config()['dayOfWeekMultipliers'][i] }}x</span>
                  </div>
                }
              </div>
            </ion-card-content>
          </ion-card>

          <!-- Vehicle Surcharges -->
          <ion-card>
            <ion-card-header>
              <ion-card-title>
                <span class="card-icon">🚗</span> Vehicle Type Pricing
              </ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <ion-list lines="none">
                @for (vt of vehicleTypes; track vt.key) {
                  <ion-item>
                    <ion-label>
                      <h3>{{ vt.label }}</h3>
                    </ion-label>
                    <ion-badge slot="end" [color]="vt.surcharge > 0 ? 'warning' : vt.surcharge < 0 ? 'success' : 'medium'">
                      {{ vt.surcharge > 0 ? '+' : '' }}{{ vt.surcharge * 100 }}%
                    </ion-badge>
                  </ion-item>
                }
              </ion-list>
            </ion-card-content>
          </ion-card>

          <!-- Save Button -->
          <div class="save-container">
            <ion-button expand="block" (click)="saveConfig()" [disabled]="saving()">
              @if (saving()) {
                <ion-spinner name="crescent"></ion-spinner>
              } @else {
                Save Pricing Configuration
              }
            </ion-button>
          </div>
        </div>
      }

      <!-- ═══ SIMULATOR TAB ═══ -->
      @if (activeTab() === 'simulator') {
        <div class="section-container">
          <ion-card class="simulator-card">
            <ion-card-header>
              <ion-card-title>
                <span class="card-icon">🧪</span> Price Simulator
              </ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <ion-list lines="none">
                <ion-item>
                  <ion-input
                    label="Estimated Hours"
                    labelPlacement="stacked"
                    type="number"
                    [value]="simHours()"
                    (ionInput)="simHours.set(+$any($event).detail.value || 1)"
                    [placeholder]="'4'"
                  ></ion-input>
                </ion-item>
                <ion-item>
                  <ion-select
                    label="Vehicle Type"
                    labelPlacement="stacked"
                    [value]="simVehicle()"
                    (ionChange)="simVehicle.set($any($event).detail.value)"
                  >
                    <ion-select-option value="standard">Standard</ion-select-option>
                    <ion-select-option value="compact">Compact</ion-select-option>
                    <ion-select-option value="suv">SUV</ion-select-option>
                    <ion-select-option value="luxury">Luxury</ion-select-option>
                    <ion-select-option value="ev">Electric Vehicle</ion-select-option>
                    <ion-select-option value="oversized">Oversized</ion-select-option>
                  </ion-select>
                </ion-item>
                <ion-item>
                  <ion-input
                    label="Days Booked in Advance"
                    labelPlacement="stacked"
                    type="number"
                    [value]="simAdvanceDays()"
                    (ionInput)="simAdvanceDays.set(+$any($event).detail.value || 0)"
                    [placeholder]="'0'"
                  ></ion-input>
                </ion-item>
              </ion-list>

              <ion-button expand="block" class="sim-button" (click)="runSimulation()" [disabled]="simulating()">
                @if (simulating()) {
                  <ion-spinner name="crescent"></ion-spinner>
                } @else {
                  Get Live Price Quote
                }
              </ion-button>
            </ion-card-content>
          </ion-card>

          <!-- Quote Result -->
          @if (lastQuote()) {
            <ion-card class="quote-card">
              <ion-card-header>
                <ion-card-title class="quote-price">
                  {{ lastQuote()!.totalPrice | currency:lastQuote()!.currency }}
                </ion-card-title>
                <p class="quote-subtitle">for {{ lastQuote()!.estimatedHours }} hours · {{ lastQuote()!.vehicleType }}</p>
              </ion-card-header>
              <ion-card-content>
                <!-- Rate Breakdown -->
                <div class="quote-row">
                  <span>Base Hourly Rate</span>
                  <span>{{ lastQuote()!.baseHourlyRate | currency:lastQuote()!.currency }}/hr</span>
                </div>
                <div class="quote-row highlight">
                  <span>Effective Rate</span>
                  <span>{{ lastQuote()!.effectiveHourlyRate | currency:lastQuote()!.currency }}/hr</span>
                </div>
                <div class="quote-row">
                  <span>Multiplier</span>
                  <ion-badge [color]="lastQuote()!.smoothedMultiplier > 1.2 ? 'warning' : lastQuote()!.smoothedMultiplier < 0.9 ? 'success' : 'primary'">
                    {{ lastQuote()!.smoothedMultiplier }}x
                  </ion-badge>
                </div>

                <div class="divider"></div>

                <!-- Factors -->
                <h4 class="factors-title">Pricing Factors</h4>
                @for (f of lastQuote()!.factors; track f.name) {
                  <div class="factor-row" [class.active]="f.applied">
                    <div class="factor-info">
                      <span class="factor-name">{{ f.name }}</span>
                      <span class="factor-desc">{{ f.description }}</span>
                    </div>
                    <ion-chip [color]="f.multiplier > 1 ? 'warning' : f.multiplier < 1 ? 'success' : 'medium'" [outline]="!f.applied">
                      {{ f.multiplier > 1 ? '+' : '' }}{{ ((f.multiplier - 1) * 100) | number:'1.0-0' }}%
                    </ion-chip>
                  </div>
                }

                <div class="divider"></div>

                <!-- Totals -->
                <div class="quote-row">
                  <span>Subtotal</span>
                  <span>{{ lastQuote()!.subtotal | currency:lastQuote()!.currency }}</span>
                </div>
                @if (lastQuote()!.taxAmount > 0) {
                  <div class="quote-row">
                    <span>Tax ({{ lastQuote()!.taxRate * 100 }}%)</span>
                    <span>{{ lastQuote()!.taxAmount | currency:lastQuote()!.currency }}</span>
                  </div>
                }
                @if (lastQuote()!.dailyCapApplied) {
                  <div class="quote-row savings">
                    <span>Daily cap applied</span>
                    <span>{{ lastQuote()!.dailyCap | currency:lastQuote()!.currency }}/day</span>
                  </div>
                }
                @if (lastQuote()!.savingsFromLoyalty > 0) {
                  <div class="quote-row savings">
                    <span>Loyalty savings</span>
                    <span>-{{ lastQuote()!.savingsFromLoyalty | currency:lastQuote()!.currency }}</span>
                  </div>
                }
                @if (lastQuote()!.savingsFromAdvance > 0) {
                  <div class="quote-row savings">
                    <span>Advance booking savings</span>
                    <span>-{{ lastQuote()!.savingsFromAdvance | currency:lastQuote()!.currency }}</span>
                  </div>
                }
                <div class="quote-row total">
                  <span>Total</span>
                  <span>{{ lastQuote()!.totalPrice | currency:lastQuote()!.currency }}</span>
                </div>

                <ion-note class="quote-meta">
                  Quote ID: {{ lastQuote()!.quoteId }}
                </ion-note>
              </ion-card-content>
            </ion-card>
          }
        </div>
      }

      <!-- ═══ FACTORS TAB ═══ -->
      @if (activeTab() === 'factors') {
        <div class="section-container">
          <ion-card>
            <ion-card-header>
              <ion-card-title>
                <span class="card-icon">📊</span> 10-Factor Pricing Model
              </ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <p class="factor-intro">
                Tez uses a transparent 10-factor pricing model. Every factor is
                individually visible to the customer — no opaque surge multipliers.
              </p>

              <div class="factor-matrix">
                @for (fm of factorMatrix; track fm.name) {
                  <div class="matrix-row">
                    <div class="matrix-icon">{{ fm.icon }}</div>
                    <div class="matrix-info">
                      <h4>{{ fm.name }}</h4>
                      <p>{{ fm.description }}</p>
                      <div class="matrix-range">
                        <ion-badge color="success">{{ fm.minEffect }}</ion-badge>
                        <span class="range-arrow">→</span>
                        <ion-badge color="warning">{{ fm.maxEffect }}</ion-badge>
                      </div>
                    </div>
                  </div>
                }
              </div>

              <div class="advantages">
                <h4>Why This Beats Uber's Surge Pricing</h4>
                <div class="advantage-item">
                  <span class="adv-icon">✅</span>
                  <span><strong>Transparency</strong> — Every factor is visible; customers see WHY the price is what it is</span>
                </div>
                <div class="advantage-item">
                  <span class="adv-icon">✅</span>
                  <span><strong>Fairness Cap</strong> — Hard ceiling prevents exploitative pricing (Uber has none)</span>
                </div>
                <div class="advantage-item">
                  <span class="adv-icon">✅</span>
                  <span><strong>Duration Rewards</strong> — Longer stays get BETTER rates (opposite of surge)</span>
                </div>
                <div class="advantage-item">
                  <span class="adv-icon">✅</span>
                  <span><strong>Loyalty Program</strong> — Repeat customers earn discounts up to 20%</span>
                </div>
                <div class="advantage-item">
                  <span class="adv-icon">✅</span>
                  <span><strong>Advance Booking</strong> — Plan ahead and save up to 20%</span>
                </div>
                <div class="advantage-item">
                  <span class="adv-icon">✅</span>
                  <span><strong>Smooth Transitions</strong> — EMA prevents price shock between quotes</span>
                </div>
                <div class="advantage-item">
                  <span class="adv-icon">✅</span>
                  <span><strong>Full Audit Trail</strong> — Every quote is logged with all factors for dispute resolution</span>
                </div>
              </div>
            </ion-card-content>
          </ion-card>
        </div>
      }
    </ion-content>
  `,
  styles: [`
    ion-toolbar { --background: #fafafa; }
    ion-title { font-weight: 700; }
    ion-segment { --background: #f0f0f0; }
    .section-container { padding: 16px; }

    .card-icon { font-size: 20px; margin-right: 8px; }
    ion-card { border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,.06); margin-bottom: 16px; }
    ion-card-title { font-size: 18px; font-weight: 700; display: flex; align-items: center; }

    /* Hour grid */
    .hour-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
    .hour-cell {
      text-align: center; padding: 8px 4px; border-radius: 8px;
      background: #f5f5f5; font-size: 11px;
    }
    .hour-cell.peak { background: #fff3e0; color: #e65100; }
    .hour-cell.offpeak { background: #e8f5e9; color: #2e7d32; }
    .hour-label { display: block; font-weight: 600; font-size: 10px; color: #999; }
    .hour-value { display: block; font-weight: 700; font-size: 13px; }

    /* Day grid */
    .day-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
    .day-cell {
      text-align: center; padding: 10px 4px; border-radius: 8px;
      background: #f5f5f5; font-size: 12px;
    }
    .day-cell.premium { background: #fff3e0; }
    .day-name { display: block; font-weight: 600; font-size: 10px; color: #999; }
    .day-value { display: block; font-weight: 700; font-size: 14px; }

    /* Save */
    .save-container { padding: 16px 0 32px; }

    /* Simulator */
    .simulator-card { border: 2px solid #4f46e5; }
    .sim-button { margin-top: 16px; --background: #4f46e5; }

    /* Quote */
    .quote-card { border: 2px solid #10b981; }
    .quote-price { font-size: 36px !important; font-weight: 800; color: #10b981; }
    .quote-subtitle { font-size: 14px; color: #666; margin-top: 4px; }

    .quote-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 0; font-size: 14px;
    }
    .quote-row.highlight { font-weight: 700; color: #4f46e5; }
    .quote-row.savings { color: #10b981; }
    .quote-row.total { font-weight: 800; font-size: 18px; border-top: 2px solid #eee; padding-top: 12px; margin-top: 4px; }

    .divider { height: 1px; background: #eee; margin: 12px 0; }

    .factors-title { font-size: 14px; font-weight: 700; color: #555; margin: 0 0 8px; }

    .factor-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 6px 0; opacity: 0.5;
    }
    .factor-row.active { opacity: 1; }
    .factor-info { display: flex; flex-direction: column; }
    .factor-name { font-weight: 600; font-size: 13px; }
    .factor-desc { font-size: 11px; color: #888; }

    .quote-meta { display: block; margin-top: 12px; font-size: 11px; text-align: center; }

    /* Factor Matrix */
    .factor-intro { font-size: 14px; color: #666; margin-bottom: 16px; line-height: 1.5; }
    .factor-matrix { margin-bottom: 24px; }
    .matrix-row {
      display: flex; gap: 12px; padding: 12px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .matrix-icon { font-size: 24px; width: 36px; text-align: center; }
    .matrix-info h4 { margin: 0 0 4px; font-size: 14px; font-weight: 700; }
    .matrix-info p { margin: 0 0 6px; font-size: 12px; color: #888; }
    .matrix-range { display: flex; align-items: center; gap: 6px; }
    .range-arrow { color: #999; font-size: 12px; }

    .advantages { background: #f0fdf4; border-radius: 12px; padding: 16px; margin-top: 16px; }
    .advantages h4 { margin: 0 0 12px; font-size: 16px; font-weight: 700; color: #166534; }
    .advantage-item { display: flex; gap: 8px; margin-bottom: 10px; font-size: 13px; line-height: 1.4; }
    .adv-icon { font-size: 16px; flex-shrink: 0; }
  `],
})
export class PricingConfigComponent implements OnInit {
  private auth = inject(AuthService);
  private db = inject(FirestoreService);
  private api = inject(ApiService);
  private ui = inject(UiService);

  readonly activeTab = signal<'config' | 'simulator' | 'factors'>('config');
  readonly saving = signal(false);
  readonly simulating = signal(false);
  readonly lastQuote = signal<PriceQuote | null>(null);

  // Simulator inputs
  readonly simHours = signal(4);
  readonly simVehicle = signal('standard');
  readonly simAdvanceDays = signal(0);

  readonly config = signal<Record<string, any>>({
    baseHourlyRate: 5.00,
    baseDailyRate: 30.00,
    currency: 'USD',
    taxRate: 0.0,
    maxTotalMultiplier: 2.50,
    minTotalMultiplier: 0.50,
    smoothingFactor: 0.30,
    hourlyMultipliers: [
      0.70, 0.70, 0.70, 0.70, 0.70, 0.80,
      0.90, 1.20, 1.30, 1.10, 1.00, 1.00,
      1.00, 1.00, 1.00, 1.10, 1.30, 1.30,
      1.20, 1.10, 1.00, 0.90, 0.80, 0.70,
    ],
    dayOfWeekMultipliers: [1.25, 1.00, 1.00, 1.00, 1.05, 1.15, 1.30],
    vehicleSurcharges: {
      standard: 0.00, compact: -0.05, suv: 0.10,
      truck: 0.10, luxury: 0.25, oversized: 0.30, ev: -0.05,
    },
  });

  readonly smoothingLabel = computed(() => {
    const v = this.config()['smoothingFactor'] ?? 0.3;
    if (v <= 0.1) return 'Very smooth (slow changes)';
    if (v <= 0.3) return 'Moderate smoothing';
    if (v <= 0.6) return 'Light smoothing';
    return 'Responsive (fast changes)';
  });

  readonly hours = Array.from({ length: 24 }, (_, i) => i);
  readonly dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  readonly vehicleTypes = [
    { key: 'compact', label: 'Compact', surcharge: -0.05 },
    { key: 'standard', label: 'Standard', surcharge: 0.00 },
    { key: 'suv', label: 'SUV / Truck', surcharge: 0.10 },
    { key: 'luxury', label: 'Luxury', surcharge: 0.25 },
    { key: 'oversized', label: 'Oversized', surcharge: 0.30 },
    { key: 'ev', label: 'Electric Vehicle', surcharge: -0.05 },
  ];

  readonly factorMatrix = [
    { icon: '🕐', name: 'Time of Day', description: 'Peak/off-peak hour multipliers based on historical demand patterns', minEffect: '-30%', maxEffect: '+30%' },
    { icon: '📅', name: 'Day of Week', description: 'Weekend premium reflects higher weekend parking demand', minEffect: '0%', maxEffect: '+30%' },
    { icon: '📊', name: 'Demand & Supply', description: 'Real-time occupancy drives pricing — low demand = discount', minEffect: '-15%', maxEffect: '+75%' },
    { icon: '🎄', name: 'Seasonal', description: 'Holiday and event-season premiums for high-traffic periods', minEffect: '0%', maxEffect: '+40%' },
    { icon: '🚗', name: 'Vehicle Type', description: 'Luxury/oversized vehicles take more space; EVs get environmental discount', minEffect: '-5%', maxEffect: '+30%' },
    { icon: '📋', name: 'Advance Booking', description: 'Book ahead and save — incentivizes planning, reduces walk-in chaos', minEffect: '-20%', maxEffect: '0%' },
    { icon: '⭐', name: 'Loyalty Program', description: 'Repeat customers earn tier-based discounts up to Platinum (20% off)', minEffect: '-20%', maxEffect: '0%' },
    { icon: '⏱️', name: 'Duration Degression', description: 'Longer stays get better per-hour rates — rewards customer commitment', minEffect: '-60%', maxEffect: '0%' },
    { icon: '🛡️', name: 'Fairness Cap', description: 'Hard ceiling on total multiplier prevents exploitative pricing', minEffect: 'Cap at 0.5x', maxEffect: 'Cap at 2.5x' },
    { icon: '📈', name: 'Price Smoothing', description: 'Exponential moving average prevents jarring price swings between quotes', minEffect: 'Gradual', maxEffect: 'Smooth' },
  ];

  async ngOnInit(): Promise<void> {
    const companyId = this.auth.companyId();
    if (!companyId) return;

    try {
      const doc = await this.db.getDocument<Record<string, any>>(
        `companies/${companyId}/settings/pricing`
      );
      if (doc) {
        this.config.set({ ...this.config(), ...doc });
      }
    } catch {
      // Use defaults
    }
  }

  updateConfig(key: string, value: any): void {
    this.config.set({ ...this.config(), [key]: value });
  }

  async saveConfig(): Promise<void> {
    this.saving.set(true);
    try {
      await this.api.call('updatePricingConfig', {
        baseHourlyRate: Number(this.config()['baseHourlyRate']),
        baseDailyRate: Number(this.config()['baseDailyRate']),
        currency: this.config()['currency'],
        taxRate: Number(this.config()['taxRate']),
        maxTotalMultiplier: Number(this.config()['maxTotalMultiplier']),
        minTotalMultiplier: Number(this.config()['minTotalMultiplier']),
        smoothingFactor: Number(this.config()['smoothingFactor']),
        hourlyMultipliers: this.config()['hourlyMultipliers'],
        dayOfWeekMultipliers: this.config()['dayOfWeekMultipliers'],
        vehicleSurcharges: this.config()['vehicleSurcharges'],
      });
      this.ui.toast('Pricing configuration saved!');
    } catch {
      this.ui.toast('Failed to save pricing config', 'danger');
    } finally {
      this.saving.set(false);
    }
  }

  async runSimulation(): Promise<void> {
    this.simulating.set(true);
    try {
      const quote = await this.api.call<PriceQuote>('getPriceQuote', {
        estimatedHours: this.simHours(),
        vehicleType: this.simVehicle(),
        daysInAdvance: this.simAdvanceDays(),
      });
      this.lastQuote.set(quote);
    } catch {
      this.ui.toast('Failed to get price quote', 'danger');
    } finally {
      this.simulating.set(false);
    }
  }
}
