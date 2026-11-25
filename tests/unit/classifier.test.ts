import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isMarketRelevant,
  fallbackClassification,
  detectLocation,
  isExpiredEvent,
  cleanTitleForDedupe,
  titleSimilarity,
  isDuplicateArticleTitle,
  type ClassifierInput,
} from "../../src/lib/market/classifier";

test("D7 - Evaluasi Presisi pada Dataset Berlabel Artikel Asli", () => {
  const fixturePath = path.resolve(process.cwd(), "tests/fixtures/news-eval-dataset.json");
  assert.ok(fs.existsSync(fixturePath), "Fixture evaluasi news-eval-dataset.json wajib ada");

  const raw = fs.readFileSync(fixturePath, "utf-8");
  const dataset = JSON.parse(raw) as {
    items: Array<{
      id: string;
      title: string;
      text: string;
      publishedAt: string;
      expectedCategory: string;
      expectedRelevant: boolean;
      expectedLocation: string;
      locationTier: string;
      isExpired?: boolean;
    }>;
  };

  assert.ok(dataset.items.length >= 50, `Jumlah dataset evaluasi harus representatif (aktual: ${dataset.items.length})`);

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let categoryMatches = 0;

  for (const item of dataset.items) {
    const isRel = isMarketRelevant(item);
    const classification = fallbackClassification(item);

    if (item.expectedRelevant) {
      if (isRel) {
        tp++;
      } else {
        fn++;
      }

      if (classification.category === item.expectedCategory) {
        categoryMatches++;
      }
    } else {
      if (isRel) {
        fp++;
      } else {
        tn++;
      }
    }
  }

  const precision = tp / (tp + fp);
  const recall = tp / (tp + fn);
  const f1 = (2 * precision * recall) / (precision + recall);
  const categoryPrecision = categoryMatches / tp;

  console.log("\n--- HASIL EVALUASI DATASET ASLI (D7) ---");
  console.log(`Total Artikel Evaluasi: ${dataset.items.length}`);
  console.log(`True Positives (TP):     ${tp}`);
  console.log(`False Positives (FP):    ${fp}`);
  console.log(`False Negatives (FN):    ${fn}`);
  console.log(`True Negatives (TN):     ${tn}`);
  console.log(`Relevance Precision:     ${(precision * 100).toFixed(2)}%`);
  console.log(`Relevance Recall:        ${(recall * 100).toFixed(2)}%`);
  console.log(`Relevance F1-Score:      ${(f1 * 100).toFixed(2)}%`);
  console.log(`Category Precision:      ${(categoryPrecision * 100).toFixed(2)}% (${categoryMatches}/${tp})`);

  // Target Definisi Selesai: Presisi klasifikasi pada set evaluasi >= 0.8
  assert.ok(precision >= 0.8, `Presisi relevansi wajib >= 0.8 (aktual: ${precision})`);
  assert.ok(categoryPrecision >= 0.8, `Presisi kategori wajib >= 0.8 (aktual: ${categoryPrecision})`);
  assert.equal(fp, 0, "False positive harus dieliminasi penuh (0 FP)");
});

test("D7 - Eliminasi False-Positive (Kasus Spesifik yang Ditemukan Audit)", () => {
  const noiseCases: ClassifierInput[] = [
    {
      title: "Lepas Kontingen Porprov Banten VII 2026, Sachrudin Siapkan Bonus Emas Rp50 Juta - Banten Ekspres",
      text: "Wali Kota melepas kontingen atlet Porprov dengan bonus emas puluhan juta.",
    },
    {
      title: "Banten Peringkat 2 PHK Nasional, Wagub Dimyati: Miris, Banyak Industri Tapi PHK Tinggi - Faktabanten.co.id",
      text: "Tingginya pemutusan hubungan kerja di industri manufaktur garmen dan tekstil.",
    },
    {
      title: "Pemkot Serang Buka 245 Formasi PPPK Teknis dan Kesehatan - BantenNews.co.id",
      text: "Penerimaan pegawai pemerintah dengan perjanjian kerja bagi tenaga honorer.",
    },
    {
      title: "Diduga Kongkalikong Peltek PSU Perkim Banten dengan Cv Ra Za Mainaki Menutupi Kesalahan Dalam Pengerjaan U-ditch di Tejamari",
      text: "Dugaan korupsi pengerjaan saluran drainase dan gorong-gorong perumahan permukiman.",
    },
    {
      title: "Uji Coba Makan Bergizi Gratis di SDN Sukmajaya I, Pemkot Cilegon Beri Apresiasi Hotel Aston - Berita Cilegon",
      text: "Simulasi makan siang bergizi bagi murid sekolah dasar negeri.",
    },
    {
      title: "Hotel Regent Cilegon Diduga Jadi tempat Esek-esek, Warga Lokal Resah - Faktabanten.co.id",
      text: "Penggerebekan kamar hotel melati terkait dugaan prostitusi online.",
    },
    {
      title: "Pemuda Bunuh Mantan Istri di Hotel Cirebon: Kecemburuan Mantan - harian.disway.id",
      text: "Kasus pembunuhan di hotel kawasan Jawa Barat akibat cekcok asmara.",
    },
    {
      title: "Saksi Mangkir, Sidang Mantan Direktur Hotel Rahaya Resort di Lebak Ditunda - BantenNews.co.id",
      text: "Sidang perkara tindak pidana korupsi aset daerah ditunda majelis hakim tipikor.",
    },
  ];

  for (const c of noiseCases) {
    const isRel = isMarketRelevant(c);
    const classification = fallbackClassification(c);

    assert.equal(isRel, false, `Artikel noise tidak boleh relevan: "${c.title}"`);
    assert.equal(classification.relevanceScore, 0, `Skor relevansi artikel noise harus 0: "${c.title}"`);
    assert.notEqual(classification.kind, "fnb", `Artikel noise tidak boleh masuk FnB: "${c.title}"`);
  }
});

