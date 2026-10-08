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

// ponytail: a single JSON file is the whole database — one user, one machine,
// ~130 links. The desktop app points DATA_DIR at %APPDATA%/SiteCheck; `npm run dev`
// falls back to ./.data. Move to SQLite if this ever needs history or concurrency.
const DB_FILE = path.join(process.env.DATA_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), ".data"), "db.json");
type FileDB = { links: string[]; results: Record<string, CheckResult>; reports: Record<string, Report> };

async function readDB(): Promise<FileDB> {
  try {
    return JSON.parse(await fs.readFile(DB_FILE, "utf-8"));
  } catch {
    return { links: SEED_LINKS, results: {}, reports: {} };
  }
}
async function writeDB(db: FileDB) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

export async function getLinks(): Promise<string[]> {
  return [...(await readDB()).links].sort();
}

export async function addLinks(urls: string[]): Promise<number> {
  for (const url of urls) new URL(url); // throws on invalid input — validation at the trust boundary
  const db = await readDB();
  const fresh = urls.filter((u) => !db.links.includes(u));
  db.links.push(...new Set(fresh));
  await writeDB(db);
  return new Set(fresh).size;
}

export async function removeLink(url: string): Promise<void> {
  const db = await readDB();
  db.links = db.links.filter((l) => l !== url);
  await writeDB(db);
}

export async function saveResults(results: CheckResult[]): Promise<void> {
  const db = await readDB();
  for (const r of results) db.results[r.url] = r;
  await writeDB(db);
}

export async function getResults(): Promise<Record<string, CheckResult>> {
  return (await readDB()).results;
}

export async function saveReport(report: Report): Promise<void> {
  const db = await readDB();
  db.reports[report.url] = report;
  await writeDB(db);
}

export async function getReport(url: string): Promise<Report | null> {
  return (await readDB()).reports[url] ?? null;
}
