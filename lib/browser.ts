// Navegación real con Playwright: carga cada URL en cada viewport, maneja el banner de
// cookies, recorre la página, captura pantallas y registra errores de carga.
//
// Solo lectura: se abortan todos los pedidos que no sean GET/HEAD/OPTIONS (formularios,
// reservas, pagos — y de paso las auditorías no ensucian GA4 ni el Pixel), y los únicos
// clics posibles son los del banner de cookies. Cada interacción queda registrada.
import { chromium, type Browser, type Page } from "playwright-core";
import { promises as fs } from "fs";
import path from "path";

export type Viewport = { ancho: number; alto: number; movil?: boolean };
export type Limites = { timeoutNavegacionMs: number; maxCapturasPorViewport: number; maxAlturaScroll: number };
export type Problema = { tipo: "error" | "advertencia"; origen: "javascript" | "consola" | "red"; detalle: string };
export type Seccion = { titulo: string; selector: string; texto: string };
export type PasoNavegador = { accion: string; viewport: string; captura?: string };

export type ResultadoViewport = {
  viewport: string;
  movil: boolean;
  estado: "ok" | "error";
  error?: string;
  status: number | null;
  urlFinal: string;
  redireccionado: boolean;
  ms: number;
  xRobotsTag: string | null;
  alturaPagina: number;
  capturas: string[];
  interacciones: string[];
  problemas: Problema[];
  pedidosBloqueados: number;
  html: string;
  secciones: Seccion[];
};

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const IMPACTA = new Set(["document", "stylesheet", "script", "image", "font"]);
const MAX_PROBLEMAS = 40;

export const nombreViewport = (v: Viewport) => `${v.ancho}x${v.alto}`;

// ponytail: usa el Edge que trae Windows (o Chrome) en vez de bajar Chromium — el
// instalador no crece ~150 MB. Ceiling: un salto grande de versión de Edge puede pedir
// actualizar playwright-core.
export async function abrirNavegador(signal: AbortSignal): Promise<Browser> {
  for (const channel of ["msedge", "chrome"]) {
    try {
      const browser = await chromium.launch({ channel, headless: true });
      // cancelar la auditoría mata el navegador aunque esté a mitad de una carga
      signal.addEventListener("abort", () => browser.close().catch(() => {}), { once: true });
      return browser;
    } catch {}
  }
  throw new Error("No se encontró Microsoft Edge ni Google Chrome para navegar las páginas");
}

