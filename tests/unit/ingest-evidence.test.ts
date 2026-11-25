import test from "node:test";
import assert from "node:assert/strict";
import {
  isAuthenticReviewSourceUrl,
  validateEvidenceRecord,
  filterAuthenticEvidence,
  type RawEvidence,
} from "../../src/lib/market/ingest-crawlai-evidence";

test("isAuthenticReviewSourceUrl - Penolakan URL fiktif dan pola cid buatan", () => {
  // 1. URL null, undefined, kosong
  assert.equal(isAuthenticReviewSourceUrl(null), false, "Null harus ditolak");
  assert.equal(isAuthenticReviewSourceUrl(undefined), false, "Undefined harus ditolak");
  assert.equal(isAuthenticReviewSourceUrl(""), false, "String kosong harus ditolak");
  assert.equal(isAuthenticReviewSourceUrl("   "), false, "Whitespace harus ditolak");
  assert.equal(isAuthenticReviewSourceUrl("not-a-valid-url"), false, "URL tidak valid harus ditolak");

  // 2. Pola cid buatan dari skrip crawler lama (D8 / Zero Mock)
  const syntheticUrls = [
    "https://maps.google.com/?cid=sanghyangresortanyer",
    "https://maps.google.com/?cid=sunsetgrillsanghyanganyer",
    "https://maps.google.com/?cid=dbistrosanghyanganyer",
    "https://maps.google.com/?cid=dspaonsenanyer",
    "https://maps.google.com/?cid=dbarkaraokeanyer",
    "https://maps.google.com/?cid=patraanyerhotel",
    "https://maps.google.com/?cid=mambrukhotelanyer",
    "https://maps.google.com/?cid=astonanyerbeachhotel",
    "https://maps.google.com/?cid=theuppercirclenovusjiva",
    "https://maps.google.com/?cid=sunsetbarastonanyer",
  ];

  for (const url of syntheticUrls) {
    assert.equal(
      isAuthenticReviewSourceUrl(url),
      false,
      `Pola buatan ${url} WAJIB ditolak keras`
    );
  }

  // 3. Domain dummy / lokal
  assert.equal(isAuthenticReviewSourceUrl("http://localhost:3000/review"), false);
  assert.equal(isAuthenticReviewSourceUrl("https://example.com/fake-review"), false);

  // 4. URL sah dan otentik
  const authenticUrls = [
    "https://www.google.co.id/travel/hotels/entity/ChcI3eSggaqXsutkGgsvZy8xdGd6a2psZhAB/reviews",
    "https://www.google.com/travel/hotels/entity/ChcI3eSggaqXsutkGgsvZy8xdGd6a2psZhAB",
    "https://www.google.com/maps/place/Sanghyang+Indah+Spa+Resort/@-6.104,105.867,17z",
    "https://maps.google.com/?cid=1827491749127491029", // CID numerik asli Google
    "https://maps.app.goo.gl/abcdef123456",
    "https://www.traveloka.com/en-en/user/review/consumption/HOTEL/GENERAL/3000010004065",
    "https://www.tripadvisor.co.id/Hotel_Review-g297724-d500473-Reviews-Sanghyang_Indah_Spa_Resort-Anyer_Banten_Province_Java.html",
    "https://www.agoda.com/en-au/sanghyang-indah-spa-resort/hotel/anyer-id.html",
    "https://www.instagram.com/dragonbeachclub/",
  ];

  for (const url of authenticUrls) {
    assert.equal(
      isAuthenticReviewSourceUrl(url),
      true,
      `URL sah ${url} harus diterima`
    );
  }
});

test("validateEvidenceRecord - Validasi rekaman ulasan tunggal", () => {
  // Rekaman valid
  const validEv: RawEvidence = {
    id: "ev-real-001",
    entity_id: "business",
    url: "https://www.google.co.id/travel/hotels/entity/ChcI3eSggaqXsutkGgsvZy8xdGd6a2psZhAB/reviews",
    platform: "Google Travel",
    text: "Pemandangan pantai sangat indah dan kamar bersih, pelayanan staf sangat ramah.",
    sentiment: "positive",
    rating: "5/5",
  };

  const resValid = validateEvidenceRecord(validEv);
  assert.equal(resValid.valid, true);

  // Rekaman dengan URL cid buatan
  const fakeEv: RawEvidence = {
    id: "ev-fake-002",
    entity_id: "sunset-grill",
    url: "https://maps.google.com/?cid=sunsetgrillsanghyanganyer",
    platform: "Google Maps",
    text: "Makan malam seafood di pinggir pantai enak sekali sambil lihat sunset.",
    sentiment: "positive",
    rating: "4.5/5",
  };

  const resFake = validateEvidenceRecord(fakeEv);
  assert.equal(resFake.valid, false);
  assert.match(resFake.reason ?? "", /sourceUrl tidak valid atau menggunakan pola buatan/);

  // Rekaman dengan teks terlalu pendek
  const shortTextEv: RawEvidence = {
    id: "ev-short-003",
    entity_id: "business",
    url: "https://www.google.co.id/travel/hotels/entity/ChcI3eSggaqXsutkGgsvZy8xdGd6a2psZhAB",
    platform: "Google Travel",
    text: "Bagus",
    sentiment: "positive",
  };

  const resShort = validateEvidenceRecord(shortTextEv);
  assert.equal(resShort.valid, false);
  assert.match(resShort.reason ?? "", /Teks bukti tidak memadai/);
});

test("filterAuthenticEvidence - Penyaringan batch memisahkan data sintetis vs asli", () => {
  const batch: RawEvidence[] = [
    {
      id: "ev-1",
      entity_id: "business",
      url: "https://www.google.co.id/travel/hotels/entity/ChcI3eSggaqXsutkGgsvZy8xdGd6a2psZhAB",
      platform: "Google Travel",
      text: "Kolam air panasnya sangat nyaman untuk relaksasi bersama keluarga.",
      sentiment: "positive",
    },
    {
      id: "ev-2",
      entity_id: "sunset-grill",
      url: "https://maps.google.com/?cid=sunsetgrillsanghyanganyer", // SINTETIS
      platform: "Google Maps",
      text: "Ikan bakar bumbu rica-ricanya mantap, bumbu meresap sempurna.",
      sentiment: "positive",
    },
    {
      id: "ev-3",
      entity_id: "dspa",
      url: "https://maps.google.com/?cid=dspaonsenanyer", // SINTETIS
      platform: "Google Maps",
      text: "Hot spring alami satu-satunya di Anyer, badan jadi segar kembali.",
      sentiment: "positive",
    },
    {
      id: "ev-4",
      entity_id: "business",
      url: "https://www.tripadvisor.co.id/Hotel_Review-g297724-d500473-Reviews.html",
      platform: "Tripadvisor",
      text: "Sarapan prasmanan cukup bervariasi, staf restoran ramah dan sigap melayani.",
      sentiment: "positive",
    },
  ];

  const result = filterAuthenticEvidence(batch);
  assert.equal(result.valid.length, 2, "Harus meloloskan 2 ulasan sah");
  assert.equal(result.rejected.length, 2, "Harus menolak 2 ulasan dengan cid buatan");
  assert.equal(result.valid[0].id, "ev-1");
  assert.equal(result.valid[1].id, "ev-4");
  assert.equal(result.rejected[0].evidence.id, "ev-2");
  assert.equal(result.rejected[1].evidence.id, "ev-3");
});
