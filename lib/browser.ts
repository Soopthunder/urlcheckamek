// Navegación real con Playwright: carga cada URL en cada viewport, maneja el banner de
// cookies, recorre la página, captura pantallas y registra errores de carga.
//
// Solo lectura: se abortan todos los pedidos que no sean GET/HEAD/OPTIONS (formularios,
// reservas, pagos — y de paso las auditorías no ensucian GA4 ni el Pixel), y los únicos
// clics posibles son los del banner de cookies. Cada interacción queda registrada.
import { chromium, type Browser, type Page } from "playwright-core";
import { promises as fs } from "fs";
import path from "path";
import { medirPagina, medirPantalla, ubicarMarca, marcarMenuMovil, contarEnlacesVisibles, type Medicion } from "./measure";

export type Viewport = { ancho: number; alto: number; movil?: boolean };
export type Limites = {
  timeoutNavegacionMs: number;
  maxCapturasPorViewport: number;
  maxRecortesPorViewport: number;
  maxAlturaScroll: number;
};
export type MedicionConEvidencia = Omit<Medicion, "marca" | "rectPantalla"> & { capturas: string[] };
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
  mediciones: MedicionConEvidencia[];
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

// Sesión de solo lectura: aborta todo lo que no sea GET/HEAD/OPTIONS y bloquea service workers.
async function nuevoContexto(browser: Browser, vp: Viewport, alBloquear: () => void, escala = vp.movil ? 2 : 1) {
  const ctx = await browser.newContext({
    viewport: { width: vp.ancho, height: vp.alto },
    deviceScaleFactor: escala,
    isMobile: !!vp.movil,
    hasTouch: !!vp.movil,
    userAgent: vp.movil ? MOBILE_UA : undefined,
    serviceWorkers: "block", // un SW podría saltear el bloqueo de pedidos de abajo
    acceptDownloads: false,
  });
  await ctx.route("**/*", (route) => {
    const m = route.request().method();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") return route.continue();
    alBloquear();
    return route.abort("blockedbyclient");
  });
  return ctx;
}

// Clic no destructivo sobre el elemento marcado con data-sitecheck-clic. Si Playwright no
// puede confirmar que está "estable" (pasa en móvil con la página achicada), se dispara el
// clic del DOM sobre el mismo botón.
const clic = (page: Page) =>
  page.click("[data-sitecheck-clic]", { timeout: 3000 }).catch(() =>
    page.evaluate(() => (document.querySelector("[data-sitecheck-clic]") as HTMLElement | null)?.click())
  );

// Grilla de 3×3 sobre la pantalla: es como el inspector visual dice dónde está un problema.
const ZONAS: Record<string, [number, number]> = {
  "arriba-izquierda": [0, 0], arriba: [1, 0], "arriba-derecha": [2, 0],
  izquierda: [0, 1], centro: [1, 1], derecha: [2, 1],
  "abajo-izquierda": [0, 2], abajo: [1, 2], "abajo-derecha": [2, 2],
};
export const ZONAS_VALIDAS = Object.keys(ZONAS);

