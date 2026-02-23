/**
 * Tez — Firestore Triggers
 *
 * Reactive functions that fire on document events.
 * - New booking: in-app notification + daily stats
 * - Status change: in-app notification + SMS/email at every journey stage
 *
 * Customer Journey SMS/Email Matrix:
 *   New        → (handled by createBooking callable directly)
 *   Check-In   → SMS "vehicle checked in"
 *   Parked     → SMS "vehicle parked safely"
 *   Active     → SMS "vehicle on its way!"
 *   Completed  → SMS + Email receipt
 *   Cancelled  → SMS + Email cancellation
 */

import { functions, admin, db } from '../config';
import {
  notifyCheckIn,
  notifyParked,
  notifyVehicleReady,
  notifyCompleted,
  notifyCancelled,
  type BookingNotifyData,
} from '../services/notifications';

// ─── Helper: Build BookingNotifyData from Firestore doc ──────────────

function buildNotifyData(
  companyId: string,
  bookingId: string,
  data: FirebaseFirestore.DocumentData,
): BookingNotifyData {
  return {
    companyId,
    bookingId,
    ticketNumber: data['ticketNumber'] || 0,
    customerName: data['customerName'] || '',
    customerPhone: data['customerPhone'] || '',
    customerEmail: data['customerEmail'] || '',
    vehiclePlate: data['vehicle']?.['plate'] || '',
    vehicleDescription: [
      data['vehicle']?.['color'],
      data['vehicle']?.['make'],
      data['vehicle']?.['model'],
    ].filter(Boolean).join(' '),
    flightNumber: data['flightNumber'] || '',
    spotName: data['spotName'] || '',
    paymentAmount: data['payment']?.['amount'] || 0,
    paymentMethod: data['payment']?.['method'] || 'cash',
    cancellationReason: '',
    createdAt: data['createdAt']?.toDate?.()?.toISOString() || '',
    completedAt: data['completedAt']?.toDate?.()?.toISOString() || '',
  };
}

// ─── Notify on New Booking ───────────────────────────────────────────

export const onBookingCreated = functions.firestore
  .document('companies/{companyId}/bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const { companyId, bookingId } = context.params;

    // Create in-app notification
    await db
      .collection('companies')
      .doc(companyId)
      .collection('notifications')
      .add({
        type: 'new-booking',
        title: `New Ticket #${data['ticketNumber']}`,
        body: `${data['customerName']} — ${data['vehicle']?.['plate'] || 'No plate'}`,
        bookingId,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

    // Increment daily stats
    const today = new Date().toISOString().split('T')[0]!;
    await db
      .collection('companies')
      .doc(companyId)
      .collection('stats')
      .doc(today)
      .set(
        {
          newBookingCount: admin.firestore.FieldValue.increment(1),
          lastBookingAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    functions.logger.info('Booking created notification sent', { companyId, bookingId, ticketNumber: data['ticketNumber'] });
  });

// ─── Track Status Changes + Customer Notifications ──────────────────

export const onBookingUpdated = functions.firestore
  .document('companies/{companyId}/bookings/{bookingId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const { companyId, bookingId } = context.params;

    // Only react if status changed
    if (before['status'] === after['status']) return;

    const oldStatus = before['status'] as string;
    const newStatus = after['status'] as string;

    functions.logger.info('Booking status changed', { companyId, bookingId, oldStatus, newStatus });

    // ── In-app notifications (for operators) ─────────────────────

    const notifyStatuses = ['Check-In', 'Parked', 'Active', 'Completed', 'Cancelled'];
    if (notifyStatuses.includes(newStatus)) {
      await db
        .collection('companies')
        .doc(companyId)
        .collection('notifications')
        .add({
          type: 'status-change',
          title: `Ticket #${after['ticketNumber']} — ${newStatus}`,
          body: `${after['customerName']}: ${oldStatus} → ${newStatus}`,
          bookingId,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
    }

    // ── Customer SMS/Email (non-blocking) ────────────────────────

    const notifyData = buildNotifyData(companyId, bookingId, after);

    try {
      switch (newStatus) {
        case 'Check-In':
          await notifyCheckIn(notifyData);
          break;

        case 'Parked':
          await notifyParked(notifyData);
          break;

        case 'Active':
          await notifyVehicleReady(notifyData);
          break;

        case 'Completed':
          await notifyCompleted(notifyData);
          break;

        case 'Cancelled': {
          // Extract reason from latest history entry
          const history = after['history'] as Array<{ note?: string }> | undefined;
          const lastEntry = history?.[history.length - 1];
          notifyData.cancellationReason = lastEntry?.note || '';
          await notifyCancelled(notifyData);
          break;
        }
      }
    } catch (err) {
      // Never let notification failures break the trigger
      functions.logger.error('Customer notification failed', { companyId, bookingId, newStatus, error: err });
    }
  });
