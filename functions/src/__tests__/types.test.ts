/**
 * Tez — Types & Schema Tests
 */

import {
  VALID_TRANSITIONS,
  BOOKING_STATUSES,
  ROLES,
  type BookingStatus,
} from '../types';

describe('VALID_TRANSITIONS', () => {
  it('should define transitions for all non-terminal statuses', () => {
    const nonTerminal: BookingStatus[] = ['New', 'Booked', 'Check-In', 'Parked', 'Active'];
    for (const status of nonTerminal) {
      expect(VALID_TRANSITIONS[status]).toBeDefined();
      expect(VALID_TRANSITIONS[status]!.length).toBeGreaterThan(0);
    }
  });

  it('should not define transitions for terminal statuses', () => {
    expect(VALID_TRANSITIONS['Completed']).toBeUndefined();
    expect(VALID_TRANSITIONS['Cancelled']).toBeUndefined();
  });

  it('should allow Active → Cancelled', () => {
    expect(VALID_TRANSITIONS['Active']).toContain('Cancelled');
  });

  it('should allow Active → Completed', () => {
    expect(VALID_TRANSITIONS['Active']).toContain('Completed');
  });

  it('should allow every non-terminal status to be cancelled', () => {
    const nonTerminal: BookingStatus[] = ['New', 'Booked', 'Check-In', 'Parked', 'Active'];
    for (const status of nonTerminal) {
      expect(VALID_TRANSITIONS[status]).toContain('Cancelled');
    }
  });

  it('should enforce proper booking lifecycle order', () => {
    expect(VALID_TRANSITIONS['New']).toContain('Booked');
    expect(VALID_TRANSITIONS['Booked']).toContain('Check-In');
    expect(VALID_TRANSITIONS['Check-In']).toContain('Parked');
    expect(VALID_TRANSITIONS['Parked']).toContain('Active');
    expect(VALID_TRANSITIONS['Active']).toContain('Completed');
  });

  it('should allow New → Check-In for walk-up valet', () => {
    expect(VALID_TRANSITIONS['New']).toContain('Check-In');
  });

  it('should not allow backward transitions', () => {
    expect(VALID_TRANSITIONS['Active']).not.toContain('Parked');
    expect(VALID_TRANSITIONS['Parked']).not.toContain('Check-In');
    expect(VALID_TRANSITIONS['Booked']).not.toContain('New');
  });
});

describe('Constants', () => {
  it('should have 7 booking statuses', () => {
    expect(BOOKING_STATUSES).toHaveLength(7);
  });

  it('should have 3 roles', () => {
    expect(ROLES).toHaveLength(3);
    expect(ROLES).toContain('admin');
    expect(ROLES).toContain('operator');
    expect(ROLES).toContain('viewer');
  });
});
