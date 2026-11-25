import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

const EXTENSION_ROOT = path.resolve(process.cwd(), "extension/sanghyang-social-sync");
const ZIP_FOLDER_NAME = "sanghyang-social-sync";

/** Allowlist statis berkas ekstensi yang boleh masuk ke paket unduhan (mencegah kebocoran .pem/.env/dotfiles). */
export const ALLOWED_EXTENSION_FILES = [
  "manifest.json",
  "background.js",
  "content-social.js",
  "parsers.js",
  "feed-tap.js",
  "feed-parsers.js",
  "popup.html",
  "popup.js",
  "icons/icon-16.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
] as const;

export interface ExtensionContentScriptRule {
  matches: string[];
  js: string[];
  run_at?: string;
  world?: "ISOLATED" | "MAIN";
}

export interface ExtensionManifestData {
  manifest_version: number;
  name: string;
  version: string;
  key?: string;
  permissions: string[];
  host_permissions: string[];
  content_scripts?: ExtensionContentScriptRule[];
  background?: { service_worker?: string };
  action?: { default_popup?: string };
  externally_connectable?: { matches: string[] };
}

export interface ExtensionManifestInfo {
  manifest: ExtensionManifestData;
  extensionId: string;
}

export function deriveChromeExtensionIdFromPublicKey(base64Spki: string): string {
  const der = Buffer.from(base64Spki.trim(), "base64");
  const hex = crypto.createHash("sha256").update(der).digest("hex").slice(0, 32);
  let out = "";
  for (const ch of hex) {
    const nibble = Number.parseInt(ch, 16);
    out += String.fromCharCode(97 + nibble);
  }
  return out;
}

export function loadExtensionManifestInfo(): ExtensionManifestInfo {
  const manifestPath = path.join(EXTENSION_ROOT, "manifest.json");
  const raw = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as ExtensionManifestData;
  if (!manifest.key || !manifest.key.trim()) {
    throw new Error("manifest.json ekstensi tidak memuat public key terpin.");
  }
  return {
    manifest,
    extensionId: deriveChromeExtensionIdFromPublicKey(manifest.key),
  };
}

export function assertSafeRelativePath(relPath: string): void {
  if (
    !relPath ||
    relPath.startsWith("/") ||
    relPath.includes("\\") ||
    relPath.split("/").some((seg) => !seg || seg === "." || seg === ".." || seg.startsWith("."))
  ) {
    throw new Error(`Jalur berkas ekstensi tidak aman: ${relPath}`);
  }
}

/**
 * Memverifikasi bahwa setiap berkas JS/HTML yang dirujuk oleh manifest.json terdaftar di allowlist ZIP,
 * ada di disk, bebas UTF-8 BOM, dan tidak kosong (mencegah galat Chrome "Could not load file: 'parsers.js'").
 */
