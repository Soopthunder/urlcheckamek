import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { PROYECTOS } from "@/lib/agents";

// Sirve las capturas de las auditorías al visor. Solo .jpg dentro de proyectos/:
// una ruta con "../" no puede salir de esa carpeta.
export async function GET(req: NextRequest) {
  const f = req.nextUrl.searchParams.get("f") ?? "";
  const file = path.resolve(PROYECTOS, f);
  if (!file.startsWith(path.resolve(PROYECTOS) + path.sep) || !file.endsWith(".jpg")) {
    return new Response("ruta inválida", { status: 400 });
  }
  const img = await fs.readFile(file).catch(() => null);
  if (!img) return new Response("no existe", { status: 404 });
  return new Response(img, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "max-age=31536000, immutable" } });
}
