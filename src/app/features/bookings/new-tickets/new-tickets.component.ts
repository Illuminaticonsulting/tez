import { Component, inject, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonToolbar, IonTitle,
  IonSearchbar, IonRefresher, IonRefresherContent, IonSkeletonText,
  IonFab, IonFabButton, IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline } from 'ionicons/icons';
import { BookingService, UiService } from '../../../core/services';
import { BookingCardComponent } from '../booking-card/booking-card.component';
import { CreateBookingComponent } from '../create-booking/create-booking.component';
import { Booking } from '../../../core/models';
import { SearchbarCustomEvent, ModalController } from '@ionic/angular';

@Component({
  selector: 'app-new-tickets',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, IonContent, IonHeader, IonToolbar, IonTitle,
    IonSearchbar, IonRefresher, IonRefresherContent, IonSkeletonText,
    IonFab, IonFabButton, IonIcon,
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
        <ion-searchbar placeholder="Search new tickets..." [debounce]="300" (ionInput)="onSearch($event)" animated aria-label="Search new tickets"></ion-searchbar>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="list-container">
        @if (filtered().length > 0) {
          <div class="alert-banner" role="alert">
            🔔 {{ count() }} new ticket{{ count() > 1 ? 's' : '' }} need{{ count() === 1 ? 's' : '' }} attention!
          </div>
        }

        @if (bookingSvc.loading()) {
          @for (i of [1,2,3]; track i) {
            <div class="skeleton-card">
              <ion-skeleton-text [animated]="true" style="width: 45%; height: 20px"></ion-skeleton-text>
              <ion-skeleton-text [animated]="true" style="width: 75%; height: 14px; margin-top: 8px"></ion-skeleton-text>
            </div>
          }
        } @else if (filtered().length === 0) {
          <div class="empty-state" role="status">
            <span class="empty-icon">✨</span>
            <h3>All Clear!</h3>
            <p>No new tickets at the moment</p>
          </div>
        } @else {
          @for (booking of filtered(); track booking.id) {
            <app-booking-card [booking]="booking" (actionClick)="onAction($event)" (cardClick)="onCardClick($event)"></app-booking-card>
          }
        }
      </div>

      <!-- Create Booking FAB -->
      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button (click)="openCreateBooking()" aria-label="Create new ticket" color="warning">
          <ion-icon name="add-outline"></ion-icon>
        </ion-fab-button>
      </ion-fab>
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
    @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
    .list-container { padding: 16px; }
    .alert-banner {
      background: linear-gradient(135deg, #fff3e0, #ffe0b2); color: #e65100;
      padding: 14px 16px; border-radius: 12px; font-weight: 600; font-size: 14px;
      margin-bottom: 16px; text-align: center; animation: slideIn .3s ease-out;
    }
    .skeleton-card { background: white; border-radius: 16px; padding: 20px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
    .empty-state { text-align: center; padding: 60px 20px; color: #999; }
    .empty-icon { font-size: 48px; }
    .empty-state h3 { margin: 16px 0 8px; color: #555; }
    @keyframes slideIn { from { transform: translateY(-10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  `],
})
export class NewTicketsComponent {
  readonly bookingSvc = inject(BookingService);
  private ui = inject(UiService);
  private router = inject(Router);
  private modalCtrl = inject(ModalController);
  private searchTerm = signal('');

  constructor() {
    addIcons({ addOutline });
  }

  readonly count = computed(() => this.bookingSvc.groups().new.length);

  readonly filtered = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const items = this.bookingSvc.groups().new;
    if (!term) return items;
    return items.filter(b =>
      b.ticketNumber.toString().includes(term) ||
      b.vehicle.plate.toLowerCase().includes(term) ||
      b.customerName.toLowerCase().includes(term)
    );
  });

  onSearch(e: SearchbarCustomEvent): void { this.searchTerm.set(e.detail.value ?? ''); }

  async onAction(event: { booking: Booking; action: string }): Promise<void> {
    const { booking, action } = event;
    if (action === 'check-in') {
      const ok = await this.ui.confirm('Check In', `Check in ticket #${booking.ticketNumber}?`);
      if (!ok) return;
      try {
        await this.ui.showLoading('Checking in...');
        await this.bookingSvc.transitionStatus(booking.id, 'Check-In');
        this.ui.toast('Ticket checked in!');
      } catch { this.ui.toast('Failed to check in', 'danger'); }
      finally { await this.ui.hideLoading(); }
    } else if (action === 'cancel') {
      const ok = await this.ui.confirm('Cancel Ticket', `Cancel ticket #${booking.ticketNumber}?`);
      if (!ok) return;
      try {
        await this.bookingSvc.cancelBooking(booking.id, 'Cancelled by operator');
        this.ui.toast('Ticket cancelled');
      } catch { this.ui.toast('Failed to cancel', 'danger'); }
    }
  }

  onCardClick(booking: Booking): void { this.router.navigate(['/booking', booking.id]); }
  onRefresh(e: CustomEvent): void { setTimeout(() => (e.target as HTMLIonRefresherElement).complete(), 500); }

  async openCreateBooking(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: CreateBookingComponent,
      presentingElement: document.querySelector('ion-tabs') as HTMLElement ?? undefined,
      canDismiss: true,
    });
    await modal.present();
  }
}
