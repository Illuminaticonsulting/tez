import { Component, inject, computed } from '@angular/core';
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
import { BookingService, ParkingService, UiService } from '../../../core/services';
import { BookingCardComponent } from '../booking-card/booking-card.component';
import { Booking } from '../../../core/models';
import { FormsModule } from '@angular/forms';
import { signal } from '@angular/core';

@Component({
  selector: 'app-issued',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
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
          Issued
          <span class="count-badge">{{ filtered().length }}</span>
        </ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          placeholder="Search by ticket, plate, name..."
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
        @if (filtered().length === 0) {
          <div class="empty-state">
            <span class="empty-icon">🎫</span>
            <h3>No Issued Tickets</h3>
            <p>Tickets that are checked-in or parked will appear here</p>
          </div>
        }

        @for (booking of filtered(); track booking.id) {
          <app-booking-card
            [booking]="booking"
            (actionClick)="onAction($event)"
            (cardClick)="onCardClick($event)"
          ></app-booking-card>
        }
      </div>
    </ion-content>
  `,
  styles: [`
    ion-toolbar {
      --background: #fafafa;
    }
    ion-title {
      font-weight: 700;
      font-size: 20px;
    }
    .count-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #1a1a2e;
      color: white;
      font-size: 12px;
      min-width: 24px;
      height: 24px;
      border-radius: 12px;
      padding: 0 8px;
      margin-left: 8px;
      vertical-align: middle;
    }
    .list-container {
      padding: 16px;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #999;
    }
    .empty-icon { font-size: 48px; }
    .empty-state h3 { margin: 16px 0 8px; color: #555; }
    .empty-state p { font-size: 14px; }
  `],
})
export class IssuedComponent {
  private bookingSvc = inject(BookingService);
  private parkingSvc = inject(ParkingService);
  private ui = inject(UiService);

  private searchTerm = signal('');

  readonly filtered = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const items = this.bookingSvc.groups().issued;
    if (!term) return items;
    return items.filter(
      (b) =>
        b.ticketNo.toString().includes(term) ||
        b.vehicleTag.toLowerCase().includes(term) ||
        b.customerName.toLowerCase().includes(term) ||
        (b.parkingSpotName ?? '').toLowerCase().includes(term)
    );
  });

  onSearch(event: any): void {
    this.searchTerm.set(event.detail.value ?? '');
  }

  async onAction(event: { booking: Booking; action: string }): Promise<void> {
    const { booking, action } = event;

    switch (action) {
      case 'release': {
        const confirm = await this.ui.confirm(
          'Release Vehicle',
          `Release ticket #${booking.ticketNo} to Active?`
        );
        if (!confirm) return;

        const waitStr = await this.ui.prompt(
          'Waiting Time',
          'How many minutes until customer arrives?',
          'waitTime',
          '0'
        );
        const wait = parseInt(waitStr ?? '0', 10) || 0;

        try {
          await this.ui.showLoading('Releasing vehicle...');
          await this.bookingSvc.checkoutVehicle(booking.id, wait);
          this.ui.toast('Vehicle released to Active');
        } catch {
          this.ui.toast('Failed to release vehicle', 'danger');
        } finally {
          await this.ui.hideLoading();
        }
        break;
      }

      case 'park': {
        // Opens the parking spot selector modal
        // In real implementation, this would open a modal with ParkingGridComponent
        this.ui.toast('Open parking spot selector', 'primary');
        break;
      }

      case 'move': {
        this.ui.toast('Open spot re-assignment', 'primary');
        break;
      }
    }
  }

  onCardClick(booking: Booking): void {
    // Navigate to booking detail
    console.log('Open detail for', booking.id);
  }

  onRefresh(event: any): void {
    // Real-time listener handles refresh; just complete the refresher
    setTimeout(() => event.target.complete(), 500);
  }
}
