import { Component, inject, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonToolbar, IonTitle,
  IonSearchbar, IonRefresher, IonRefresherContent, IonSkeletonText,
} from '@ionic/angular/standalone';
import { BookingService, UiService } from '../../../core/services';
import { BookingCardComponent } from '../booking-card/booking-card.component';
import { Booking } from '../../../core/models';
import { SearchbarCustomEvent } from '@ionic/angular';

@Component({
  selector: 'app-active',
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
        <ion-title>Active <span class="count-badge">{{ filtered().length }}</span></ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar placeholder="Search active tickets..." [debounce]="300" (ionInput)="onSearch($event)" animated aria-label="Search active tickets"></ion-searchbar>
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
            </div>
          }
        } @else if (filtered().length === 0) {
          <div class="empty-state" role="status">
            <span class="empty-icon">🚗</span>
            <h3>No Active Tickets</h3>
            <p>Vehicles awaiting pickup will appear here</p>
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
      background: #ff9800; color: white; font-size: 12px; min-width: 24px;
      height: 24px; border-radius: 12px; padding: 0 8px; margin-left: 8px; vertical-align: middle;
    }
    .list-container { padding: 16px; }
    .skeleton-card { background: white; border-radius: 16px; padding: 20px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
    .empty-state { text-align: center; padding: 60px 20px; color: #999; }
    .empty-icon { font-size: 48px; }
    .empty-state h3 { margin: 16px 0 8px; color: #555; }
  `],
})
export class ActiveComponent {
  readonly bookingSvc = inject(BookingService);
  private ui = inject(UiService);
  private router = inject(Router);
  private searchTerm = signal('');

  readonly filtered = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const items = this.bookingSvc.groups().active;
    if (!term) return items;
    return items.filter(b =>
      b.ticketNumber.toString().includes(term) ||
      b.vehicle.plate.toLowerCase().includes(term) ||
      b.customerName.toLowerCase().includes(term)
    );
  });

  onSearch(e: SearchbarCustomEvent): void { this.searchTerm.set(e.detail.value ?? ''); }

  async onAction(event: { booking: Booking; action: string }): Promise<void> {
    if (event.action === 'complete') {
      try {
        // Calculate dynamic price
        await this.ui.showLoading('Calculating price...');
        let price: any;
        try {
          price = await this.bookingSvc.calculateCompletionPrice(event.booking.id);
        } catch {
          price = null;
        }
        await this.ui.hideLoading();

        const priceDisplay = price?.totalPrice
          ? `\n\nDynamic Price: $${price.totalPrice.toFixed(2)} (${price.estimatedHours?.toFixed(1)}h × $${price.effectiveHourlyRate?.toFixed(2)}/hr)`
          : '';

        const ok = await this.ui.confirm(
          'Complete',
          `Mark ticket #${event.booking.ticketNumber} as completed?${priceDisplay}`
        );
        if (!ok) return;

        await this.ui.showLoading('Completing...');
        await this.bookingSvc.completeBooking(
          event.booking.id,
          'cash',
          price?.totalPrice ?? 0,
        );
        this.ui.toast('Ticket completed!');
      } catch { this.ui.toast('Failed to complete', 'danger'); }
      finally { await this.ui.hideLoading(); }
    }
  }

  onCardClick(booking: Booking): void { this.router.navigate(['/booking', booking.id]); }
  onRefresh(e: CustomEvent): void { setTimeout(() => (e.target as HTMLIonRefresherElement).complete(), 500); }
}
