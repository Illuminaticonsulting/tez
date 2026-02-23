import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { Auth } from '@angular/fire/auth';
import { Router } from '@angular/router';
import { FirestoreService } from './firestore.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockAuth = {
    onAuthStateChanged: (auth: any, cb: (u: any) => void) => { cb(null); return () => {}; },
    currentUser: null,
  };
  const mockRouter = {
    navigateByUrl: jasmine.createSpy('navigateByUrl'),
  };
  const mockFirestore = {
    getDocument: jasmine.createSpy('getDocument'),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: Auth, useValue: mockAuth },
        { provide: Router, useValue: mockRouter },
        { provide: FirestoreService, useValue: mockFirestore },
      ],
    });
    service = TestBed.inject(AuthService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should not be authenticated initially', () => {
    expect(service.isAuthenticated()).toBe(false);
  });

  it('should have viewer as default role', () => {
    expect(service.userRole()).toBe('viewer');
  });

  it('should have empty companyId initially', () => {
    expect(service.companyId()).toBe('');
  });
});
