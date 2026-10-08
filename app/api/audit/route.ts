import { NextRequest } from "next/server";
import { runAudit, AgentEvent } from "@/lib/agents";

// Streams the agents' conversation as NDJSON (one event per line) so the UI can
// show each agent typing in real time. Closing the panel aborts the whole run.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const urls: string[] = (Array.isArray(body?.urls) ? body.urls : []).filter(
    (u: unknown) => typeof u === "string" && /^https?:\/\//.test(u)
  );
  if (!urls.length) return Response.json({ error: "Seleccioná al menos una URL" }, { status: 400 });
  const project = String(body?.project ?? "").trim() || "general";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(e) + "\n")); } catch { /* client gone */ }
      };
      try {
        await runAudit(urls, project, emit, req.signal);
      } catch (err) {
        if (!req.signal.aborted) emit({ agent: "sistema", kind: "error", text: err instanceof Error ? err.message : String(err) });
      }
      try { controller.close(); } catch { /* already closed */ }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
}
