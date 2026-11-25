import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GoogleBusinessProfileAdapter,
  GoogleBusinessProfileReviewPayload,
  GooglePlacesAdapter,
  GooglePlaceDetailsPayload,
  InstagramGraphAdapter,
  InstagramMediaPayload,
  getAllOfficialAdapters,
  getOfficialAdapterStatuses,
} from '../../src/lib/market/adapters';

test('Official API Adapters (C3) - Melaporkan status "Belum tersambung" secara jujur jika kredensial kosong', () => {
  const originalEnv = { ...process.env };
  try {
    delete process.env.GOOGLE_BUSINESS_PROFILE_API_KEY;
    delete process.env.GOOGLE_BUSINESS_ACCOUNT_ID;
    delete process.env.GOOGLE_BUSINESS_LOCATION_ID;
    delete process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN;
    delete process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    delete process.env.GOOGLE_PLACES_API_KEY;

    const adapters = getAllOfficialAdapters();
    assert.equal(adapters.length, 3, 'Harus ada 3 adaptor API resmi berkunci terdaftar (oEmbed TikTok tidak butuh kunci)');

    for (const adapter of adapters) {
      assert.equal(adapter.isConnected(), false, `${adapter.name} harus terdeteksi tidak tersambung`);
      const status = adapter.getStatus();
      assert.equal(status.status, 'unconnected');
      assert.equal(status.statusLabel, 'Belum tersambung');
      assert.ok(status.reason, 'Harus mencantumkan alasan belum tersambung');
    }

    const statuses = getOfficialAdapterStatuses();
    assert.equal(statuses.length, 3);
    assert.ok(statuses.every((s) => s.statusLabel === 'Belum tersambung'));
  } finally {
    process.env = originalEnv;
  }
});

test('GoogleBusinessProfileAdapter - Parsing payload ulasan resmi sesuai kontrak', () => {
  const adapter = new GoogleBusinessProfileAdapter();
  const mockPayload: GoogleBusinessProfileReviewPayload = {
    name: 'accounts/123/locations/456/reviews/rev-001',
    reviewId: 'rev-001',
    reviewer: {
      displayName: 'Budi Santoso',
    },
    starRating: 'FIVE',
    comment: 'Pelayanan ramah, spa sangat nyaman menghadap pantai Anyer.',
    createTime: '2026-11-10T08:30:00Z',
    updateTime: '2026-11-10T08:30:00Z',
    reviewReply: {
      comment: 'Terima kasih Bapak Budi, kami tunggu kedatangannya kembali.',
      updateTime: '2026-11-10T10:00:00Z',
    },
  };

  const parsed = adapter.parseReview(mockPayload);
  assert.equal(parsed.reviewId, 'rev-001');
  assert.equal(parsed.author, 'Budi Santoso');
  assert.equal(parsed.rating, 5);
  assert.ok(parsed.comment.includes('Pelayanan ramah'));
  assert.equal(parsed.hasReply, true);
});

test('InstagramGraphAdapter - Parsing payload media resmi Instagram Graph API', () => {
  const adapter = new InstagramGraphAdapter();
  const mockPayload: InstagramMediaPayload = {
    id: '17900123456789',
    caption: 'Sunset dinner di Sanghyang Indah Spa Resort. #anyer #sunset',
    media_type: 'IMAGE',
    media_url: 'https://scontent.cdninstagram.com/v/t51.2885-15/photo.jpg',
    permalink: 'https://www.instagram.com/p/DB123456/',
    timestamp: '2026-11-12T11:00:00Z',
    like_count: 142,
    comments_count: 18,
  };

  const parsed = adapter.parseMediaItem(mockPayload);
  assert.equal(parsed.postId, '17900123456789');
  assert.equal(parsed.permalink, 'https://www.instagram.com/p/DB123456/');
  assert.ok(parsed.caption.includes('Sunset dinner'));
  assert.equal(parsed.likes, 142);
  assert.equal(parsed.comments, 18);
});

test('GooglePlacesAdapter - Parsing payload detail tempat Google Places API', () => {
  const adapter = new GooglePlacesAdapter();
  const mockPayload: GooglePlaceDetailsPayload = {
    id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
    displayName: {
      text: 'Mambruk Hotel & Convention Anyer',
      languageCode: 'id',
    },
    rating: 4.5,
    userRatingCount: 2340,
    googleMapsUri: 'https://maps.google.com/?cid=12345',
    websiteUri: 'https://www.mambruk.co.id',
    photos: [
      {
        name: 'places/ChIJ.../photos/photo_ref_1',
        widthPx: 1920,
        heightPx: 1080,
      },
    ],
    reviews: [
      {
        name: 'places/ChIJ.../reviews/rev_1',
        rating: 4,
        text: {
          text: 'Kolam renang luas dan pemandangan laut bagus.',
        },
        publishTime: '2026-11-08T04:12:00Z',
        authorAttribution: {
          displayName: 'Siti Rahma',
        },
      },
    ],
  };

  const parsed = adapter.parsePlaceDetails(mockPayload);
  assert.equal(parsed.placeId, 'ChIJN1t_tDeuEmsRUsoyG83frY4');
  assert.equal(parsed.name, 'Mambruk Hotel & Convention Anyer');
  assert.equal(parsed.rating, 4.5);
  assert.equal(parsed.reviewCount, 2340);
  assert.equal(parsed.photos.length, 1);
  assert.equal(parsed.reviews.length, 1);
  assert.equal(parsed.reviews[0].author, 'Siti Rahma');
  assert.equal(parsed.reviews[0].rating, 4);
});

test('Official API Adapters - Melaporkan status "Tersambung" bila env variabel diatur', () => {
  const originalEnv = { ...process.env };
  try {
    process.env.GOOGLE_PLACES_API_KEY = 'AIzaSyFakeKeyForTest123456';
    const placesAdapter = new GooglePlacesAdapter();
    assert.equal(placesAdapter.isConnected(), true);
    assert.equal(placesAdapter.getStatus().statusLabel, 'Tersambung');

    process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN = 'EAAB...fake...token';
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = '17841400000000000';
    const igAdapter = new InstagramGraphAdapter();
    assert.equal(igAdapter.isConnected(), true);
    assert.equal(igAdapter.getStatus().statusLabel, 'Tersambung');

    process.env.GOOGLE_BUSINESS_PROFILE_API_KEY = 'AIzaSyFakeKeyBusiness123';
    process.env.GOOGLE_BUSINESS_ACCOUNT_ID = 'accounts/12345';
    const businessAdapter = new GoogleBusinessProfileAdapter();
    assert.equal(businessAdapter.isConnected(), true);
    assert.equal(businessAdapter.getStatus().statusLabel, 'Tersambung');
  } finally {
    process.env = originalEnv;
  }
});
