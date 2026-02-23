/**
 * Tez — Dynamic Pricing Engine
 *
 * Institutional-grade multi-factor adaptive pricing that surpasses
 * Uber's surge model by combining:
 *
 * 1. TIME-OF-DAY curves      — peak/off-peak hour multipliers
 * 2. DAY-OF-WEEK factors     — weekend/weekday/holiday adjustments
 * 3. DEMAND-SUPPLY ratio     — real-time occupancy-driven pricing
 * 4. SEASONAL adjustments    — holiday/event season premiums
 * 5. DURATION degression     — per-hour rate decreases for longer stays
 * 6. LOYALTY discounts       — repeat customer rewards
 * 7. ADVANCE BOOKING savings — book-ahead discount (vs walk-in premium)
 * 8. VEHICLE TYPE tiers      — luxury/oversized surcharge
 * 9. FAIRNESS CAPS           — hard ceiling on total multiplier
 * 10. PRICE SMOOTHING        — prevents jarring price swings (EMA)
 * 11. FULL AUDIT TRAIL       — every factor logged for transparency
 *
 * Unlike Uber's opaque surge multiplier:
 * - Every factor is individually visible to the customer
 * - Fairness cap prevents exploitative pricing
 * - Duration degression REWARDS longer stays (opposite of Uber)
 * - Loyalty discounts build retention (Uber has none)
 * - Advance booking incentivizes planning (reduces operational chaos)
 * - Smooth transitions prevent price shock
 */

import { functions, db, STANDARD_OPTIONS } from '../config';
import { assertRole, checkRateLimit, validate, logInfo, generateCorrelationId } from '../middleware';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════

/** Pricing configuration stored per-company in Firestore */
export interface PricingConfig {
  // Base rates
  baseHourlyRate: number;          // e.g. 5.00
  baseDailyRate: number;           // e.g. 30.00 (daily max)
  currency: string;                // e.g. 'USD'
  taxRate: number;                 // e.g. 0.08 (8%)

  // Time-of-day multipliers (24 entries, index = hour)
  hourlyMultipliers: number[];     // [0.7, 0.7, 0.7, ..., 1.2, 1.5, ...]

  // Day-of-week multipliers (7 entries, 0=Sunday)
  dayOfWeekMultipliers: number[];  // [1.3, 1.0, 1.0, 1.0, 1.0, 1.2, 1.4]

  // Demand-supply curve thresholds
  demandTiers: DemandTier[];

  // Duration degression brackets
  durationBrackets: DurationBracket[];

  // Advance booking discount curve
  advanceBookingTiers: AdvanceBookingTier[];

  // Vehicle type surcharges
  vehicleSurcharges: Record<string, number>; // e.g. { 'luxury': 0.25, 'suv': 0.10, 'oversized': 0.30 }

  // Seasonal/event multipliers
  seasonalRules: SeasonalRule[];

  // Loyalty program
  loyaltyTiers: LoyaltyTier[];

  // Fairness & smoothing
  maxTotalMultiplier: number;      // Hard cap, e.g. 3.0 (never more than 3x base)
  minTotalMultiplier: number;      // Floor, e.g. 0.5 (never below 50% of base)
  smoothingFactor: number;         // EMA alpha, e.g. 0.3 (0 = no smoothing, 1 = no memory)
  lastSmoothedMultiplier: number;  // Previous EMA value for continuity
}

export interface DemandTier {
  minOccupancy: number;  // e.g. 0.0
  maxOccupancy: number;  // e.g. 0.5
  multiplier: number;    // e.g. 0.9 (discount when lots of spots available)
}

export interface DurationBracket {
  minHours: number;      // e.g. 0
  maxHours: number;      // e.g. 3
  rateMultiplier: number; // e.g. 1.0 (full rate first 3 hours)
}

export interface AdvanceBookingTier {
  minDaysAhead: number;  // e.g. 7
  maxDaysAhead: number;  // e.g. 30
  discount: number;      // e.g. 0.15 (15% off)
}

export interface SeasonalRule {
  name: string;           // e.g. 'Christmas Week'
  startDate: string;      // 'MM-DD' e.g. '12-20'
  endDate: string;        // 'MM-DD' e.g. '01-03'
  multiplier: number;     // e.g. 1.5
}

