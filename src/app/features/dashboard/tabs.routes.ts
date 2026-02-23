import { Routes } from '@angular/router';
import { TabsComponent } from './tabs.component';

export const TABS_ROUTES: Routes = [
  {
    path: '',
    component: TabsComponent,
    children: [
      {
        path: 'issued',
        loadComponent: () =>
          import('../bookings/issued/issued.component').then(
            (m) => m.IssuedComponent
          ),
      },
      {
        path: 'reservations',
        loadComponent: () =>
          import('../bookings/reservations/reservations.component').then(
            (m) => m.ReservationsComponent
          ),
      },
      {
        path: 'new',
        loadComponent: () =>
          import('../bookings/new-tickets/new-tickets.component').then(
            (m) => m.NewTicketsComponent
          ),
      },
      {
        path: 'active',
        loadComponent: () =>
          import('../bookings/active/active.component').then(
            (m) => m.ActiveComponent
          ),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('../profile/profile.component').then(
            (m) => m.ProfileComponent
          ),
      },
      {
        path: 'kanban',
        loadComponent: () =>
          import('../bookings/kanban/kanban.component').then(
            (m) => m.KanbanComponent
          ),
      },
      {
        path: 'analytics',
        loadComponent: () =>
          import('../analytics/analytics.component').then(
            (m) => m.AnalyticsComponent
          ),
      },
      {
        path: 'phone-settings',
        loadComponent: () =>
          import('../settings/phone-settings/phone-settings.component').then(
            (m) => m.PhoneSettingsComponent
          ),
      },
      {
        path: 'notification-settings',
        loadComponent: () =>
          import('../settings/notification-settings/notification-settings.component').then(
            (m) => m.NotificationSettingsComponent
          ),
      },
      {
        path: '',
        redirectTo: 'issued',
        pathMatch: 'full',
      },
    ],
  },
];
