# SiteCheck

App de escritorio (Windows) que monitorea tus sitios (Boden, La Urumpta, Aken,
Amek Group) cada 30 min y los audita con un equipo de agentes de IA que corren
**localmente** con Ollama.

## Instalar

1. Instalá [Ollama](https://ollama.com) y bajá el modelo:
   ```
   winget install Ollama.Ollama
   ollama pull qwen2.5:7b
   ```
2. Ejecutá `dist/SiteCheck Setup 0.1.0.exe`. No está firmado, así que Windows
   SmartScreen avisa: "Más información" → "Ejecutar de todas formas".

Los datos viven en `%APPDATA%\sitecheck\` (`db.json` + carpeta `workspace\`).

## Monitoreo

La app chequea todos los links al iniciar y cada 30 min. Cerrar la ventana la
manda a la bandeja del sistema (junto al reloj) y el monitoreo sigue; desde el
ícono de la bandeja: abrir, chequear ahora, **Iniciar con Windows** (arranca
oculta en la bandeja) y Salir.
Si hay sitios caídos muestra una notificación de Windows y manda un push a
[ntfy](https://ntfy.sh), tópico `sitecheck-amek-5bb261eb27` (suscribite desde la
app ntfy en el celular). Se pueden importar URLs pegando un `sitemap.xml` en el
campo de "Agregar link".

## Agentes de auditoría

Seleccioná URLs en la tabla → **Auditar con agentes**. La conversación se ve en vivo:

```
Navegador (Playwright) → Extractor (código) → Analista · IA 1 ⇄ Revisor · IA 2 → Soluciones
```

- **Navegador**: abre cada URL en Microsoft Edge (sin ventana, vía Playwright) en 5
  tamaños de pantalla (1366×768, 1920×1080, 768×1024, 390×844, 360×800). En cada uno
  cierra el banner de cookies (prefiere "Rechazar"), recorre la página para cargar lo
  diferido, captura cada pantalla y registra los recursos que no cargan, separando los
  que **afectan al usuario** (CSS, JS, imágenes y fuentes propios) de las **advertencias**
  (terceros, errores de JS sin impacto comprobado). El panel muestra esas capturas
  **en vivo**: son las de la misma sesión que se audita. Es de solo lectura: bloquea todo
  envío de formularios, reservas y pagos (y de paso no ensucia GA4 ni el Pixel). Si no
  hay Edge ni Chrome, audita igual con el HTML crudo y lo avisa.
- **Extractor + mediciones (código)**: sobre la página ya renderizada saca los datos SEO
  (status, title, meta, H1/H2, canonical, hreflang, alt, trackers) y **mide**, en cada
  tamaño de pantalla: scroll horizontal, texto cortado, enlaces/botones tapados, imágenes
  deformadas, texto con poco contraste (WCAG AA: 4.5:1, o 3:1 en texto grande), banners
  fijos que tapan más del 30% de la pantalla, botones muy chicos para
  el dedo, el menú móvil (lo abre y cuenta los enlaces) y bloques que se ven en escritorio
  pero no en móvil. En el texto detecta caracteres corruptos (`Ã©`), placeholders
  (`Lorem ipsum`) y bloques en otro idioma. Cada medición lleva un recorte de la captura.
- **Analista (IA 1)**: dos pasadas en JSON: contenido/SEO/SEM con criterio, y
  ortografía/gramática/idioma. Cada error de texto trae la frase original exacta y la
  corrección; **el código verifica que la frase exista literalmente en la página** y
  descarta la que no (así la IA no puede inventar errores).
- **Inspector visual (IA con visión, opcional)**: mira las capturas reales (hasta
  `maxImagenesVision` pantallas por URL, repartidas entre los tamaños) a resolución
  completa y propone problemas visuales que el código no mide (superposiciones, imágenes
  mal recortadas, contraste, elementos rotos). Sus hallazgos son **probables**.
  Requiere un modelo de visión en `modeloVision` (recomendado: `qwen3-vl:8b-instruct`;
  la variante `qwen3-vl:8b` "thinking" no sirve: piensa sin llegar a responder). Si no
  hay modelo de visión, el panel y el reporte lo dicen y no se simula ningún análisis visual.
- **Revisor (IA 2)**: decide hallazgo por hallazgo (aprobar, descartar, devolver con una
  objeción o, para los visuales, **pedir una recaptura**). El Analista responde: mantiene
  citando evidencia, modifica o retira. Una recaptura vuelve a cargar la página en ese
  tamaño, captura la zona ampliada al doble de resolución y el Inspector verifica si el
  problema se ve: solo así un hallazgo visual pasa a **confirmado** (máximo
  `maxRecapturasPorUrl` por URL).
- **Soluciones**: escribe el resumen ejecutivo y el plan de acción citando IDs. La tabla
  de hallazgos, la evidencia y los conteos los arma el código.

Cada hallazgo tiene ID, categoría, prioridad, **estado** (confirmado = medido o verificado
contra el texto · probable = inferido por IA · requiere revisión manual), **origen**
(medido / IA), viewports afectados (el mismo problema en varios tamaños es un solo
hallazgo), ubicación, evidencia, pasos para reproducirlo y recomendación. En el panel,
la pestaña **Hallazgos** los muestra a medida que aparecen; al hacer clic, el visor abre
su captura. El reporte queda en `workspace\proyectos\<proyecto>\<fecha>\` como
`reporte_final_priorizado.md` + `hallazgos.json` + `capturas\`, incluyendo lo que se
descartó y por qué.

Página de prueba con errores plantados: `node scripts/fixture-server.mjs` y auditar
`http://127.0.0.1:8099/` (detalle en `scripts/fixture/README.md`).

Todo el comportamiento se edita en la carpeta `workspace` (botón "Abrir carpeta
de agentes"), sin reinstalar:

| Archivo | Qué controla |
|---|---|
| `AGENTS.md` | Reglas generales que leen todos los agentes |
| `contexto/*.md` | Criterios de prioridad y límites entre áreas (cualquier `.md` nuevo se incluye) |
| `skills/0X_*.md` | La tarea y el formato de salida de cada agente |
| `memoria/memoria.md` | Lo que NO es error (también desde "Agregar a memoria" en la app) |
| `config.json` | `modelo` de Ollama, `rondasDebate`, `contexto` (tokens), `viewports`, `timeoutNavegacionMs`, `maxCapturasPorViewport`, `maxRecortesPorViewport`, `maxAlturaScroll`, `maxBloquesTexto`, `modeloVision`, `maxImagenesVision`, `maxRecapturasPorUrl` |
| `contexto/idioma.md` | Español argentino, marcas que no se traducen, glosario ES↔EN |

## Desarrollo

```
npm install
npm run dev     # web en http://localhost:3000, datos en ./.data, agentes en ./workspace
npm run app     # build + abre la app de escritorio
npm run dist    # build + instalador en dist/
```

Smoke test (con `npm run dev` corriendo): `node scripts/smoke-test.mjs`.

## Qué se dejó afuera (a propósito)

- Sin historial de checks: solo se guarda el último por link.
- Sin firma de código ni auto-update.
