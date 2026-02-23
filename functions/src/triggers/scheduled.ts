/**
 * Tez — Scheduled Jobs
 *
 * - cleanupExpiredLocks: removes stale spot locks (every 5 minutes)
 * - cleanupExpiredIdempotency: removes old idempotency keys (daily)
 * - cleanupExpiredRateLimits: removes stale rate limit docs (hourly)
 * - cleanupFlightCache: removes old flight cache entries (hourly)
 * - dailyStatsRollup: aggregates daily stats into monthly summaries
 */

import { functions, admin, db, SCHEDULED_OPTIONS, LOCK_CLEANUP_INTERVAL_MS } from '../config';

// ─── Cleanup Expired Spot Locks ──────────────────────────────────────

export const cleanupExpiredLocks = functions
  .runWith(SCHEDULED_OPTIONS)
  .pubsub.schedule('every 5 minutes')
  .onRun(async () => {
    const cutoff = new Date(Date.now() - LOCK_CLEANUP_INTERVAL_MS);

    // collectionGroup query — works across all companies
    const expiredSnap = await db
      .collectionGroup('spots')
      .where('lockedAt', '<', cutoff)
      .where('lockedBy', '!=', null)
      .get();

    if (expiredSnap.empty) return;

    const batches: admin.firestore.WriteBatch[] = [];
    let currentBatch = db.batch();
    let count = 0;

    for (const doc of expiredSnap.docs) {
      currentBatch.update(doc.ref, { lockedBy: null, lockedAt: null });
      count++;
      if (count % 500 === 0) {
        batches.push(currentBatch);
        currentBatch = db.batch();
      }
    }
    batches.push(currentBatch);
    await Promise.all(batches.map((b) => b.commit()));
    functions.logger.info(`Cleaned ${count} expired spot locks`);
  });

// ─── Cleanup Expired Idempotency Keys ───────────────────────────────

export const cleanupExpiredIdempotency = functions
  .runWith(SCHEDULED_OPTIONS)
  .pubsub.schedule('every 24 hours')
  .onRun(async () => {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours

    const expiredSnap = await db
      .collectionGroup('_idempotency')
      .where('expiresAt', '<', cutoff)
      .get();

    if (expiredSnap.empty) return;

    const batches: admin.firestore.WriteBatch[] = [];
    let currentBatch = db.batch();
    let count = 0;

    for (const doc of expiredSnap.docs) {
      currentBatch.delete(doc.ref);
      count++;
      if (count % 500 === 0) {
        batches.push(currentBatch);
        currentBatch = db.batch();
      }
    }
    batches.push(currentBatch);
    await Promise.all(batches.map((b) => b.commit()));
    functions.logger.info(`Cleaned ${count} expired idempotency keys`);
  });

// ─── Cleanup Expired Rate Limits ─────────────────────────────────────

export const cleanupExpiredRateLimits = functions
  .runWith(SCHEDULED_OPTIONS)
  .pubsub.schedule('every 1 hours')
  .onRun(async () => {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 min old

    const expiredSnap = await db
      .collection('_rateLimits')
      .where('expiresAt', '<', cutoff)
      .get();

    if (expiredSnap.empty) return;

    const batches: admin.firestore.WriteBatch[] = [];
    let currentBatch = db.batch();
    let count = 0;

    for (const doc of expiredSnap.docs) {
      currentBatch.delete(doc.ref);
      count++;
      if (count % 500 === 0) {
        batches.push(currentBatch);
        currentBatch = db.batch();
      }
    }
    batches.push(currentBatch);
    await Promise.all(batches.map((b) => b.commit()));
    functions.logger.info(`Cleaned ${count} expired rate limit entries`);
  });

// ─── Cleanup Flight Cache ────────────────────────────────────────────

export const cleanupFlightCache = functions
  .runWith(SCHEDULED_OPTIONS)
  .pubsub.schedule('every 1 hours')
  .onRun(async () => {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour old

    const expiredSnap = await db
      .collection('_flightCache')
      .where('expiresAt', '<', cutoff)
      .get();

    if (expiredSnap.empty) return;

    const batch = db.batch();
    let count = 0;
    for (const doc of expiredSnap.docs) {
      batch.delete(doc.ref);
      count++;
    }
    await batch.commit();
    functions.logger.info(`Cleaned ${count} expired flight cache entries`);
  });

// ─── Daily Stats Rollup ─────────────────────────────────────────────

export const dailyStatsRollup = functions
  .runWith(SCHEDULED_OPTIONS)
  .pubsub.schedule('every day 02:00')
  .timeZone('America/New_York')
  .onRun(async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0]!;
    const monthStr = dateStr.substring(0, 7); // YYYY-MM

    // Get all companies
    const companiesSnap = await db.collection('companies').get();

    for (const companyDoc of companiesSnap.docs) {
      const statsDoc = await companyDoc.ref.collection('stats').doc(dateStr).get();
      if (!statsDoc.exists) continue;

      const dayStats = statsDoc.data()!;

      // Roll up into monthly summary
      await companyDoc.ref
        .collection('stats')
        .doc(`monthly_${monthStr}`)
        .set(
          {
            completedCount: admin.firestore.FieldValue.increment(dayStats['completedCount'] || 0),
            totalRevenue: admin.firestore.FieldValue.increment(dayStats['totalRevenue'] || 0),
            newBookingCount: admin.firestore.FieldValue.increment(dayStats['newBookingCount'] || 0),
            daysIncluded: admin.firestore.FieldValue.increment(1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
    }

    functions.logger.info(`Daily stats rollup completed for ${dateStr}`);
  });
