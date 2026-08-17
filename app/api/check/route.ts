import { NextRequest, NextResponse } from "next/server";
import { getLinks, saveResults, CheckResult } from "@/lib/store";

export const maxDuration = 60; // Vercel: give the batch enough room to finish

// ponytail: plain fetch per link, not a headless browser — a status/error check
// on ~130 URLs every 30 min needs speed and low cost, not rendered DOM. Playwright
// is used for on-demand deep checks (see scripts/smoke-test.mjs) and could power a
// future "render check" button, not the cron sweep.
async function checkOne(url: string): Promise<CheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "SiteCheck/1.0 (+uptime monitor)" },
    });
    const ms = Date.now() - start;
    return {
      url,
      ok: res.status < 400,
      status: res.status,
      ms,
      error: res.status >= 400 ? `HTTP ${res.status}` : null,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      url,
      ok: false,
      status: null,
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : "unknown error",
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkAll() {
  const links = await getLinks();
  const BATCH = 15; // ponytail: cap concurrency so ~130 links don't blow past maxDuration
  const results: CheckResult[] = [];
  for (let i = 0; i < links.length; i += BATCH) {
    const batch = links.slice(i, i + BATCH);
    results.push(...(await Promise.all(batch.map(checkOne))));
  }
  await saveResults(results);
  return results;
}

// Called every 30 min by an external cron (see README — Vercel Hobby cron only
// fires once/day, so this must be pinged by cron-job.org or similar).
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results = await checkAll();
  const down = results.filter((r) => !r.ok);
  return NextResponse.json({ checked: results.length, down: down.length, results });
}
