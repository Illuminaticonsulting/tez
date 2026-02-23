import { Component, inject, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonToolbar, IonTitle,
  IonSearchbar, IonRefresher, IonRefresherContent,
  IonSkeletonText,
} from '@ionic/angular/standalone';
import { BookingService, ParkingService, UiService } from '../../../core/services';
import { BookingCardComponent } from '../booking-card/booking-card.component';
import { Booking } from '../../../core/models';
import { SearchbarCustomEvent } from '@ionic/angular';

@Component({
  selector: 'app-issued',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, IonContent, IonHeader, IonToolbar, IonTitle,
    IonSearchbar, IonRefresher, IonRefresherContent, IonSkeletonText,
    BookingCardComponent,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>Issued <span class="count-badge">{{ filtered().length }}</span></ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          placeholder="Search by ticket, plate, name..."
          [debounce]="300"
          (ionInput)="onSearch($event)"
          animated
          aria-label="Search issued tickets"
        ></ion-searchbar>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="list-container">
        @if (bookingSvc.loading()) {
          @for (i of [1,2,3]; track i) {
            <div class="skeleton-card">
              <ion-skeleton-text [animated]="true" style="width: 40%; height: 20px"></ion-skeleton-text>
              <ion-skeleton-text [animated]="true" style="width: 80%; height: 16px; margin-top: 8px"></ion-skeleton-text>
              <ion-skeleton-text [animated]="true" style="width: 60%; height: 14px; margin-top: 8px"></ion-skeleton-text>
            </div>
          }
        } @else if (filtered().length === 0) {
          <div class="empty-state" role="status">
            <span class="empty-icon">🎫</span>
            <h3>No Issued Tickets</h3>
            <p>Tickets that are checked-in or parked will appear here</p>
          </div>
        } @else {
          @for (booking of filtered(); track booking.id) {
            <app-booking-card
              [booking]="booking"
              (actionClick)="onAction($event)"
              (cardClick)="onCardClick($event)"
            ></app-booking-card>
          }
        }
      </div>
    </ion-content>
  `,
  styles: [`
    ion-toolbar { --background: #fafafa; }
    ion-title { font-weight: 700; font-size: 20px; }
    .count-badge {
      display: inline-flex; align-items: center; justify-content: center;
      background: #1a1a2e; color: white; font-size: 12px; min-width: 24px;
      height: 24px; border-radius: 12px; padding: 0 8px; margin-left: 8px; vertical-align: middle;
    }
    .list-container { padding: 16px; }
    .skeleton-card {
      background: white; border-radius: 16px; padding: 20px; margin-bottom: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,.06);
    }
    .empty-state { text-align: center; padding: 60px 20px; color: #999; }
    .empty-icon { font-size: 48px; }
    .empty-state h3 { margin: 16px 0 8px; color: #555; }
    .empty-state p { font-size: 14px; }
  `],
})
export class IssuedComponent {
  readonly bookingSvc = inject(BookingService);
  private parkingSvc = inject(ParkingService);
  private ui = inject(UiService);
  private router = inject(Router);

  private searchTerm = signal('');

  readonly filtered = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const items = this.bookingSvc.groups().issued;
    if (!term) return items;
    return items.filter(
      (b) =>
        b.ticketNumber.toString().includes(term) ||
        b.vehicle.plate.toLowerCase().includes(term) ||
        b.customerName.toLowerCase().includes(term) ||
        (b.spotName ?? '').toLowerCase().includes(term)
    );
  });

  onSearch(event: SearchbarCustomEvent): void {
    this.searchTerm.set(event.detail.value ?? '');
  }

  async onAction(event: { booking: Booking; action: string }): Promise<void> {
    const { booking, action } = event;

    switch (action) {
      case 'release': {
        const confirm = await this.ui.confirm(
          'Release Vehicle',
          `Release ticket #${booking.ticketNumber} to Active?`
        );
        if (!confirm) return;
        try {
          await this.ui.showLoading('Releasing vehicle...');
          await this.bookingSvc.checkoutVehicle(booking.id);
          this.ui.toast('Vehicle released to Active');
        } catch {
          this.ui.toast('Failed to release vehicle', 'danger');
        } finally {
          await this.ui.hideLoading();
        }
        break;
      }
      case 'park':
        this.ui.toast('Open parking spot selector', 'primary');
        break;
      case 'move':
        this.ui.toast('Open spot re-assignment', 'primary');
        break;
    }
  }

  onCardClick(booking: Booking): void {
    this.router.navigate(['/booking', booking.id]);
  }

  onRefresh(event: CustomEvent): void {
    setTimeout(() => (event.target as HTMLIonRefresherElement).complete(), 500);
  }
}