test("D7 - Perhitungan Relevansi Geografis Koridor Anyer-Carita-Cinangka Secara Proporsional", () => {
  const coreInput: ClassifierInput = {
    title: "Okupansi Hotel di Kawasan Anyer Rebound 85 Persen",
    text: "Tingkat hunian kamar hotel di pesisir Anyer meningkat drastis.",
  };
  const bufferInput: ClassifierInput = {
    title: "Okupansi Hotel di Kawasan Cilegon Rebound 85 Persen",
    text: "Tingkat hunian kamar hotel di kawasan industri Cilegon meningkat drastis.",
  };
  const regionalInput: ClassifierInput = {
    title: "Okupansi Hotel di Provinsi Banten Rebound 85 Persen",
    text: "Tingkat hunian kamar hotel di wilayah Banten meningkat drastis.",
  };

  const locCore = detectLocation(coreInput);
  const locBuffer = detectLocation(bufferInput);
  const locRegional = detectLocation(regionalInput);

  assert.equal(locCore.tier, "core", "Anyer harus dideteksi sebagai core corridor");
  assert.equal(locBuffer.tier, "buffer", "Cilegon harus dideteksi sebagai secondary buffer");
  assert.equal(locRegional.tier, "regional", "Banten harus dideteksi sebagai regional");

  const scoreCore = fallbackClassification(coreInput).relevanceScore;
  const scoreBuffer = fallbackClassification(bufferInput).relevanceScore;
  const scoreRegional = fallbackClassification(regionalInput).relevanceScore;

  assert.ok(scoreCore > scoreBuffer, `Skor Core Anyer (${scoreCore}) harus lebih tinggi dari Buffer Cilegon (${scoreBuffer})`);
  assert.ok(scoreBuffer > scoreRegional, `Skor Buffer Cilegon (${scoreBuffer}) harus lebih tinggi dari Regional Banten (${scoreRegional})`);
});

test("D7 - Perhitungan relevanceScore Dinamis (Bukan Default 50)", () => {
  const articles: ClassifierInput[] = [
    {
      title: "Aston Anyer Beach Hotel Hadirkan Promo Sunset Dinner Romantis Pesisir Banten",
      text: "Aston Anyer meluncurkan paket menginap akhir pekan dan promo makan malam tepi pantai.",
      publishedAt: new Date("2026-11-10"),
    },
    {
      title: "Gipang, Rabeg, dan Sate Bebek Cibeber Akan di Branding Makanan Khas Cilegon",
      text: "Dinas Koperasi dan UKM mempromosikan sate bebek kuliner khas Cilegon.",
      publishedAt: new Date("2026-10-01"),
    },
    {
      title: "Tol Serang-Panimbang Ditargetkan Gratis Saat Nataru 2026",
      text: "Kementerian PUPR menyiapkan fungsionalitas Tol Serang Panimbang seksi 3A.",
      publishedAt: new Date("2026-09-28"),
    },
    {
      title: "Sensasi Kuliner Rabeg dan Sate Bandeng Khas Banten yang Wajib Dicoba Wisatawan",
      text: "Wisatawan yang berlibur ke Serang dan Anyer direkomendasikan mencicipi sate bandeng.",
      publishedAt: new Date("2026-08-15"),
    },
    {
      title: "Porprov Banten 2026 Libatkan 9.000 Peserta di Tangsel",
      text: "Pekan olahraga provinsi Banten di Tangerang Selatan.",
      publishedAt: new Date("2026-11-01"),
    },
  ];

  const scores = articles.map((a) => fallbackClassification(a).relevanceScore);

  console.log("\nSkor Relevansi Dinamis Aktual:", scores);

  // Verifikasi skor tidak seragam/konstan 50
  const uniqueScores = new Set(scores);
  assert.ok(uniqueScores.size >= 4, `Skor relevansi harus bervariasi dinamis (aktual ${uniqueScores.size} variasi unik: ${[...uniqueScores].join(", ")})`);

  // Artikel utama koridor Anyer hotel harus mendapat skor tinggi (>= 75)
  assert.ok(scores[0] >= 75, `Artikel hotel Anyer harus berskor tinggi (aktual: ${scores[0]})`);

  // Artikel noise harus bernilai 0
  assert.equal(scores[4], 0, "Artikel noise wajib bernilai 0");
});

