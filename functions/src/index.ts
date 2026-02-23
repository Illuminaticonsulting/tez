/**
 * Tez — Cloud Functions v2
 *
 * All booking mutations, parking ops, and external API proxies.
 * Client never writes directly to Firestore.
 *
 * Fixes applied:
 * #5  — Active → Cancelled transition allowed
 * #7  — Rate limiting via per-user write tracking
 * #8  — Input sanitization (XSS, length limits)
 * #9  — setUserRole validates target user belongs to same company
 * #48 — Scalable cleanupExpiredLocks with collectionGroup
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

admin.initializeApp();

const db = admin.firestore();

// ─── Types ───────────────────────────────────────────────────────────

type BookingStatus = 'New' | 'Booked' | 'Check-In' | 'Parked' | 'Active' | 'Completed' | 'Cancelled';

/** #5 fix — Active can now transition to Cancelled */
const VALID_TRANSITIONS: Record<string, BookingStatus[]> = {
  New: ['Booked', 'Cancelled'],
  Booked: ['Check-In', 'Cancelled'],
  'Check-In': ['Parked', 'Cancelled'],
  Parked: ['Active', 'Cancelled'],
  Active: ['Completed', 'Cancelled'],
};

// ─── Input Sanitization (#8) ─────────────────────────────────────────

function sanitize(input: unknown, maxLength = 500): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[<>]/g, '')
    .replace(/&(?!amp;|lt;|gt;|quot;)/g, '&amp;')
    .trim()
    .slice(0, maxLength);
}

function sanitizePlate(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[^a-zA-Z0-9\- ]/g, '').trim().slice(0, 20).toUpperCase();
}

function sanitizePhone(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[^0-9+\-() ]/g, '').trim().slice(0, 20);
}

// ─── Rate Limiting (#7) ──────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(uid: string): void {
  const now = Date.now();
  const entry = rateLimitMap.get(uid);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(uid, { count: 1, windowStart: now });
    return;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many requests. Please slow down.');
  }
}

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
  checkRateLimit(auth.uid);
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
  return db.collection('companies').doc(companyId).collection('locations').doc(locationId).collection('spots').doc(spotId);
}

// ─── Booking: Create ─────────────────────────────────────────────────

export const createBooking = functions.https.onCall(async (data, context) => {
  const auth = assertRole(context, ['admin', 'operator']);
  const companyId = getCompanyId(context);

  const customerName = sanitize(data.customerName, 100);
  const customerPhone = sanitizePhone(data.customerPhone);
  const vehiclePlate = sanitizePlate(data.vehiclePlate);
  const vehicleMake = sanitize(data.vehicleMake, 50);
  const vehicleModel = sanitize(data.vehicleModel, 50);
  const vehicleColor = sanitize(data.vehicleColor, 30);
  const flightNumber = sanitize(data.flightNumber, 20);
  const notes = sanitize(data.notes, 1000);

  if (!customerName || !vehiclePlate) {
    throw new functions.https.HttpsError('invalid-argument', 'customerName and vehiclePlate are required.');
  }

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
    customerPhone,
    vehicle: { make: vehicleMake, model: vehicleModel, color: vehicleColor, plate: vehiclePlate, photoUrl: '' },
    flightNumber,
    notes,
    spotId: '',
    locationId: '',
    keysHandedOff: false,
    payment: { method: '', amount: 0, status: 'pending' },
    history: [{
      status: 'New',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userId: auth.uid,
      note: 'Booking created',
    }],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: auth.uid,
  };

  const docRef = await db.collection('companies').doc(companyId).collection('bookings').add(bookingData);
  return { id: docRef.id, ticketNumber };
});

// ─── Booking: Transition ─────────────────────────────────────────────

export const transitionBooking = functions.https.onCall(async (data, context) => {
  const auth = assertRole(context, ['admin', 'operator']);
  const companyId = getCompanyId(context);

  const bookingId = sanitize(data.bookingId, 100);
  const newStatus = sanitize(data.newStatus, 20);
  const note = sanitize(data.note, 500);

  if (!bookingId || !newStatus) {
    throw new functions.https.HttpsError('invalid-argument', 'bookingId and newStatus are required.');
  }

  const ref = bookingRef(companyId, bookingId);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new functions.https.HttpsError('not-found', 'Booking not found.');

    const current = doc.data()!['status'] as BookingStatus;
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed || !allowed.includes(newStatus as BookingStatus)) {
      throw new functions.https.HttpsError('failed-precondition', `Cannot transition from ${current} to ${newStatus}. Allowed: ${allowed?.join(', ') || 'none'}`);
    }

    const updates: Record<string, unknown> = {
      status: newStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      history: admin.firestore.FieldValue.arrayUnion({
        status: newStatus, timestamp: new Date().toISOString(), userId: auth.uid, note: note || `Status changed to ${newStatus}`,
      }),
    };

    if (newStatus === 'Cancelled') {
      const bData = doc.data()!;
      if (bData['spotId'] && bData['locationId']) {
        tx.update(spotRef(companyId, bData['locationId'], bData['spotId']), { status: 'available', bookingId: null, lockedBy: null, lockedAt: null });
      }
    }

    tx.update(ref, updates);
  });

  return { success: true };
});

