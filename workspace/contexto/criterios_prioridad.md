# Criterios de prioridad

Las reglas medibles de abajo ya las evalúa el código (lib/extract.ts) y llegan como
"Señales medidas". Si cambiás un umbral acá, cambialo también allá.

- **Crítica**: el sitio no funciona o no se puede indexar en absoluto.
  Status 4xx/5xx, página en blanco (menos de 20 palabras), `noindex`, error de acceso.
- **Alta**: afecta fuertemente indexación, conversión o medición.
  Falta title, falta H1 o hay más de uno, canonical a otra URL, sin GA4 ni GTM,
  respuesta > 3000 ms, recursos http en página https.
- **Media**: buenas prácticas importantes que faltan.
  Falta meta description o supera 160 caracteres, title fuera de 15–60 caracteres,
  imágenes sin alt, sin Open Graph, sin JSON-LD, sin atributo lang, sin meta viewport.
  También (a criterio): title/H1 poco claros sobre la oferta, idioma inconsistente.
- **Baja**: mejoras de redacción o detalles menores.
  Menos de 300 palabras visibles, H2 genéricos o poco descriptivos.
