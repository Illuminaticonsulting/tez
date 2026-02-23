/**
 * Tez — Firebase Initialization & Shared References
 *
 * Single initialization point. All modules import from here
 * instead of calling admin.initializeApp() themselves.
 */

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

// Initialize once
if (!admin.apps.length) {
  admin.initializeApp();
}

export const db = admin.firestore();
export const auth = admin.auth();

// ─── Secrets (replaces deprecated functions.config()) ────────────────

export const FLIGHTSTATS_APP_ID = functions.config().flightstats?.app_id || process.env.FLIGHTSTATS_APP_ID || '';
export const FLIGHTSTATS_APP_KEY = functions.config().flightstats?.app_key || process.env.FLIGHTSTATS_APP_KEY || '';
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
export const SQUARE_WEBHOOK_SECRET = process.env.SQUARE_WEBHOOK_SECRET || '';
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Twilio SMS
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
export const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '';

// SendGrid Email
export const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
export const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@tezparking.com';
export const SENDGRID_FROM_NAME = process.env.SENDGRID_FROM_NAME || 'Tez Valet Parking';

// ─── Constants ───────────────────────────────────────────────────────

export const APP_VERSION = '2.0.0';
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX = 30;
export const SPOT_LOCK_TIMEOUT_MS = 30_000;
export const LOCK_CLEANUP_INTERVAL_MS = 60_000;
export const FLIGHT_CACHE_TTL_MS = 5 * 60_000; // 5 minutes
export const COUNTER_SHARDS = 5;

// ─── Function Options ────────────────────────────────────────────────

export const STANDARD_OPTIONS: functions.RuntimeOptions = {
  timeoutSeconds: 60,
  memory: '256MB',
};

export const HEAVY_OPTIONS: functions.RuntimeOptions = {
  timeoutSeconds: 120,
  memory: '512MB',
};

export const SCHEDULED_OPTIONS: functions.RuntimeOptions = {
  timeoutSeconds: 300,
  memory: '256MB',
};

// ─── Firestore References ────────────────────────────────────────────

export function bookingRef(companyId: string, bookingId: string) {
  return db.collection('companies').doc(companyId).collection('bookings').doc(bookingId);
}

export function spotRef(companyId: string, locationId: string, spotId: string) {
  return db
    .collection('companies')
    .doc(companyId)
    .collection('locations')
    .doc(locationId)
    .collection('spots')
    .doc(spotId);
}

export function counterRef(companyId: string) {
  return db.collection('companies').doc(companyId).collection('meta').doc('counters');
}

export function statsRef(companyId: string, date: string) {
  return db.collection('companies').doc(companyId).collection('stats').doc(date);
}

export function auditRef(companyId: string) {
  return db.collection('companies').doc(companyId).collection('audit');
}

export function idempotencyRef(companyId: string, key: string) {
  return db.collection('companies').doc(companyId).collection('idempotency').doc(key);
}

export function flightCacheRef(flightKey: string) {
  return db.collection('_flightCache').doc(flightKey);
}

export function phoneRoutingRef() {
  return db.collection('_phoneRouting');
}

export function callLogRef(companyId: string) {
  return db.collection('companies').doc(companyId).collection('_callLog');
}

export function callSessionRef(companyId: string, callSid: string) {
  return db.collection('companies').doc(companyId).collection('_callSessions').doc(callSid);
}

export { admin, functions };