// ─── Booking: Assign Spot ────────────────────────────────────────────

export const assignSpot = functions.https.onCall(async (data, context) => {
  const auth = assertRole(context, ['admin', 'operator']);
  const companyId = getCompanyId(context);

  const bookingId = sanitize(data.bookingId, 100);
  const locationId = sanitize(data.locationId, 100);
  const spotId = sanitize(data.spotId, 100);

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
    if (spot['lockedBy'] && spot['lockedBy'] !== auth.uid) {
      const lockTime = spot['lockedAt']?.toDate?.() || new Date(0);
      if (Date.now() - lockTime.getTime() < 30_000) {
        throw new functions.https.HttpsError('failed-precondition', 'Spot is locked by another operator.');
      }
    }

    tx.update(sRef, { status: 'occupied', bookingId, lockedBy: null, lockedAt: null });
    tx.update(bRef, { spotId, locationId, spotName: spot['name'] || spotId, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });

  return { success: true };
});

// ─── Booking: Complete ───────────────────────────────────────────────

export const completeBooking = functions.https.onCall(async (data, context) => {
  const auth = assertRole(context, ['admin', 'operator']);
  const companyId = getCompanyId(context);

  const bookingId = sanitize(data.bookingId, 100);
  const paymentMethod = sanitize(data.paymentMethod, 30) || 'cash';
  const paymentAmount = typeof data.paymentAmount === 'number' ? Math.max(0, data.paymentAmount) : 0;

  if (!bookingId) throw new functions.https.HttpsError('invalid-argument', 'bookingId is required.');

  const bRef = bookingRef(companyId, bookingId);
  await db.runTransaction(async (tx) => {
    const bDoc = await tx.get(bRef);
    if (!bDoc.exists) throw new functions.https.HttpsError('not-found', 'Booking not found.');
    const bData = bDoc.data()!;
    if (bData['status'] !== 'Active') throw new functions.https.HttpsError('failed-precondition', 'Only Active bookings can be completed.');

    if (bData['spotId'] && bData['locationId']) {
      tx.update(spotRef(companyId, bData['locationId'], bData['spotId']), { status: 'available', bookingId: null, lockedBy: null, lockedAt: null });
    }

    tx.update(bRef, {
      status: 'Completed',
      payment: { method: paymentMethod, amount: paymentAmount, status: 'paid' },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      history: admin.firestore.FieldValue.arrayUnion({ status: 'Completed', timestamp: new Date().toISOString(), userId: auth.uid, note: `Completed — $${paymentAmount} via ${paymentMethod}` }),
    });

    const today = new Date().toISOString().split('T')[0];
    tx.set(db.collection('companies').doc(companyId).collection('stats').doc(today), {
      completedCount: admin.firestore.FieldValue.increment(1),
      totalRevenue: admin.firestore.FieldValue.increment(paymentAmount),
    }, { merge: true });
  });

  return { success: true };
});

// ─── Parking: Lock Spot ──────────────────────────────────────────────

export const lockSpot = functions.https.onCall(async (data, context) => {
  const auth = assertAuth(context);
  checkRateLimit(auth.uid);
  const companyId = getCompanyId(context);
  const locationId = sanitize(data.locationId, 100);
  const spotId = sanitize(data.spotId, 100);

  if (!locationId || !spotId) throw new functions.https.HttpsError('invalid-argument', 'locationId and spotId required.');

  const sRef = spotRef(companyId, locationId, spotId);
  await db.runTransaction(async (tx) => {
    const sDoc = await tx.get(sRef);
    if (!sDoc.exists) throw new functions.https.HttpsError('not-found', 'Spot not found.');
    const spot = sDoc.data()!;
    if (spot['status'] === 'occupied') throw new functions.https.HttpsError('failed-precondition', 'Spot is occupied.');
    if (spot['lockedBy'] && spot['lockedBy'] !== auth.uid) {
      const lockTime = spot['lockedAt']?.toDate?.() || new Date(0);
      if (Date.now() - lockTime.getTime() < 30_000) {
        throw new functions.https.HttpsError('failed-precondition', 'Spot locked by another operator.');
      }
    }
    tx.update(sRef, { lockedBy: auth.uid, lockedAt: admin.firestore.FieldValue.serverTimestamp() });
  });

  return { success: true };
});

// ─── Parking: Release Lock ───────────────────────────────────────────

export const releaseSpot = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const companyId = getCompanyId(context);
  const sRef = spotRef(companyId, sanitize(data.locationId, 100), sanitize(data.spotId, 100));
  await sRef.update({ lockedBy: null, lockedAt: null });
  return { success: true };
});

// ─── Booking: Cancel ─────────────────────────────────────────────────