export interface LoyaltyTier {
  minBookings: number;    // e.g. 10
  maxBookings: number;    // e.g. 25
  discount: number;       // e.g. 0.05 (5% off)
  label: string;          // e.g. 'Silver'
}

/** Individual pricing factor with full transparency */
export interface PricingFactor {
  name: string;
  description: string;
  multiplier: number;
  applied: boolean;
}

/** Complete price quote with audit trail */
export interface PriceQuote {
  // Input summary
  companyId: string;
  estimatedHours: number;
  vehicleType: string;
  isAdvanceBooking: boolean;
  daysInAdvance: number;
  customerBookingCount: number;

  // Base calculation
  baseHourlyRate: number;
  baseDailyRate: number;
  currency: string;

  // Individual factors (full transparency)
  factors: PricingFactor[];

  // Final calculation
  rawMultiplier: number;           // Product of all factors
  cappedMultiplier: number;        // After fairness cap
  smoothedMultiplier: number;      // After EMA smoothing
  effectiveHourlyRate: number;     // baseHourlyRate × smoothedMultiplier
  subtotal: number;                // Duration-aware total before tax
  taxAmount: number;
  taxRate: number;
  totalPrice: number;              // Final price including tax
  dailyCap: number;                // Maximum daily charge
  dailyCapApplied: boolean;        // Whether daily cap was hit
  savingsFromLoyalty: number;      // Dollar amount saved via loyalty
  savingsFromAdvance: number;      // Dollar amount saved via advance booking

  // Metadata
  quotedAt: string;                // ISO timestamp
  validUntil: string;              // Quote expires (e.g. 15 min)
  quoteId: string;                 // Unique ID for audit trail
  priceVersion: string;            // Config version for reproducibility
}

// ═══════════════════════════════════════════════════════════════════════
//  DEFAULT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  baseHourlyRate: 5.00,
  baseDailyRate: 30.00,
  currency: 'USD',
  taxRate: 0.0,

  // Peak hours 7-9am and 4-7pm, off-peak overnight
  hourlyMultipliers: [
    0.70, 0.70, 0.70, 0.70, 0.70, 0.80, // 00-05 (overnight)
    0.90, 1.20, 1.30, 1.10, 1.00, 1.00, // 06-11 (morning rush)
    1.00, 1.00, 1.00, 1.10, 1.30, 1.30, // 12-17 (afternoon rush)
    1.20, 1.10, 1.00, 0.90, 0.80, 0.70, // 18-23 (evening)
  ],

  // Weekend premium
  dayOfWeekMultipliers: [
    1.25, // Sunday
    1.00, // Monday
    1.00, // Tuesday
    1.00, // Wednesday
    1.05, // Thursday
    1.15, // Friday
    1.30, // Saturday
  ],

  // Occupancy-driven demand pricing
  demandTiers: [
    { minOccupancy: 0.00, maxOccupancy: 0.40, multiplier: 0.85 },  // Low demand: discount
    { minOccupancy: 0.40, maxOccupancy: 0.60, multiplier: 1.00 },  // Normal
    { minOccupancy: 0.60, maxOccupancy: 0.80, multiplier: 1.15 },  // High demand
    { minOccupancy: 0.80, maxOccupancy: 0.95, multiplier: 1.40 },  // Very high
    { minOccupancy: 0.95, maxOccupancy: 1.00, multiplier: 1.75 },  // Near capacity
  ],

  // Longer stays get better per-hour rates (opposite of surge model)
  durationBrackets: [
    { minHours: 0,  maxHours: 2,  rateMultiplier: 1.00 },  // First 2h: full rate
    { minHours: 2,  maxHours: 6,  rateMultiplier: 0.85 },  // 2-6h: 15% off per-hour
    { minHours: 6,  maxHours: 12, rateMultiplier: 0.70 },  // 6-12h: 30% off per-hour
    { minHours: 12, maxHours: 24, rateMultiplier: 0.55 },  // 12-24h: 45% off per-hour
    { minHours: 24, maxHours: 999, rateMultiplier: 0.40 }, // 24h+: 60% off per-hour
  ],

  // Book ahead and save
  advanceBookingTiers: [
    { minDaysAhead: 1,  maxDaysAhead: 3,  discount: 0.05 },  // 1-3 days: 5% off
    { minDaysAhead: 3,  maxDaysAhead: 7,  discount: 0.10 },  // 3-7 days: 10% off
    { minDaysAhead: 7,  maxDaysAhead: 14, discount: 0.15 },  // 1-2 weeks: 15% off
    { minDaysAhead: 14, maxDaysAhead: 999, discount: 0.20 }, // 2+ weeks: 20% off
  ],

  // Vehicle type surcharges (percentage of base)
  vehicleSurcharges: {
    standard: 0.00,
    compact: -0.05,
    suv: 0.10,
    truck: 0.10,
    luxury: 0.25,
    oversized: 0.30,
    ev: -0.05, // EV discount (environmental incentive)
  },

  // Holiday/event premiums
  seasonalRules: [
    { name: 'Christmas/NY',    startDate: '12-20', endDate: '01-03', multiplier: 1.40 },
    { name: 'Thanksgiving',    startDate: '11-22', endDate: '11-30', multiplier: 1.35 },
    { name: 'Independence Day', startDate: '07-01', endDate: '07-07', multiplier: 1.25 },
    { name: 'Spring Break',    startDate: '03-10', endDate: '03-25', multiplier: 1.20 },
    { name: 'Labor Day',       startDate: '08-29', endDate: '09-05', multiplier: 1.20 },
    { name: 'Memorial Day',    startDate: '05-22', endDate: '05-30', multiplier: 1.20 },
  ],

  // Loyalty rewards
  loyaltyTiers: [
    { minBookings: 3,   maxBookings: 10,  discount: 0.05, label: 'Bronze' },
    { minBookings: 10,  maxBookings: 25,  discount: 0.10, label: 'Silver' },
    { minBookings: 25,  maxBookings: 50,  discount: 0.15, label: 'Gold' },
    { minBookings: 50,  maxBookings: 999, discount: 0.20, label: 'Platinum' },
  ],

  maxTotalMultiplier: 2.50,     // Never more than 2.5x base price
  minTotalMultiplier: 0.50,     // Never below 50% of base price
  smoothingFactor: 0.30,        // 30% new value, 70% previous (prevents shock)
  lastSmoothedMultiplier: 1.0,
};

