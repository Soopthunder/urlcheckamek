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
- **Extractor**: sobre la página ya renderizada, saca datos duros (status, title, meta, H1/H2,
  canonical, hreflang, alt, trackers GA4/GTM/Pixel/SynXis, tiempo de respuesta).
  No es IA, así los agentes no pueden inventar datos.
- **Analista**: lista problemas citando el dato que los prueba.
- **Revisor**: descarta falsos positivos, prioriza (Crítica/Alta/Media/Baja) y si
  el reporte está mal se lo **devuelve** al Analista con objeciones. Discuten
  hasta que aprueba o se acaban las rondas.
- **Soluciones**: arma el reporte final por área (SEO, SEM, Técnica, Contenido/UX)
  y lo guarda en `workspace\proyectos\<proyecto>\<fecha>\reporte_final_priorizado.md`,
  junto a la carpeta `capturas\` y una sección de evidencia por tamaño de pantalla.

Todo el comportamiento se edita en la carpeta `workspace` (botón "Abrir carpeta
de agentes"), sin reinstalar:

| Archivo | Qué controla |
|---|---|
| `AGENTS.md` | Reglas generales que leen todos los agentes |
| `contexto/*.md` | Criterios de prioridad y límites entre áreas (cualquier `.md` nuevo se incluye) |
| `skills/0X_*.md` | La tarea y el formato de salida de cada agente |
| `memoria/memoria.md` | Lo que NO es error (también desde "Agregar a memoria" en la app) |
| `config.json` | `modelo` de Ollama, `rondasDebate`, `contexto` (tokens), `viewports`, `timeoutNavegacionMs`, `maxCapturasPorViewport`, `maxAlturaScroll` |

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
