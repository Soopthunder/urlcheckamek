import { NextRequest, NextResponse } from "next/server";

// The server only listens on 127.0.0.1, but any website open in the user's browser
// can still fire requests at localhost. Reject foreign Host headers (DNS rebinding)
// and cross-site writes (add links, append memory, start audits).
export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return new NextResponse("forbidden", { status: 403 });
  const origin = req.headers.get("origin");
  if (req.method !== "GET" && origin && new URL(origin).host !== host) return new NextResponse("forbidden", { status: 403 });
}

export const config = { matcher: "/api/:path*" };
