# Tez — Valet Parking Management System

A modern, institutional-grade valet parking management platform built with **Angular 19**, **Ionic 8**, and **Firebase**.

## Architecture

```
tez/
├── src/                      # Angular frontend
│   ├── app/
│   │   ├── core/             # Models, services, guards, interceptors
│   │   ├── shared/           # Reusable components & pipes
│   │   └── features/         # Feature modules (auth, bookings, profile)
│   ├── environments/         # Firebase config per environment
│   └── styles.scss           # Global styles
├── functions/                # Firebase Cloud Functions (backend)
│   └── src/index.ts          # All serverless endpoints
├── firestore.rules           # Security rules
├── storage.rules             # Storage security rules
└── firebase.json             # Firebase project config
```

## Key Improvements Over Legacy System

| Area | Legacy | Tez |
|------|--------|-----|
| **Mutations** | Direct Firestore writes from client | All writes via Cloud Functions |
| **Ticket IDs** | `Math.max()` on client (race condition) | Atomic counter in Firestore transaction |
| **API Keys** | Exposed in JS bundle | Server-side proxy via Cloud Functions |
| **Parking Spots** | No concurrency control | Optimistic locking with TTL |
| **Error Handling** | `console.log()` | Global error handler + user notifications |
| **Auth** | Basic login | RBAC with custom claims (admin/operator/viewer) |
| **Bundle** | jQuery + Moment.js loaded | Zero legacy deps, tree-shakeable |
| **Components** | Modules | Standalone components, lazy-loaded routes |
| **State** | BehaviorSubject | Angular Signals |
| **Dates** | Moment.js (320 KB) | date-fns (tree-shakeable) |

## Features

- **Real-time dashboard** with tab-based navigation and live badge counts
- **Kanban board** view for visual booking pipeline management
- **Parking grid** with real-time spot availability visualization
- **Flight tracking** via FlightStats API (server-side proxy)
- **Status transitions** with validation (New → Booked → Check-In → Parked → Active → Completed)
- **Multi-tenant** architecture — companies fully isolated in Firestore
- **Dark mode** toggle
- **Push notifications** with audio alerts for new bookings
- **Role-based access** — Admin, Operator, Viewer
- **Print-friendly** styles

## Prerequisites

- Node.js 18+
- Angular CLI: `npm install -g @angular/cli`
- Firebase CLI: `npm install -g firebase-tools`
- A Firebase project with Firestore, Auth, and Cloud Functions enabled

## Getting Started

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/tez.git
cd tez
npm install
cd functions && npm install && cd ..
```

### 2. Configure Firebase

Update your Firebase config in:
- `src/environments/environment.ts` (development)
- `src/environments/environment.prod.ts` (production)
- `.firebaserc` (add your project ID)

### 3. Set FlightStats API Keys (optional)

```bash
firebase functions:config:set flightstats.app_id="YOUR_APP_ID" flightstats.app_key="YOUR_APP_KEY"
```

### 4. Run Locally

```bash
# Start Firebase emulators
firebase emulators:start

# In another terminal, start the dev server
ng serve
```

### 5. Deploy

```bash
ng build --configuration production
firebase deploy
```

## Cloud Functions

| Function | Description |
|----------|-------------|
| `createBooking` | Creates booking with atomic ticket number |
| `transitionBooking` | Validates and executes status transitions |
| `assignSpot` | Assigns parking spot with concurrency control |
| `completeBooking` | Completes booking, frees spot, records payment |
| `cancelBooking` | Cancels with spot cleanup |
| `lockSpot` / `releaseSpot` | Optimistic locking for spot selection |
| `getFlightStatus` | Proxies FlightStats API (keeps keys server-side) |
| `setUserRole` | Admin-only: assign user roles |
| `onBookingCreated` | Firestore trigger: creates notification on new booking |
| `cleanupExpiredLocks` | Scheduled: clears stale spot locks every 5 min |

## Security Rules

- All booking/spot writes are `allow write: if false` — only Cloud Functions can mutate
- Read access scoped to company via custom claims (`companyId`)
- Notification updates restricted to marking as read
- Storage limited to images under 5 MB

## License

MIT
