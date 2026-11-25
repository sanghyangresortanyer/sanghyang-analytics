import { GoogleBusinessProfileAdapter } from './google-business-profile';
import { InstagramGraphAdapter } from './instagram-graph';
import { GooglePlacesAdapter } from './google-places';
import { AdapterStatus, OfficialApiAdapter } from './types';

export * from './types';
export * from './google-business-profile';
export * from './instagram-graph';
export * from './google-places';
export * from './tiktok-oembed';

export function getAllOfficialAdapters(): OfficialApiAdapter[] {
  return [
    new GoogleBusinessProfileAdapter(),
    new InstagramGraphAdapter(),
    new GooglePlacesAdapter(),
  ];
}

export function getOfficialAdapterStatuses(): AdapterStatus[] {
  return getAllOfficialAdapters().map((adapter) => adapter.getStatus());
}
