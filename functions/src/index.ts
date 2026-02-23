/**
 * Tez — Cloud Functions
 *
 * All booking mutations, parking operations, and external API proxies
 * run through these functions. The client never writes directly to
 * Firestore — this eliminates race conditions, enforces status
 * transition rules, and keeps API keys server-side.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

admin.initializeApp();

const db = admin.firestore();

// ─── Types ───────────────────────────────────────────────────────────

type BookingStatus = 'New' | 'Booked' | 'Check-In' | 'Parked' | 'Active' | 'Completed' | 'Cancelled';

const VALID_TRANSITIONS: Record<string, BookingStatus[]> = {
  New: ['Booked', 'Cancelled'],
  Booked: ['Check-In', 'Cancelled'],
  'Check-In': ['Parked', 'Cancelled'],
  Parked: ['Active', 'Cancelled'],
  Active: ['Completed'],
};

// ─── Helpers ─────────────────────────────────────────────────────────

function assertAuth(context: functions.https.CallableContext) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');
  }
  return context.auth;
}

function assertRole(context: functions.https.CallableContext, roles: string[]) {
  const auth = assertAuth(context);
  const role = auth.token['role'] as string | undefined;
  if (!role || !roles.includes(role)) {
    throw new functions.https.HttpsError('permission-denied', `Requires role: ${roles.join(' | ')}`);
  }
  return auth;
}

function getCompanyId(context: functions.https.CallableContext): string {
  const auth = assertAuth(context);
  const companyId = auth.token['companyId'] as string | undefined;
  if (!companyId) {
    throw new functions.https.HttpsError('failed-precondition', 'User has no company assigned.');
  }
  return companyId;
}

function bookingRef(companyId: string, bookingId: string) {
  return db.collection('companies').doc(companyId).collection('bookings').doc(bookingId);
}

function spotRef(companyId: string, locationId: string, spotId: string) {
  return db
    .collection('companies')
    .doc(companyId)
    .collection('locations')
    .doc(locationId)
    .collection('spots')
    .doc(spotId);
}

// ─── Booking: Create ─────────────────────────────────────────────────

export const createBooking = functions.https.onCall(async (data, context) => {
  const auth = assertRole(context, ['admin', 'operator']);
  const companyId = getCompanyId(context);

  const { customerName, customerPhone, vehicleMake, vehicleModel, vehicleColor, vehiclePlate, flightNumber, notes } =
    data;

  if (!customerName || !vehiclePlate) {
    throw new functions.https.HttpsError('invalid-argument', 'customerName and vehiclePlate are required.');
  }

  // Atomic ticket number
  const counterRef = db.collection('companies').doc(companyId).collection('meta').doc('counters');

  const ticketNumber = await db.runTransaction(async (tx) => {
    const counterDoc = await tx.get(counterRef);
    const current = counterDoc.exists ? (counterDoc.data()!['lastTicketNumber'] as number) : 0;
    const next = current + 1;
    tx.set(counterRef, { lastTicketNumber: next }, { merge: true });
    return next;
  });

  const bookingData = {
    ticketNumber,
    status: 'New' as BookingStatus,
    customerName,
    customerPhone: customerPhone || '',
    vehicle: {
      make: vehicleMake || '',
      model: vehicleModel || '',
      color: vehicleColor || '',
      plate: vehiclePlate,
      photoUrl: '',
    },
    flightNumber: flightNumber || '',
    notes: notes || '',
    spotId: '',
    locationId: '',
    keysHandedOff: false,
    payment: { method: '', amount: 0, status: 'pending' },
    history: [
      {
        status: 'New',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        userId: auth.uid,
        note: 'Booking created',
      },
    ],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: auth.uid,
  };

  const docRef = await db.collection('companies').doc(companyId).collection('bookings').add(bookingData);

  return { id: docRef.id, ticketNumber };
});

// ─── Booking: Transition Status ──────────────────────────────────────

export const transitionBooking = functions.https.onCall(async (data, context) => {
  const auth = assertRole(context, ['admin', 'operator']);
  const companyId = getCompanyId(context);

  const { bookingId, newStatus, note } = data;

  if (!bookingId || !newStatus) {
    throw new functions.https.HttpsError('invalid-argument', 'bookingId and newStatus are required.');
  }

  const ref = bookingRef(companyId, bookingId);

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) {
      throw new functions.https.HttpsError('not-found', 'Booking not found.');
    }

    const current = doc.data()!['status'] as BookingStatus;
    const allowed = VALID_TRANSITIONS[current];

    if (!allowed || !allowed.includes(newStatus as BookingStatus)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Cannot transition from ${current} to ${newStatus}. Allowed: ${allowed?.join(', ') || 'none'}`
      );
    }

    tx.update(ref, {
      status: newStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      history: admin.firestore.FieldValue.arrayUnion({
        status: newStatus,
        timestamp: new Date().toISOString(),
        userId: auth.uid,
        note: note || `Status changed to ${newStatus}`,
      }),
    });
  });

  return { success: true };
});

// ─── Booking: Assign Spot ────────────────────────────────────────────

export const assignSpot = functions.https.onCall(async (data, context) => {
  const auth = assertRole(context, ['admin', 'operator']);
  const companyId = getCompanyId(context);

  const { bookingId, locationId, spotId } = data;

  if (!bookingId || !locationId || !spotId) {
    throw new functions.https.HttpsError('invalid-argument', 'bookingId, locationId, and spotId required.');
  }

  const bRef = bookingRef(companyId, bookingId);
  const sRef = spotRef(companyId, locationId, spotId);

  await db.runTransaction(async (tx) => {
    const [bDoc, sDoc] = await Promise.all([tx.get(bRef), tx.get(sRef)]);

    if (!bDoc.exists) throw new functions.https.HttpsError('not-found', 'Booking not found.');
    if (!sDoc.exists) throw new functions.https.HttpsError('not-found', 'Spot not found.');

    const spot = sDoc.data()!;
    if (spot['status'] === 'occupied' && spot['bookingId'] !== bookingId) {
      throw new functions.https.HttpsError('failed-precondition', 'Spot is already occupied.');
    }

    // If spot was locked by someone else, reject
    if (spot['lockedBy'] && spot['lockedBy'] !== auth.uid) {
      const lockTime = spot['lockedAt']?.toDate?.() || new Date(0);
      const elapsed = Date.now() - lockTime.getTime();
      if (elapsed < 30_000) {
        throw new functions.https.HttpsError('failed-precondition', 'Spot is locked by another operator.');
      }
    }

    tx.update(sRef, {
      status: 'occupied',
      bookingId,
      lockedBy: null,
      lockedAt: null,
    });

    tx.update(bRef, {
      spotId,
      locationId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true };
});

// ─── Booking: Checkout / Complete ────────────────────────────────────

export const completeBooking = functions.https.onCall(async (data, context) => {
  const auth = assertRole(context, ['admin', 'operator']);
  const companyId = getCompanyId(context);

  const { bookingId, paymentMethod, paymentAmount } = data;

  if (!bookingId) {
    throw new functions.https.HttpsError('invalid-argument', 'bookingId is required.');
  }

  const bRef = bookingRef(companyId, bookingId);

  await db.runTransaction(async (tx) => {
    const bDoc = await tx.get(bRef);
    if (!bDoc.exists) throw new functions.https.HttpsError('not-found', 'Booking not found.');

    const bData = bDoc.data()!;

    if (bData['status'] !== 'Active') {
      throw new functions.https.HttpsError('failed-precondition', 'Only Active bookings can be completed.');
    }

    // Free the parking spot
    if (bData['spotId'] && bData['locationId']) {
      const sRef = spotRef(companyId, bData['locationId'], bData['spotId']);
      tx.update(sRef, { status: 'available', bookingId: null, lockedBy: null, lockedAt: null });
    }

    tx.update(bRef, {
      status: 'Completed',
      payment: {
        method: paymentMethod || 'cash',
        amount: paymentAmount || 0,
        status: 'paid',
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      history: admin.firestore.FieldValue.arrayUnion({
        status: 'Completed',
        timestamp: new Date().toISOString(),
        userId: auth.uid,
        note: `Completed — $${paymentAmount || 0} via ${paymentMethod || 'cash'}`,
      }),
    });

    // Update daily stats
    const today = new Date().toISOString().split('T')[0];
    const statsRef = db.collection('companies').doc(companyId).collection('stats').doc(today);
    tx.set(
      statsRef,
      {
        completedCount: admin.firestore.FieldValue.increment(1),
        totalRevenue: admin.firestore.FieldValue.increment(paymentAmount || 0),
      },
      { merge: true }
    );
  });

  return { success: true };
});

// ─── Parking: Lock Spot ──────────────────────────────────────────────

export const lockSpot = functions.https.onCall(async (data, context) => {
  const auth = assertAuth(context);
  const companyId = getCompanyId(context);

  const { locationId, spotId } = data;

  if (!locationId || !spotId) {
    throw new functions.https.HttpsError('invalid-argument', 'locationId and spotId required.');
  }

  const sRef = spotRef(companyId, locationId, spotId);

  await db.runTransaction(async (tx) => {
    const sDoc = await tx.get(sRef);
    if (!sDoc.exists) throw new functions.https.HttpsError('not-found', 'Spot not found.');

    const spot = sDoc.data()!;
    if (spot['status'] === 'occupied') {
      throw new functions.https.HttpsError('failed-precondition', 'Spot is occupied.');
    }

    // Allow re-lock if lock expired (30 s TTL)
    if (spot['lockedBy'] && spot['lockedBy'] !== auth.uid) {
      const lockTime = spot['lockedAt']?.toDate?.() || new Date(0);
      if (Date.now() - lockTime.getTime() < 30_000) {
        throw new functions.https.HttpsError('failed-precondition', 'Spot locked by another operator.');
      }
    }

    tx.update(sRef, {
      lockedBy: auth.uid,
      lockedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true };
});

// ─── Parking: Release Spot Lock ──────────────────────────────────────

export const releaseSpot = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const companyId = getCompanyId(context);

  const { locationId, spotId } = data;

  const sRef = spotRef(companyId, locationId, spotId);
  await sRef.update({ lockedBy: null, lockedAt: null });

  return { success: true };
});

// ─── Booking: Cancel ─────────────────────────────────────────────────

export const cancelBooking = functions.https.onCall(async (data, context) => {
  const auth = assertRole(context, ['admin', 'operator']);
  const companyId = getCompanyId(context);

  const { bookingId, reason } = data;

  if (!bookingId) {
    throw new functions.https.HttpsError('invalid-argument', 'bookingId is required.');
  }

  const bRef = bookingRef(companyId, bookingId);

  await db.runTransaction(async (tx) => {
    const bDoc = await tx.get(bRef);
    if (!bDoc.exists) throw new functions.https.HttpsError('not-found', 'Booking not found.');

    const bData = bDoc.data()!;
    const current = bData['status'] as BookingStatus;
    const allowed = VALID_TRANSITIONS[current];

    if (!allowed || !allowed.includes('Cancelled')) {
      throw new functions.https.HttpsError('failed-precondition', `Cannot cancel a ${current} booking.`);
    }

    // Free spot if assigned
    if (bData['spotId'] && bData['locationId']) {
      const sRef = spotRef(companyId, bData['locationId'], bData['spotId']);
      tx.update(sRef, { status: 'available', bookingId: null, lockedBy: null, lockedAt: null });
    }

    tx.update(bRef, {
      status: 'Cancelled',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      history: admin.firestore.FieldValue.arrayUnion({
        status: 'Cancelled',
        timestamp: new Date().toISOString(),
        userId: auth.uid,
        note: reason || 'Booking cancelled',
      }),
    });
  });

  return { success: true };
});

// ─── Flight Status Proxy ─────────────────────────────────────────────
// Keeps FlightStats API key server-side

export const getFlightStatus = functions.https.onCall(async (data, context) => {
  assertAuth(context);

  const { carrier, flightNumber, date } = data;

  if (!carrier || !flightNumber || !date) {
    throw new functions.https.HttpsError('invalid-argument', 'carrier, flightNumber, and date are required.');
  }

  const appId = functions.config().flightstats?.app_id;
  const appKey = functions.config().flightstats?.app_key;

  if (!appId || !appKey) {
    throw new functions.https.HttpsError('unavailable', 'Flight tracking not configured.');
  }

  const [year, month, day] = date.split('-');

  try {
    const url = `https://api.flightstats.com/flex/flightstatus/rest/v2/json/flight/status/${carrier}/${flightNumber}/arr/${year}/${month}/${day}?appId=${appId}&appKey=${appKey}&utc=false`;

    const response = await axios.get(url, { timeout: 10_000 });

    const flight = response.data?.flightStatuses?.[0];
    if (!flight) {
      return { found: false };
    }

    return {
      found: true,
      status: flight.status,
      departureAirport: flight.departureAirportFsCode,
      arrivalAirport: flight.arrivalAirportFsCode,
      scheduledArrival: flight.operationalTimes?.scheduledGateArrival?.dateLocal,
      estimatedArrival: flight.operationalTimes?.estimatedGateArrival?.dateLocal,
      actualArrival: flight.operationalTimes?.actualGateArrival?.dateLocal,
      delay: flight.delays?.arrivalGateDelayMinutes || 0,
    };
  } catch (err: any) {
    functions.logger.error('FlightStats API error', err.message);
    throw new functions.https.HttpsError('internal', 'Failed to fetch flight data.');
  }
});

// ─── Admin: Set User Role ────────────────────────────────────────────

export const setUserRole = functions.https.onCall(async (data, context) => {
  assertRole(context, ['admin']);
  const companyId = getCompanyId(context);

  const { userId, role } = data;

  if (!userId || !['admin', 'operator', 'viewer'].includes(role)) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid userId and role required.');
  }

  await admin.auth().setCustomUserClaims(userId, { role, companyId });

  // Also update the user doc
  await db.collection('users').doc(userId).set({ role, companyId }, { merge: true });

  return { success: true };
});

// ─── Firestore Trigger: Auto-notify on New booking ───────────────────

export const onBookingCreated = functions.firestore
  .document('companies/{companyId}/bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const companyId = context.params.companyId;

    // Write a notification to the company's notification subcollection
    await db.collection('companies').doc(companyId).collection('notifications').add({
      type: 'new-booking',
      title: `New Ticket #${data.ticketNumber}`,
      body: `${data.customerName} — ${data.vehicle?.plate || 'No plate'}`,
      bookingId: context.params.bookingId,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

// ─── Scheduled: Clean up expired spot locks (every 5 min) ────────────

export const cleanupExpiredLocks = functions.pubsub.schedule('every 5 minutes').onRun(async () => {
  const companiesSnap = await db.collection('companies').get();
  const cutoff = new Date(Date.now() - 60_000); // 1 min TTL for cleanup

  for (const companyDoc of companiesSnap.docs) {
    const locationsSnap = await companyDoc.ref.collection('locations').get();

    for (const locationDoc of locationsSnap.docs) {
      const spotsSnap = await locationDoc.ref
        .collection('spots')
        .where('lockedAt', '<', cutoff)
        .get();

      const batch = db.batch();
      spotsSnap.docs.forEach((spotDoc) => {
        batch.update(spotDoc.ref, { lockedBy: null, lockedAt: null });
      });

      if (!spotsSnap.empty) {
        await batch.commit();
        functions.logger.info(`Cleaned ${spotsSnap.size} expired locks in ${companyDoc.id}/${locationDoc.id}`);
      }
    }
  }
});