// ═══════════════════════════════════════════════════════════════════════
//  PRICING ENGINE (Pure Functions — Fully Testable)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get time-of-day multiplier
 */
export function getTimeOfDayFactor(config: PricingConfig, hour: number): PricingFactor {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const mult = config.hourlyMultipliers[h] ?? 1.0;
  return {
    name: 'Time of Day',
    description: mult > 1.0 ? `Peak hour (${h}:00)` : mult < 1.0 ? `Off-peak hour (${h}:00)` : `Standard hour (${h}:00)`,
    multiplier: mult,
    applied: mult !== 1.0,
  };
}

/**
 * Get day-of-week multiplier
 */
export function getDayOfWeekFactor(config: PricingConfig, dayOfWeek: number): PricingFactor {
  const d = Math.max(0, Math.min(6, dayOfWeek));
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const mult = config.dayOfWeekMultipliers[d] ?? 1.0;
  return {
    name: 'Day of Week',
    description: `${dayNames[d]} rate`,
    multiplier: mult,
    applied: mult !== 1.0,
  };
}

/**
 * Get demand-supply multiplier based on current lot occupancy
 */
export function getDemandFactor(config: PricingConfig, occupancyRate: number): PricingFactor {
  const occ = Math.max(0, Math.min(1, occupancyRate));
  const tier = config.demandTiers.find(t => occ >= t.minOccupancy && occ < t.maxOccupancy);
  const mult = tier?.multiplier ?? 1.0;

  let desc: string;
  if (occ < 0.4) desc = `Low demand (${Math.round(occ * 100)}% full) — discount applied`;
  else if (occ < 0.6) desc = `Normal demand (${Math.round(occ * 100)}% full)`;
  else if (occ < 0.8) desc = `High demand (${Math.round(occ * 100)}% full)`;
  else if (occ < 0.95) desc = `Very high demand (${Math.round(occ * 100)}% full)`;
  else desc = `Near capacity (${Math.round(occ * 100)}% full)`;

  return {
    name: 'Demand & Availability',
    description: desc,
    multiplier: mult,
    applied: mult !== 1.0,
  };
}

/**
 * Get seasonal/event multiplier for a given date
 */
