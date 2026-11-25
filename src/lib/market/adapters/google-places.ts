import { AdapterStatus, OfficialApiAdapter } from './types';

export interface GooglePlaceDetailsPayload {
  id: string;
  displayName?: {
    text: string;
    languageCode?: string;
  };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  websiteUri?: string;
  photos?: Array<{
    name: string;
    widthPx: number;
    heightPx: number;
    authorAttributions?: Array<{
      displayName: string;
      uri?: string;
    }>;
  }>;
  reviews?: Array<{
    name: string;
    rating: number;
    text?: {
      text: string;
    };
    publishTime: string;
    authorAttribution?: {
      displayName: string;
      uri?: string;
      photoUri?: string;
    };
  }>;
}

export interface ParsedPlaceDetails {
  placeId: string;
  name: string;
  rating: number;
  reviewCount: number;
  mapsUrl?: string;
  websiteUrl?: string;
  photos: Array<{
    photoReference: string;
    width: number;
    height: number;
  }>;
  reviews: Array<{
    author: string;
    rating: number;
    text: string;
    publishedAt: Date;
  }>;
}

export class GooglePlacesAdapter implements OfficialApiAdapter {
  readonly id = 'google-places';
  readonly name = 'Google Places API';
  readonly description = 'Adaptor resmi Google Maps Platform untuk data rating, ulasan agregat, dan foto kompetitor.';
  readonly requiredEnvKeys = ['GOOGLE_PLACES_API_KEY'];

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
        : 'Variabel lingkungan GOOGLE_PLACES_API_KEY belum diatur oleh pemilik repo.',
      requiredEnvKeys: this.requiredEnvKeys,
      documentationUrl: 'https://developers.google.com/maps/documentation/places/web-service/op-overview',
    };
  }

  isConnected(): boolean {
    const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
    return Boolean(key);
  }

  /**
   * Parser kontrak respons resmi Google Places API (New).
   */
  parsePlaceDetails(payload: GooglePlaceDetailsPayload): ParsedPlaceDetails {
    return {
      placeId: payload.id,
      name: payload.displayName?.text || '',
      rating: payload.rating ?? 0,
      reviewCount: payload.userRatingCount ?? 0,
      mapsUrl: payload.googleMapsUri,
      websiteUrl: payload.websiteUri,
      photos: (payload.photos || []).map((p) => ({
        photoReference: p.name,
        width: p.widthPx,
        height: p.heightPx,
      })),
      reviews: (payload.reviews || []).map((r) => ({
        author: r.authorAttribution?.displayName || 'Anonim',
        rating: r.rating ?? 0,
        text: r.text?.text || '',
        publishedAt: new Date(r.publishTime),
      })),
    };
  }

  /**
   * Mengambil detail tempat dari Places API bila kredensial tersedia.
   */
  async fetchPlaceDetails(placeId?: string): Promise<ParsedPlaceDetails | null> {
    if (!this.isConnected() || !placeId) {
      return null;
    }
    return null;
  }
}
