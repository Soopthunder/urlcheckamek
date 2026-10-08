import { NextRequest, NextResponse } from "next/server";
import { getLinks, addLinks, removeLink, getResults } from "@/lib/store";

export async function GET() {
  const [links, results] = await Promise.all([getLinks(), getResults()]);
  return NextResponse.json({ links, results });
}

// ponytail: follows one level of sitemap index (sitemap -> child sitemaps), which
// covers WordPress/Yoast. Deeper nesting is rare; recurse here if a site needs it.
async function readSitemap(url: string): Promise<string[]> {
  const locs = async (u: string) => {
    const xml = await (await fetch(u, { signal: AbortSignal.timeout(20000) })).text();
    return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  };
  const first = await locs(url);
  const children = first.filter((u) => /\.xml(\?|$)/i.test(u));
  if (!children.length) return first;
  const nested = await Promise.all(children.map((u) => locs(u).catch(() => [])));
  return [...first.filter((u) => !children.includes(u)), ...nested.flat()];
}

// A URL ending in .xml is treated as a sitemap: every <loc> in it gets added.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const url = body?.url?.trim();
  if (!url) return NextResponse.json({ error: "url requerida" }, { status: 400 });
  try {
    const urls = /\.xml(\?|$)/i.test(url) ? await readSitemap(url) : [url];
    if (!urls.length) return NextResponse.json({ error: "El sitemap no tiene URLs" }, { status: 400 });
    return NextResponse.json({ ok: true, added: await addLinks(urls) });
  } catch {
    return NextResponse.json({ error: "url o sitemap invalido" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url requerida" }, { status: 400 });
  await removeLink(url);
  return NextResponse.json({ ok: true });
}