export function getSeasonalFactor(config: PricingConfig, date: Date): PricingFactor {
  const mmdd = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const numericDate = parseInt(mmdd.replace('-', ''), 10);

  for (const rule of config.seasonalRules) {
    const start = parseInt(rule.startDate.replace('-', ''), 10);
    const end = parseInt(rule.endDate.replace('-', ''), 10);

    // Handle year-wrapping (e.g. 12-20 to 01-03)
    const inRange = start > end
      ? (numericDate >= start || numericDate <= end)
      : (numericDate >= start && numericDate <= end);

    if (inRange) {
      return {
        name: 'Seasonal',
        description: `${rule.name} premium`,
        multiplier: rule.multiplier,
        applied: true,
      };
    }
  }

  return { name: 'Seasonal', description: 'No seasonal adjustment', multiplier: 1.0, applied: false };
}

/**
 * Get vehicle type surcharge
 */
export function getVehicleTypeFactor(config: PricingConfig, vehicleType: string): PricingFactor {
  const type = vehicleType.toLowerCase();
  const surcharge = config.vehicleSurcharges[type] ?? 0;
  const mult = 1.0 + surcharge;
  return {
    name: 'Vehicle Type',
    description: surcharge > 0 ? `${type} surcharge (+${Math.round(surcharge * 100)}%)` :
                 surcharge < 0 ? `${type} discount (${Math.round(surcharge * 100)}%)` :
                 `Standard vehicle`,
    multiplier: mult,
    applied: surcharge !== 0,
  };
}

/**
 * Get advance booking discount
 */
export function getAdvanceBookingFactor(config: PricingConfig, daysInAdvance: number): PricingFactor {
  if (daysInAdvance <= 0) {
    return {
      name: 'Advance Booking',
      description: 'Walk-in / same-day booking',
      multiplier: 1.0,
      applied: false,
    };
  }

  for (const tier of config.advanceBookingTiers) {
    if (daysInAdvance >= tier.minDaysAhead && daysInAdvance < tier.maxDaysAhead) {
      return {
        name: 'Advance Booking',
        description: `Booked ${daysInAdvance} day${daysInAdvance > 1 ? 's' : ''} ahead (${Math.round(tier.discount * 100)}% off)`,
        multiplier: 1.0 - tier.discount,
        applied: true,
      };
    }
  }

  // If beyond all tiers, use the best discount
  const best = config.advanceBookingTiers.reduce((max, t) => t.discount > max.discount ? t : max, config.advanceBookingTiers[0]!);
  return {
    name: 'Advance Booking',
    description: `Booked ${daysInAdvance} days ahead (${Math.round(best.discount * 100)}% off)`,
    multiplier: 1.0 - best.discount,
    applied: true,
  };
}

/**
 * Get loyalty tier discount
 */
export function getLoyaltyFactor(config: PricingConfig, totalBookings: number): PricingFactor {
  if (totalBookings <= 0) {
    return { name: 'Loyalty', description: 'New customer', multiplier: 1.0, applied: false };
  }

  for (const tier of config.loyaltyTiers) {
    if (totalBookings >= tier.minBookings && totalBookings < tier.maxBookings) {
      return {
        name: 'Loyalty',
        description: `${tier.label} member (${Math.round(tier.discount * 100)}% off)`,
        multiplier: 1.0 - tier.discount,
        applied: true,
      };
    }
  }

  // If beyond all tiers, use the best tier
  const best = config.loyaltyTiers.reduce((max, t) => t.discount > max.discount ? t : max, config.loyaltyTiers[0]!);
  return {
    name: 'Loyalty',
    description: `${best.label} member (${Math.round(best.discount * 100)}% off)`,
    multiplier: 1.0 - best.discount,
    applied: true,
  };
}

/**
 * Calculate duration-aware subtotal using degressive brackets.
 * Instead of a flat multiplier, each bracket of hours charges a different per-hour rate.
 */
