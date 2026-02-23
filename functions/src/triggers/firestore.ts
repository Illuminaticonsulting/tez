/**
 * Tez — Firestore Triggers
 *
 * Reactive functions that fire on document events.
 * - New booking notification
 * - Booking status change analytics
 */

import { functions, admin, db } from '../config';

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
        // Auto-expire after 30 days
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

// ─── Track Status Changes ───────────────────────────────────────────

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

    // Send notification for important transitions
    const notifyStatuses = ['Active', 'Completed', 'Cancelled'];
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
  });
