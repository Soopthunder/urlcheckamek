// Chequeo de la lógica anti-invención y de agrupación: node scripts/check-findings.mjs
import assert from "node:assert/strict";
import { existeLiteral, agrupar } from "../lib/findings.ts";

// la cita tiene que existir en la página (tolerando espacios, mayúsculas de CSS y comillas)
assert.ok(existeLiteral("habitasiones", "Nuestras HABITASIONES  tienen vista"));
assert.ok(existeLiteral("“Reservá”", '"Reservá" ahora'));
assert.ok(!existeLiteral("reservacion online", "Reservá online"), "una frase inventada no debe pasar");
assert.ok(!existeLiteral(" ", "cualquier texto"), "una cita vacía no debe pasar");

// el mismo problema en dos tamaños = un hallazgo con los dos viewports y la peor prioridad
const base = {
  url: "https://x.com/", categoria: "Responsive", prioridad: "Media", estado: "confirmado", origen: "medido",
  idioma: null, descripcion: "d", ubicacion: "#btn", pasos: [], recomendacion: "r", regla: "elemento-tapado",
};
const g = agrupar([
  { ...base, viewports: ["360x800"], evidencia: { capturas: ["a.jpg"] } },
  { ...base, viewports: ["390x844"], prioridad: "Alta", evidencia: { capturas: ["b.jpg"] } },
  { ...base, viewports: ["390x844"], ubicacion: "#otro", evidencia: {} },
]);
assert.equal(g.length, 2);
assert.deepEqual(g[0].viewports, ["360x800", "390x844"]);
assert.equal(g[0].prioridad, "Alta");
assert.deepEqual(g[0].evidencia.capturas, ["a.jpg", "b.jpg"]);
console.log("check-findings: OK");
