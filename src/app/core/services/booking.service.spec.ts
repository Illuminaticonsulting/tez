import { TestBed } from '@angular/core/testing';
import { BookingService } from './booking.service';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { ApiService } from './api.service';

describe('BookingService', () => {
  let service: BookingService;

  const mockAuth = {
    currentUser: () => ({ uid: 'test-uid', companyId: 'test-co' }),
  };
  const mockFirestore = {
    listenToCollection: jest.fn().mockReturnValue(() => {}),
  };
  const mockApi = {
    call: jest.fn().mockResolvedValue({}),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        BookingService,
        { provide: AuthService, useValue: mockAuth },
        { provide: FirestoreService, useValue: mockFirestore },
        { provide: ApiService, useValue: mockApi },
      ],
    });
    service = TestBed.inject(BookingService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should have empty bookings initially', () => {
    expect(service.allBookings().length).toBe(0);
  });

  it('should have bookingsByStatus computed', () => {
    const groups = service.bookingsByStatus();
    expect(groups).toBeDefined();
    expect(groups.issued).toBeDefined();
    expect(groups.active).toBeDefined();
    expect(groups.reservations).toBeDefined();
    expect(groups.newTickets).toBeDefined();
  });

  it('should validate transitions', () => {
    expect(service.canTransition('New', 'Check-In')).toBe(true);
    expect(service.canTransition('New', 'Completed')).toBe(false);
    expect(service.canTransition('Active', 'Completed')).toBe(true);
  });
});