export const cancelBooking = functions.https.onCall(async (data, context) => {
  const auth = assertRole(context, ['admin', 'operator']);
  const companyId = getCompanyId(context);
  const bookingId = sanitize(data.bookingId, 100);
  const reason = sanitize(data.reason, 500);

  if (!bookingId) throw new functions.https.HttpsError('invalid-argument', 'bookingId is required.');

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
    if (bData['spotId'] && bData['locationId']) {
      tx.update(spotRef(companyId, bData['locationId'], bData['spotId']), { status: 'available', bookingId: null, lockedBy: null, lockedAt: null });
    }
    tx.update(bRef, {
      status: 'Cancelled',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      history: admin.firestore.FieldValue.arrayUnion({ status: 'Cancelled', timestamp: new Date().toISOString(), userId: auth.uid, note: reason || 'Booking cancelled' }),
    });
  });

  return { success: true };
});

// ─── Flight Lookup ───────────────────────────────────────────────────

export const lookupFlight = functions.https.onCall(async (data, context) => {
  assertAuth(context);
  const flightNumber = sanitize(data.flightNumber, 20);
  if (!flightNumber) throw new functions.https.HttpsError('invalid-argument', 'flightNumber is required.');

  const match = flightNumber.match(/^([A-Z]{2})(\d+)$/);
  if (!match) return { found: false, message: 'Invalid flight number format (e.g. AA123).' };

  const appId = functions.config().flightstats?.app_id;
  const appKey = functions.config().flightstats?.app_key;
  if (!appId || !appKey) throw new functions.https.HttpsError('unavailable', 'Flight tracking not configured.');

  const today = new Date();
  try {
    const url = `https://api.flightstats.com/flex/flightstatus/rest/v2/json/flight/status/${match[1]}/${match[2]}/arr/${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}?appId=${appId}&appKey=${appKey}&utc=false`;
    const response = await axios.get(url, { timeout: 10_000 });
    const flight = response.data?.flightStatuses?.[0];
    if (!flight) return { found: false };
    return {
      found: true, airline: match[1], flightNumber: match[2],
      status: flight.status === 'L' ? 'landed' : flight.status === 'A' ? 'en-route' : 'scheduled',
      scheduledArrival: flight.operationalTimes?.scheduledGateArrival?.dateLocal || '',
      estimatedArrival: flight.operationalTimes?.estimatedGateArrival?.dateLocal || '',
      delay: flight.delays?.arrivalGateDelayMinutes || 0,
      origin: flight.departureAirportFsCode || '',
      gate: flight.airportResources?.arrivalGate || '', terminal: flight.airportResources?.arrivalTerminal || '',
    };
  } catch (err: unknown) {
    functions.logger.error('FlightStats API error', err instanceof Error ? err.message : 'unknown');
    throw new functions.https.HttpsError('internal', 'Failed to fetch flight data.');
  }
});

// ─── Admin: Set User Role (#9) ───────────────────────────────────────

export const setUserRole = functions.https.onCall(async (data, context) => {
  assertRole(context, ['admin']);
  const companyId = getCompanyId(context);
  const userId = sanitize(data.userId, 100);
  const role = sanitize(data.role, 20);

  if (!userId || !['admin', 'operator', 'viewer'].includes(role)) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid userId and role required.');
  }

  // #9 — verify target user belongs to same company
  const targetUser = await admin.auth().getUser(userId);
  const targetCompany = targetUser.customClaims?.['companyId'] as string | undefined;
  if (targetCompany && targetCompany !== companyId) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot modify users from a different company.');
  }

  await admin.auth().setCustomUserClaims(userId, { role, companyId });
  await db.collection('users').doc(userId).set({ role, companyId }, { merge: true });
  return { success: true };
});

// ─── Trigger: Notify on New Booking ──────────────────────────────────

export const onBookingCreated = functions.firestore
  .document('companies/{companyId}/bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    await db.collection('companies').doc(context.params.companyId).collection('notifications').add({
      type: 'new-booking',
      title: `New Ticket #${data.ticketNumber}`,
      body: `${data.customerName} — ${data.vehicle?.plate || 'No plate'}`,
      bookingId: context.params.bookingId,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

// ─── Scheduled: Cleanup Expired Locks (#48) ──────────────────────────

export const cleanupExpiredLocks = functions.pubsub.schedule('every 5 minutes').onRun(async () => {
  const cutoff = new Date(Date.now() - 60_000);

  // #48 — collectionGroup query instead of nested iteration
  const expiredSnap = await db.collectionGroup('spots').where('lockedAt', '<', cutoff).where('lockedBy', '!=', null).get();

  if (expiredSnap.empty) return;

  const batches: admin.firestore.WriteBatch[] = [];
  let currentBatch = db.batch();
  let count = 0;

  for (const doc of expiredSnap.docs) {
    currentBatch.update(doc.ref, { lockedBy: null, lockedAt: null });
    count++;
    if (count % 500 === 0) { batches.push(currentBatch); currentBatch = db.batch(); }
  }
  batches.push(currentBatch);
  await Promise.all(batches.map(b => b.commit()));
  functions.logger.info(`Cleaned ${count} expired spot locks`);
});
