// Smoke test with Playwright: hits the running app (local or deployed),
// verifies the dashboard renders, an API check runs, and adding a link works.
// Usage: node scripts/smoke-test.mjs [baseUrl]   (defaults to http://localhost:3000)
import { chromium } from "playwright";
import assert from "node:assert/strict";

const baseUrl = process.argv[2] || "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  console.log(`→ abriendo ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("table");

  const rows = await page.locator("table tbody tr").count();
  assert.ok(rows > 0, "la tabla debería tener al menos un sitio listado");
  console.log(`✓ dashboard cargó con ${rows} sitios`);

  console.log("→ probando /api/check");
  const checkRes = await page.request.get(`${baseUrl}/api/check`);
  assert.equal(checkRes.status(), 200, "/api/check debería responder 200");
  const checkBody = await checkRes.json();
  assert.ok(typeof checkBody.checked === "number", "respuesta de /api/check debe traer 'checked'");
  console.log(`✓ /api/check corrió sobre ${checkBody.checked} links (${checkBody.down} caídos)`);

  console.log("→ agregando link de prueba");
  const testUrl = `https://example.com/?smoketest=${Date.now()}`;
  await page.fill('input[type="url"]', testUrl);
  await page.click('button:has-text("Agregar link")');
  await page.waitForTimeout(1000);
  const listRes = await page.request.get(`${baseUrl}/api/links`);
  const listBody = await listRes.json();
  assert.ok(listBody.links.includes(testUrl), "el link de prueba debería aparecer en /api/links");
  console.log("✓ agregar link funciona");

  // cleanup
  await page.request.delete(`${baseUrl}/api/links?url=${encodeURIComponent(testUrl)}`);

  console.log("\nTODO OK");
} finally {
  await browser.close();
}
