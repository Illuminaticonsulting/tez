import { Injectable, inject, signal, computed, OnDestroy, effect } from '@angular/core';
import { where, orderBy } from '@angular/fire/firestore';
import {
  Booking,
  BookingGroups,
  BookingStatus,
  VALID_TRANSITIONS,
} from '../models';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { ApiService } from './api.service';
import { NotificationService } from './notification.service';
import { firstValueFrom, timeout, catchError, of } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class BookingService implements OnDestroy {
  private db = inject(FirestoreService);
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private notify = inject(NotificationService);

  // Reactive state
  readonly allBookings = signal<Booking[]>([]);
  readonly loading = signal(false);

  /** Groups computed WITHOUT side effects (#4 fix) */
  readonly groups = computed<BookingGroups>(() => {
    const all = this.allBookings();
    const groups: BookingGroups = {
      issued: [],
      active: [],
      new: [],
      booked: [],
    };

    for (const b of all) {
      switch (b.status) {
        case 'Parked':
        case 'Check-In':
          groups.issued.push(b);
          break;
        case 'Active':
          groups.active.push(b);
          break;
        case 'New':
          groups.new.push(b);
          break;
        case 'Booked':
          groups.booked.push(b);
          break;
      }
    }
    return groups;
  });

  readonly counts = computed(() => {
    const g = this.groups();
    return {
      issued: g.issued.length,
      active: g.active.length,
      new: g.new.length,
      booked: g.booked.length,
      total: g.issued.length + g.active.length + g.new.length + g.booked.length,
    };
  });

  private unsubscribe?: () => void;

  /** Start real-time listener for company bookings */
  startListening(): void {
    const companyId = this.auth.companyId();
    if (!companyId || this.unsubscribe) return; // prevent duplicate listeners (#46)

    const activeStatuses: BookingStatus[] = [
      'Parked', 'Check-In', 'New', 'Active', 'Booked',
    ];

    this.loading.set(true);

    this.unsubscribe = this.db.listenToCollection<Booking>(
      `companies/${companyId}/bookings`,
      [
        where('status', 'in', activeStatuses),
        orderBy('createdAt', 'desc'),
      ],
      (bookings) => {
        const prev = this.allBookings();
        const prevNewCount = prev.filter((b) => b.status === 'New').length;
        const newCount = bookings.filter((b) => b.status === 'New').length;

        this.allBookings.set(bookings);
        this.loading.set(false);

        // Alert on new tickets
        if (newCount > prevNewCount && prev.length > 0) {
          this.notify.playAlert('new-ticket');
          this.notify.showBanner(
            `${newCount - prevNewCount} new ticket(s) arrived!`,
            'warning'
          );
        }
      }
    );
  }

  stopListening(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Transition via Cloud Function callable (#2 fix) */
  async transitionStatus(
    bookingId: string,
    newStatus: BookingStatus,
    note?: string
  ): Promise<void> {
    await this.api.call('transitionBooking', { bookingId, newStatus, note });
  }

  /** Assign a parking spot via Cloud Function */
  async assignSpot(
    bookingId: string,
    spotId: string,
    locationId: string
  ): Promise<void> {
    await this.api.call('assignSpot', { bookingId, spotId, locationId });
  }

  /** Release (checkout) via Cloud Function */
  async checkoutVehicle(bookingId: string): Promise<void> {
    await this.api.call('transitionBooking', {
      bookingId,
      newStatus: 'Active',
      note: 'Vehicle released for pickup',
    });
  }

  /** Get dynamic price quote for a prospective booking */
  async getPriceQuote(params: {
    estimatedHours: number;
    vehicleType?: string;
    daysInAdvance?: number;
    customerPhone?: string;
  }): Promise<any> {
    return this.api.call('getPriceQuote', params);
  }

  /** Calculate actual completion price based on real parking duration */
  async calculateCompletionPrice(bookingId: string): Promise<any> {
    return this.api.call('calculateCompletionPrice', { bookingId });
  }

  /** Complete a booking with payment */
  async completeBooking(
    bookingId: string,
    paymentMethod = 'cash',
    paymentAmount = 0
  ): Promise<void> {
    await this.api.call('completeBooking', { bookingId, paymentMethod, paymentAmount });
  }

  /** Cancel a booking */
  async cancelBooking(bookingId: string, reason?: string): Promise<void> {
    await this.api.call('cancelBooking', { bookingId, reason });
  }

  /** Create a new booking via Cloud Function */
  async createBooking(data: {
    customerName: string;
    customerPhone?: string;
    customerEmail?: string;
    vehicleMake?: string;
    vehicleModel?: string;
    vehicleColor?: string;
    vehiclePlate: string;
    flightNumber?: string;
    notes?: string;
  }): Promise<{ id: string; ticketNumber: number }> {
    return this.api.call<{ id: string; ticketNumber: number }>('createBooking', data);
  }

  /** Check if a status transition is valid */
  canTransition(from: BookingStatus, to: BookingStatus): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  /** Fetch ALL bookings (including Completed/Cancelled) for analytics.
   *  Returns all bookings within the given number of days (default 30). */
  async getAllBookingsForAnalytics(days = 30): Promise<Booking[]> {
    const companyId = this.auth.companyId();
    if (!companyId) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    try {
      return await firstValueFrom(
        this.db.getCollection<Booking>(
          `companies/${companyId}/bookings`,
          [
            where('createdAt', '>=', cutoff),
            orderBy('createdAt', 'desc'),
          ]
        ).pipe(
          timeout(10000),
          catchError(() => of([] as Booking[]))
        )
      );
    } catch {
      return [];
    }
  }

  ngOnDestroy(): void {
    this.stopListening();
  }
}
