import {
  Component, inject, signal, computed, ChangeDetectionStrategy,
  Output, EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
  IonButton, IonIcon, IonItem, IonInput, IonTextarea,
  IonSelect, IonSelectOption, IonSpinner,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, carOutline, personOutline, callOutline,
  mailOutline, airplaneOutline, documentTextOutline,
  checkmarkCircleOutline,
} from 'ionicons/icons';
import { BookingService, UiService } from '../../../core/services';
import { ModalController } from '@ionic/angular/standalone';

const VEHICLE_COLORS = [
  'Black', 'White', 'Silver', 'Gray', 'Red', 'Blue', 'Green',
  'Brown', 'Beige', 'Gold', 'Orange', 'Yellow', 'Purple', 'Other',
];

@Component({
  selector: 'app-create-booking',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    IonContent, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonButton, IonIcon, IonItem, IonInput, IonTextarea,
    IonSelect, IonSelectOption, IonSpinner,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>New Ticket</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()" aria-label="Close">
            <ion-icon name="close-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <form (ngSubmit)="onSubmit()" class="create-form">
        <!-- Customer Section -->
        <div class="section-header">
          <ion-icon name="person-outline" aria-hidden="true"></ion-icon>
          <span>Customer Information</span>
        </div>

        <ion-item lines="none" class="form-item">
          <ion-input
            label="Customer Name *"
            labelPlacement="stacked"
            placeholder="John Smith"
            [(ngModel)]="form.customerName"
            name="customerName"
            required
            autocomplete="name"
            class="custom-input"
          ></ion-input>
        </ion-item>

        <div class="form-row">
          <ion-item lines="none" class="form-item half">
            <ion-input
              label="Phone"
              labelPlacement="stacked"
              placeholder="(555) 123-4567"
              [(ngModel)]="form.customerPhone"
              name="customerPhone"
              type="tel"
              inputmode="tel"
              autocomplete="tel"
              class="custom-input"
            ></ion-input>
          </ion-item>
          <ion-item lines="none" class="form-item half">
            <ion-input
              label="Email"
              labelPlacement="stacked"
              placeholder="john@email.com"
              [(ngModel)]="form.customerEmail"
              name="customerEmail"
              type="email"
              inputmode="email"
              autocomplete="email"
              class="custom-input"
            ></ion-input>
          </ion-item>
        </div>

        <!-- Vehicle Section -->
        <div class="section-header">
          <ion-icon name="car-outline" aria-hidden="true"></ion-icon>
          <span>Vehicle Details</span>
        </div>

        <ion-item lines="none" class="form-item">
          <ion-input
            label="License Plate *"
            labelPlacement="stacked"
            placeholder="ABC 1234"
            [(ngModel)]="form.vehiclePlate"
            name="vehiclePlate"
            required
            class="custom-input plate-input"
            [style.--input-letter-spacing]="'2px'"
          ></ion-input>
        </ion-item>

        <div class="form-row">
          <ion-item lines="none" class="form-item half">
            <ion-input
              label="Make"
              labelPlacement="stacked"
              placeholder="Toyota"
              [(ngModel)]="form.vehicleMake"
              name="vehicleMake"
              class="custom-input"
            ></ion-input>
          </ion-item>
          <ion-item lines="none" class="form-item half">
            <ion-input
              label="Model"
              labelPlacement="stacked"
              placeholder="Camry"
              [(ngModel)]="form.vehicleModel"
              name="vehicleModel"
              class="custom-input"
            ></ion-input>
          </ion-item>
        </div>

        <ion-item lines="none" class="form-item">
          <ion-select
            label="Color"
            labelPlacement="stacked"
            placeholder="Select color"
            [(ngModel)]="form.vehicleColor"
            name="vehicleColor"
            interface="action-sheet"
            class="custom-input"
          >
            @for (color of colors; track color) {
              <ion-select-option [value]="color">{{ color }}</ion-select-option>
            }
          </ion-select>
        </ion-item>

        <!-- Flight Section (optional) -->
        <div class="section-header">
          <ion-icon name="airplane-outline" aria-hidden="true"></ion-icon>
          <span>Flight Info <span class="optional-tag">(Optional)</span></span>
        </div>

        <ion-item lines="none" class="form-item">
          <ion-input
            label="Flight Number"
            labelPlacement="stacked"
            placeholder="AA 1234"
            [(ngModel)]="form.flightNumber"
            name="flightNumber"
            class="custom-input"
          ></ion-input>
        </ion-item>

        <!-- Notes -->
        <div class="section-header">
          <ion-icon name="document-text-outline" aria-hidden="true"></ion-icon>
          <span>Notes <span class="optional-tag">(Optional)</span></span>
        </div>

        <ion-item lines="none" class="form-item">
          <ion-textarea
            placeholder="Special instructions, damage notes, etc."
            [(ngModel)]="form.notes"
            name="notes"
            [rows]="3"
            [autoGrow]="true"
            class="custom-input"
          ></ion-textarea>
        </ion-item>

        <!-- Validation -->
        @if (validationError()) {
          <div class="validation-error" role="alert">
            {{ validationError() }}
          </div>
        }

        <!-- Submit -->
        <button
          type="submit"
          class="submit-btn"
          [disabled]="loading() || !isValid()"
          aria-label="Create booking ticket"
        >
          @if (loading()) {
            <ion-spinner name="crescent" color="dark"></ion-spinner>
            <span>Creating Ticket...</span>
          } @else {
            <ion-icon name="checkmark-circle-outline"></ion-icon>
            <span>Create Ticket</span>
          }
        </button>
      </form>
    </ion-content>
  `,
  styles: [`
    .create-form { padding-bottom: 40px; }

    .section-header {
      display: flex; align-items: center; gap: 8px;
      font-size: 14px; font-weight: 700; color: #1a1a2e;
      margin: 24px 0 12px; padding: 0 4px;
      text-transform: uppercase; letter-spacing: .5px;
      ion-icon { font-size: 18px; color: #fcc00b; }
    }
    .section-header:first-child { margin-top: 8px; }
    .optional-tag {
      font-size: 11px; font-weight: 500; color: #bbb;
      text-transform: none; letter-spacing: 0;
    }

    .form-item {
      --background: #f8f9fc;
      --border-radius: 14px;
      --padding-start: 16px;
      --padding-end: 16px;
      --inner-padding-end: 0;
      margin-bottom: 10px;
      border: 1.5px solid #eaedf3;
      border-radius: 14px;
      transition: border-color .2s;
      &:focus-within { border-color: #fcc00b; }
    }

    .form-row {
      display: flex; gap: 10px;
      .half { flex: 1; }
    }

    .plate-input {
      font-weight: 800; font-size: 18px; letter-spacing: 2px;
      text-transform: uppercase;
    }

    .validation-error {
      background: #fff0f0; border: 1px solid #ffcdd2; color: #c62828;
      padding: 12px 16px; border-radius: 12px; font-size: 14px;
      margin: 16px 0; font-weight: 500;
    }

    .submit-btn {
      width: 100%; padding: 18px; margin-top: 24px;
      background: linear-gradient(145deg, #fcc00b, #ff9100);
      color: #1a1a2e; border: none; border-radius: 16px;
      font-size: 17px; font-weight: 800; cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 10px;
      min-height: 56px; letter-spacing: .3px;
      box-shadow: 0 6px 20px rgba(252,192,11,.3);
      transition: all .25s cubic-bezier(0.34, 1.56, 0.64, 1);
      &:hover:not(:disabled) { transform: translateY(-3px); box-shadow: 0 10px 30px rgba(252,192,11,.4); }
      &:active:not(:disabled) { transform: translateY(0) scale(.98); }
      &:disabled { opacity: .6; cursor: not-allowed; box-shadow: none; }
      ion-icon { font-size: 22px; }
    }
  `],
})
export class CreateBookingComponent {
  private bookingSvc = inject(BookingService);
  private ui = inject(UiService);
  private modalCtrl = inject(ModalController);

  readonly loading = signal(false);
  readonly validationError = signal('');
  readonly colors = VEHICLE_COLORS;

  form = {
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    vehiclePlate: '',
    vehicleMake: '',
    vehicleModel: '',
    vehicleColor: '',
    flightNumber: '',
    notes: '',
  };

  constructor() {
    addIcons({
      closeOutline, carOutline, personOutline, callOutline,
      mailOutline, airplaneOutline, documentTextOutline,
      checkmarkCircleOutline,
    });
  }

  readonly isValid = computed(() => {
    return !!(this.form.customerName?.trim() && this.form.vehiclePlate?.trim());
  });

  async dismiss(data?: any): Promise<void> {
    await this.modalCtrl.dismiss(data);
  }

  async onSubmit(): Promise<void> {
    this.validationError.set('');

    if (!this.form.customerName?.trim()) {
      this.validationError.set('Customer name is required');
      return;
    }
    if (!this.form.vehiclePlate?.trim()) {
      this.validationError.set('License plate is required');
      return;
    }

    this.loading.set(true);
    try {
      const result = await this.bookingSvc.createBooking({
        customerName: this.form.customerName.trim(),
        customerPhone: this.form.customerPhone.trim() || undefined,
        customerEmail: this.form.customerEmail.trim() || undefined,
        vehicleMake: this.form.vehicleMake.trim() || undefined,
        vehicleModel: this.form.vehicleModel.trim() || undefined,
        vehicleColor: this.form.vehicleColor || undefined,
        vehiclePlate: this.form.vehiclePlate.trim().toUpperCase(),
        flightNumber: this.form.flightNumber.trim() || undefined,
        notes: this.form.notes.trim() || undefined,
      });

      this.ui.toast(`Ticket #${result.ticketNumber} created!`, 'success');
      await this.dismiss(result);
    } catch (err: any) {
      const msg = err?.message || 'Failed to create ticket';
      this.validationError.set(msg);
      this.ui.toast(msg, 'danger');
    } finally {
      this.loading.set(false);
    }
  }
}
