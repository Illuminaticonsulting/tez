// ============================================================
// Tez — Core Data Models (aligned with Cloud Functions schema)
// ============================================================

// ---- Booking Status ----
export type BookingStatus =
  | 'New'
  | 'Booked'
  | 'Check-In'
  | 'Parked'
  | 'Active'
  | 'Completed'
  | 'Cancelled';

// ---- Booking (matches Firestore document written by Cloud Functions) ----
export interface Booking {
  id: string;
  ticketNumber: number;       // atomic counter from Cloud Functions
  status: BookingStatus;

  // Customer
  customerName: string;
  customerPhone: string;
  customerEmail?: string;

  // Vehicle (nested object in Firestore)
  vehicle: {
    make: string;
    model: string;
    color: string;
    plate: string;
    photoUrl: string;
  };

  // Flight
  flightNumber: string;
  flightStatus?: string;

  // Parking
  spotId: string;
  locationId: string;
  spotName?: string;
  keysHandedOff: boolean;

  // Notes
  notes: string;

  // Payment (nested object)
  payment: {
    method: string;
    amount: number;
    status: 'pending' | 'processing' | 'paid' | 'failed' | 'refunded';
  };

  // Damage report
  damageReport?: {
    hasDamage: boolean;
    notes: string;
    photoUrls: string[];
    reportedBy: string;
    reportedAt: string;
  };

  // Audit history (array in Firestore doc)
  history: BookingHistoryEntry[];

  // Timestamps
  createdAt: any; // Firestore Timestamp or string
  updatedAt: any;
  completedAt?: any;
  createdBy: string;
}

// ---- Booking History Entry (in-document array) ----
export interface BookingHistoryEntry {
  status: string;
  timestamp: string;
  userId: string;
  note: string;
}

// ---- Parking Spot (path: companies/{id}/locations/{locId}/spots/{spotId}) ----
export interface ParkingSpot {
  id: string;
  name: string;
  locationId: string;
  status: 'available' | 'occupied' | 'maintenance';
  bookingId: string | null;
  lockedBy: string | null;
  lockedAt: any | null;
  returningDate: string | null;
  row?: string;
  column?: number;
  order?: number;

  /** Computed convenience getter — true when status is 'available' */
  readonly isAvailable?: boolean;
}

/** Helper to enrich raw Firestore spot data with computed fields */
export function enrichSpot(spot: ParkingSpot): ParkingSpot {
  return Object.defineProperty({ ...spot }, 'isAvailable', {
    get() { return this.status === 'available'; },
    enumerable: true,
  });
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
  gatewayDomain?: string;
  logoUrl?: string;
  smsTextExitOut?: string;
  smsTextCheckIn?: string;
  timezone: string;
  settings: CompanySettings;
}

export interface CompanySettings {
  autoSendPaymentLink: boolean;
  autoSendSms: boolean;
  autoSendEmail: boolean;
  enableFlightTracking: boolean;
  maxActiveTickets: number;
  spotLockTtlSeconds: number; // default 30
  hourlyRate: number;
  dailyMax: number;
  currency: string; // e.g. 'USD'
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
export type PaymentStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'refunded';

export interface Payment {
  id: string;
  bookingId: string;
  ticketNumber: number;
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
  completedCount: number;
  cancelledCount: number;
  avgParkDurationMinutes: number;
  totalRevenue: number;
  spotUtilizationPct: number;
  peakHour: number;
}

// ---- Notifications ----
export interface AppNotification {
  id: string;
  type: 'new-booking' | 'checkout' | 'payment' | 'alert';
  title: string;
  body: string;
  bookingId?: string;
  read: boolean;
  createdAt: any;
}

// ---- Grouped bookings for UI ----
export interface BookingGroups {
  issued: Booking[];   // Parked + Check-In
  active: Booking[];   // Active (exited)
  new: Booking[];      // New
  booked: Booking[];   // Booked / Reservations
}

// ---- Status transition map (aligned with Cloud Functions) ----
export const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  'New':       ['Booked', 'Cancelled'],
  'Booked':    ['Check-In', 'Cancelled'],
  'Check-In':  ['Parked', 'Cancelled'],
  'Parked':    ['Active', 'Cancelled'],
  'Active':    ['Completed', 'Cancelled'],
  'Completed': [],
  'Cancelled': [],
};
