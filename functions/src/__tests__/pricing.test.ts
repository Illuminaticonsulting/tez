/**
 * Tez — Dynamic Pricing Engine Tests
 *
 * Tests every factor, edge case, fairness cap, smoothing,
 * and the complete quote calculation pipeline.
 */

import {
  DEFAULT_PRICING_CONFIG,
  PricingConfig,
  calculatePriceQuote,
  getTimeOfDayFactor,
  getDayOfWeekFactor,
  getDemandFactor,
  getSeasonalFactor,
  getVehicleTypeFactor,
  getAdvanceBookingFactor,
  getLoyaltyFactor,
  calculateDurationSubtotal,
  applyFairnessCap,
  applySmoothing,
  detectVehicleType,
} from '../services/pricing';

// ═══════════════════════════════════════════════════════════════════════
//  Default config for tests
// ═══════════════════════════════════════════════════════════════════════

const config: PricingConfig = { ...DEFAULT_PRICING_CONFIG };

// ═══════════════════════════════════════════════════════════════════════
//  1. TIME-OF-DAY FACTOR
// ═══════════════════════════════════════════════════════════════════════

describe('getTimeOfDayFactor', () => {
  it('should return off-peak discount at midnight', () => {
    const f = getTimeOfDayFactor(config, 0);
    expect(f.multiplier).toBe(0.70);
    expect(f.applied).toBe(true);
    expect(f.description).toContain('Off-peak');
  });

  it('should return peak multiplier at 7am', () => {
    const f = getTimeOfDayFactor(config, 7);
    expect(f.multiplier).toBe(1.20);
    expect(f.applied).toBe(true);
    expect(f.description).toContain('Peak');
  });

  it('should return standard at noon', () => {
    const f = getTimeOfDayFactor(config, 12);
    expect(f.multiplier).toBe(1.00);
    expect(f.applied).toBe(false);
  });

  it('should clamp invalid hours', () => {
    const f = getTimeOfDayFactor(config, -1);
    expect(f.multiplier).toBe(0.70); // hour 0
    const f2 = getTimeOfDayFactor(config, 25);
    expect(f2.multiplier).toBe(0.70); // hour 23 → clamped
  });

  it('should return peak at 8am (highest morning)', () => {
    const f = getTimeOfDayFactor(config, 8);
    expect(f.multiplier).toBe(1.30);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  2. DAY-OF-WEEK FACTOR
// ═══════════════════════════════════════════════════════════════════════

describe('getDayOfWeekFactor', () => {
  it('should return weekend premium on Saturday', () => {
    const f = getDayOfWeekFactor(config, 6); // Saturday
    expect(f.multiplier).toBe(1.30);
    expect(f.applied).toBe(true);
    expect(f.description).toContain('Saturday');
  });

  it('should return 1.0 on weekdays', () => {
    const f = getDayOfWeekFactor(config, 1); // Monday
    expect(f.multiplier).toBe(1.00);
    expect(f.applied).toBe(false);
  });

  it('should return premium on Sunday', () => {
    const f = getDayOfWeekFactor(config, 0);
    expect(f.multiplier).toBe(1.25);
  });

  it('should clamp invalid days', () => {
    const f = getDayOfWeekFactor(config, -1);
    expect(f.multiplier).toBe(config.dayOfWeekMultipliers[0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  3. DEMAND FACTOR
// ═══════════════════════════════════════════════════════════════════════

describe('getDemandFactor', () => {
  it('should discount when occupancy is low (20%)', () => {
    const f = getDemandFactor(config, 0.20);
    expect(f.multiplier).toBe(0.85);
    expect(f.applied).toBe(true);
    expect(f.description).toContain('Low demand');
  });

  it('should return normal at 50% occupancy', () => {
    const f = getDemandFactor(config, 0.50);
    expect(f.multiplier).toBe(1.00);
    expect(f.applied).toBe(false);
  });

  it('should surge at 90% occupancy', () => {
    const f = getDemandFactor(config, 0.90);
    expect(f.multiplier).toBe(1.40);
    expect(f.description).toContain('Very high');
  });

  it('should max surge near capacity (97%)', () => {
    const f = getDemandFactor(config, 0.97);
    expect(f.multiplier).toBe(1.75);
    expect(f.description).toContain('Near capacity');
  });

  it('should clamp negative occupancy', () => {
    const f = getDemandFactor(config, -0.1);
    expect(f.multiplier).toBe(0.85);
  });

  it('should clamp over 100% occupancy', () => {
    const f = getDemandFactor(config, 1.5);
    expect(f.multiplier).toBeGreaterThan(0); // last tier
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  4. SEASONAL FACTOR
// ═══════════════════════════════════════════════════════════════════════

describe('getSeasonalFactor', () => {
  it('should apply Christmas premium on Dec 25', () => {
    const f = getSeasonalFactor(config, new Date('2026-12-25'));
    expect(f.multiplier).toBe(1.40);
    expect(f.applied).toBe(true);
    expect(f.description).toContain('Christmas');
  });

  it('should handle year-wrapping (Jan 1 = still Christmas)', () => {
    const f = getSeasonalFactor(config, new Date('2026-01-01'));
    expect(f.multiplier).toBe(1.40);
  });

  it('should return no adjustment on a regular day', () => {
    const f = getSeasonalFactor(config, new Date('2026-02-15'));
    expect(f.multiplier).toBe(1.0);
    expect(f.applied).toBe(false);
  });

  it('should apply Thanksgiving premium', () => {
    const f = getSeasonalFactor(config, new Date('2026-11-26'));
    expect(f.multiplier).toBe(1.35);
  });

  it('should apply Independence Day premium', () => {
    const f = getSeasonalFactor(config, new Date('2026-07-04'));
    expect(f.multiplier).toBe(1.25);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  5. VEHICLE TYPE FACTOR
// ═══════════════════════════════════════════════════════════════════════

describe('getVehicleTypeFactor', () => {
  it('should surcharge luxury vehicles', () => {
    const f = getVehicleTypeFactor(config, 'luxury');
    expect(f.multiplier).toBe(1.25);
    expect(f.applied).toBe(true);
    expect(f.description).toContain('surcharge');
  });

  it('should discount EVs', () => {
    const f = getVehicleTypeFactor(config, 'ev');
    expect(f.multiplier).toBe(0.95);
    expect(f.applied).toBe(true);
    expect(f.description).toContain('discount');
  });

  it('should return 1.0 for standard', () => {
    const f = getVehicleTypeFactor(config, 'standard');
    expect(f.multiplier).toBe(1.00);
    expect(f.applied).toBe(false);
  });

  it('should surcharge oversized', () => {
    const f = getVehicleTypeFactor(config, 'oversized');
    expect(f.multiplier).toBe(1.30);
  });

  it('should handle unknown vehicle types', () => {
    const f = getVehicleTypeFactor(config, 'spaceship');
    expect(f.multiplier).toBe(1.0);
  });

  it('should be case-insensitive', () => {
    const f = getVehicleTypeFactor(config, 'LUXURY');
    expect(f.multiplier).toBe(1.25);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  6. ADVANCE BOOKING FACTOR
// ═══════════════════════════════════════════════════════════════════════

describe('getAdvanceBookingFactor', () => {
  it('should give 1.0 for walk-in (0 days)', () => {
    const f = getAdvanceBookingFactor(config, 0);
    expect(f.multiplier).toBe(1.0);
    expect(f.applied).toBe(false);
    expect(f.description).toContain('Walk-in');
  });

  it('should give 5% off for 2 days ahead', () => {
    const f = getAdvanceBookingFactor(config, 2);
    expect(f.multiplier).toBe(0.95);
    expect(f.applied).toBe(true);
  });

  it('should give 10% off for 5 days ahead', () => {
    const f = getAdvanceBookingFactor(config, 5);
    expect(f.multiplier).toBe(0.90);
  });

  it('should give 15% off for 10 days ahead', () => {
    const f = getAdvanceBookingFactor(config, 10);
    expect(f.multiplier).toBe(0.85);
  });

  it('should give max 20% off for 30+ days ahead', () => {
    const f = getAdvanceBookingFactor(config, 30);
    expect(f.multiplier).toBe(0.80);
  });

  it('should handle negative days', () => {
    const f = getAdvanceBookingFactor(config, -5);
    expect(f.multiplier).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  7. LOYALTY FACTOR
// ═══════════════════════════════════════════════════════════════════════

describe('getLoyaltyFactor', () => {
  it('should give 1.0 for new customers', () => {
    const f = getLoyaltyFactor(config, 0);
    expect(f.multiplier).toBe(1.0);
    expect(f.applied).toBe(false);
    expect(f.description).toContain('New customer');
  });

  it('should give Bronze tier at 5 bookings', () => {
    const f = getLoyaltyFactor(config, 5);
    expect(f.multiplier).toBe(0.95);
    expect(f.description).toContain('Bronze');
  });

  it('should give Silver tier at 15 bookings', () => {
    const f = getLoyaltyFactor(config, 15);
    expect(f.multiplier).toBe(0.90);
    expect(f.description).toContain('Silver');
  });

  it('should give Gold tier at 30 bookings', () => {
    const f = getLoyaltyFactor(config, 30);
    expect(f.multiplier).toBe(0.85);
    expect(f.description).toContain('Gold');
  });

  it('should give Platinum tier at 60 bookings', () => {
    const f = getLoyaltyFactor(config, 60);
    expect(f.multiplier).toBe(0.80);
    expect(f.description).toContain('Platinum');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  8. DURATION SUBTOTAL
// ═══════════════════════════════════════════════════════════════════════

describe('calculateDurationSubtotal', () => {
  it('should calculate correctly for 1 hour at $5/hr', () => {
    const { subtotal } = calculateDurationSubtotal(config, 5.0, 1);
    expect(subtotal).toBe(5.0);
  });

  it('should apply degressive brackets for 4 hours', () => {
    const { subtotal, breakdown } = calculateDurationSubtotal(config, 5.0, 4);
    // First 2h at $5 = $10, next 2h at $5 * 0.85 = $8.50
    expect(subtotal).toBe(18.50);
    expect(breakdown).toHaveLength(2);
  });

  it('should apply multiple brackets for 8 hours', () => {
    const { subtotal, breakdown } = calculateDurationSubtotal(config, 5.0, 8);
    // 2h × $5.00 + 4h × $4.25 + 2h × $3.50 = $10 + $17 + $7 = $34
    expect(subtotal).toBe(34);
    expect(breakdown).toHaveLength(3);
  });

  it('should handle 0 hours', () => {
    const { subtotal } = calculateDurationSubtotal(config, 5.0, 0);
    expect(subtotal).toBe(0);
  });

  it('should apply best bracket for very long stays (48h)', () => {
    const { subtotal, breakdown } = calculateDurationSubtotal(config, 5.0, 48);
    // All 5 brackets should be used
    expect(breakdown.length).toBe(5);
    // Last bracket has the lowest rate
    const lastRate = breakdown[breakdown.length - 1]!.rate;
    expect(lastRate).toBe(2.0); // $5 * 0.40
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  9. FAIRNESS CAP
// ═══════════════════════════════════════════════════════════════════════

describe('applyFairnessCap', () => {
  it('should cap at maximum', () => {
    expect(applyFairnessCap(config, 5.0)).toBe(2.50);
  });

  it('should floor at minimum', () => {
    expect(applyFairnessCap(config, 0.1)).toBe(0.50);
  });

  it('should pass through normal values', () => {
    expect(applyFairnessCap(config, 1.5)).toBe(1.5);
  });

  it('should allow exactly the cap', () => {
    expect(applyFairnessCap(config, 2.50)).toBe(2.50);
  });

  it('should allow exactly the floor', () => {
    expect(applyFairnessCap(config, 0.50)).toBe(0.50);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  10. SMOOTHING
// ═══════════════════════════════════════════════════════════════════════

describe('applySmoothing', () => {
  it('should blend with previous multiplier', () => {
    const smoothed = applySmoothing(config, 2.0);
    // alpha=0.3: 0.3 * 2.0 + 0.7 * 1.0 = 0.6 + 0.7 = 1.3
    expect(smoothed).toBe(1.3);
  });

  it('should not change when capped equals previous', () => {
    const smoothed = applySmoothing(config, 1.0);
    expect(smoothed).toBe(1.0);
  });

  it('should blend downward too', () => {
    const smoothed = applySmoothing(config, 0.5);
    // 0.3 * 0.5 + 0.7 * 1.0 = 0.15 + 0.7 = 0.85
    expect(smoothed).toBe(0.85);
  });

  it('should use full new value when alpha=1', () => {
    const aggConfig = { ...config, smoothingFactor: 1.0 };
    expect(applySmoothing(aggConfig, 2.0)).toBe(2.0);
  });

  it('should use full previous when alpha=0', () => {
    const conserv = { ...config, smoothingFactor: 0.0 };
    expect(applySmoothing(conserv, 2.0)).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  11. VEHICLE TYPE DETECTION
// ═══════════════════════════════════════════════════════════════════════

describe('detectVehicleType', () => {
  it('should detect Tesla as EV', () => {
    expect(detectVehicleType('tesla')).toBe('ev');
  });

  it('should detect BMW as luxury', () => {
    expect(detectVehicleType('bmw')).toBe('luxury');
  });

  it('should detect Mercedes as luxury', () => {
    expect(detectVehicleType('mercedes')).toBe('luxury');
  });

  it('should detect Toyota as standard', () => {
    expect(detectVehicleType('toyota')).toBe('standard');
  });

  it('should detect Rivian as EV', () => {
    expect(detectVehicleType('Rivian')).toBe('ev');
  });

  it('should be case insensitive', () => {
    expect(detectVehicleType('PORSCHE')).toBe('luxury');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  12. COMPLETE PRICE QUOTE
// ═══════════════════════════════════════════════════════════════════════

describe('calculatePriceQuote', () => {
  it('should produce a complete quote with all fields', () => {
    const quote = calculatePriceQuote({
      config,
      estimatedHours: 4,
      vehicleType: 'standard',
      currentDate: new Date('2026-06-15T14:00:00'), // Weekday, 2pm, non-seasonal
      currentOccupancy: 0.50,
    });

    expect(quote.baseHourlyRate).toBe(5.0);
    expect(quote.currency).toBe('USD');
    expect(quote.factors).toHaveLength(7);
    expect(quote.totalPrice).toBeGreaterThan(0);
    expect(quote.quoteId).toMatch(/^PQ-/);
    expect(quote.validUntil).toBeDefined();
    expect(quote.quotedAt).toBeDefined();
    expect(quote.smoothedMultiplier).toBeGreaterThan(0);
    expect(quote.cappedMultiplier).toBeLessThanOrEqual(config.maxTotalMultiplier);
    expect(quote.cappedMultiplier).toBeGreaterThanOrEqual(config.minTotalMultiplier);
  });

  it('should be cheaper during off-peak + low demand', () => {
    const cheap = calculatePriceQuote({
      config,
      estimatedHours: 4,
      currentDate: new Date('2026-06-16T02:00:00'), // Tuesday 2am
      currentOccupancy: 0.20,
    });

    const expensive = calculatePriceQuote({
      config,
      estimatedHours: 4,
      currentDate: new Date('2026-06-20T17:00:00'), // Saturday 5pm
      currentOccupancy: 0.90,
    });

    expect(cheap.totalPrice).toBeLessThan(expensive.totalPrice);
  });

  it('should reward loyalty with lower price', () => {
    const newCustomer = calculatePriceQuote({
      config,
      estimatedHours: 4,
      customerBookingCount: 0,
      currentDate: new Date('2026-06-15T10:00:00'),
      currentOccupancy: 0.50,
    });

    const loyalCustomer = calculatePriceQuote({
      config,
      estimatedHours: 4,
      customerBookingCount: 50,
      currentDate: new Date('2026-06-15T10:00:00'),
      currentOccupancy: 0.50,
    });

    expect(loyalCustomer.totalPrice).toBeLessThan(newCustomer.totalPrice);
    expect(loyalCustomer.savingsFromLoyalty).toBeGreaterThan(0);
  });

  it('should reward advance booking with lower price', () => {
    const walkIn = calculatePriceQuote({
      config,
      estimatedHours: 4,
      daysInAdvance: 0,
      currentDate: new Date('2026-06-15T10:00:00'),
      currentOccupancy: 0.50,
    });

    const planned = calculatePriceQuote({
      config,
      estimatedHours: 4,
      daysInAdvance: 14,
      currentDate: new Date('2026-06-15T10:00:00'),
      currentOccupancy: 0.50,
    });

    expect(planned.totalPrice).toBeLessThan(walkIn.totalPrice);
    expect(planned.savingsFromAdvance).toBeGreaterThan(0);
  });

  it('should apply daily cap for very long stays', () => {
    const quote = calculatePriceQuote({
      config,
      estimatedHours: 48, // 2 days
      currentDate: new Date('2026-06-15T10:00:00'),
      currentOccupancy: 0.50,
    });

    // dailyCap should be baseDailyRate * multiplier
    expect(quote.dailyCap).toBeGreaterThan(0);
    // Total should not exceed 2 * daily cap (if cap was applied)
    if (quote.dailyCapApplied) {
      expect(quote.subtotal).toBeLessThanOrEqual(2 * quote.dailyCap + 0.01);
    }
  });

  it('should include tax when configured', () => {
    const taxConfig = { ...config, taxRate: 0.08 };
    const quote = calculatePriceQuote({
      config: taxConfig,
      estimatedHours: 4,
      currentDate: new Date('2026-06-15T10:00:00'),
      currentOccupancy: 0.50,
    });

    expect(quote.taxRate).toBe(0.08);
    expect(quote.taxAmount).toBeGreaterThan(0);
    expect(quote.totalPrice).toBeGreaterThan(quote.subtotal);
  });

  it('should never exceed fairness cap', () => {
    // Create worst case: Saturday night, Christmas, near capacity, luxury, walk-in, new customer
    const extremeQuote = calculatePriceQuote({
      config,
      estimatedHours: 1,
      vehicleType: 'luxury',
      daysInAdvance: 0,
      customerBookingCount: 0,
      currentOccupancy: 0.98,
      currentDate: new Date('2026-12-25T17:00:00'), // Christmas Saturday 5pm
    });

    expect(extremeQuote.cappedMultiplier).toBeLessThanOrEqual(config.maxTotalMultiplier);
  });

  it('should never go below fairness floor', () => {
    // Create best case: Tuesday 2am, low demand, EV, platinum, 30 days advance
    const bestQuote = calculatePriceQuote({
      config,
      estimatedHours: 1,
      vehicleType: 'ev',
      daysInAdvance: 30,
      customerBookingCount: 100,
      currentOccupancy: 0.10,
      currentDate: new Date('2026-06-16T02:00:00'), // Tuesday 2am, no season
    });

    expect(bestQuote.cappedMultiplier).toBeGreaterThanOrEqual(config.minTotalMultiplier);
  });

  it('should charge more for luxury vehicles', () => {
    const standard = calculatePriceQuote({
      config,
      estimatedHours: 4,
      vehicleType: 'standard',
      currentDate: new Date('2026-06-15T10:00:00'),
      currentOccupancy: 0.50,
    });

    const luxury = calculatePriceQuote({
      config,
      estimatedHours: 4,
      vehicleType: 'luxury',
      currentDate: new Date('2026-06-15T10:00:00'),
      currentOccupancy: 0.50,
    });

    expect(luxury.totalPrice).toBeGreaterThan(standard.totalPrice);
  });

  it('should have 7 factors in every quote', () => {
    const quote = calculatePriceQuote({ config, estimatedHours: 2 });
    expect(quote.factors).toHaveLength(7);
    const names = quote.factors.map(f => f.name);
    expect(names).toContain('Time of Day');
    expect(names).toContain('Day of Week');
    expect(names).toContain('Demand & Availability');
    expect(names).toContain('Seasonal');
    expect(names).toContain('Vehicle Type');
    expect(names).toContain('Advance Booking');
    expect(names).toContain('Loyalty');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  13. DEFAULT CONFIG INTEGRITY
// ═══════════════════════════════════════════════════════════════════════

describe('DEFAULT_PRICING_CONFIG', () => {
  it('should have 24 hourly multipliers', () => {
    expect(DEFAULT_PRICING_CONFIG.hourlyMultipliers).toHaveLength(24);
  });

  it('should have 7 day-of-week multipliers', () => {
    expect(DEFAULT_PRICING_CONFIG.dayOfWeekMultipliers).toHaveLength(7);
  });

  it('should have positive base rates', () => {
    expect(DEFAULT_PRICING_CONFIG.baseHourlyRate).toBeGreaterThan(0);
    expect(DEFAULT_PRICING_CONFIG.baseDailyRate).toBeGreaterThan(0);
  });

  it('should have fairness cap > floor', () => {
    expect(DEFAULT_PRICING_CONFIG.maxTotalMultiplier).toBeGreaterThan(DEFAULT_PRICING_CONFIG.minTotalMultiplier);
  });

  it('should have smoothing factor between 0 and 1', () => {
    expect(DEFAULT_PRICING_CONFIG.smoothingFactor).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_PRICING_CONFIG.smoothingFactor).toBeLessThanOrEqual(1);
  });

  it('should have demand tiers covering 0-100%', () => {
    const minOcc = Math.min(...DEFAULT_PRICING_CONFIG.demandTiers.map(t => t.minOccupancy));
    const maxOcc = Math.max(...DEFAULT_PRICING_CONFIG.demandTiers.map(t => t.maxOccupancy));
    expect(minOcc).toBe(0);
    expect(maxOcc).toBe(1);
  });

  it('should have duration brackets covering 0-999h', () => {
    expect(DEFAULT_PRICING_CONFIG.durationBrackets[0]!.minHours).toBe(0);
    const maxH = Math.max(...DEFAULT_PRICING_CONFIG.durationBrackets.map(b => b.maxHours));
    expect(maxH).toBe(999);
  });
});
