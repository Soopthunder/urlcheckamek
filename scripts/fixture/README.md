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
| Texto gris claro sobre blanco en "Horarios" | contraste insuficiente (solo lo ve el Inspector visual → recaptura) |
| "habitasiones", "incluído", "reservacion" | errores lingüísticos (IA, verificados contra el texto) |
