import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonSearchbar,
  IonRefresher,
  IonRefresherContent,
} from '@ionic/angular/standalone';
import { BookingService, UiService } from '../../../core/services';
import { BookingCardComponent } from '../booking-card/booking-card.component';
import { Booking } from '../../../core/models';

@Component({
  selector: 'app-new-tickets',
  standalone: true,
  imports: [
    CommonModule,
    IonContent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonSearchbar,
    IonRefresher,
    IonRefresherContent,
    BookingCardComponent,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>
          New Tickets
          @if (count() > 0) {
            <span class="count-badge count-badge--urgent">{{ count() }}</span>
          }
        </ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          placeholder="Search new tickets..."
          [debounce]="300"
          (ionInput)="onSearch($event)"
          animated
        ></ion-searchbar>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="list-container">
        @if (filtered().length > 0) {
          <div class="alert-banner">
            🔔 {{ count() }} new ticket{{ count() > 1 ? 's' : '' }} need{{ count() === 1 ? 's' : '' }} attention!
          </div>
        }

        @if (filtered().length === 0) {
          <div class="empty-state">
            <span class="empty-icon">✨</span>
            <h3>All Clear!</h3>
            <p>No new tickets at the moment</p>
          </div>
        }

        @for (booking of filtered(); track booking.id) {
          <app-booking-card
            [booking]="booking"
            (actionClick)="onAction($event)"
          ></app-booking-card>
        }
      </div>
    </ion-content>
  `,
  styles: [`
    ion-toolbar { --background: #fafafa; }
    ion-title { font-weight: 700; font-size: 20px; }
    .count-badge {
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px; min-width: 24px; height: 24px; border-radius: 12px;
      padding: 0 8px; margin-left: 8px; vertical-align: middle;
    }
    .count-badge--urgent { background: #f44336; color: white; animation: pulse 1.5s infinite; }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.15); }
    }
    .list-container { padding: 16px; }
    .alert-banner {
      background: linear-gradient(135deg, #fff3e0, #ffe0b2);
      color: #e65100;
      padding: 14px 16px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 16px;
      text-align: center;
      animation: slideIn 0.3s ease-out;
    }
    .empty-state { text-align: center; padding: 60px 20px; color: #999; }
    .empty-icon { font-size: 48px; }
    .empty-state h3 { margin: 16px 0 8px; color: #555; }
    @keyframes slideIn {
      from { transform: translateY(-10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `],
})
export class NewTicketsComponent {
  private bookingSvc = inject(BookingService);
  private ui = inject(UiService);

  private searchTerm = signal('');

  readonly count = computed(() => this.bookingSvc.groups().new.length);

  readonly filtered = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const items = this.bookingSvc.groups().new;
    if (!term) return items;
    return items.filter(
      (b) =>
        b.ticketNo.toString().includes(term) ||
        b.vehicleTag.toLowerCase().includes(term) ||
        b.customerName.toLowerCase().includes(term)
    );
  });

  onSearch(e: any) { this.searchTerm.set(e.detail.value ?? ''); }

  async onAction(event: { booking: Booking; action: string }) {
    const { booking, action } = event;
    if (action === 'check-in') {
      const ok = await this.ui.confirm('Check In', `Check in ticket #${booking.ticketNo}?`);
      if (!ok) return;
      try {
        await this.ui.showLoading('Checking in...');
        await this.bookingSvc.transitionStatus(booking.id, 'Check-In');
        this.ui.toast('Ticket checked in!');
      } catch { this.ui.toast('Failed to check in', 'danger'); }
      finally { await this.ui.hideLoading(); }
    } else if (action === 'cancel') {
      const ok = await this.ui.confirm('Cancel Ticket', `Cancel ticket #${booking.ticketNo}?`);
      if (!ok) return;
      try {
        await this.bookingSvc.transitionStatus(booking.id, 'Cancelled');
        this.ui.toast('Ticket cancelled');
      } catch { this.ui.toast('Failed to cancel', 'danger'); }
    }
  }

  onRefresh(e: any) { setTimeout(() => e.target.complete(), 500); }
}
