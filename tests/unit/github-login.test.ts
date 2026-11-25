import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildProjectCredentialHelpers,
  clearProjectCredential,
  configureProjectCredentialIsolation,
  isProjectCredentialIsolated,
  normalizeTokenInput,
  parseGitHubRepo,
  readStoredCredential,
  resolveCommitIdentity,
  storeProjectCredential,
  verifyTokenAndIdentity,
} from "../../scripts/ops/github-login.mjs";

test("normalizeTokenInput: membersihkan spasi, baris baru, dan tanda kutip yang menempel", () => {
  assert.equal(normalizeTokenInput('  "ghp_abc123" \n'), "ghp_abc123");
  assert.equal(normalizeTokenInput(" 'github_pat_xyz' "), "github_pat_xyz");
  assert.equal(normalizeTokenInput("   "), "");
});

test("parseGitHubRepo: mengurai URL HTTPS dan SSH GitHub dengan benar", () => {
  assert.deepEqual(parseGitHubRepo("https://github.com/monauli/sanghyang-news.git"), {
    owner: "monauli",
    repo: "sanghyang-news",
  });
  assert.deepEqual(parseGitHubRepo("https://github.com/monauli/sanghyang-news"), {
    owner: "monauli",
    repo: "sanghyang-news",
  });
  assert.deepEqual(parseGitHubRepo("git@github.com:monauli/sanghyang-news.git"), {
    owner: "monauli",
    repo: "sanghyang-news",
  });
  assert.equal(parseGitHubRepo("https://gitlab.com/org/repo.git"), null);
  assert.equal(parseGitHubRepo(""), null);
});

test("resolveCommitIdentity: memilih email utama terverifikasi lalu fallback noreply resmi GitHub", () => {
  const withPrimary = resolveCommitIdentity(
    { id: 42, login: "staf-sanghyang", name: "Staf Sanghyang", email: "public@example.com" },
    [
      { email: "alt@example.com", primary: false, verified: true },
      { email: "primary@example.com", primary: true, verified: true },
    ]
  );
  assert.deepEqual(withPrimary, {
    name: "Staf Sanghyang",
    email: "primary@example.com",
    emailSource: "primary-verified",
  });

  const withProfileEmail = resolveCommitIdentity(
    { id: 42, login: "staf-sanghyang", name: "", email: "public@example.com" },
    []
  );
  assert.deepEqual(withProfileEmail, {
    name: "staf-sanghyang",
    email: "public@example.com",
    emailSource: "profile",
  });

  const withNoreply = resolveCommitIdentity(
    { id: 98765, login: "staf-sanghyang", name: null, email: null },
    [{ email: "unverified@example.com", primary: true, verified: false }]
  );
  assert.deepEqual(withNoreply, {
    name: "staf-sanghyang",
    email: "98765+staf-sanghyang@users.noreply.github.com",
    emailSource: "github-noreply",
  });
});

