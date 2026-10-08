// Revisión de texto por código (sin IA): caracteres corruptos, placeholders publicados y
// bloques en otro idioma. Lo que requiere criterio (ortografía, redacción) lo hace la IA,
// y sus citas se verifican contra este mismo texto (findings.existeLiteral).
import type { Seccion } from "./browser";

export type ProblemaTexto = {
  regla: string;
  prioridad: "Alta" | "Media";
  estado: "confirmado" | "probable";
  descripcion: string;
  texto: string; // fragmento exacto de la página
  seccion: Seccion;
  idioma: string | null;
  recomendacion: string;
};

// Mojibake típico: UTF-8 leído como Latin-1 ("Ã©" en vez de "é") y el carácter de reemplazo.
const CORRUPTO = /Ã[\u0080-¿]|Ã[¡-ÿ]|â€[™œ“”˜¦\u009D]|Â[ -¿]|�/g;
const PLACEHOLDER = /lorem ipsum(?: dolor sit amet)?|\{\{[^}]{0,40}\}\}|\[object Object\]|texto de (?:ejemplo|prueba)|sample text|placeholder text/gi;
// Sin /i: "todo" en español no es "TODO"; "undefined"/"NaN" solo como restos de código.
const MARCADOR_DEV = /\bTODO\b|\bFIXME\b|\bundefined\b|\bNaN\b/g;

const PALABRAS = {
  es: new Set("de la que el en y los las del se por con una para es al lo como más pero sus su le ya este esta entre cuando muy sin sobre también hasta hay donde desde todo nos durante uno les ni otros ese eso ante ellos esto antes algunos qué unos otro otras otra él tanto esa estos mucho nada muchos cual poco ella estar estas algunas algo nuestro nuestra nuestros nuestras usted ustedes".split(" ")),
  en: new Set("the of and to in is you that it was for on are as with his they at be this have from or one had by but not what all were we when your can there use an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more see way could people my than first been who its now find long down day did get come made may our us".split(" ")),
};

// Idioma de un bloque por palabras frecuentes. null = no hay señal suficiente.
export function detectarIdioma(texto: string): "es" | "en" | null {
  const palabras = texto.toLowerCase().match(/[a-záéíóúñü']+/g) ?? [];
  let es = 0, en = 0;
  for (const p of palabras) {
    if (PALABRAS.es.has(p)) es++;
    if (PALABRAS.en.has(p)) en++;
  }
  if (es + en < 6) return null;
  if (es > en * 2) return "es";
  if (en > es * 2) return "en";
  return null;
}

// El fragmento citado: hasta 25 caracteres alrededor, sin pasar a otra línea de la página.
const contexto = (texto: string, i: number, largo: number) => {
  const ini = Math.max(texto.lastIndexOf("\n", i) + 1, i - 25);
  const finLinea = texto.indexOf("\n", i + largo);
  return texto.slice(ini, Math.min(finLinea === -1 ? texto.length : finLinea, i + largo + 25)).trim();
};

export function revisarTexto(secciones: Seccion[], idiomaPagina: string | null): ProblemaTexto[] {
  const out: ProblemaTexto[] = [];
  const base = idiomaPagina?.slice(0, 2).toLowerCase() ?? null;
  for (const s of secciones) {
    for (const m of s.texto.matchAll(CORRUPTO)) {
      out.push({
        regla: "caracteres-corruptos", prioridad: "Alta", estado: "confirmado",
        descripcion: `Caracteres corruptos (problema de codificación) en la sección "${s.titulo}"`,
        texto: contexto(s.texto, m.index!, m[0].length), seccion: s, idioma: base,
        recomendacion: "Guardar el contenido en UTF-8 y volver a cargar el texto con los acentos correctos",
      });
    }
    for (const m of [...s.texto.matchAll(PLACEHOLDER), ...s.texto.matchAll(MARCADOR_DEV)]) {
      out.push({
        regla: "placeholder-publicado", prioridad: "Alta", estado: "confirmado",
        descripcion: `Texto de prueba o placeholder publicado en la sección "${s.titulo}": "${m[0]}"`,
        texto: contexto(s.texto, m.index!, m[0].length), seccion: s, idioma: base,
        recomendacion: "Reemplazar el texto de prueba por el contenido definitivo",
      });
    }
    const idioma = detectarIdioma(s.texto);
    if (base && idioma && idioma !== base) {
      out.push({
        regla: "mezcla-de-idiomas", prioridad: "Media", estado: "probable",
        descripcion: `Bloque en ${idioma === "en" ? "inglés" : "español"} dentro de una página en ${base === "es" ? "español" : "inglés"} (sección "${s.titulo}")`,
        texto: s.texto.slice(0, 160), seccion: s, idioma,
        recomendacion: "Traducir el bloque o confirmar que es intencional (ej. un nombre propio)",
      });
    }
  }
  return out;
}
