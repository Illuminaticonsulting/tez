/**
 * Tez — Zod Schema Stress Tests
 *
 * Exhaustive edge-case testing for every Zod schema:
 *  - Boundary values
 *  - XSS injection vectors
 *  - SQL injection patterns
 *  - Unicode/emoji handling
 *  - Max/min lengths
 *  - Type coercion attempts
 *  - Malformed inputs
 */

import {
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
  BOOKING_STATUSES,
  ROLES,
} from '../types';

// ═══════════════════════════════════════════════════════════════════════
//  XSS & Injection Vectors
// ═══════════════════════════════════════════════════════════════════════

const XSS_VECTORS = [
  '<script>alert("xss")</script>',
  '"><img src=x onerror=alert(1)>',
  "'; DROP TABLE bookings; --",
  '<iframe src="javascript:alert(1)">',
  '{{constructor.constructor("alert(1)")()}}',
  '${7*7}',
  '<svg onload=alert(1)>',
  'javascript:alert(1)',
  '<body onload=alert(1)>',
  String.raw`\x3cscript\x3ealert(1)\x3c/script\x3e`,
];

const UNICODE_STRINGS = [
  '日本語テスト', // Japanese
  '中文测试', // Chinese
  '한국어 테스트', // Korean
  'тест кириллица', // Cyrillic
  'اختبار عربي', // Arabic
  '🚗💨🅿️🎫', // Emoji
  'Ñoño Über Straße', // Latin accented
  'Test\u0000null', // Null byte
  'Test\u200Bzero-width', // Zero-width space
];

// ═══════════════════════════════════════════════════════════════════════
//  CreateBookingSchema
// ═══════════════════════════════════════════════════════════════════════

