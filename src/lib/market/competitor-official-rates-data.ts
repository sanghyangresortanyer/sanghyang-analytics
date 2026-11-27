/**
 * Berkas repo competitor-official-rates.data.json, divalidasi sekali saat pertama dipakai; berkas rusak = galat, bukan
 * tampilan kosong. Isinya ditulis lib/market/competitor-official-rates-refresh.ts.
 */
import data from "./competitor-official-rates.data.json";
import { competitorOfficialRoomRatesOf, parseCompetitorOfficialRatesFile, type CompetitorOfficialRatesFile } from "./competitor-official-rates";
import type { OfficialRoomRate } from "./official-room-rates";

let loaded: CompetitorOfficialRatesFile | undefined;
export function loadCompetitorOfficialRates(): CompetitorOfficialRatesFile {
  loaded ??= parseCompetitorOfficialRatesFile(data);
  return loaded;
}

/** Tarif engine resmi per tipe kamar satu kompetitor; [] bila hotel ini tidak punya engine yang dibaca. */
export function competitorOfficialRoomRatesFor(hotelId: string): OfficialRoomRate[] {
  return competitorOfficialRoomRatesOf(loadCompetitorOfficialRates(), hotelId);
}