export function calculateDurationSubtotal(
  config: PricingConfig,
  effectiveHourlyRate: number,
  estimatedHours: number,
): { subtotal: number; breakdown: Array<{ hours: number; rate: number; amount: number }> } {
  let remaining = Math.max(0, estimatedHours);
  let subtotal = 0;
  const breakdown: Array<{ hours: number; rate: number; amount: number }> = [];

  for (const bracket of config.durationBrackets) {
    if (remaining <= 0) break;

    const bracketSpan = bracket.maxHours - bracket.minHours;
    const hoursInBracket = Math.min(remaining, bracketSpan);
    const bracketRate = effectiveHourlyRate * bracket.rateMultiplier;
    const amount = hoursInBracket * bracketRate;

    breakdown.push({
      hours: Math.round(hoursInBracket * 100) / 100,
      rate: Math.round(bracketRate * 100) / 100,
      amount: Math.round(amount * 100) / 100,
    });

    subtotal += amount;
    remaining -= hoursInBracket;
  }

  return { subtotal: Math.round(subtotal * 100) / 100, breakdown };
}

/**
 * Apply fairness cap — clamp multiplier between min and max
 */
export function applyFairnessCap(config: PricingConfig, rawMultiplier: number): number {
  return Math.max(config.minTotalMultiplier, Math.min(config.maxTotalMultiplier, rawMultiplier));
}

/**
 * Apply exponential moving average for smooth price transitions
 */
export function applySmoothing(config: PricingConfig, cappedMultiplier: number): number {
  const alpha = config.smoothingFactor;
  const previous = config.lastSmoothedMultiplier || 1.0;
  return Math.round((alpha * cappedMultiplier + (1 - alpha) * previous) * 1000) / 1000;
}

/**
 * CORE: Calculate a complete price quote
 *
 * This is the heart of the pricing engine. It collects all factors,
 * applies fairness caps, smooths the multiplier, and produces a
 * fully transparent quote with every factor visible.
 */
