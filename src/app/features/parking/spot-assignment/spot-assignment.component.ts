import {
  Component, inject, signal, computed, ChangeDetectionStrategy, OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
  IonButton, IonIcon, IonSpinner, IonSegment, IonSegmentButton,
  IonLabel,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, checkmarkOutline } from 'ionicons/icons';
import { ParkingService, BookingService, UiService } from '../../../core/services';
import { ParkingSpot, ParkingLocation } from '../../../core/models';
import { ParkingGridComponent } from '../../../shared/components/parking-grid/parking-grid.component';
import { ModalController } from '@ionic/angular/standalone';

@Component({
  selector: 'app-spot-assignment',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonButton, IonIcon, IonSpinner, IonSegment, IonSegmentButton,
    IonLabel,
    ParkingGridComponent,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>
          Assign Spot
          @if (ticketNumber) {
            <span class="ticket-ref"> — #{{ ticketNumber }}</span>
          }
        </ion-title>
        <ion-buttons slot="start">
          <ion-button (click)="dismiss()" aria-label="Close">
            <ion-icon name="close-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-buttons slot="end">
          <ion-button
            [disabled]="!selectedSpot() || assigning()"
            (click)="onAssign()"
            color="primary"
            [strong]="true"
            aria-label="Confirm spot assignment"
          >
            @if (assigning()) {
              <ion-spinner name="crescent" slot="start"></ion-spinner>
            } @else {
              <ion-icon name="checkmark-outline" slot="start"></ion-icon>
            }
            Assign
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Location Selector -->
      @if (locations().length > 1) {
        <div class="location-selector">
          <ion-segment
            [value]="parkingSvc.selectedLocationId()"
            (ionChange)="onLocationChange($event)"
          >
            @for (loc of locations(); track loc.id) {
              <ion-segment-button [value]="loc.id">
                <ion-label>{{ loc.displayName }}</ion-label>
              </ion-segment-button>
            }
          </ion-segment>
        </div>
      }

      <!-- Utilization Summary -->
      <div class="utilization-bar">
        <div class="util-info">
          <span class="util-label">
            {{ currentUtil().available }} of {{ currentUtil().total }} spots available
          </span>
          <span class="util-pct" [class.util-high]="currentUtil().pct > 80">
            {{ currentUtil().pct }}% full
          </span>
        </div>
        <div class="util-track">
          <div class="util-fill" [style.width.%]="currentUtil().pct"
            [class.util-fill--high]="currentUtil().pct > 80"
            [class.util-fill--med]="currentUtil().pct > 50 && currentUtil().pct <= 80"
          ></div>
        </div>
      </div>

      <!-- Selected Spot Preview -->
      @if (selectedSpot()) {
        <div class="selected-preview">
          <span class="preview-label">Selected:</span>
          <span class="preview-spot">{{ selectedSpot()!.name }}</span>
          <button class="preview-clear" (click)="clearSelection()" aria-label="Clear selection">✕</button>
        </div>
      }

      <!-- Parking Grid -->
      <app-parking-grid
        [spots]="filteredSpots()"
        [selectedSpotId]="selectedSpot()?.id ?? null"
        [title]="currentLocationName()"
        [onSelect]="onSpotSelect"
      ></app-parking-grid>

      @if (filteredSpots().length === 0 && !parkingSvc.loading()) {
        <div class="empty-state">
          <span class="empty-icon">🅿️</span>
          <h3>No Spots Configured</h3>
          <p>Add parking spots in your Firebase console to get started</p>
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .ticket-ref { font-size: 14px; font-weight: 600; color: #fcc00b; }
    .location-selector { padding: 12px 16px 0; }
    .utilization-bar { padding: 16px; }
    .util-info { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .util-label { font-size: 13px; font-weight: 600; color: #555; }
    .util-pct { font-size: 13px; font-weight: 700; color: #4caf50; }
    .util-high { color: #f44336 !important; }
    .util-track { height: 8px; background: #f0f0f0; border-radius: 4px; overflow: hidden; }
    .util-fill { height: 100%; background: #4caf50; border-radius: 4px; transition: width .4s; }
    .util-fill--med { background: #ff9800; }
    .util-fill--high { background: #f44336; }
    .selected-preview {
      display: flex; align-items: center; gap: 8px;
      margin: 0 16px 12px; padding: 12px 16px;
      background: #e3f2fd; border-radius: 12px; border: 1.5px solid #90caf9;
    }
    .preview-label { font-size: 13px; color: #1565c0; font-weight: 600; }
    .preview-spot { font-size: 18px; font-weight: 800; color: #0d47a1; letter-spacing: 1px; }
    .preview-clear {
      margin-left: auto; background: none; border: none;
      font-size: 16px; color: #1565c0; cursor: pointer;
      width: 32px; height: 32px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      &:hover { background: rgba(21,101,192,.1); }
    }
    .empty-state { text-align: center; padding: 60px 20px; color: #999; }
    .empty-icon { font-size: 48px; }
    .empty-state h3 { margin: 16px 0 8px; color: #555; }
  `],
})
export class SpotAssignmentComponent implements OnInit {
  readonly parkingSvc = inject(ParkingService);
  private bookingSvc = inject(BookingService);
  private ui = inject(UiService);
  private modalCtrl = inject(ModalController);

  /** Set by the caller via componentProps */
  bookingId = '';
  ticketNumber = 0;

  readonly selectedSpot = signal<ParkingSpot | null>(null);
  readonly assigning = signal(false);

  readonly locations = this.parkingSvc.locations;
  readonly filteredSpots = this.parkingSvc.filteredSpots;

  readonly currentUtil = computed(() => {
    const utils = this.parkingSvc.utilizationByLocation();
    const locId = this.parkingSvc.selectedLocationId();
    const u = utils.find(u => u.locationId === locId);
    return u ?? { total: 0, occupied: 0, available: 0, pct: 0, locationName: '' };
  });

  readonly currentLocationName = computed(() => {
    const locs = this.locations();
    const locId = this.parkingSvc.selectedLocationId();
    return locs.find(l => l.id === locId)?.displayName ?? 'Parking Spots';
  });

  // Bind method for passing to child component
  onSpotSelect = (spot: ParkingSpot) => {
    if (spot.isAvailable) {
      this.selectedSpot.set(spot.id === this.selectedSpot()?.id ? null : spot);
    }
  };

  constructor() {
    addIcons({ closeOutline, checkmarkOutline });
  }

  ngOnInit(): void {
    // Ensure parking service is listening
    this.parkingSvc.startListening();
  }

  onLocationChange(event: CustomEvent): void {
    this.parkingSvc.selectLocation(event.detail.value);
    this.selectedSpot.set(null);
  }

  clearSelection(): void {
    this.selectedSpot.set(null);
  }

  async dismiss(data?: any): Promise<void> {
    await this.modalCtrl.dismiss(data);
  }

  async onAssign(): Promise<void> {
    const spot = this.selectedSpot();
    if (!spot || !this.bookingId) return;

    this.assigning.set(true);
    try {
      // Lock the spot first
      const locked = await this.parkingSvc.lockSpot(spot.id, spot.locationId);
      if (!locked) {
        this.ui.toast('Failed to lock spot — try another', 'warning');
        return;
      }

      // Assign spot to booking
      await this.bookingSvc.assignSpot(this.bookingId, spot.id, spot.locationId);

      // Transition to Parked
      await this.bookingSvc.transitionStatus(this.bookingId, 'Parked', `Parked at ${spot.name}`);

      this.ui.toast(`Assigned to ${spot.name}!`, 'success');
      await this.dismiss({ spotId: spot.id, spotName: spot.name });
    } catch (err: any) {
      this.ui.toast(err?.message || 'Failed to assign spot', 'danger');
      // Release lock on failure
      try { await this.parkingSvc.releaseSpot(spot.id, spot.locationId); } catch { /* ignore */ }
    } finally {
      this.assigning.set(false);
    }
  }
}
