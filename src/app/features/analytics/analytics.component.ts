import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
  IonBackButton, IonCard, IonCardHeader, IonCardTitle,
  IonCardContent, IonSegment, IonSegmentButton,
  IonLabel, IonIcon, IonRefresher, IonRefresherContent,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  carOutline, cashOutline, trendingUpOutline, peopleOutline,
  calendarOutline, timeOutline,
} from 'ionicons/icons';
import { BookingService } from '../../core/services';
import { Booking } from '../../core/models';

type Period = 'today' | 'week' | 'month';

@Component({
  selector: 'app-analytics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonBackButton, IonCard, IonCardHeader, IonCardTitle,
    IonCardContent, IonSegment, IonSegmentButton,
    IonLabel, IonIcon, IonRefresher, IonRefresherContent,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/issued"></ion-back-button>
        </ion-buttons>
        <ion-title>Analytics</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-refresher slot="fixed" (ionRefresh)="doRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <ion-segment [value]="period()" (ionChange)="onPeriodChange($event)">
        <ion-segment-button value="today"><ion-label>Today</ion-label></ion-segment-button>
        <ion-segment-button value="week"><ion-label>7 Days</ion-label></ion-segment-button>
        <ion-segment-button value="month"><ion-label>30 Days</ion-label></ion-segment-button>
      </ion-segment>

      <!-- KPI Cards -->
      <div class="kpi-grid" role="list" aria-label="Key performance metrics">
        <div class="kpi-card" role="listitem">
          <ion-icon name="car-outline" color="primary" aria-hidden="true"></ion-icon>
          <span class="kpi-value">{{ stats().totalBookings }}</span>
          <span class="kpi-label">Total Tickets</span>
        </div>
        <div class="kpi-card" role="listitem">
          <ion-icon name="trending-up-outline" color="success" aria-hidden="true"></ion-icon>
          <span class="kpi-value">{{ stats().completed }}</span>
          <span class="kpi-label">Completed</span>
        </div>
        <div class="kpi-card" role="listitem">
          <ion-icon name="cash-outline" color="warning" aria-hidden="true"></ion-icon>
          <span class="kpi-value">\${{ stats().totalRevenue }}</span>
          <span class="kpi-label">Revenue</span>
        </div>
        <div class="kpi-card" role="listitem">
          <ion-icon name="time-outline" color="tertiary" aria-hidden="true"></ion-icon>
          <span class="kpi-value">{{ stats().avgDuration }} min</span>
          <span class="kpi-label">Avg Duration</span>
        </div>
      </div>

      <!-- Status Breakdown -->
      <ion-card>
        <ion-card-header><ion-card-title>Status Breakdown</ion-card-title></ion-card-header>
        <ion-card-content>
          @for (s of statusBreakdown(); track s.status) {
            <div class="bar-row">
              <span class="bar-label">{{ s.status }}</span>
              <div class="bar-track">
                <div class="bar-fill" [style.width.%]="s.pct" [style.backgroundColor]="s.color"></div>
              </div>
              <span class="bar-count">{{ s.count }}</span>
            </div>
          }
        </ion-card-content>
      </ion-card>

      <!-- Revenue by Day -->
      <ion-card>
        <ion-card-header><ion-card-title>Daily Revenue</ion-card-title></ion-card-header>
        <ion-card-content>
          @for (d of dailyRevenue(); track d.date) {
            <div class="bar-row">
              <span class="bar-label">{{ d.date }}</span>
              <div class="bar-track">
                <div class="bar-fill bar-revenue" [style.width.%]="d.pct"></div>
              </div>
              <span class="bar-count">\${{ d.amount }}</span>
            </div>
          }
          @if (dailyRevenue().length === 0) {
            <p class="empty-text">No revenue data available</p>
          }
        </ion-card-content>
      </ion-card>

      <!-- Top Customers -->
      <ion-card>
        <ion-card-header><ion-card-title>Top Customers</ion-card-title></ion-card-header>
        <ion-card-content>
          @for (c of topCustomers(); track c.name; let i = $index) {
            <div class="customer-row">
              <span class="customer-rank">#{{ i + 1 }}</span>
              <span class="customer-name">{{ c.name }}</span>
              <span class="customer-count">{{ c.count }} visits</span>
            </div>
          }
          @if (topCustomers().length === 0) {
            <p class="empty-text">No customer data</p>
          }
        </ion-card-content>
      </ion-card>
    </ion-content>
  `,
  styles: [`
    ion-segment { margin-bottom: 20px; }
    .kpi-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;
    }
    .kpi-card {
      background: #fff; border-radius: 16px; padding: 20px 16px; text-align: center;
      box-shadow: 0 1px 4px rgba(0,0,0,.06);
      display: flex; flex-direction: column; align-items: center; gap: 4px;
    }
    .kpi-card ion-icon { font-size: 28px; }
    .kpi-value { font-size: 28px; font-weight: 800; color: #1a1a2e; }
    .kpi-label { font-size: 12px; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: .5px; }
    .bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .bar-label { width: 80px; font-size: 12px; font-weight: 600; color: #666; text-align: right; }
    .bar-track { flex: 1; height: 14px; background: #f0f0f0; border-radius: 7px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 7px; transition: width .4s ease; }
    .bar-revenue { background: linear-gradient(135deg, #00c853, #00e676); }
    .bar-count { width: 50px; font-size: 13px; font-weight: 700; color: #1a1a2e; text-align: right; }
    .customer-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
    .customer-rank { font-size: 14px; font-weight: 800; color: #bbb; width: 30px; }
    .customer-name { flex: 1; font-size: 14px; font-weight: 600; color: #333; }
    .customer-count { font-size: 12px; color: #999; }
    .empty-text { text-align: center; color: #ccc; font-size: 13px; margin: 16px 0; }
  `],
})
export class AnalyticsComponent {
  private bookingSvc = inject(BookingService);

  readonly period = signal<Period>('today');
  readonly analyticsBookings = signal<Booking[]>([]);

  private toDate(val: unknown): Date {
    if (val instanceof Date) return val;
    if (val && typeof val === 'object' && 'toDate' in val) return (val as { toDate(): Date }).toDate();
    return new Date();
  }

  constructor() {
    addIcons({ carOutline, cashOutline, trendingUpOutline, peopleOutline, calendarOutline, timeOutline });
    this.loadAnalytics();
  }

  private async loadAnalytics(): Promise<void> {
    const all = await this.bookingSvc.getAllBookingsForAnalytics(30);
    this.analyticsBookings.set(all);
  }

  private readonly filtered = computed<Booking[]>(() => {
    const bookings = this.analyticsBookings();
    const now = new Date();
    const p = this.period();
    const cutoff = new Date();
    if (p === 'today') cutoff.setHours(0, 0, 0, 0);
    else if (p === 'week') cutoff.setDate(now.getDate() - 7);
    else cutoff.setDate(now.getDate() - 30);
    return bookings.filter((b: Booking) => this.toDate(b.createdAt) >= cutoff);
  });

  readonly stats = computed(() => {
    const list = this.filtered();
    const completed = list.filter((b: Booking) => b.status === 'Completed').length;
    const totalRevenue = list.reduce((sum: number, b: Booking) => sum + (b.payment?.amount ?? 0), 0);
    const durations = list
      .filter((b: Booking) => b.completedAt && b.createdAt)
      .map((b: Booking) => {
        const start = this.toDate(b.createdAt);
        const end = this.toDate(b.completedAt);
        return (end.getTime() - start.getTime()) / 60000;
      })
      .filter((d: number) => d > 0);
    const avgDuration = durations.length ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0;
    return { totalBookings: list.length, completed, totalRevenue: Math.round(totalRevenue), avgDuration };
  });

  readonly statusBreakdown = computed(() => {
    const list = this.filtered();
    const total = list.length || 1;
    const colors: Record<string, string> = {
      New: '#2196f3', Booked: '#9c27b0', 'Check-In': '#ff9800', Parked: '#4caf50',
      Active: '#00bcd4', Completed: '#8bc34a', Cancelled: '#f44336',
    };
    const counts: Record<string, number> = {};
    list.forEach((b: Booking) => { counts[b.status] = (counts[b.status] || 0) + 1; });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count, pct: (count / total) * 100, color: colors[status] || '#ccc' }));
  });

  readonly dailyRevenue = computed(() => {
    const list = this.filtered().filter((b: Booking) => b.payment?.amount);
    const byDay: Record<string, number> = {};
    list.forEach((b: Booking) => {
      const d = this.toDate(b.createdAt);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      byDay[key] = (byDay[key] || 0) + (b.payment?.amount ?? 0);
    });
    const entries = Object.entries(byDay).slice(-7);
    const max = Math.max(...entries.map(e => e[1]), 1);
    return entries.map(([date, amount]) => ({ date, amount: Math.round(amount), pct: (amount / max) * 100 }));
  });

  readonly topCustomers = computed(() => {
    const list = this.filtered();
    const counts: Record<string, number> = {};
    list.forEach((b: Booking) => {
      if (b.customerName) counts[b.customerName] = (counts[b.customerName] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  });

  onPeriodChange(event: CustomEvent): void {
    this.period.set(event.detail.value as Period);
  }

  doRefresh(event: CustomEvent): void {
    this.loadAnalytics().then(() => {
      (event.target as HTMLIonRefresherElement).complete();
    });
  }
}
