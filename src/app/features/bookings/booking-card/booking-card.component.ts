import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Booking, BookingStatus } from '../../../core/models';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { RelativeTimePipe } from '../../../shared/pipes/date.pipes';

@Component({
  selector: 'app-booking-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, StatusBadgeComponent, RelativeTimePipe],
  template: `
    <div
      class="card"
      [class.card--urgent]="booking.status === 'New'"
      [class.card--active]="booking.status === 'Active'"
      (click)="cardClick.emit(booking)"
      role="article"
      [attr.aria-label]="'Ticket ' + booking.ticketNumber + ', ' + booking.vehicle.plate + ', Status: ' + booking.status + ', Customer: ' + booking.customerName"
      tabindex="0"
      (keydown.enter)="cardClick.emit(booking)"
    >
      <!-- Top row: ticket + status -->
      <div class="card__header">
        <div class="ticket-no">#{{ booking.ticketNumber }}</div>
        <app-status-badge [status]="booking.status"></app-status-badge>
      </div>

      <!-- Vehicle + customer info -->
      <div class="card__body">
        <div class="vehicle-info">
          @if (booking.vehicle.photoUrl) {
            <img [src]="booking.vehicle.photoUrl" alt="Photo of {{ booking.vehicle.color }} {{ booking.vehicle.make }}" class="vehicle-photo" loading="lazy" />
          } @else {
            <div class="vehicle-photo-placeholder" aria-hidden="true">
              <span class="placeholder-icon">🚗</span>
            </div>
          }
          <div class="vehicle-details">
            <div class="vehicle-tag">{{ booking.vehicle.plate }}</div>
            <div class="vehicle-make">{{ booking.vehicle.color }} {{ booking.vehicle.make }} {{ booking.vehicle.model }}</div>
            <div class="customer-name">{{ booking.customerName }}</div>
          </div>
        </div>

        <!-- Quick-glance info pills -->
        <div class="card__meta">
          @if (booking.spotName) {
            <span class="meta-chip meta-chip--spot" [attr.aria-label]="'Parked at ' + booking.spotName">
              <span class="chip-icon">📍</span> {{ booking.spotName }}
            </span>
          }
          <span class="meta-chip"
            [class.meta-chip--keys-in]="booking.keysHandedOff"
            [class.meta-chip--keys-out]="!booking.keysHandedOff"
            [attr.aria-label]="booking.keysHandedOff ? 'Keys received' : 'Keys not yet received'">
            <span class="chip-icon">{{ booking.keysHandedOff ? '🔑' : '🔓' }}</span>
            {{ booking.keysHandedOff ? 'Keys In' : 'Keys Out' }}
          </span>
          @if (booking.flightNumber) {
            <span class="meta-chip meta-chip--flight" [attr.aria-label]="'Flight ' + booking.flightNumber">
              <span class="chip-icon">✈️</span> {{ booking.flightNumber }}
            </span>
          }
        </div>

        <!-- Timestamp -->
        <div class="card__time">
          <span class="time-label">{{ booking.createdAt | relativeTime }}</span>
        </div>
      </div>

      <!-- Action buttons — big, clear, color-coded -->
      <div class="card__actions" (click)="$event.stopPropagation()">
        @for (action of getActions(booking.status); track action.label) {
          <button
            class="action-btn"
            [class]="'action-btn action-btn--' + action.color"
            (click)="actionClick.emit({ booking, action: action.action })"
            [attr.aria-label]="action.ariaLabel + ' for ticket ' + booking.ticketNumber"
          >
            <span class="action-icon">{{ action.icon }}</span>
            <span class="action-text">{{ action.label }}</span>
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .card {
      background: white; border-radius: 20px; padding: 18px; margin-bottom: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,.04), 0 1px 2px rgba(0,0,0,.06);
      border: 1.5px solid #f0f0f2; cursor: pointer;
      transition: all .25s cubic-bezier(0.4, 0, 0.2, 1);
      &:hover { box-shadow: 0 6px 20px rgba(0,0,0,.08); transform: translateY(-2px); }
      &:active { transform: scale(0.98); }
      &:focus-visible { outline: 3px solid #fcc00b; outline-offset: 2px; }
    }
    .card--urgent {
      border-left: 5px solid #ff9100;
      background: linear-gradient(135deg, #fffbf0 0%, #ffffff 40%);
      animation: urgentGlow 3s ease-in-out infinite;
    }
    .card--active {
      border-left: 5px solid #00c853;
    }
    @keyframes urgentGlow {
      0%,100% { box-shadow: 0 2px 8px rgba(0,0,0,.04); }
      50% { box-shadow: 0 4px 20px rgba(255,145,0,.15); }
    }
    .card__header {
      display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;
    }
    .ticket-no { font-size: 20px; font-weight: 800; color: #1a1a2e; letter-spacing: -0.3px; }
    .vehicle-info { display: flex; gap: 14px; margin-bottom: 14px; align-items: center; }
    .vehicle-photo {
      width: 60px; height: 60px; border-radius: 14px; object-fit: cover;
      box-shadow: 0 2px 8px rgba(0,0,0,.08);
    }
    .vehicle-photo-placeholder {
      width: 60px; height: 60px; border-radius: 14px; background: linear-gradient(135deg, #f0f1f5, #e8e9ed);
      display: flex; align-items: center; justify-content: center;
    }
    .placeholder-icon { font-size: 28px; filter: grayscale(0.3); }
    .vehicle-tag {
      font-size: 17px; font-weight: 800; color: #1a1a2e; letter-spacing: 1.5px;
      background: #f0f1f5; display: inline-block; padding: 3px 10px; border-radius: 8px;
    }
    .vehicle-make { font-size: 14px; color: #666; margin-top: 3px; }
    .customer-name { font-size: 13px; color: #999; margin-top: 2px; font-weight: 500; }
    .card__meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .meta-chip {
      display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px;
      border-radius: 10px; font-size: 13px; font-weight: 600; background: #f0f1f5; color: #555;
    }
    .chip-icon { font-size: 14px; }
    .meta-chip--spot { background: #e8eaf6; color: #3949ab; }
    .meta-chip--keys-in { background: #e8f5e9; color: #2e7d32; }
    .meta-chip--keys-out { background: #fff3e0; color: #e65100; }
    .meta-chip--flight { background: #e3f2fd; color: #1565c0; }
    .card__time { margin-bottom: 14px; }
    .time-label { font-size: 12px; color: #aaa; font-weight: 500; }
    .card__actions { display: flex; gap: 10px; }
    .action-btn {
      flex: 1; padding: 12px 8px; border: none; border-radius: 14px;
      font-size: 14px; font-weight: 700; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      transition: all .2s cubic-bezier(0.4, 0, 0.2, 1);
      min-height: 48px; justify-content: center;
      &:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,.15); }
      &:active { transform: scale(0.96); }
      &:focus-visible { outline: 3px solid #333; outline-offset: 2px; }
    }
    .action-icon { font-size: 18px; line-height: 1; }
    .action-text { font-size: 12px; font-weight: 700; letter-spacing: 0.3px; }
    .action-btn--primary { background: #1a1a2e; color: white; }
    .action-btn--success { background: #00c853; color: white; }
    .action-btn--warning { background: #ff9100; color: #1a1a2e; }
    .action-btn--danger { background: #ff1744; color: white; }
    .action-btn--info { background: #2979ff; color: white; }
  `],
})
export class BookingCardComponent {
  @Input({ required: true }) booking!: Booking;
  @Output() cardClick = new EventEmitter<Booking>();
  @Output() actionClick = new EventEmitter<{ booking: Booking; action: string }>();