export function validateManifestReferencedFiles(manifest: ExtensionManifestData): void {
  const allowSet = new Set<string>(ALLOWED_EXTENSION_FILES);
  const referenced = new Set<string>([
    "manifest.json",
    "parsers.js",
    "feed-tap.js",
    "feed-parsers.js",
    "content-social.js",
    "background.js",
  ]);
  if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);
  if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup);
  for (const cs of manifest.content_scripts ?? []) {
    for (const jsFile of cs.js ?? []) referenced.add(jsFile);
  }

  for (const relPath of referenced) {
    assertSafeRelativePath(relPath);
    if (!allowSet.has(relPath)) {
      throw new Error(`Berkas '${relPath}' dirujuk di manifest.json tetapi belum masuk ALLOWED_EXTENSION_FILES.`);
    }
    const fullPath = path.join(EXTENSION_ROOT, relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Berkas ekstensi '${relPath}' tidak ditemukan di ${EXTENSION_ROOT}.`);
    }
    const bytes = fs.readFileSync(fullPath);
    if (bytes.length === 0) {
      throw new Error(`Berkas ekstensi '${relPath}' kosong (0 byte).`);
    }
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new Error(`Berkas ekstensi '${relPath}' memuat UTF-8 BOM yang dapat ditolak pemuat skrip Chrome.`);
    }
  }
}

export interface BuiltExtensionZip {
  buffer: Buffer;
  sha256: string;
  version: string;
  extensionId: string;
  filename: string;
  files: { name: string; size: number }[];
}

/**
 * Mengurai kembali isi PKZIP hasil buildExtensionZipArchive untuk verifikasi integritas bit-per-bit.
 */
export function extractExtensionZipEntries(zipBuffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let pos = 0;
  while (pos + 4 <= zipBuffer.length) {
    const sig = zipBuffer.readUInt32LE(pos);
    if (sig !== 0x04034b50) break; // Berhenti saat mencapai Central Directory (0x02014b50)
    const method = zipBuffer.readUInt16LE(pos + 8);
    const expectedCrc = zipBuffer.readUInt32LE(pos + 14);
    const compressedSize = zipBuffer.readUInt32LE(pos + 18);
    const uncompressedSize = zipBuffer.readUInt32LE(pos + 22);
    const nameLen = zipBuffer.readUInt16LE(pos + 26);
    const extraLen = zipBuffer.readUInt16LE(pos + 28);
    const nameStart = pos + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = zipBuffer.subarray(nameStart, nameStart + nameLen).toString("utf8");
    const rawPayload = zipBuffer.subarray(dataStart, dataStart + compressedSize);
    const content = method === 8 ? zlib.inflateRawSync(rawPayload) : Buffer.from(rawPayload);
    if (content.length !== uncompressedSize) {
      throw new Error(`Ukuran dekompresi '${name}' tidak cocok (${content.length} vs ${uncompressedSize}).`);
    }
    const actualCrc = zlib.crc32(content) >>> 0;
    if (actualCrc !== expectedCrc) {
      throw new Error(`CRC32 '${name}' rusak di dalam ZIP.`);
    }
    entries.set(name, content);
    pos = dataStart + compressedSize;
  }
  return entries;
}

/**
 * Merakit arsip PKZIP standar (deflate/store) murni lewat node:zlib tanpa shell exec
 * agar kompatibel di Vercel Serverless, Ubuntu Linux, maupun Windows Explorer Extract All.
 */
export function buildExtensionZipArchive(): BuiltExtensionZip {
  const { manifest, extensionId } = loadExtensionManifestInfo();
  validateManifestReferencedFiles(manifest);

  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  const fileList: { name: string; size: number }[] = [];
  let offset = 0;

  // DOS time/date stabil agar checksum arsip deterministik untuk isi berkas yang sama.
  const dosTime = 0x0000;
  const dosDate = 0x5972;

  for (const relPath of ALLOWED_EXTENSION_FILES) {
    assertSafeRelativePath(relPath);
    const fullPath = path.join(EXTENSION_ROOT, relPath);
    const stat = fs.lstatSync(fullPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Berkas ekstensi bukan file reguler: ${relPath}`);
    }

    const rawBytes = fs.readFileSync(fullPath);
    const compressed = zlib.deflateRawSync(rawBytes, { level: 9 });
    const useDeflate = compressed.length < rawBytes.length;
    const payload = useDeflate ? compressed : rawBytes;
    const method = useDeflate ? 8 : 0;
    const crc = zlib.crc32(rawBytes) >>> 0;
    const zipEntryName = `${ZIP_FOLDER_NAME}/${relPath}`;
    const nameBytes = Buffer.from(zipEntryName, "utf8");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawBytes.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x031e, 4); // Unix + PKZIP 3.0
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawBytes.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localChunks.push(localHeader, nameBytes, payload);
    centralChunks.push(centralHeader, nameBytes);
    fileList.push({ name: zipEntryName, size: rawBytes.length });
    offset += localHeader.length + nameBytes.length + payload.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(fileList.length, 8);
  eocd.writeUInt16LE(fileList.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const buffer = Buffer.concat([...localChunks, centralDir, eocd]);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  return {
    buffer,
    sha256,
    version: manifest.version,
    extensionId,
    filename: `sanghyang-social-sync-v${manifest.version}.zip`,
    files: fileList,
  };
}
