// Fase 1 (Extracción): datos duros de una URL, sacados con código y no con el LLM.
// El Analista solo puede razonar sobre esto — es lo que hace cumplir "No Inventar".
// Con navegador, el HTML llega ya renderizado por Playwright (lib/browser.ts); sin
// navegador, se descarga crudo con fetch.
//
// ponytail: regex sobre el HTML, sin cheerio. Alcanza para etiquetas SEO, trackers y estructura.

const TRACKERS: Record<string, RegExp> = {
  GA4: /gtag\/js\?id=G-|['"]G-[A-Z0-9]{6,}['"]/,
  "Google Tag Manager": /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/,
  "Google Ads": /AW-\d{6,}/,
  "Meta Pixel": /fbevents\.js|fbq\(/,
  SynXis: /synxis/i,
  Hotjar: /hotjar/i,
  Clarity: /clarity\.ms/i,
};

const all = (html: string, re: RegExp) => [...html.matchAll(re)];
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, dec, hex, name) =>
    dec ? String.fromCodePoint(+dec) : hex ? String.fromCodePoint(parseInt(hex, 16)) : NAMED[name.toLowerCase()] ?? m);
const text = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag: string | undefined, name: string) => {
  const v = tag?.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1];
  return v == null ? null : decode(v);
};
// atributos en cualquier orden: primero la etiqueta, después el content
const meta = (html: string, name: string) =>
  attr(html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i"))?.[0], "content");

export type Pagina = {
  url: string;
  urlFinal: string;
  redireccionado: boolean;
  status: number;
  ms: number;
  html: string;
  xRobotsTag: string | null;
};

export function factsFromHtml(p: Pagina) {
  const { html } = p;
  const host = new URL(p.urlFinal).host;
  const hrefs = all(html, /<a\b[^>]*\bhref=["']([^"'#]+)/gi).map((m) => m[1]);
  const internos = hrefs.filter((h) => {
    try { return new URL(h, p.urlFinal).host === host; } catch { return false; }
  }).length;
  const imgs = all(html, /<img\b[^>]*>/gi).map((m) => m[0]);
  const visible = text(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " "));

  return {
    url: p.url,
    urlFinal: p.urlFinal,
    redireccionado: p.redireccionado,
    status: p.status,
    tiempoRespuestaMs: p.ms,
    pesoHtmlKb: Math.round(html.length / 1024),
    xRobotsTag: p.xRobotsTag,
    idioma: attr(html.match(/<html\b[^>]*>/i)?.[0], "lang"),
    title: text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || null,
    metaDescription: meta(html, "description"),
    metaRobots: meta(html, "robots"),
    viewport: meta(html, "viewport"),
    canonical: attr(html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0], "href"),
    hreflang: all(html, /<link[^>]+hreflang=["']([^"']+)/gi).map((m) => m[1]),
    ogTitle: meta(html, "og:title"),
    ogImage: meta(html, "og:image"),
    h1: all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).map((m) => text(m[1])),
    h2: all(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).map((m) => text(m[1])).slice(0, 15),
    imagenes: imgs.length,
    imagenesSinAltOAltVacio: imgs.filter((t) => !attr(t, "alt")).length,
    enlacesInternos: internos,
    enlacesExternos: hrefs.length - internos,
    bloquesJsonLd: all(html, /<script[^>]+application\/ld\+json/gi).length,
    recursosHttpEnPaginaHttps: p.urlFinal.startsWith("https:") ? all(html, /\bsrc=["']http:\/\//gi).length : 0,
    palabrasVisibles: visible ? visible.split(" ").length : 0,
    trackersDetectados: Object.keys(TRACKERS).filter((k) => TRACKERS[k].test(html)),
  };
}

export const accessError = (url: string, err: unknown, ms: number) => ({
  url,
  errorDeAcceso: err instanceof Error ? err.message : String(err),
  tiempoRespuestaMs: ms,
});

// Descarga directa sin navegador: respaldo si no hay Edge/Chrome disponible.
export async function extractFacts(url: string) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SiteCheck-Auditor" },
    });
    return factsFromHtml({
      url,
      urlFinal: res.url,
      redireccionado: res.redirected,
      status: res.status,
      ms: Date.now() - start,
      html: await res.text(),
      xRobotsTag: res.headers.get("x-robots-tag"),
    });
  } catch (err) {
    return accessError(url, err, Date.now() - start);
  }
}

export type Senal = { prioridad: "Crítica" | "Alta" | "Media" | "Baja"; area: string; problema: string; evidencia: string };
export type Facts = ReturnType<typeof factsFromHtml> | ReturnType<typeof accessError>;

