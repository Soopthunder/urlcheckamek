// Mediciones responsive hechas por código dentro de la página (page.evaluate).
// Todo lo que sale de acá es "medido": un dato del navegador, no una opinión de la IA.
// Las funciones que se pasan a evaluate corren en el navegador, así que no pueden usar
// nada de este módulo: cada una trae sus propios helpers.
import type { Page } from "playwright-core";
import type { Prioridad } from "./findings";

export type Medicion = {
  regla: string; // id estable para agrupar el mismo problema entre viewports
  categoria: "Responsive" | "Visual" | "Navegación";
  prioridad: Prioridad;
  estado: "confirmado" | "requiere revisión manual";
  descripcion: string;
  selector?: string;
  medicion: string;
  recomendacion: string;
  marca?: string; // data-sitecheck-m del elemento, para recortarlo después
  rectPantalla?: { x: number; y: number; w: number; h: number }; // recorte inmediato (coords de viewport)
};

// --- helpers que se inyectan en la página (como texto) ------------------------------
const HELPERS = `
  const sel = (el) => {
    const parte = (e) => e.id ? "#" + CSS.escape(e.id)
      : e.tagName.toLowerCase() + [...e.classList].filter(c => !/^(elementor-element-|e-con-|is-|has-)/.test(c)).slice(0, 2).map(c => "." + CSS.escape(c)).join("");
    const partes = [];
    for (let e = el, i = 0; e && e !== document.body && i < 3; e = e.parentElement, i++) {
      partes.unshift(parte(e));
      if (e.id) break;
    }
    return partes.join(" > ");
  };
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  };
  const fijo = (el) => {
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === "fixed" || pos === "sticky") return p;
    }
    return null;
  };
  const texto = (el) => (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.value || "").replace(/\\s+/g, " ").trim().slice(0, 60);
  let marcas = 0;
  const marcar = (el) => { const m = "m" + Date.now().toString(36) + (marcas++); el.setAttribute("data-sitecheck-m", m); return m; };
`;
const enPagina = <A, R>(cuerpo: string) => new Function("arg", `${HELPERS}\n${cuerpo}`) as (arg: A) => R;

