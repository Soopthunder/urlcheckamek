import { NextRequest, NextResponse } from "next/server";
import { getLinks, addLink, removeLink, getResults } from "@/lib/store";

export async function GET() {
  const [links, results] = await Promise.all([getLinks(), getResults()]);
  return NextResponse.json({ links, results });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const url = body?.url?.trim();
  if (!url) return NextResponse.json({ error: "url requerida" }, { status: 400 });
  try {
    await addLink(url);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "url invalida" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url requerida" }, { status: 400 });
  await removeLink(url);
  return NextResponse.json({ ok: true });
}
