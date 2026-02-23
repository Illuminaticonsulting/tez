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
import { SpotAssignmentComponent } from '../../parking/spot-assignment/spot-assignment.component';
import { Booking } from '../../../core/models';
import { SearchbarCustomEvent, ModalController } from '@ionic/angular';

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
        <ion-title>
          <span class="page-title">Issued</span>
          <span class="count-badge" [attr.aria-label]="filtered().length + ' tickets'">{{ filtered().length }}</span>
        </ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          placeholder="Search ticket, plate, or name..."
          [debounce]="300"
          (ionInput)="onSearch($event)"
          animated
          aria-label="Search issued tickets"
          inputmode="search"
        ></ion-searchbar>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content pullingText="Pull to refresh" refreshingText="Updating..."></ion-refresher-content>
      </ion-refresher>

      <div class="list-container">
        @if (bookingSvc.loading()) {
          @for (i of [1,2,3,4]; track i) {
            <div class="skeleton-card" [style.animation-delay]="i * 100 + 'ms'">
              <ion-skeleton-text [animated]="true" style="width: 35%; height: 22px"></ion-skeleton-text>
              <ion-skeleton-text [animated]="true" style="width: 75%; height: 16px; margin-top: 10px"></ion-skeleton-text>
              <ion-skeleton-text [animated]="true" style="width: 55%; height: 14px; margin-top: 8px"></ion-skeleton-text>
              <div style="display: flex; gap: 8px; margin-top: 14px;">
                <ion-skeleton-text [animated]="true" style="width: 50%; height: 42px; border-radius: 12px"></ion-skeleton-text>
                <ion-skeleton-text [animated]="true" style="width: 50%; height: 42px; border-radius: 12px"></ion-skeleton-text>
              </div>
            </div>
          }
        } @else if (filtered().length === 0) {
          <div class="empty-state" role="status" aria-live="polite">
            <div class="empty-illustration">🎫</div>
            <h3 class="empty-title">No Issued Tickets</h3>
            <p class="empty-desc">
              @if (searchTerm()) {
                No tickets match "{{ searchTerm() }}". Try a different search.
              } @else {
                When vehicles are checked-in or parked, they'll show up here.
              }
            </p>
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
    ion-toolbar { --background: #f5f6fa; }
    .page-title { font-weight: 800; font-size: 22px; letter-spacing: -0.3px; }
    .count-badge {
      display: inline-flex; align-items: center; justify-content: center;
      background: #1a1a2e; color: white; font-size: 12px; font-weight: 700;
      min-width: 26px; height: 26px; border-radius: 13px; padding: 0 9px;
      margin-left: 10px; vertical-align: middle;
    }
    .list-container { padding: 12px 16px 100px; }
    .skeleton-card {
      background: white; border-radius: 20px; padding: 20px; margin-bottom: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,.04);
      animation: fadeInUp .4s ease both;
    }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .empty-state {
      text-align: center; padding: 80px 32px;
      animation: fadeInUp .5s ease;
    }
    .empty-illustration {
      font-size: 64px; margin-bottom: 16px;
      filter: grayscale(0.2);
    }
    .empty-title {
      font-size: 20px; font-weight: 800; color: #333; margin: 0 0 8px;
    }
    .empty-desc {
      font-size: 15px; color: #999; margin: 0; max-width: 280px;
      margin: 0 auto; line-height: 1.5;
    }
  `],
})
export class IssuedComponent {
  readonly bookingSvc = inject(BookingService);
  private parkingSvc = inject(ParkingService);
  private ui = inject(UiService);
  private router = inject(Router);
  private modalCtrl = inject(ModalController);

  readonly searchTerm = signal('');

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
      case 'move':
        await this.openSpotAssignment(booking);
        break;
    }
  }

  onCardClick(booking: Booking): void {
    this.router.navigate(['/booking', booking.id]);
  }

  onRefresh(event: CustomEvent): void {
    setTimeout(() => (event.target as HTMLIonRefresherElement).complete(), 500);
  }

  private async openSpotAssignment(booking: Booking): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: SpotAssignmentComponent,
      componentProps: {
        bookingId: booking.id,
        ticketNumber: booking.ticketNumber,
      },
      presentingElement: document.querySelector('ion-tabs') as HTMLElement ?? undefined,
      canDismiss: true,
    });
    await modal.present();
  }
}