export function calculatePriceQuote(params: {
  config: PricingConfig;
  estimatedHours: number;
  vehicleType?: string;
  daysInAdvance?: number;
  customerBookingCount?: number;
  currentOccupancy?: number;  // 0.0 - 1.0
  currentDate?: Date;
}): PriceQuote {
  const {
    config,
    estimatedHours,
    vehicleType = 'standard',
    daysInAdvance = 0,
    customerBookingCount = 0,
    currentOccupancy = 0.5,
    currentDate = new Date(),
  } = params;

  const now = currentDate;
  const hour = now.getHours();
  const dayOfWeek = now.getDay();

  // Collect all pricing factors
  const factors: PricingFactor[] = [
    getTimeOfDayFactor(config, hour),
    getDayOfWeekFactor(config, dayOfWeek),
    getDemandFactor(config, currentOccupancy),
    getSeasonalFactor(config, now),
    getVehicleTypeFactor(config, vehicleType),
    getAdvanceBookingFactor(config, daysInAdvance),
    getLoyaltyFactor(config, customerBookingCount),
  ];

  // Compute raw multiplier (product of all factors)
  const rawMultiplier = factors.reduce((acc, f) => acc * f.multiplier, 1.0);

  // Apply fairness cap
  const cappedMultiplier = applyFairnessCap(config, rawMultiplier);

  // Apply EMA smoothing
  const smoothedMultiplier = applySmoothing(config, cappedMultiplier);

  // Effective hourly rate
  const effectiveHourlyRate = Math.round(config.baseHourlyRate * smoothedMultiplier * 100) / 100;

  // Duration-aware subtotal calculation
  const { subtotal } = calculateDurationSubtotal(config, effectiveHourlyRate, estimatedHours);

  // Apply daily cap — price per day never exceeds daily rate × smoothedMultiplier
  const effectiveDailyCap = Math.round(config.baseDailyRate * smoothedMultiplier * 100) / 100;
  const totalDays = Math.ceil(estimatedHours / 24);
  const maxByDailyCap = totalDays * effectiveDailyCap;
  const dailyCapApplied = subtotal > maxByDailyCap;
  const cappedSubtotal = dailyCapApplied ? maxByDailyCap : subtotal;

  // Tax
  const taxAmount = Math.round(cappedSubtotal * config.taxRate * 100) / 100;
  const totalPrice = Math.round((cappedSubtotal + taxAmount) * 100) / 100;

  // Calculate savings
  const loyaltyFactor = factors.find(f => f.name === 'Loyalty');
  const advanceFactor = factors.find(f => f.name === 'Advance Booking');
  const baseSubtotal = estimatedHours * config.baseHourlyRate;
  const savingsFromLoyalty = loyaltyFactor?.applied
    ? Math.round(baseSubtotal * (1 - loyaltyFactor.multiplier) * 100) / 100 : 0;
  const savingsFromAdvance = advanceFactor?.applied
    ? Math.round(baseSubtotal * (1 - advanceFactor.multiplier) * 100) / 100 : 0;

  // Quote ID for audit
  const quoteId = `PQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Quote valid for 15 minutes
  const validUntil = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

  return {
    companyId: '', // Filled by callable
    estimatedHours,
    vehicleType,
    isAdvanceBooking: daysInAdvance > 0,
    daysInAdvance,
    customerBookingCount,
    baseHourlyRate: config.baseHourlyRate,
    baseDailyRate: config.baseDailyRate,
    currency: config.currency,
    factors,
    rawMultiplier: Math.round(rawMultiplier * 1000) / 1000,
    cappedMultiplier: Math.round(cappedMultiplier * 1000) / 1000,
    smoothedMultiplier: Math.round(smoothedMultiplier * 1000) / 1000,
    effectiveHourlyRate,
    subtotal: cappedSubtotal,
    taxAmount,
    taxRate: config.taxRate,
    totalPrice,
    dailyCap: effectiveDailyCap,
    dailyCapApplied,
    savingsFromLoyalty,
    savingsFromAdvance,
    quotedAt: now.toISOString(),
    validUntil,
    quoteId,
    priceVersion: `v${config.baseHourlyRate}-${config.baseDailyRate}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  ZOD SCHEMAS
// ═══════════════════════════════════════════════════════════════════════

export const GetPriceQuoteSchema = z.object({
  estimatedHours: z.number().min(0.5).max(720),  // 30 min to 30 days
  vehicleType: z.string().max(50).optional().default('standard'),
  daysInAdvance: z.number().int().min(0).max(365).optional().default(0),
  customerPhone: z.string().max(20).optional().default(''),
});

export type GetPriceQuoteRequest = z.infer<typeof GetPriceQuoteSchema>;

export const UpdatePricingConfigSchema = z.object({
  baseHourlyRate: z.number().min(0).max(10000).optional(),
  baseDailyRate: z.number().min(0).max(100000).optional(),
  currency: z.string().max(3).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  hourlyMultipliers: z.array(z.number().min(0).max(5)).length(24).optional(),
  dayOfWeekMultipliers: z.array(z.number().min(0).max(5)).length(7).optional(),
  maxTotalMultiplier: z.number().min(1).max(10).optional(),
  minTotalMultiplier: z.number().min(0).max(1).optional(),
  smoothingFactor: z.number().min(0).max(1).optional(),
  vehicleSurcharges: z.record(z.string(), z.number().min(-1).max(5)).optional(),
});

export type UpdatePricingConfigRequest = z.infer<typeof UpdatePricingConfigSchema>;

export const CalculateCompletionPriceSchema = z.object({
  bookingId: z.string().max(100).refine(s => s.length > 0, 'bookingId is required'),
});

export type CalculateCompletionPriceRequest = z.infer<typeof CalculateCompletionPriceSchema>;

// ═══════════════════════════════════════════════════════════════════════
//  HELPER: Load pricing config from Firestore (with defaults fallback)
// ═══════════════════════════════════════════════════════════════════════

export async function loadPricingConfig(companyId: string): Promise<PricingConfig> {
  const doc = await db.collection('companies').doc(companyId).collection('settings').doc('pricing').get();
  if (!doc.exists) return { ...DEFAULT_PRICING_CONFIG };

  const data = doc.data() ?? {};
  return {
    ...DEFAULT_PRICING_CONFIG,
    ...data,
    // Ensure arrays have correct length (defensive)
    hourlyMultipliers: Array.isArray(data['hourlyMultipliers']) && data['hourlyMultipliers'].length === 24
      ? data['hourlyMultipliers'] : DEFAULT_PRICING_CONFIG.hourlyMultipliers,
    dayOfWeekMultipliers: Array.isArray(data['dayOfWeekMultipliers']) && data['dayOfWeekMultipliers'].length === 7
      ? data['dayOfWeekMultipliers'] : DEFAULT_PRICING_CONFIG.dayOfWeekMultipliers,
    demandTiers: Array.isArray(data['demandTiers']) && data['demandTiers'].length > 0
      ? data['demandTiers'] : DEFAULT_PRICING_CONFIG.demandTiers,
    durationBrackets: Array.isArray(data['durationBrackets']) && data['durationBrackets'].length > 0
      ? data['durationBrackets'] : DEFAULT_PRICING_CONFIG.durationBrackets,
    advanceBookingTiers: Array.isArray(data['advanceBookingTiers']) && data['advanceBookingTiers'].length > 0
      ? data['advanceBookingTiers'] : DEFAULT_PRICING_CONFIG.advanceBookingTiers,
    seasonalRules: Array.isArray(data['seasonalRules']) ? data['seasonalRules'] : DEFAULT_PRICING_CONFIG.seasonalRules,
    loyaltyTiers: Array.isArray(data['loyaltyTiers']) && data['loyaltyTiers'].length > 0
      ? data['loyaltyTiers'] : DEFAULT_PRICING_CONFIG.loyaltyTiers,
    vehicleSurcharges: typeof data['vehicleSurcharges'] === 'object' && data['vehicleSurcharges'] !== null
      ? data['vehicleSurcharges'] : DEFAULT_PRICING_CONFIG.vehicleSurcharges,
  };
}

/**
 * Get real-time occupancy rate for a company
 */
async function getOccupancyRate(companyId: string): Promise<number> {
  const locsSnap = await db.collection('companies').doc(companyId).collection('locations').get();
  if (locsSnap.empty) return 0.5; // Default to 50% if no locations

  let totalCapacity = 0;
  let totalOccupied = 0;

  for (const locDoc of locsSnap.docs) {
    const capacity = (locDoc.data()['capacity'] as number) || 0;
    totalCapacity += capacity;

    const spotsSnap = await db
      .collection('companies')
      .doc(companyId)
      .collection('locations')
      .doc(locDoc.id)
      .collection('spots')
      .where('status', '==', 'occupied')
      .get();
    totalOccupied += spotsSnap.size;
  }

  return totalCapacity > 0 ? totalOccupied / totalCapacity : 0.5;
}

/**
 * Get customer's historical booking count for loyalty calculation
 */
async function getCustomerBookingCount(companyId: string, customerPhone: string): Promise<number> {
  if (!customerPhone) return 0;

  const snap = await db
    .collection('companies')
    .doc(companyId)
    .collection('bookings')
    .where('customerPhone', '==', customerPhone)
    .where('status', '==', 'Completed')
    .get();

  return snap.size;
}

// ═══════════════════════════════════════════════════════════════════════
//  CLOUD FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get a dynamic price quote for a prospective booking.
 * Takes into account ALL 10 pricing factors in real time.
 */
export const getPriceQuote = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<PriceQuote> => {
    const correlationId = generateCorrelationId();
    const auth = assertRole(context, ['admin', 'operator', 'viewer']);
    await checkRateLimit(auth.uid);

    const input = validate(GetPriceQuoteSchema, data);
    const ctx = { correlationId, uid: auth.uid, companyId: auth.companyId, operation: 'getPriceQuote' };

    logInfo(ctx, 'Generating price quote', { hours: input.estimatedHours, vehicleType: input.vehicleType });

    // Load all dynamic inputs
    const [config, occupancy, customerBookings] = await Promise.all([
      loadPricingConfig(auth.companyId),
      getOccupancyRate(auth.companyId),
      getCustomerBookingCount(auth.companyId, input.customerPhone),
    ]);

    const quote = calculatePriceQuote({
      config,
      estimatedHours: input.estimatedHours,
      vehicleType: input.vehicleType,
      daysInAdvance: input.daysInAdvance,
      customerBookingCount: customerBookings,
      currentOccupancy: occupancy,
    });

    quote.companyId = auth.companyId;

    // Save quote for audit trail
    await db
      .collection('companies')
      .doc(auth.companyId)
      .collection('priceQuotes')
      .doc(quote.quoteId)
      .set({
        ...quote,
        createdBy: auth.uid,
        createdAt: new Date().toISOString(),
      });

    // Update smoothed multiplier for next calculation
    await db
      .collection('companies')
      .doc(auth.companyId)
      .collection('settings')
      .doc('pricing')
      .set({ lastSmoothedMultiplier: quote.smoothedMultiplier }, { merge: true });

    logInfo(ctx, 'Price quote generated', {
      quoteId: quote.quoteId,
      totalPrice: quote.totalPrice,
      smoothedMultiplier: quote.smoothedMultiplier,
    });

    return quote;
  });

