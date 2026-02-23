import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BookingStatus } from '../../../core/models';

@Component({
  selector: 'app-status-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span
      class="badge"
      [class]="'badge badge--' + status.toLowerCase().replace(' ', '-')"
    >
      <span class="badge__dot"></span>
      {{ status }}
    </span>
  `,
  styles: [`
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .badge__dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .badge--new {
      background: #fff3e0;
      color: #e65100;
      .badge__dot { background: #ff9800; animation: pulse 1.5s infinite; }
    }

    .badge--booked {
      background: #e3f2fd;
      color: #1565c0;
      .badge__dot { background: #2196f3; }
    }

    .badge--check-in {
      background: #e8f5e9;
      color: #2e7d32;
      .badge__dot { background: #4caf50; }
    }

    .badge--parked {
      background: #f3e5f5;
      color: #7b1fa2;
      .badge__dot { background: #9c27b0; }
    }

    .badge--active {
      background: #fff8e1;
      color: #f57f17;
      .badge__dot { background: #ffc107; animation: pulse 2s infinite; }
    }

    .badge--completed {
      background: #e8f5e9;
      color: #1b5e20;
      .badge__dot { background: #388e3c; }
    }

    .badge--cancelled {
      background: #ffebee;
      color: #c62828;
      .badge__dot { background: #f44336; }
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.3); }
    }
  `],
})
export class StatusBadgeComponent {
  @Input({ required: true }) status!: BookingStatus;
}
