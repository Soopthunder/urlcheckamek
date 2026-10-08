# Página de prueba con errores plantados

`node scripts/fixture-server.mjs` la sirve en http://127.0.0.1:8099/ para auditarla desde
SiteCheck. Lo que la auditoría tiene que encontrar:

| Error plantado | Tipo esperado |
|---|---|
| Banner de cookies con "Rechazar" | interacción registrada (clic en Rechazar) |
| Bloque de 600 px de ancho | desborde-horizontal en 360 y 390 |
| "Consultá nuestras promociones…" en caja de 120 px | texto-cortado |
| Capa transparente sobre "Reservar ahora" | elemento-tapado |
| Imagen 192×192 mostrada a 300×100 | imagen-deformada |
| Enlace de 14×14 px | objetivo-tactil-chico (móvil) |
| Newsletter fijo de 45% del alto | elemento-fijo-grande |
| Botón ☰ que no abre nada | menu-movil-no-abre |
| "Experiencias" oculto en móvil | contenido-ausente (revisión manual) |
| "CafÃ©" | caracteres-corruptos |
| "Lorem ipsum" | placeholder-publicado |
| Bloque "Our Spa" en inglés | mezcla-de-idiomas |
| Texto gris claro sobre blanco en "Horarios" | contraste-insuficiente (medido por código, WCAG) |
| "habitasiones", "incluído", "reservacion" | errores lingüísticos (IA, verificados contra el texto) |

## Comparación español ↔ inglés

`/` (ES) y `/en/` (EN) se enlazan entre sí por hreflang y por el selector de idioma
(equivalencia confirmada). `/sin-traduccion.html` no declara versión en inglés.

| Error plantado | Tipo esperado |
|---|---|
| Check-in "14 hs" (ES) ↔ "3 pm" (EN) | horario distinto (código) |
| "$ 45.000 por noche" (ES) ↔ "Rates available on request" (EN) | precio que falta en EN (código) |
| Sección "Spa" en español dentro de la página EN | sin traducir (código) |
| "desayuno incluído" ↔ "breakfast is not included" | significado distinto (IA, verificado contra las dos versiones) |
| "Reservar ahora" ↔ "Request information" | llamado a la acción distinto (IA) |
| `/sin-traduccion.html` | "comparación no realizada" con el motivo |
