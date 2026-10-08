import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { WORKSPACE, OLLAMA, getConfig } from "@/lib/agents";

// Estado de Ollama + modelo, para que la UI diga qué falta instalar.
export async function GET() {
  const { modelo } = await getConfig();
  const tags = await fetch(OLLAMA + "/api/tags", { signal: AbortSignal.timeout(3000) })
    .then((r) => r.json())
    .catch(() => null);
  const names: string[] = tags?.models?.map((m: { name: string }) => m.name) ?? [];
  return Response.json({
    ollama: !!tags,
    modelo,
    modeloListo: names.some((n) => n === modelo || n === modelo + ":latest"),
    workspace: WORKSPACE,
  });
}

// { memoria: "..." } agrega una línea a memoria/memoria.md · { abrir: true } abre la carpeta.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body?.abrir) {
    execFile("explorer.exe", [WORKSPACE], () => {}); // explorer always exits 1; ignore
    return Response.json({ ok: true });
  }
  const nota = String(body?.memoria ?? "").replace(/\s+/g, " ").trim();
  if (!nota) return Response.json({ error: "nota vacía" }, { status: 400 });
  const file = path.join(WORKSPACE, "memoria", "memoria.md");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `\n- (${new Date().toISOString().slice(0, 10)}) ${nota}`);
  return Response.json({ ok: true });
}