// Mediciones de la página completa (se corren una vez por viewport, arriba de todo).
const medirPaginaFn = enPagina<{ movil: boolean }, Medicion[]>(`
  const { movil } = arg;
  const out = [];
  const vw = document.documentElement.clientWidth;

  // 1. Desbordamiento horizontal: la página es más ancha que la pantalla.
  const sw = document.documentElement.scrollWidth;
  if (sw > vw + 1) {
    const recorta = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== "visible") return true;
      }
      return false;
    };
    const culpables = [...document.body.querySelectorAll("*")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > vw + 1 && vis(el) && !recorta(el) && !fijo(el);
    });
    const raices = culpables.filter((el) => !culpables.some((o) => o !== el && o.contains(el))).slice(0, 5);
    for (const el of raices) {
      const r = el.getBoundingClientRect();
      out.push({
        regla: "desborde-horizontal", categoria: "Responsive", prioridad: movil ? "Alta" : "Media", estado: "confirmado",
        descripcion: "La página es más ancha que la pantalla: aparece scroll horizontal",
        selector: sel(el), marca: marcar(el),
        medicion: "ancho de la página " + sw + "px > pantalla " + vw + "px; este elemento llega hasta " + Math.round(r.right + scrollX) + "px",
        recomendacion: "Limitar el ancho del elemento (max-width: 100%) o revisar márgenes/anchos fijos en este tamaño",
      });
    }
  }

  // 2. Texto cortado por overflow hidden/clip.
  let cortados = 0;
  for (const el of document.body.querySelectorAll("*")) {
    if (cortados >= 10) break;
    const propio = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2);
    if (!propio || !vis(el)) continue;
    const cs = getComputedStyle(el);
    const corta = (o) => o === "hidden" || o === "clip";
    const x = corta(cs.overflowX) && el.scrollWidth > el.clientWidth + 2;
    const y = corta(cs.overflowY) && el.scrollHeight > el.clientHeight + 2;
    if (!x && !y) continue;
    const intencional = cs.textOverflow === "ellipsis" || (cs.webkitLineClamp && cs.webkitLineClamp !== "none");
    cortados++;
    out.push({
      regla: "texto-cortado", categoria: "Responsive",
      prioridad: intencional ? "Baja" : "Media",
      estado: intencional ? "requiere revisión manual" : "confirmado",
      descripcion: (intencional ? "Texto truncado con puntos suspensivos: " : "Texto cortado, no se lee completo: ") + '"' + texto(el) + '"',
      selector: sel(el), marca: marcar(el),
      medicion: "contenido " + el.scrollWidth + "×" + el.scrollHeight + "px en una caja de " + el.clientWidth + "×" + el.clientHeight + "px (overflow " + cs.overflowX + "/" + cs.overflowY + ")",
      recomendacion: intencional ? "Confirmar que el texto truncado no oculta información importante" : "Dejar crecer la caja (alto/ancho automático) o reducir el texto en este tamaño",
    });
  }

  // 3. Imágenes deformadas: proporción mostrada distinta de la original.
  for (const img of document.images) {
    if (!img.naturalWidth || !vis(img)) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 50 || r.height < 50 || getComputedStyle(img).objectFit !== "fill") continue;
    const nat = img.naturalWidth / img.naturalHeight, ren = r.width / r.height;
    const dif = Math.abs(ren - nat) / nat;
    if (dif <= 0.05) continue;
    out.push({
      regla: "imagen-deformada", categoria: "Visual", prioridad: "Media", estado: "confirmado",
      descripcion: "Imagen estirada o aplastada" + (img.alt ? ': "' + img.alt.slice(0, 50) + '"' : ""),
      selector: sel(img), marca: marcar(img),
      medicion: "original " + img.naturalWidth + "×" + img.naturalHeight + " (" + nat.toFixed(2) + "), mostrada " + Math.round(r.width) + "×" + Math.round(r.height) + " (" + ren.toFixed(2) + "): " + Math.round(dif * 100) + "% de diferencia",
      recomendacion: "Usar object-fit: cover/contain o respetar la proporción de la imagen (height: auto)",
    });
  }

  // 4. Objetivos táctiles chicos en móvil (WCAG 2.2: mínimo 24×24 px).
  if (movil) {
    const chicos = [...document.querySelectorAll("a[href], button, [role=button], input:not([type=hidden]), select")].filter((el) => {
      if (!vis(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width >= 24 && r.height >= 24) return false;
      return !(getComputedStyle(el).display === "inline" && el.closest("p, li, td"));
    });
    if (chicos.length) {
      out.push({
        regla: "objetivo-tactil-chico", categoria: "Navegación", prioridad: "Baja", estado: "confirmado",
        descripcion: chicos.length + " enlace(s)/botón(es) miden menos de 24×24 px y son difíciles de tocar",
        selector: sel(chicos[0]), marca: marcar(chicos[0]),
        medicion: chicos.slice(0, 5).map((el) => { const r = el.getBoundingClientRect(); return sel(el) + " (" + Math.round(r.width) + "×" + Math.round(r.height) + ")"; }).join("; "),
        recomendacion: "Agrandar el área táctil a 24×24 px o más (padding), sin cambiar el tamaño visual si no hace falta",
      });
    }
  }
  return out;
`);

