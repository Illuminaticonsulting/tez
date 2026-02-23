import { Injectable, inject } from '@angular/core';
import { ToastController, AlertController, LoadingController } from '@ionic/angular/standalone';

@Injectable({ providedIn: 'root' })
export class UiService {
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);
  private loadingCtrl = inject(LoadingController);

  private loadingRef: HTMLIonLoadingElement | null = null;

  async toast(
    message: string,
    color: 'success' | 'warning' | 'danger' | 'primary' = 'success',
    duration = 3000
  ): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration,
      color,
      position: 'bottom',
      buttons: [{ text: 'OK', role: 'cancel' }],
    });
    await toast.present();
  }

  /** #44 fix — no async Promise executor anti-pattern */
  async confirm(
    header: string,
    message: string,
    confirmText = 'Confirm',
    cancelText = 'Cancel'
  ): Promise<boolean> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: [
        { text: cancelText, role: 'cancel' },
        { text: confirmText, role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  async showLoading(message = 'Loading...'): Promise<void> {
    this.loadingRef = await this.loadingCtrl.create({
      message,
      spinner: 'crescent',
    });
    await this.loadingRef.present();
  }

  async hideLoading(): Promise<void> {
    await this.loadingRef?.dismiss();
    this.loadingRef = null;
  }

  /** #44 fix */
  async prompt(
    header: string,
    message: string,
    inputName = 'value',
    inputPlaceholder = ''
  ): Promise<string | null> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      inputs: [{ name: inputName, type: 'text', placeholder: inputPlaceholder }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'OK', role: 'confirm' },
      ],
    });
    await alert.present();
    const { data, role } = await alert.onDidDismiss();
    if (role === 'confirm' && data?.values) {
      return data.values[inputName] ?? null;
    }
    return null;
  }
}
