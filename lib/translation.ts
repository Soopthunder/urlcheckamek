// Comparación español ↔ inglés hecha por código: qué página es la traducción (con
// evidencia) y si los datos importantes (precios, horarios, porcentajes, teléfonos, emails)
// coinciden. Lo que requiere entender el texto (significado, CTAs) lo hace la IA.
// Sin imports de la app (solo tipos), así scripts/check-translation.mjs lo prueba solo.
import type { Alternativas, Seccion } from "./browser";

export const normalizarUrl = (u: string) => {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.href.replace(/\/$/, "");
  } catch {
    return u;
  }
};

// La versión en `destino` según lo que declara la página A: primero hreflang, después el
// selector de idioma. Nunca por parecido de URL.
export function buscarEquivalente(urlA: string, alt: Alternativas, destino: string): { url: string; via: "hreflang" | "selector de idioma" } | null {
  const propia = normalizarUrl(urlA);
  const h = alt.hreflang.find((x) => x.idioma === destino && normalizarUrl(x.url) !== propia);
  if (h) return { url: h.url, via: "hreflang" };
  const s = alt.selector.find((x) => x.idioma === destino && normalizarUrl(x.url) !== propia);
  return s ? { url: s.url, via: "selector de idioma" } : null;
}

// ¿La página B apunta de vuelta a A? (hreflang o selector recíproco = equivalencia confirmada)
export const esReciproca = (urlA: string, altB: Alternativas) =>
  [...altB.hreflang, ...altB.selector].some((x) => normalizarUrl(x.url) === normalizarUrl(urlA));

export type Dato = { tipo: string; valor: string; texto: string; seccion: string };

const MONEDA = (m: string) => (/us|usd|u\$s|dólar|dolar|dollar/i.test(m) ? "USD" : /€|eur/i.test(m) ? "EUR" : "$");

// Datos que una traducción no puede cambiar, normalizados para comparar entre idiomas
// ("14 hs" = "2 pm" = 14:00; "$ 45.000" = "$45,000").
// ponytail: las fechas quedan afuera a propósito — 03/04 es 3 de abril en ES y 4 de marzo
// en EN, y sin saber el formato de cada sitio daría falsos positivos.
export function datosClave(secciones: Seccion[]): Dato[] {
  const out: Dato[] = [];
  for (const s of secciones) {
    const t = `${s.titulo}\n${s.texto}`;
    const add = (tipo: string, valor: string, texto: string) => out.push({ tipo, valor, texto: texto.trim(), seccion: s.titulo });
    for (const m of t.matchAll(/(US\$|U\$S|USD|ARS|AR\$|\$|€|EUR)\s?(\d[\d.,]*)|(\d[\d.,]*)\s?(USD|ARS|EUR|€|dólares|pesos|dollars)/gi)) {
      add("precio", `${MONEDA(m[1] ?? m[4])} ${(m[2] ?? m[3]).replace(/[.,]/g, "")}`, m[0]);
    }
    for (const m of t.matchAll(/\b([01]?\d|2[0-3])(?::([0-5]\d))?\s?(hs|h|am|pm|a\.\s?m\.|p\.\s?m\.)(?![a-záéíóú])/gi)) {
      let h = Number(m[1]);
      const pm = /^p/i.test(m[3]);
      if (/^[ap]/i.test(m[3]) && h === 12) h = 0;
      if (pm) h += 12;
      add("horario", `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`, m[0]);
    }
    for (const m of t.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s?(hs|h|am|pm|a\.|p\.))/gi)) {
      add("horario", `${m[1].padStart(2, "0")}:${m[2]}`, m[0]);
    }
    for (const m of t.matchAll(/\d+(?:[.,]\d+)?\s?%/g)) add("porcentaje", m[0].replace(/\s/g, "").replace(",", "."), m[0]);
    for (const m of t.matchAll(/\+?\d[\d\s().-]{7,}\d/g)) {
      const digitos = m[0].replace(/\D/g, "");
      if (digitos.length >= 8) add("teléfono", digitos.slice(-8), m[0]); // el prefijo de país se escribe distinto
    }
    for (const m of t.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)) add("email", m[0].toLowerCase(), m[0]);
  }
  return out;
}

export type DiferenciaDatos = { tipo: string; soloEnA: Dato[]; soloEnB: Dato[] };

// Por tipo de dato: lo que está en una versión y no en la otra.
export function compararDatos(a: Dato[], b: Dato[]): DiferenciaDatos[] {
  const tipos = [...new Set([...a, ...b].map((d) => d.tipo))];
  return tipos
    .map((tipo) => {
      const va = new Set(a.filter((d) => d.tipo === tipo).map((d) => d.valor));
      const vb = new Set(b.filter((d) => d.tipo === tipo).map((d) => d.valor));
      const unicos = (ds: Dato[], otros: Set<string>) =>
        ds.filter((d, i) => d.tipo === tipo && !otros.has(d.valor) && ds.findIndex((x) => x.tipo === tipo && x.valor === d.valor) === i);
      return { tipo, soloEnA: unicos(a, vb), soloEnB: unicos(b, va) };
    })
    .filter((d) => d.soloEnA.length || d.soloEnB.length);
}