export async function auditarViewport(
  browser: Browser,
  url: string,
  vp: Viewport,
  lim: Limites,
  dirCapturas: string, // carpeta absoluta donde se guardan los .jpg
  relCapturas: string, // la misma carpeta, relativa a proyectos/ (lo que pide el visor)
  paso: (p: PasoNavegador) => void
): Promise<ResultadoViewport> {
  const viewport = nombreViewport(vp);
  const r: ResultadoViewport = {
    viewport, movil: !!vp.movil, estado: "ok", status: null, urlFinal: url, redireccionado: false, ms: 0,
    xRobotsTag: null, alturaPagina: 0, capturas: [], interacciones: [], problemas: [], pedidosBloqueados: 0,
    html: "", secciones: [],
  };
  await fs.mkdir(dirCapturas, { recursive: true });

  const ctx = await browser.newContext({
    viewport: { width: vp.ancho, height: vp.alto },
    deviceScaleFactor: vp.movil ? 2 : 1,
    isMobile: !!vp.movil,
    hasTouch: !!vp.movil,
    userAgent: vp.movil ? MOBILE_UA : undefined,
    serviceWorkers: "block", // un SW podría saltear el bloqueo de pedidos de abajo
    acceptDownloads: false,
  });
  await ctx.route("**/*", (route) => {
    const m = route.request().method();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") return route.continue();
    r.pedidosBloqueados++;
    return route.abort("blockedbyclient");
  });

  const page = await ctx.newPage();
  const dominio = new URL(url).hostname.replace(/^www\./, "");
  const propio = (u: string) => {
    try { return new URL(u).hostname.endsWith(dominio); } catch { return false; }
  };
  const anotar = (p: Problema) => {
    if (r.problemas.length < MAX_PROBLEMAS && !r.problemas.some((x) => x.detalle === p.detalle)) r.problemas.push(p);
  };
  // Afecta al usuario = recurso propio que se ve (HTML, CSS, JS, imagen, fuente). Lo demás
  // (trackers, píxeles, errores de JS sin efecto comprobado) es advertencia.
  const clasificar = (u: string, tipo: string) => (propio(u) && IMPACTA.has(tipo) ? "error" : "advertencia");
  page.on("pageerror", (e) => anotar({ tipo: "advertencia", origen: "javascript", detalle: e.message.slice(0, 300) }));
  page.on("console", (m) => {
    if (m.type() === "error") anotar({ tipo: "advertencia", origen: "consola", detalle: m.text().slice(0, 300) });
  });
  page.on("requestfailed", (req) => {
    const err = req.failure()?.errorText ?? "";
    if (err.includes("BLOCKED_BY_CLIENT") || err.includes("ERR_ABORTED")) return; // nuestros bloqueos / navegación
    anotar({ tipo: clasificar(req.url(), req.resourceType()), origen: "red", detalle: `${req.resourceType()} ${req.url().slice(0, 200)} — ${err}` });
  });
  page.on("response", (res) => {
    if (res.status() < 400) return;
    const req = res.request();
    anotar({ tipo: clasificar(res.url(), req.resourceType()), origen: "red", detalle: `${req.resourceType()} ${res.url().slice(0, 200)} — HTTP ${res.status()}` });
  });

  let n = 0;
  const capturar = async (etiqueta: string) => {
    const file = `${viewport}_${String(++n).padStart(2, "0")}_${etiqueta}.jpg`;
    await page.screenshot({ path: path.join(dirCapturas, file), type: "jpeg", quality: 75 });
    const rel = `${relCapturas}/${file}`;
    r.capturas.push(rel);
    paso({ accion: `Captura: ${etiqueta}`, viewport, captura: rel });
  };

  try {
    paso({ accion: "Cargando la página", viewport });
    const t0 = Date.now();
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: lim.timeoutNavegacionMs });
    // tiempo de respuesta del HTML (mismo criterio que el fetch de antes), no de toda la carga
    const fin = resp?.request().timing().responseEnd ?? -1;
    r.ms = fin > 0 ? Math.round(fin) : Date.now() - t0;
    // ponytail: tope de 10 s — sitios con chat o polling nunca llegan a "networkidle"
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    r.status = resp?.status() ?? null;
    r.urlFinal = page.url();
    r.redireccionado = !!resp?.request().redirectedFrom();
    r.xRobotsTag = resp?.headers()["x-robots-tag"] ?? null;
    await capturar("carga");

    const cookie = await bannerCookies(page);
    if (cookie) {
      paso({ accion: `Banner de cookies: clic en "${cookie}"`, viewport });
      await page.click("[data-sitecheck-clic]", { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(800);
      r.interacciones.push(`Banner de cookies: clic en "${cookie}"`);
    }

    paso({ accion: "Recorriendo la página (lazy loading)", viewport });
    await page.evaluate(async (max) => {
      const paso = innerHeight * 0.8;
      for (let y = 0; y < Math.min(document.documentElement.scrollHeight, max); y += paso) {
        scrollTo({ top: y, behavior: "instant" });
        await new Promise((ok) => setTimeout(ok, 250));
      }
      scrollTo({ top: 0, behavior: "instant" });
    }, lim.maxAlturaScroll);
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});

    r.alturaPagina = await page.evaluate(() => document.documentElement.scrollHeight);
    const pantallas = Math.min(Math.ceil(Math.min(r.alturaPagina, lim.maxAlturaScroll) / vp.alto), lim.maxCapturasPorViewport);
    for (let i = 0; i < pantallas; i++) {
      await page.evaluate((y) => scrollTo({ top: y, behavior: "instant" }), i * vp.alto);
      await page.waitForTimeout(300);
      await capturar(`pantalla-${i + 1}`);
    }
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));

    paso({ accion: "Extrayendo texto renderizado", viewport });
    r.secciones = await textoPorSecciones(page);
    r.html = await page.content();
  } catch (err) {
    r.estado = "error";
    r.error = err instanceof Error ? err.message.split("\n")[0] : String(err);
    paso({ accion: `Error: ${r.error}`, viewport });
  } finally {
    await ctx.close().catch(() => {});
  }
  return r;
}

