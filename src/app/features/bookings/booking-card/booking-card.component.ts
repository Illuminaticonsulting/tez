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
      (click)="cardClick.emit(booking)"
      role="article"
      [attr.aria-label]="'Ticket ' + booking.ticketNumber + ' — ' + booking.vehicle.plate + ' — ' + booking.status"
      tabindex="0"
      (keydown.enter)="cardClick.emit(booking)"
    >
      <div class="card__header">
        <div class="ticket-no">#{{ booking.ticketNumber }}</div>
        <app-status-badge [status]="booking.status"></app-status-badge>
      </div>

      <div class="card__body">
        <div class="vehicle-info">
          @if (booking.vehicle.photoUrl) {
            <img [src]="booking.vehicle.photoUrl" alt="Vehicle photo" class="vehicle-photo" loading="lazy" />
          } @else {
            <div class="vehicle-photo-placeholder" aria-hidden="true">🚗</div>
          }
          <div class="vehicle-details">
            <div class="vehicle-tag">{{ booking.vehicle.plate }}</div>
            <div class="vehicle-make">{{ booking.vehicle.color }} {{ booking.vehicle.make }} {{ booking.vehicle.model }}</div>
            <div class="customer-name">{{ booking.customerName }}</div>
          </div>
        </div>

        <div class="card__meta">
          @if (booking.spotName) {
            <span class="meta-chip meta-chip--spot">📍 {{ booking.spotName }}</span>
          }
          <span class="meta-chip" [class.meta-chip--keys-in]="booking.keysHandedOff" [class.meta-chip--keys-out]="!booking.keysHandedOff">
            {{ booking.keysHandedOff ? '🔑 Keys In' : '🔓 Keys Out' }}
          </span>
          @if (booking.flightNumber) {
            <span class="meta-chip meta-chip--flight">✈️ {{ booking.flightNumber }}</span>
          }
        </div>

        <div class="card__time">
          <span class="time-label">Checked in {{ booking.createdAt | relativeTime }}</span>
        </div>
      </div>

      <div class="card__actions" (click)="$event.stopPropagation()">
        @for (action of getActions(booking.status); track action.label) {
          <button
            class="action-btn"
            [class]="'action-btn action-btn--' + action.color"
            (click)="actionClick.emit({ booking, action: action.action })"
            [attr.aria-label]="action.label + ' ticket ' + booking.ticketNumber"
          >
            {{ action.label }}
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .card {
      background: white; border-radius: 16px; padding: 16px; margin-bottom: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,.06); border: 1px solid #f0f0f0;
      cursor: pointer; transition: all .2s;
      &:hover { box-shadow: 0 4px 16px rgba(0,0,0,.1); transform: translateY(-1px); }
      &:focus-visible { outline: 2px solid #fcc00b; outline-offset: 2px; }
    }
    .card--urgent { border-left: 4px solid #ff9800; animation: urgentPulse 3s infinite; }
    @keyframes urgentPulse {
      0%,100% { box-shadow: 0 2px 8px rgba(0,0,0,.06); }
      50% { box-shadow: 0 2px 16px rgba(255,152,0,.2); }
    }
    .card__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .ticket-no { font-size: 18px; font-weight: 800; color: #1a1a2e; }
    .vehicle-info { display: flex; gap: 12px; margin-bottom: 12px; }
    .vehicle-photo { width: 56px; height: 56px; border-radius: 12px; object-fit: cover; }
    .vehicle-photo-placeholder {
      width: 56px; height: 56px; border-radius: 12px; background: #f5f5f5;
      display: flex; align-items: center; justify-content: center; font-size: 28px;
    }
    .vehicle-tag { font-size: 16px; font-weight: 700; color: #1a1a2e; letter-spacing: 1px; }
    .vehicle-make { font-size: 13px; color: #666; margin-top: 2px; }
    .customer-name { font-size: 13px; color: #999; margin-top: 2px; }
    .card__meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .meta-chip {
      display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px;
      border-radius: 8px; font-size: 12px; font-weight: 500; background: #f5f5f5; color: #555;
    }
    .meta-chip--spot { background: #e8eaf6; color: #3949ab; }
    .meta-chip--keys-in { background: #e8f5e9; color: #2e7d32; }
    .meta-chip--keys-out { background: #fff3e0; color: #e65100; }
    .meta-chip--flight { background: #e3f2fd; color: #1565c0; }
    .card__time { display: flex; justify-content: space-between; margin-bottom: 12px; }
    .time-label { font-size: 12px; color: #999; }
    .card__actions { display: flex; gap: 8px; }
    .action-btn {
      flex: 1; padding: 10px; border: none; border-radius: 10px;
      font-size: 13px; font-weight: 600; cursor: pointer; transition: all .2s;
      &:hover { transform: translateY(-1px); }
      &:focus-visible { outline: 2px solid #333; outline-offset: 2px; }
    }
    .action-btn--primary { background: #1a1a2e; color: white; }
    .action-btn--success { background: #4caf50; color: white; }
    .action-btn--warning { background: #ff9800; color: white; }
    .action-btn--danger { background: #f44336; color: white; }
    .action-btn--info { background: #2196f3; color: white; }
  `],
})
export class BookingCardComponent {
  @Input({ required: true }) booking!: Booking;
  @Output() cardClick = new EventEmitter<Booking>();
  @Output() actionClick = new EventEmitter<{ booking: Booking; action: string }>();

  getActions(status: BookingStatus): { label: string; action: string; color: string }[] {
    switch (status) {
      case 'New':      return [{ label: '✓ Check In', action: 'check-in', color: 'success' }, { label: '✕ Cancel', action: 'cancel', color: 'danger' }];
      case 'Booked':   return [{ label: '✓ Check In', action: 'check-in', color: 'success' }, { label: '✕ Cancel', action: 'cancel', color: 'danger' }];
      case 'Check-In': return [{ label: '🅿️ Park', action: 'park', color: 'primary' }];
      case 'Parked':   return [{ label: '🚗 Release', action: 'release', color: 'warning' }, { label: '📍 Move', action: 'move', color: 'info' }];
      case 'Active':   return [{ label: '✓ Complete', action: 'complete', color: 'success' }];
      default:         return [];
    }
  }
}
