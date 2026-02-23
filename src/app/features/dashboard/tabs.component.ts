import { Component, inject, computed, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonBadge,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  ticketOutline, calendarOutline, addCircleOutline, carSportOutline, personOutline,
} from 'ionicons/icons';
import { BookingService, ParkingService } from '../../core/services';

@Component({
  selector: 'app-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonBadge],
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom" class="tab-bar" role="navigation" aria-label="Main navigation">
        <ion-tab-button tab="issued" class="tab-btn" aria-label="Issued tickets">
          <ion-icon name="ticket-outline" aria-hidden="true"></ion-icon>
          <ion-label>Issued</ion-label>
          @if (counts().issued > 0) {
            <ion-badge color="primary" [attr.aria-label]="counts().issued + ' issued tickets'">{{ counts().issued }}</ion-badge>
          }
        </ion-tab-button>

        <ion-tab-button tab="reservations" class="tab-btn" aria-label="Reservations">
          <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
          <ion-label>Bookings</ion-label>
          @if (counts().booked > 0) {
            <ion-badge color="secondary" [attr.aria-label]="counts().booked + ' bookings'">{{ counts().booked }}</ion-badge>
          }
        </ion-tab-button>

        <ion-tab-button tab="new" class="tab-btn tab-btn--highlight" aria-label="New tickets">
          <div class="new-btn-circle">
            <ion-icon name="add-circle-outline" aria-hidden="true"></ion-icon>
          </div>
          <ion-label>New</ion-label>
          @if (counts().new > 0) {
            <ion-badge color="danger" class="pulse-badge" [attr.aria-label]="counts().new + ' new tickets'">{{ counts().new }}</ion-badge>
          }
        </ion-tab-button>

        <ion-tab-button tab="active" class="tab-btn" aria-label="Active tickets">
          <ion-icon name="car-sport-outline" aria-hidden="true"></ion-icon>
          <ion-label>Active</ion-label>
          @if (counts().active > 0) {
            <ion-badge color="warning" [attr.aria-label]="counts().active + ' active tickets'">{{ counts().active }}</ion-badge>
          }
        </ion-tab-button>

        <ion-tab-button tab="profile" class="tab-btn" aria-label="Your profile and settings">
          <ion-icon name="person-outline" aria-hidden="true"></ion-icon>
          <ion-label>Me</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: [`
    .tab-bar {
      --background: #ffffff;
      --border: none;
      padding-bottom: env(safe-area-inset-bottom, 0);
      height: 64px;
      box-shadow: 0 -2px 12px rgba(0,0,0,.06);
    }
    .tab-btn {
      --color: #999; --color-selected: #1a1a2e;
      --padding-top: 8px; --padding-bottom: 4px;
      ion-icon { font-size: 24px; }
      ion-label { font-size: 11px; font-weight: 600; letter-spacing: 0.2px; margin-top: 2px; }
      ion-badge { margin-top: -8px; margin-left: -4px; font-size: 10px; min-width: 18px; }
    }
    .tab-btn--highlight {
      .new-btn-circle {
        width: 44px; height: 44px; border-radius: 50%;
        background: linear-gradient(135deg, #fcc00b, #ff9800);
        display: flex; align-items: center; justify-content: center;
        margin-top: -12px;
        box-shadow: 0 4px 12px rgba(252,192,11,.35);
        ion-icon { font-size: 28px; color: #1a1a2e; }
      }
    }
    .pulse-badge { animation: pulseBadge 2s ease-in-out infinite; }
    @keyframes pulseBadge { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
  `],
})
export class TabsComponent implements OnInit, OnDestroy {
  private bookingSvc = inject(BookingService);
  private parkingSvc = inject(ParkingService);

  readonly counts = this.bookingSvc.counts;

  constructor() {
    addIcons({ ticketOutline, calendarOutline, addCircleOutline, carSportOutline, personOutline });
  }

  ngOnInit(): void {
    this.bookingSvc.startListening();
    this.parkingSvc.startListening();
  }

  /** #48 fix — cleanup listeners on destroy */
  ngOnDestroy(): void {
    this.bookingSvc.stopListening();
    this.parkingSvc.stopListening();
  }
}