  getActions(status: BookingStatus): { label: string; action: string; color: string; icon: string; ariaLabel: string }[] {
    switch (status) {
      case 'New':      return [
        { label: 'Check In', action: 'check-in', color: 'success', icon: '✓', ariaLabel: 'Check in' },
        { label: 'Cancel', action: 'cancel', color: 'danger', icon: '✕', ariaLabel: 'Cancel' },
      ];
      case 'Booked':   return [
        { label: 'Check In', action: 'check-in', color: 'success', icon: '✓', ariaLabel: 'Check in' },
        { label: 'Cancel', action: 'cancel', color: 'danger', icon: '✕', ariaLabel: 'Cancel' },
      ];
      case 'Check-In': return [
        { label: 'Park', action: 'park', color: 'primary', icon: '🅿️', ariaLabel: 'Assign parking spot' },
      ];
      case 'Parked':   return [
        { label: 'Release', action: 'release', color: 'warning', icon: '🚗', ariaLabel: 'Release vehicle' },
        { label: 'Move', action: 'move', color: 'info', icon: '📍', ariaLabel: 'Move to different spot' },
      ];
      case 'Active':   return [
        { label: 'Complete', action: 'complete', color: 'success', icon: '✓', ariaLabel: 'Complete and charge' },
      ];
      default:         return [];
    }
  }
}
