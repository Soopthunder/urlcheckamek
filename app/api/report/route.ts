import { NextRequest, NextResponse } from "next/server";
import { getReport, saveReport, Report } from "@/lib/store";

export const maxDuration = 60; // PageSpeed audits are slow (10-30s)

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

// ponytail: Google PageSpeed Insights is free (no billing account needed, an API
// key just raises the rate limit) and already returns human-readable improvement
// suggestions — no need to hand-roll Lighthouse or scrape anything ourselves.
async function fetchPageSpeedReport(url: string): Promise<Report> {
  const key = process.env.PAGESPEED_API_KEY;
  const qs = new URLSearchParams({ url, strategy: "mobile", category: "performance" });
  if (key) qs.set("key", key);

  const res = await fetch(`${PSI_ENDPOINT}?${qs.toString()}`);
  if (!res.ok) {
    return {
      url,
      generatedAt: new Date().toISOString(),
      performanceScore: null,
      suggestions: [`No se pudo obtener el reporte de PageSpeed (HTTP ${res.status}).`],
      source: "fallback",
    };
  }
  const data = await res.json();
  const score = data?.lighthouseResult?.categories?.performance?.score;
  const audits = data?.lighthouseResult?.audits ?? {};
  const suggestions = Object.values(audits)
    .filter((a: any) => a.score !== null && a.score < 0.9 && a.title && a.details?.type !== "screenshot")
    .sort((a: any, b: any) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, 8)
    .map((a: any) => a.title as string);

  return {
    url,
    generatedAt: new Date().toISOString(),
    performanceScore: typeof score === "number" ? Math.round(score * 100) : null,
    suggestions: suggestions.length ? suggestions : ["Sin sugerencias relevantes — el sitio pasa las auditorías principales."],
    source: "pagespeed",
  };
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!url) return NextResponse.json({ error: "url requerida" }, { status: 400 });

  if (!force) {
    const cached = await getReport(url);
    if (cached && Date.now() - new Date(cached.generatedAt).getTime() < 24 * 60 * 60 * 1000) {
      return NextResponse.json(cached);
    }
  }

  const report = await fetchPageSpeedReport(url);
  await saveReport(report);
  return NextResponse.json(report);
}