// Mediciones de lo que se ve en la pantalla actual (se corren en cada posición de scroll).
const medirPantallaFn = enPagina<{ esPrimera: boolean; esUltima: boolean }, Medicion[]>(`
  const { esPrimera, esUltima } = arg;
  const out = [];
  const vw = innerWidth, vh = innerHeight;
  const enPantalla = (r) => ({ x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(vw, r.right) - Math.max(0, r.left), h: Math.min(vh, r.bottom) - Math.max(0, r.top) });

  // 1. Elementos fijos (banners, popups, barras) que tapan más del 30% de la pantalla.
  const fijos = [...document.body.querySelectorAll("*")].filter((el) => {
    const pos = getComputedStyle(el).position;
    return (pos === "fixed" || pos === "sticky") && vis(el);
  });
  for (const el of fijos.filter((el) => !fijos.some((o) => o !== el && o.contains(el)))) {
    const r = el.getBoundingClientRect();
    const v = enPantalla(r);
    if (v.w <= 0 || v.h <= 0 || (v.w * v.h) / (vw * vh) <= 0.3) continue;
    const arriba = document.elementFromPoint(v.x + v.w / 2, v.y + v.h / 2);
    if (!arriba || !(arriba === el || el.contains(arriba))) continue; // está detrás del contenido (fondo)
    out.push({
      regla: "elemento-fijo-grande", categoria: "Responsive", prioridad: "Alta", estado: "confirmado",
      descripcion: "Un elemento fijo tapa " + Math.round((v.w * v.h) / (vw * vh) * 100) + "% de la pantalla" + (texto(el) ? ': "' + texto(el) + '"' : ""),
      selector: sel(el), rectPantalla: v,
      medicion: "position " + getComputedStyle(el).position + ", " + Math.round(v.w) + "×" + Math.round(v.h) + "px sobre una pantalla de " + vw + "×" + vh + "px",
      recomendacion: "Achicar el elemento o permitir cerrarlo; en móvil, que no tape el contenido principal",
    });
  }

  // 2. Enlaces y botones tapados por otro elemento (elementFromPoint en su centro).
  const objetivos = [...document.querySelectorAll("a[href], button, [role=button], input:not([type=hidden]), select, textarea")].filter(vis);
  let tapados = 0;
  for (const t of objetivos) {
    if (tapados >= 8) break;
    const r = t.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || hit === t || t.contains(hit) || hit.contains(t)) continue;
    const tapa = fijo(hit);
    if (tapa && tapa.contains(t)) continue; // mismo menú/barra fija
    if (tapa && !fijo(t)) {
      // un elemento fijo se mueve al hacer scroll: solo es un problema si no se puede destapar
      const c = tapa.getBoundingClientRect();
      const arriba = c.top + c.height / 2 < vh / 2;
      if (arriba ? !esPrimera : !esUltima) continue;
    }
    tapados++;
    const m = 30;
    out.push({
      regla: "elemento-tapado", categoria: "Responsive", prioridad: "Alta", estado: "confirmado",
      descripcion: '"' + (texto(t) || sel(t)) + '" queda tapado por otro elemento y no se puede tocar',
      selector: sel(t),
      rectPantalla: { x: Math.max(0, r.left - m), y: Math.max(0, r.top - m), w: Math.min(vw, r.right + m) - Math.max(0, r.left - m), h: Math.min(vh, r.bottom + m) - Math.max(0, r.top - m) },
      medicion: "en su centro (" + Math.round(cx) + ", " + Math.round(cy) + ") el elemento de arriba es " + sel(hit),
      recomendacion: "Reubicar o dar margen al elemento que lo tapa (" + sel(tapa || hit) + "), o subir el z-index del botón",
    });
  }
  return out;
`);

export const medirPagina = (page: Page, movil: boolean) => page.evaluate(medirPaginaFn, { movil });
export const medirPantalla = (page: Page, esPrimera: boolean, esUltima: boolean) =>
  page.evaluate(medirPantallaFn, { esPrimera, esUltima });

// Lleva el elemento marcado al centro de la pantalla y devuelve el área a recortar.
export const ubicarMarca = (page: Page, marca: string) =>
  page.evaluate((m) => {
    const el = document.querySelector(`[data-sitecheck-m="${m}"]`);
    if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const r = el.getBoundingClientRect();
    const pad = 40;
    const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad);
    const w = Math.min(innerWidth, r.right + pad) - x, h = Math.min(innerHeight, r.bottom + pad) - y;
    return w >= 10 && h >= 10 ? { x, y, width: w, height: h } : null;
  }, marca);

// Menú móvil: busca el botón de menú, lo abre (clic no destructivo) y mide si aparecen enlaces.
export const marcarMenuMovil = (page: Page) =>
  page.evaluate(() => {
    const visibles = () =>
      [...document.querySelectorAll("a[href]")].filter((a) => {
        const r = a.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && a.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      }).length;
    const PATRON = /menu|menú|hamburg|burger|toggle|nav-?icon|offcanvas/i;
    const candidatos = [...document.querySelectorAll("button, [role=button], a, div, span")].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.top > 250 || r.width > 120 || r.height > 120) return false;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      const href = el.closest("a[href]")?.getAttribute("href");
      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) return false; // el clic navegaría
      const desc = `${el.id} ${String(el.className)} ${el.getAttribute("aria-label") ?? ""}`;
      return el.hasAttribute("aria-expanded") || (el.hasAttribute("aria-controls") && PATRON.test(desc)) || PATRON.test(desc);
    });
    // el más interno (el ícono suele estar dentro del contenedor que también matchea)
    const boton = candidatos.find((el) => !candidatos.some((o) => o !== el && el.contains(o))) ?? null;
    document.querySelectorAll("[data-sitecheck-clic]").forEach((e) => e.removeAttribute("data-sitecheck-clic"));
    if (boton) boton.setAttribute("data-sitecheck-clic", "");
    return { encontrado: !!boton, enlacesVisibles: visibles() };
  });

export const contarEnlacesVisibles = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("a[href]")].filter((a) => {
        const r = a.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && a.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      }).length
  );
