import { Component, inject, signal, computed, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
  IonBackButton, IonButton, IonIcon, IonList, IonItem,
  IonLabel, IonNote, IonChip, IonSkeletonText,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  callOutline, navigateOutline, keyOutline, airplaneOutline,
  carOutline, timeOutline, cashOutline, documentTextOutline,
  createOutline,
} from 'ionicons/icons';
import { Booking } from '../../../core/models';
import { BookingService, UiService } from '../../../core/services';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { RelativeTimePipe, FormatDatePipe } from '../../../shared/pipes/date.pipes';

@Component({
  selector: 'app-booking-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonBackButton, IonButton, IonIcon, IonList, IonItem,
    IonLabel, IonNote, IonChip, IonSkeletonText,
    StatusBadgeComponent, RelativeTimePipe, FormatDatePipe,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/issued"></ion-back-button>
        </ion-buttons>
        <ion-title>
          @if (booking()) { Ticket #{{ booking()!.ticketNumber }} } @else { Loading... }
        </ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (!booking()) {
        <div class="skeleton-detail">
          <ion-skeleton-text [animated]="true" style="width: 60%; height: 28px"></ion-skeleton-text>
          <ion-skeleton-text [animated]="true" style="width: 40%; height: 20px; margin-top: 12px"></ion-skeleton-text>
          <ion-skeleton-text [animated]="true" style="width: 80%; height: 16px; margin-top: 12px"></ion-skeleton-text>
        </div>
      } @else {
        <!-- Status Badge -->
        <div class="detail-status">
          <app-status-badge [status]="booking()!.status"></app-status-badge>
          <span class="detail-time">{{ booking()!.createdAt | relativeTime }}</span>
        </div>

        <!-- Vehicle Section -->
        <div class="detail-section">
          <h3 class="section-label">Vehicle</h3>
          <div class="vehicle-hero">
            @if (booking()!.vehicle.photoUrl) {
              <img [src]="booking()!.vehicle.photoUrl" alt="Vehicle" class="vehicle-photo" />
            } @else {
              <div class="vehicle-photo-placeholder">🚗</div>
            }
            <div>
              <div class="plate-badge">{{ booking()!.vehicle.plate }}</div>
              <div class="vehicle-desc">{{ booking()!.vehicle.color }} {{ booking()!.vehicle.make }} {{ booking()!.vehicle.model }}</div>
            </div>
          </div>
        </div>

        <!-- Customer Section -->
        <div class="detail-section">
          <h3 class="section-label">Customer</h3>
          <ion-list [inset]="true">
            <ion-item>
              <ion-icon name="call-outline" slot="start" aria-hidden="true"></ion-icon>
              <ion-label>{{ booking()!.customerName }}</ion-label>
              <ion-note slot="end">{{ booking()!.customerPhone || 'No phone' }}</ion-note>
            </ion-item>
            @if (booking()!.flightNumber) {
              <ion-item>
                <ion-icon name="airplane-outline" slot="start" aria-hidden="true"></ion-icon>
                <ion-label>Flight {{ booking()!.flightNumber }}</ion-label>
                <ion-note slot="end">{{ booking()!.flightStatus || 'Unknown' }}</ion-note>
              </ion-item>
            }
          </ion-list>
        </div>

        <!-- Parking Section -->
        <div class="detail-section">
          <h3 class="section-label">Parking</h3>
          <ion-list [inset]="true">
            <ion-item>
              <ion-icon name="navigate-outline" slot="start" aria-hidden="true"></ion-icon>
              <ion-label>Spot</ion-label>
              <ion-note slot="end">{{ booking()!.spotName || 'Not assigned' }}</ion-note>
            </ion-item>
            <ion-item>
              <ion-icon name="key-outline" slot="start" aria-hidden="true"></ion-icon>
              <ion-label>Keys</ion-label>
              <ion-chip [color]="booking()!.keysHandedOff ? 'success' : 'warning'" slot="end">
                {{ booking()!.keysHandedOff ? 'Received' : 'Not received' }}
              </ion-chip>
            </ion-item>
          </ion-list>
        </div>

        <!-- Payment Section -->
        <div class="detail-section">
          <h3 class="section-label">Payment</h3>
          <ion-list [inset]="true">
            <ion-item>
              <ion-icon name="cash-outline" slot="start" aria-hidden="true"></ion-icon>
              <ion-label>{{ booking()!.payment.method || 'Pending' }}</ion-label>
              <ion-note slot="end">\${{ booking()!.payment.amount }}</ion-note>
            </ion-item>
          </ion-list>
        </div>

        <!-- Notes -->
        @if (booking()!.notes) {
          <div class="detail-section">
            <h3 class="section-label">Notes</h3>
            <div class="notes-box">{{ booking()!.notes }}</div>
          </div>
        }

        <!-- Damage Report -->
        @if (booking()!.damageReport?.hasDamage) {
          <div class="detail-section">
            <h3 class="section-label">⚠️ Damage Report</h3>
            <div class="damage-box">
              <p>{{ booking()!.damageReport!.notes }}</p>
            </div>
          </div>
        }

        <!-- History Timeline -->
        <div class="detail-section">
          <h3 class="section-label">History</h3>
          <div class="timeline">
            @for (entry of booking()!.history; track entry.timestamp) {
              <div class="timeline-entry">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                  <div class="timeline-status">{{ entry.status }}</div>
                  <div class="timeline-note">{{ entry.note }}</div>
                  <div class="timeline-time">{{ entry.timestamp | formatDate:'MMM d, h:mm a' }}</div>
                </div>
              </div>
            }
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="detail-actions">
          @for (action of availableActions(); track action.action) {
            <ion-button
              [expand]="'block'"
              [color]="action.color"
              (click)="onAction(action.action)"
            >
              {{ action.label }}
            </ion-button>
          }
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .skeleton-detail { padding: 24px; }
    .detail-status {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;
    }
    .detail-time { font-size: 13px; color: #999; }
    .detail-section { margin-bottom: 24px; }
    .section-label { font-size: 13px; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: .5px; margin: 0 0 8px; }
    .vehicle-hero { display: flex; gap: 16px; align-items: center; }
    .vehicle-photo { width: 80px; height: 80px; border-radius: 16px; object-fit: cover; }
    .vehicle-photo-placeholder {
      width: 80px; height: 80px; border-radius: 16px; background: #f5f5f5;
      display: flex; align-items: center; justify-content: center; font-size: 36px;
    }
    .plate-badge {
      font-size: 20px; font-weight: 800; color: #1a1a2e; letter-spacing: 2px;
      background: #f5f5f5; display: inline-block; padding: 4px 12px; border-radius: 8px; margin-bottom: 4px;
    }
    .vehicle-desc { font-size: 14px; color: #666; }
    .notes-box { background: #f8f9fa; padding: 12px 16px; border-radius: 12px; font-size: 14px; color: #555; }
    .damage-box { background: #fff3f3; border: 1px solid #ffcdd2; padding: 12px 16px; border-radius: 12px; font-size: 14px; color: #c62828; }
    .timeline { padding-left: 20px; border-left: 2px solid #e0e0e0; }
    .timeline-entry { position: relative; padding: 0 0 24px 24px; }
    .timeline-entry:last-child { padding-bottom: 0; }
    .timeline-dot {
      position: absolute; left: -9px; top: 4px; width: 16px; height: 16px;
      border-radius: 50%; background: linear-gradient(135deg, #1a1a2e, #0f3460);
      border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,.1);
    }
    .timeline-status { font-size: 15px; font-weight: 700; color: #1a1a2e; }
    .timeline-note { font-size: 13px; color: #666; margin-top: 3px; }
    .timeline-time { font-size: 11px; color: #bbb; margin-top: 4px; font-weight: 500; }
    .detail-actions {
      display: flex; flex-direction: column; gap: 10px; margin-top: 28px;
      padding-bottom: 40px;
      ion-button {
        --border-radius: 16px;
        font-weight: 700; font-size: 16px; min-height: 52px;
        letter-spacing: 0.3px;
      }
    }
  `],
})
export class BookingDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private bookingSvc = inject(BookingService);
  private ui = inject(UiService);

  readonly booking = signal<Booking | null>(null);

  readonly availableActions = computed(() => {
    const b = this.booking();
    if (!b) return [];
    switch (b.status) {
      case 'New':      return [{ label: '✓ Check In', action: 'check-in', color: 'success' }, { label: '✕ Cancel', action: 'cancel', color: 'danger' }];
      case 'Booked':   return [{ label: '✓ Check In', action: 'check-in', color: 'success' }, { label: '✕ Cancel', action: 'cancel', color: 'danger' }];
      case 'Check-In': return [{ label: '🅿️ Assign Spot & Park', action: 'park', color: 'primary' }];
      case 'Parked':   return [{ label: '🚗 Release for Pickup', action: 'release', color: 'warning' }];
      case 'Active':   return [{ label: '✓ Complete & Charge', action: 'complete', color: 'success' }, { label: '✕ Cancel', action: 'cancel', color: 'danger' }];
      default:         return [];
    }
  });

  constructor() {
    addIcons({ callOutline, navigateOutline, keyOutline, airplaneOutline, carOutline, timeOutline, cashOutline, documentTextOutline, createOutline });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.router.navigateByUrl('/tabs/issued'); return; }

    // Find in already-loaded bookings
    const all = this.bookingSvc.allBookings();
    const found = all.find(b => b.id === id);
    if (found) { this.booking.set(found); }
  }

  async onAction(action: string): Promise<void> {
    const b = this.booking();
    if (!b) return;

    switch (action) {
      case 'check-in': {
        const ok = await this.ui.confirm('Check In', `Check in ticket #${b.ticketNumber}?`);
        if (!ok) return;
        await this.ui.showLoading('Checking in...');
        try { await this.bookingSvc.transitionStatus(b.id, 'Check-In'); this.ui.toast('Checked in!'); } catch { this.ui.toast('Failed', 'danger'); } finally { await this.ui.hideLoading(); }
        break;
      }
      case 'park':
        this.ui.toast('Open spot selector', 'primary');
        break;
      case 'release': {
        const ok = await this.ui.confirm('Release', `Release ticket #${b.ticketNumber}?`);
        if (!ok) return;
        await this.ui.showLoading('Releasing...');
        try { await this.bookingSvc.checkoutVehicle(b.id); this.ui.toast('Released!'); } catch { this.ui.toast('Failed', 'danger'); } finally { await this.ui.hideLoading(); }
        break;
      }
      case 'complete': {
        const ok = await this.ui.confirm('Complete', `Complete ticket #${b.ticketNumber}?`);
        if (!ok) return;
        await this.ui.showLoading('Completing...');
        try { await this.bookingSvc.completeBooking(b.id); this.ui.toast('Completed!'); this.router.navigateByUrl('/tabs/issued'); } catch { this.ui.toast('Failed', 'danger'); } finally { await this.ui.hideLoading(); }
        break;
      }
      case 'cancel': {
        const ok = await this.ui.confirm('Cancel', `Cancel ticket #${b.ticketNumber}?`);
        if (!ok) return;
        try { await this.bookingSvc.cancelBooking(b.id, 'Cancelled by operator'); this.ui.toast('Cancelled'); this.router.navigateByUrl('/tabs/issued'); } catch { this.ui.toast('Failed', 'danger'); }
        break;
      }
    }
  }
}
