/**
 * Tez — Service Integration Tests
 *
 * Tests for cross-cutting concerns and Firestore-dependent service logic:
 *  1. VALID_TRANSITIONS state machine correctness
 *  2. All schemas accept valid input and reject invalid input
 *  3. SafeString sanitization (XSS prevention)
 *  4. Plate normalization
 *  5. Config module constants
 */

import {
  VALID_TRANSITIONS,
  BOOKING_STATUSES,
  ROLES,
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
  PaymentWebhookSchema,
} from '../types';

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 1: State Machine (VALID_TRANSITIONS)
// ═══════════════════════════════════════════════════════════════════════

describe('VALID_TRANSITIONS', () => {
  it('should define transitions for New, Booked, Check-In, Parked, Active', () => {
    expect(VALID_TRANSITIONS).toHaveProperty('New');
    expect(VALID_TRANSITIONS).toHaveProperty('Booked');
    expect(VALID_TRANSITIONS).toHaveProperty('Check-In');
    expect(VALID_TRANSITIONS).toHaveProperty('Parked');
    expect(VALID_TRANSITIONS).toHaveProperty('Active');
  });

  it('should NOT define transitions from Completed or Cancelled (terminal states)', () => {
    expect(VALID_TRANSITIONS).not.toHaveProperty('Completed');
    expect(VALID_TRANSITIONS).not.toHaveProperty('Cancelled');
  });

  it('every non-terminal status should allow Cancelled as a transition', () => {
    const nonTerminal = ['New', 'Booked', 'Check-In', 'Parked', 'Active'];
    for (const status of nonTerminal) {
      expect(VALID_TRANSITIONS[status]).toContain('Cancelled');
    }
  });

  it('New → Booked should be valid', () => {
    expect(VALID_TRANSITIONS['New']).toContain('Booked');
  });

  it('Booked → Check-In should be valid', () => {
    expect(VALID_TRANSITIONS['Booked']).toContain('Check-In');
  });

  it('Check-In → Parked should be valid', () => {
    expect(VALID_TRANSITIONS['Check-In']).toContain('Parked');
  });

  it('Parked → Active should be valid', () => {
    expect(VALID_TRANSITIONS['Parked']).toContain('Active');
  });

  it('Active → Completed should be valid', () => {
    expect(VALID_TRANSITIONS['Active']).toContain('Completed');
  });

  it('New → Active should NOT be valid (skipping states)', () => {
    expect(VALID_TRANSITIONS['New']).not.toContain('Active');
  });

  it('Parked → Completed should NOT be valid (must go through Active)', () => {
    expect(VALID_TRANSITIONS['Parked']).not.toContain('Completed');
  });

  it('all transition targets should be valid booking statuses', () => {
    for (const [, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const target of targets) {
        expect(BOOKING_STATUSES).toContain(target);
      }
    }
  });

  it('happy path: New → Booked → Check-In → Parked → Active → Completed', () => {
    const path = ['New', 'Booked', 'Check-In', 'Parked', 'Active', 'Completed'];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i]!;
      const to = path[i + 1]!;
      expect(VALID_TRANSITIONS[from]).toContain(to);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 2: Constants
// ═══════════════════════════════════════════════════════════════════════

describe('Constants', () => {
  it('BOOKING_STATUSES should have 7 statuses', () => {
    expect(BOOKING_STATUSES).toHaveLength(7);
  });

  it('ROLES should have admin, operator, viewer', () => {
    expect(ROLES).toEqual(['admin', 'operator', 'viewer']);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 3: Schema Input Validation
// ═══════════════════════════════════════════════════════════════════════

describe('CreateBookingSchema', () => {
  const validInput = {
    customerName: 'John Doe',
    vehiclePlate: 'ABC-1234',
    customerPhone: '+1 (555) 123-4567',
    vehicleMake: 'Toyota',
    vehicleModel: 'Camry',
    vehicleColor: 'White',
    flightNumber: 'UA123',
    notes: 'VIP guest',
    idempotencyKey: 'unique-key-123',
  };

  it('should accept valid full input', () => {
    const result = CreateBookingSchema.parse(validInput);
    expect(result.customerName).toBe('John Doe');
    expect(result.vehiclePlate).toBe('ABC-1234');
  });

  it('should accept minimal input', () => {
    const result = CreateBookingSchema.parse({ customerName: 'Jane', vehiclePlate: 'XYZ789' });
    expect(result.customerName).toBe('Jane');
    expect(result.customerPhone).toBe('');
  });

  it('should reject empty customerName', () => {
    expect(() => CreateBookingSchema.parse({ customerName: '', vehiclePlate: 'AB' })).toThrow();
  });

  it('should reject empty vehiclePlate', () => {
    expect(() => CreateBookingSchema.parse({ customerName: 'A', vehiclePlate: '' })).toThrow();
  });

  it('should strip HTML tags from customerName', () => {
    const result = CreateBookingSchema.parse({
      customerName: 'Attack<script>alert("xss")</script>',
      vehiclePlate: 'AB1234',
    });
    expect(result.customerName).not.toContain('<script>');
    expect(result.customerName).not.toContain('<');
  });

  it('should uppercase and normalize vehiclePlate', () => {
    const result = CreateBookingSchema.parse({
      customerName: 'Test',
      vehiclePlate: 'abc-1234',
    });
    expect(result.vehiclePlate).toBe('ABC-1234');
  });

  it('should strip special chars from vehiclePlate', () => {
    const result = CreateBookingSchema.parse({
      customerName: 'Test',
      vehiclePlate: 'AB!@#$12',
    });
    expect(result.vehiclePlate).toBe('AB12');
  });

  it('should normalize flightNumber to uppercase alphanumeric', () => {
    const result = CreateBookingSchema.parse({
      customerName: 'Test',
      vehiclePlate: 'AB1234',
      flightNumber: 'ua-123',
    });
    expect(result.flightNumber).toBe('UA123');
  });

  it('should clean phone numbers', () => {
    const result = CreateBookingSchema.parse({
      customerName: 'Test',
      vehiclePlate: 'AB1234',
      customerPhone: '+1 (555) 123-4567',
    });
    // Should keep digits, +, -, (), and spaces
    expect(result.customerPhone).toBe('+1 (555) 123-4567');
  });
});

describe('TransitionBookingSchema', () => {
  it('should accept valid transition', () => {
    const result = TransitionBookingSchema.parse({
      bookingId: 'booking-123',
      newStatus: 'Booked',
    });
    expect(result.newStatus).toBe('Booked');
  });

  it('should reject invalid status', () => {
    expect(() =>
      TransitionBookingSchema.parse({ bookingId: 'x', newStatus: 'InvalidStatus' })
    ).toThrow();
  });

  it('should reject empty bookingId', () => {
    expect(() =>
      TransitionBookingSchema.parse({ bookingId: '', newStatus: 'Booked' })
    ).toThrow();
  });

  it('should default note to empty string', () => {
    const result = TransitionBookingSchema.parse({ bookingId: 'x', newStatus: 'Parked' });
    expect(result.note).toBe('');
  });
});

describe('CompleteBookingSchema', () => {
  it('should accept valid completion', () => {
    const result = CompleteBookingSchema.parse({
      bookingId: 'booking-123',
      paymentMethod: 'card',
      paymentAmount: 25.50,
    });
    expect(result.paymentMethod).toBe('card');
    expect(result.paymentAmount).toBe(25.50);
  });

  it('should default paymentMethod to cash', () => {
    const result = CompleteBookingSchema.parse({ bookingId: 'x' });
    expect(result.paymentMethod).toBe('cash');
  });

  it('should reject negative paymentAmount', () => {
    expect(() =>
      CompleteBookingSchema.parse({ bookingId: 'x', paymentAmount: -1 })
    ).toThrow();
  });

  it('should reject paymentAmount over 100K', () => {
    expect(() =>
      CompleteBookingSchema.parse({ bookingId: 'x', paymentAmount: 100_001 })
    ).toThrow();
  });

  it('should accept all payment methods', () => {
    const methods = ['cash', 'card', 'mobile', 'prepaid', 'invoice'];
    for (const m of methods) {
      const r = CompleteBookingSchema.parse({ bookingId: 'x', paymentMethod: m });
      expect(r.paymentMethod).toBe(m);
    }
  });
});

describe('CancelBookingSchema', () => {
  it('should accept valid cancellation', () => {
    const result = CancelBookingSchema.parse({ bookingId: 'x', reason: 'No show' });
    expect(result.reason).toBe('No show');
  });

  it('should default reason to empty', () => {
    const result = CancelBookingSchema.parse({ bookingId: 'x' });
    expect(result.reason).toBe('');
  });

  it('should reject reason over 500 chars', () => {
    expect(() =>
      CancelBookingSchema.parse({ bookingId: 'x', reason: 'r'.repeat(501) })
    ).toThrow();
  });
});

describe('AssignSpotSchema', () => {
  it('should accept valid assignment', () => {
    const result = AssignSpotSchema.parse({ bookingId: 'b1', locationId: 'L1', spotId: 'S1' });
    expect(result.bookingId).toBe('b1');
    expect(result.locationId).toBe('L1');
    expect(result.spotId).toBe('S1');
  });

  it('should reject empty bookingId', () => {
    expect(() => AssignSpotSchema.parse({ bookingId: '', locationId: 'L1', spotId: 'S1' })).toThrow();
  });

  it('should reject empty locationId', () => {
    expect(() => AssignSpotSchema.parse({ bookingId: 'B1', locationId: '', spotId: 'S1' })).toThrow();
  });

  it('should reject empty spotId', () => {
    expect(() => AssignSpotSchema.parse({ bookingId: 'B1', locationId: 'L1', spotId: '' })).toThrow();
  });
});

describe('LockSpotSchema & ReleaseSpotSchema', () => {
  it('LockSpotSchema should accept valid input', () => {
    const r = LockSpotSchema.parse({ locationId: 'L1', spotId: 'S1' });
    expect(r.locationId).toBe('L1');
  });

  it('ReleaseSpotSchema should accept valid input', () => {
    const r = ReleaseSpotSchema.parse({ locationId: 'L1', spotId: 'S1' });
    expect(r.spotId).toBe('S1');
  });

  it('both should reject empty ids', () => {
    expect(() => LockSpotSchema.parse({ locationId: '', spotId: 'S1' })).toThrow();
    expect(() => ReleaseSpotSchema.parse({ locationId: 'L1', spotId: '' })).toThrow();
  });
});

describe('LookupFlightSchema', () => {
  it('should accept and normalize valid flight number', () => {
    const result = LookupFlightSchema.parse({ flightNumber: 'ua-123' });
    expect(result.flightNumber).toBe('UA123');
  });

  it('should reject empty flight number', () => {
    expect(() => LookupFlightSchema.parse({ flightNumber: '' })).toThrow();
  });

  it('should strip special characters', () => {
    const result = LookupFlightSchema.parse({ flightNumber: 'AA#1@2!3' });
    expect(result.flightNumber).toBe('AA123');
  });
});

describe('SetUserRoleSchema', () => {
  it('should accept valid role', () => {
    const result = SetUserRoleSchema.parse({ userId: 'user-123', role: 'operator' });
    expect(result.role).toBe('operator');
  });

  it('should reject invalid role', () => {
    expect(() => SetUserRoleSchema.parse({ userId: 'x', role: 'superadmin' })).toThrow();
  });

  it('should reject empty userId', () => {
    expect(() => SetUserRoleSchema.parse({ userId: '', role: 'admin' })).toThrow();
  });
});

describe('ListBookingsSchema', () => {
  it('should accept empty input with defaults', () => {
    const result = ListBookingsSchema.parse({});
    expect(result.limit).toBe(25);
    expect(result.orderBy).toBe('createdAt');
    expect(result.direction).toBe('desc');
  });

  it('should accept all orderBy options', () => {
    for (const o of ['createdAt', 'updatedAt', 'ticketNumber']) {
      expect(ListBookingsSchema.parse({ orderBy: o }).orderBy).toBe(o);
    }
  });

  it('should accept asc and desc direction', () => {
    expect(ListBookingsSchema.parse({ direction: 'asc' }).direction).toBe('asc');
    expect(ListBookingsSchema.parse({ direction: 'desc' }).direction).toBe('desc');
  });

  it('should accept status filter', () => {
    const result = ListBookingsSchema.parse({ status: 'Parked' });
    expect(result.status).toBe('Parked');
  });

  it('should reject invalid status filter', () => {
    expect(() => ListBookingsSchema.parse({ status: 'Invalid' })).toThrow();
  });

  it('should reject limit over 100', () => {
    expect(() => ListBookingsSchema.parse({ limit: 200 })).toThrow();
  });

  it('should reject limit less than 1', () => {
    expect(() => ListBookingsSchema.parse({ limit: 0 })).toThrow();
  });
});

describe('PaymentWebhookSchema', () => {
  const valid = {
    provider: 'stripe',
    eventType: 'payment_intent.succeeded',
    bookingId: 'b123',
    amount: 25.50,
    currency: 'USD',
    transactionId: 'txn_abc123',
  };

  it('should accept valid webhook', () => {
    const result = PaymentWebhookSchema.parse(valid);
    expect(result.provider).toBe('stripe');
    expect(result.amount).toBe(25.50);
  });

  it('should accept square provider', () => {
    const result = PaymentWebhookSchema.parse({ ...valid, provider: 'square' });
    expect(result.provider).toBe('square');
  });

  it('should reject invalid provider', () => {
    expect(() => PaymentWebhookSchema.parse({ ...valid, provider: 'paypal' })).toThrow();
  });

  it('should reject negative amount', () => {
    expect(() => PaymentWebhookSchema.parse({ ...valid, amount: -1 })).toThrow();
  });

  it('should default currency to USD', () => {
    const { currency: _, ...noCurrency } = valid;
    const result = PaymentWebhookSchema.parse(noCurrency);
    expect(result.currency).toBe('USD');
  });

  it('should accept optional metadata', () => {
    const result = PaymentWebhookSchema.parse({
      ...valid,
      metadata: { key1: 'val1', key2: 'val2' },
    });
    expect(result.metadata).toEqual({ key1: 'val1', key2: 'val2' });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 4: XSS Prevention via safeString
// ═══════════════════════════════════════════════════════════════════════

describe('XSS prevention (safeString transform)', () => {
  it('should strip < and > from customer name', () => {
    const result = CreateBookingSchema.parse({
      customerName: '<img src=x onerror=alert(1)>',
      vehiclePlate: 'AB1234',
    });
    expect(result.customerName).not.toContain('<');
    expect(result.customerName).not.toContain('>');
  });

  it('should strip script tags from notes', () => {
    const result = CreateBookingSchema.parse({
      customerName: 'Test',
      vehiclePlate: 'AB1234',
      notes: '<script>document.cookie</script>',
    });
    expect(result.notes).not.toContain('<script>');
  });

  it('should encode bare ampersands but preserve HTML entities', () => {
    const result = CreateBookingSchema.parse({
      customerName: 'Tom & Jerry &amp; friends',
      vehiclePlate: 'AB1234',
    });
    // Bare & should be converted to &amp;, existing &amp; stays
    expect(result.customerName).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });

  it('should trim whitespace', () => {
    const result = CreateBookingSchema.parse({
      customerName: '  John Doe  ',
      vehiclePlate: 'AB1234',
    });
    expect(result.customerName).toBe('John Doe');
  });
});
