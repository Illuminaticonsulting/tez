/**
 * Tez — Admin Service (Cloud Functions)
 *
 * User role management, health check, payment webhooks.
 */

import {
  functions,
  admin,
  db,
  bookingRef,
  STANDARD_OPTIONS,
  APP_VERSION,
} from '../config';
import {
  assertRole,
  checkRateLimit,
  validate,
  generateCorrelationId,
  logInfo,
  logWarn,
  writeAuditLog,
} from '../middleware';
import {
  SetUserRoleSchema,
  PaymentWebhookSchema,
  type SuccessResponse,
  type HealthResponse,
} from '../types';

const startTime = Date.now();

// ─── Set User Role ───────────────────────────────────────────────────

export const setUserRole = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<SuccessResponse> => {
    const correlationId = generateCorrelationId();
    const auth = assertRole(context, ['admin']);
    await checkRateLimit(auth.uid);

    const input = validate(SetUserRoleSchema, data);
    const ctx = { correlationId, uid: auth.uid, companyId: auth.companyId, operation: 'setUserRole' };

    logInfo(ctx, 'Setting user role', { targetUserId: input.userId, role: input.role });

    // Verify target user belongs to same company
    const targetUser = await admin.auth().getUser(input.userId);
    const targetCompany = targetUser.customClaims?.['companyId'] as string | undefined;
    if (targetCompany && targetCompany !== auth.companyId) {
      logWarn(ctx, 'Cross-company role assignment blocked', {
        targetCompany,
        requestingCompany: auth.companyId,
      });
      throw new functions.https.HttpsError('permission-denied', 'Cannot modify users from a different company.');
    }

    // Prevent self-demotion (admin removing own admin)
    if (input.userId === auth.uid && input.role !== 'admin') {
      throw new functions.https.HttpsError('failed-precondition', 'Cannot demote yourself. Ask another admin.');
    }

    await admin.auth().setCustomUserClaims(input.userId, { role: input.role, companyId: auth.companyId });
    await db.collection('users').doc(input.userId).set(
      { role: input.role, companyId: auth.companyId, updatedAt: new Date(), updatedBy: auth.uid },
      { merge: true },
    );

    await writeAuditLog(db, auth.companyId, {
      action: 'user.setRole',
      uid: auth.uid,
      resourceType: 'user',
      resourceId: input.userId,
      details: { role: input.role, previousRole: targetUser.customClaims?.['role'] },
      correlationId,
    });

    logInfo(ctx, 'User role set', { targetUserId: input.userId, role: input.role });
    return { success: true };
  });

// ─── Health Check ────────────────────────────────────────────────────

export const healthCheck = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
      region: process.env.FUNCTION_REGION || 'us-central1',
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
  });

// ─── Payment Webhook Receiver ────────────────────────────────────────

export const processPaymentWebhook = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<SuccessResponse> => {
    const correlationId = generateCorrelationId();
    // Webhooks can be called by server-to-server, but we still require auth for callable
    const auth = assertRole(context, ['admin']);
    await checkRateLimit(auth.uid);

    const input = validate(PaymentWebhookSchema, data);
    const ctx = { correlationId, uid: auth.uid, companyId: auth.companyId, operation: 'processPaymentWebhook' };

    logInfo(ctx, 'Processing payment webhook', {
      provider: input.provider,
      eventType: input.eventType,
      bookingId: input.bookingId,
      amount: input.amount,
    });

    // Verify booking exists
    const bRef = bookingRef(auth.companyId, input.bookingId);
    const bDoc = await bRef.get();
    if (!bDoc.exists) {
      logWarn(ctx, 'Payment webhook for unknown booking', { bookingId: input.bookingId });
      throw new functions.https.HttpsError('not-found', 'Booking not found.');
    }

    // Update payment info
    await bRef.update({
      payment: {
        method: input.provider,
        amount: input.amount,
        status: input.eventType === 'payment.succeeded' ? 'paid' : 'pending',
        transactionId: input.transactionId,
        currency: input.currency,
        provider: input.provider,
        processedAt: new Date().toISOString(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await writeAuditLog(db, auth.companyId, {
      action: 'payment.webhook',
      uid: auth.uid,
      resourceType: 'booking',
      resourceId: input.bookingId,
      details: {
        provider: input.provider,
        eventType: input.eventType,
        amount: input.amount,
        transactionId: input.transactionId,
      },
      correlationId,
    });

    logInfo(ctx, 'Payment webhook processed', { bookingId: input.bookingId });
    return { success: true };
  });
