import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { orderBy } from '@angular/fire/firestore';
import { ParkingSpot, ParkingLocation, enrichSpot } from '../models';
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
  readonly loading = signal(false);

  /** Spots for the currently selected location */
  readonly filteredSpots = computed(() => {
    const locId = this.selectedLocationId();
    if (!locId) return this.spots();
    return this.spots().filter((s) => s.locationId === locId);
  });

  readonly availableSpots = computed(() =>
    this.filteredSpots().filter((s) => s.status === 'available')
  );

  /** Utilization percentage per location */
  readonly utilizationByLocation = computed(() => {
    const locs = this.locations();
    const allSpots = this.spots();
    return locs.map((loc) => {
      const locSpots = allSpots.filter((s) => s.locationId === loc.id);
      const occupied = locSpots.filter((s) => s.status === 'occupied').length;
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

  private unsubLocations?: () => void;
  private unsubSpots = new Map<string, () => void>();

  startListening(): void {
    const companyId = this.auth.companyId();
    if (!companyId || this.unsubLocations) return;

    this.loading.set(true);

    // Listen to locations
    this.unsubLocations = this.db.listenToCollection<ParkingLocation>(
      `companies/${companyId}/locations`,
      [orderBy('order', 'asc')],
      (locs) => {
        this.locations.set(locs);
        if (!this.selectedLocationId() && locs.length) {
          this.selectedLocationId.set(locs[0].id);
        }
        // Start spot listeners for each location (#3 fix — nested path)
        this.startSpotListeners(companyId, locs);
        this.loading.set(false);
      }
    );
  }

  /** Listen to spots under each location subcollection (#3 fix) */
  private startSpotListeners(companyId: string, locs: ParkingLocation[]): void {
    // Clean up old listeners for removed locations
    for (const [locId, unsub] of this.unsubSpots.entries()) {
      if (!locs.find((l) => l.id === locId)) {
        unsub();
        this.unsubSpots.delete(locId);
      }
    }

    // Start listeners for new locations
    for (const loc of locs) {
      if (this.unsubSpots.has(loc.id)) continue;

      const unsub = this.db.listenToCollection<ParkingSpot>(
        `companies/${companyId}/locations/${loc.id}/spots`,
        [orderBy('order', 'asc')],
        (locSpots) => {
          // Merge with existing spots from other locations
          const existing = this.spots().filter((s) => s.locationId !== loc.id);
          const withLocId = locSpots.map((s) => enrichSpot({ ...s, locationId: loc.id }));
          this.spots.set([...existing, ...withLocId]);
        }
      );
      this.unsubSpots.set(loc.id, unsub);
    }
  }

  stopListening(): void {
    this.unsubLocations?.();
    this.unsubLocations = undefined;
    for (const unsub of this.unsubSpots.values()) unsub();
    this.unsubSpots.clear();
  }

  selectLocation(locationId: string): void {
    this.selectedLocationId.set(locationId);
  }

  /** Lock a spot — includes locationId (#6 fix) */
  async lockSpot(spotId: string, locationId: string): Promise<boolean> {
    try {
      await this.api.call('lockSpot', { spotId, locationId });
      return true;
    } catch {
      return false;
    }
  }

  /** Release a spot lock — includes locationId (#6 fix) */
  async releaseSpot(spotId: string, locationId: string): Promise<void> {
    await this.api.call('releaseSpot', { spotId, locationId });
  }

  ngOnDestroy(): void {
    this.stopListening();
  }
}
