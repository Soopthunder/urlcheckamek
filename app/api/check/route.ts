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

// ponytail: ntfy.sh gives free phone push with zero setup — no VAPID keys, no
// service-worker push handler, no subscription table. Install the ntfy app
// (iOS/Android) and subscribe to this topic to get alerts. Anyone who knows
// the topic name can post to it, so it's a random slug, not a secret — swap
// for real Web Push + a subscriptions table if that ever matters.
const NTFY_TOPIC = process.env.NTFY_TOPIC;

async function notifyDown(down: CheckResult[]) {
  if (!NTFY_TOPIC || down.length === 0) return;
  const preview = down.slice(0, 5).map((r) => `• ${r.url} (${r.error ?? r.status})`).join("\n");
  const more = down.length > 5 ? `\n…y ${down.length - 5} más` : "";
  await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: "POST",
    headers: { Title: `SiteCheck: ${down.length} sitio(s) caido(s)`, Priority: "high", Tags: "warning" },
    body: preview + more,
  }).catch(() => {}); // ponytail: best-effort, a notify failure shouldn't fail the check
}

async function checkAll() {
  const links = await getLinks();
  const BATCH = 15; // ponytail: cap concurrency so ~130 links don't blow past maxDuration
  const results: CheckResult[] = [];
  for (let i = 0; i < links.length; i += BATCH) {
    const batch = links.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(checkOne));
    // ponytail: save per batch, not once at the end — ~130 real network checks can
    // run long enough to hit the platform's function timeout mid-sweep; saving as we
    // go means the links already checked keep their fresh result instead of the
    // whole run being silently lost (this was the "no actualiza todas las URL" bug).
    await saveResults(batchResults);
    results.push(...batchResults);
  }
  await notifyDown(results.filter((r) => !r.ok));
  return results;
}

// Called every 30 min by an external cron (see README — Vercel Hobby cron only
// fires once/day, so this must be pinged by cron-job.org or similar).
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  // ponytail: browsers don't reliably send Origin on a same-origin GET fetch —
  // fall back to Referer (always sent by the dashboard's own fetch call) so the
  // "Actualizar ahora" button doesn't silently 401 and skip the check + alert.
  const referer = req.headers.get("referer");
  const sameOrigin =
    req.headers.get("origin") === req.nextUrl.origin ||
    (!!referer && new URL(referer).origin === req.nextUrl.origin);
  const validSecret = !process.env.CRON_SECRET || secret === process.env.CRON_SECRET;
  // ponytail: the "Actualizar ahora" button on the dashboard calls this same route
  // without the secret — trust same-origin browser requests, require the secret
  // only for the external cron pinging from outside (GitHub Actions etc).
  if (!validSecret && !sameOrigin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results = await checkAll();
  const down = results.filter((r) => !r.ok);
  return NextResponse.json({ checked: results.length, down: down.length, results });
}