test("isolasi kredensial proyek: mengabaikan global helper=store dan hanya membaca/menulis .git/.git-credentials", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sanghyang-git-iso-"));
  const repoDir = path.join(tmpRoot, "repo");
  const globalConfig = path.join(tmpRoot, "global.gitconfig");
  const globalCreds = path.join(tmpRoot, "global.git-credentials");

  try {
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(
      globalCreds,
      "https://akun-lain:token-proyek-lain@github.com\n",
      { mode: 0o600 }
    );
    fs.writeFileSync(
      globalConfig,
      `[credential]\n\thelper = store --file=${globalCreds}\n`
    );

    execFileSync("git", ["init", repoDir], { stdio: "ignore" });
    const gitDir = path.join(repoDir, ".git");
    const localCreds = path.join(gitDir, ".git-credentials");

    assert.deepEqual(buildProjectCredentialHelpers(localCreds), [
      "",
      `store --file=${localCreds}`,
    ]);

    configureProjectCredentialIsolation(repoDir, localCreds);
    assert.equal(isProjectCredentialIsolated(repoDir, localCreds), true);

    const env = {
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_SYSTEM: "/dev/null",
    };

    // Sebelum login proyek: global.git-credentials TIDAK boleh bocor ke repo ini
    const beforeCred = readStoredCredential(repoDir, env);
    assert.deepEqual(beforeCred, { found: false, username: null, token: null });

    // Simpan kredensial proyek ke .git/.git-credentials
    storeProjectCredential(localCreds, "akun-proyek-ini", "pat-proyek-ini");
    const mode = fs.statSync(localCreds).mode & 0o777;
    assert.equal(mode, 0o600);

    // Setelah login: hanya mengembalikan akun proyek ini, global tetap utuh
    const afterCred = readStoredCredential(repoDir, env);
    assert.deepEqual(afterCred, {
      found: true,
      username: "akun-proyek-ini",
      token: "pat-proyek-ini",
    });

    // Ganti akun di proyek yang sama: akun lama terganti bersih
    storeProjectCredential(localCreds, "akun-kedua", "pat-kedua");
    const switchedCred = readStoredCredential(repoDir, env);
    assert.deepEqual(switchedCred, {
      found: true,
      username: "akun-kedua",
      token: "pat-kedua",
    });

    assert.equal(
      fs.readFileSync(globalCreds, "utf8"),
      "https://akun-lain:token-proyek-lain@github.com\n"
    );

    // Logout proyek: membersihkan .git/.git-credentials tanpa menyentuh file global
    clearProjectCredential(localCreds);
    const afterLogout = readStoredCredential(repoDir, env);
    assert.deepEqual(afterLogout, { found: false, username: null, token: null });
    assert.equal(
      fs.readFileSync(globalCreds, "utf8"),
      "https://akun-lain:token-proyek-lain@github.com\n"
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("verifyTokenAndIdentity: memvalidasi akses push, menolak token tanpa izin, dan menangani 403 /user/emails", async () => {
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization;
    res.setHeader("content-type", "application/json");
    if (auth === "Bearer tok-invalid") {
      res.statusCode = 401;
      res.end(JSON.stringify({ message: "Bad credentials" }));
      return;
    }
    if (req.url === "/user") {
      res.end(JSON.stringify({ id: 777, login: "monauli", name: "Monauli", email: null }));
      return;
    }
    if (req.url === "/repos/monauli/sanghyang-news") {
      const canPush = auth !== "Bearer tok-readonly";
      res.end(JSON.stringify({ full_name: "monauli/sanghyang-news", permissions: { push: canPush } }));
      return;
    }
    if (req.url === "/user/emails") {
      if (auth === "Bearer tok-fine-no-email") {
        res.statusCode = 403;
        res.end(JSON.stringify({ message: "Resource not accessible by personal access token" }));
        return;
      }
      res.end(JSON.stringify([{ email: "monauli@example.com", primary: true, verified: true }]));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: "Not Found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const apiBase = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const repo = { owner: "monauli", repo: "sanghyang-news" };

  try {
    await assert.rejects(
      () => verifyTokenAndIdentity(apiBase, repo, "tok-invalid"),
      /HTTP 401/
    );
    await assert.rejects(
      () => verifyTokenAndIdentity(apiBase, repo, "tok-readonly"),
      /belum memiliki izin push/
    );

    const fineResult = await verifyTokenAndIdentity(apiBase, repo, "tok-fine-no-email");
    assert.deepEqual(fineResult, {
      login: "monauli",
      canPush: true,
      identity: {
        name: "Monauli",
        email: "777+monauli@users.noreply.github.com",
        emailSource: "github-noreply",
      },
    });

    const classicResult = await verifyTokenAndIdentity(apiBase, repo, "tok-classic");
    assert.deepEqual(classicResult, {
      login: "monauli",
      canPush: true,
      identity: {
        name: "Monauli",
        email: "monauli@example.com",
        emailSource: "primary-verified",
      },
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