// Recaptura pedida por el Revisor: vuelve a cargar la página en el mismo tamaño, baja hasta
// la misma pantalla y captura la zona ampliada (doble resolución) para verificar un hallazgo
// visual. Sesión nueva y de solo lectura, como la original.
export async function recapturar(
  browser: Browser, url: string, vp: Viewport, lim: Limites, scrollY: number, zona: string,
  dirCapturas: string, relCapturas: string, etiqueta: string, paso: (p: PasoNavegador) => void
): Promise<string | null> {
  const viewport = nombreViewport(vp);
  const ctx = await nuevoContexto(browser, vp, () => {}, 2);
  try {
    const page = await ctx.newPage();
    paso({ accion: `Recaptura pedida por el Revisor (${etiqueta}): cargando`, viewport });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: lim.timeoutNavegacionMs });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    if (await bannerCookies(page)) {
      await clic(page);
      await page.waitForTimeout(800);
    }
    // recorrer hasta la posición para que cargue lo diferido, igual que en la pasada original
    await page.evaluate(async (y) => {
      for (let p = 0; p < y; p += innerHeight * 0.8) {
        scrollTo({ top: p, behavior: "instant" });
        await new Promise((ok) => setTimeout(ok, 200));
      }
      scrollTo({ top: y, behavior: "instant" });
    }, scrollY);
    await page.waitForTimeout(600);
    const achicada = (await page.evaluate(() => innerWidth)) > vp.ancho + 1;
    const [cx, cy] = ZONAS[zona] ?? ZONAS.centro;
    const cw = vp.ancho / 3, ch = vp.alto / 3;
    // la celda señalada, ampliada a 2×2 celdas centradas en ella para no perder contexto
    const clip = achicada
      ? undefined
      : {
          x: Math.min(Math.max(0, cx * cw - cw / 2), vp.ancho - 2 * cw),
          y: Math.min(Math.max(0, cy * ch - ch / 2), vp.alto - 2 * ch),
          width: 2 * cw,
          height: 2 * ch,
        };
    const file = `${viewport}_recaptura-${etiqueta}.jpg`;
    await page.screenshot({ path: path.join(dirCapturas, file), type: "jpeg", quality: 85, clip });
    const rel = `${relCapturas}/${file}`;
    paso({ accion: `Recaptura ampliada: ${zona}`, viewport, captura: rel });
    return rel;
  } catch {
    return null;
  } finally {
    await ctx.close().catch(() => {});
  }
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
    html: "", secciones: [], mediciones: [],
  };
  await fs.mkdir(dirCapturas, { recursive: true });

  const ctx = await nuevoContexto(browser, vp, () => r.pedidosBloqueados++);
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
  const capturar = async (etiqueta: string, clip?: { x: number; y: number; width: number; height: number }) => {
    const file = `${viewport}_${String(++n).padStart(2, "0")}_${etiqueta}.jpg`;
    await page.screenshot({ path: path.join(dirCapturas, file), type: "jpeg", quality: 80, clip });
    const rel = `${relCapturas}/${file}`;
    r.capturas.push(rel);
    paso({ accion: `Captura: ${etiqueta}`, viewport, captura: rel });
    return rel;
  };
  // Recorte de evidencia de una medición; respeta el tope de recortes por viewport.
  let recortes = 0;
  const conEvidencia = async (m: Medicion, extra: string[] = []): Promise<MedicionConEvidencia> => {
    const { marca, rectPantalla, ...resto } = m;
    const capturas = [...extra];
    // Si la página es más ancha que el teléfono, el navegador móvil la achica para que entre
    // y las coordenadas ya no coinciden con la captura: en ese caso la pantalla completa
    // (que muestra la página achicada) es la evidencia.
    const ancho = page.viewportSize()?.width ?? vp.ancho;
    const achicada = (await page.evaluate(() => innerWidth)) > ancho + 1;
    if (achicada) {
      if (!capturas.length) capturas.push(...r.capturas.filter((c) => c.includes("_pantalla-1")));
    } else if (recortes < lim.maxRecortesPorViewport && (marca || rectPantalla)) {
      const area = marca
        ? await ubicarMarca(page, marca)
        : rectPantalla && { x: rectPantalla.x, y: rectPantalla.y, width: rectPantalla.w, height: rectPantalla.h };
      const clip = area && {
        x: area.x,
        y: area.y,
        width: Math.min(area.width, ancho - area.x),
        height: Math.min(area.height, vp.alto - area.y),
      };
      if (clip && clip.width >= 10 && clip.height >= 10) {
        recortes++;
        // un recorte fallido no puede tirar abajo la auditoría del viewport
        const rel = await capturar(`recorte-${m.regla}`, clip).catch(() => null);
        if (rel) capturas.push(rel);
      }
    }
    return { ...resto, capturas };
  };
  const clicMarcado = () => clic(page);

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
      await clicMarcado();
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

    paso({ accion: "Midiendo desbordes, texto cortado e imágenes", viewport });
    const dePagina = await medirPagina(page, !!vp.movil);

    r.alturaPagina = await page.evaluate(() => document.documentElement.scrollHeight);
    const pantallas = Math.min(Math.ceil(Math.min(r.alturaPagina, lim.maxAlturaScroll) / vp.alto), lim.maxCapturasPorViewport);
    const vistas = new Set<string>();
    for (let i = 0; i < pantallas; i++) {
      await page.evaluate((y) => scrollTo({ top: y, behavior: "instant" }), i * vp.alto);
      await page.waitForTimeout(300);
      const pantalla = await capturar(`pantalla-${i + 1}`);
      paso({ accion: `Buscando elementos tapados (pantalla ${i + 1})`, viewport });
      for (const m of await medirPantalla(page, i === 0, i === pantallas - 1)) {
        const clave = `${m.regla}|${m.selector}`;
        if (vistas.has(clave)) continue; // el mismo banner fijo aparece en todas las pantallas
        vistas.add(clave);
        r.mediciones.push(await conEvidencia(m, [pantalla]));
      }
    }
    for (const m of dePagina) r.mediciones.push(await conEvidencia(m));
    await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: "instant" }));

    paso({ accion: "Extrayendo texto renderizado", viewport });
    r.secciones = await textoPorSecciones(page);
    r.html = await page.content();

    if (vp.movil) {
      paso({ accion: "Probando el menú móvil", viewport });
      const menu = await marcarMenuMovil(page);
      if (!menu.encontrado) {
        if (menu.enlacesVisibles === 0) {
          r.mediciones.push({
            regla: "menu-movil-no-encontrado", categoria: "Navegación", prioridad: "Media", estado: "requiere revisión manual",
            descripcion: "No se encontró un botón de menú ni enlaces de navegación visibles arriba de la página",
            medicion: "0 enlaces visibles en la primera pantalla y ningún botón con aria-expanded o clase de menú",
            recomendacion: "Verificar a mano que el menú sea accesible en este tamaño",
            capturas: r.capturas.filter((c) => c.includes("_pantalla-1")),
          });
        }
      } else {
        await clicMarcado();
        await page.waitForTimeout(800);
        const despues = await contarEnlacesVisibles(page);
        const abierto = await capturar("menu-abierto");
        r.interacciones.push(`Menú móvil: clic en el botón de menú (${menu.enlacesVisibles} → ${despues} enlaces visibles)`);
        if (despues <= menu.enlacesVisibles) {
          r.mediciones.push({
            regla: "menu-movil-no-abre", categoria: "Navegación", prioridad: "Alta", estado: "requiere revisión manual",
            descripcion: "Al tocar el botón de menú no aparecen enlaces nuevos: el menú podría no abrir",
            medicion: `enlaces visibles antes ${menu.enlacesVisibles}, después ${despues}`,
            recomendacion: "Verificar que el menú móvil abra y muestre las secciones del sitio",
            capturas: [...r.capturas.filter((c) => c.includes("_pantalla-1")), abierto],
          });
        }
      }
    }
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
