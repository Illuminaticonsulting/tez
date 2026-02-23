import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { where, orderBy } from '@angular/fire/firestore';
import {
  Booking,
  BookingGroups,
  BookingStatus,
  BookingHistoryEntry,
  VALID_TRANSITIONS,
} from '../models';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { ApiService } from './api.service';
import { NotificationService } from './notification.service';
import { format } from 'date-fns';

@Injectable({ providedIn: 'root' })
export class BookingService implements OnDestroy {
  private db = inject(FirestoreService);
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private notify = inject(NotificationService);

  // Reactive state
  readonly allBookings = signal<Booking[]>([]);
  readonly maxBookingId = signal(0);

  readonly groups = computed<BookingGroups>(() => {
    const all = this.allBookings();
    const groups: BookingGroups = {
      issued: [],
      active: [],
      new: [],
      booked: [],
    };

    let maxId = 0;

    for (const b of all) {
      const num = Number(b.ticketNo);
      if (!isNaN(num) && num > maxId) maxId = num;

      switch (b.bookingStatus) {
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

    this.maxBookingId.set(maxId);
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
    if (!companyId) return;

    const activeStatuses: BookingStatus[] = [
      'Parked',
      'Check-In',
      'New',
      'Active',
      'Booked',
    ];

    this.unsubscribe = this.db.listenToCollection<Booking>(
      `companies/${companyId}/bookings`,
      [
        where('bookingStatus', 'in', activeStatuses),
        orderBy('createdAt', 'desc'),
      ],
      (bookings) => {
        const prev = this.allBookings();
        const prevNewCount = prev.filter((b) => b.bookingStatus === 'New').length;
        const newCount = bookings.filter((b) => b.bookingStatus === 'New').length;

        this.allBookings.set(bookings);

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

  /** Transition a booking status via Cloud Function (secure) */
  async transitionStatus(
    bookingId: string,
    newStatus: BookingStatus,
    extraData: Record<string, any> = {}
  ): Promise<void> {
    await this.api.post('bookings/transition', {
      bookingId,
      newStatus,
      ...extraData,
    });
  }

  /** Assign a parking spot via Cloud Function (atomic) */
  async assignSpot(
    bookingId: string,
    spotId: string,
    locationId: string
  ): Promise<void> {
    await this.api.post('bookings/assignSpot', {
      bookingId,
      spotId,
      locationId,
    });
  }

  /** Move to Active (vehicle exited) via Cloud Function */
  async checkoutVehicle(
    bookingId: string,
    waitingTime: number
  ): Promise<void> {
    await this.api.post('bookings/checkout', {
      bookingId,
      waitingTime,
    });
  }

  /** Complete a booking */
  async completeBooking(bookingId: string): Promise<void> {
    await this.api.post('bookings/complete', { bookingId });
  }

  /** Create a new booking via Cloud Function (gets atomic ticket #) */
  async createBooking(data: Partial<Booking>): Promise<string> {
    const res = await this.api.post<{ bookingId: string }>(
      'bookings/create',
      data
    );
    return res.bookingId;
  }

  /** Get audit history for a booking */
  getHistory(bookingId: string) {
    const companyId = this.auth.companyId();
    return this.db.getCollection<BookingHistoryEntry>(
      `companies/${companyId}/bookings/${bookingId}/history`,
      [orderBy('changedAt', 'desc')]
    );
  }

  /** Check if a status transition is valid */
  canTransition(from: BookingStatus, to: BookingStatus): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  ngOnDestroy(): void {
    this.stopListening();
  }
}
