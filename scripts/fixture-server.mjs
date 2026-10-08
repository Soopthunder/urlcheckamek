// Sirve scripts/fixture/ en http://127.0.0.1:8099/ (página de prueba con errores plantados).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const dir = path.join(import.meta.dirname, "fixture");
const tipos = { ".html": "text/html; charset=utf-8", ".png": "image/png" };
createServer(async (req, res) => {
  const file = path.join(dir, path.normalize(req.url === "/" ? "/index.html" : req.url).replace(/^(\.\.[\/])+/, ""));
  try {
    res.writeHead(200, { "Content-Type": tipos[path.extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
}).listen(8099, "127.0.0.1", () => console.log("fixture en http://127.0.0.1:8099/"));
