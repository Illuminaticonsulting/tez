import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonToolbar, IonTitle,
} from '@ionic/angular/standalone';
import { BookingService, UiService } from '../../../core/services';
import { Booking, BookingStatus } from '../../../core/models';
import { RelativeTimePipe } from '../../../shared/pipes/date.pipes';

interface KanbanColumn {
  status: BookingStatus;
  label: string;
  color: string;
  bookings: Booking[];
}

@Component({
  selector: 'app-kanban',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IonContent, IonHeader, IonToolbar, IonTitle, RelativeTimePipe],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>Pipeline View</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content [scrollX]="true">
      <div class="kanban-board" role="region" aria-label="Booking pipeline">
        @for (col of columns(); track col.status) {
          <div
            class="kanban-column"
            (dragover)="onDragOver($event)"
            (drop)="onDrop($event, col.status)"
            role="list"
            [attr.aria-label]="col.label + ' column, ' + col.bookings.length + ' tickets'"
          >
            <div class="column-header" [style.borderTopColor]="col.color">
              <h3>{{ col.label }}</h3>
              <span class="column-count">{{ col.bookings.length }}</span>
            </div>
            <div class="column-body">
              @for (booking of col.bookings; track booking.id) {
                <div
                  class="kanban-card"
                  draggable="true"
                  (dragstart)="onDragStart($event, booking)"
                  (click)="onCardClick(booking)"
                  (keydown.enter)="onCardClick(booking)"
                  tabindex="0"
                  role="listitem"
                  [attr.aria-label]="'Ticket ' + booking.ticketNumber + ' — ' + booking.vehicle.plate"
                >
                  <div class="card-ticket">#{{ booking.ticketNumber }}</div>
                  <div class="card-plate">{{ booking.vehicle.plate }}</div>
                  <div class="card-vehicle">{{ booking.vehicle.color }} {{ booking.vehicle.make }}</div>
                  <div class="card-name">{{ booking.customerName }}</div>
                  <div class="card-time">{{ booking.createdAt | relativeTime }}</div>
                  @if (booking.spotName) {
                    <div class="card-spot">📍 {{ booking.spotName }}</div>
                  }
                </div>
              }
              @if (col.bookings.length === 0) {
                <div class="column-empty">No tickets</div>
              }
            </div>
          </div>
        }
      </div>
    </ion-content>
  `,
  styles: [`
    .kanban-board { display: flex; gap: 16px; padding: 16px; min-width: max-content; height: 100%; }
    .kanban-column {
      width: 280px; min-width: 280px; background: #f8f9fa; border-radius: 16px;
      display: flex; flex-direction: column; max-height: calc(100vh - 120px);
    }
    .kanban-column.drag-over { background: #e8f5e9; }
    .column-header {
      padding: 16px; border-top: 4px solid #ccc; border-radius: 16px 16px 0 0;
      display: flex; justify-content: space-between; align-items: center;
      h3 { margin: 0; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
    }
    .column-count {
      background: #e0e0e0; color: #555; font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 12px;
    }
    .column-body { flex: 1; overflow-y: auto; padding: 0 12px 12px; }
    .kanban-card {
      background: white; border-radius: 12px; padding: 14px; margin-bottom: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,.06); cursor: grab; transition: all .2s; border: 1px solid #f0f0f0;
      &:hover { box-shadow: 0 4px 12px rgba(0,0,0,.1); transform: translateY(-2px); }
      &:active { cursor: grabbing; }
      &:focus-visible { outline: 2px solid #fcc00b; outline-offset: 2px; }
    }
    .card-ticket { font-size: 16px; font-weight: 800; color: #1a1a2e; margin-bottom: 6px; }
    .card-plate {
      font-size: 14px; font-weight: 700; color: #333; background: #f5f5f5;
      display: inline-block; padding: 2px 8px; border-radius: 6px; letter-spacing: 1px; margin-bottom: 4px;
    }
    .card-vehicle { font-size: 12px; color: #888; margin-bottom: 2px; }
    .card-name { font-size: 12px; color: #aaa; margin-bottom: 6px; }
    .card-time { font-size: 11px; color: #bbb; }
    .card-spot { font-size: 11px; color: #3949ab; margin-top: 6px; }
    .column-empty { text-align: center; padding: 32px 16px; color: #ccc; font-size: 13px; }
  `],
})
export class KanbanComponent {
  private bookingSvc = inject(BookingService);
  private ui = inject(UiService);
  private router = inject(Router);

  private draggedBooking: Booking | null = null;

  readonly columns = computed<KanbanColumn[]>(() => {
    const g = this.bookingSvc.groups();
    return [
      { status: 'New',       label: 'New',       color: '#ff9800', bookings: g.new },
      { status: 'Booked',    label: 'Booked',    color: '#2196f3', bookings: g.booked },
      { status: 'Check-In',  label: 'Check-In',  color: '#4caf50', bookings: g.issued.filter(b => b.status === 'Check-In') },
      { status: 'Parked',    label: 'Parked',    color: '#9c27b0', bookings: g.issued.filter(b => b.status === 'Parked') },
      { status: 'Active',    label: 'Active',    color: '#ffc107', bookings: g.active },
    ];
  });

  onDragStart(event: DragEvent, booking: Booking): void {
    this.draggedBooking = booking;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', booking.id);
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  /** #31 fix — implement drag-drop completion */
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  async onDrop(event: DragEvent, targetStatus: BookingStatus): Promise<void> {
    event.preventDefault();
    const booking = this.draggedBooking;
    this.draggedBooking = null;

    if (!booking || booking.status === targetStatus) return;

    if (!this.bookingSvc.canTransition(booking.status, targetStatus)) {
      this.ui.toast(`Cannot move from ${booking.status} to ${targetStatus}`, 'warning');
      return;
    }

    const ok = await this.ui.confirm(
      'Move Ticket',
      `Move #${booking.ticketNumber} from ${booking.status} to ${targetStatus}?`
    );
    if (!ok) return;

    try {
      await this.bookingSvc.transitionStatus(booking.id, targetStatus);
      this.ui.toast(`Ticket moved to ${targetStatus}`);
    } catch {
      this.ui.toast('Failed to move ticket', 'danger');
    }
  }

  onCardClick(booking: Booking): void {
    this.router.navigate(['/booking', booking.id]);
  }
}
