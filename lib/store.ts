import { Redis } from "@upstash/redis";
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

const LINKS_KEY = "sitecheck:links";
const RESULTS_KEY = "sitecheck:results"; // hash url -> CheckResult json
const REPORTS_KEY = "sitecheck:reports"; // hash url -> Report json

// ponytail: Redis when Vercel/Upstash env vars exist (production), otherwise a
// JSON file on disk so `npm run dev` works with zero setup. The file store is
// NOT for production — serverless filesystems are ephemeral/read-only.
const hasRedis = !!(
  (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
  (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
);

const redis = hasRedis
  ? new Redis({
      url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
      token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
    })
  : null;

const DB_FILE = path.join(process.cwd(), ".data", "db.json");

type FileDB = {
  links: string[];
  results: Record<string, CheckResult>;
  reports: Record<string, Report>;
};

async function readFileDB(): Promise<FileDB> {
  try {
    const raw = await fs.readFile(DB_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { links: SEED_LINKS, results: {}, reports: {} };
  }
}

async function writeFileDB(db: FileDB) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

export async function getLinks(): Promise<string[]> {
  if (redis) {
    const links = await redis.smembers(LINKS_KEY);
    if (links.length > 0) return links.sort();
    await redis.sadd(LINKS_KEY, ...(SEED_LINKS as [string, ...string[]]));
    return [...SEED_LINKS].sort();
  }
  const db = await readFileDB();
  return [...db.links].sort();
}

export async function addLink(url: string): Promise<void> {
  new URL(url); // throws on invalid input — validation at the trust boundary
  if (redis) {
    await redis.sadd(LINKS_KEY, url);
    return;
  }
  const db = await readFileDB();
  if (!db.links.includes(url)) db.links.push(url);
  await writeFileDB(db);
}

export async function removeLink(url: string): Promise<void> {
  if (redis) {
    await redis.srem(LINKS_KEY, url);
    return;
  }
  const db = await readFileDB();
  db.links = db.links.filter((l) => l !== url);
  await writeFileDB(db);
}

export async function saveResults(results: CheckResult[]): Promise<void> {
  if (redis) {
    const pipeline = redis.pipeline();
    for (const r of results) pipeline.hset(RESULTS_KEY, { [r.url]: JSON.stringify(r) });
    await pipeline.exec();
    return;
  }
  const db = await readFileDB();
  for (const r of results) db.results[r.url] = r;
  await writeFileDB(db);
}

export async function getResults(): Promise<Record<string, CheckResult>> {
  if (redis) {
    const all = (await redis.hgetall(RESULTS_KEY)) as Record<string, unknown> | null;
    if (!all) return {};
    const out: Record<string, CheckResult> = {};
    for (const [url, val] of Object.entries(all)) {
      out[url] = typeof val === "string" ? JSON.parse(val) : (val as CheckResult);
    }
    return out;
  }
  const db = await readFileDB();
  return db.results;
}

export async function saveReport(report: Report): Promise<void> {
  if (redis) {
    await redis.hset(REPORTS_KEY, { [report.url]: JSON.stringify(report) });
    return;
  }
  const db = await readFileDB();
  db.reports[report.url] = report;
  await writeFileDB(db);
}

export async function getReport(url: string): Promise<Report | null> {
  if (redis) {
    const val = await redis.hget(REPORTS_KEY, url);
    if (!val) return null;
    return typeof val === "string" ? JSON.parse(val) : (val as Report);
  }
  const db = await readFileDB();
  return db.reports[url] ?? null;
}
