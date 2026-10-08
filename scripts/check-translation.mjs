// Chequeo de la comparación ES↔EN por código: node scripts/check-translation.mjs
import assert from "node:assert/strict";
import { datosClave, compararDatos, buscarEquivalente, esReciproca } from "../lib/translation.ts";

const sec = (texto) => [{ titulo: "x", selector: "x", texto }];
const valores = (t) => datosClave(sec(t)).map((d) => `${d.tipo}=${d.valor}`).sort();

// mismos datos escritos distinto en cada idioma = iguales
assert.deepEqual(valores("Check-in 14 hs, desde $ 45.000"), valores("Check-in 2 pm, from $45,000"));
assert.deepEqual(valores("Abierto de 9:30 a 18 hs"), valores("Open 9:30 am to 6 pm"));
// "24 horas" es una duración, no un horario
assert.deepEqual(valores("Recepción abierta las 24 horas"), []);

// un horario distinto y un precio que falta se detectan
const dif = compararDatos(datosClave(sec("Check-in 14 hs. Cena $ 45.000")), datosClave(sec("Check-in 3 pm. Dinner included")));
assert.deepEqual(dif.map((d) => [d.tipo, d.soloEnA.map((x) => x.valor), d.soloEnB.map((x) => x.valor)]).sort(), [
  ["horario", ["14:00"], ["15:00"]],
  ["precio", ["$ 45000"], []],
]);

// la equivalencia sale de enlaces declarados, no del parecido de la URL
const altEs = { hreflang: [{ idioma: "en", url: "https://h.com/en/" }], selector: [] };
assert.deepEqual(buscarEquivalente("https://h.com/es/", altEs, "en"), { url: "https://h.com/en/", via: "hreflang" });
assert.equal(buscarEquivalente("https://h.com/es/", { hreflang: [], selector: [] }, "en"), null);
assert.ok(esReciproca("https://h.com/es/", { hreflang: [{ idioma: "es", url: "https://h.com/es" }], selector: [] }));
assert.ok(!esReciproca("https://h.com/es/", { hreflang: [], selector: [] }));
console.log("check-translation: OK");
