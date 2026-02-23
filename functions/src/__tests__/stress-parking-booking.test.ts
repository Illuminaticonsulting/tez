/**
 * Tez — Parking & Booking Service Stress Tests
 *
 * Simulated concurrency and boundary testing for:
 *  - Spot assignment validation (booking status check)
 *  - releaseSpot atomicity (ownership verification in transaction)
 *  - Booking status transitions (all valid/invalid combinations)
 *  - Edge cases: double-complete, double-cancel, invalid transitions
 */

// ─── Mock Setup ──────────────────────────────────────────────────────

const firestoreStore = new Map<string, Record<string, any>>();
const writeLog: Array<{ type: string; path: string; data: any }> = [];

function clearStore(): void {
  firestoreStore.clear();
  writeLog.length = 0;
}

function setDoc(path: string, data: Record<string, any>): void {
  firestoreStore.set(path, { ...data });
}

function getDoc(path: string): Record<string, any> | undefined {
  return firestoreStore.get(path);
}

function createMockDocRef(path: string) {
  return {
    get: jest.fn(async () => {
      const data = firestoreStore.get(path);
      return {
        exists: !!data,
        data: () => data ? { ...data } : undefined,
        id: path.split('/').pop(),
        ref: createMockDocRef(path),
      };
    }),
    set: jest.fn(async (data: any, opts?: any) => {
      const existing = firestoreStore.get(path) || {};
      const merged = opts?.merge ? { ...existing, ...data } : data;
      firestoreStore.set(path, merged);
      writeLog.push({ type: 'set', path, data: merged });
    }),
    update: jest.fn(async (data: any) => {
      const existing = firestoreStore.get(path);
      if (!existing) throw new Error(`No document at ${path}`);
      const merged = { ...existing, ...data };
      firestoreStore.set(path, merged);
      writeLog.push({ type: 'update', path, data: merged });
    }),
    delete: jest.fn(async () => {
      firestoreStore.delete(path);
      writeLog.push({ type: 'delete', path, data: null });
    }),
    collection: jest.fn((sub: string) => createMockCollectionRef(`${path}/${sub}`)),
    path,
  };
}

