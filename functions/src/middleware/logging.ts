/**
 * Tez — Structured Logging with Correlation IDs
 *
 * Every request gets a unique correlationId for end-to-end traceability.
 * Logs are structured JSON for Cloud Logging integration.
 */

import * as functions from 'firebase-functions';
import * as crypto from 'crypto';

/**
 * Generate a unique correlation ID for request tracing.
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

export interface LogContext {
  correlationId: string;
  uid?: string;
  companyId?: string;
  operation: string;
}

/**
 * Structured info log with correlation context.
 */
export function logInfo(ctx: LogContext, message: string, data?: Record<string, unknown>): void {
  functions.logger.info(message, {
    ...ctx,
    ...data,
    severity: 'INFO',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Structured warning log.
 */
export function logWarn(ctx: LogContext, message: string, data?: Record<string, unknown>): void {
  functions.logger.warn(message, {
    ...ctx,
    ...data,
    severity: 'WARNING',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Structured error log with optional error object.
 */
export function logError(ctx: LogContext, message: string, error?: unknown, data?: Record<string, unknown>): void {
  functions.logger.error(message, {
    ...ctx,
    ...data,
    severity: 'ERROR',
    timestamp: new Date().toISOString(),
    errorMessage: error instanceof Error ? error.message : String(error ?? ''),
    errorStack: error instanceof Error ? error.stack : undefined,
  });
}

/**
 * Write an audit log entry to Firestore for compliance.
 */
export async function writeAuditLog(
  db: FirebaseFirestore.Firestore,
  companyId: string,
  entry: {
    action: string;
    uid: string;
    resourceType: string;
    resourceId: string;
    details?: Record<string, unknown>;
    correlationId: string;
  },
): Promise<void> {
  try {
    await db.collection('companies').doc(companyId).collection('audit').add({
      ...entry,
      timestamp: new Date(),
      // TTL: auto-delete after 1 year (Firestore TTL policy)
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
  } catch (err) {
    // Never let audit logging fail the main operation
    functions.logger.error('Failed to write audit log', { companyId, entry, error: err });
  }
}
