import { TestBed } from '@angular/core/testing';
import { BookingService } from './booking.service';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { ApiService } from './api.service';
import { NotificationService } from './notification.service';

describe('BookingService', () => {
  let service: BookingService;

  const mockAuth = {
    companyId: jasmine.createSpy('companyId').and.returnValue('test-co'),
    firebaseUser: jasmine.createSpy('firebaseUser').and.returnValue({ uid: 'test-uid' }),
  };
  const mockFirestore = {
    listenToCollection: jasmine.createSpy('listenToCollection').and.returnValue(() => {}),
  };
  const mockApi = {
    call: jasmine.createSpy('call').and.returnValue(Promise.resolve({})),
  };
  const mockNotify = {
    playAlert: jasmine.createSpy('playAlert'),
    showBanner: jasmine.createSpy('showBanner'),
    banners: jasmine.createSpy('banners').and.returnValue([]),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        BookingService,
        { provide: AuthService, useValue: mockAuth },
        { provide: FirestoreService, useValue: mockFirestore },
        { provide: ApiService, useValue: mockApi },
        { provide: NotificationService, useValue: mockNotify },
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

  it('should have groups computed with correct shape', () => {
    const groups = service.groups();
    expect(groups).toBeDefined();
    expect(groups.issued).toBeDefined();
    expect(groups.active).toBeDefined();
    expect(groups.booked).toBeDefined();
    expect(groups.new).toBeDefined();
  });

  it('should validate transitions correctly', () => {
    expect(service.canTransition('New', 'Booked')).toBe(true);
    expect(service.canTransition('New', 'Cancelled')).toBe(true);
    expect(service.canTransition('New', 'Completed')).toBe(false);
    expect(service.canTransition('Active', 'Completed')).toBe(true);
    expect(service.canTransition('Active', 'Cancelled')).toBe(true);
    expect(service.canTransition('Completed', 'New')).toBe(false);
  });

  it('should have counts computed', () => {
    const counts = service.counts();
    expect(counts.total).toBe(0);
    expect(counts.issued).toBe(0);
    expect(counts.active).toBe(0);
    expect(counts.new).toBe(0);
    expect(counts.booked).toBe(0);
  });
});