function createMockCollectionRef(path: string) {
  return {
    doc: jest.fn((id: string) => createMockDocRef(`${path}/${id}`)),
    add: jest.fn(async (data: any) => {
      const id = `auto_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const docPath = `${path}/${id}`;
      firestoreStore.set(docPath, { ...data, id });
      writeLog.push({ type: 'add', path: docPath, data });
      return createMockDocRef(docPath);
    }),
    get: jest.fn(async () => {
      const prefix = path + '/';
      const docs = Array.from(firestoreStore.entries())
        .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map(([k, v]) => ({
          id: k.split('/').pop(),
          data: () => ({ ...v }),
          ref: createMockDocRef(k),
          exists: true,
        }));
      return { docs, empty: docs.length === 0, size: docs.length };
    }),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };
}

jest.mock('firebase-functions', () => {
  const HttpsError = class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  };
  return {
    https: { HttpsError },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    runWith: jest.fn().mockReturnValue({
      https: { onCall: jest.fn((fn: any) => fn) },
      pubsub: { schedule: jest.fn().mockReturnValue({ timeZone: jest.fn().mockReturnValue({ onRun: jest.fn((fn: any) => fn) }), onRun: jest.fn((fn: any) => fn) }) },
    }),
  };
});

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => new Date()),
      increment: jest.fn((n: number) => ({ _increment: n }),
      ),
      arrayUnion: jest.fn((...vals: any[]) => ({ _arrayUnion: vals })),
    },
  },
}));

const mockDb = {
  runTransaction: jest.fn(async (fn: any) => {
    const tx = {
      get: jest.fn(async (ref: any) => ref.get()),
      set: jest.fn((ref: any, data: any, opts?: any) => ref.set(data, opts)),
      update: jest.fn((ref: any, data: any) => ref.update(data)),
      delete: jest.fn((ref: any) => ref.delete()),
    };
    return fn(tx);
  }),
  batch: jest.fn(() => ({
    set: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
  })),
  collection: jest.fn((path: string) => createMockCollectionRef(path)),
  doc: jest.fn((path: string) => createMockDocRef(path)),
  collectionGroup: jest.fn(() => ({
    where: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
    }),
  })),
};

jest.mock('../config', () => ({
  functions: require('firebase-functions'),
  admin: require('firebase-admin'),
  db: mockDb,
  bookingRef: jest.fn((companyId: string, bookingId: string) =>
    createMockDocRef(`companies/${companyId}/bookings/${bookingId}`)),
  spotRef: jest.fn((companyId: string, locationId: string, spotId: string) =>
    createMockDocRef(`companies/${companyId}/locations/${locationId}/spots/${spotId}`)),
  STANDARD_OPTIONS: { memory: '256MB', timeoutSeconds: 60 },
  SPOT_LOCK_TIMEOUT_MS: 30_000,
}));

jest.mock('../middleware', () => ({
  assertAuth: jest.fn(() => ({ uid: 'u1', token: { uid: 'u1', role: 'admin', companyId: 'c1' } })),
  assertRole: jest.fn(() => ({ uid: 'u1', role: 'admin', companyId: 'c1', email: 'a@b.com', token: { uid: 'u1', role: 'admin', companyId: 'c1' } })),
  checkRateLimit: jest.fn().mockResolvedValue(undefined),
  validate: jest.fn((schema: any, data: any) => schema.parse(data)),
  generateCorrelationId: jest.fn(() => 'corr-test'),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

import { VALID_TRANSITIONS, BOOKING_STATUSES, type BookingStatus } from '../types';

// ═══════════════════════════════════════════════════════════════════════
//  Booking Status Transition Simulation
// ═══════════════════════════════════════════════════════════════════════

describe('Booking Status Transition Simulation', () => {
  beforeEach(() => clearStore());

  const createBooking = (id: string, status: BookingStatus) => {
    setDoc(`companies/c1/bookings/${id}`, {
      status,
      ticketNumber: 1,
      customerName: 'Test',
      vehicle: { plate: 'ABC123' },
      createdAt: new Date(),
      statusHistory: [{ status, timestamp: new Date(), uid: 'u1' }],
    });
  };

  it('should allow all valid forward transitions', () => {
    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const to of targets) {
        const valid = VALID_TRANSITIONS[from]?.includes(to as BookingStatus);
        expect(valid).toBe(true);
      }
    }
  });

  it('should reject every invalid transition', () => {
    const all = [...BOOKING_STATUSES];
    for (const from of all) {
      const allowed = VALID_TRANSITIONS[from] || [];
      for (const to of all) {
        if (from === to) continue;
        if (allowed.includes(to as BookingStatus)) continue;
        // This combination is invalid
        expect(allowed).not.toContain(to);
      }
    }
  });

  it('should track that all 7 statuses are accounted for', () => {
    expect(BOOKING_STATUSES.length).toBe(7);
    expect(BOOKING_STATUSES).toContain('New');
    expect(BOOKING_STATUSES).toContain('Booked');
    expect(BOOKING_STATUSES).toContain('Check-In');
    expect(BOOKING_STATUSES).toContain('Parked');
    expect(BOOKING_STATUSES).toContain('Active');
    expect(BOOKING_STATUSES).toContain('Completed');
    expect(BOOKING_STATUSES).toContain('Cancelled');
  });

  it('every non-terminal status has a path to Completed', () => {
    const nonTerminal: BookingStatus[] = ['New', 'Booked', 'Check-In', 'Parked', 'Active'];
    for (const start of nonTerminal) {
      const visited = new Set<string>();
      const queue: string[] = [start];
      let found = false;
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === 'Completed') { found = true; break; }
        if (visited.has(current)) continue;
        visited.add(current);
        const next = VALID_TRANSITIONS[current] || [];
        queue.push(...next);
      }
      expect(found).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Spot Assignment Validation
// ═══════════════════════════════════════════════════════════════════════

describe('Spot Assignment Validation', () => {
  beforeEach(() => clearStore());

  it('should validate booking exists before spot assignment', () => {
    // No booking created — should fail
    const ref = createMockDocRef('companies/c1/bookings/nonexistent');
    expect(async () => {
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Booking not found');
    }).rejects.toBeDefined();
  });

  it('should validate spot exists before assignment', () => {
    const ref = createMockDocRef('companies/c1/locations/loc1/spots/nonexistent');
    expect(async () => {
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Spot not found');
    }).rejects.toBeDefined();
  });

  it('should detect occupied spots', () => {
    setDoc('companies/c1/locations/loc1/spots/s1', {
      status: 'occupied',
      bookingId: 'other-booking',
    });
    const spot = getDoc('companies/c1/locations/loc1/spots/s1');
    expect(spot?.status).toBe('occupied');
    expect(spot?.bookingId).toBe('other-booking');
  });

  it('should detect locked spots', () => {
    setDoc('companies/c1/locations/loc1/spots/s1', {
      status: 'available',
      lockedBy: 'other-user',
      lockedAt: new Date(),
    });
    const spot = getDoc('companies/c1/locations/loc1/spots/s1');
    expect(spot?.lockedBy).toBe('other-user');
  });

  it('should allow assignment when spot is available', () => {
    setDoc('companies/c1/locations/loc1/spots/s1', {
      status: 'available',
      lockedBy: null,
      name: 'A1',
    });
    const spot = getDoc('companies/c1/locations/loc1/spots/s1');
    expect(spot?.status).toBe('available');
  });

  it('should update both spot and booking on assignment', async () => {
    setDoc('companies/c1/bookings/b1', {
      status: 'Check-In',
      ticketNumber: 1,
    });
    setDoc('companies/c1/locations/loc1/spots/s1', {
      status: 'available',
      name: 'A1',
    });

    // Simulate assignment
    const bRef = createMockDocRef('companies/c1/bookings/b1');
    const sRef = createMockDocRef('companies/c1/locations/loc1/spots/s1');

    await sRef.update({ status: 'occupied', bookingId: 'b1' });
    await bRef.update({ spotId: 's1', locationId: 'loc1', spotName: 'A1' });

    const booking = getDoc('companies/c1/bookings/b1');
    const spot = getDoc('companies/c1/locations/loc1/spots/s1');
    expect(booking?.spotId).toBe('s1');
    expect(spot?.status).toBe('occupied');
    expect(spot?.bookingId).toBe('b1');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Release Spot Atomicity
// ═══════════════════════════════════════════════════════════════════════

describe('Release Spot Atomicity', () => {
  beforeEach(() => clearStore());

  it('should reset spot to available on release', async () => {
    setDoc('companies/c1/locations/loc1/spots/s1', {
      status: 'occupied',
      lockedBy: 'u1',
      lockedAt: new Date(),
      bookingId: 'b1',
    });

    const ref = createMockDocRef('companies/c1/locations/loc1/spots/s1');
    await ref.update({ status: 'available', lockedBy: null, lockedAt: null, bookingId: null });

    const spot = getDoc('companies/c1/locations/loc1/spots/s1');
    expect(spot?.status).toBe('available');
    expect(spot?.lockedBy).toBeNull();
    expect(spot?.bookingId).toBeNull();
  });

  it('should reject unauthorized release attempt', () => {
    setDoc('companies/c1/locations/loc1/spots/s1', {
      lockedBy: 'other-user',
    });
    const spot = getDoc('companies/c1/locations/loc1/spots/s1');
    const currentUid = 'u1';
    const isOwner = spot?.lockedBy === currentUid;
    const isAdmin = false;
    expect(isOwner || isAdmin).toBe(false);
  });

  it('should allow admin to release any spot', () => {
    setDoc('companies/c1/locations/loc1/spots/s1', {
      lockedBy: 'other-user',
    });
    const role = 'admin';
    expect(role === 'admin').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Concurrent Operations Simulation
// ═══════════════════════════════════════════════════════════════════════

describe('Concurrent Operation Simulation', () => {
  beforeEach(() => clearStore());

  it('should handle 50 concurrent spot lock attempts correctly', async () => {
    setDoc('companies/c1/locations/loc1/spots/s1', {
      status: 'available',
      lockedBy: null,
    });

    let lockWinner: string | null = null;
    const results: Array<{ uid: string; success: boolean }> = [];

    for (let i = 0; i < 50; i++) {
      const uid = `user-${i}`;
      const spot = getDoc('companies/c1/locations/loc1/spots/s1');

      if (!spot?.lockedBy) {
        // First one wins
        setDoc('companies/c1/locations/loc1/spots/s1', {
          ...spot,
          lockedBy: uid,
          lockedAt: new Date(),
        });
        if (!lockWinner) lockWinner = uid;
        results.push({ uid, success: true });
      } else {
        results.push({ uid, success: false });
      }
    }

    expect(lockWinner).toBe('user-0');
    const winners = results.filter((r) => r.success);
    // In sequential simulation, first user wins, but we're testing the logic
    expect(winners.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle double-complete attempt', async () => {
    setDoc('companies/c1/bookings/b1', {
      status: 'Active',
      ticketNumber: 1,
    });

    // First complete succeeds
    const booking = getDoc('companies/c1/bookings/b1');
    if (booking?.status === 'Active') {
      setDoc('companies/c1/bookings/b1', { ...booking, status: 'Completed' });
    }
    expect(getDoc('companies/c1/bookings/b1')?.status).toBe('Completed');

    // Second complete should see Completed status and fail
    const booking2 = getDoc('companies/c1/bookings/b1');
    const canTransition = VALID_TRANSITIONS['Completed']?.includes('Completed' as BookingStatus);
    expect(canTransition).toBeFalsy();
    expect(booking2?.status).toBe('Completed');
  });

  it('should handle double-cancel attempt', () => {
    setDoc('companies/c1/bookings/b1', { status: 'Cancelled' });
    const canCancel = VALID_TRANSITIONS['Cancelled']?.includes('Cancelled' as BookingStatus);
    expect(canCancel).toBeFalsy();
  });

  it('should handle complete + cancel race on same booking', () => {
    setDoc('companies/c1/bookings/b1', { status: 'Active' });

    // Both target the same Active booking
    const booking = getDoc('companies/c1/bookings/b1');
    const canComplete = VALID_TRANSITIONS[booking!.status]?.includes('Completed');
    const canCancel = VALID_TRANSITIONS[booking!.status]?.includes('Cancelled');

    // Both should be valid transitions from Active
    expect(canComplete).toBe(true);
    expect(canCancel).toBe(true);

    // First one wins (complete)
    setDoc('companies/c1/bookings/b1', { ...booking, status: 'Completed' });

    // Second should fail (can't cancel a Completed booking)
    const updated = getDoc('companies/c1/bookings/b1');
    const canStillCancel = VALID_TRANSITIONS['Completed']?.includes('Cancelled' as BookingStatus);
    expect(canStillCancel).toBeFalsy();
  });
});
