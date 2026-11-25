import { AdapterStatus, OfficialApiAdapter } from './types';

export interface GoogleBusinessProfileReviewPayload {
  name: string;
  reviewId: string;
  reviewer: {
    displayName: string;
    profilePhotoUrl?: string;
  };
  starRating: 'STAR_RATING_UNSPECIFIED' | 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
}

export interface ParsedBusinessReview {
  reviewId: string;
  author: string;
  rating: number;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
  hasReply: boolean;
}

const STAR_RATING_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

export class GoogleBusinessProfileAdapter implements OfficialApiAdapter {
  readonly id = 'google-business-profile';
  readonly name = 'Google Business Profile API';
  readonly description = 'Adaptor resmi untuk membaca ulasan dan reputasi outlet Sanghyang Indah Spa Resort.';
  readonly requiredEnvKeys = [
    'GOOGLE_BUSINESS_PROFILE_API_KEY',
    'GOOGLE_BUSINESS_ACCOUNT_ID',
    'GOOGLE_BUSINESS_LOCATION_ID',
  ];

  getStatus(): AdapterStatus {
    const connected = this.isConnected();
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      status: connected ? 'connected' : 'unconnected',
      statusLabel: connected ? 'Tersambung' : 'Belum tersambung',
      reason: connected
        ? undefined
        : 'Variabel lingkungan GOOGLE_BUSINESS_PROFILE_API_KEY / GOOGLE_BUSINESS_ACCOUNT_ID belum diatur oleh pemilik repo.',
      requiredEnvKeys: this.requiredEnvKeys,
      documentationUrl: 'https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews',
    };
  }

  isConnected(): boolean {
    const apiKey = process.env.GOOGLE_BUSINESS_PROFILE_API_KEY?.trim();
    const accountId = process.env.GOOGLE_BUSINESS_ACCOUNT_ID?.trim();
    return Boolean(apiKey && accountId);
  }

  /**
   * Parser kontrak data ulasan resmi Google Business Profile.
   */
  parseReview(payload: GoogleBusinessProfileReviewPayload): ParsedBusinessReview {
    const rating = STAR_RATING_MAP[payload.starRating] ?? 0;
    return {
      reviewId: payload.reviewId || payload.name,
      author: payload.reviewer?.displayName || 'Anonim',
      rating,
      comment: payload.comment || '',
      createdAt: new Date(payload.createTime),
      updatedAt: new Date(payload.updateTime),
      hasReply: Boolean(payload.reviewReply?.comment),
    };
  }

  /**
   * Ambil ulasan dari endpoint resmi. Mengembalikan array kosong jika belum tersambung.
   */
  async fetchReviews(): Promise<ParsedBusinessReview[]> {
    if (!this.isConnected()) {
      return [];
    }
    // Jika kredensial sudah tersedia di masa depan, request resmi dijalankan di sini
    return [];
  }
}