// Marca el botón para cerrar el banner de cookies y devuelve su texto (o null).
// Prefiere "Rechazar". Solo considera botones dentro de algo que hable de cookies/consent,
// y nunca enlaces que naveguen a otra página.
function bannerCookies(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const RECHAZAR = /^(rechazar( todas?| todo| cookies)?|denegar|reject( all)?|decline( all)?|solo (las )?necesarias|only necessary)$/i;
    const ACEPTAR = /^(aceptar( todas?| todo| cookies)?|accept( all| cookies)?|allow all|permitir todas|entendido|de acuerdo|got it|ok)$/i;
    const CONSENT = /cookie|consent|gdpr|privacidad|privacy/i;
    const enBanner = (el: Element) => {
      for (let p: Element | null = el, i = 0; p && i < 8; p = p.parentElement, i++) {
        if (CONSENT.test(`${p.id} ${String(p.className)} ${p.getAttribute("aria-label") ?? ""}`)) return true;
      }
      const caja = el.closest("div, section, aside, dialog");
      return !!caja && (caja.textContent ?? "").length < 2000 && /cookie/i.test(caja.textContent ?? "");
    };
    const navega = (el: Element) => {
      const href = el.getAttribute("href");
      return el.tagName === "A" && !!href && !href.startsWith("#") && !href.startsWith("javascript:");
    };
    const botones = [...document.querySelectorAll("button, [role=button], a, input[type=button]")].filter(
      (el) => (el as HTMLElement).checkVisibility?.() && !navega(el) && enBanner(el)
    );
    const label = (el: Element) => ((el as HTMLInputElement).value || el.textContent || "").replace(/\s+/g, " ").trim();
    const elegido = botones.find((el) => RECHAZAR.test(label(el))) ?? botones.find((el) => ACEPTAR.test(label(el)));
    if (!elegido) return null;
    elegido.setAttribute("data-sitecheck-clic", "");
    return label(elegido);
  });
}

// Texto visible agrupado por encabezado (h1–h3), en orden de lectura. Funciona aunque el
// sitio no use <section> (ej. Elementor arma todo con <div>).
function textoPorSecciones(page: Page): Promise<Seccion[]> {
  return page.evaluate(() => {
    const MAX_SECCION = 2000;
    const sel = (el: Element) =>
      el.id ? `#${CSS.escape(el.id)}` : el.tagName.toLowerCase() + [...el.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
    const out: { titulo: string; selector: string; texto: string }[] = [];
    let actual = { titulo: "(inicio de página)", selector: "body", textos: [] as string[], el: null as Element | null };
    const cerrar = () => {
      const texto = actual.textos.join("\n").slice(0, MAX_SECCION);
      if (texto) out.push({ titulo: actual.titulo, selector: actual.selector, texto });
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!t || !p || p.closest("script, style, noscript, svg")) continue;
      if (!p.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const h = p.closest("h1, h2, h3");
      if (h) {
        if (h !== actual.el) {
          cerrar();
          actual = { titulo: (h as HTMLElement).innerText.replace(/\s+/g, " ").trim(), selector: sel(h), textos: [], el: h };
        }
        continue;
      }
      actual.textos.push(t);
    }
    cerrar();
    return out.slice(0, 80);
  });
}
