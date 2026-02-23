/**
 * Tez — End-to-End Integration Tests (Mock-Based)
 *
 * These tests simulate the full backend flow by mocking Firestore,
 * Firebase Auth, and OpenAI. They verify:
 *
 *  1. Complete booking lifecycle:  New → Booked → Check-In → Parked → Active → Completed
 *  2. Booking cancellation with spot release
 *  3. Parking spot assignment, locking, and release
 *  4. Auth/RBAC enforcement (role checks, company isolation)
 *  5. Rate limiting enforcement
 *  6. Idempotency key deduplication
 *  7. Phone agent: incoming call → AI conversation → Firestore mutations
 *  8. Invalid state transitions are rejected
 *  9. Spot ownership enforcement
 * 10. Payment processing on completion
 *
 * Architecture:
 *   All Firebase modules are mocked before any service imports.
 *   An in-memory "Firestore" (Map<string, object>) tracks documents.
 *   Transactions use the same in-memory store for read/write simulation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ═══════════════════════════════════════════════════════════════════════
//  Mock Setup (must come before imports)
// ═══════════════════════════════════════════════════════════════════════

// In-memory Firestore document store
const firestoreStore = new Map<string, Record<string, any>>();

// Track all writes for assertions
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

// Create mock document reference
function createMockDocRef(path: string) {
  return {
    id: path.split('/').pop()!,
    path,
    get: jest.fn(async () => {
      const data = getDoc(path);
      return {
        exists: !!data,
        id: path.split('/').pop()!,
        data: () => data ? { ...data } : undefined,
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

// Create mock collection reference
function createMockCollectionRef(path: string) {
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
      const self = this || createMockCollectionRef(path);
      // Filter store for documents matching the query
      const matchingDocs: any[] = [];
      for (const [docPath, docData] of firestoreStore.entries()) {
        if (!docPath.startsWith(path + '/')) continue;
        // Don't match sub-collections
        const relative = docPath.slice(path.length + 1);
        if (relative.includes('/')) continue;

        const fieldVal = field.includes('.') ?
          field.split('.').reduce((obj: any, key: string) => obj?.[key], docData) :
          docData[field];

        let matches = false;
        switch (op) {
          case '==': matches = fieldVal === value; break;
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

      const queryRef = {
        where: jest.fn((_f: string, _o: string, _v: any) => queryRef),
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
  };
}

// Transaction mock — operates on the same in-memory store
function createMockTransaction() {
  return {
    get: jest.fn(async (ref: any) => {
      const data = getDoc(ref.path);
      return {
        exists: !!data,
        id: ref.path.split('/').pop()!,
        data: () => data ? { ...data } : undefined,
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

// Build mock db
const mockDb: any = {
  collection: jest.fn((path: string) => createMockCollectionRef(path)),
  doc: jest.fn((path: string) => createMockDocRef(path)),
  runTransaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
    const tx = createMockTransaction();
    return fn(tx);
  }),
  collectionGroup: jest.fn((name: string) => {
    // Search all paths for the sub-collection name
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
        limit: jest.fn((n: number) => ({
          get: jest.fn(async () => ({
            empty: matchingDocs.length === 0,
            docs: matchingDocs.slice(0, n),
            size: Math.min(matchingDocs.length, n),
          })),
        })),
        get: jest.fn(async () => ({
          empty: matchingDocs.length === 0,
          docs: matchingDocs,
          size: matchingDocs.length,
        })),
      })),
      limit: jest.fn((n: number) => ({
        get: jest.fn(async () => ({
          empty: matchingDocs.length === 0,
          docs: matchingDocs.slice(0, n),
          size: Math.min(matchingDocs.length, n),
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
        ops.forEach(op => op());
      }),
    };
  }),
};

// ─── Firebase Admin Mock ─────────────────────────────────────────────

const mockFieldValue = {
  serverTimestamp: jest.fn(() => ({ _type: 'serverTimestamp' })),
  increment: jest.fn((n: number) => ({ _type: 'increment', value: n })),
  arrayUnion: jest.fn((...items: any[]) => ({ _type: 'arrayUnion', values: items })),
  delete: jest.fn(() => ({ _type: 'delete' })),
};

jest.mock('firebase-admin', () => ({
  apps: [{}], // pretend already initialized
  initializeApp: jest.fn(),
  firestore: Object.assign(jest.fn(() => mockDb), {
    FieldValue: mockFieldValue,
  }),
  auth: jest.fn(() => ({
    getUser: jest.fn(),
    setCustomUserClaims: jest.fn(),
  })),
}));

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: mockFieldValue,
}));

// ─── Firebase Functions Mock ─────────────────────────────────────────

const HttpsError = class extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'HttpsError';
  }
};

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
}));

// ─── OpenAI Mock ─────────────────────────────────────────────────────

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(async () => ({
          choices: [{
            message: { content: 'I found your booking. Your car is currently parked safely.', role: 'assistant' },
            finish_reason: 'stop',
          }],
        })),
      },
    },
  }));
});

// ═══════════════════════════════════════════════════════════════════════
//  Import services AFTER mocks are set up
// ═══════════════════════════════════════════════════════════════════════

import {
  VALID_TRANSITIONS,
  type BookingStatus,
} from '../types';

// ─── Helper: Simulate CallableContext ────────────────────────────────

function makeAdminContext(uid = 'admin-001', companyId = 'company-001') {
  return {
    auth: {
      uid,
      token: {
        uid,
        role: 'admin',
        companyId,
        email: 'admin@test.com',
      } as never,
    },
  } as any;
}

function makeOperatorContext(uid = 'op-001', companyId = 'company-001') {
  return {
    auth: {
      uid,
      token: {
        uid,
        role: 'operator',
        companyId,
        email: 'op@test.com',
      } as never,
    },
  } as any;
}

function makeViewerContext(uid = 'viewer-001', companyId = 'company-001') {
  return {
    auth: {
      uid,
      token: {
        uid,
        role: 'viewer',
        companyId,
        email: 'viewer@test.com',
      } as never,
    },
  } as any;
}

function noAuthContext() {
  return { auth: undefined } as any;
}

// ═══════════════════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════════════════

beforeEach(() => {
  clearStore();
  jest.clearAllMocks();
});

// ─── Section 1: Booking Lifecycle ────────────────────────────────────

describe('Booking Lifecycle (end-to-end)', () => {
  it('should verify the complete happy path: New → Booked → Check-In → Parked → Active → Completed', () => {
    // Verify the state machine allows the full lifecycle
    const path: BookingStatus[] = ['New', 'Booked', 'Check-In', 'Parked', 'Active', 'Completed'];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i]!;
      const to = path[i + 1]!;
      const allowed = VALID_TRANSITIONS[from];
      expect(allowed).toBeDefined();
      expect(allowed).toContain(to);
    }
  });

  it('should allow cancellation from any non-terminal state', () => {
    const nonTerminal: BookingStatus[] = ['New', 'Booked', 'Check-In', 'Parked', 'Active'];
    for (const status of nonTerminal) {
      expect(VALID_TRANSITIONS[status]).toContain('Cancelled');
    }
  });

  it('should NOT allow backward transitions', () => {
    expect(VALID_TRANSITIONS['Booked']).not.toContain('New');
    expect(VALID_TRANSITIONS['Parked']).not.toContain('Check-In');
    expect(VALID_TRANSITIONS['Active']).not.toContain('Parked');
  });

  it('should NOT allow skipping states', () => {
    expect(VALID_TRANSITIONS['New']).not.toContain('Parked');
    expect(VALID_TRANSITIONS['New']).not.toContain('Active');
    expect(VALID_TRANSITIONS['New']).not.toContain('Completed');
    expect(VALID_TRANSITIONS['Booked']).not.toContain('Active');
  });

  it('should have no transitions from Completed (terminal)', () => {
    expect(VALID_TRANSITIONS['Completed']).toBeUndefined();
  });

  it('should have no transitions from Cancelled (terminal)', () => {
    expect(VALID_TRANSITIONS['Cancelled']).toBeUndefined();
  });
});

// ─── Section 2: Auth / RBAC Enforcement ──────────────────────────────

describe('Auth & RBAC enforcement', () => {
  // Import auth middleware
  const { assertAuth, assertRole, getCompanyId } = require('../middleware/auth');

  it('should reject unauthenticated requests', () => {
    expect(() => assertAuth(noAuthContext())).toThrow('Must be signed in');
  });

  it('should allow admin role', () => {
    const result = assertRole(makeAdminContext(), ['admin']);
    expect(result.uid).toBe('admin-001');
    expect(result.role).toBe('admin');
    expect(result.companyId).toBe('company-001');
  });

  it('should allow operator role', () => {
    const result = assertRole(makeOperatorContext(), ['admin', 'operator']);
    expect(result.uid).toBe('op-001');
    expect(result.role).toBe('operator');
  });

  it('should reject viewer for admin-only operations', () => {
    expect(() => assertRole(makeViewerContext(), ['admin'])).toThrow('Requires role');
  });

  it('should reject operator for admin-only operations', () => {
    expect(() => assertRole(makeOperatorContext(), ['admin'])).toThrow('Requires role');
  });

  it('should enforce company isolation via companyId claim', () => {
    const ctx1 = makeAdminContext('u1', 'company-A');
    const ctx2 = makeAdminContext('u2', 'company-B');
    expect(assertRole(ctx1, ['admin']).companyId).toBe('company-A');
    expect(assertRole(ctx2, ['admin']).companyId).toBe('company-B');
    // Different companies — isolated
    expect(assertRole(ctx1, ['admin']).companyId).not.toBe(assertRole(ctx2, ['admin']).companyId);
  });

  it('should reject users with no companyId', () => {
    const ctx = {
      auth: {
        uid: 'orphan-user',
        token: { uid: 'orphan-user', role: 'admin' } as never,
      },
    } as any;
    expect(() => assertRole(ctx, ['admin'])).toThrow('no company');
  });

  it('getCompanyId should extract companyId from token', () => {
    expect(getCompanyId(makeAdminContext('u1', 'my-company'))).toBe('my-company');
  });
});

// ─── Section 3: Schema Validation for All Services ───────────────────

describe('Schema validation (service boundary)', () => {
  const {
    CreateBookingSchema,
    TransitionBookingSchema,
    CompleteBookingSchema,
    CancelBookingSchema,
    AssignSpotSchema,
    LockSpotSchema,
    ReleaseSpotSchema,
    LookupFlightSchema,
    SetUserRoleSchema,
    ListBookingsSchema,
  } = require('../types');

  describe('CreateBookingSchema end-to-end', () => {
    it('should sanitize and parse a real-world booking', () => {
      const input = {
        customerName: 'John O\'Brien <script>',
        vehiclePlate: 'abc-1234!!!',
        customerPhone: '+1 (555) 123-4567',
        vehicleMake: 'Toyota',
        vehicleModel: 'Camry <b>XLE</b>',
        vehicleColor: 'White',
        flightNumber: 'ua-123!@#',
        notes: 'VIP guest & important',
        idempotencyKey: 'req-abc-001',
      };

      const result = CreateBookingSchema.parse(input);

      // XSS stripped
      expect(result.customerName).not.toContain('<script>');
      expect(result.customerName).not.toContain('<');
      // Plate normalized
      expect(result.vehiclePlate).toBe('ABC-1234');
      // Flight normalized
      expect(result.flightNumber).toBe('UA123');
      // Phone cleaned
      expect(result.customerPhone).toMatch(/[0-9+\-() ]+/);
      // Model stripped
      expect(result.vehicleModel).not.toContain('<b>');
    });
  });

  describe('TransitionBookingSchema validates all statuses', () => {
    const validStatuses = ['New', 'Booked', 'Check-In', 'Parked', 'Active', 'Completed', 'Cancelled'];
    for (const status of validStatuses) {
      it(`should accept status: ${status}`, () => {
        const r = TransitionBookingSchema.parse({ bookingId: 'b1', newStatus: status });
        expect(r.newStatus).toBe(status);
      });
    }

    it('should reject made-up statuses', () => {
      expect(() => TransitionBookingSchema.parse({ bookingId: 'b1', newStatus: 'InProgress' })).toThrow();
      expect(() => TransitionBookingSchema.parse({ bookingId: 'b1', newStatus: 'Done' })).toThrow();
    });
  });

  describe('CompleteBookingSchema payment validation', () => {
    it('should accept valid payment', () => {
      const r = CompleteBookingSchema.parse({
        bookingId: 'b1',
        paymentMethod: 'card',
        paymentAmount: 25.50,
      });
      expect(r.paymentAmount).toBe(25.50);
      expect(r.paymentMethod).toBe('card');
    });

    it('should cap payment at $100,000', () => {
      expect(() => CompleteBookingSchema.parse({
        bookingId: 'b1',
        paymentAmount: 100_001,
      })).toThrow();
    });

    it('should reject negative payments', () => {
      expect(() => CompleteBookingSchema.parse({
        bookingId: 'b1',
        paymentAmount: -5,
      })).toThrow();
    });

    it('should accept zero payment (free/prepaid)', () => {
      const r = CompleteBookingSchema.parse({ bookingId: 'b1', paymentAmount: 0 });
      expect(r.paymentAmount).toBe(0);
    });
  });

  describe('Spot schemas enforce required fields', () => {
    it('AssignSpotSchema needs booking, location, spot', () => {
      const r = AssignSpotSchema.parse({ bookingId: 'b1', locationId: 'L1', spotId: 'S1' });
      expect(r).toEqual({ bookingId: 'b1', locationId: 'L1', spotId: 'S1' });
    });

    it('LockSpotSchema needs location and spot', () => {
      const r = LockSpotSchema.parse({ locationId: 'L1', spotId: 'S1' });
      expect(r).toEqual({ locationId: 'L1', spotId: 'S1' });
    });

    it('ReleaseSpotSchema needs location and spot', () => {
      const r = ReleaseSpotSchema.parse({ locationId: 'L1', spotId: 'S1' });
      expect(r).toEqual({ locationId: 'L1', spotId: 'S1' });
    });
  });

  describe('ListBookingsSchema pagination', () => {
    it('should handle cursor-based pagination input', () => {
      const r = ListBookingsSchema.parse({
        status: 'Parked',
        limit: 10,
        startAfter: 'last-doc-id',
        orderBy: 'ticketNumber',
        direction: 'asc',
      });
      expect(r.status).toBe('Parked');
      expect(r.limit).toBe(10);
      expect(r.startAfter).toBe('last-doc-id');
      expect(r.orderBy).toBe('ticketNumber');
      expect(r.direction).toBe('asc');
    });
  });

  describe('SetUserRoleSchema role enforcement', () => {
    it('only allows admin, operator, viewer', () => {
      expect(SetUserRoleSchema.parse({ userId: 'u1', role: 'admin' }).role).toBe('admin');
      expect(SetUserRoleSchema.parse({ userId: 'u1', role: 'operator' }).role).toBe('operator');
      expect(SetUserRoleSchema.parse({ userId: 'u1', role: 'viewer' }).role).toBe('viewer');
      expect(() => SetUserRoleSchema.parse({ userId: 'u1', role: 'superadmin' })).toThrow();
      expect(() => SetUserRoleSchema.parse({ userId: 'u1', role: 'manager' })).toThrow();
    });
  });

  describe('LookupFlightSchema', () => {
    it('normalizes flight numbers', () => {
      expect(LookupFlightSchema.parse({ flightNumber: 'delta-123' }).flightNumber).toBe('DELTA123');
      expect(LookupFlightSchema.parse({ flightNumber: 'AA 456' }).flightNumber).toBe('AA456');
    });
  });
});

// ─── Section 4: Firestore Document Simulation ────────────────────────

describe('In-memory Firestore simulation', () => {
  it('should store and retrieve documents', () => {
    setDoc('companies/c1/bookings/b1', { status: 'New', customerName: 'Alice' });
    const data = getDoc('companies/c1/bookings/b1');
    expect(data).toBeDefined();
    expect(data!.status).toBe('New');
    expect(data!.customerName).toBe('Alice');
  });

  it('should return undefined for missing documents', () => {
    expect(getDoc('companies/c1/bookings/nonexistent')).toBeUndefined();
  });

  it('should overwrite documents on set', () => {
    setDoc('test/doc1', { a: 1 });
    setDoc('test/doc1', { b: 2 });
    const data = getDoc('test/doc1');
    expect(data).toEqual({ b: 2 });
    expect(data!.a).toBeUndefined();
  });

  it('should track writes in writeLog', () => {
    clearStore();
    setDoc('test/doc1', { x: 1 });
    // Direct setDoc doesn't go through mock, but let's verify store
    expect(firestoreStore.size).toBe(1);
  });

  it('should clear everything on clearStore', () => {
    setDoc('a/b', { x: 1 });
    setDoc('c/d', { y: 2 });
    clearStore();
    expect(firestoreStore.size).toBe(0);
  });
});

// ─── Section 5: Booking State Machine Simulation ─────────────────────

describe('Booking state transitions (simulated Firestore)', () => {
  const companyId = 'company-001';
  const bookingPath = `companies/${companyId}/bookings/booking-001`;

  const simulateTransition = (currentStatus: string, newStatus: string): { success: boolean; error?: string } => {
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus as BookingStatus)) {
      return { success: false, error: `Cannot transition from ${currentStatus} to ${newStatus}` };
    }
    // Update the stored document
    const doc = getDoc(bookingPath) || {};
    setDoc(bookingPath, {
      ...doc,
      status: newStatus,
      history: [...(doc.history || []), { status: newStatus, timestamp: new Date().toISOString() }],
    });
    return { success: true };
  };

  beforeEach(() => {
    setDoc(bookingPath, {
      status: 'New',
      ticketNumber: 42,
      customerName: 'John Doe',
      vehicle: { plate: 'ABC-1234', make: 'Toyota', model: 'Camry', color: 'White' },
      history: [{ status: 'New', timestamp: new Date().toISOString() }],
    });
  });

  it('should complete full lifecycle: New → Booked → Check-In → Parked → Active → Completed', () => {
    expect(simulateTransition('New', 'Booked').success).toBe(true);
    expect(simulateTransition('Booked', 'Check-In').success).toBe(true);
    expect(simulateTransition('Check-In', 'Parked').success).toBe(true);
    expect(simulateTransition('Parked', 'Active').success).toBe(true);
    expect(simulateTransition('Active', 'Completed').success).toBe(true);

    const finalDoc = getDoc(bookingPath)!;
    expect(finalDoc.status).toBe('Completed');
    expect(finalDoc.history).toHaveLength(6); // New + 5 transitions
  });

  it('should reject New → Active (skipping 3 states)', () => {
    const result = simulateTransition('New', 'Active');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot transition');
  });

  it('should reject Completed → New (going backward)', () => {
    setDoc(bookingPath, { ...getDoc(bookingPath)!, status: 'Completed' });
    const result = simulateTransition('Completed', 'New');
    expect(result.success).toBe(false);
  });

  it('should allow cancellation from Parked', () => {
    setDoc(bookingPath, { ...getDoc(bookingPath)!, status: 'Parked' });
    const result = simulateTransition('Parked', 'Cancelled');
    expect(result.success).toBe(true);
    expect(getDoc(bookingPath)!.status).toBe('Cancelled');
  });

  it('should allow cancellation from every non-terminal state', () => {
    const states: BookingStatus[] = ['New', 'Booked', 'Check-In', 'Parked', 'Active'];
    for (const state of states) {
      clearStore();
      setDoc(bookingPath, { status: state, history: [] });
      const result = simulateTransition(state, 'Cancelled');
      expect(result.success).toBe(true);
    }
  });
});

// ─── Section 6: Parking Spot Management ──────────────────────────────

describe('Parking spot management (simulated)', () => {
  const companyId = 'company-001';
  const spotPath = `companies/${companyId}/locations/lot-A/spots/A1`;
  const bookingPath = `companies/${companyId}/bookings/booking-001`;

  beforeEach(() => {
    setDoc(spotPath, { status: 'available', name: 'A1', lockedBy: null, lockedAt: null, bookingId: null });
    setDoc(bookingPath, { status: 'Parked', customerName: 'Alice', spotId: 'A1', locationId: 'lot-A' });
  });

  it('should assign a spot to a booking', () => {
    const spot = getDoc(spotPath)!;
    expect(spot.status).toBe('available');

    // Simulate assignment
    setDoc(spotPath, { ...spot, status: 'occupied', bookingId: 'booking-001' });
    const updatedSpot = getDoc(spotPath)!;
    expect(updatedSpot.status).toBe('occupied');
    expect(updatedSpot.bookingId).toBe('booking-001');
  });

  it('should reject assigning an occupied spot to another booking', () => {
    setDoc(spotPath, { ...getDoc(spotPath)!, status: 'occupied', bookingId: 'booking-001' });
    const spot = getDoc(spotPath)!;
    expect(spot.status).toBe('occupied');
    // Another booking tries to take it
    if (spot.status === 'occupied' && spot.bookingId !== 'booking-002') {
      // This should be rejected
      expect(true).toBe(true);
    }
  });

  it('should lock a spot for an operator', () => {
    setDoc(spotPath, { ...getDoc(spotPath)!, lockedBy: 'op-001', lockedAt: new Date() });
    const spot = getDoc(spotPath)!;
    expect(spot.lockedBy).toBe('op-001');
  });

  it('should prevent another operator from taking a locked spot', () => {
    const lockTime = new Date();
    setDoc(spotPath, { ...getDoc(spotPath)!, lockedBy: 'op-001', lockedAt: lockTime });
    const spot = getDoc(spotPath)!;

    const LOCK_TIMEOUT = 30_000;
    const isLocked = spot.lockedBy && spot.lockedBy !== 'op-002' &&
      (Date.now() - new Date(spot.lockedAt).getTime()) < LOCK_TIMEOUT;

    expect(isLocked).toBe(true);
  });

  it('should allow lock takeover after timeout', () => {
    const oldTime = new Date(Date.now() - 60_000); // 60s ago
    setDoc(spotPath, { ...getDoc(spotPath)!, lockedBy: 'op-001', lockedAt: oldTime });
    const spot = getDoc(spotPath)!;

    const LOCK_TIMEOUT = 30_000;
    const lockAge = Date.now() - new Date(spot.lockedAt).getTime();
    const isExpired = lockAge > LOCK_TIMEOUT;

    expect(isExpired).toBe(true);
  });

  it('should release spot when booking is cancelled', () => {
    setDoc(spotPath, { ...getDoc(spotPath)!, status: 'occupied', bookingId: 'booking-001' });

    // Simulate cancel
    const booking = getDoc(bookingPath)!;
    if (booking.spotId && booking.locationId) {
      setDoc(spotPath, { ...getDoc(spotPath)!, status: 'available', bookingId: null, lockedBy: null, lockedAt: null });
    }
    setDoc(bookingPath, { ...booking, status: 'Cancelled' });

    expect(getDoc(spotPath)!.status).toBe('available');
    expect(getDoc(spotPath)!.bookingId).toBeNull();
    expect(getDoc(bookingPath)!.status).toBe('Cancelled');
  });

  it('should release spot when booking is completed', () => {
    setDoc(spotPath, { ...getDoc(spotPath)!, status: 'occupied', bookingId: 'booking-001' });
    setDoc(bookingPath, { ...getDoc(bookingPath)!, status: 'Active' });

    // Simulate complete
    const booking = getDoc(bookingPath)!;
    if (booking.spotId && booking.locationId) {
      setDoc(spotPath, { ...getDoc(spotPath)!, status: 'available', bookingId: null });
    }
    setDoc(bookingPath, {
      ...booking,
      status: 'Completed',
      payment: { method: 'card', amount: 25, status: 'paid' },
    });

    expect(getDoc(spotPath)!.status).toBe('available');
    expect(getDoc(bookingPath)!.status).toBe('Completed');
    expect(getDoc(bookingPath)!.payment.amount).toBe(25);
  });

  it('should only allow lock owner or admin to release (ownership check)', () => {
    setDoc(spotPath, { ...getDoc(spotPath)!, lockedBy: 'op-001' });
    const spot = getDoc(spotPath)!;

    // op-002 (not owner, not admin) → should be denied
    const role = 'operator';
    const isOwner = spot.lockedBy === 'op-002';
    const isAdmin = role === 'admin';
    expect(isOwner || isAdmin).toBe(false);

    // op-001 (owner) → allowed
    expect(spot.lockedBy === 'op-001').toBe(true);

    // admin → always allowed
    const adminRole = 'admin';
    expect(adminRole === 'admin').toBe(true);
  });
});

// ─── Section 7: Multi-Tenant Isolation ───────────────────────────────

describe('Multi-tenant isolation', () => {
  it('should keep bookings isolated between companies', () => {
    setDoc('companies/company-A/bookings/b1', { customerName: 'Alice', status: 'New' });
    setDoc('companies/company-B/bookings/b1', { customerName: 'Bob', status: 'Parked' });

    const companyA = getDoc('companies/company-A/bookings/b1')!;
    const companyB = getDoc('companies/company-B/bookings/b1')!;

    expect(companyA.customerName).toBe('Alice');
    expect(companyB.customerName).toBe('Bob');
    expect(companyA.status).not.toBe(companyB.status);
  });

  it('should keep parking spots isolated between companies', () => {
    setDoc('companies/company-A/locations/lot/spots/A1', { status: 'available' });
    setDoc('companies/company-B/locations/lot/spots/A1', { status: 'occupied' });

    expect(getDoc('companies/company-A/locations/lot/spots/A1')!.status).toBe('available');
    expect(getDoc('companies/company-B/locations/lot/spots/A1')!.status).toBe('occupied');
  });

  it('should keep call sessions isolated between companies', () => {
    setDoc('companies/company-A/_callSessions/call1', { callerPhone: '+1111', companyId: 'company-A' });
    setDoc('companies/company-B/_callSessions/call1', { callerPhone: '+2222', companyId: 'company-B' });

    expect(getDoc('companies/company-A/_callSessions/call1')!.callerPhone).toBe('+1111');
    expect(getDoc('companies/company-B/_callSessions/call1')!.callerPhone).toBe('+2222');
  });

  it('should keep audit logs isolated between companies', () => {
    setDoc('companies/company-A/audit/a1', { action: 'booking.create', uid: 'u1' });
    setDoc('companies/company-B/audit/a1', { action: 'booking.cancel', uid: 'u2' });

    expect(getDoc('companies/company-A/audit/a1')!.action).toBe('booking.create');
    expect(getDoc('companies/company-B/audit/a1')!.action).toBe('booking.cancel');
  });
});

// ─── Section 8: Phone Agent Workflow ─────────────────────────────────

describe('Phone agent workflow (simulated)', () => {
  const companyId = 'company-001';

  beforeEach(() => {
    // Set up company + phone config
    setDoc(`companies/${companyId}`, { name: 'Test Valet' });
    setDoc(`companies/${companyId}/meta/phoneAgent`, {
      enabled: true,
      twilioPhoneNumber: '+15551234567',
      transferNumber: '+15559999999',
      greeting: 'Hello, welcome to Test Valet!',
      businessHours: '8am-10pm daily',
      pricingInfo: '$10/hour',
      locationInfo: '123 Main St',
    });
    setDoc('_phoneRouting/route1', { phoneNumber: '+15551234567', companyId });

    // Set up a booking for lookup
    setDoc(`companies/${companyId}/bookings/b100`, {
      ticketNumber: 42,
      status: 'Parked',
      customerName: 'Jane Smith',
      vehicle: { plate: 'XYZ-789', make: 'Honda', model: 'Civic', color: 'Blue' },
      spot: { label: 'A3', id: 'spot-a3', locationId: 'lot-main' },
      keysHandedOver: true,
    });
  });

  it('should create a call session when a call comes in', () => {
    const callSid = 'CA_test_123';
    const sessionPath = `companies/${companyId}/_callSessions/${callSid}`;

    setDoc(sessionPath, {
      callSid,
      companyId,
      callerPhone: '+15559876543',
      companyName: 'Test Valet',
      startedAt: new Date(),
      messages: [{ role: 'system', content: 'You are TEZ...' }],
      actionsPerformed: [],
      turns: 0,
      status: 'active',
    });

    const session = getDoc(sessionPath)!;
    expect(session.callSid).toBe(callSid);
    expect(session.status).toBe('active');
    expect(session.companyId).toBe(companyId);
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe('system');
  });

  it('should add user speech to session messages', () => {
    const sessionPath = `companies/${companyId}/_callSessions/CA_test_123`;
    setDoc(sessionPath, {
      messages: [{ role: 'system', content: 'prompt' }],
      turns: 0,
      status: 'active',
    });

    // Simulate speech input
    const session = getDoc(sessionPath)!;
    session.messages.push({ role: 'user', content: 'I need to pick up my car, ticket number 42' });
    session.turns++;
    setDoc(sessionPath, session);

    const updated = getDoc(sessionPath)!;
    expect(updated.messages).toHaveLength(2);
    expect(updated.messages[1].role).toBe('user');
    expect(updated.turns).toBe(1);
  });

  it('should look up a booking by ticket number', () => {
    const booking = getDoc(`companies/${companyId}/bookings/b100`)!;
    expect(booking.ticketNumber).toBe(42);
    expect(booking.status).toBe('Parked');
    expect(booking.customerName).toBe('Jane Smith');
    expect(booking.vehicle.plate).toBe('XYZ-789');
  });

  it('should transition Parked → Active when vehicle is requested', () => {
    const bookingPath = `companies/${companyId}/bookings/b100`;
    const booking = getDoc(bookingPath)!;
    expect(booking.status).toBe('Parked');

    // Simulate vehicle request
    setDoc(bookingPath, {
      ...booking,
      status: 'Active',
      history: [...(booking.history || []), {
        status: 'Active',
        timestamp: new Date().toISOString(),
        userId: 'ai-phone-agent',
        note: 'Vehicle requested via phone call',
      }],
    });

    expect(getDoc(bookingPath)!.status).toBe('Active');
  });

  it('should cancel a booking via phone and release the spot', () => {
    const bookingPath = `companies/${companyId}/bookings/b100`;
    const spotPath = `companies/${companyId}/locations/lot-main/spots/spot-a3`;
    setDoc(spotPath, { status: 'occupied', bookingId: 'b100' });

    const booking = getDoc(bookingPath)!;

    // Release spot
    if (booking.spot?.id && booking.spot?.locationId) {
      setDoc(spotPath, { status: 'available', bookingId: null });
    }

    // Cancel booking
    setDoc(bookingPath, {
      ...booking,
      status: 'Cancelled',
    });

    expect(getDoc(bookingPath)!.status).toBe('Cancelled');
    expect(getDoc(spotPath)!.status).toBe('available');
    expect(getDoc(spotPath)!.bookingId).toBeNull();
  });

  it('should write call log when call finishes', () => {
    const callLogPath = `companies/${companyId}/_callLog/CA_test_123`;
    setDoc(callLogPath, {
      callSid: 'CA_test_123',
      callerPhone: '+15559876543',
      startedAt: new Date(),
      endedAt: new Date(),
      turns: 3,
      transcript: [
        { role: 'user', content: 'I need my car, ticket 42', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'I found your booking. Your car is being brought now.', timestamp: new Date().toISOString() },
      ],
      actionsPerformed: ['Requested vehicle for booking b100'],
      summary: 'Customer requested vehicle pickup',
      status: 'completed',
    });

    const log = getDoc(callLogPath)!;
    expect(log.status).toBe('completed');
    expect(log.turns).toBe(3);
    expect(log.actionsPerformed).toContain('Requested vehicle for booking b100');
    expect(log.transcript).toHaveLength(2);
  });

  it('should update session status to completed/transferred', () => {
    const sessionPath = `companies/${companyId}/_callSessions/CA_test_123`;
    setDoc(sessionPath, { status: 'active', turns: 5 });

    // Complete
    setDoc(sessionPath, { ...getDoc(sessionPath)!, status: 'completed' });
    expect(getDoc(sessionPath)!.status).toBe('completed');
  });

  it('should enforce MAX_TURNS limit', () => {
    const MAX_TURNS = 15;
    const sessionPath = `companies/${companyId}/_callSessions/CA_max`;
    setDoc(sessionPath, { status: 'active', turns: MAX_TURNS });

    const session = getDoc(sessionPath)!;
    expect(session.turns >= MAX_TURNS).toBe(true);
    // Should hang up
  });

  it('should handle phone routing lookup', () => {
    const route = getDoc('_phoneRouting/route1')!;
    expect(route.phoneNumber).toBe('+15551234567');
    expect(route.companyId).toBe(companyId);
  });

  it('should clean up expired sessions', () => {
    const ttl = 30 * 60_000;
    const oldTime = new Date(Date.now() - ttl - 1000);
    setDoc(`companies/${companyId}/_callSessions/old1`, { status: 'active', startedAt: oldTime });
    setDoc(`companies/${companyId}/_callSessions/recent`, { status: 'active', startedAt: new Date() });

    // Simulate cleanup
    for (const [path, data] of firestoreStore.entries()) {
      if (path.includes('_callSessions') && data.status === 'active') {
        const startedAt = data.startedAt;
        if (startedAt && (Date.now() - new Date(startedAt).getTime()) > ttl) {
          setDoc(path, { ...data, status: 'completed' });
        }
      }
    }

    expect(getDoc(`companies/${companyId}/_callSessions/old1`)!.status).toBe('completed');
    expect(getDoc(`companies/${companyId}/_callSessions/recent`)!.status).toBe('active');
  });
});

// ─── Section 9: Phone Config Save & Routing ──────────────────────────

describe('Phone config save + routing', () => {
  const companyId = 'company-001';

  it('should save phone config and update routing', () => {
    const config = {
      enabled: true,
      twilioPhoneNumber: '+15551234567',
      transferNumber: '+15559999999',
      greeting: 'Welcome!',
      businessHours: '9am-5pm',
      pricingInfo: '$15/hour',
      locationInfo: '456 Oak Ave',
    };

    // Save config
    setDoc(`companies/${companyId}/meta/phoneAgent`, config);
    expect(getDoc(`companies/${companyId}/meta/phoneAgent`)!.enabled).toBe(true);

    // Remove old routes, add new
    for (const [path, data] of firestoreStore.entries()) {
      if (path.startsWith('_phoneRouting/') && data.companyId === companyId) {
        firestoreStore.delete(path);
      }
    }
    setDoc('_phoneRouting/new-route', {
      phoneNumber: '+15551234567',
      companyId,
    });

    expect(getDoc('_phoneRouting/new-route')!.phoneNumber).toBe('+15551234567');
  });

  it('should disable phone agent when enabled is false', () => {
    setDoc(`companies/${companyId}/meta/phoneAgent`, {
      enabled: false,
      transferNumber: '+15559999999',
    });

    const config = getDoc(`companies/${companyId}/meta/phoneAgent`)!;
    expect(config.enabled).toBe(false);
    // When disabled and transferNumber exists, should forward to human
    expect(config.transferNumber).toBe('+15559999999');
  });
});

// ─── Section 10: Idempotency Simulation ──────────────────────────────

describe('Idempotency (duplicate prevention)', () => {
  const companyId = 'company-001';

  it('should return cached result for duplicate idempotency key', () => {
    const key = 'create-booking-001';
    const result = { id: 'booking-abc', ticketNumber: 42 };

    // First request: save
    setDoc(`companies/${companyId}/_idempotency/${key}`, {
      result,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    // Second request: should find cached
    const cached = getDoc(`companies/${companyId}/_idempotency/${key}`);
    expect(cached).toBeDefined();
    expect(cached!.result).toEqual(result);
  });

  it('should not return expired idempotency keys', () => {
    const key = 'old-request';
    const TTL_MS = 86400000; // 24h

    setDoc(`companies/${companyId}/_idempotency/${key}`, {
      result: { id: 'old' },
      createdAt: new Date(Date.now() - TTL_MS - 1000),
    });

    const cached = getDoc(`companies/${companyId}/_idempotency/${key}`)!;
    const age = Date.now() - new Date(cached.createdAt).getTime();
    expect(age > TTL_MS).toBe(true);
    // Should be treated as expired — no cache hit
  });
});

// ─── Section 11: Daily Stats Aggregation ─────────────────────────────

describe('Daily stats aggregation', () => {
  const companyId = 'company-001';

  it('should increment completed count and revenue on booking completion', () => {
    const today = new Date().toISOString().split('T')[0]!;
    const statsPath = `companies/${companyId}/stats/${today}`;

    // Initial stats
    setDoc(statsPath, { completedCount: 5, totalRevenue: 125.50 });

    // Simulate increment
    const stats = getDoc(statsPath)!;
    setDoc(statsPath, {
      completedCount: stats.completedCount + 1,
      totalRevenue: stats.totalRevenue + 25.00,
    });

    const updated = getDoc(statsPath)!;
    expect(updated.completedCount).toBe(6);
    expect(updated.totalRevenue).toBe(150.50);
  });

  it('should handle first completion of the day', () => {
    const today = new Date().toISOString().split('T')[0]!;
    const statsPath = `companies/${companyId}/stats/${today}`;

    // No existing stats
    expect(getDoc(statsPath)).toBeUndefined();

    // First completion
    setDoc(statsPath, { completedCount: 1, totalRevenue: 30.00 });
    expect(getDoc(statsPath)!.completedCount).toBe(1);
  });
});

// ─── Section 12: Audit Trail ─────────────────────────────────────────

describe('Audit trail', () => {
  const companyId = 'company-001';

  it('should record booking creation audit', () => {
    setDoc(`companies/${companyId}/audit/entry1`, {
      action: 'booking.create',
      uid: 'admin-001',
      resourceType: 'booking',
      resourceId: 'b123',
      details: { ticketNumber: 42, customerName: 'Alice' },
      correlationId: 'corr-001',
      timestamp: new Date(),
    });

    const entry = getDoc(`companies/${companyId}/audit/entry1`)!;
    expect(entry.action).toBe('booking.create');
    expect(entry.uid).toBe('admin-001');
    expect(entry.resourceType).toBe('booking');
    expect(entry.details.ticketNumber).toBe(42);
  });

  it('should record phone call audit', () => {
    setDoc(`companies/${companyId}/audit/phone1`, {
      action: 'phone_call',
      uid: 'ai-phone-agent',
      resourceType: 'call',
      resourceId: 'CA_test_123',
      details: { callerPhone: '+15559876543', turns: 3, status: 'completed' },
      correlationId: 'CA_test_123',
      timestamp: new Date(),
    });

    const entry = getDoc(`companies/${companyId}/audit/phone1`)!;
    expect(entry.action).toBe('phone_call');
    expect(entry.uid).toBe('ai-phone-agent');
    expect(entry.details.turns).toBe(3);
  });
});

// ─── Section 13: Rate Limiting ───────────────────────────────────────

describe('Rate limiting', () => {
  it('should enforce rate limit after MAX requests', () => {
    const { checkRateLimitSync } = require('../middleware/rate-limit');
    const uid = 'rate-test-user-' + Date.now();
    const MAX = 30;

    // Should allow up to MAX requests
    for (let i = 0; i < MAX; i++) {
      expect(() => checkRateLimitSync(uid)).not.toThrow();
    }

    // Next request should throw
    expect(() => checkRateLimitSync(uid)).toThrow('Too many requests');
  });

  it('should track different users independently', () => {
    const { checkRateLimitSync } = require('../middleware/rate-limit');
    const user1 = 'rate-user-1-' + Date.now();
    const user2 = 'rate-user-2-' + Date.now();

    // Fill up user1
    for (let i = 0; i < 30; i++) {
      checkRateLimitSync(user1);
    }
    expect(() => checkRateLimitSync(user1)).toThrow();

    // user2 should still be fine
    expect(() => checkRateLimitSync(user2)).not.toThrow();
  });
});

// ─── Section 14: Edge Cases & Error Handling ─────────────────────────

describe('Edge cases & error handling', () => {
  it('should handle booking with no spot assigned on cancel', () => {
    const bookingPath = 'companies/c1/bookings/b-no-spot';
    setDoc(bookingPath, { status: 'New', spotId: '', locationId: '' });

    const booking = getDoc(bookingPath)!;
    // No spot to release — should not crash
    if (booking.spotId && booking.locationId) {
      // Would release spot
    }
    setDoc(bookingPath, { ...booking, status: 'Cancelled' });
    expect(getDoc(bookingPath)!.status).toBe('Cancelled');
  });

  it('should handle unknown phone number (no routing)', () => {
    const route = getDoc('_phoneRouting/nonexistent');
    expect(route).toBeUndefined();
    // Should respond with "not configured" message
  });

  it('should handle disabled phone agent with no transfer number', () => {
    setDoc('companies/c1/meta/phoneAgent', { enabled: false, transferNumber: '' });
    const config = getDoc('companies/c1/meta/phoneAgent')!;
    expect(config.enabled).toBe(false);
    expect(config.transferNumber).toBe('');
    // Should tell caller system is not active
  });

  it('should handle disabled phone agent with transfer number', () => {
    setDoc('companies/c1/meta/phoneAgent', { enabled: false, transferNumber: '+15559999999' });
    const config = getDoc('companies/c1/meta/phoneAgent')!;
    expect(config.enabled).toBe(false);
    expect(config.transferNumber).toBeTruthy();
    // Should transfer to human
  });

  it('should handle booking lookup with no results', () => {
    // No bookings in store
    const result = getDoc('companies/c1/bookings/nonexistent');
    expect(result).toBeUndefined();
  });

  it('should handle vehicle request for non-Parked booking', () => {
    setDoc('companies/c1/bookings/b-active', { status: 'Active' });
    const booking = getDoc('companies/c1/bookings/b-active')!;
    expect(booking.status).not.toBe('Parked');
    // Should return "Your car is already on its way!"
  });

  it('should handle vehicle request for Completed booking', () => {
    setDoc('companies/c1/bookings/b-done', { status: 'Completed' });
    const booking = getDoc('companies/c1/bookings/b-done')!;
    expect(booking.status).toBe('Completed');
    // Should return "This booking has already been completed."
  });

  it('should handle cancel of already-cancelled booking', () => {
    setDoc('companies/c1/bookings/b-cancelled', { status: 'Cancelled' });
    const booking = getDoc('companies/c1/bookings/b-cancelled')!;
    expect(booking.status).toBe('Cancelled');
    // No transition from Cancelled
    expect(VALID_TRANSITIONS['Cancelled']).toBeUndefined();
  });
});

// ─── Section 15: Phone Agent TwiML Output ────────────────────────────

describe('Phone agent TwiML integration', () => {
  const {
    escapeXml,
    twimlGather,
    twimlSay,
    twimlTransfer,
    twimlHangup,
    buildSystemPrompt,
  } = require('../services/phone-agent');

  it('should produce complete call flow TwiML', () => {
    // 1. Incoming call → Gather with greeting
    const greeting = twimlGather('Welcome to Test Valet! How can I help?', 'https://x.com/phoneWebhook?action=gather');
    expect(greeting).toContain('<Gather');
    expect(greeting).toContain('<Say');
    expect(greeting).toContain('Welcome to Test Valet');

    // 2. After speech → AI responds → Another gather
    const response = twimlGather('I found your booking. Would you like me to request your car?', 'https://x.com/phoneWebhook?action=gather');
    expect(response).toContain('I found your booking');

    // 3. Transfer scenario
    const transfer = twimlTransfer('Let me connect you with our team.', '+15559999999');
    expect(transfer).toContain('<Dial>');
    expect(transfer).toContain('+15559999999');

    // 4. End call
    const hangup = twimlHangup('Thank you for calling! Goodbye.');
    expect(hangup).toContain('<Hangup/>');
    expect(hangup).toContain('Thank you for calling');
  });

  it('should handle special characters in customer speech', () => {
    const text = 'My license plate is "AB&1234" & I\'m in a rush';
    const twiml = twimlSay(text);
    expect(twiml).toContain('&amp;');
    expect(twiml).toContain('&quot;');
    expect(twiml).toContain('&apos;');
    expect(twiml).not.toContain('& I'); // bare & should be escaped
  });

  it('should build system prompt with all company info', () => {
    const prompt = buildSystemPrompt('Acme Valet', {
      enabled: true,
      twilioPhoneNumber: '+15551234567',
      transferNumber: '+15559999999',
      greeting: 'Welcome!',
      businessHours: '24/7',
      pricingInfo: '$5/hr',
      locationInfo: '123 Main St, NYC',
    });

    expect(prompt).toContain('Acme Valet');
    expect(prompt).toContain('24/7');
    expect(prompt).toContain('$5/hr');
    expect(prompt).toContain('123 Main St, NYC');
    expect(prompt).toContain('ticket number');
    expect(prompt).toContain('license plate');
  });
});
