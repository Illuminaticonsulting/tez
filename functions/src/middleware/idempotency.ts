/**
 * Tez — Idempotency Middleware
 *
 * Prevents duplicate operations (e.g., double-creating a booking)
 * by tracking idempotency keys in Firestore with TTL.
 */

import * as functions from 'firebase-functions';
import { db } from '../config';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if an operation with this idempotency key has already been processed.
 * Returns the cached result if it exists, or null if this is a new operation.
 */
export async function checkIdempotency(
  companyId: string,
  key: string | undefined,
): Promise<Record<string, unknown> | null> {
  if (!key) return null;

  const ref = db.collection('companies').doc(companyId).collection('_idempotency').doc(key);
  const doc = await ref.get();

  if (doc.exists) {
    const data = doc.data()!;
    const createdAt = data['createdAt']?.toMillis?.() ?? 0;
    if (Date.now() - createdAt < IDEMPOTENCY_TTL_MS) {
      functions.logger.info('Idempotency key hit — returning cached result', { companyId, key });
      return data['result'] as Record<string, unknown>;
    }
  }

  return null;
}

/**
 * Store the result of a successful operation with its idempotency key.
 */
export async function saveIdempotency(
  companyId: string,
  key: string | undefined,
  result: Record<string, unknown>,
): Promise<void> {
  if (!key) return;

  const ref = db.collection('companies').doc(companyId).collection('_idempotency').doc(key);
  await ref.set({
    result,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
  });
}
