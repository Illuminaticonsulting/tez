/**
 * Tez — Parking Service (Cloud Functions)
 *
 * Spot management: assign, lock, release.
 * Features:
 * - Ownership checks on release (#8 fix)
 * - Zod validation on all inputs
 * - Audit logging
 * - Correlation IDs
 */

import {
  functions,
  admin,
  db,
  bookingRef,
  spotRef,
  STANDARD_OPTIONS,
  SPOT_LOCK_TIMEOUT_MS,
} from '../config';
import {
  assertAuth,
  assertRole,
  checkRateLimit,
  validate,
  generateCorrelationId,
  logInfo,
  logWarn,
  writeAuditLog,
} from '../middleware';
import { AssignSpotSchema, LockSpotSchema, ReleaseSpotSchema, type SuccessResponse } from '../types';

// ─── Assign Spot to Booking ──────────────────────────────────────────

export const assignSpot = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<SuccessResponse> => {
    const correlationId = generateCorrelationId();
    const auth = assertRole(context, ['admin', 'operator']);
    await checkRateLimit(auth.uid);

    const input = validate(AssignSpotSchema, data);
    const ctx = { correlationId, uid: auth.uid, companyId: auth.companyId, operation: 'assignSpot' };

    logInfo(ctx, 'Assigning spot', { bookingId: input.bookingId, spotId: input.spotId });

    const bRef = bookingRef(auth.companyId, input.bookingId);
    const sRef = spotRef(auth.companyId, input.locationId, input.spotId);

    await db.runTransaction(async (tx) => {
      const [bDoc, sDoc] = await Promise.all([tx.get(bRef), tx.get(sRef)]);
      if (!bDoc.exists) throw new functions.https.HttpsError('not-found', 'Booking not found.');
      if (!sDoc.exists) throw new functions.https.HttpsError('not-found', 'Spot not found.');

      const spot = sDoc.data()!;
      if (spot['status'] === 'occupied' && spot['bookingId'] !== input.bookingId) {
        throw new functions.https.HttpsError('failed-precondition', 'Spot is already occupied.');
      }
      if (spot['lockedBy'] && spot['lockedBy'] !== auth.uid) {
        const lockTime = spot['lockedAt']?.toDate?.() || new Date(0);
        if (Date.now() - lockTime.getTime() < SPOT_LOCK_TIMEOUT_MS) {
          throw new functions.https.HttpsError('failed-precondition', 'Spot is locked by another operator.');
        }
      }

      tx.update(sRef, { status: 'occupied', bookingId: input.bookingId, lockedBy: null, lockedAt: null });
      tx.update(bRef, {
        spotId: input.spotId,
        locationId: input.locationId,
        spotName: spot['name'] || input.spotId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    await writeAuditLog(db, auth.companyId, {
      action: 'spot.assign',
      uid: auth.uid,
      resourceType: 'spot',
      resourceId: `${input.locationId}/${input.spotId}`,
      details: { bookingId: input.bookingId },
      correlationId,
    });

    logInfo(ctx, 'Spot assigned', { bookingId: input.bookingId, spotId: input.spotId });
    return { success: true };
  });

// ─── Lock Spot ───────────────────────────────────────────────────────

export const lockSpot = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<SuccessResponse> => {
    const correlationId = generateCorrelationId();
    const authData = assertAuth(context);
    await checkRateLimit(authData.uid);

    const input = validate(LockSpotSchema, data);
    // Need companyId from token
    const companyId = authData.token['companyId'] as string;
    if (!companyId) throw new functions.https.HttpsError('failed-precondition', 'No company assigned.');

    const ctx = { correlationId, uid: authData.uid, companyId, operation: 'lockSpot' };
    logInfo(ctx, 'Locking spot', { spotId: input.spotId });

    const sRef = spotRef(companyId, input.locationId, input.spotId);
    await db.runTransaction(async (tx) => {
      const sDoc = await tx.get(sRef);
      if (!sDoc.exists) throw new functions.https.HttpsError('not-found', 'Spot not found.');
      const spot = sDoc.data()!;

      if (spot['status'] === 'occupied') {
        throw new functions.https.HttpsError('failed-precondition', 'Spot is occupied.');
      }
      if (spot['lockedBy'] && spot['lockedBy'] !== authData.uid) {
        const lockTime = spot['lockedAt']?.toDate?.() || new Date(0);
        if (Date.now() - lockTime.getTime() < SPOT_LOCK_TIMEOUT_MS) {
          throw new functions.https.HttpsError('failed-precondition', 'Spot locked by another operator.');
        }
      }

      tx.update(sRef, {
        lockedBy: authData.uid,
        lockedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    logInfo(ctx, 'Spot locked', { spotId: input.spotId });
    return { success: true };
  });

// ─── Release Spot (with ownership check — Fix #8) ───────────────────

export const releaseSpot = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<SuccessResponse> => {
    const correlationId = generateCorrelationId();
    const authData = assertAuth(context);
    const companyId = authData.token['companyId'] as string;
    if (!companyId) throw new functions.https.HttpsError('failed-precondition', 'No company assigned.');

    const input = validate(ReleaseSpotSchema, data);
    const ctx = { correlationId, uid: authData.uid, companyId, operation: 'releaseSpot' };

    const sRef = spotRef(companyId, input.locationId, input.spotId);

    // Ownership check: only the user who locked it (or an admin) can release
    const sDoc = await sRef.get();
    if (!sDoc.exists) throw new functions.https.HttpsError('not-found', 'Spot not found.');

    const spot = sDoc.data()!;
    const role = authData.token['role'] as string;
    if (spot['lockedBy'] && spot['lockedBy'] !== authData.uid && role !== 'admin') {
      logWarn(ctx, 'Unauthorized release attempt', {
        lockedBy: spot['lockedBy'],
        attemptedBy: authData.uid,
      });
      throw new functions.https.HttpsError('permission-denied', 'Only the lock owner or an admin can release this spot.');
    }

    await sRef.update({ lockedBy: null, lockedAt: null });

    logInfo(ctx, 'Spot released', { spotId: input.spotId });
    return { success: true };
  });
