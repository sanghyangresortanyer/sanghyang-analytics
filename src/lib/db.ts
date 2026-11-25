import { PrismaClient } from "@prisma/client";

export class ProductionWriteBlockedError extends Error {
  code = "PRODUCTION_WRITE_BLOCKED";
  operation: string;
  model?: string;

  constructor(operation: string, model?: string) {
    super(
      `Operasi tulis basis data produksi diblokir: operasi "${operation}" pada model "${
        model ?? "raw"
      }" ditolak karena target adalah basis data produksi dan ALLOW_PRODUCTION_WRITE !== "1".`
    );
    this.name = "ProductionWriteBlockedError";
    this.operation = operation;
    this.model = model;
  }
}

export type DbEnv = Partial<NodeJS.ProcessEnv> | Record<string, string | undefined>;

export function getDatabaseUrl(env: DbEnv = process.env): string {
  let url = env.DATABASE_URL?.trim() || env.DIRECT_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required to initialize Prisma");
  }
  if (!url.includes("connect_timeout=")) {
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}connect_timeout=30`;
  }
  if (!url.includes("pool_timeout=")) {
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}pool_timeout=30`;
  }
  if (!url.includes("connection_limit=")) {
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}connection_limit=5`;
  }
  return url;
}

export function isProductionDatabase(
  url: string,
  marker?: string
): boolean {
  const activeMarker =
    arguments.length > 1 ? marker : process.env.PRODUCTION_DATABASE_MARKER;
  if (!activeMarker || !activeMarker.trim()) {
    return false;
  }
  return url.toLowerCase().includes(activeMarker.trim().toLowerCase());
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Basis data di luar mesin ini. Penanda produksi tidak cukup: `.env.local` (produksi) tidak memuat penanda itu. */
export function isRemoteDatabase(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true; // URL yang tidak terbaca diperlakukan sebagai jarak jauh supaya pengaman gagal tertutup
  }
  return !LOOPBACK_HOSTS.has(host);
}

export function isWriteAllowed(env: DbEnv = process.env): boolean {
  let url = "";
  try {
    url = getDatabaseUrl(env);
  } catch {
    return true; // tanpa URL Prisma gagal sendiri; tidak ada yang bisa ditulis
  }
  const remote = isRemoteDatabase(url) || isProductionDatabase(url, env.PRODUCTION_DATABASE_MARKER);
  if (!remote) return true;
  if (env.ALLOW_PRODUCTION_WRITE === "1") return true;
  // Runtime Vercel dan job CI memang menulis ke basis data produksinya; yang dijaga adalah mesin kerja.
  return env.VERCEL === "1" || env.CI === "true";
}

export function getDatabaseTarget(env: DbEnv = process.env): "lokal" | "produksi" {
  try {
    const url = getDatabaseUrl(env);
    return isRemoteDatabase(url) || isProductionDatabase(url, env.PRODUCTION_DATABASE_MARKER) ? "produksi" : "lokal";
  } catch {
    return "lokal";
  }
}

export function createDatabaseClient(customEnv?: DbEnv): PrismaClient {
  const env = customEnv ?? process.env;
  const datasourceUrl = getDatabaseUrl(env);
  const baseClient = new PrismaClient({
    datasourceUrl,
  });

  const extended = baseClient.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const isWrite =
            operation.startsWith("create") ||
            operation.startsWith("update") ||
            operation.startsWith("delete") ||
            operation.startsWith("upsert");

          const activeEnv = customEnv ?? process.env;
          if (isWrite && !isWriteAllowed(activeEnv)) {
            throw new ProductionWriteBlockedError(operation, model);
          }
          return query(args);
        },
      },
      async $executeRaw({ args, query }) {
        const activeEnv = customEnv ?? process.env;
        if (!isWriteAllowed(activeEnv)) {
          throw new ProductionWriteBlockedError("$executeRaw");
        }
        return query(args);
      },
      async $executeRawUnsafe({ args, query }) {
        const activeEnv = customEnv ?? process.env;
        if (!isWriteAllowed(activeEnv)) {
          throw new ProductionWriteBlockedError("$executeRawUnsafe");
        }
        return query(args);
      },
      async $queryRaw({ args, query }) {
        const activeEnv = customEnv ?? process.env;
        if (!isWriteAllowed(activeEnv)) {
          const sqlText = Array.isArray(args)
            ? String(args[0])
            : typeof args === "string"
            ? args
            : "";
          const trimmed = sqlText.trim().toUpperCase();
          if (
            trimmed.startsWith("INSERT") ||
            trimmed.startsWith("UPDATE") ||
            trimmed.startsWith("DELETE") ||
            trimmed.startsWith("DROP") ||
            trimmed.startsWith("ALTER") ||
            trimmed.startsWith("TRUNCATE")
          ) {
            throw new ProductionWriteBlockedError("$queryRaw (write keyword)");
          }
        }
        return query(args);
      },
    },
  });

  return extended as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { db?: PrismaClient };

let _db: PrismaClient | undefined;

export function getDb(): PrismaClient {
  if (globalForPrisma.db) return globalForPrisma.db;
  if (!_db) {
    _db = createDatabaseClient();
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.db = _db;
    }
  }
  return _db;
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getDb();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});
