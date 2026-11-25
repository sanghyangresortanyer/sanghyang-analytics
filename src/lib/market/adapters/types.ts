/**
 * Definisi tipe dan antarmuka untuk Adaptor API Resmi (C3).
 *
 * Mengikuti invarian ADR-004:
 * Sumber berlogin dihubungkan lewat adaptor API resmi yang nonaktif jika kredensial belum ada.
 * Tanpa kredensial, status wajib menampilkan label jujur "Belum tersambung" (Zero Mock).
 */

export type AdapterConnectionStatus = 'connected' | 'unconnected';

export interface AdapterStatus {
  id: string;
  name: string;
  description: string;
  status: AdapterConnectionStatus;
  statusLabel: 'Tersambung' | 'Belum tersambung';
  reason?: string;
  requiredEnvKeys: string[];
  documentationUrl?: string;
}

export interface OfficialApiAdapter {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly requiredEnvKeys: string[];

  getStatus(): AdapterStatus;
  isConnected(): boolean;
}
