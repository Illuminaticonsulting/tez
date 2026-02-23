/**
 * Tez — Authentication & Authorization Middleware
 *
 * Centralized auth checks with structured error responses.
 * Extracts and validates custom claims (role, companyId).
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { type Role, ROLES } from '../types';

export interface AuthContext {
  uid: string;
  role: Role;
  companyId: string;
  email?: string;
}

/**
 * Assert the caller is authenticated. Returns uid + token.
 */
export function assertAuth(context: functions.https.CallableContext): { uid: string; token: admin.auth.DecodedIdToken } {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');
  }
  return context.auth;
}

/**
 * Assert the caller has one of the required roles.
 * Returns full AuthContext with uid, role, companyId.
 */
export function assertRole(context: functions.https.CallableContext, roles: Role[]): AuthContext {
  const auth = assertAuth(context);
  const rawRole = auth.token['role'] as string | undefined;
  if (!rawRole || !ROLES.includes(rawRole as Role)) {
    throw new functions.https.HttpsError('permission-denied', `Requires role: ${roles.join(' | ')}`);
  }
  const role = rawRole as Role;
  if (!roles.includes(role)) {
    throw new functions.https.HttpsError('permission-denied', `Requires role: ${roles.join(' | ')}`);
  }
  const companyId = auth.token['companyId'] as string | undefined;
  if (!companyId) {
    throw new functions.https.HttpsError('failed-precondition', 'User has no company assigned.');
  }
  return { uid: auth.uid, role, companyId, email: auth.token.email };
}

/**
 * Extract companyId from custom claims.
 */
export function getCompanyId(context: functions.https.CallableContext): string {
  const auth = assertAuth(context);
  const companyId = auth.token['companyId'] as string | undefined;
  if (!companyId) {
    throw new functions.https.HttpsError('failed-precondition', 'User has no company assigned.');
  }
  return companyId;
}


