import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent, IonHeader, IonToolbar, IonTitle,
  IonSearchbar, IonRefresher, IonRefresherContent,
} from '@ionic/angular/standalone';
import { BookingService, UiService } from '../../../core/services';
import { BookingCardComponent } from '../booking-card/booking-card.component';
import { Booking } from '../../../core/models';

@Component({
  selector: 'app-reservations',
  standalone: true,
  imports: [
    CommonModule, IonContent, IonHeader, IonToolbar, IonTitle,
    IonSearchbar, IonRefresher, IonRefresherContent, BookingCardComponent,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>
          Reservations
          <span class="count-badge">{{ filtered().length }}</span>
        </ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar placeholder="Search reservations..." [debounce]="300" (ionInput)="onSearch($event)" animated></ion-searchbar>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="list-container">
        @if (filtered().length === 0) {
          <div class="empty-state">
            <span class="empty-icon">📅</span>
            <h3>No Reservations</h3>
            <p>Upcoming bookings will appear here</p>
          </div>
        }
        @for (booking of filtered(); track booking.id) {
          <app-booking-card [booking]="booking" (actionClick)="onAction($event)"></app-booking-card>
        }
      </div>
    </ion-content>
  `,
  styles: [`
    ion-toolbar { --background: #fafafa; }
    ion-title { font-weight: 700; font-size: 20px; }
    .count-badge {
      display: inline-flex; align-items: center; justify-content: center;
      background: #2196f3; color: white; font-size: 12px; min-width: 24px;
      height: 24px; border-radius: 12px; padding: 0 8px; margin-left: 8px; vertical-align: middle;
    }
    .list-container { padding: 16px; }
    .empty-state { text-align: center; padding: 60px 20px; color: #999; }
    .empty-icon { font-size: 48px; }
    .empty-state h3 { margin: 16px 0 8px; color: #555; }
  `],
})
export class ReservationsComponent {
  private bookingSvc = inject(BookingService);
  private ui = inject(UiService);
  private searchTerm = signal('');

  readonly filtered = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const items = this.bookingSvc.groups().booked;
    if (!term) return items;
    return items.filter(b =>
      b.ticketNo.toString().includes(term) ||
      b.vehicleTag.toLowerCase().includes(term) ||
      b.customerName.toLowerCase().includes(term)
    );
  });

  onSearch(e: any) { this.searchTerm.set(e.detail.value ?? ''); }

  async onAction(event: { booking: Booking; action: string }) {
    if (event.action === 'check-in') {
      const ok = await this.ui.confirm('Check In', `Check in reservation #${event.booking.ticketNo}?`);
      if (!ok) return;
      try {
        await this.ui.showLoading('Checking in...');
        await this.bookingSvc.transitionStatus(event.booking.id, 'Check-In');
        this.ui.toast('Reservation checked in!');
      } catch { this.ui.toast('Failed to check in', 'danger'); }
      finally { await this.ui.hideLoading(); }
    } else if (event.action === 'cancel') {
      const ok = await this.ui.confirm('Cancel', `Cancel reservation #${event.booking.ticketNo}?`);
      if (!ok) return;
      await this.bookingSvc.transitionStatus(event.booking.id, 'Cancelled');
    }
  }

  onRefresh(e: any) { setTimeout(() => e.target.complete(), 500); }
}
