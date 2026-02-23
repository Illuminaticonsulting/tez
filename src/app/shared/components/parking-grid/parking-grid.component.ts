import { Component, Input, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ParkingSpot } from '../../../core/models';

@Component({
  selector: 'app-parking-grid',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="grid-container">
      <div class="grid-header">
        <h3>{{ title() }}</h3>
        <div class="legend">
          <span class="legend-item"><span class="dot dot--available"></span> Available</span>
          <span class="legend-item"><span class="dot dot--occupied"></span> Occupied</span>
          <span class="legend-item"><span class="dot dot--returning"></span> Returning Soon</span>
        </div>
      </div>

      <div class="grid" role="grid" aria-label="Parking spots grid">
        @for (spot of spots(); track spot.id) {
          <button
            class="spot"
            [class.spot--available]="spot.isAvailable"
            [class.spot--occupied]="!spot.isAvailable"
            [class.spot--selected]="spot.id === selectedSpotId()"
            [class.spot--returning]="isReturningSoon(spot)"
            [disabled]="!spot.isAvailable && spot.id !== selectedSpotId()"
            (click)="onSpotClick(spot)"
            [attr.aria-label]="'Parking spot ' + spot.name + (spot.isAvailable ? ', available' : ', occupied')"
            role="gridcell"
          >
            <span class="spot__name">{{ spot.name }}</span>
            @if (!spot.isAvailable && spot.bookingId) {
              <span class="spot__ticket">🚗</span>
            }
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .grid-container {
      padding: 16px;
    }

    .grid-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 8px;

      h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
      }
    }

    .legend {
      display: flex;
      gap: 16px;
      font-size: 12px;
      color: #666;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .dot--available { background: #4caf50; }
    .dot--occupied { background: #ef5350; }
    .dot--returning { background: #ff9800; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
      gap: 8px;
    }

    .spot {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 64px;
      border-radius: 10px;
      border: 2px solid transparent;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .spot--available {
      background: #e8f5e9;
      color: #2e7d32;
      border-color: #a5d6a7;
      &:hover { background: #c8e6c9; transform: scale(1.05); }
    }

    .spot--occupied {
      background: #ffebee;
      color: #c62828;
      border-color: #ef9a9a;
      cursor: not-allowed;
      opacity: 0.7;
    }

    .spot--returning {
      background: #fff3e0;
      color: #e65100;
      border-color: #ffcc80;
      animation: returnPulse 2s infinite;
    }

    .spot--selected {
      border-color: #1976d2 !important;
      background: #bbdefb !important;
      color: #0d47a1 !important;
      transform: scale(1.08);
      box-shadow: 0 4px 12px rgba(25, 118, 210, 0.3);
    }

    .spot__name { font-size: 14px; }
    .spot__ticket { font-size: 18px; }

    @keyframes returnPulse {
      0%, 100% { border-color: #ffcc80; }
      50% { border-color: #ff9800; }
    }
  `],
})
export class ParkingGridComponent {
  title = input('Parking Spots');
  spots = input<ParkingSpot[]>([]);
  selectedSpotId = input<string | null>(null);
  @Input() onSelect?: (spot: ParkingSpot) => void;

  isReturningSoon(spot: ParkingSpot): boolean {
    if (spot.isAvailable || !spot.returningDate) return false;
    const returning = new Date(spot.returningDate);
    const now = new Date();
    const diffMin = (returning.getTime() - now.getTime()) / 60000;
    return diffMin > 0 && diffMin <= 30;
  }

  onSpotClick(spot: ParkingSpot): void {
    if (spot.isAvailable || spot.id === this.selectedSpotId()) {
      this.onSelect?.(spot);
    }
  }
}