/**
 * Calculate the actual price for completing a booking based on real duration.
 * Uses the booking's createdAt timestamp to compute exact hours parked.
 */
export const calculateCompletionPrice = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<PriceQuote> => {
    const correlationId = generateCorrelationId();
    const auth = assertRole(context, ['admin', 'operator']);
    await checkRateLimit(auth.uid);

    const input = validate(CalculateCompletionPriceSchema, data);
    const ctx = { correlationId, uid: auth.uid, companyId: auth.companyId, operation: 'calculateCompletionPrice' };

    logInfo(ctx, 'Calculating completion price', { bookingId: input.bookingId });

    // Load booking
    const bDoc = await db
      .collection('companies')
      .doc(auth.companyId)
      .collection('bookings')
      .doc(input.bookingId)
      .get();

    if (!bDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Booking not found.');
    }

    const bData = bDoc.data()!;
    if (bData['status'] !== 'Active') {
      throw new functions.https.HttpsError('failed-precondition', 'Only Active bookings can be priced for completion.');
    }

    // Calculate actual duration
    const createdAt = bData['createdAt']?.toDate?.() ?? new Date(bData['createdAt']);
    const now = new Date();
    const actualHours = Math.max(0.5, (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60));

    // Determine vehicle type from make
    const vehicleMake = (bData['vehicle']?.['make'] || '').toLowerCase();
    const vehicleType = detectVehicleType(vehicleMake);

    // Calculate advance booking days (0 = was same-day)
    const daysInAdvance = 0; // Completion uses current rate, not booking-time rate

    // Load config + occupancy + loyalty
    const customerPhone = bData['customerPhone'] || '';
    const [config, occupancy, customerBookings] = await Promise.all([
      loadPricingConfig(auth.companyId),
      getOccupancyRate(auth.companyId),
      getCustomerBookingCount(auth.companyId, customerPhone),
    ]);

    const quote = calculatePriceQuote({
      config,
      estimatedHours: Math.round(actualHours * 100) / 100,
      vehicleType,
      daysInAdvance,
      customerBookingCount: customerBookings,
      currentOccupancy: occupancy,
    });

    quote.companyId = auth.companyId;

    logInfo(ctx, 'Completion price calculated', {
      bookingId: input.bookingId,
      actualHours: Math.round(actualHours * 100) / 100,
      totalPrice: quote.totalPrice,
    });

    return quote;
  });

