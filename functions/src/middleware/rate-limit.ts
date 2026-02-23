/**
 * Tez — Firestore-Backed Rate Limiting
 *
 * Uses Firestore to persist rate limit counters so they survive
 * cold starts and are shared across Cloud Function instances.
 *
 * Falls back to in-memory check for low-latency first pass,
 * then validates against Firestore for accuracy.
 */

import * as functions from 'firebase-functions';
import { db, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX } from '../config';

// In-memory first-pass (fast, per-instance)
const localMap = new Map<string, { count: number; windowStart: number }>();

/**
 * Check rate limit for a user.
 * Uses in-memory cache first, then Firestore for cross-instance accuracy.
 */
export async function checkRateLimit(uid: string): Promise<void> {
  // Fast in-memory check first
  const now = Date.now();
  const local = localMap.get(uid);
  if (local && now - local.windowStart < RATE_LIMIT_WINDOW_MS) {
    local.count++;
    if (local.count > RATE_LIMIT_MAX) {
      throw new functions.https.HttpsError('resource-exhausted', 'Too many requests. Please slow down.');
    }
  } else {
    localMap.set(uid, { count: 1, windowStart: now });
  }

  // Firestore cross-instance check (async, non-blocking for normal load)
  const ref = db.collection('_rateLimits').doc(uid);
  try {
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const data = doc.data();
      const windowStart = data?.windowStart?.toMillis?.() ?? 0;

      if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
        // New window
        tx.set(ref, {
          count: 1,
          windowStart: new Date(now),
          expiresAt: new Date(now + RATE_LIMIT_WINDOW_MS * 2), // For TTL cleanup
        });
      } else {
        const count = (data?.count ?? 0) + 1;
        if (count > RATE_LIMIT_MAX) {
          throw new functions.https.HttpsError('resource-exhausted', 'Too many requests. Please slow down.');
        }
        tx.update(ref, { count });
      }
    });
  } catch (err) {
    // Re-throw rate limit errors, swallow Firestore transient errors
    if (err instanceof functions.https.HttpsError) throw err;
    functions.logger.warn('Rate limit Firestore check failed, relying on in-memory', { uid });
  }
}

/**
 * Synchronous in-memory-only rate limit (for use in tight loops).
 * Less accurate but zero-latency.
 */
export function checkRateLimitSync(uid: string): void {
  const now = Date.now();
  const entry = localMap.get(uid);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    localMap.set(uid, { count: 1, windowStart: now });
    return;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    throw new functions.https.HttpsError('resource-exhausted', 'Too many requests. Please slow down.');
  }
}
