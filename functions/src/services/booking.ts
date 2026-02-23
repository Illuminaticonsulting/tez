/**
 * Tez — Booking Service (Cloud Functions)
 *
 * All booking mutations: create, transition, complete, cancel, list.
 * Features:
 * - Zod-validated inputs
 * - Idempotency keys for createBooking
 * - Sharded ticket counters for write scalability
 * - Audit logging for every mutation
 * - Correlation IDs for request tracing
 * - Firestore-backed rate limiting
 */

import {
  functions,
  admin,
  db,
  bookingRef,
  spotRef,
  statsRef,
  STANDARD_OPTIONS,
  COUNTER_SHARDS,
} from '../config';
import {
  assertRole,
  checkRateLimit,
  validate,
  checkIdempotency,
  saveIdempotency,
  generateCorrelationId,
  logInfo,
  logError,
  writeAuditLog,
} from '../middleware';
import {
  CreateBookingSchema,
  TransitionBookingSchema,
  CompleteBookingSchema,
  CancelBookingSchema,
  ListBookingsSchema,
  VALID_TRANSITIONS,
  type BookingStatus,
  type CreateBookingResponse,
  type ListBookingsResponse,
  type SuccessResponse,
} from '../types';
import {
  notifyBookingCreated,
  type BookingNotifyData,
} from './notifications';

// ─── Create Booking ──────────────────────────────────────────────────

export const createBooking = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<CreateBookingResponse> => {
    const correlationId = generateCorrelationId();
    const auth = assertRole(context, ['admin', 'operator']);
    await checkRateLimit(auth.uid);

    const input = validate(CreateBookingSchema, data);
    const ctx = { correlationId, uid: auth.uid, companyId: auth.companyId, operation: 'createBooking' };

    // Idempotency check
    const cached = await checkIdempotency(auth.companyId, input.idempotencyKey);
    if (cached) {
      logInfo(ctx, 'Returning cached result for idempotent request');
      return cached as unknown as CreateBookingResponse;
    }

    logInfo(ctx, 'Creating booking', { customerName: input.customerName, plate: input.vehiclePlate });

    // Sharded ticket counter — pick random shard to reduce contention
    const shardId = Math.floor(Math.random() * COUNTER_SHARDS);
    const shardRef = db
      .collection('companies')
      .doc(auth.companyId)
      .collection('meta')
      .doc(`counter_shard_${shardId}`);

    const ticketNumber = await db.runTransaction(async (tx) => {
      const shardDoc = await tx.get(shardRef);
      const current = shardDoc.exists ? (shardDoc.data()!['value'] as number) : shardId * 10000;
      const next = current + COUNTER_SHARDS; // Each shard increments by shard count
      tx.set(shardRef, { value: next }, { merge: true });
      return next;
    });

    const bookingData = {
      ticketNumber,
      status: 'New' as BookingStatus,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail,
      vehicle: {
        make: input.vehicleMake,
        model: input.vehicleModel,
        color: input.vehicleColor,
        plate: input.vehiclePlate,
        photoUrl: '',
      },
      flightNumber: input.flightNumber,
      notes: input.notes,
      spotId: '',
      locationId: '',
      keysHandedOff: false,
      payment: { method: '', amount: 0, status: 'pending' },
      history: [
        {
          status: 'New',
          timestamp: new Date().toISOString(),
          userId: auth.uid,
          note: 'Booking created',
        },
      ],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: auth.uid,
      correlationId,
    };

    const docRef = await db
      .collection('companies')
      .doc(auth.companyId)
      .collection('bookings')
      .add(bookingData);

    const result: CreateBookingResponse = { id: docRef.id, ticketNumber };

    // Save idempotency key
    await saveIdempotency(auth.companyId, input.idempotencyKey, result as unknown as Record<string, unknown>);

    // Audit log
    await writeAuditLog(db, auth.companyId, {
      action: 'booking.create',
      uid: auth.uid,
      resourceType: 'booking',
      resourceId: docRef.id,
      details: { ticketNumber, customerName: input.customerName, plate: input.vehiclePlate },
      correlationId,
    });

    logInfo(ctx, 'Booking created', { bookingId: docRef.id, ticketNumber });

    // Send SMS + email confirmation (non-blocking)
    const notifyData: BookingNotifyData = {
      companyId: auth.companyId,
      ticketNumber,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail,
      vehiclePlate: input.vehiclePlate,
      vehicleDescription: [input.vehicleColor, input.vehicleMake, input.vehicleModel].filter(Boolean).join(' '),
      flightNumber: input.flightNumber,
      bookingId: docRef.id,
    };
    notifyBookingCreated(notifyData).catch((err) => {
      logError(ctx, 'Failed to send booking confirmation notifications', err);
    });

    return result;
  });

