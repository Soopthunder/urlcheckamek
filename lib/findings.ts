// Formato único de hallazgo: lo usan las mediciones por código, los agentes de IA, el
// visor y el reporte. Sin imports de la app, así scripts/check-findings.ts lo prueba solo.

export type Prioridad = "Crítica" | "Alta" | "Media" | "Baja";
export type Estado = "confirmado" | "probable" | "requiere revisión manual";
export type Origen = "medido" | "ia-texto" | "ia-visual";

export type Hallazgo = {
  id: string;
  url: string;
  categoria: string; // SEO, SEM, Técnica, Contenido/UX, Responsive, Visual, Navegación, Lingüística, Traducción
  prioridad: Prioridad;
  estado: Estado;
  origen: Origen;
  viewports: string[]; // ["todos"] si no depende del tamaño de pantalla
  idioma: string | null;
  descripcion: string;
  ubicacion?: string;
  evidencia: { capturas?: string[]; texto?: string; medicion?: string };
  correccion?: string; // errores lingüísticos: el texto corregido
  textoOtroIdioma?: string; // traducción: el fragmento equivalente en la otra versión
  pasos: string[];
  recomendacion: string;
  regla?: string; // clave interna para agrupar el mismo problema entre viewports
};

export type Descartado = { url: string; descripcion: string; origen: Origen; motivo: string };

const ORDEN: Record<Prioridad, number> = { Crítica: 0, Alta: 1, Media: 2, Baja: 3 };
const ORDEN_ESTADO: Record<Estado, number> = { confirmado: 0, probable: 1, "requiere revisión manual": 2 };

// Comparación tolerante a espacios, comillas tipográficas y mayúsculas de CSS (text-transform).
export const norm = (s: string) =>
  s.normalize("NFC").replace(/[‘’´`]/g, "'").replace(/[“”«»]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

// Anti-invención: un error de texto solo vale si la frase citada existe tal cual en la página.
export const existeLiteral = (cita: string, texto: string) => norm(cita).length >= 2 && norm(texto).includes(norm(cita));

// El mismo problema en varios tamaños de pantalla = un solo hallazgo con varios viewports.
export function agrupar(hs: Omit<Hallazgo, "id">[]): Omit<Hallazgo, "id">[] {
  const porClave = new Map<string, Omit<Hallazgo, "id">>();
  for (const h of hs) {
    const clave = [h.url, h.categoria, h.regla ?? h.descripcion, h.ubicacion ?? "", h.evidencia.texto ?? ""].join("|");
    const prev = porClave.get(clave);
    if (!prev) {
      porClave.set(clave, { ...h, viewports: [...h.viewports], evidencia: { ...h.evidencia } });
      continue;
    }
    prev.viewports = [...new Set([...prev.viewports, ...h.viewports])];
    prev.evidencia.capturas = [...new Set([...(prev.evidencia.capturas ?? []), ...(h.evidencia.capturas ?? [])])];
    if (ORDEN[h.prioridad] < ORDEN[prev.prioridad]) prev.prioridad = h.prioridad; // queda la peor
  }
  return [...porClave.values()];
}

export function ordenar<T extends Omit<Hallazgo, "id">>(hs: T[]): T[] {
  return [...hs].sort(
    (a, b) => ORDEN[a.prioridad] - ORDEN[b.prioridad] || ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || a.categoria.localeCompare(b.categoria)
  );
}

export const prefijo = (url: string) =>
  new URL(url).hostname.replace(/^www\./, "").replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase() || "URL";

const ETIQUETA_ORIGEN: Record<Origen, string> = { medido: "medido por código", "ia-texto": "IA (texto)", "ia-visual": "IA (visión)" };

// Reporte Markdown armado por código: la IA no puede perder ni inventar filas.
// `base` = ruta relativa desde el .md hasta la carpeta proyectos/ (para los links a capturas).
export function renderMd(hs: Hallazgo[], base: string): string {
  if (!hs.length) return "_Sin hallazgos._\n";
  const tabla =
    "| ID | Prioridad | Categoría | Estado | Origen | Viewports | Problema |\n|---|---|---|---|---|---|---|\n" +
    hs
      .map((h) =>
        `| ${h.id} | ${h.prioridad} | ${h.categoria} | ${h.estado} | ${ETIQUETA_ORIGEN[h.origen]} | ${h.viewports.join(", ")} | ${h.descripcion.replace(/\|/g, "/")} |`
      )
      .join("\n");
  const fichas = hs
    .map((h) => {
      const lineas = [
        `#### ${h.id} · ${h.prioridad} · ${h.categoria}`,
        `- **URL**: ${h.url}`,
        `- **Estado**: ${h.estado} · **Origen**: ${ETIQUETA_ORIGEN[h.origen]} · **Viewports**: ${h.viewports.join(", ")}${h.idioma ? ` · **Idioma**: ${h.idioma}` : ""}`,
        `- **Descripción**: ${h.descripcion}`,
        h.ubicacion ? `- **Ubicación**: \`${h.ubicacion}\`` : "",
        h.evidencia.texto ? `- **Texto original**: «${h.evidencia.texto}»` : "",
        h.correccion ? `- **Corrección propuesta**: «${h.correccion}»` : "",
        h.textoOtroIdioma ? `- **Texto en la otra versión**: «${h.textoOtroIdioma}»` : "",
        h.evidencia.medicion ? `- **Medición**: ${h.evidencia.medicion}` : "",
        h.evidencia.capturas?.length
          ? `- **Capturas**: ${h.evidencia.capturas.map((c) => `[${c.split("/").pop()}](${base}${c})`).join(" · ")}`
          : "",
        h.pasos.length ? `- **Cómo reproducirlo**: ${h.pasos.map((p, i) => `${i + 1}. ${p}`).join(" ")}` : "",
        `- **Recomendación**: ${h.recomendacion}`,
      ];
      return lineas.filter(Boolean).join("\n");
    })
    .join("\n\n");
  return `${tabla}\n\n${fichas}\n`;
}

// Cuántos hallazgos hay por categoría y prioridad (primera tabla del reporte unificado).
export function resumenPorCategoria(hs: Hallazgo[]): string {
  const cats = [...new Set(hs.map((h) => h.categoria))].sort();
  const prios: Prioridad[] = ["Crítica", "Alta", "Media", "Baja"];
  const fila = (c: string) => {
    const de = hs.filter((h) => h.categoria === c);
    return `| ${c} | ${prios.map((p) => de.filter((h) => h.prioridad === p).length || "").join(" | ")} | ${de.length} | ${de.filter((h) => h.estado === "confirmado").length} |`;
  };
  return "| Categoría | Crítica | Alta | Media | Baja | Total | Confirmados |\n|---|---|---|---|---|---|---|\n" + cats.map(fila).join("\n") + "\n";
}
