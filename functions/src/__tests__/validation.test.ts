/**
 * Tez — Validation Middleware Tests
 */

import { validate } from '../middleware/validation';
import { CreateBookingSchema, TransitionBookingSchema, LockSpotSchema, SetUserRoleSchema, ListBookingsSchema } from '../types';

describe('validate()', () => {
  describe('CreateBookingSchema', () => {
    it('should accept valid booking data', () => {
      const result = validate(CreateBookingSchema, {
        customerName: 'John Doe',
        vehiclePlate: 'ABC-1234',
      });
      expect(result.customerName).toBe('John Doe');
      expect(result.vehiclePlate).toBe('ABC-1234');
      expect(result.notes).toBe('');
      expect(result.vehicleMake).toBe('');
    });

    it('should reject missing customerName', () => {
      expect(() =>
        validate(CreateBookingSchema, { vehiclePlate: 'ABC-1234' }),
      ).toThrow('Validation failed');
    });

    it('should reject missing vehiclePlate', () => {
      expect(() =>
        validate(CreateBookingSchema, { customerName: 'John' }),
      ).toThrow('Validation failed');
    });

    it('should strip HTML tags from customerName', () => {
      const result = validate(CreateBookingSchema, {
        customerName: '<script>alert("xss")</script>John',
        vehiclePlate: 'ABC-1234',
      });
      expect(result.customerName).toBe('scriptalert("xss")/scriptJohn');
    });

    it('should uppercase and sanitize plate', () => {
      const result = validate(CreateBookingSchema, {
        customerName: 'Jane',
        vehiclePlate: 'abc 1234!@#',
      });
      expect(result.vehiclePlate).toBe('ABC 1234');
    });

    it('should reject excessively long names', () => {
      const longName = 'A'.repeat(200);
      expect(() =>
        validate(CreateBookingSchema, {
          customerName: longName,
          vehiclePlate: 'XYZ',
        }),
      ).toThrow('Validation failed');
    });

    it('should accept idempotencyKey', () => {
      const result = validate(CreateBookingSchema, {
        customerName: 'Test',
        vehiclePlate: 'XYZ',
        idempotencyKey: 'unique-key-123',
      });
      expect(result.idempotencyKey).toBe('unique-key-123');
    });

    it('should handle null/undefined data', () => {
      expect(() => validate(CreateBookingSchema, null)).toThrow('Validation failed');
      expect(() => validate(CreateBookingSchema, undefined)).toThrow('Validation failed');
    });
  });

  describe('TransitionBookingSchema', () => {
    it('should accept valid transition', () => {
      const result = validate(TransitionBookingSchema, {
        bookingId: 'booking-123',
        newStatus: 'Active',
      });
      expect(result.bookingId).toBe('booking-123');
      expect(result.newStatus).toBe('Active');
      expect(result.note).toBe('');
    });

    it('should reject invalid status', () => {
      expect(() =>
        validate(TransitionBookingSchema, {
          bookingId: 'booking-123',
          newStatus: 'InvalidStatus',
        }),
      ).toThrow('Validation failed');
    });

    it('should reject empty bookingId', () => {
      expect(() =>
        validate(TransitionBookingSchema, {
          bookingId: '',
          newStatus: 'Active',
        }),
      ).toThrow('Validation failed');
    });
  });

  describe('LockSpotSchema', () => {
    it('should accept valid spot lock', () => {
      const result = validate(LockSpotSchema, {
        locationId: 'loc-1',
        spotId: 'spot-42',
      });
      expect(result.locationId).toBe('loc-1');
      expect(result.spotId).toBe('spot-42');
    });

    it('should reject missing locationId', () => {
      expect(() => validate(LockSpotSchema, { spotId: 'spot-1' })).toThrow('Validation failed');
    });
  });

  describe('SetUserRoleSchema', () => {
    it('should accept valid role assignment', () => {
      const result = validate(SetUserRoleSchema, {
        userId: 'user-123',
        role: 'operator',
      });
      expect(result.userId).toBe('user-123');
      expect(result.role).toBe('operator');
    });

    it('should reject invalid role', () => {
      expect(() =>
        validate(SetUserRoleSchema, { userId: 'user-123', role: 'superadmin' }),
      ).toThrow('Validation failed');
    });
  });

  describe('ListBookingsSchema', () => {
    it('should apply defaults', () => {
      const result = validate(ListBookingsSchema, {});
      expect(result.limit).toBe(25);
      expect(result.orderBy).toBe('createdAt');
      expect(result.direction).toBe('desc');
      expect(result.status).toBeUndefined();
    });

    it('should accept valid filters', () => {
      const result = validate(ListBookingsSchema, {
        status: 'Active',
        limit: 50,
        orderBy: 'ticketNumber',
        direction: 'asc',
      });
      expect(result.status).toBe('Active');
      expect(result.limit).toBe(50);
      expect(result.orderBy).toBe('ticketNumber');
      expect(result.direction).toBe('asc');
    });

    it('should reject limit > 100', () => {
      expect(() => validate(ListBookingsSchema, { limit: 500 })).toThrow('Validation failed');
    });

    it('should reject limit < 1', () => {
      expect(() => validate(ListBookingsSchema, { limit: 0 })).toThrow('Validation failed');
    });
  });
});
