/**
 * Pengelola login & kredensial GitHub khusus tingkat proyek (project-scoped).
 *
 * Mengisolasi helper kredensial Git agar tidak membaca atau menimpa ~/.gitconfig
 * maupun ~/.git-credentials milik proyek lain. Token disimpan hanya di
 * .git/.git-credentials (izin 0600) setelah diverifikasi ke GitHub API.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_API_BASE = "https://api.github.com";

export function normalizeTokenInput(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/^["']|["']$/g, "").trim();
}

export function parseGitHubRepo(remoteUrl) {
  if (!remoteUrl || typeof remoteUrl !== "string") return null;
  const trimmed = remoteUrl.trim();
  const httpsMatch = /^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  const sshMatch = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}

export function resolveCommitIdentity(userProfile, emails = []) {
  const login = String(userProfile?.login || "").trim();
  const displayName = String(userProfile?.name || "").trim() || login;
  const list = Array.isArray(emails) ? emails : [];
  const primaryVerified = list.find((item) => item?.primary && item?.verified && item?.email);
  if (primaryVerified) {
    return {
      name: displayName,
      email: String(primaryVerified.email).trim(),
      emailSource: "primary-verified",
    };
  }
  const anyVerified = list.find((item) => item?.verified && item?.email);
  if (anyVerified) {
    return {
      name: displayName,
      email: String(anyVerified.email).trim(),
      emailSource: "verified",
    };
  }
  const profileEmail = String(userProfile?.email || "").trim();
  if (profileEmail) {
    return {
      name: displayName,
      email: profileEmail,
      emailSource: "profile",
    };
  }
  const idPart = userProfile?.id ? `${userProfile.id}+` : "";
  return {
    name: displayName,
    email: `${idPart}${login}@users.noreply.github.com`,
    emailSource: "github-noreply",
  };
}

export function buildProjectCredentialHelpers(credFile) {
  return ["", `store --file=${credFile}`];
}

function runGit(repoDir, args, opts = {}) {
  return execFileSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    ...opts,
  });
}

function resolveGitPaths(startDir = process.cwd()) {
  const topLevel = runGit(startDir, ["rev-parse", "--show-toplevel"]).trim();
  const gitDirRaw = runGit(topLevel, ["rev-parse", "--git-dir"]).trim();
  const gitDir = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.resolve(topLevel, gitDirRaw);
  const credFile = path.join(gitDir, ".git-credentials");
  return { repoDir: topLevel, gitDir, credFile };
}

function ensurePrivateFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "", { mode: 0o600 });
  }
  fs.chmodSync(filePath, 0o600);
}

export function configureProjectCredentialIsolation(repoDir, credFile) {
  ensurePrivateFile(credFile);
  const unsetRes = spawnSync("git", ["-C", repoDir, "config", "--local", "--unset-all", "credential.helper"], {
    encoding: "utf8",
  });
  // Exit code 5 berarti key belum ada di .git/config — kondisi awal yang normal.
  if (unsetRes.status !== 0 && unsetRes.status !== 5) {
    throw new Error(`Gagal mereset credential.helper lokal: ${unsetRes.stderr || unsetRes.status}`);
  }
  for (const value of buildProjectCredentialHelpers(credFile)) {
    runGit(repoDir, ["config", "--local", "--add", "credential.helper", value]);
  }
}

export function storeProjectCredential(credFile, username, token) {
  ensurePrivateFile(credFile);
  clearProjectCredential(credFile);
  const payload = `protocol=https\nhost=github.com\nusername=${username}\npassword=${token}\n\n`;
  execFileSync("git", ["credential-store", `--file=${credFile}`, "store"], {
    input: payload,
    encoding: "utf8",
  });
  fs.chmodSync(credFile, 0o600);
}

export function clearProjectCredential(credFile) {
  if (!fs.existsSync(credFile)) return;
  const payload = "protocol=https\nhost=github.com\n\n";
  execFileSync("git", ["credential-store", `--file=${credFile}`, "erase"], {
    input: payload,
    encoding: "utf8",
  });
  fs.chmodSync(credFile, 0o600);
}

export function readStoredCredential(repoDir, extraEnv = {}) {
  const res = spawnSync("git", ["-C", repoDir, "credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnv,
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (res.status !== 0) {
    return { found: false, username: null, token: null };
  }
  const fields = new Map();
  for (const line of res.stdout.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx > 0) {
      fields.set(line.slice(0, idx), line.slice(idx + 1));
    }
  }
  const username = fields.get("username") || null;
  const token = fields.get("password") || null;
  return {
    found: Boolean(username && token),
    username,
    token,
  };
}

function getLocalConfig(repoDir, key) {
  const res = spawnSync("git", ["-C", repoDir, "config", "--local", "--get", key], {
    encoding: "utf8",
  });
  return res.status === 0 ? res.stdout.trim() : "";
}

function getLocalConfigAll(repoDir, key) {
  const res = spawnSync("git", ["-C", repoDir, "config", "--local", "--get-all", key], {
    encoding: "utf8",
  });
  if (res.status !== 0) return [];
  const trimmedEnd = res.stdout.replace(/\r?\n$/, "");
  if (trimmedEnd === "") return [""];
  return trimmedEnd.split(/\r?\n/).map((line) => line.replace(/\r$/, ""));
}

async function fetchGitHubJson(apiBase, apiPath, token) {
  const res = await fetch(`${apiBase}${apiPath}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "sanghyang-analytics",
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

export async function verifyTokenAndIdentity(apiBase, parsedRepo, token, allowReadOnly = false) {
  const userRes = await fetchGitHubJson(apiBase, "/user", token);
  if (!userRes.ok || !userRes.body?.login) {
    throw new Error(`Token ditolak GitHub API /user (HTTP ${userRes.status}: ${userRes.body?.message || "unauthorized"})`);
  }

  const repoRes = await fetchGitHubJson(apiBase, `/repos/${parsedRepo.owner}/${parsedRepo.repo}`, token);
  if (!repoRes.ok) {
    throw new Error(
      `Akun ${userRes.body.login} tidak dapat mengakses repo ${parsedRepo.owner}/${parsedRepo.repo} (HTTP ${repoRes.status}: ${repoRes.body?.message || "not found / forbidden"})`
    );
  }
  const canPush = Boolean(repoRes.body?.permissions?.push);
  if (!canPush && !allowReadOnly) {
    throw new Error(
      `Akun ${userRes.body.login} belum memiliki izin push ke ${parsedRepo.owner}/${parsedRepo.repo}. Pastikan akun punya akses tulis dan token memiliki izin Contents: Read and write / scope repo.`
    );
  }

  const emailsRes = await fetchGitHubJson(apiBase, "/user/emails", token);
  let emails = [];
  if (emailsRes.ok && Array.isArray(emailsRes.body)) {
    emails = emailsRes.body;
  } else if (emailsRes.status !== 403 && emailsRes.status !== 404) {
    // Fine-grained PAT sering tidak memiliki izin membaca /user/emails (403/404), sehingga fallback ke email profil / noreply.
    throw new Error(`Gagal membaca /user/emails (HTTP ${emailsRes.status})`);
  }

  return {
    login: userRes.body.login,
    canPush,
    identity: resolveCommitIdentity(userRes.body, emails),
  };
}

async function promptSecretToken(promptLabel) {
  if (!process.stdin.isTTY) {
    return normalizeTokenInput(fs.readFileSync(0, "utf8"));
  }
  let muted = false;
  const mutableStdout = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) {
        process.stdout.write(chunk, encoding);
      }
      callback();
    },
  });
  process.stdout.write(promptLabel);
  muted = true;
  const rl = readline.createInterface({
    input: process.stdin,
    output: mutableStdout,
    terminal: true,
  });
  try {
    const answer = await new Promise((resolve, reject) => {
      rl.once("SIGINT", () => {
        process.stdout.write("\n");
        reject(new Error("Login dibatalkan (SIGINT)."));
      });
      rl.question("", (val) => resolve(val));
    });
    process.stdout.write("\n");
    return normalizeTokenInput(String(answer || ""));
  } finally {
    rl.close();
  }
}

export function isProjectCredentialIsolated(repoDir, credFile) {
  const helpers = getLocalConfigAll(repoDir, "credential.helper");
  const expected = buildProjectCredentialHelpers(credFile);
  return helpers.length === 2 && helpers[0] === expected[0] && helpers[1] === expected[1];
}

async function handleStatus(repoDir, credFile, apiBase) {
  const helpers = getLocalConfigAll(repoDir, "credential.helper");
  const isolated = isProjectCredentialIsolated(repoDir, credFile);
  const remoteUrl = getLocalConfig(repoDir, "remote.origin.url");
  const parsedRepo = parseGitHubRepo(remoteUrl);
  const userName = getLocalConfig(repoDir, "user.name");
  const userEmail = getLocalConfig(repoDir, "user.email");
  const cred = readStoredCredential(repoDir);

  console.log("--- STATUS KONEKSI GITHUB TINGKAT PROYEK ---");
  console.log("Direktori proyek :", repoDir);
  console.log("Isolasi helper   :", isolated ? `AKTIF (${credFile})` : `BELUM TERISOLASI (${JSON.stringify(helpers)})`);
  console.log("Remote origin    :", remoteUrl || "(kosong)");
  console.log("Git user.name    :", userName || "(belum disetel — akan terisi saat login)");
  console.log("Git user.email   :", userEmail || "(belum disetel — akan terisi saat login)");
  console.log("Sesi token lokal :", cred.found ? `TERSIMPAN (akun: ${cred.username})` : "BELUM LOGIN");

  if (!cred.found) {
    console.log("\nJalankan `node scripts/ops/github-login.mjs` untuk masuk dengan Personal Access Token GitHub.");
    return;
  }

  const userRes = await fetchGitHubJson(apiBase, "/user", cred.token);
  if (!userRes.ok) {
    console.log(`Verifikasi token : GAGAL (HTTP ${userRes.status}: ${userRes.body?.message || "token ditolak"})`);
    process.exitCode = 1;
    return;
  }
  console.log(`Verifikasi token : VALID (login: ${userRes.body.login})`);

  if (parsedRepo) {
    const repoRes = await fetchGitHubJson(apiBase, `/repos/${parsedRepo.owner}/${parsedRepo.repo}`, cred.token);
    if (!repoRes.ok) {
      console.log(`Akses repo       : GAGAL ke ${parsedRepo.owner}/${parsedRepo.repo} (HTTP ${repoRes.status})`);
      process.exitCode = 1;
      return;
    }
    const canPush = Boolean(repoRes.body?.permissions?.push);
    console.log(`Akses repo       : ${parsedRepo.owner}/${parsedRepo.repo} (push: ${canPush ? "YA" : "TIDAK"})`);
    if (!canPush) {
      process.exitCode = 1;
      return;
    }
  }

  const lsRemote = spawnSync("git", ["-C", repoDir, "ls-remote", "--heads", "origin"], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (lsRemote.status === 0) {
    console.log("Uji handshake    : TERHUBUNG (git ls-remote origin berhasil)");
  } else {
    console.log(`Uji handshake    : GAGAL (${lsRemote.stderr.trim() || `exit ${lsRemote.status}`})`);
    process.exitCode = 1;
  }
}

async function handleLogin(repoDir, credFile, apiBase, allowReadOnly) {
  configureProjectCredentialIsolation(repoDir, credFile);

  const remoteUrl = getLocalConfig(repoDir, "remote.origin.url");
  const parsedRepo = parseGitHubRepo(remoteUrl);
  if (!parsedRepo) {
    throw new Error(`Remote origin bukan URL GitHub yang dikenali: "${remoteUrl}"`);
  }

  console.log("Login GitHub Khusus Proyek:", `${parsedRepo.owner}/${parsedRepo.repo}`);
  console.log("Kredensial hanya disimpan lokal di:", credFile);
  console.log("Konfigurasi user (~/.gitconfig & ~/.git-credentials) tidak disentuh.\n");
  console.log("Kebutuhan izin Personal Access Token (PAT):");
  console.log("- Fine-grained PAT: akses ke repo tersebut dengan Contents = Read and write");
  console.log("- Classic PAT     : scope repo (dan workflow bila mengubah .github/workflows/)\n");

  const token = await promptSecretToken("Masukkan GitHub Personal Access Token (input tersembunyi): ");
  if (!token) {
    throw new Error("Token kosong. Login dibatalkan.");
  }

  const verified = await verifyTokenAndIdentity(apiBase, parsedRepo, token, allowReadOnly);
  storeProjectCredential(credFile, verified.login, token);
  runGit(repoDir, ["config", "--local", "user.name", verified.identity.name]);
  runGit(repoDir, ["config", "--local", "user.email", verified.identity.email]);

  const lsRemote = spawnSync("git", ["-C", repoDir, "ls-remote", "--heads", "origin"], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (lsRemote.status !== 0) {
    clearProjectCredential(credFile);
    throw new Error(`Verifikasi git ls-remote origin gagal: ${lsRemote.stderr.trim() || `exit ${lsRemote.status}`}`);
  }

  console.log("\n--- LOGIN GITHUB PROYEK BERHASIL ---");
  console.log("Akun GitHub      :", verified.login);
  console.log("Target repo      :", `${parsedRepo.owner}/${parsedRepo.repo} (push: ${verified.canPush ? "YA" : "TIDAK"})`);
  console.log("Git user.name    :", verified.identity.name);
  console.log("Git user.email   :", `${verified.identity.email} (${verified.identity.emailSource})`);
  console.log("Berkas kredensial:", credFile);
  console.log("\nAnda sekarang bisa menjalankan `git status`, `git add`, `git commit`, dan `git push`.");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apiBase = (process.env.GITHUB_API_URL || DEFAULT_API_BASE).replace(/\/+$/, "");
  const { repoDir, credFile } = resolveGitPaths(process.cwd());

  if (args.has("--status")) {
    await handleStatus(repoDir, credFile, apiBase);
    return;
  }
  if (args.has("--logout")) {
    clearProjectCredential(credFile);
    console.log("Kredensial GitHub khusus proyek ini telah dihapus dari:", credFile);
    return;
  }
  await handleLogin(repoDir, credFile, apiBase, args.has("--allow-read-only"));
}

const isDirectEntry =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectEntry) {
  main().catch((err) => {
    console.error("Gagal:", err.message);
    process.exit(1);
  });
}
