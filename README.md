# SiteCheck

Monitor de status para tus sitios (Boden, La Urumpta, Aken, Amek Group).
Chequea cada link, guarda status/latencia, deja agregar/quitar links desde
la UI, y genera reportes de mejora on-demand con Google PageSpeed Insights
(gratis).

## Deploy en Vercel

1. Subí esta carpeta a un repo de GitHub y conectalo en vercel.com/new
   (o `npx vercel` desde acá).
2. **Storage**: en el proyecto de Vercel → Storage → Marketplace → agregá
   una integración **Redis** (Upstash, tiene free tier). Esto setea solas
   las env vars `KV_REST_API_URL` / `KV_REST_API_TOKEN`.
   - Sin esto, la app funciona igual pero guarda todo en un archivo local
     que se borra en cada deploy — solo sirve para probar en tu compu.
3. **Env vars** (Project Settings → Environment Variables):
   - `CRON_SECRET`: cualquier string random, protege `/api/check`.
   - `PAGESPEED_API_KEY` (opcional): sin ella también funciona, con cuota
     más chica. Se saca gratis en Google Cloud Console → APIs & Services →
     Credentials → "PageSpeed Insights API".
4. Deploy.

## El check cada 30 minutos

Vercel Cron en el plan Hobby (gratis) solo permite **1 corrida por día**,
no cada 30 min. Para el intervalo real hay que pingear el endpoint desde
afuera:

1. Andá a [cron-job.org](https://cron-job.org) (gratis, sin límite de
   frecuencia razonable) o [EasyCron](https://www.easycron.com).
2. Creá un cron job que haga `GET` cada 30 min a:
   `https://tu-app.vercel.app/api/check?secret=EL_CRON_SECRET`

Eso corre el chequeo de todos los links y guarda los resultados. El
dashboard los lee y se refresca solo cada minuto. También hay un botón
"Chequear ahora" para forzarlo manualmente.

Si en algún momento pasás a un plan pago de Vercel, `vercel.json` puede
llevar un `crons` nativo cada 30 min en vez del servicio externo.

## Desarrollo local

```bash
npm install
npm run dev
```

Sin `KV_REST_API_URL` seteada, usa un archivo `.data/db.json` como base
de datos (se crea solo). Sirve para probar la UI, pero no para producción
(el filesystem de Vercel es efímero).

## Test automático (Playwright)

```bash
npm run build && npm start &
node scripts/smoke-test.mjs http://localhost:3000
```

Abre el dashboard, corre `/api/check`, agrega y borra un link de prueba.
Corrido acá mismo confirmó que todo el flujo anda — el único "fallo" que
vas a ver en este sandbox es que todos los links salen "caídos" porque
este entorno no tiene salida a internet abierta, no por un bug de la app.

## Cómo decide qué está "mal" en un sitio

`/api/check` pega un `fetch` a cada URL (no un browser completo — no hace
falta renderizar para saber si un sitio responde, y así 130 links tardan
segundos en vez de minutos). Status < 400 = OK. Si querés un chequeo más
profundo (JS roto, errores de consola, contenido faltante) con Playwright
renderizando cada página, se puede agregar un endpoint separado que corra
bajo demanda — no conviene meterlo en el barrido de cada 30 min por
tiempo/costo en serverless.

## Qué se dejó afuera (a propósito)

- Sin login/auth en la UI — si necesitás que no sea pública, agregar
  Vercel Password Protection o un middleware simple cuando haga falta.
- Sin historial de checks (solo se guarda el último por link) — si
  necesitás gráficos de uptime histórico, agregar `hset` con timestamp
  en vez de sobrescribir.
- Sin notificaciones (email/Slack cuando algo cae) — agregar un `fetch`
  a un webhook en `/api/check` cuando `down.length > 0` si lo necesitás.
