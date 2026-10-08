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
Extractor (código) → Analista · IA 1 ⇄ Revisor · IA 2 → Soluciones
```

- **Extractor**: descarga cada URL y saca datos duros (status, title, meta, H1/H2,
  canonical, hreflang, alt, trackers GA4/GTM/Pixel/SynXis, tiempo de respuesta).
  No es IA, así los agentes no pueden inventar datos.
- **Analista**: lista problemas citando el dato que los prueba.
- **Revisor**: descarta falsos positivos, prioriza (Crítica/Alta/Media/Baja) y si
  el reporte está mal se lo **devuelve** al Analista con objeciones. Discuten
  hasta que aprueba o se acaban las rondas.
- **Soluciones**: arma el reporte final por área (SEO, SEM, Técnica, Contenido/UX)
  y lo guarda en `workspace\proyectos\<proyecto>\reporte_final_priorizado_<fecha>.md`.

Todo el comportamiento se edita en la carpeta `workspace` (botón "Abrir carpeta
de agentes"), sin reinstalar:

| Archivo | Qué controla |
|---|---|
| `AGENTS.md` | Reglas generales que leen todos los agentes |
| `contexto/*.md` | Criterios de prioridad y límites entre áreas (cualquier `.md` nuevo se incluye) |
| `skills/0X_*.md` | La tarea y el formato de salida de cada agente |
| `memoria/memoria.md` | Lo que NO es error (también desde "Agregar a memoria" en la app) |
| `config.json` | `modelo` de Ollama, `rondasDebate`, `contexto` (tokens) |

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
- El Extractor lee HTML crudo: sitios 100% renderizados con JS necesitarían Playwright.
