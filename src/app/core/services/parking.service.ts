import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { where, orderBy } from '@angular/fire/firestore';
import { ParkingSpot, ParkingLocation } from '../models';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class ParkingService implements OnDestroy {
  private db = inject(FirestoreService);
  private auth = inject(AuthService);
  private api = inject(ApiService);

  readonly spots = signal<ParkingSpot[]>([]);
  readonly locations = signal<ParkingLocation[]>([]);
  readonly selectedLocationId = signal<string>('');

  /** Spots for the currently selected location */
  readonly filteredSpots = computed(() => {
    const locId = this.selectedLocationId();
    if (!locId) return this.spots();
    return this.spots().filter((s) => s.locationId === locId);
  });

  /** Available spots in selected location */
  readonly availableSpots = computed(() =>
    this.filteredSpots().filter((s) => s.isAvailable)
  );

  /** Utilization percentage per location */
  readonly utilizationByLocation = computed(() => {
    const locs = this.locations();
    const allSpots = this.spots();
    return locs.map((loc) => {
      const locSpots = allSpots.filter((s) => s.locationId === loc.id);
      const occupied = locSpots.filter((s) => !s.isAvailable).length;
      return {
        locationId: loc.id,
        locationName: loc.displayName,
        total: locSpots.length,
        occupied,
        available: locSpots.length - occupied,
        pct: locSpots.length ? Math.round((occupied / locSpots.length) * 100) : 0,
      };
    });
  });

  private unsubSpots?: () => void;
  private unsubLocations?: () => void;

  startListening(): void {
    const companyId = this.auth.companyId();
    if (!companyId) return;

    this.unsubLocations = this.db.listenToCollection<ParkingLocation>(
      `companies/${companyId}/locations`,
      [orderBy('order', 'asc')],
      (locs) => {
        this.locations.set(locs);
        if (!this.selectedLocationId() && locs.length) {
          this.selectedLocationId.set(locs[0].id);
        }
      }
    );

    this.unsubSpots = this.db.listenToCollection<ParkingSpot>(
      `companies/${companyId}/parkingSpots`,
      [orderBy('order', 'asc')],
      (spots) => this.spots.set(spots)
    );
  }

  stopListening(): void {
    this.unsubSpots?.();
    this.unsubLocations?.();
  }

  selectLocation(locationId: string): void {
    this.selectedLocationId.set(locationId);
  }

  /** Lock a spot (via Cloud Function to prevent race conditions) */
  async lockSpot(spotId: string): Promise<boolean> {
    try {
      await this.api.post('parking/lockSpot', { spotId });
      return true;
    } catch {
      return false;
    }
  }

  /** Release a spot lock */
  async releaseSpot(spotId: string): Promise<void> {
    await this.api.post('parking/releaseSpot', { spotId });
  }

  ngOnDestroy(): void {
    this.stopListening();
  }
}
