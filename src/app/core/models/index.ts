// ============================================================
// Tez — Core Data Models
// Strongly-typed interfaces for the entire domain
// ============================================================

// ---- Booking / Ticket ----
export type BookingStatus =
  | 'New'
  | 'Booked'
  | 'Check-In'
  | 'Parked'
  | 'Active'   // Vehicle exited, awaiting pickup
  | 'Completed'
  | 'Cancelled';

export type KeyStatus = 'keysCheckIn' | 'keysNotCheckIn';

export interface Booking {
  id: string;
  ticketNo: number;
  companyId: string;

  // Customer
  customerName: string;
  customerPhone: string;
  customerEmail?: string;

  // Vehicle
  vehicleMake: string;
  vehicleModel: string;
  vehicleColor: string;
  vehicleTag: string;        // license plate
  vehiclePhotoUrl?: string;

  // Flight
  airlineCode?: string;
  flightNumber?: string;
  flightStatus?: string;
  airportCode?: string;

  // Parking
  parkingSpotId: string | null;
  parkingSpotName?: string;
  locationId: string | null;
  siteLocation?: string;
  keyStatus: KeyStatus;

  // Swap
  isSwapable?: boolean;
  parkingSpotSwapableId?: string;
  parkingSpotSwapable?: string;

  // Status
  bookingStatus: BookingStatus;
  waitingTime?: number;
  waitingTimeDate?: string;

  // Dates (ISO-8601)
  entryDate: string;
  entryTime: string;
  exitDate?: string;
  exitTime?: string;
  completedAt?: string;

  // Payment
  paid: boolean;
  amount?: number;
  paymentId?: string;
  paymentStatus?: PaymentStatus;

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy?: string;
}

// ---- Booking History (Audit Trail) ----
export interface BookingHistoryEntry {
  id: string;
  bookingId: string;
  previousStatus: BookingStatus;
  newStatus: BookingStatus;
  changedBy: string;
  changedAt: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  note?: string;
}

// ---- Parking Spot ----
export interface ParkingSpot {
  id: string;
  name: string;
  locationId: string;
  isAvailable: boolean;
  isReusable: boolean;
  lockedBy: string | null;     // operator uid – optimistic lock
  lockedAt: string | null;     // ISO-8601 – TTL for lock
  returningDate: string | null;
  bookingId: string | null;
  companyId: string;
  row?: string;
  column?: number;
  order?: number;
}

// ---- Location ----
export interface ParkingLocation {
  id: string;
  displayName: string;
  companyId: string;
  capacity: number;
  order?: number;
}

// ---- Company ----
export interface Company {
  id: string;
  name: string;
  gatewayDomain: string;
  logoUrl?: string;
  smsTextExitOut?: string;
  smsTextCheckIn?: string;
  timezone: string;
  settings: CompanySettings;
}

export interface CompanySettings {
  autoSendPaymentLink: boolean;
  autoSendSms: boolean;
  enableFlightTracking: boolean;
  maxActiveTickets: number;
  spotLockTtlMinutes: number; // default 5
}

// ---- User / Operator ----
export type UserRole = 'admin' | 'operator' | 'viewer';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  companyId: string;
  role: UserRole;
  photoUrl?: string;
  lastLogin?: string;
  isActive: boolean;
}

// ---- Payment ----
export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'refunded';

export interface Payment {
  id: string;
  bookingId: string;
  ticketNo: number;
  amount: number;
  status: PaymentStatus;
  method?: string;
  transactionId?: string;
  createdAt: string;
  completedAt?: string;
}

// ---- Analytics / Reporting ----
export interface DailyStats {
  date: string;
  totalTickets: number;
  completedTickets: number;
  cancelledTickets: number;
  avgParkDurationMinutes: number;
  revenue: number;
  spotUtilizationPct: number;
  peakHour: number;
}

// ---- Notifications ----
export interface AppNotification {
  id: string;
  type: 'new-ticket' | 'checkout' | 'payment' | 'alert';
  title: string;
  message: string;
  bookingId?: string;
  read: boolean;
  createdAt: string;
}

// ---- Grouped bookings for UI ----
export interface BookingGroups {
  issued: Booking[];   // Parked + Check-In
  active: Booking[];   // Active (exited)
  new: Booking[];      // New
  booked: Booking[];   // Booked / Reservations
}

// ---- Status transition map ----
export const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  'New':       ['Booked', 'Check-In', 'Cancelled'],
  'Booked':    ['Check-In', 'Cancelled'],
  'Check-In':  ['Parked', 'Cancelled'],
  'Parked':    ['Active', 'Cancelled'],
  'Active':    ['Completed', 'Cancelled'],
  'Completed': [],
  'Cancelled': [],
};
