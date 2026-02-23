/**
 * Tez — Shared Types & Zod Schemas
 *
 * Every callable request/response is typed & validated at the boundary.
 * Schemas enforce structure, length limits, and format constraints.
 */

import { z } from 'zod';

// ─── Booking Status ──────────────────────────────────────────────────

export const BOOKING_STATUSES = ['New', 'Booked', 'Check-In', 'Parked', 'Active', 'Completed', 'Cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const VALID_TRANSITIONS: Record<string, BookingStatus[]> = {
  New: ['Booked', 'Cancelled'],
  Booked: ['Check-In', 'Cancelled'],
  'Check-In': ['Parked', 'Cancelled'],
  Parked: ['Active', 'Cancelled'],
  Active: ['Completed', 'Cancelled'],
};

export const ROLES = ['admin', 'operator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

// ─── Sanitization Transforms ─────────────────────────────────────────

/** Strip HTML tags, limit length */
const safeString = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[<>]/g, '').replace(/&(?!amp;|lt;|gt;|quot;)/g, '&amp;').trim())
    .pipe(z.string().max(max));

const plate = z
  .string()
  .transform((s) => s.replace(/[^a-zA-Z0-9\- ]/g, '').trim().toUpperCase())
  .pipe(z.string().max(20));

const phone = z
  .string()
  .transform((s) => s.replace(/[^0-9+\-() ]/g, '').trim())
  .pipe(z.string().max(20));

const flightNum = z
  .string()
  .transform((s) => s.replace(/[^A-Za-z0-9]/g, '').trim().toUpperCase())
  .pipe(z.string().max(20));

// ─── Request Schemas ─────────────────────────────────────────────────

export const CreateBookingSchema = z.object({
  customerName: safeString(100).refine((s) => s.length > 0, 'customerName is required'),
  customerPhone: phone.optional().default(''),
  customerEmail: z.string().email().max(254).optional().default(''),
  vehiclePlate: plate.refine((s) => s.length > 0, 'vehiclePlate is required'),
  vehicleMake: safeString(50).optional().default(''),
  vehicleModel: safeString(50).optional().default(''),
  vehicleColor: safeString(30).optional().default(''),
  flightNumber: flightNum.optional().default(''),
  notes: safeString(1000).optional().default(''),
  idempotencyKey: z.string().max(64).optional(),
});
export type CreateBookingRequest = z.infer<typeof CreateBookingSchema>;

export const TransitionBookingSchema = z.object({
  bookingId: safeString(100).refine((s) => s.length > 0, 'bookingId is required'),
  newStatus: z.enum(BOOKING_STATUSES),
  note: safeString(500).optional().default(''),
});
export type TransitionBookingRequest = z.infer<typeof TransitionBookingSchema>;

export const AssignSpotSchema = z.object({
  bookingId: safeString(100).refine((s) => s.length > 0, 'bookingId is required'),
  locationId: safeString(100).refine((s) => s.length > 0, 'locationId is required'),
  spotId: safeString(100).refine((s) => s.length > 0, 'spotId is required'),
});
export type AssignSpotRequest = z.infer<typeof AssignSpotSchema>;

export const CompleteBookingSchema = z.object({
  bookingId: safeString(100).refine((s) => s.length > 0, 'bookingId is required'),
  paymentMethod: z.enum(['cash', 'card', 'mobile', 'prepaid', 'invoice']).default('cash'),
  paymentAmount: z.number().min(0).max(100_000).default(0),
});
export type CompleteBookingRequest = z.infer<typeof CompleteBookingSchema>;

export const CancelBookingSchema = z.object({
  bookingId: safeString(100).refine((s) => s.length > 0, 'bookingId is required'),
  reason: safeString(500).optional().default(''),
});
export type CancelBookingRequest = z.infer<typeof CancelBookingSchema>;

export const LockSpotSchema = z.object({
  locationId: safeString(100).refine((s) => s.length > 0, 'locationId is required'),
  spotId: safeString(100).refine((s) => s.length > 0, 'spotId is required'),
});
export type LockSpotRequest = z.infer<typeof LockSpotSchema>;

export const ReleaseSpotSchema = z.object({
  locationId: safeString(100).refine((s) => s.length > 0, 'locationId is required'),
  spotId: safeString(100).refine((s) => s.length > 0, 'spotId is required'),
});
export type ReleaseSpotRequest = z.infer<typeof ReleaseSpotSchema>;

export const LookupFlightSchema = z.object({
  flightNumber: flightNum.refine((s) => s.length > 0, 'flightNumber is required'),
});
export type LookupFlightRequest = z.infer<typeof LookupFlightSchema>;

export const SetUserRoleSchema = z.object({
  userId: safeString(100).refine((s) => s.length > 0, 'userId is required'),
  role: z.enum(ROLES),
});
export type SetUserRoleRequest = z.infer<typeof SetUserRoleSchema>;

export const ListBookingsSchema = z.object({
  status: z.enum(BOOKING_STATUSES).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  startAfter: z.string().max(200).optional(),
  orderBy: z.enum(['createdAt', 'updatedAt', 'ticketNumber']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
export type ListBookingsRequest = z.infer<typeof ListBookingsSchema>;

export const PaymentWebhookSchema = z.object({
  provider: z.enum(['stripe', 'square']),
  eventType: z.string().max(100),
  bookingId: z.string().max(100),
  amount: z.number().min(0),
  currency: z.string().max(3).default('USD'),
  transactionId: z.string().max(200),
  metadata: z.record(z.string(), z.string()).optional(),
});
export type PaymentWebhookRequest = z.infer<typeof PaymentWebhookSchema>;

// ─── Response Types ──────────────────────────────────────────────────

export interface CreateBookingResponse {
  id: string;
  ticketNumber: number;
}

export interface ListBookingsResponse {
  bookings: Record<string, unknown>[];
  hasMore: boolean;
  lastDoc?: string;
}

export interface FlightLookupResponse {
  found: boolean;
  airline?: string;
  flightNumber?: string;
  status?: 'landed' | 'en-route' | 'scheduled' | 'cancelled' | 'diverted';
  scheduledArrival?: string;
  estimatedArrival?: string;
  delay?: number;
  origin?: string;
  gate?: string;
  terminal?: string;
  message?: string;
  cachedAt?: string;
}

export interface SuccessResponse {
  success: true;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  timestamp: string;
  region: string;
  uptime: number;
}