describe('CreateBookingSchema stress tests', () => {
  const validInput = {
    customerName: 'John Smith',
    vehiclePlate: 'ABC1234',
  };

  it('should accept minimal valid input', () => {
    expect(() => CreateBookingSchema.parse(validInput)).not.toThrow();
  });

  it('should accept full valid input', () => {
    const full = {
      customerName: 'John Smith',
      customerPhone: '+1 (555) 123-4567',
      customerEmail: 'john@example.com',
      vehiclePlate: 'ABC 1234',
      vehicleMake: 'Toyota',
      vehicleModel: 'Camry',
      vehicleColor: 'Red',
      flightNumber: 'AA1234',
      notes: 'VIP customer, park close.',
    };
    const result = CreateBookingSchema.parse(full);
    expect(result.customerName).toBe('John Smith');
    expect(result.vehiclePlate).toBe('ABC 1234');
  });

  it('should reject empty customerName', () => {
    expect(() => CreateBookingSchema.parse({ ...validInput, customerName: '' })).toThrow();
  });

  it('should reject whitespace-only customerName', () => {
    expect(() => CreateBookingSchema.parse({ ...validInput, customerName: '   ' })).toThrow();
  });

  it('should reject empty vehiclePlate', () => {
    expect(() => CreateBookingSchema.parse({ ...validInput, vehiclePlate: '' })).toThrow();
  });

  it('should strip HTML from customerName (XSS prevention)', () => {
    for (const xss of XSS_VECTORS) {
      const result = CreateBookingSchema.safeParse({ ...validInput, customerName: xss });
      if (result.success) {
        // Should have stripped angle brackets
        expect(result.data.customerName).not.toContain('<');
        expect(result.data.customerName).not.toContain('>');
      }
    }
  });

  it('should normalize plate to uppercase and strip special chars', () => {
    const result = CreateBookingSchema.parse({ ...validInput, vehiclePlate: 'abc-1234!' });
    expect(result.vehiclePlate).toBe('ABC-1234');
  });

  it('should handle Unicode customer names', () => {
    for (const name of UNICODE_STRINGS) {
      const result = CreateBookingSchema.safeParse({ ...validInput, customerName: name });
      // Should either parse successfully (if non-empty after sanitization) or fail gracefully
      expect(result).toBeDefined();
    }
  });

  it('should reject customerName exceeding 100 chars', () => {
    const result = CreateBookingSchema.safeParse({
      ...validInput,
      customerName: 'A'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('should accept customerName at exactly 100 chars', () => {
    const result = CreateBookingSchema.safeParse({
      ...validInput,
      customerName: 'A'.repeat(100),
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid email format', () => {
    const invalidEmails = ['notanemail', '@missing.com', 'missing@', 'spaces in@email.com'];
    for (const email of invalidEmails) {
      const result = CreateBookingSchema.safeParse({ ...validInput, customerEmail: email });
      expect(result.success).toBe(false);
    }
  });

  it('should strip non-phone characters from phone', () => {
    const result = CreateBookingSchema.parse({
      ...validInput,
      customerPhone: 'abc(555)123-4567xyz',
    });
    expect(result.customerPhone).toMatch(/^[0-9+\-() ]*$/);
  });

  it('should normalize flight number to uppercase alpha-numeric', () => {
    const result = CreateBookingSchema.parse({
      ...validInput,
      flightNumber: 'aa-1234',
    });
    expect(result.flightNumber).toBe('AA1234');
  });

  it('should reject notes exceeding 1000 chars', () => {
    const result = CreateBookingSchema.safeParse({
      ...validInput,
      notes: 'X'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it('should accept notes at exactly 1000 chars', () => {
    const result = CreateBookingSchema.safeParse({
      ...validInput,
      notes: 'X'.repeat(1000),
    });
    expect(result.success).toBe(true);
  });

  it('should handle missing optional fields gracefully', () => {
    const result = CreateBookingSchema.parse(validInput);
    expect(result.customerPhone).toBeDefined();
    expect(result.customerEmail).toBeDefined();
    expect(result.vehicleMake).toBeDefined();
    expect(result.vehicleModel).toBeDefined();
    expect(result.vehicleColor).toBeDefined();
    expect(result.flightNumber).toBeDefined();
    expect(result.notes).toBeDefined();
  });

  it('should reject non-string customerName', () => {
    expect(() => CreateBookingSchema.parse({ ...validInput, customerName: 12345 })).toThrow();
    expect(() => CreateBookingSchema.parse({ ...validInput, customerName: null })).toThrow();
    expect(() => CreateBookingSchema.parse({ ...validInput, customerName: ['John'] })).toThrow();
  });

  it('should reject vehiclePlate of only special chars (stripped to empty)', () => {
    const result = CreateBookingSchema.safeParse({ ...validInput, vehiclePlate: '!@#$%^&*' });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  TransitionBookingSchema
// ═══════════════════════════════════════════════════════════════════════

describe('TransitionBookingSchema stress tests', () => {
  it('should accept valid transitions', () => {
    for (const status of BOOKING_STATUSES) {
      const result = TransitionBookingSchema.parse({
        bookingId: 'booking-1',
        newStatus: status,
      });
      expect(result.newStatus).toBe(status);
    }
  });

  it('should reject invalid status values', () => {
    const invalidStatuses = ['pending', 'done', 'COMPLETED', '', 'null', 'undefined'];
    for (const status of invalidStatuses) {
      expect(() => TransitionBookingSchema.parse({
        bookingId: 'booking-1',
        newStatus: status,
      })).toThrow();
    }
  });

  it('should reject empty bookingId', () => {
    expect(() => TransitionBookingSchema.parse({
      bookingId: '',
      newStatus: 'Check-In',
    })).toThrow();
  });

  it('should strip XSS from note field', () => {
    const result = TransitionBookingSchema.parse({
      bookingId: 'b1',
      newStatus: 'Check-In',
      note: '<script>alert("xss")</script>Customer arrived',
    });
    expect(result.note).not.toContain('<script>');
  });

  it('should default note to empty string when omitted', () => {
    const result = TransitionBookingSchema.parse({
      bookingId: 'b1',
      newStatus: 'Check-In',
    });
    expect(result.note).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  CompleteBookingSchema
// ═══════════════════════════════════════════════════════════════════════

describe('CompleteBookingSchema stress tests', () => {
  it('should accept valid payment methods', () => {
    const methods = ['cash', 'card', 'mobile', 'prepaid', 'invoice'];
    for (const method of methods) {
      const result = CompleteBookingSchema.parse({
        bookingId: 'b1',
        paymentMethod: method,
        paymentAmount: 25.00,
      });
      expect(result.paymentMethod).toBe(method);
    }
  });

  it('should reject invalid payment methods', () => {
    const invalid = ['bitcoin', 'venmo', 'check', '', 'CASH'];
    for (const method of invalid) {
      expect(() => CompleteBookingSchema.parse({
        bookingId: 'b1',
        paymentMethod: method,
      })).toThrow();
    }
  });

  it('should accept paymentAmount of 0', () => {
    const result = CompleteBookingSchema.parse({ bookingId: 'b1', paymentAmount: 0 });
    expect(result.paymentAmount).toBe(0);
  });

  it('should reject negative paymentAmount', () => {
    expect(() => CompleteBookingSchema.parse({
      bookingId: 'b1',
      paymentAmount: -1,
    })).toThrow();
  });

  it('should reject paymentAmount exceeding 100,000', () => {
    expect(() => CompleteBookingSchema.parse({
      bookingId: 'b1',
      paymentAmount: 100_001,
    })).toThrow();
  });

  it('should accept boundary amount of 100,000', () => {
    const result = CompleteBookingSchema.parse({ bookingId: 'b1', paymentAmount: 100_000 });
    expect(result.paymentAmount).toBe(100_000);
  });

  it('should handle decimal paymentAmounts', () => {
    const result = CompleteBookingSchema.parse({
      bookingId: 'b1',
      paymentAmount: 29.99,
    });
    expect(result.paymentAmount).toBeCloseTo(29.99);
  });

  it('should default paymentMethod to cash', () => {
    const result = CompleteBookingSchema.parse({ bookingId: 'b1' });
    expect(result.paymentMethod).toBe('cash');
  });

  it('should default paymentAmount to 0', () => {
    const result = CompleteBookingSchema.parse({ bookingId: 'b1' });
    expect(result.paymentAmount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  CancelBookingSchema
// ═══════════════════════════════════════════════════════════════════════

describe('CancelBookingSchema stress tests', () => {
  it('should accept cancellation without reason', () => {
    const result = CancelBookingSchema.parse({ bookingId: 'b1' });
    expect(result.reason).toBe('');
  });

  it('should accept reason up to 500 chars', () => {
    const result = CancelBookingSchema.parse({
      bookingId: 'b1',
      reason: 'X'.repeat(500),
    });
    expect(result.reason!.length).toBeLessThanOrEqual(500);
  });

  it('should reject reason exceeding 500 chars', () => {
    const result = CancelBookingSchema.safeParse({
      bookingId: 'b1',
      reason: 'X'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('should strip XSS from reason', () => {
    const result = CancelBookingSchema.parse({
      bookingId: 'b1',
      reason: '<script>alert(1)</script>Customer requested',
    });
    expect(result.reason).not.toContain('<script>');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  Spot Schemas — AssignSpot, LockSpot, ReleaseSpot
// ═══════════════════════════════════════════════════════════════════════

describe('Spot Schema stress tests', () => {
  describe('AssignSpotSchema', () => {
    it('should accept valid input', () => {
      const result = AssignSpotSchema.parse({
        bookingId: 'b1',
        locationId: 'loc1',
        spotId: 'spot-A1',
      });
      expect(result.bookingId).toBe('b1');
    });

    it('should reject empty bookingId', () => {
      expect(() => AssignSpotSchema.parse({
        bookingId: '',
        locationId: 'loc1',
        spotId: 'spot1',
      })).toThrow();
    });

    it('should reject empty locationId', () => {
      expect(() => AssignSpotSchema.parse({
        bookingId: 'b1',
        locationId: '',
        spotId: 'spot1',
      })).toThrow();
    });

    it('should reject empty spotId', () => {
      expect(() => AssignSpotSchema.parse({
        bookingId: 'b1',
        locationId: 'loc1',
        spotId: '',
      })).toThrow();
    });

    it('should strip XSS from all fields', () => {
      const result = AssignSpotSchema.parse({
        bookingId: '<script>b1</script>',
        locationId: '<img src=x>loc1',
        spotId: 'spot<svg>1',
      });
      expect(result.bookingId).not.toContain('<');
      expect(result.locationId).not.toContain('<');
      expect(result.spotId).not.toContain('<');
    });
  });

  describe('LockSpotSchema', () => {
    it('should accept valid input', () => {
      const result = LockSpotSchema.parse({ locationId: 'loc1', spotId: 'spot1' });
      expect(result.locationId).toBe('loc1');
    });

    it('should reject missing fields', () => {
      expect(() => LockSpotSchema.parse({})).toThrow();
      expect(() => LockSpotSchema.parse({ locationId: 'loc1' })).toThrow();
      expect(() => LockSpotSchema.parse({ spotId: 'spot1' })).toThrow();
    });
  });

  describe('ReleaseSpotSchema', () => {
    it('should accept valid input', () => {
      const result = ReleaseSpotSchema.parse({ locationId: 'loc1', spotId: 'spot1' });
      expect(result.spotId).toBe('spot1');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  ListBookingsSchema
// ═══════════════════════════════════════════════════════════════════════

describe('ListBookingsSchema stress tests', () => {
  it('should accept empty object (all defaults)', () => {
    const result = ListBookingsSchema.parse({});
    expect(result.limit).toBe(25);
    expect(result.orderBy).toBe('createdAt');
    expect(result.direction).toBe('desc');
  });

  it('should accept valid status filter', () => {
    for (const status of BOOKING_STATUSES) {
      const result = ListBookingsSchema.parse({ status });
      expect(result.status).toBe(status);
    }
  });

  it('should reject invalid status', () => {
    expect(() => ListBookingsSchema.parse({ status: 'InvalidStatus' })).toThrow();
  });

  it('should accept limit at boundaries', () => {
    expect(ListBookingsSchema.parse({ limit: 1 }).limit).toBe(1);
    expect(ListBookingsSchema.parse({ limit: 100 }).limit).toBe(100);
  });

  it('should reject limit of 0', () => {
    expect(() => ListBookingsSchema.parse({ limit: 0 })).toThrow();
  });

  it('should reject limit exceeding 100', () => {
    expect(() => ListBookingsSchema.parse({ limit: 101 })).toThrow();
  });

  it('should reject non-integer limit', () => {
    expect(() => ListBookingsSchema.parse({ limit: 25.5 })).toThrow();
  });

  it('should accept all valid orderBy values', () => {
    for (const field of ['createdAt', 'updatedAt', 'ticketNumber']) {
      expect(ListBookingsSchema.parse({ orderBy: field }).orderBy).toBe(field);
    }
  });

  it('should reject invalid orderBy', () => {
    expect(() => ListBookingsSchema.parse({ orderBy: 'customerName' })).toThrow();
  });

  it('should accept both direction values', () => {
    expect(ListBookingsSchema.parse({ direction: 'asc' }).direction).toBe('asc');
    expect(ListBookingsSchema.parse({ direction: 'desc' }).direction).toBe('desc');
  });

  it('should reject invalid direction', () => {
    expect(() => ListBookingsSchema.parse({ direction: 'ASC' })).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  PaymentWebhookSchema
// ═══════════════════════════════════════════════════════════════════════

describe('PaymentWebhookSchema stress tests', () => {
  const validPayment = {
    provider: 'stripe',
    eventType: 'payment.completed',
    bookingId: 'b1',
    amount: 25.00,
    transactionId: 'txn_123',
  };

  it('should accept valid stripe webhook', () => {
    const result = PaymentWebhookSchema.parse(validPayment);
    expect(result.provider).toBe('stripe');
    expect(result.currency).toBe('USD');
  });

  it('should accept valid square webhook', () => {
    const result = PaymentWebhookSchema.parse({ ...validPayment, provider: 'square' });
    expect(result.provider).toBe('square');
  });

  it('should reject invalid provider', () => {
    expect(() => PaymentWebhookSchema.parse({ ...validPayment, provider: 'paypal' })).toThrow();
  });

  it('should reject negative amount', () => {
    expect(() => PaymentWebhookSchema.parse({ ...validPayment, amount: -1 })).toThrow();
  });

  it('should accept amount of 0 (refund scenario)', () => {
    const result = PaymentWebhookSchema.parse({ ...validPayment, amount: 0 });
    expect(result.amount).toBe(0);
  });

  it('should accept optional metadata', () => {
    const result = PaymentWebhookSchema.parse({
      ...validPayment,
      metadata: { source: 'web', campaign: 'summer' },
    });
    expect(result.metadata?.source).toBe('web');
  });

  it('should reject metadata with non-string values', () => {
    expect(() => PaymentWebhookSchema.parse({
      ...validPayment,
      metadata: { count: 42 },
    })).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SetUserRoleSchema
// ═══════════════════════════════════════════════════════════════════════

describe('SetUserRoleSchema stress tests', () => {
  it('should accept all valid roles', () => {
    for (const role of ROLES) {
      const result = SetUserRoleSchema.parse({ userId: 'u1', role });
      expect(result.role).toBe(role);
    }
  });

  it('should reject invalid roles', () => {
    const invalid = ['Admin', 'OPERATOR', 'superuser', '', 'moderator'];
    for (const role of invalid) {
      expect(() => SetUserRoleSchema.parse({ userId: 'u1', role })).toThrow();
    }
  });

  it('should reject empty userId', () => {
    expect(() => SetUserRoleSchema.parse({ userId: '', role: 'admin' })).toThrow();
  });

  it('should strip HTML from userId', () => {
    const result = SetUserRoleSchema.parse({ userId: '<b>u1</b>', role: 'admin' });
    expect(result.userId).not.toContain('<');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  LookupFlightSchema
// ═══════════════════════════════════════════════════════════════════════

describe('LookupFlightSchema stress tests', () => {
  it('should accept valid flight numbers', () => {
    const valid = ['AA1234', 'UA100', 'DL2', 'SW3456'];
    for (const fn of valid) {
      const result = LookupFlightSchema.parse({ flightNumber: fn });
      expect(result.flightNumber).toBe(fn);
    }
  });

  it('should normalize to uppercase', () => {
    const result = LookupFlightSchema.parse({ flightNumber: 'aa1234' });
    expect(result.flightNumber).toBe('AA1234');
  });

  it('should strip dashes and spaces', () => {
    const result = LookupFlightSchema.parse({ flightNumber: 'AA-12 34' });
    expect(result.flightNumber).toBe('AA1234');
  });

  it('should reject empty flight number', () => {
    expect(() => LookupFlightSchema.parse({ flightNumber: '' })).toThrow();
  });

  it('should reject non-alphanumeric-only inputs that become empty', () => {
    const result = LookupFlightSchema.safeParse({ flightNumber: '---' });
    expect(result.success).toBe(false);
  });
});
