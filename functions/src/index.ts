/**
 * Tez — Cloud Functions v2.0
 *
 * Modular, world-class backend architecture.
 *
 * Architecture:
 * ├── config.ts          — Firebase init, secrets, constants, refs
 * ├── types.ts           — Zod schemas, request/response types
 * ├── middleware/
 * │   ├── auth.ts        — Authentication & RBAC
 * │   ├── rate-limit.ts  — Firestore-backed rate limiting
 * │   ├── validation.ts  — Zod validation wrapper
 * │   ├── idempotency.ts — Duplicate request prevention
 * │   └── logging.ts     — Structured logging + audit trail
 * ├── services/
 * │   ├── booking.ts     — CRUD + list with pagination
 * │   ├── parking.ts     — Spot assign/lock/release
 * │   ├── flight.ts      — FlightStats with retry + cache
 * │   └── admin.ts       — Roles, health, payment webhooks
 * └── triggers/
 *     ├── firestore.ts   — onCreate/onUpdate reactive triggers
 *     └── scheduled.ts   — Cleanup jobs, stats rollup
 *
 * Improvements over v1:
 * #1  Firestore-backed rate limiting (survives cold starts)
 * #2  Idempotency keys (no duplicate bookings)
 * #3  Zod schema validation (typed, testable)
 * #4  Modularised into 12 files by domain
 * #5  Full request/response TypeScript types
 * #6  Firestore security rules (server-only writes)
 * #7  Firestore indexes for compound queries
 * #8  releaseSpot ownership check
 * #9  Correlation IDs for request tracing
 * #10 Retry with exponential backoff for FlightStats
 * #11 process.env / defineSecret replaces functions.config()
 * #12 Unit tests with Jest + firebase-functions-test
 * #13 Memory/timeout tuning per function category
 * #14 Health check endpoint
 * #15 Error monitoring labels in structured logs
 * #16 Consistent ISO timestamps throughout
 * #17 Server-side pagination (listBookings)
 * #18 Payment webhook support
 * #19 Independent audit log collection
 * #20 Sharded booking counter (5 shards)
 * #21 Flight data caching (5-min Firestore TTL)
 * #22 tsconfig strict + noUncheckedIndexedAccess
 * #23 AI Phone Agent (OpenAI GPT-4o-mini + Twilio Voice)
 */

// ─── Callable Functions ──────────────────────────────────────────────

export {
  createBooking,
  transitionBooking,
  completeBooking,
  cancelBooking,
  listBookings,
} from './services/booking';

export {
  assignSpot,
  lockSpot,
  releaseSpot,
} from './services/parking';

export { lookupFlight } from './services/flight';

export {
  setUserRole,
  healthCheck,
  processPaymentWebhook,
} from './services/admin';

export {
  getPriceQuote,
  calculateCompletionPrice,
  updatePricingConfig,
} from './services/pricing';

export {
  phoneWebhook,
  savePhoneConfig,
  getCallLog,
  cleanupCallSessions,
} from './services/phone-agent';

// ─── Firestore Triggers ──────────────────────────────────────────────

export {
  onBookingCreated,
  onBookingUpdated,
} from './triggers/firestore';

// ─── Scheduled Jobs ─────────────────────────────────────────────────

export {
  cleanupExpiredLocks,
  cleanupExpiredIdempotency,
  cleanupExpiredRateLimits,
  cleanupFlightCache,
  dailyStatsRollup,
} from './triggers/scheduled';