/**
 * Update pricing configuration (admin only)
 */
export const updatePricingConfig = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<{ success: true }> => {
    const correlationId = generateCorrelationId();
    const auth = assertRole(context, ['admin']);
    await checkRateLimit(auth.uid);

    const input = validate(UpdatePricingConfigSchema, data);
    const ctx = { correlationId, uid: auth.uid, companyId: auth.companyId, operation: 'updatePricingConfig' };

    logInfo(ctx, 'Updating pricing config', input);

    // Merge only provided fields
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) updates[key] = value;
    }
    updates['updatedAt'] = new Date().toISOString();
    updates['updatedBy'] = auth.uid;

    await db
      .collection('companies')
      .doc(auth.companyId)
      .collection('settings')
      .doc('pricing')
      .set(updates, { merge: true });

    logInfo(ctx, 'Pricing config updated');
    return { success: true };
  });

// ═══════════════════════════════════════════════════════════════════════
//  VEHICLE TYPE DETECTION
// ═══════════════════════════════════════════════════════════════════════

const LUXURY_MAKES = new Set([
  'mercedes', 'bmw', 'audi', 'lexus', 'porsche', 'maserati',
  'bentley', 'rolls-royce', 'ferrari', 'lamborghini', 'aston martin',
  'jaguar', 'land rover', 'range rover', 'cadillac', 'lincoln',
  'genesis', 'infiniti', 'acura', 'volvo', 'tesla',
]);

const EV_MAKES = new Set(['tesla', 'rivian', 'lucid', 'polestar']);

/**
 * Auto-detect vehicle type from make/model for surcharge calculation
 */
export function detectVehicleType(make: string): string {
  const m = make.toLowerCase().trim();
  if (EV_MAKES.has(m)) return 'ev';
  if (LUXURY_MAKES.has(m)) return 'luxury';
  return 'standard';
}
