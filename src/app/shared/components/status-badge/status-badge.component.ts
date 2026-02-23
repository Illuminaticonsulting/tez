import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BookingStatus } from '../../../core/models';

@Component({
  selector: 'app-status-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <span
      class="badge"
      [class]="'badge badge--' + status.toLowerCase().replace(' ', '-')"
      role="status"
      [attr.aria-label]="'Status: ' + status"
    >
      <span class="badge__dot" aria-hidden="true"></span>
      <span class="badge__text">{{ status }}</span>
    </span>
  `,
  styles: [`
    .badge {
      display: inline-flex; align-items: center; gap: 7px; padding: 5px 14px;
      border-radius: 20px; font-size: 12px; font-weight: 700;
      text-transform: uppercase; letter-spacing: .6px;
      white-space: nowrap;
    }
    .badge__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .badge__text { line-height: 1; }
    .badge--new {
      background: linear-gradient(135deg, #fff3e0, #ffe0b2); color: #e65100;
      .badge__dot { background: #ff9100; animation: dotPulse 1.8s ease-in-out infinite; }
    }
    .badge--booked {
      background: linear-gradient(135deg, #e3f2fd, #bbdefb); color: #1565c0;
      .badge__dot { background: #2979ff; }
    }
    .badge--check-in {
      background: linear-gradient(135deg, #e8f5e9, #c8e6c9); color: #2e7d32;
      .badge__dot { background: #00c853; }
    }
    .badge--parked {
      background: linear-gradient(135deg, #f3e5f5, #e1bee7); color: #7b1fa2;
      .badge__dot { background: #ab47bc; }
    }
    .badge--active {
      background: linear-gradient(135deg, #fff8e1, #ffecb3); color: #f57f17;
      .badge__dot { background: #ffc107; animation: dotPulse 2s ease-in-out infinite; }
    }
    .badge--completed {
      background: linear-gradient(135deg, #e8f5e9, #c8e6c9); color: #1b5e20;
      .badge__dot { background: #2e7d32; }
    }
    .badge--cancelled {
      background: linear-gradient(135deg, #ffebee, #ffcdd2); color: #c62828;
      .badge__dot { background: #ff1744; }
    }
    @keyframes dotPulse {
      0%,100% { opacity: 1; transform: scale(1); }
      50% { opacity: .4; transform: scale(1.4); }
    }
  `],
})
export class StatusBadgeComponent {
  @Input({ required: true }) status!: BookingStatus;
}
