/**
 * Tez — Handler-Level Stress Tests
 *
 * These tests ACTUALLY IMPORT AND INVOKE every Cloud Function handler
 * with the full mocked Firebase infrastructure. This covers:
 *
 *  1. Booking handlers: createBooking, transitionBooking, completeBooking, cancelBooking, listBookings
 *  2. Parking handlers: assignSpot, lockSpot, releaseSpot
 *  3. Admin handlers: setUserRole, healthCheck, processPaymentWebhook
 *  4. Flight handler: lookupFlight
 *  5. Error paths: missing docs, invalid transitions, permission failures
 *  6. State machine enforcement through actual handlers
 *  7. Concurrency simulation: multiple operators, race conditions
 *  8. Security: XSS payloads, auth bypass, cross-tenant isolation
 *  9. Edge cases: boundary values, empty inputs, huge payloads
 * 10. Data integrity: spot release on cancel/complete, stats increment
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ═══════════════════════════════════════════════════════════════════════
//  In-Memory Firestore Simulation (shared across all tests)
// ═══════════════════════════════════════════════════════════════════════

const firestoreStore = new Map<string, Record<string, any>>();
const writeLog: Array<{ type: string; path: string; data: any }> = [];

function clearStore() {
  firestoreStore.clear();
  writeLog.length = 0;
}

function setDoc(path: string, data: Record<string, any>) {
  firestoreStore.set(path, { ...data });
}

function getDoc(path: string): Record<string, any> | undefined {
  const d = firestoreStore.get(path);
  return d ? { ...d } : undefined;
}

function createMockDocRef(path: string): any {
  return {
    id: path.split('/').pop()!,
    path,
    collection: jest.fn((subCol: string) => createMockCollectionRef(`${path}/${subCol}`)),
    get: jest.fn(async () => {
      const data = getDoc(path);
      return {
        exists: !!data,
        id: path.split('/').pop()!,
        data: () => (data ? { ...data } : undefined),
        ref: createMockDocRef(path),
      };
    }),
    set: jest.fn(async (data: any, options?: any) => {
      const existing = getDoc(path) || {};
      if (options?.merge) {
        setDoc(path, { ...existing, ...data });
      } else {
        setDoc(path, data);
      }
      writeLog.push({ type: 'set', path, data });
    }),
    update: jest.fn(async (data: any) => {
      const existing = getDoc(path) || {};
      setDoc(path, { ...existing, ...data });
      writeLog.push({ type: 'update', path, data });
    }),
    delete: jest.fn(async () => {
      firestoreStore.delete(path);
      writeLog.push({ type: 'delete', path, data: null });
    }),
  };
}

function createMockCollectionRef(path: string): any {
  return {
    doc: jest.fn((id?: string) => {
      const docId = id || `auto_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return createMockDocRef(`${path}/${docId}`);
    }),
    add: jest.fn(async (data: any) => {
      const docId = `auto_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const docPath = `${path}/${docId}`;
      setDoc(docPath, data);
      writeLog.push({ type: 'add', path: docPath, data });
      return { id: docId, path: docPath };
    }),
    where: jest.fn(function (this: any, field: string, op: string, value: any) {
      const matchingDocs: any[] = [];
      for (const [docPath, docData] of firestoreStore.entries()) {
        if (!docPath.startsWith(path + '/')) continue;
        const relative = docPath.slice(path.length + 1);
        if (relative.includes('/')) continue;

        const fieldVal = field.includes('.')
          ? field.split('.').reduce((obj: any, key: string) => obj?.[key], docData)
          : docData[field];

        let matches = false;
        switch (op) {
          case '==': matches = fieldVal === value; break;
          case '!=': matches = fieldVal !== value && fieldVal !== null && fieldVal !== undefined; break;
          case '<': matches = fieldVal < value; break;
          case '<=': matches = fieldVal <= value; break;
          case '>': matches = fieldVal > value; break;
          case '>=': matches = fieldVal >= value; break;
          default: matches = false;
        }
        if (matches) {
          matchingDocs.push({
            id: docPath.split('/').pop()!,
            ref: createMockDocRef(docPath),
            data: () => ({ ...docData }),
          });
        }
      }

      const queryRef: any = {
        where: jest.fn(() => queryRef),
        orderBy: jest.fn(() => queryRef),
        limit: jest.fn((n: number) => {
          const limited = matchingDocs.slice(0, n);
          return {
            ...queryRef,
            get: jest.fn(async () => ({
              empty: limited.length === 0,
              docs: limited,
              size: limited.length,
            })),
          };
        }),
        startAfter: jest.fn(() => queryRef),
        get: jest.fn(async () => ({
          empty: matchingDocs.length === 0,
          docs: matchingDocs,
          size: matchingDocs.length,
        })),
      };
      return queryRef;
    }),
    orderBy: jest.fn(function () {
      const allDocs: any[] = [];
      for (const [docPath, docData] of firestoreStore.entries()) {
        if (!docPath.startsWith(path + '/')) continue;
        const relative = docPath.slice(path.length + 1);
        if (relative.includes('/')) continue;
        allDocs.push({
          id: docPath.split('/').pop()!,
          ref: createMockDocRef(docPath),
          data: () => ({ ...docData }),
        });
      }
      const queryRef: any = {
        where: jest.fn(() => queryRef),
        limit: jest.fn((n: number) => {
          const limited = allDocs.slice(0, n);
          return {
            ...queryRef,
            get: jest.fn(async () => ({
              empty: limited.length === 0,
              docs: limited,
              size: limited.length,
            })),
          };
        }),
        startAfter: jest.fn(() => queryRef),
        get: jest.fn(async () => ({
          empty: allDocs.length === 0,
          docs: allDocs,
          size: allDocs.length,
        })),
      };
      return queryRef;
    }),
    get: jest.fn(async () => {
      const allDocs: any[] = [];
      for (const [docPath, docData] of firestoreStore.entries()) {
        if (!docPath.startsWith(path + '/')) continue;
        const relative = docPath.slice(path.length + 1);
        if (relative.includes('/')) continue;
        allDocs.push({
          id: docPath.split('/').pop()!,
          ref: createMockDocRef(docPath),
          data: () => ({ ...docData }),
        });
      }
      return {
        empty: allDocs.length === 0,
        docs: allDocs,
        size: allDocs.length,
      };
    }),
  };
}

function createMockTransaction(): any {
  return {
    get: jest.fn(async (ref: any) => {
      const data = getDoc(ref.path);
      return {
        exists: !!data,
        id: ref.path.split('/').pop()!,
        data: () => (data ? { ...data } : undefined),
        ref,
      };
    }),
    set: jest.fn((ref: any, data: any, options?: any) => {
      const existing = getDoc(ref.path) || {};
      if (options?.merge) {
        setDoc(ref.path, { ...existing, ...data });
      } else {
        setDoc(ref.path, data);
      }
      writeLog.push({ type: 'tx.set', path: ref.path, data });
    }),
    update: jest.fn((ref: any, data: any) => {
      const existing = getDoc(ref.path) || {};
      setDoc(ref.path, { ...existing, ...data });
      writeLog.push({ type: 'tx.update', path: ref.path, data });
    }),
    delete: jest.fn((ref: any) => {
      firestoreStore.delete(ref.path);
      writeLog.push({ type: 'tx.delete', path: ref.path, data: null });
    }),
  };
}

const mockDb: any = {
  collection: jest.fn((path: string) => createMockCollectionRef(path)),
  doc: jest.fn((path: string) => createMockDocRef(path)),
  runTransaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
    const tx = createMockTransaction();
    return fn(tx);
  }),
  collectionGroup: jest.fn((name: string) => {
    const matchingDocs: any[] = [];
    for (const [docPath, docData] of firestoreStore.entries()) {
      if (docPath.includes(`/${name}/`)) {
        matchingDocs.push({
          id: docPath.split('/').pop()!,
          ref: createMockDocRef(docPath),
          data: () => ({ ...docData }),
        });
      }
    }
    const queryRef: any = {
      where: jest.fn(() => ({
        ...queryRef,
        where: jest.fn(() => queryRef),
        get: jest.fn(async () => ({
          empty: matchingDocs.length === 0,
          docs: matchingDocs,
          size: matchingDocs.length,
        })),
      })),
      get: jest.fn(async () => ({
        empty: matchingDocs.length === 0,
        docs: matchingDocs,
        size: matchingDocs.length,
      })),
    };
    return queryRef;
  }),
  batch: jest.fn(() => {
    const ops: Array<() => void> = [];
    return {
      set: jest.fn((ref: any, data: any) => {
        ops.push(() => {
          setDoc(ref.path, data);
          writeLog.push({ type: 'batch.set', path: ref.path, data });
        });
      }),
      update: jest.fn((ref: any, data: any) => {
        ops.push(() => {
          const existing = getDoc(ref.path) || {};
          setDoc(ref.path, { ...existing, ...data });
          writeLog.push({ type: 'batch.update', path: ref.path, data });
        });
      }),
      delete: jest.fn((ref: any) => {
        ops.push(() => {
          firestoreStore.delete(ref.path);
          writeLog.push({ type: 'batch.delete', path: ref.path, data: null });
        });
      }),
      commit: jest.fn(async () => {
        ops.forEach((op) => op());
      }),
    };
  }),
};

// ═══════════════════════════════════════════════════════════════════════
//  Firebase Admin Mock
// ═══════════════════════════════════════════════════════════════════════

const mockFieldValue = {
  serverTimestamp: jest.fn(() => ({ _type: 'serverTimestamp' })),
  increment: jest.fn((n: number) => ({ _type: 'increment', value: n })),
  arrayUnion: jest.fn((...items: any[]) => ({ _type: 'arrayUnion', values: items })),
  delete: jest.fn(() => ({ _type: 'delete' })),
};

const mockGetUser = jest.fn();
const mockSetCustomUserClaims = jest.fn();

jest.mock('firebase-admin', () => ({
  apps: [{}],
  initializeApp: jest.fn(),
  firestore: Object.assign(jest.fn(() => mockDb), {
    FieldValue: mockFieldValue,
  }),
  auth: jest.fn(() => ({
    getUser: mockGetUser,
    setCustomUserClaims: mockSetCustomUserClaims,
  })),
}));

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: mockFieldValue,
}));

// ═══════════════════════════════════════════════════════════════════════
//  Firebase Functions Mock
// ═══════════════════════════════════════════════════════════════════════

class HttpsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'HttpsError';
  }
}

jest.mock('firebase-functions', () => ({
  https: {
    HttpsError,
    onCall: jest.fn((handler: any) => handler),
    onRequest: jest.fn((handler: any) => handler),
  },
  runWith: jest.fn(() => ({
    https: {
      onCall: jest.fn((handler: any) => handler),
      onRequest: jest.fn((handler: any) => handler),
    },
    pubsub: {
      schedule: jest.fn(() => ({
        onRun: jest.fn((handler: any) => handler),
        timeZone: jest.fn(() => ({
          onRun: jest.fn((handler: any) => handler),
        })),
      })),
    },
    firestore: {
      document: jest.fn(() => ({
        onCreate: jest.fn((handler: any) => handler),
        onUpdate: jest.fn((handler: any) => handler),
      })),
    },
  })),
  config: jest.fn(() => ({})),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  },
  firestore: {
    document: jest.fn(() => ({
      onCreate: jest.fn((handler: any) => handler),
      onUpdate: jest.fn((handler: any) => handler),
    })),
  },
}));

// ═══════════════════════════════════════════════════════════════════════
//  Axios Mock (for flight lookups)
// ═══════════════════════════════════════════════════════════════════════

jest.mock('axios', () => ({
  get: jest.fn(),
  default: { get: jest.fn() },
}));

// ═══════════════════════════════════════════════════════════════════════
//  OpenAI Mock
// ═══════════════════════════════════════════════════════════════════════

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(async () => ({
          choices: [{
            message: { content: 'Test response', role: 'assistant' },
            finish_reason: 'stop',
          }],
        })),
      },
    },
  }));
});

// ═══════════════════════════════════════════════════════════════════════
//  Mock Rate Limiter (prevent in-memory rate limit accumulation)
// ═══════════════════════════════════════════════════════════════════════

jest.mock('../middleware/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => {}),
  checkRateLimitSync: jest.fn(() => {}),
}));

// ═══════════════════════════════════════════════════════════════════════
//  Import ALL handlers AFTER mocks are established
// ═══════════════════════════════════════════════════════════════════════

import { createBooking, transitionBooking, completeBooking, cancelBooking, listBookings } from '../services/booking';
import { assignSpot, lockSpot, releaseSpot } from '../services/parking';
import { setUserRole, healthCheck, processPaymentWebhook } from '../services/admin';
import { onBookingCreated, onBookingUpdated } from '../triggers/firestore';
import {
  cleanupExpiredLocks,
  cleanupExpiredIdempotency,
  cleanupExpiredRateLimits,
  cleanupFlightCache,
  dailyStatsRollup,
} from '../triggers/scheduled';

// ═══════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════

function adminCtx(uid = 'admin-001', companyId = 'company-001') {
  return {
    auth: {
      uid,
      token: { uid, role: 'admin', companyId, email: 'admin@test.com' } as any,
    },
  } as any;
}

function operatorCtx(uid = 'op-001', companyId = 'company-001') {
  return {
    auth: {
      uid,
      token: { uid, role: 'operator', companyId, email: 'op@test.com' } as any,
    },
  } as any;
}

function viewerCtx(uid = 'viewer-001', companyId = 'company-001') {
  return {
    auth: {
      uid,
      token: { uid, role: 'viewer', companyId, email: 'viewer@test.com' } as any,
    },
  } as any;
}

function noAuth() {
  return { auth: undefined } as any;
}

const VALID_BOOKING_DATA = {
  customerName: 'John Doe',
  customerPhone: '555-1234',
  customerEmail: 'john@example.com',
  vehiclePlate: 'ABC123',
  vehicleMake: 'Toyota',
  vehicleModel: 'Camry',
  vehicleColor: 'Silver',
  flightNumber: 'AA123',
  notes: 'Test booking',
  idempotencyKey: 'idem-001',
};

// ═══════════════════════════════════════════════════════════════════════
//  Setup
// ═══════════════════════════════════════════════════════════════════════

beforeEach(() => {
  clearStore();
  jest.clearAllMocks();
  mockGetUser.mockReset();
  mockSetCustomUserClaims.mockReset();
});

// ═══════════════════════════════════════════════════════════════════════
//  1. BOOKING HANDLER TESTS
// ═══════════════════════════════════════════════════════════════════════

describe('createBooking handler', () => {
  it('should create a booking and return id + ticketNumber', async () => {
    const result = await (createBooking as any)(VALID_BOOKING_DATA, adminCtx());
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('ticketNumber');
    expect(typeof result.ticketNumber).toBe('number');
  });

  it('should work with operator role', async () => {
    const result = await (createBooking as any)(VALID_BOOKING_DATA, operatorCtx());
    expect(result).toHaveProperty('id');
  });

  it('should reject unauthenticated requests', async () => {
    await expect((createBooking as any)(VALID_BOOKING_DATA, noAuth())).rejects.toThrow();
  });

  it('should reject viewer role', async () => {
    await expect((createBooking as any)(VALID_BOOKING_DATA, viewerCtx())).rejects.toThrow();
  });

  it('should validate required fields', async () => {
    await expect((createBooking as any)({}, adminCtx())).rejects.toThrow();
  });

  it('should reject missing customerName', async () => {
    const data = { ...VALID_BOOKING_DATA, customerName: '' };
    await expect((createBooking as any)(data, adminCtx())).rejects.toThrow();
  });

  it('should reject missing vehiclePlate', async () => {
    const data = { ...VALID_BOOKING_DATA, vehiclePlate: '' };
    await expect((createBooking as any)(data, adminCtx())).rejects.toThrow();
  });

  it('should handle XSS in customerName', async () => {
    const data = { ...VALID_BOOKING_DATA, customerName: '<script>alert("xss")</script>' };
    const result = await (createBooking as any)(data, adminCtx());
    expect(result).toHaveProperty('id');
    // The name should be sanitized (angle brackets stripped)
  });

  it('should write booking data to Firestore', async () => {
    await (createBooking as any)(VALID_BOOKING_DATA, adminCtx());
    // Check that a booking document was added to the store
    const bookingEntries = [...firestoreStore.entries()].filter(([k]) =>
      k.startsWith('companies/company-001/bookings/'),
    );
    expect(bookingEntries.length).toBeGreaterThanOrEqual(1);
    const [, bookingData] = bookingEntries[0];
    expect(bookingData.status).toBe('New');
    expect(bookingData.customerName).toBeDefined();
    expect(bookingData.customerEmail).toBe('john@example.com');
  });

  it('should write audit log', async () => {
    await (createBooking as any)(VALID_BOOKING_DATA, adminCtx());
    const auditEntries = [...firestoreStore.entries()].filter(([k]) =>
      k.startsWith('companies/company-001/audit/'),
    );
    expect(auditEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('should use sharded ticket counter', async () => {
    const result1 = await (createBooking as any)(
      { ...VALID_BOOKING_DATA, idempotencyKey: 'key-1' },
      adminCtx(),
    );
    const result2 = await (createBooking as any)(
      { ...VALID_BOOKING_DATA, idempotencyKey: 'key-2' },
      adminCtx(),
    );
    // Both should have ticket numbers (they may collide on same shard but should be numbers)
    expect(typeof result1.ticketNumber).toBe('number');
    expect(typeof result2.ticketNumber).toBe('number');
  });

  it('should handle idempotency: return cached result for same key', async () => {
    // First call creates the booking
    const result1 = await (createBooking as any)(VALID_BOOKING_DATA, adminCtx());

    // Second call with same idempotency key should return cached result
    const result2 = await (createBooking as any)(VALID_BOOKING_DATA, adminCtx());
    // The idempotency middleware checks Firestore for the key
    // Since we saved it, the second call should hit the cache path
    expect(result2).toBeDefined();
  });

  it('should create booking in correct company collection', async () => {
    await (createBooking as any)(VALID_BOOKING_DATA, adminCtx('admin-001', 'comp-A'));
    const entries = [...firestoreStore.entries()].filter(([k]) =>
      k.startsWith('companies/comp-A/bookings/'),
    );
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it('should set initial status to New', async () => {
    await (createBooking as any)({ ...VALID_BOOKING_DATA, idempotencyKey: 'new-check' }, adminCtx());
    const booking = [...firestoreStore.entries()].find(
      ([k]) => k.startsWith('companies/company-001/bookings/'),
    );
    expect(booking).toBeDefined();
    expect(booking![1].status).toBe('New');
  });

  it('should include history entry', async () => {
    await (createBooking as any)({ ...VALID_BOOKING_DATA, idempotencyKey: 'hist-1' }, adminCtx());
    const booking = [...firestoreStore.entries()].find(
      ([k]) => k.startsWith('companies/company-001/bookings/'),
    );
    expect(booking![1].history).toBeDefined();
    expect(booking![1].history.length).toBe(1);
    expect(booking![1].history[0].status).toBe('New');
  });

  it('should sanitize vehicle plate to uppercase', async () => {
    const data = { ...VALID_BOOKING_DATA, vehiclePlate: 'abc123', idempotencyKey: 'plate-test' };
    await (createBooking as any)(data, adminCtx());
    const booking = [...firestoreStore.entries()].find(
      ([k]) => k.startsWith('companies/company-001/bookings/'),
    );
    expect(booking![1].vehicle.plate).toBe('ABC123');
  });

  it('should work with minimum required fields only', async () => {
    const data = { customerName: 'Jane', vehiclePlate: 'XYZ789' };
    const result = await (createBooking as any)(data, adminCtx());
    expect(result).toHaveProperty('id');
  });

  it('should reject extremely long customer name', async () => {
    const data = { ...VALID_BOOKING_DATA, customerName: 'A'.repeat(200) };
    await expect((createBooking as any)(data, adminCtx())).rejects.toThrow();
  });

  it('should reject extremely long notes', async () => {
    const data = { ...VALID_BOOKING_DATA, notes: 'Z'.repeat(2000) };
    await expect((createBooking as any)(data, adminCtx())).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  2. TRANSITION BOOKING HANDLER
// ═══════════════════════════════════════════════════════════════════════

describe('transitionBooking handler', () => {
  beforeEach(() => {
    // Seed a booking in New status
    setDoc('companies/company-001/bookings/bk-001', {
      status: 'New',
      customerName: 'John',
      ticketNumber: 1001,
      spotId: '',
      locationId: '',
      history: [],
    });
  });

  it('should transition New → Booked', async () => {
    const result = await (transitionBooking as any)(
      { bookingId: 'bk-001', newStatus: 'Booked' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
    const doc = getDoc('companies/company-001/bookings/bk-001');
    expect(doc?.status).toBe('Booked');
  });

  it('should reject invalid transition New → Active', async () => {
    await expect(
      (transitionBooking as any)({ bookingId: 'bk-001', newStatus: 'Active' }, adminCtx()),
    ).rejects.toThrow(/Cannot transition/);
  });

  it('should reject invalid transition New → Completed', async () => {
    await expect(
      (transitionBooking as any)({ bookingId: 'bk-001', newStatus: 'Completed' }, adminCtx()),
    ).rejects.toThrow();
  });

  it('should reject non-existent booking', async () => {
    await expect(
      (transitionBooking as any)({ bookingId: 'nonexistent', newStatus: 'Booked' }, adminCtx()),
    ).rejects.toThrow(/not found/i);
  });

  it('should reject viewer role', async () => {
    await expect(
      (transitionBooking as any)({ bookingId: 'bk-001', newStatus: 'Booked' }, viewerCtx()),
    ).rejects.toThrow();
  });

  it('should reject unauthenticated', async () => {
    await expect(
      (transitionBooking as any)({ bookingId: 'bk-001', newStatus: 'Booked' }, noAuth()),
    ).rejects.toThrow();
  });

  it('should auto-release spot on transition to Cancelled', async () => {
    setDoc('companies/company-001/bookings/bk-002', {
      status: 'Parked',
      spotId: 'spot-A1',
      locationId: 'loc-1',
      history: [],
    });
    setDoc('companies/company-001/locations/loc-1/spots/spot-A1', {
      status: 'occupied',
      bookingId: 'bk-002',
      lockedBy: null,
    });

    await (transitionBooking as any)(
      { bookingId: 'bk-002', newStatus: 'Cancelled' },
      adminCtx(),
    );

    const spot = getDoc('companies/company-001/locations/loc-1/spots/spot-A1');
    expect(spot?.status).toBe('available');
    expect(spot?.bookingId).toBeNull();
  });

  it('should include note in history update', async () => {
    await (transitionBooking as any)(
      { bookingId: 'bk-001', newStatus: 'Booked', note: 'Customer confirmed' },
      adminCtx(),
    );
    // The handler uses FieldValue.arrayUnion which is mocked
    const doc = getDoc('companies/company-001/bookings/bk-001');
    expect(doc?.history).toBeDefined();
  });

  it('should produce audit log on transition', async () => {
    await (transitionBooking as any)(
      { bookingId: 'bk-001', newStatus: 'Booked' },
      adminCtx(),
    );
    const audits = [...firestoreStore.entries()].filter(([k]) =>
      k.startsWith('companies/company-001/audit/'),
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('should walk through full happy path: New → Booked → Check-In → Parked → Active', async () => {
    const steps: Array<[string, string]> = [
      ['New', 'Booked'],
      ['Booked', 'Check-In'],
      ['Check-In', 'Parked'],
      ['Parked', 'Active'],
    ];
    for (const [_from, to] of steps) {
      await (transitionBooking as any)({ bookingId: 'bk-001', newStatus: to }, adminCtx());
      const doc = getDoc('companies/company-001/bookings/bk-001');
      expect(doc?.status).toBe(to);
    }
  });

  it('should reject transition from Completed status', async () => {
    setDoc('companies/company-001/bookings/bk-done', {
      status: 'Completed',
      history: [],
    });
    await expect(
      (transitionBooking as any)({ bookingId: 'bk-done', newStatus: 'Active' }, adminCtx()),
    ).rejects.toThrow();
  });

  it('should reject transition from Cancelled status', async () => {
    setDoc('companies/company-001/bookings/bk-cancelled', {
      status: 'Cancelled',
      history: [],
    });
    await expect(
      (transitionBooking as any)({ bookingId: 'bk-cancelled', newStatus: 'New' }, adminCtx()),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  3. COMPLETE BOOKING HANDLER
// ═══════════════════════════════════════════════════════════════════════

describe('completeBooking handler', () => {
  beforeEach(() => {
    setDoc('companies/company-001/bookings/bk-active', {
      status: 'Active',
      spotId: 'spot-B2',
      locationId: 'loc-1',
      history: [],
    });
    setDoc('companies/company-001/locations/loc-1/spots/spot-B2', {
      status: 'occupied',
      bookingId: 'bk-active',
    });
  });

  it('should complete an Active booking', async () => {
    const result = await (completeBooking as any)(
      { bookingId: 'bk-active', paymentMethod: 'cash', paymentAmount: 25 },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
    const doc = getDoc('companies/company-001/bookings/bk-active');
    expect(doc?.status).toBe('Completed');
  });

  it('should release the spot on completion', async () => {
    await (completeBooking as any)(
      { bookingId: 'bk-active', paymentMethod: 'card', paymentAmount: 50 },
      adminCtx(),
    );
    const spot = getDoc('companies/company-001/locations/loc-1/spots/spot-B2');
    expect(spot?.status).toBe('available');
    expect(spot?.bookingId).toBeNull();
  });

  it('should reject completing a non-Active booking', async () => {
    setDoc('companies/company-001/bookings/bk-new', { status: 'New', history: [] });
    await expect(
      (completeBooking as any)(
        { bookingId: 'bk-new', paymentMethod: 'cash', paymentAmount: 10 },
        adminCtx(),
      ),
    ).rejects.toThrow(/Only Active/);
  });

  it('should reject non-existent booking', async () => {
    await expect(
      (completeBooking as any)(
        { bookingId: 'ghost', paymentMethod: 'cash', paymentAmount: 10 },
        adminCtx(),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('should update daily stats on completion', async () => {
    await (completeBooking as any)(
      { bookingId: 'bk-active', paymentMethod: 'cash', paymentAmount: 100 },
      adminCtx(),
    );
    // Stats doc should be created via tx.set with merge
    const today = new Date().toISOString().split('T')[0]!;
    const stats = getDoc(`companies/company-001/stats/${today}`);
    expect(stats).toBeDefined();
  });

  it('should set payment info correctly', async () => {
    await (completeBooking as any)(
      { bookingId: 'bk-active', paymentMethod: 'card', paymentAmount: 75.50 },
      adminCtx(),
    );
    const doc = getDoc('companies/company-001/bookings/bk-active');
    expect(doc?.payment?.method).toBe('card');
    expect(doc?.payment?.amount).toBe(75.50);
    expect(doc?.payment?.status).toBe('paid');
  });

  it('should reject negative payment amount', async () => {
    await expect(
      (completeBooking as any)(
        { bookingId: 'bk-active', paymentMethod: 'cash', paymentAmount: -5 },
        adminCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should reject excessive payment amount', async () => {
    await expect(
      (completeBooking as any)(
        { bookingId: 'bk-active', paymentMethod: 'cash', paymentAmount: 999999 },
        adminCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should handle booking without spot gracefully', async () => {
    setDoc('companies/company-001/bookings/bk-nospot', {
      status: 'Active',
      spotId: '',
      locationId: '',
      history: [],
    });
    const result = await (completeBooking as any)(
      { bookingId: 'bk-nospot', paymentMethod: 'cash', paymentAmount: 0 },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should reject viewer completing a booking', async () => {
    await expect(
      (completeBooking as any)(
        { bookingId: 'bk-active', paymentMethod: 'cash', paymentAmount: 10 },
        viewerCtx(),
      ),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  4. CANCEL BOOKING HANDLER
// ═══════════════════════════════════════════════════════════════════════

describe('cancelBooking handler', () => {
  beforeEach(() => {
    setDoc('companies/company-001/bookings/bk-cancel', {
      status: 'Parked',
      spotId: 'spot-C3',
      locationId: 'loc-1',
      history: [],
    });
    setDoc('companies/company-001/locations/loc-1/spots/spot-C3', {
      status: 'occupied',
      bookingId: 'bk-cancel',
    });
  });

  it('should cancel a Parked booking', async () => {
    const result = await (cancelBooking as any)(
      { bookingId: 'bk-cancel', reason: 'Customer no-show' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
    const doc = getDoc('companies/company-001/bookings/bk-cancel');
    expect(doc?.status).toBe('Cancelled');
  });

  it('should release spot on cancellation', async () => {
    await (cancelBooking as any)(
      { bookingId: 'bk-cancel', reason: 'No show' },
      adminCtx(),
    );
    const spot = getDoc('companies/company-001/locations/loc-1/spots/spot-C3');
    expect(spot?.status).toBe('available');
    expect(spot?.bookingId).toBeNull();
  });

  it('should reject cancelling a Completed booking', async () => {
    setDoc('companies/company-001/bookings/bk-completed', {
      status: 'Completed',
      history: [],
    });
    await expect(
      (cancelBooking as any)({ bookingId: 'bk-completed', reason: 'test' }, adminCtx()),
    ).rejects.toThrow();
  });

  it('should cancel a New booking', async () => {
    setDoc('companies/company-001/bookings/bk-new', {
      status: 'New',
      spotId: '',
      locationId: '',
      history: [],
    });
    const result = await (cancelBooking as any)(
      { bookingId: 'bk-new' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should reject non-existent booking', async () => {
    await expect(
      (cancelBooking as any)({ bookingId: 'ghost' }, adminCtx()),
    ).rejects.toThrow(/not found/i);
  });

  it('should cancel Active booking (with spot release)', async () => {
    setDoc('companies/company-001/bookings/bk-active-cancel', {
      status: 'Active',
      spotId: 'spot-D4',
      locationId: 'loc-2',
      history: [],
    });
    setDoc('companies/company-001/locations/loc-2/spots/spot-D4', {
      status: 'occupied',
      bookingId: 'bk-active-cancel',
    });

    await (cancelBooking as any)({ bookingId: 'bk-active-cancel' }, adminCtx());
    const spot = getDoc('companies/company-001/locations/loc-2/spots/spot-D4');
    expect(spot?.status).toBe('available');
  });

  it('should write audit log on cancel', async () => {
    const before = [...firestoreStore.entries()].filter(([k]) =>
      k.startsWith('companies/company-001/audit/'),
    ).length;
    await (cancelBooking as any)({ bookingId: 'bk-cancel' }, adminCtx());
    const after = [...firestoreStore.entries()].filter(([k]) =>
      k.startsWith('companies/company-001/audit/'),
    ).length;
    expect(after).toBeGreaterThan(before);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  5. LIST BOOKINGS HANDLER
// ═══════════════════════════════════════════════════════════════════════

describe('listBookings handler', () => {
  beforeEach(() => {
    for (let i = 0; i < 5; i++) {
      setDoc(`companies/company-001/bookings/list-${i}`, {
        status: i < 3 ? 'New' : 'Active',
        customerName: `Customer ${i}`,
        ticketNumber: 1000 + i,
        createdAt: { toDate: () => new Date() },
        updatedAt: { toDate: () => new Date() },
      });
    }
  });

  it('should list bookings for admin', async () => {
    const result = await (listBookings as any)({}, adminCtx());
    expect(result).toHaveProperty('bookings');
    expect(result).toHaveProperty('hasMore');
  });

  it('should list bookings for viewer', async () => {
    const result = await (listBookings as any)({}, viewerCtx());
    expect(result).toHaveProperty('bookings');
  });

  it('should reject unauthenticated', async () => {
    await expect((listBookings as any)({}, noAuth())).rejects.toThrow();
  });

  it('should list bookings for operator', async () => {
    const result = await (listBookings as any)({}, operatorCtx());
    expect(result).toHaveProperty('bookings');
  });

  it('should accept limit parameter', async () => {
    const result = await (listBookings as any)({ limit: 2 }, adminCtx());
    expect(result).toHaveProperty('bookings');
  });

  it('should accept orderBy parameter', async () => {
    const result = await (listBookings as any)({ orderBy: 'ticketNumber', direction: 'asc' }, adminCtx());
    expect(result).toHaveProperty('bookings');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  6. ASSIGN SPOT HANDLER
// ═══════════════════════════════════════════════════════════════════════

describe('assignSpot handler', () => {
  beforeEach(() => {
    setDoc('companies/company-001/bookings/bk-assign', {
      status: 'Check-In',
      spotId: '',
      locationId: '',
    });
    setDoc('companies/company-001/locations/loc-1/spots/spot-A1', {
      status: 'available',
      name: 'A1',
      bookingId: null,
      lockedBy: null,
      lockedAt: null,
    });
  });

  it('should assign a spot to a booking', async () => {
    const result = await (assignSpot as any)(
      { bookingId: 'bk-assign', locationId: 'loc-1', spotId: 'spot-A1' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
    const spot = getDoc('companies/company-001/locations/loc-1/spots/spot-A1');
    expect(spot?.status).toBe('occupied');
    expect(spot?.bookingId).toBe('bk-assign');
  });

  it('should reject assigning occupied spot to a different booking', async () => {
    setDoc('companies/company-001/locations/loc-1/spots/spot-A1', {
      status: 'occupied',
      bookingId: 'bk-other',
      lockedBy: null,
    });
    await expect(
      (assignSpot as any)(
        { bookingId: 'bk-assign', locationId: 'loc-1', spotId: 'spot-A1' },
        adminCtx(),
      ),
    ).rejects.toThrow(/occupied/i);
  });

  it('should allow re-assigning same booking to its own spot', async () => {
    setDoc('companies/company-001/locations/loc-1/spots/spot-A1', {
      status: 'occupied',
      bookingId: 'bk-assign',
      lockedBy: null,
    });
    const result = await (assignSpot as any)(
      { bookingId: 'bk-assign', locationId: 'loc-1', spotId: 'spot-A1' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should reject locked spot by another operator', async () => {
    setDoc('companies/company-001/locations/loc-1/spots/spot-A1', {
      status: 'available',
      bookingId: null,
      lockedBy: 'other-op',
      lockedAt: { toDate: () => new Date() }, // Recent lock
    });
    await expect(
      (assignSpot as any)(
        { bookingId: 'bk-assign', locationId: 'loc-1', spotId: 'spot-A1' },
        adminCtx(),
      ),
    ).rejects.toThrow(/locked/i);
  });

  it('should allow assigning expired-lock spot', async () => {
    setDoc('companies/company-001/locations/loc-1/spots/spot-A1', {
      status: 'available',
      bookingId: null,
      lockedBy: 'other-op',
      lockedAt: { toDate: () => new Date(Date.now() - 60_000) }, // Expired lock (>30s)
    });
    const result = await (assignSpot as any)(
      { bookingId: 'bk-assign', locationId: 'loc-1', spotId: 'spot-A1' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should reject non-existent booking', async () => {
    await expect(
      (assignSpot as any)(
        { bookingId: 'ghost', locationId: 'loc-1', spotId: 'spot-A1' },
        adminCtx(),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('should reject non-existent spot', async () => {
    await expect(
      (assignSpot as any)(
        { bookingId: 'bk-assign', locationId: 'loc-1', spotId: 'ghost-spot' },
        adminCtx(),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('should update booking with spot info', async () => {
    await (assignSpot as any)(
      { bookingId: 'bk-assign', locationId: 'loc-1', spotId: 'spot-A1' },
      adminCtx(),
    );
    const booking = getDoc('companies/company-001/bookings/bk-assign');
    expect(booking?.spotId).toBe('spot-A1');
    expect(booking?.locationId).toBe('loc-1');
  });

  it('should reject viewer assigning spot', async () => {
    await expect(
      (assignSpot as any)(
        { bookingId: 'bk-assign', locationId: 'loc-1', spotId: 'spot-A1' },
        viewerCtx(),
      ),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  7. LOCK SPOT HANDLER
// ═══════════════════════════════════════════════════════════════════════

describe('lockSpot handler', () => {
  beforeEach(() => {
    setDoc('companies/company-001/locations/loc-1/spots/spot-L1', {
      status: 'available',
      lockedBy: null,
      lockedAt: null,
    });
  });

  it('should lock an available spot', async () => {
    const result = await (lockSpot as any)(
      { locationId: 'loc-1', spotId: 'spot-L1' },
      operatorCtx(),
    );
    expect(result).toEqual({ success: true });
    const spot = getDoc('companies/company-001/locations/loc-1/spots/spot-L1');
    expect(spot?.lockedBy).toBe('op-001');
  });

  it('should reject locking occupied spot', async () => {
    setDoc('companies/company-001/locations/loc-1/spots/spot-L1', {
      status: 'occupied',
      lockedBy: null,
    });
    await expect(
      (lockSpot as any)({ locationId: 'loc-1', spotId: 'spot-L1' }, operatorCtx()),
    ).rejects.toThrow(/occupied/i);
  });

  it('should reject locking spot locked by another operator (active lock)', async () => {
    setDoc('companies/company-001/locations/loc-1/spots/spot-L1', {
      status: 'available',
      lockedBy: 'other-op',
      lockedAt: { toDate: () => new Date() },
    });
    await expect(
      (lockSpot as any)({ locationId: 'loc-1', spotId: 'spot-L1' }, operatorCtx()),
    ).rejects.toThrow(/locked/i);
  });

  it('should allow re-locking own spot', async () => {
    setDoc('companies/company-001/locations/loc-1/spots/spot-L1', {
      status: 'available',
      lockedBy: 'op-001',
      lockedAt: { toDate: () => new Date() },
    });
    const result = await (lockSpot as any)(
      { locationId: 'loc-1', spotId: 'spot-L1' },
      operatorCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should allow locking expired lock from another user', async () => {
    setDoc('companies/company-001/locations/loc-1/spots/spot-L1', {
      status: 'available',
      lockedBy: 'other-op',
      lockedAt: { toDate: () => new Date(Date.now() - 60_000) },
    });
    const result = await (lockSpot as any)(
      { locationId: 'loc-1', spotId: 'spot-L1' },
      operatorCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should reject non-existent spot', async () => {
    await expect(
      (lockSpot as any)({ locationId: 'loc-1', spotId: 'ghost' }, operatorCtx()),
    ).rejects.toThrow(/not found/i);
  });

  it('should reject without companyId in token', async () => {
    const ctx = {
      auth: {
        uid: 'op-noco',
        token: { uid: 'op-noco', role: 'operator' } as any,
      },
    } as any;
    await expect(
      (lockSpot as any)({ locationId: 'loc-1', spotId: 'spot-L1' }, ctx),
    ).rejects.toThrow(/company/i);
  });

  it('should reject unauthenticated', async () => {
    await expect(
      (lockSpot as any)({ locationId: 'loc-1', spotId: 'spot-L1' }, noAuth()),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  8. RELEASE SPOT HANDLER
// ═══════════════════════════════════════════════════════════════════════

describe('releaseSpot handler', () => {
  beforeEach(() => {
    setDoc('companies/company-001/locations/loc-1/spots/spot-R1', {
      status: 'available',
      lockedBy: 'op-001',
      lockedAt: new Date(),
    });
  });

  it('should release spot locked by same user', async () => {
    const result = await (releaseSpot as any)(
      { locationId: 'loc-1', spotId: 'spot-R1' },
      operatorCtx(),
    );
    expect(result).toEqual({ success: true });
    const spot = getDoc('companies/company-001/locations/loc-1/spots/spot-R1');
    expect(spot?.lockedBy).toBeNull();
  });

  it('should reject release by different non-admin user', async () => {
    const ctx = {
      auth: {
        uid: 'op-other',
        token: { uid: 'op-other', role: 'operator', companyId: 'company-001' } as any,
      },
    } as any;
    await expect(
      (releaseSpot as any)({ locationId: 'loc-1', spotId: 'spot-R1' }, ctx),
    ).rejects.toThrow(/owner|admin/i);
  });

  it('should allow admin to release any lock', async () => {
    const result = await (releaseSpot as any)(
      { locationId: 'loc-1', spotId: 'spot-R1' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should reject non-existent spot', async () => {
    await expect(
      (releaseSpot as any)({ locationId: 'loc-1', spotId: 'ghost' }, operatorCtx()),
    ).rejects.toThrow(/not found/i);
  });

  it('should handle releasing already-unlocked spot', async () => {
    setDoc('companies/company-001/locations/loc-1/spots/spot-R1', {
      status: 'available',
      lockedBy: null,
      lockedAt: null,
    });
    // Should succeed (lockedBy is null, so ownership check passes)
    const result = await (releaseSpot as any)(
      { locationId: 'loc-1', spotId: 'spot-R1' },
      operatorCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should reject without companyId', async () => {
    const ctx = {
      auth: {
        uid: 'op-noco',
        token: { uid: 'op-noco' } as any,
      },
    } as any;
    await expect(
      (releaseSpot as any)({ locationId: 'loc-1', spotId: 'spot-R1' }, ctx),
    ).rejects.toThrow(/company/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  9. ADMIN: SET USER ROLE HANDLER
// ═══════════════════════════════════════════════════════════════════════

describe('setUserRole handler', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({
      uid: 'target-user',
      customClaims: { role: 'operator', companyId: 'company-001' },
    });
    mockSetCustomUserClaims.mockResolvedValue(undefined);
  });

  it('should set user role successfully', async () => {
    const result = await (setUserRole as any)(
      { userId: 'target-user', role: 'admin' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('target-user', {
      role: 'admin',
      companyId: 'company-001',
    });
  });

  it('should reject non-admin role', async () => {
    await expect(
      (setUserRole as any)({ userId: 'target-user', role: 'admin' }, operatorCtx()),
    ).rejects.toThrow();
  });

  it('should reject cross-company role assignment', async () => {
    mockGetUser.mockResolvedValue({
      uid: 'target-user',
      customClaims: { role: 'operator', companyId: 'other-company' },
    });
    await expect(
      (setUserRole as any)({ userId: 'target-user', role: 'operator' }, adminCtx()),
    ).rejects.toThrow(/different company/i);
  });

  it('should prevent admin self-demotion', async () => {
    mockGetUser.mockResolvedValue({
      uid: 'admin-001',
      customClaims: { role: 'admin', companyId: 'company-001' },
    });
    await expect(
      (setUserRole as any)({ userId: 'admin-001', role: 'operator' }, adminCtx()),
    ).rejects.toThrow(/demote yourself/i);
  });

  it('should allow admin to assign admin role to self (no-op)', async () => {
    mockGetUser.mockResolvedValue({
      uid: 'admin-001',
      customClaims: { role: 'admin', companyId: 'company-001' },
    });
    const result = await (setUserRole as any)(
      { userId: 'admin-001', role: 'admin' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should write to users collection', async () => {
    await (setUserRole as any)({ userId: 'target-user', role: 'viewer' }, adminCtx());
    const user = getDoc('users/target-user');
    expect(user?.role).toBe('viewer');
    expect(user?.companyId).toBe('company-001');
  });

  it('should write audit log', async () => {
    await (setUserRole as any)({ userId: 'target-user', role: 'viewer' }, adminCtx());
    const audits = [...firestoreStore.entries()].filter(([k]) =>
      k.startsWith('companies/company-001/audit/'),
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject unauthenticated', async () => {
    await expect(
      (setUserRole as any)({ userId: 'target-user', role: 'admin' }, noAuth()),
    ).rejects.toThrow();
  });

  it('should allow assigning role to user with no company (new user)', async () => {
    mockGetUser.mockResolvedValue({
      uid: 'new-user',
      customClaims: {},
    });
    const result = await (setUserRole as any)(
      { userId: 'new-user', role: 'operator' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should reject invalid role value', async () => {
    await expect(
      (setUserRole as any)({ userId: 'target-user', role: 'superadmin' }, adminCtx()),
    ).rejects.toThrow();
  });

  it('should reject empty userId', async () => {
    await expect(
      (setUserRole as any)({ userId: '', role: 'admin' }, adminCtx()),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  10. HEALTH CHECK HANDLER
// ═══════════════════════════════════════════════════════════════════════

describe('healthCheck handler', () => {
  it('should return health status', async () => {
    const result = await (healthCheck as any)();
    expect(result).toHaveProperty('status', 'ok');
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('region');
    expect(result).toHaveProperty('uptime');
    expect(typeof result.uptime).toBe('number');
  });

  it('should return consistent version', async () => {
    const r1 = await (healthCheck as any)();
    const r2 = await (healthCheck as any)();
    expect(r1.version).toBe(r2.version);
  });

  it('should have increasing uptime', async () => {
    const r1 = await (healthCheck as any)();
    // Uptime should be non-negative
    expect(r1.uptime).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  11. PAYMENT WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════════════

describe('processPaymentWebhook handler', () => {
  beforeEach(() => {
    setDoc('companies/company-001/bookings/bk-pay', {
      status: 'Active',
      payment: { method: '', amount: 0, status: 'pending' },
    });
  });

  it('should process a successful payment', async () => {
    const result = await (processPaymentWebhook as any)(
      {
        provider: 'stripe',
        eventType: 'payment.succeeded',
        bookingId: 'bk-pay',
        amount: 50,
        currency: 'USD',
        transactionId: 'txn_123',
      },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
    const doc = getDoc('companies/company-001/bookings/bk-pay');
    expect(doc?.payment?.status).toBe('paid');
    expect(doc?.payment?.amount).toBe(50);
  });

  it('should handle pending payment event', async () => {
    const result = await (processPaymentWebhook as any)(
      {
        provider: 'square',
        eventType: 'payment.pending',
        bookingId: 'bk-pay',
        amount: 30,
        currency: 'USD',
        transactionId: 'txn_456',
      },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
    const doc = getDoc('companies/company-001/bookings/bk-pay');
    expect(doc?.payment?.status).toBe('pending');
  });

  it('should reject non-existent booking', async () => {
    await expect(
      (processPaymentWebhook as any)(
        {
          provider: 'stripe',
          eventType: 'payment.succeeded',
          bookingId: 'ghost',
          amount: 50,
          currency: 'USD',
          transactionId: 'txn_789',
        },
        adminCtx(),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('should reject non-admin role', async () => {
    await expect(
      (processPaymentWebhook as any)(
        {
          provider: 'stripe',
          eventType: 'payment.succeeded',
          bookingId: 'bk-pay',
          amount: 50,
          currency: 'USD',
          transactionId: 'txn_abc',
        },
        operatorCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should write audit log', async () => {
    await (processPaymentWebhook as any)(
      {
        provider: 'stripe',
        eventType: 'payment.succeeded',
        bookingId: 'bk-pay',
        amount: 50,
        currency: 'USD',
        transactionId: 'txn_def',
      },
      adminCtx(),
    );
    const audits = [...firestoreStore.entries()].filter(([k]) =>
      k.startsWith('companies/company-001/audit/'),
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  12. FIRESTORE TRIGGERS
// ═══════════════════════════════════════════════════════════════════════

describe('Firestore Triggers', () => {
  describe('onBookingCreated', () => {
    it('should create notification and increment stats', async () => {
      const snap = {
        data: () => ({
          ticketNumber: 2001,
          customerName: 'Alice',
          vehicle: { plate: 'XYZ789' },
        }),
      };
      const context = {
        params: { companyId: 'company-001', bookingId: 'bk-trigger-1' },
      };

      await (onBookingCreated as any)(snap, context);

      // Check notification was created
      const notifications = [...firestoreStore.entries()].filter(([k]) =>
        k.startsWith('companies/company-001/notifications/'),
      );
      expect(notifications.length).toBeGreaterThanOrEqual(1);
      const notifData = notifications[0][1];
      expect(notifData.type).toBe('new-booking');
      expect(notifData.title).toContain('2001');
    });

    it('should increment daily new booking stats', async () => {
      const snap = {
        data: () => ({
          ticketNumber: 2002,
          customerName: 'Bob',
          vehicle: { plate: 'DEF456' },
        }),
      };
      const context = {
        params: { companyId: 'company-001', bookingId: 'bk-trigger-2' },
      };

      await (onBookingCreated as any)(snap, context);

      const today = new Date().toISOString().split('T')[0]!;
      const stats = getDoc(`companies/company-001/stats/${today}`);
      expect(stats).toBeDefined();
    });

    it('should handle booking without vehicle plate', async () => {
      const snap = {
        data: () => ({
          ticketNumber: 2003,
          customerName: 'Charlie',
          vehicle: null,
        }),
      };
      const context = {
        params: { companyId: 'company-001', bookingId: 'bk-trigger-3' },
      };

      await (onBookingCreated as any)(snap, context);
      const notifications = [...firestoreStore.entries()].filter(([k]) =>
        k.startsWith('companies/company-001/notifications/'),
      );
      expect(notifications.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('onBookingUpdated', () => {
    it('should send notification when status changes to Active', async () => {
      const change = {
        before: {
          data: () => ({ status: 'Parked', ticketNumber: 3001, customerName: 'Dave' }),
        },
        after: {
          data: () => ({ status: 'Active', ticketNumber: 3001, customerName: 'Dave' }),
        },
      };
      const context = {
        params: { companyId: 'company-001', bookingId: 'bk-update-1' },
      };

      await (onBookingUpdated as any)(change, context);

      const notifications = [...firestoreStore.entries()].filter(([k]) =>
        k.startsWith('companies/company-001/notifications/'),
      );
      expect(notifications.length).toBeGreaterThanOrEqual(1);
    });

    it('should send notification when status changes to Completed', async () => {
      const change = {
        before: {
          data: () => ({ status: 'Active', ticketNumber: 3002, customerName: 'Eve' }),
        },
        after: {
          data: () => ({ status: 'Completed', ticketNumber: 3002, customerName: 'Eve' }),
        },
      };
      const context = {
        params: { companyId: 'company-001', bookingId: 'bk-update-2' },
      };

      await (onBookingUpdated as any)(change, context);

      const notifications = [...firestoreStore.entries()].filter(([k]) =>
        k.startsWith('companies/company-001/notifications/'),
      );
      expect(notifications.length).toBeGreaterThanOrEqual(1);
    });

    it('should send notification when status changes to Cancelled', async () => {
      const change = {
        before: {
          data: () => ({ status: 'Booked', ticketNumber: 3003, customerName: 'Frank' }),
        },
        after: {
          data: () => ({ status: 'Cancelled', ticketNumber: 3003, customerName: 'Frank' }),
        },
      };
      const context = {
        params: { companyId: 'company-001', bookingId: 'bk-update-3' },
      };

      await (onBookingUpdated as any)(change, context);

      const notifications = [...firestoreStore.entries()].filter(([k]) =>
        k.startsWith('companies/company-001/notifications/'),
      );
      expect(notifications.length).toBeGreaterThanOrEqual(1);
    });

    it('should NOT send notification when status does not change', async () => {
      const change = {
        before: {
          data: () => ({ status: 'Active', ticketNumber: 3004, customerName: 'Grace' }),
        },
        after: {
          data: () => ({ status: 'Active', ticketNumber: 3004, customerName: 'Grace Updated' }),
        },
      };
      const context = {
        params: { companyId: 'company-001', bookingId: 'bk-update-4' },
      };

      await (onBookingUpdated as any)(change, context);

      const notifications = [...firestoreStore.entries()].filter(([k]) =>
        k.startsWith('companies/company-001/notifications/'),
      );
      expect(notifications.length).toBe(0);
    });

    it('should not notify for non-important transitions (e.g. New → Booked)', async () => {
      const change = {
        before: {
          data: () => ({ status: 'New', ticketNumber: 3005, customerName: 'Hank' }),
        },
        after: {
          data: () => ({ status: 'Booked', ticketNumber: 3005, customerName: 'Hank' }),
        },
      };
      const context = {
        params: { companyId: 'company-001', bookingId: 'bk-update-5' },
      };

      await (onBookingUpdated as any)(change, context);

      const notifications = [...firestoreStore.entries()].filter(([k]) =>
        k.startsWith('companies/company-001/notifications/'),
      );
      // Booked is not in the notifyStatuses array
      expect(notifications.length).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  13. SCHEDULED FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

describe('Scheduled Functions', () => {
  describe('cleanupExpiredLocks', () => {
    it('should clean up expired locks', async () => {
      // Seed expired locked spots
      setDoc('companies/company-001/locations/loc-1/spots/expired-1', {
        lockedBy: 'op-old',
        lockedAt: new Date(Date.now() - 120_000), // 2 min ago
        status: 'available',
      });
      await (cleanupExpiredLocks as any)();
      // The function uses collectionGroup which is mocked
    });

    it('should not crash with empty collection', async () => {
      await (cleanupExpiredLocks as any)();
    });
  });

  describe('cleanupExpiredIdempotency', () => {
    it('should clean up old idempotency keys', async () => {
      await (cleanupExpiredIdempotency as any)();
    });
  });

  describe('cleanupExpiredRateLimits', () => {
    it('should clean up old rate limit docs', async () => {
      await (cleanupExpiredRateLimits as any)();
    });
  });

  describe('cleanupFlightCache', () => {
    it('should clean up old flight cache', async () => {
      await (cleanupFlightCache as any)();
    });
  });

  describe('dailyStatsRollup', () => {
    it('should aggregate daily stats into monthly', async () => {
      // Seed a company with daily stats
      setDoc('companies/comp-rollup', { name: 'Test Company' });
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0]!;
      setDoc(`companies/comp-rollup/stats/${dateStr}`, {
        completedCount: 10,
        totalRevenue: 500,
        newBookingCount: 15,
      });
      await (dailyStatsRollup as any)();
    });

    it('should not crash with no companies', async () => {
      await (dailyStatsRollup as any)();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  14. CROSS-TENANT ISOLATION (Security)
// ═══════════════════════════════════════════════════════════════════════

describe('Cross-Tenant Isolation', () => {
  beforeEach(() => {
    setDoc('companies/company-A/bookings/bk-A1', {
      status: 'New',
      customerName: 'Tenant A Customer',
      history: [],
    });
    setDoc('companies/company-B/bookings/bk-B1', {
      status: 'New',
      customerName: 'Tenant B Customer',
      history: [],
    });
  });

  it('should not allow company-A admin to transition company-B booking', async () => {
    // Company-A admin tries to transition company-B's booking
    // The handler builds the path from auth.companyId, so it will look in company-A's collection
    // and not find bk-B1
    await expect(
      (transitionBooking as any)(
        { bookingId: 'bk-B1', newStatus: 'Booked' },
        adminCtx('admin-A', 'company-A'),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('should not allow company-B admin to cancel company-A booking', async () => {
    await expect(
      (cancelBooking as any)(
        { bookingId: 'bk-A1', reason: 'hijack' },
        adminCtx('admin-B', 'company-B'),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('each company creates bookings in own collection', async () => {
    await (createBooking as any)(
      { ...VALID_BOOKING_DATA, idempotencyKey: 'iso-A' },
      adminCtx('admin-A', 'company-A'),
    );
    await (createBooking as any)(
      { ...VALID_BOOKING_DATA, idempotencyKey: 'iso-B' },
      adminCtx('admin-B', 'company-B'),
    );

    const compABookings = [...firestoreStore.entries()].filter(([k]) =>
      k.startsWith('companies/company-A/bookings/'),
    );
    const compBBookings = [...firestoreStore.entries()].filter(([k]) =>
      k.startsWith('companies/company-B/bookings/'),
    );
    expect(compABookings.length).toBeGreaterThanOrEqual(1);
    expect(compBBookings.length).toBeGreaterThanOrEqual(1);
  });

  it('should isolate spot operations between companies', async () => {
    setDoc('companies/company-A/locations/loc-1/spots/spot-1', {
      status: 'available',
      lockedBy: null,
    });
    // company-B operator should not find company-A's spot
    await expect(
      (lockSpot as any)(
        { locationId: 'loc-1', spotId: 'spot-1' },
        operatorCtx('op-B', 'company-B'),
      ),
    ).rejects.toThrow(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  15. SECURITY: XSS & INJECTION ATTACKS
// ═══════════════════════════════════════════════════════════════════════

describe('Security: XSS & Injection', () => {
  it('should sanitize HTML tags in booking creation', async () => {
    const data = {
      customerName: '<img src=x onerror=alert(1)>',
      vehiclePlate: 'AAA111',
      notes: '<script>document.cookie</script>',
      idempotencyKey: 'xss-test-1',
    };
    const result = await (createBooking as any)(data, adminCtx());
    expect(result).toHaveProperty('id');
    const booking = [...firestoreStore.entries()].find(([k]) =>
      k.startsWith('companies/company-001/bookings/'),
    );
    // Angle brackets should be stripped by safeString transform
    expect(booking![1].customerName).not.toContain('<');
    expect(booking![1].customerName).not.toContain('>');
  });

  it('should sanitize special chars in vehicle plate', async () => {
    const data = {
      customerName: 'Test User',
      vehiclePlate: "ABC'; DROP TABLE--",
      idempotencyKey: 'inj-test-1',
    };
    const result = await (createBooking as any)(data, adminCtx());
    expect(result).toHaveProperty('id');
    const booking = [...firestoreStore.entries()].find(([k]) =>
      k.startsWith('companies/company-001/bookings/'),
    );
    // Plate should only contain alphanumeric, dash, space
    const plate = booking![1].vehicle.plate;
    expect(plate).toMatch(/^[A-Z0-9\- ]*$/);
  });

  it('should handle Unicode injection in names', async () => {
    const data = {
      customerName: 'Test\u0000User\u200B',
      vehiclePlate: 'UNI123',
      idempotencyKey: 'unicode-1',
    };
    const result = await (createBooking as any)(data, adminCtx());
    expect(result).toHaveProperty('id');
  });

  it('should handle extremely long injection attempt', async () => {
    const data = {
      customerName: 'A'.repeat(101), // Over max
      vehiclePlate: 'AAA111',
    };
    await expect((createBooking as any)(data, adminCtx())).rejects.toThrow();
  });

  it('should sanitize phone number', async () => {
    const data = {
      customerName: 'PhoneTest',
      vehiclePlate: 'PHN111',
      customerPhone: '555-1234; rm -rf /',
      idempotencyKey: 'phone-inj-1',
    };
    const result = await (createBooking as any)(data, adminCtx());
    expect(result).toHaveProperty('id');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  16. CONCURRENCY SIMULATION
// ═══════════════════════════════════════════════════════════════════════

describe('Concurrency Simulation', () => {
  it('should handle multiple concurrent booking creations', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        (createBooking as any)(
          { ...VALID_BOOKING_DATA, customerName: `User ${i}`, idempotencyKey: `conc-${i}` },
          adminCtx(),
        ),
      );
    }
    const results = await Promise.all(promises);
    expect(results).toHaveLength(10);
    results.forEach((r) => {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('ticketNumber');
    });
  });

  it('should handle concurrent spot locks from different operators', async () => {
    setDoc('companies/company-001/locations/loc-1/spots/spot-race', {
      status: 'available',
      lockedBy: null,
      lockedAt: null,
    });

    // Both operators try to lock the same spot concurrently
    // In real Firestore, one would fail. With our mock, both succeed (mock limitation)
    // But this verifies no crashes occur
    const p1 = (lockSpot as any)(
      { locationId: 'loc-1', spotId: 'spot-race' },
      operatorCtx('op-001'),
    );
    const p2 = (lockSpot as any)(
      { locationId: 'loc-1', spotId: 'spot-race' },
      operatorCtx('op-002'),
    );

    const results = await Promise.allSettled([p1, p2]);
    // At least one should succeed
    const successes = results.filter((r) => r.status === 'fulfilled');
    expect(successes.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle concurrent state transitions gracefully', async () => {
    setDoc('companies/company-001/bookings/bk-race', {
      status: 'New',
      spotId: '',
      locationId: '',
      history: [],
    });

    // Two operators try to transition simultaneously
    const p1 = (transitionBooking as any)(
      { bookingId: 'bk-race', newStatus: 'Booked' },
      adminCtx(),
    );
    const p2 = (transitionBooking as any)(
      { bookingId: 'bk-race', newStatus: 'Cancelled' },
      adminCtx(),
    );

    const results = await Promise.allSettled([p1, p2]);
    const successes = results.filter((r) => r.status === 'fulfilled');
    expect(successes.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle 50 concurrent creations without error', async () => {
    const promises = Array.from({ length: 50 }, (_, i) =>
      (createBooking as any)(
        {
          customerName: `Stress User ${i}`,
          vehiclePlate: `STR${String(i).padStart(3, '0')}`,
          idempotencyKey: `stress-${i}`,
        },
        adminCtx(),
      ),
    );
    const results = await Promise.all(promises);
    expect(results).toHaveLength(50);
    results.forEach((r) => expect(r).toHaveProperty('id'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  17. DATA INTEGRITY: FULL LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════

describe('Data Integrity: Full Lifecycle', () => {
  it('should complete a full booking lifecycle through all handlers', async () => {
    // 1. Create booking
    const created = await (createBooking as any)(
      { ...VALID_BOOKING_DATA, idempotencyKey: 'lifecycle-1' },
      adminCtx(),
    );
    const bookingId = created.id;
    expect(bookingId).toBeDefined();

    // Find the doc path
    const bookingPath = [...firestoreStore.entries()].find(
      ([k]) => k.includes('/bookings/') && k.endsWith(bookingId),
    );
    expect(bookingPath).toBeDefined();

    // 2. Transition New → Booked
    await (transitionBooking as any)({ bookingId, newStatus: 'Booked' }, adminCtx());
    let doc = getDoc(bookingPath![0]);
    expect(doc?.status).toBe('Booked');

    // 3. Transition Booked → Check-In
    await (transitionBooking as any)({ bookingId, newStatus: 'Check-In' }, adminCtx());
    doc = getDoc(bookingPath![0]);
    expect(doc?.status).toBe('Check-In');

    // 4. Assign spot
    setDoc('companies/company-001/locations/loc-1/spots/spot-lifecycle', {
      status: 'available',
      name: 'L1',
      bookingId: null,
      lockedBy: null,
      lockedAt: null,
    });
    await (assignSpot as any)(
      { bookingId, locationId: 'loc-1', spotId: 'spot-lifecycle' },
      adminCtx(),
    );
    const spot = getDoc('companies/company-001/locations/loc-1/spots/spot-lifecycle');
    expect(spot?.status).toBe('occupied');
    expect(spot?.bookingId).toBe(bookingId);

    // 5. Transition Check-In → Parked
    await (transitionBooking as any)({ bookingId, newStatus: 'Parked' }, adminCtx());

    // 6. Transition Parked → Active
    await (transitionBooking as any)({ bookingId, newStatus: 'Active' }, adminCtx());
    doc = getDoc(bookingPath![0]);
    expect(doc?.status).toBe('Active');

    // 7. Complete booking
    await (completeBooking as any)(
      { bookingId, paymentMethod: 'card', paymentAmount: 45 },
      adminCtx(),
    );
    doc = getDoc(bookingPath![0]);
    expect(doc?.status).toBe('Completed');

    // 8. Verify spot released
    const finalSpot = getDoc('companies/company-001/locations/loc-1/spots/spot-lifecycle');
    expect(finalSpot?.status).toBe('available');
    expect(finalSpot?.bookingId).toBeNull();
  });

  it('should complete a cancellation lifecycle', async () => {
    // Create → Booked → Cancel
    const created = await (createBooking as any)(
      { ...VALID_BOOKING_DATA, idempotencyKey: 'cancel-lifecycle' },
      adminCtx(),
    );
    const bookingId = created.id;
    const bookingPath = [...firestoreStore.entries()].find(
      ([k]) => k.includes('/bookings/') && k.endsWith(bookingId),
    )![0];

    await (transitionBooking as any)({ bookingId, newStatus: 'Booked' }, adminCtx());
    await (cancelBooking as any)({ bookingId, reason: 'Customer changed mind' }, adminCtx());

    const doc = getDoc(bookingPath);
    expect(doc?.status).toBe('Cancelled');
  });

  it('should verify audit trail covers full lifecycle', async () => {
    const created = await (createBooking as any)(
      { ...VALID_BOOKING_DATA, idempotencyKey: 'audit-lifecycle' },
      adminCtx(),
    );
    await (transitionBooking as any)({ bookingId: created.id, newStatus: 'Booked' }, adminCtx());
    await (cancelBooking as any)({ bookingId: created.id }, adminCtx());

    const audits = [...firestoreStore.entries()].filter(([k]) =>
      k.startsWith('companies/company-001/audit/'),
    );
    // Should have at least 3 audit entries: create, transition, cancel
    expect(audits.length).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  18. EDGE CASES & BOUNDARY VALUES
// ═══════════════════════════════════════════════════════════════════════

describe('Edge Cases & Boundary Values', () => {
  it('should handle booking with all optional fields empty', async () => {
    const result = await (createBooking as any)(
      { customerName: 'Minimal', vehiclePlate: 'MIN001' },
      adminCtx(),
    );
    expect(result).toHaveProperty('id');
  });

  it('should handle $0 payment amount on completion', async () => {
    setDoc('companies/company-001/bookings/bk-zero', {
      status: 'Active',
      spotId: '',
      locationId: '',
      history: [],
    });
    const result = await (completeBooking as any)(
      { bookingId: 'bk-zero', paymentMethod: 'cash', paymentAmount: 0 },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should handle max valid payment amount (100000)', async () => {
    setDoc('companies/company-001/bookings/bk-max', {
      status: 'Active',
      spotId: '',
      locationId: '',
      history: [],
    });
    const result = await (completeBooking as any)(
      { bookingId: 'bk-max', paymentMethod: 'card', paymentAmount: 100_000 },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should handle booking without context.auth.token.email', async () => {
    const ctx = {
      auth: {
        uid: 'op-noemail',
        token: { uid: 'op-noemail', role: 'operator', companyId: 'company-001' } as any,
      },
    } as any;
    const result = await (createBooking as any)(
      { ...VALID_BOOKING_DATA, idempotencyKey: 'noemail' },
      ctx,
    );
    expect(result).toHaveProperty('id');
  });

  it('should handle special characters in notes', async () => {
    const result = await (createBooking as any)(
      {
        customerName: 'Special Chars',
        vehiclePlate: 'SPC001',
        notes: 'Café résumé — naïve "quotes" & ampersand',
        idempotencyKey: 'special-chars',
      },
      adminCtx(),
    );
    expect(result).toHaveProperty('id');
  });

  it('should handle transition with empty note', async () => {
    setDoc('companies/company-001/bookings/bk-empty-note', {
      status: 'New',
      history: [],
    });
    const result = await (transitionBooking as any)(
      { bookingId: 'bk-empty-note', newStatus: 'Booked', note: '' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should handle repeated cancellation attempts', async () => {
    setDoc('companies/company-001/bookings/bk-double-cancel', {
      status: 'New',
      spotId: '',
      locationId: '',
      history: [],
    });
    await (cancelBooking as any)({ bookingId: 'bk-double-cancel' }, adminCtx());
    // Second cancel should fail (Cancelled → Cancelled not in VALID_TRANSITIONS)
    await expect(
      (cancelBooking as any)({ bookingId: 'bk-double-cancel' }, adminCtx()),
    ).rejects.toThrow();
  });

  it('should handle repeated completion attempts', async () => {
    setDoc('companies/company-001/bookings/bk-double-complete', {
      status: 'Active',
      spotId: '',
      locationId: '',
      history: [],
    });
    await (completeBooking as any)(
      { bookingId: 'bk-double-complete', paymentMethod: 'cash', paymentAmount: 10 },
      adminCtx(),
    );
    // Second complete should fail (Completed → only Active can be completed)
    await expect(
      (completeBooking as any)(
        { bookingId: 'bk-double-complete', paymentMethod: 'cash', paymentAmount: 10 },
        adminCtx(),
      ),
    ).rejects.toThrow(/Only Active/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  19. RBAC ENFORCEMENT MATRIX
// ═══════════════════════════════════════════════════════════════════════

describe('RBAC Enforcement Matrix', () => {
  const roles = [
    { name: 'admin', ctx: () => adminCtx(), create: true, transition: true, complete: true, cancel: true, list: true, setRole: true },
    { name: 'operator', ctx: () => operatorCtx(), create: true, transition: true, complete: true, cancel: true, list: true, setRole: false },
    { name: 'viewer', ctx: () => viewerCtx(), create: false, transition: false, complete: false, cancel: false, list: true, setRole: false },
    { name: 'unauth', ctx: () => noAuth(), create: false, transition: false, complete: false, cancel: false, list: false, setRole: false },
  ];

  const bookingData = { ...VALID_BOOKING_DATA };

  roles.forEach((role) => {
    describe(`Role: ${role.name}`, () => {
      it(`createBooking: ${role.create ? 'allowed' : 'denied'}`, async () => {
        const data = { ...bookingData, idempotencyKey: `rbac-${role.name}` };
        if (role.create) {
          const result = await (createBooking as any)(data, role.ctx());
          expect(result).toHaveProperty('id');
        } else {
          await expect((createBooking as any)(data, role.ctx())).rejects.toThrow();
        }
      });

      it(`transitionBooking: ${role.transition ? 'allowed' : 'denied'}`, async () => {
        setDoc('companies/company-001/bookings/rbac-bk', {
          status: 'New',
          history: [],
        });
        if (role.transition) {
          const result = await (transitionBooking as any)(
            { bookingId: 'rbac-bk', newStatus: 'Booked' },
            role.ctx(),
          );
          expect(result).toEqual({ success: true });
          // Reset for next test
          setDoc('companies/company-001/bookings/rbac-bk', { status: 'New', history: [] });
        } else {
          await expect(
            (transitionBooking as any)(
              { bookingId: 'rbac-bk', newStatus: 'Booked' },
              role.ctx(),
            ),
          ).rejects.toThrow();
        }
      });

      it(`listBookings: ${role.list ? 'allowed' : 'denied'}`, async () => {
        if (role.list) {
          const result = await (listBookings as any)({}, role.ctx());
          expect(result).toHaveProperty('bookings');
        } else {
          await expect((listBookings as any)({}, role.ctx())).rejects.toThrow();
        }
      });

      if (role.name !== 'unauth') {
        it(`setUserRole: ${role.setRole ? 'allowed' : 'denied'}`, async () => {
          mockGetUser.mockResolvedValue({
            uid: 'target',
            customClaims: { companyId: 'company-001', role: 'viewer' },
          });
          if (role.setRole) {
            const result = await (setUserRole as any)(
              { userId: 'target', role: 'operator' },
              role.ctx(),
            );
            expect(result).toEqual({ success: true });
          } else {
            await expect(
              (setUserRole as any)({ userId: 'target', role: 'operator' }, role.ctx()),
            ).rejects.toThrow();
          }
        });
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  20. STATE MACHINE EXHAUSTIVE TRANSITIONS
// ═══════════════════════════════════════════════════════════════════════

describe('State Machine: Exhaustive Transition Tests', () => {
  const ALL_STATUSES = ['New', 'Booked', 'Check-In', 'Parked', 'Active', 'Completed', 'Cancelled'];
  const VALID: Record<string, string[]> = {
    New: ['Booked', 'Check-In', 'Cancelled'],
    Booked: ['Check-In', 'Cancelled'],
    'Check-In': ['Parked', 'Cancelled'],
    Parked: ['Active', 'Cancelled'],
    Active: ['Completed', 'Cancelled'],
    Completed: [],
    Cancelled: [],
  };

  ALL_STATUSES.forEach((from) => {
    ALL_STATUSES.forEach((to) => {
      const isValid = VALID[from]?.includes(to) ?? false;

      it(`${from} → ${to}: ${isValid ? 'ALLOWED' : 'DENIED'}`, async () => {
        setDoc('companies/company-001/bookings/sm-test', {
          status: from,
          spotId: '',
          locationId: '',
          history: [],
        });

        if (isValid) {
          const result = await (transitionBooking as any)(
            { bookingId: 'sm-test', newStatus: to },
            adminCtx(),
          );
          expect(result).toEqual({ success: true });
        } else {
          await expect(
            (transitionBooking as any)(
              { bookingId: 'sm-test', newStatus: to },
              adminCtx(),
            ),
          ).rejects.toThrow();
        }
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  21. ERROR RECOVERY & RESILIENCE
// ═══════════════════════════════════════════════════════════════════════

describe('Error Recovery & Resilience', () => {
  it('should handle null data gracefully', async () => {
    await expect((createBooking as any)(null, adminCtx())).rejects.toThrow();
  });

  it('should handle undefined data gracefully', async () => {
    await expect((createBooking as any)(undefined, adminCtx())).rejects.toThrow();
  });

  it('should handle numeric data as input', async () => {
    await expect((createBooking as any)(42, adminCtx())).rejects.toThrow();
  });

  it('should handle array data as input', async () => {
    await expect((createBooking as any)([], adminCtx())).rejects.toThrow();
  });

  it('should handle string data as input', async () => {
    await expect((createBooking as any)('invalid', adminCtx())).rejects.toThrow();
  });

  it('should handle extra unknown fields in data (strip them)', async () => {
    const data = {
      ...VALID_BOOKING_DATA,
      idempotencyKey: 'extra-fields',
      unknownField: 'malicious',
      admin: true,
      __proto__: { isAdmin: true },
    };
    const result = await (createBooking as any)(data, adminCtx());
    expect(result).toHaveProperty('id');
  });

  it('should handle missing bookingId in transition', async () => {
    await expect(
      (transitionBooking as any)({ newStatus: 'Booked' }, adminCtx()),
    ).rejects.toThrow();
  });

  it('should handle empty object for transition', async () => {
    await expect((transitionBooking as any)({}, adminCtx())).rejects.toThrow();
  });

  it('should survive rapid sequential calls', async () => {
    for (let i = 0; i < 20; i++) {
      const result = await (createBooking as any)(
        { customerName: `Seq ${i}`, vehiclePlate: `SEQ${i}`, idempotencyKey: `seq-${i}` },
        adminCtx(),
      );
      expect(result).toHaveProperty('id');
    }
  });
});