// ─── Transition Booking ──────────────────────────────────────────────

export const transitionBooking = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<SuccessResponse> => {
    const correlationId = generateCorrelationId();
    const auth = assertRole(context, ['admin', 'operator']);
    await checkRateLimit(auth.uid);

    const input = validate(TransitionBookingSchema, data);
    const ctx = { correlationId, uid: auth.uid, companyId: auth.companyId, operation: 'transitionBooking' };

    logInfo(ctx, 'Transitioning booking', { bookingId: input.bookingId, newStatus: input.newStatus });

    const ref = bookingRef(auth.companyId, input.bookingId);
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) throw new functions.https.HttpsError('not-found', 'Booking not found.');

      const current = doc.data()!['status'] as BookingStatus;
      const allowed = VALID_TRANSITIONS[current];
      if (!allowed || !allowed.includes(input.newStatus)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Cannot transition from ${current} to ${input.newStatus}. Allowed: ${allowed?.join(', ') || 'none'}`,
        );
      }

      const updates: Record<string, unknown> = {
        status: input.newStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        history: admin.firestore.FieldValue.arrayUnion({
          status: input.newStatus,
          timestamp: new Date().toISOString(),
          userId: auth.uid,
          note: input.note || `Status changed to ${input.newStatus}`,
        }),
      };

      // Auto-release spot on cancel
      if (input.newStatus === 'Cancelled') {
        const bData = doc.data()!;
        if (bData['spotId'] && bData['locationId']) {
          tx.update(spotRef(auth.companyId, bData['locationId'], bData['spotId']), {
            status: 'available',
            bookingId: null,
            lockedBy: null,
            lockedAt: null,
          });
        }
      }

      tx.update(ref, updates);
    });

    await writeAuditLog(db, auth.companyId, {
      action: 'booking.transition',
      uid: auth.uid,
      resourceType: 'booking',
      resourceId: input.bookingId,
      details: { newStatus: input.newStatus, note: input.note },
      correlationId,
    });

    logInfo(ctx, 'Booking transitioned', { bookingId: input.bookingId, newStatus: input.newStatus });
    return { success: true };
  });

// ─── Complete Booking ────────────────────────────────────────────────

export const completeBooking = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<SuccessResponse> => {
    const correlationId = generateCorrelationId();
    const auth = assertRole(context, ['admin', 'operator']);
    await checkRateLimit(auth.uid);

    const input = validate(CompleteBookingSchema, data);
    const ctx = { correlationId, uid: auth.uid, companyId: auth.companyId, operation: 'completeBooking' };

    logInfo(ctx, 'Completing booking', { bookingId: input.bookingId });

    const bRef = bookingRef(auth.companyId, input.bookingId);
    await db.runTransaction(async (tx) => {
      const bDoc = await tx.get(bRef);
      if (!bDoc.exists) throw new functions.https.HttpsError('not-found', 'Booking not found.');
      const bData = bDoc.data()!;
      if (bData['status'] !== 'Active') {
        throw new functions.https.HttpsError('failed-precondition', 'Only Active bookings can be completed.');
      }

      // Release spot
      if (bData['spotId'] && bData['locationId']) {
        tx.update(spotRef(auth.companyId, bData['locationId'], bData['spotId']), {
          status: 'available',
          bookingId: null,
          lockedBy: null,
          lockedAt: null,
        });
      }

      tx.update(bRef, {
        status: 'Completed',
        payment: {
          method: input.paymentMethod,
          amount: input.paymentAmount,
          status: 'paid',
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        history: admin.firestore.FieldValue.arrayUnion({
          status: 'Completed',
          timestamp: new Date().toISOString(),
          userId: auth.uid,
          note: `Completed — $${input.paymentAmount} via ${input.paymentMethod}`,
        }),
      });

      // Daily stats
      const today = new Date().toISOString().split('T')[0]!;
      tx.set(
        statsRef(auth.companyId, today),
        {
          completedCount: admin.firestore.FieldValue.increment(1),
          totalRevenue: admin.firestore.FieldValue.increment(input.paymentAmount),
        },
        { merge: true },
      );
    });

    await writeAuditLog(db, auth.companyId, {
      action: 'booking.complete',
      uid: auth.uid,
      resourceType: 'booking',
      resourceId: input.bookingId,
      details: { paymentMethod: input.paymentMethod, paymentAmount: input.paymentAmount },
      correlationId,
    });

    logInfo(ctx, 'Booking completed', { bookingId: input.bookingId, amount: input.paymentAmount });
    return { success: true };
  });

// ─── Cancel Booking ──────────────────────────────────────────────────

export const cancelBooking = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<SuccessResponse> => {
    const correlationId = generateCorrelationId();
    const auth = assertRole(context, ['admin', 'operator']);
    await checkRateLimit(auth.uid);

    const input = validate(CancelBookingSchema, data);
    const ctx = { correlationId, uid: auth.uid, companyId: auth.companyId, operation: 'cancelBooking' };

    logInfo(ctx, 'Cancelling booking', { bookingId: input.bookingId });

    const bRef = bookingRef(auth.companyId, input.bookingId);
    await db.runTransaction(async (tx) => {
      const bDoc = await tx.get(bRef);
      if (!bDoc.exists) throw new functions.https.HttpsError('not-found', 'Booking not found.');
      const bData = bDoc.data()!;
      const current = bData['status'] as BookingStatus;
      const allowed = VALID_TRANSITIONS[current];
      if (!allowed || !allowed.includes('Cancelled')) {
        throw new functions.https.HttpsError('failed-precondition', `Cannot cancel a ${current} booking.`);
      }

      // Release spot
      if (bData['spotId'] && bData['locationId']) {
        tx.update(spotRef(auth.companyId, bData['locationId'], bData['spotId']), {
          status: 'available',
          bookingId: null,
          lockedBy: null,
          lockedAt: null,
        });
      }

      tx.update(bRef, {
        status: 'Cancelled',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        history: admin.firestore.FieldValue.arrayUnion({
          status: 'Cancelled',
          timestamp: new Date().toISOString(),
          userId: auth.uid,
          note: input.reason || 'Booking cancelled',
        }),
      });
    });

    await writeAuditLog(db, auth.companyId, {
      action: 'booking.cancel',
      uid: auth.uid,
      resourceType: 'booking',
      resourceId: input.bookingId,
      details: { reason: input.reason },
      correlationId,
    });

    logInfo(ctx, 'Booking cancelled', { bookingId: input.bookingId });
    return { success: true };
  });

// ─── List Bookings (Server-side Pagination) ──────────────────────────

export const listBookings = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<ListBookingsResponse> => {
    const auth = assertRole(context, ['admin', 'operator', 'viewer']);
    await checkRateLimit(auth.uid);

    const input = validate(ListBookingsSchema, data);

    let query: FirebaseFirestore.Query = db
      .collection('companies')
      .doc(auth.companyId)
      .collection('bookings')
      .orderBy(input.orderBy, input.direction)
      .limit(input.limit + 1); // +1 to detect hasMore

    if (input.status) {
      query = query.where('status', '==', input.status);
    }

    if (input.startAfter) {
      const startDoc = await bookingRef(auth.companyId, input.startAfter).get();
      if (startDoc.exists) {
        query = query.startAfter(startDoc);
      }
    }

    const snapshot = await query.get();
    const hasMore = snapshot.docs.length > input.limit;
    const docs = hasMore ? snapshot.docs.slice(0, input.limit) : snapshot.docs;

    const bookings = docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      // Convert Firestore Timestamps to ISO strings for client
      createdAt: doc.data()['createdAt']?.toDate?.()?.toISOString() ?? '',
      updatedAt: doc.data()['updatedAt']?.toDate?.()?.toISOString() ?? '',
      completedAt: doc.data()['completedAt']?.toDate?.()?.toISOString() ?? '',
    }));

    return {
      bookings,
      hasMore,
      lastDoc: docs.length > 0 ? docs[docs.length - 1]!.id : undefined,
    };
  });
