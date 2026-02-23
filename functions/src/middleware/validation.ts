/**
 * Tez — Zod Validation Middleware
 *
 * Validates incoming callable data against Zod schemas.
 * Returns clean, typed, sanitized data or throws HttpsError.
 */

import * as functions from 'firebase-functions';
import { z } from 'zod';

/**
 * Validate incoming request data against a Zod schema.
 * Returns the parsed + sanitized result or throws a detailed error.
 */
export function validate<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  try {
    return schema.parse(data ?? {});
  } catch (err) {
    if (err instanceof z.ZodError) {
      const messages = err.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`).join('; ');
      throw new functions.https.HttpsError('invalid-argument', `Validation failed: ${messages}`);
    }
    throw new functions.https.HttpsError('invalid-argument', 'Invalid request data.');
  }
}
