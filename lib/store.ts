import { promises as fs } from "fs";
import path from "path";
import { SEED_LINKS } from "./seed-links";

export type CheckResult = {
  url: string;
  ok: boolean;
  status: number | null;
  ms: number;
  error: string | null;
  checkedAt: string;
};

export type Report = {
  url: string;
  generatedAt: string;
  performanceScore: number | null;
  suggestions: string[];
  source: "pagespeed" | "fallback";
};

// ponytail: talk to Supabase's auto-generated REST API (PostgREST) with plain
// fetch â no @supabase/supabase-js needed, one less dependency to carry.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // bypasses RLS, server-side only
const hasSupabase = !!(SUPABASE_URL && SUPABASE_KEY);

async function pg(path: string, init?: RequestInit) {
  const res = await fetch(SUPABASE_URL + "/rest/v1" + path, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Supabase " + path + " -> HTTP " + res.status + ": " + text);
  return text ? JSON.parse(text) : null;
}

// ponytail: file-store fallback keeps `npm run dev` zero-setup when Supabase
// env vars aren't present locally. NOT for production â serverless FS is ephemeral.
const DB_FILE = path.join(process.cwd(), ".data", "db.json");
type FileDB = { links: string[]; results: Record<string, CheckResult>; reports: Record<string, Report> };

async function readFileDB(): Promise<FileDB> {
  try {
    return JSON.parse(await fs.readFile(DB_FILE, "utf-8"));
  } catch {
    return { links: SEED_LINKS, results: {}, reports: {} };
  }
}
async function writeFileDB(db: FileDB) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

export async function getLinks(): Promise<string[]> {
  if (hasSupabase) {
    const rows = (await pg("/links?select=url&order=url")) as { url: string }[];
    if (rows.length > 0) return rows.map((r) => r.url);
    await pg("/links", { method: "POST", body: JSON.stringify(SEED_LINKS.map((url) => ({ url }))) });
    return [...SEED_LINKS].sort();
  }
  const db = await readFileDB();
  return [...db.links].sort();
}

export async function addLink(url: string): Promise<void> {
  new URL(url); // throws on invalid input â validation at the trust boundary
  if (hasSupabase) {
    await pg("/links", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ url }) });
    return;
  }
  const db = await readFileDB();
  if (!db.links.includes(url)) db.links.push(url);
  await writeFileDB(db);
}

export async function removeLink(url: string): Promise<void> {
  if (hasSupabase) {
    await pg("/links?url=eq." + encodeURIComponent(url), { method: "DELETE" });
    return;
  }
  const db = await readFileDB();
  db.links = db.links.filter((l) => l !== url);
  await writeFileDB(db);
}

export async function saveResults(results: CheckResult[]): Promise<void> {
  if (hasSupabase) {
    const rows = results.map((r) => ({
      url: r.url,
      ok: r.ok,
      status: r.status,
      ms: r.ms,
      error: r.error,
      checked_at: r.checkedAt,
    }));
    await pg("/results", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(rows) });
    return;
  }
  const db = await readFileDB();
  for (const r of results) db.results[r.url] = r;
  await writeFileDB(db);
}

export async function getResults(): Promise<Record<string, CheckResult>> {
  if (hasSupabase) {
    const rows = (await pg("/results?select=*")) as any[];
    const out: Record<string, CheckResult> = {};
    for (const r of rows) {
      out[r.url] = { url: r.url, ok: r.ok, status: r.status, ms: r.ms, error: r.error, checkedAt: r.checked_at };
    }
    return out;
  }
  const db = await readFileDB();
  return db.results;
}

export async function saveReport(report: Report): Promise<void> {
  if (hasSupabase) {
    await pg("/reports", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        url: report.url,
        generated_at: report.generatedAt,
        performance_score: report.performanceScore,
        suggestions: report.suggestions,
        source: report.source,
      }),
    });
    return;
  }
  const db = await readFileDB();
  db.reports[report.url] = report;
  await writeFileDB(db);
}

export async function getReport(url: string): Promise<Report | null> {
  if (hasSupabase) {
    const rows = (await pg("/reports?url=eq." + encodeURIComponent(url) + "&select=*")) as any[];
    if (!rows.length) return null;
    const r = rows[0];
    return {
      url: r.url,
      generatedAt: r.generated_at,
      performanceScore: r.performance_score,
      suggestions: r.suggestions,
      source: r.source,
    };
  }
  const db = await readFileDB();
  return db.reports[url] ?? null;
}