test("D7 - Saringan Tanggal Event Kedaluwarsa (Expired Events)", () => {
  const pastEvent2024: ClassifierInput = {
    title: "Festival Budaya Pesisir Anyer 2024 Sukses Tarik Ribuan Wisatawan",
    text: "Pentas seni debus dan lomba perahu dayung Anyer tahun 2024 telah berakhir dengan penyerahan piala.",
    publishedAt: "2024-08-15T00:00:00.000Z",
  };
  const pastEvent2025: ClassifierInput = {
    title: "Perayaan Malam Tahun Baru 2025 di Pantai Anyer Berlangsung Meriah",
    text: "Pesta kembang api pergantian malam tahun baru 2025 di pesisir Anyer dipadati pelancong.",
    publishedAt: "2025-01-01T00:00:00.000Z",
  };
  const currentEvent2026: ClassifierInput = {
    title: "Anyer Krakatau Culture Festival Siap Digelar November 2026 Menampilkan Musik dan Parade Budaya",
    text: "Pemkab Serang mematangkan persiapan event tahunan Anyer Krakatau Culture Festival.",
    publishedAt: "2026-10-14T00:00:00.000Z",
  };

  assert.equal(isExpiredEvent(pastEvent2024), true, "Event 2024 harus terdeteksi kedaluwarsa");
  assert.equal(isExpiredEvent(pastEvent2025), true, "Event 2025 harus terdeteksi kedaluwarsa");
  assert.equal(isExpiredEvent(currentEvent2026), false, "Event 2026 aktif tidak boleh kedaluwarsa");

  assert.equal(isMarketRelevant(pastEvent2024), false, "Event kedaluwarsa tidak boleh dianggap relevan");
  assert.equal(isMarketRelevant(currentEvent2026), true, "Event 2026 aktif harus relevan");

  const classifiedPast = fallbackClassification(pastEvent2024);
  assert.equal(classifiedPast.isExpired, true, "Tag isExpired harus true pada event kedaluwarsa");
  assert.equal(classifiedPast.relevanceScore, 0, "Skor event kedaluwarsa harus 0");
});

test("D7 - Deduplikasi Judul dan Kemiripan Antar Sumber Berita", () => {
  const titleA = "Okupansi Hotel Anyer-Cinangka Anjlok 80 Persen, DPRD Serang Dorong Pemulihan Pariwisata - Faktabanten.co.id";
  const titleB = "Okupansi Hotel Anjlok 80 Persen, DPRD Kabupaten Serang Dorong Pemulihan Pariwisata Anyer-Cinangka - Ekbisbanten";
  const titleC = "Cafe Estetik Tepi Pantai Anyer Rasa Seminyak: Live Music & Beanbag";

  const cleanA = cleanTitleForDedupe(titleA);
  const cleanB = cleanTitleForDedupe(titleB);

  assert.ok(!cleanA.includes("faktabanten"), "Pembersihan judul harus membuang nama media");
  assert.ok(!cleanB.includes("ekbisbanten"), "Pembersihan judul harus membuang nama media");

  const similarityAB = titleSimilarity(titleA, titleB);
  const similarityAC = titleSimilarity(titleA, titleC);

  console.log(`\nKemiripan A vs B (sindikasi berita yang sama): ${(similarityAB * 100).toFixed(1)}%`);
  console.log(`Kemiripan A vs C (berita berbeda topik):       ${(similarityAC * 100).toFixed(1)}%`);

  assert.ok(similarityAB >= 0.7, `Kemiripan judul berita sindikasi harus >= 0.7 (aktual: ${similarityAB})`);
  assert.ok(similarityAC < 0.3, `Kemiripan berita berbeda topik harus < 0.3 (aktual: ${similarityAC})`);

  assert.equal(isDuplicateArticleTitle(titleA, titleB, 0.7), true, "Judul sindikasi harus terdeteksi duplikat");
  assert.equal(isDuplicateArticleTitle(titleA, titleC, 0.7), false, "Judul berbeda tidak boleh terdeteksi duplikat");
});
