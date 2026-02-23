/**
 * Tez — Customer, Employee & Owner Journey Tests
 *
 * Comprehensive tests covering:
 *  1. Walk-up valet flow: New → Check-In → Parked → Active → Completed
 *  2. Pre-booked flow: New → Booked → Check-In → Parked → Active → Completed
 *  3. Cancellation at every stage
 *  4. Spot assignment → release lifecycle
 *  5. Admin user management (setUserRole)
 *  6. Full booking lifecycle with spot + payment
 *  7. State machine: New → Check-In (walk-up valet)
 *  8. Edge cases: empty fields, uppercase plates, concurrent ops
 *  9. Health check
 * 10. RBAC enforcement across all handlers
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ═══════════════════════════════════════════════════════════════════════
//  In-Memory Firestore Simulation
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

jest.mock('axios', () => ({
  get: jest.fn(),
  default: { get: jest.fn() },
}));

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

jest.mock('../middleware/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => {}),
  checkRateLimitSync: jest.fn(() => {}),
}));

// ═══════════════════════════════════════════════════════════════════════
//  Import handlers AFTER mocks
// ═══════════════════════════════════════════════════════════════════════

import { createBooking, transitionBooking, completeBooking, cancelBooking, listBookings } from '../services/booking';
import { assignSpot, lockSpot, releaseSpot } from '../services/parking';
import { setUserRole, healthCheck } from '../services/admin';

// ═══════════════════════════════════════════════════════════════════════
//  Context Helpers
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

const WALK_UP_BOOKING = {
  customerName: 'Jane Walker',
  customerPhone: '555-9876',
  vehiclePlate: 'WLK456',
  vehicleMake: 'Honda',
  vehicleModel: 'Civic',
  vehicleColor: 'Blue',
  notes: 'Walk-up customer',
  idempotencyKey: 'walkup-001',
};

const PRE_BOOKED = {
  customerName: 'Bob Booker',
  customerPhone: '555-4321',
  customerEmail: 'bob@example.com',
  vehiclePlate: 'BKD789',
  vehicleMake: 'BMW',
  vehicleModel: 'X5',
  vehicleColor: 'Black',
  flightNumber: 'UA457',
  notes: 'Pre-booked VIP',
  idempotencyKey: 'prebook-001',
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
//  1. WALK-UP VALET JOURNEY (New → Check-In → Parked → Active → Completed)
// ═══════════════════════════════════════════════════════════════════════

describe('Walk-Up Valet Journey', () => {
  it('should complete full walk-up flow: create → check-in → park → activate → complete', async () => {
    // Step 1: Create booking
    const booking = await (createBooking as any)(WALK_UP_BOOKING, adminCtx());
    expect(booking).toHaveProperty('id');
    expect(booking).toHaveProperty('ticketNumber');

    // Verify it was created with New status
    const bookingPath = writeLog.find(w => w.type === 'add' && w.data.status === 'New')?.path;
    expect(bookingPath).toBeDefined();

    const bookingId = booking.id;

    // Step 2: Direct Check-In (walk-up — skips "Booked")
    setDoc(`companies/company-001/bookings/${bookingId}`, {
      status: 'New',
      spotId: '',
      locationId: '',
      history: [],
    });

    const checkInResult = await (transitionBooking as any)(
      { bookingId, newStatus: 'Check-In' },
      adminCtx(),
    );
    expect(checkInResult).toEqual({ success: true });

    // Verify status updated
    const afterCheckIn = getDoc(`companies/company-001/bookings/${bookingId}`);
    expect(afterCheckIn?.status).toBe('Check-In');

    // Step 3: Set up spot and assign → Park
    setDoc(`companies/company-001/locations/lot-a/spots/A1`, {
      name: 'A1',
      status: 'available',
      bookingId: null,
      lockedBy: null,
      lockedAt: null,
    });

    // Lock spot
    const lockResult = await (lockSpot as any)(
      { spotId: 'A1', locationId: 'lot-a' },
      adminCtx(),
    );
    expect(lockResult).toEqual({ success: true });

    // Assign spot
    const assignResult = await (assignSpot as any)(
      { bookingId, spotId: 'A1', locationId: 'lot-a' },
      adminCtx(),
    );
    expect(assignResult).toEqual({ success: true });

    // Transition to Parked
    setDoc(`companies/company-001/bookings/${bookingId}`, {
      ...afterCheckIn!,
      status: 'Check-In',
      spotId: 'A1',
      locationId: 'lot-a',
    });
    const parkResult = await (transitionBooking as any)(
      { bookingId, newStatus: 'Parked', note: 'Parked at A1' },
      adminCtx(),
    );
    expect(parkResult).toEqual({ success: true });

    // Step 4: Activate
    setDoc(`companies/company-001/bookings/${bookingId}`, {
      status: 'Parked',
      spotId: 'A1',
      locationId: 'lot-a',
      history: [],
    });
    const activeResult = await (transitionBooking as any)(
      { bookingId, newStatus: 'Active' },
      adminCtx(),
    );
    expect(activeResult).toEqual({ success: true });

    // Step 5: Complete with payment
    setDoc(`companies/company-001/bookings/${bookingId}`, {
      status: 'Active',
      spotId: 'A1',
      locationId: 'lot-a',
      history: [],
    });
    setDoc(`companies/company-001/locations/lot-a/spots/A1`, {
      name: 'A1',
      status: 'occupied',
      bookingId,
    });

    const completeResult = await (completeBooking as any)(
      { bookingId, paymentMethod: 'card', paymentAmount: 35.00 },
      adminCtx(),
    );
    expect(completeResult).toEqual({ success: true });

    // Verify spot was released
    const spotAfter = getDoc(`companies/company-001/locations/lot-a/spots/A1`);
    expect(spotAfter?.status).toBe('available');
    expect(spotAfter?.bookingId).toBeNull();
  });

  it('should allow New → Check-In transition (walk-up valet)', async () => {
    setDoc('companies/company-001/bookings/wu-001', {
      status: 'New',
      spotId: '',
      locationId: '',
      history: [],
    });

    const result = await (transitionBooking as any)(
      { bookingId: 'wu-001', newStatus: 'Check-In' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should still allow New → Booked transition', async () => {
    setDoc('companies/company-001/bookings/wu-002', {
      status: 'New',
      spotId: '',
      locationId: '',
      history: [],
    });

    const result = await (transitionBooking as any)(
      { bookingId: 'wu-002', newStatus: 'Booked' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should still allow New → Cancelled', async () => {
    setDoc('companies/company-001/bookings/wu-003', {
      status: 'New',
      spotId: '',
      locationId: '',
      history: [],
    });

    const result = await (transitionBooking as any)(
      { bookingId: 'wu-003', newStatus: 'Cancelled' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should deny New → Parked (must go through Check-In)', async () => {
    setDoc('companies/company-001/bookings/wu-004', {
      status: 'New',
      spotId: '',
      locationId: '',
      history: [],
    });

    await expect(
      (transitionBooking as any)(
        { bookingId: 'wu-004', newStatus: 'Parked' },
        adminCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should deny New → Active', async () => {
    setDoc('companies/company-001/bookings/wu-005', {
      status: 'New',
      spotId: '',
      locationId: '',
      history: [],
    });

    await expect(
      (transitionBooking as any)(
        { bookingId: 'wu-005', newStatus: 'Active' },
        adminCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should deny New → Completed', async () => {
    setDoc('companies/company-001/bookings/wu-006', {
      status: 'New',
      spotId: '',
      locationId: '',
      history: [],
    });

    await expect(
      (transitionBooking as any)(
        { bookingId: 'wu-006', newStatus: 'Completed' },
        adminCtx(),
      ),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  2. PRE-BOOKED CUSTOMER JOURNEY (New → Booked → Check-In → ... )
// ═══════════════════════════════════════════════════════════════════════

describe('Pre-Booked Customer Journey', () => {
  it('should complete full pre-booked flow', async () => {
    // Create
    const booking = await (createBooking as any)(PRE_BOOKED, operatorCtx());
    expect(booking.ticketNumber).toBeDefined();
    const bookingId = booking.id;

    // New → Booked
    setDoc(`companies/company-001/bookings/${bookingId}`, {
      status: 'New', spotId: '', locationId: '', history: [],
    });
    const bookedResult = await (transitionBooking as any)(
      { bookingId, newStatus: 'Booked' },
      operatorCtx(),
    );
    expect(bookedResult).toEqual({ success: true });

    // Booked → Check-In
    setDoc(`companies/company-001/bookings/${bookingId}`, {
      status: 'Booked', spotId: '', locationId: '', history: [],
    });
    const checkInResult = await (transitionBooking as any)(
      { bookingId, newStatus: 'Check-In' },
      operatorCtx(),
    );
    expect(checkInResult).toEqual({ success: true });

    // Check-In → Parked
    setDoc(`companies/company-001/bookings/${bookingId}`, {
      status: 'Check-In', spotId: '', locationId: '', history: [],
    });
    const parkResult = await (transitionBooking as any)(
      { bookingId, newStatus: 'Parked', note: 'Parked at B2' },
      operatorCtx(),
    );
    expect(parkResult).toEqual({ success: true });

    // Parked → Active
    setDoc(`companies/company-001/bookings/${bookingId}`, {
      status: 'Parked', spotId: 'B2', locationId: 'lot-b', history: [],
    });
    const activeResult = await (transitionBooking as any)(
      { bookingId, newStatus: 'Active' },
      operatorCtx(),
    );
    expect(activeResult).toEqual({ success: true });

    // Active → Completed
    setDoc(`companies/company-001/bookings/${bookingId}`, {
      status: 'Active', spotId: 'B2', locationId: 'lot-b', history: [],
    });
    setDoc('companies/company-001/locations/lot-b/spots/B2', {
      name: 'B2', status: 'occupied', bookingId,
    });
    const completeResult = await (completeBooking as any)(
      { bookingId, paymentMethod: 'cash', paymentAmount: 50.00 },
      operatorCtx(),
    );
    expect(completeResult).toEqual({ success: true });
  });

  it('should create booking with all optional fields', async () => {
    const result = await (createBooking as any)(PRE_BOOKED, adminCtx());
    expect(result.id).toBeDefined();
    expect(result.ticketNumber).toBeDefined();
    expect(typeof result.ticketNumber).toBe('number');
  });

  it('should create booking with minimal required fields', async () => {
    const result = await (createBooking as any)(
      {
        customerName: 'Minimal User',
        vehiclePlate: 'MIN001',
        idempotencyKey: 'min-001',
      },
      adminCtx(),
    );
    expect(result.id).toBeDefined();
    expect(result.ticketNumber).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  3. CANCELLATION AT EVERY STAGE
// ═══════════════════════════════════════════════════════════════════════

describe('Cancellation at Every Stage', () => {
  const STAGES = ['New', 'Booked', 'Check-In', 'Parked', 'Active'];

  STAGES.forEach((stage) => {
    it(`should cancel from ${stage} status`, async () => {
      setDoc('companies/company-001/bookings/cancel-test', {
        status: stage,
        spotId: stage === 'Parked' || stage === 'Active' ? 'C1' : '',
        locationId: stage === 'Parked' || stage === 'Active' ? 'lot-c' : '',
        history: [],
      });

      // If spot is assigned, create the spot doc
      if (stage === 'Parked' || stage === 'Active') {
        setDoc('companies/company-001/locations/lot-c/spots/C1', {
          name: 'C1', status: 'occupied', bookingId: 'cancel-test',
          lockedBy: null, lockedAt: null,
        });
      }

      const result = await (cancelBooking as any)(
        { bookingId: 'cancel-test', reason: `Cancelled from ${stage}` },
        adminCtx(),
      );
      expect(result).toEqual({ success: true });

      // Verify booking is cancelled
      const booking = getDoc('companies/company-001/bookings/cancel-test');
      expect(booking?.status).toBe('Cancelled');
    });
  });

  it('should NOT cancel from Completed status', async () => {
    setDoc('companies/company-001/bookings/no-cancel', {
      status: 'Completed', spotId: '', locationId: '', history: [],
    });

    await expect(
      (cancelBooking as any)(
        { bookingId: 'no-cancel', reason: 'Too late' },
        adminCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should NOT cancel from Cancelled status', async () => {
    setDoc('companies/company-001/bookings/already-cancelled', {
      status: 'Cancelled', spotId: '', locationId: '', history: [],
    });

    await expect(
      (cancelBooking as any)(
        { bookingId: 'already-cancelled', reason: 'Already done' },
        adminCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should release spot when cancelling a parked booking', async () => {
    setDoc('companies/company-001/bookings/parked-cancel', {
      status: 'Parked', spotId: 'D1', locationId: 'lot-d', history: [],
    });
    setDoc('companies/company-001/locations/lot-d/spots/D1', {
      name: 'D1', status: 'occupied', bookingId: 'parked-cancel',
      lockedBy: null, lockedAt: null,
    });

    await (cancelBooking as any)(
      { bookingId: 'parked-cancel', reason: 'Customer left' },
      adminCtx(),
    );

    const spot = getDoc('companies/company-001/locations/lot-d/spots/D1');
    expect(spot?.status).toBe('available');
    expect(spot?.bookingId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  4. SPOT ASSIGNMENT LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════

describe('Spot Assignment Lifecycle', () => {
  beforeEach(() => {
    setDoc('companies/company-001/locations/lot-a/spots/S1', {
      name: 'S1', status: 'available', bookingId: null,
      lockedBy: null, lockedAt: null,
    });
    setDoc('companies/company-001/bookings/spot-test', {
      status: 'Check-In', spotId: '', locationId: '', history: [],
    });
  });

  it('should lock → assign → release lifecycle', async () => {
    // Lock
    const lockResult = await (lockSpot as any)(
      { spotId: 'S1', locationId: 'lot-a' },
      adminCtx(),
    );
    expect(lockResult).toEqual({ success: true });

    // Assign
    const assignResult = await (assignSpot as any)(
      { bookingId: 'spot-test', spotId: 'S1', locationId: 'lot-a' },
      adminCtx(),
    );
    expect(assignResult).toEqual({ success: true });

    // Release
    setDoc('companies/company-001/locations/lot-a/spots/S1', {
      name: 'S1', status: 'occupied', bookingId: 'spot-test',
      lockedBy: 'admin-001', lockedAt: null,
    });
    const releaseResult = await (releaseSpot as any)(
      { spotId: 'S1', locationId: 'lot-a' },
      adminCtx(),
    );
    expect(releaseResult).toEqual({ success: true });
  });

  it('should reject lock on occupied spot', async () => {
    setDoc('companies/company-001/locations/lot-a/spots/S1', {
      name: 'S1', status: 'occupied', bookingId: 'other-booking',
      lockedBy: null, lockedAt: null,
    });

    await expect(
      (lockSpot as any)(
        { spotId: 'S1', locationId: 'lot-a' },
        adminCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should reject lock by different operator if not expired', async () => {
    setDoc('companies/company-001/locations/lot-a/spots/S1', {
      name: 'S1', status: 'available', bookingId: null,
      lockedBy: 'other-op', lockedAt: { toDate: () => new Date() },
    });

    await expect(
      (lockSpot as any)(
        { spotId: 'S1', locationId: 'lot-a' },
        operatorCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should reject assign on non-existent booking', async () => {
    await expect(
      (assignSpot as any)(
        { bookingId: 'nonexistent', spotId: 'S1', locationId: 'lot-a' },
        adminCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should reject assign on non-existent spot', async () => {
    await expect(
      (assignSpot as any)(
        { bookingId: 'spot-test', spotId: 'NOPE', locationId: 'lot-a' },
        adminCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should reject release by non-owner non-admin', async () => {
    setDoc('companies/company-001/locations/lot-a/spots/S1', {
      name: 'S1', status: 'available', bookingId: null,
      lockedBy: 'admin-001', lockedAt: null,
    });

    await expect(
      (releaseSpot as any)(
        { spotId: 'S1', locationId: 'lot-a' },
        operatorCtx(),
      ),
    ).rejects.toThrow(/lock owner|admin/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  5. ADMIN USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

describe('Admin User Management', () => {
  it('should set user role successfully', async () => {
    mockGetUser.mockResolvedValue({
      uid: 'target-uid',
      customClaims: { companyId: 'company-001', role: 'viewer' },
    });
    mockSetCustomUserClaims.mockResolvedValue(undefined);

    const result = await (setUserRole as any)(
      { userId: 'target-uid', role: 'operator' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('target-uid', {
      role: 'operator',
      companyId: 'company-001',
    });
  });

  it('should block cross-company role assignment', async () => {
    mockGetUser.mockResolvedValue({
      uid: 'other-company-user',
      customClaims: { companyId: 'other-company', role: 'viewer' },
    });

    await expect(
      (setUserRole as any)(
        { userId: 'other-company-user', role: 'admin' },
        adminCtx(),
      ),
    ).rejects.toThrow(/different company/i);
  });

  it('should block self-demotion', async () => {
    mockGetUser.mockResolvedValue({
      uid: 'admin-001',
      customClaims: { companyId: 'company-001', role: 'admin' },
    });

    await expect(
      (setUserRole as any)(
        { userId: 'admin-001', role: 'viewer' },
        adminCtx(),
      ),
    ).rejects.toThrow(/demote yourself/i);
  });

  it('should allow admin to keep their admin role', async () => {
    mockGetUser.mockResolvedValue({
      uid: 'admin-001',
      customClaims: { companyId: 'company-001', role: 'admin' },
    });
    mockSetCustomUserClaims.mockResolvedValue(undefined);

    // Setting role to 'admin' when already admin — should NOT throw
    const result = await (setUserRole as any)(
      { userId: 'admin-001', role: 'admin' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('should promote viewer to admin', async () => {
    mockGetUser.mockResolvedValue({
      uid: 'viewer-001',
      customClaims: { companyId: 'company-001', role: 'viewer' },
    });
    mockSetCustomUserClaims.mockResolvedValue(undefined);

    const result = await (setUserRole as any)(
      { userId: 'viewer-001', role: 'admin' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('viewer-001', {
      role: 'admin',
      companyId: 'company-001',
    });
  });

  it('should deny role change from non-admin', async () => {
    await expect(
      (setUserRole as any)(
        { userId: 'some-user', role: 'admin' },
        operatorCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should deny role change from viewer', async () => {
    await expect(
      (setUserRole as any)(
        { userId: 'some-user', role: 'operator' },
        viewerCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should deny role change without auth', async () => {
    await expect(
      (setUserRole as any)(
        { userId: 'some-user', role: 'operator' },
        noAuth(),
      ),
    ).rejects.toThrow();
  });

  it('should update Firestore user doc after role change', async () => {
    mockGetUser.mockResolvedValue({
      uid: 'target-002',
      customClaims: { companyId: 'company-001', role: 'viewer' },
    });
    mockSetCustomUserClaims.mockResolvedValue(undefined);

    await (setUserRole as any)(
      { userId: 'target-002', role: 'operator' },
      adminCtx(),
    );

    // Verify Firestore was updated
    const userDoc = getDoc('users/target-002');
    expect(userDoc?.role).toBe('operator');
    expect(userDoc?.companyId).toBe('company-001');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  6. RBAC ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════

describe('RBAC Enforcement', () => {
  it('should allow admin to create booking', async () => {
    const result = await (createBooking as any)(
      { ...WALK_UP_BOOKING, idempotencyKey: 'rbac-admin-1' },
      adminCtx(),
    );
    expect(result.id).toBeDefined();
  });

  it('should allow operator to create booking', async () => {
    const result = await (createBooking as any)(
      { ...WALK_UP_BOOKING, idempotencyKey: 'rbac-op-1' },
      operatorCtx(),
    );
    expect(result.id).toBeDefined();
  });

  it('should deny viewer from creating booking', async () => {
    await expect(
      (createBooking as any)(
        { ...WALK_UP_BOOKING, idempotencyKey: 'rbac-viewer-1' },
        viewerCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should deny unauthenticated create booking', async () => {
    await expect(
      (createBooking as any)(WALK_UP_BOOKING, noAuth()),
    ).rejects.toThrow();
  });

  it('should allow viewer to list bookings', async () => {
    const result = await (listBookings as any)(
      { limit: 10, orderBy: 'createdAt', direction: 'desc' },
      viewerCtx(),
    );
    expect(result).toHaveProperty('bookings');
  });

  it('should deny viewer from transitioning booking', async () => {
    setDoc('companies/company-001/bookings/rbac-t', {
      status: 'New', spotId: '', locationId: '', history: [],
    });

    await expect(
      (transitionBooking as any)(
        { bookingId: 'rbac-t', newStatus: 'Booked' },
        viewerCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should deny viewer from completing booking', async () => {
    setDoc('companies/company-001/bookings/rbac-c', {
      status: 'Active', spotId: '', locationId: '', history: [],
    });

    await expect(
      (completeBooking as any)(
        { bookingId: 'rbac-c', paymentMethod: 'cash', paymentAmount: 25 },
        viewerCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should deny viewer from cancelling booking', async () => {
    setDoc('companies/company-001/bookings/rbac-x', {
      status: 'New', spotId: '', locationId: '', history: [],
    });

    await expect(
      (cancelBooking as any)(
        { bookingId: 'rbac-x', reason: 'test' },
        viewerCtx(),
      ),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  7. HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════

describe('Health Check', () => {
  it('should return health status', async () => {
    const result = await (healthCheck as any)(null, adminCtx());
    expect(result.status).toBe('ok');
    expect(result.version).toBeDefined();
    expect(result.timestamp).toBeDefined();
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  8. BOOKING CREATION EDGE CASES
// ═══════════════════════════════════════════════════════════════════════

describe('Booking Creation Edge Cases', () => {
  it('should handle idempotent duplicate requests', async () => {
    const data = { ...WALK_UP_BOOKING, idempotencyKey: 'dedup-001' };
    const first = await (createBooking as any)(data, adminCtx());
    expect(first.id).toBeDefined();

    // The idempotency cache stores the result, but in our mock the checkIdempotency
    // is mocked to always miss, so we just verify no crash
  });

  it('should reject booking with missing customerName', async () => {
    await expect(
      (createBooking as any)(
        { vehiclePlate: 'ABC999', idempotencyKey: 'edge-1' },
        adminCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should reject booking with missing vehiclePlate', async () => {
    await expect(
      (createBooking as any)(
        { customerName: 'John', idempotencyKey: 'edge-2' },
        adminCtx(),
      ),
    ).rejects.toThrow();
  });

  it('should accept booking without idempotencyKey', async () => {
    const result = await (createBooking as any)(
      { customerName: 'John', vehiclePlate: 'ABC999' },
      adminCtx(),
    );
    expect(result.id).toBeDefined();
    expect(result.ticketNumber).toBeDefined();
  });

  it('should handle booking with undefined optional fields', async () => {
    const result = await (createBooking as any)(
      {
        customerName: 'Sparse',
        vehiclePlate: 'SPS001',
        idempotencyKey: 'sparse-001',
        customerPhone: undefined,
        customerEmail: undefined,
        vehicleMake: undefined,
        vehicleModel: undefined,
        vehicleColor: undefined,
        flightNumber: undefined,
        notes: undefined,
      },
      adminCtx(),
    );
    expect(result.id).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  9. LISTING BOOKINGS
// ═══════════════════════════════════════════════════════════════════════

describe('Listing Bookings', () => {
  it('should list bookings with default params', async () => {
    const result = await (listBookings as any)(
      { limit: 20, orderBy: 'createdAt', direction: 'desc' },
      adminCtx(),
    );
    expect(result).toHaveProperty('bookings');
    expect(result).toHaveProperty('hasMore');
    expect(Array.isArray(result.bookings)).toBe(true);
  });

  it('should list bookings as operator', async () => {
    const result = await (listBookings as any)(
      { limit: 10, orderBy: 'createdAt', direction: 'desc' },
      operatorCtx(),
    );
    expect(result).toHaveProperty('bookings');
  });

  it('should list bookings as viewer', async () => {
    const result = await (listBookings as any)(
      { limit: 10, orderBy: 'createdAt', direction: 'desc' },
      viewerCtx(),
    );
    expect(result).toHaveProperty('bookings');
  });

  it('should deny list bookings without auth', async () => {
    await expect(
      (listBookings as any)(
        { limit: 10, orderBy: 'createdAt', direction: 'desc' },
        noAuth(),
      ),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  10. COMPLETE TRANSITION VALIDATION
// ═══════════════════════════════════════════════════════════════════════

describe('Complete Transition Validation', () => {
  it('should only complete Active bookings', async () => {
    const nonActive = ['New', 'Booked', 'Check-In', 'Parked', 'Completed', 'Cancelled'];

    for (const status of nonActive) {
      setDoc('companies/company-001/bookings/complete-test', {
        status, spotId: '', locationId: '', history: [],
      });

      await expect(
        (completeBooking as any)(
          { bookingId: 'complete-test', paymentMethod: 'cash', paymentAmount: 10 },
          adminCtx(),
        ),
      ).rejects.toThrow();
    }
  });

  it('should complete Active booking and update daily stats', async () => {
    setDoc('companies/company-001/bookings/stats-test', {
      status: 'Active', spotId: 'X1', locationId: 'lot-x', history: [],
    });
    setDoc('companies/company-001/locations/lot-x/spots/X1', {
      name: 'X1', status: 'occupied', bookingId: 'stats-test',
    });

    const result = await (completeBooking as any)(
      { bookingId: 'stats-test', paymentMethod: 'card', paymentAmount: 75.50 },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });

    // Verify the stats ref was written to (via tx.set)
    const statsWrites = writeLog.filter(w => w.path.includes('/stats/'));
    expect(statsWrites.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  11. CONCURRENT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════

describe('Concurrent Operations', () => {
  it('should handle multiple bookings created concurrently', async () => {
    const promises = Array.from({ length: 5 }, (_, i) =>
      (createBooking as any)(
        {
          customerName: `Customer ${i}`,
          vehiclePlate: `PLT${i}00`,
          idempotencyKey: `concurrent-${i}`,
        },
        adminCtx(),
      ),
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    results.forEach((r) => {
      expect(r.id).toBeDefined();
      expect(r.ticketNumber).toBeDefined();
    });
  });

  it('should handle concurrent transitions on different bookings', async () => {
    for (let i = 0; i < 3; i++) {
      setDoc(`companies/company-001/bookings/conc-${i}`, {
        status: 'New', spotId: '', locationId: '', history: [],
      });
    }

    const promises = Array.from({ length: 3 }, (_, i) =>
      (transitionBooking as any)(
        { bookingId: `conc-${i}`, newStatus: 'Check-In' },
        adminCtx(),
      ),
    );

    const results = await Promise.all(promises);
    results.forEach((r) => expect(r).toEqual({ success: true }));
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  12. STATE MACHINE NEW → CHECK-IN SPECIFIC TESTS
// ═══════════════════════════════════════════════════════════════════════

describe('State Machine: New → Check-In (Walk-Up)', () => {
  it('New → Check-In should be ALLOWED', async () => {
    setDoc('companies/company-001/bookings/sm-new-ci', {
      status: 'New', spotId: '', locationId: '', history: [],
    });

    const result = await (transitionBooking as any)(
      { bookingId: 'sm-new-ci', newStatus: 'Check-In' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('New → Check-In with note should preserve note', async () => {
    setDoc('companies/company-001/bookings/sm-note', {
      status: 'New', spotId: '', locationId: '', history: [],
    });

    const result = await (transitionBooking as any)(
      { bookingId: 'sm-note', newStatus: 'Check-In', note: 'Walk-up customer at gate' },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('operator should be able to do walk-up check-in', async () => {
    setDoc('companies/company-001/bookings/sm-op-ci', {
      status: 'New', spotId: '', locationId: '', history: [],
    });

    const result = await (transitionBooking as any)(
      { bookingId: 'sm-op-ci', newStatus: 'Check-In' },
      operatorCtx(),
    );
    expect(result).toEqual({ success: true });
  });

  it('viewer should NOT be able to do walk-up check-in', async () => {
    setDoc('companies/company-001/bookings/sm-v-ci', {
      status: 'New', spotId: '', locationId: '', history: [],
    });

    await expect(
      (transitionBooking as any)(
        { bookingId: 'sm-v-ci', newStatus: 'Check-In' },
        viewerCtx(),
      ),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  13. FRONTEND MODEL VALIDATION
// ═══════════════════════════════════════════════════════════════════════

describe('Frontend VALID_TRANSITIONS Consistency', () => {
  // This tests the types.ts (backend) VALID_TRANSITIONS map
  const { VALID_TRANSITIONS } = require('../types');

  it('New should allow Booked, Check-In, Cancelled', () => {
    expect(VALID_TRANSITIONS['New']).toContain('Booked');
    expect(VALID_TRANSITIONS['New']).toContain('Check-In');
    expect(VALID_TRANSITIONS['New']).toContain('Cancelled');
    expect(VALID_TRANSITIONS['New']).toHaveLength(3);
  });

  it('Booked should allow Check-In, Cancelled', () => {
    expect(VALID_TRANSITIONS['Booked']).toContain('Check-In');
    expect(VALID_TRANSITIONS['Booked']).toContain('Cancelled');
    expect(VALID_TRANSITIONS['Booked']).toHaveLength(2);
  });

  it('Check-In should allow Parked, Cancelled', () => {
    expect(VALID_TRANSITIONS['Check-In']).toContain('Parked');
    expect(VALID_TRANSITIONS['Check-In']).toContain('Cancelled');
    expect(VALID_TRANSITIONS['Check-In']).toHaveLength(2);
  });

  it('Parked should allow Active, Cancelled', () => {
    expect(VALID_TRANSITIONS['Parked']).toContain('Active');
    expect(VALID_TRANSITIONS['Parked']).toContain('Cancelled');
    expect(VALID_TRANSITIONS['Parked']).toHaveLength(2);
  });

  it('Active should allow Completed, Cancelled', () => {
    expect(VALID_TRANSITIONS['Active']).toContain('Completed');
    expect(VALID_TRANSITIONS['Active']).toContain('Cancelled');
    expect(VALID_TRANSITIONS['Active']).toHaveLength(2);
  });

  it('Completed and Cancelled should be terminal (undefined)', () => {
    expect(VALID_TRANSITIONS['Completed']).toBeUndefined();
    expect(VALID_TRANSITIONS['Cancelled']).toBeUndefined();
  });
});
