import { Component, inject, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import {
  IonTabs,
  IonTabBar,
  IonTabButton,
  IonIcon,
  IonLabel,
  IonBadge,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  ticketOutline,
  calendarOutline,
  addCircleOutline,
  carSportOutline,
  personOutline,
} from 'ionicons/icons';
import { BookingService, ParkingService } from '../../core/services';

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [
    CommonModule,
    IonTabs,
    IonTabBar,
    IonTabButton,
    IonIcon,
    IonLabel,
    IonBadge,
  ],
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom" class="tab-bar">
        <ion-tab-button tab="issued" class="tab-btn">
          <ion-icon name="ticket-outline"></ion-icon>
          <ion-label>Issued</ion-label>
          @if (counts().issued > 0) {
            <ion-badge color="primary">{{ counts().issued }}</ion-badge>
          }
        </ion-tab-button>

        <ion-tab-button tab="reservations" class="tab-btn">
          <ion-icon name="calendar-outline"></ion-icon>
          <ion-label>Reservations</ion-label>
          @if (counts().booked > 0) {
            <ion-badge color="secondary">{{ counts().booked }}</ion-badge>
          }
        </ion-tab-button>

        <ion-tab-button tab="new" class="tab-btn">
          <ion-icon name="add-circle-outline"></ion-icon>
          <ion-label>New</ion-label>
          @if (counts().new > 0) {
            <ion-badge color="danger" class="pulse-badge">{{ counts().new }}</ion-badge>
          }
        </ion-tab-button>

        <ion-tab-button tab="active" class="tab-btn">
          <ion-icon name="car-sport-outline"></ion-icon>
          <ion-label>Active</ion-label>
          @if (counts().active > 0) {
            <ion-badge color="warning">{{ counts().active }}</ion-badge>
          }
        </ion-tab-button>

        <ion-tab-button tab="profile" class="tab-btn">
          <ion-icon name="person-outline"></ion-icon>
          <ion-label>Profile</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: [`
    .tab-bar {
      --background: #ffffff;
      --border: 1px solid #e8e8e8;
      padding-bottom: env(safe-area-inset-bottom, 0);
      height: 60px;
    }

    .tab-btn {
      --color: #999;
      --color-selected: #1a1a2e;

      ion-icon { font-size: 22px; }
      ion-label { font-size: 11px; font-weight: 500; }
    }

    .pulse-badge {
      animation: pulseBadge 1.5s infinite;
    }

    @keyframes pulseBadge {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.2); }
    }
  `],
})
export class TabsComponent implements OnInit {
  private bookingSvc = inject(BookingService);
  private parkingSvc = inject(ParkingService);

  readonly counts = this.bookingSvc.counts;

  constructor() {
    addIcons({
      ticketOutline,
      calendarOutline,
      addCircleOutline,
      carSportOutline,
      personOutline,
    });
  }

  ngOnInit(): void {
    this.bookingSvc.startListening();
    this.parkingSvc.startListening();
  }
}
