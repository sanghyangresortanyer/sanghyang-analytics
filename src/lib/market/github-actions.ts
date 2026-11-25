/**
 * Memicu dan membaca status workflow scrape malam di GitHub Actions dari panel.
 * Scrape lengkap butuh Chrome, Crawl4AI, dan 10–15 menit, jadi tidak bisa jalan di server Vercel.
 * Butuh env GITHUB_DISPATCH_TOKEN (fine-grained token, izin Actions: read & write untuk repo ini).
 */

export const NIGHTLY_WORKFLOW_FILE = "nightly-market-scrape.yml";
/** Jeda minimum setelah run sukses, supaya kuota menit GitHub Actions tidak terbuang untuk data yang sama. */
export const MIN_MINUTES_BETWEEN_RUNS = 60;

export interface WorkflowRunInfo {
  status: string;
  conclusion: string | null;
  event: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export class WorkflowDispatchRefused extends Error {
  constructor(message: string, readonly httpStatus: number) {
    super(message);
  }
}

type Env = Record<string, string | undefined>;

/** Repo diambil dari GITHUB_REPO, atau dari variabel sistem Vercel bila tersedia. */
const repoFromEnv = (env: Env) =>
  env.GITHUB_REPO ?? (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}` : undefined);

export function createGithubActions({
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date(),
}: { env?: Env; fetchImpl?: typeof fetch; now?: () => Date } = {}) {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  const repo = repoFromEnv(env);
  const ref = env.GITHUB_DISPATCH_REF ?? "main";
  const configured = Boolean(token && repo);

  const call = async (path: string, init: RequestInit = {}) => {
    if (!configured) throw new WorkflowDispatchRefused("Token GitHub belum diisi (GITHUB_DISPATCH_TOKEN di Vercel).", 503);
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${NIGHTLY_WORKFLOW_FILE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "sanghyang-analytics-panel",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new WorkflowDispatchRefused(`GitHub menolak token (HTTP ${res.status}). Pastikan token punya izin Actions: read & write untuk ${repo}.`, 502);
    }
    if (!res.ok) throw new WorkflowDispatchRefused(`GitHub menjawab HTTP ${res.status}.`, 502);
    return res;
  };

  async function latestRun(): Promise<WorkflowRunInfo | null> {
    const body = (await (await call("/runs?per_page=1")).json()) as {
      workflow_runs?: { status: string; conclusion: string | null; event: string; created_at: string; updated_at: string; html_url: string }[];
    };
    const run = body.workflow_runs?.[0];
    return run
      ? { status: run.status, conclusion: run.conclusion, event: run.event, createdAt: run.created_at, updatedAt: run.updated_at, htmlUrl: run.html_url }
      : null;
  }

  async function dispatch(): Promise<void> {
    const last = await latestRun();
    if (last && last.status !== "completed") {
      throw new WorkflowDispatchRefused("Pembaruan data masih berjalan. Tunggu sampai selesai.", 409);
    }
    const minutesSince = last ? (now().getTime() - Date.parse(last.updatedAt)) / 60_000 : Infinity;
    if (last?.conclusion === "success" && minutesSince < MIN_MINUTES_BETWEEN_RUNS) {
      throw new WorkflowDispatchRefused(
        `Data baru saja diperbarui ${Math.floor(minutesSince)} menit lalu. Coba lagi setelah ${Math.ceil(MIN_MINUTES_BETWEEN_RUNS - minutesSince)} menit.`,
        429,
      );
    }
    await call("/dispatches", { method: "POST", body: JSON.stringify({ ref }) });
  }

  return { configured, latestRun, dispatch };
}

export type GithubActions = ReturnType<typeof createGithubActions>;