// Las reglas medibles de contexto/criterios_prioridad.md, evaluadas con código.
// Un 7B se equivoca comparando números ("103 caracteres no supera 60"); esto no.
// Los agentes reciben estas señales ya resueltas y se ocupan de lo que requiere criterio.
// ponytail: umbrales duplicados del .md a propósito — si cambiás uno, cambiá el otro.
export function senales(f: Facts): Senal[] {
  const s: Senal[] = [];
  const add = (prioridad: Senal["prioridad"], area: string, problema: string, evidencia: string) =>
    s.push({ prioridad, area, problema, evidencia });

  if ("errorDeAcceso" in f) {
    add("Crítica", "Técnica", "Error de acceso: la URL no respondió", `errorDeAcceso = ${f.errorDeAcceso}`);
    return s;
  }
  const noindex = /noindex/i.test(`${f.metaRobots ?? ""} ${f.xRobotsTag ?? ""}`);
  const sinBarra = (u: string) => u.replace(/\/+$/, "");

  if (f.status >= 500) add("Crítica", "Técnica", `Error del servidor HTTP ${f.status}`, `status = ${f.status}`);
  else if (f.status >= 400) add("Crítica", "Técnica", `La página devuelve HTTP ${f.status}`, `status = ${f.status}`);
  if (f.palabrasVisibles < 20) add("Crítica", "Técnica", "Página prácticamente en blanco", `palabrasVisibles = ${f.palabrasVisibles}`);
  if (noindex) add("Crítica", "SEO", "La página está bloqueada para indexación (noindex)", `metaRobots = ${f.metaRobots} · xRobotsTag = ${f.xRobotsTag}`);

  if (!f.title) add("Alta", "SEO", "Falta la etiqueta title", "title = null");
  if (f.h1.length === 0) add("Alta", "SEO", "Falta el H1", "h1 = []");
  if (f.h1.length > 1) add("Alta", "SEO", `Hay ${f.h1.length} H1 (debe haber uno)`, `h1 = ${JSON.stringify(f.h1)}`);
  if (f.canonical && sinBarra(new URL(f.canonical, f.urlFinal).href) !== sinBarra(f.urlFinal))
    add("Alta", "SEO", "El canonical apunta a otra URL", `canonical = ${f.canonical} · urlFinal = ${f.urlFinal}`);
  if (!f.trackersDetectados.some((t) => t === "GA4" || t === "Google Tag Manager"))
    add("Alta", "SEM", "Sin analítica: no se detecta GA4 ni Google Tag Manager", `trackersDetectados = ${JSON.stringify(f.trackersDetectados)}`);
  if (f.tiempoRespuestaMs > 3000) add("Alta", "Técnica", "Respuesta lenta (más de 3000 ms)", `tiempoRespuestaMs = ${f.tiempoRespuestaMs}`);
  if (f.recursosHttpEnPaginaHttps > 0)
    add("Alta", "Técnica", "Contenido mixto: recursos http en página https", `recursosHttpEnPaginaHttps = ${f.recursosHttpEnPaginaHttps}`);

  if (!f.metaDescription) add("Media", "SEO", "Falta la meta description", "metaDescription = null");
  else if (f.metaDescription.length > 160)
    add("Media", "SEO", `Meta description demasiado larga (${f.metaDescription.length} caracteres, máximo 160)`, `metaDescription = "${f.metaDescription}"`);
  if (f.title && (f.title.length > 60 || f.title.length < 15))
    add("Media", "SEO", `Title de ${f.title.length} caracteres (recomendado 15–60)`, `title = "${f.title}"`);
  if (f.imagenesSinAltOAltVacio > 0)
    add("Media", "SEO", `${f.imagenesSinAltOAltVacio} de ${f.imagenes} imágenes sin texto alt`, `imagenesSinAltOAltVacio = ${f.imagenesSinAltOAltVacio}`);
  if (!f.ogTitle || !f.ogImage)
    add("Media", "SEM", "Faltan etiquetas Open Graph para compartir", `ogTitle = ${f.ogTitle} · ogImage = ${f.ogImage}`);
  if (f.bloquesJsonLd === 0) add("Media", "SEO", "Sin datos estructurados (JSON-LD)", "bloquesJsonLd = 0");
  if (!f.idioma) add("Media", "Contenido/UX", "Falta el atributo lang en <html>", "idioma = null");
  if (!f.viewport) add("Media", "Técnica", "Falta la meta viewport (no adaptada a móvil)", "viewport = null");

  if (f.palabrasVisibles >= 20 && f.palabrasVisibles < 300)
    add("Baja", "Contenido/UX", "Poco texto en la página", `palabrasVisibles = ${f.palabrasVisibles}`);
  return s;
}
