/*
 * fontkit 2 es sólo ESM y Jest no puede cargarlo con `require` (Node 22 sí: en
 * producción pdfkit lo carga sin problema). Paldex sólo usa las fuentes
 * estándar del PDF (Helvetica), que pdfkit dibuja sin fontkit, así que en las
 * pruebas basta con esto. Si algún día se registra una fuente propia, este
 * stub falla en voz alta en vez de pasar en silencio.
 */
export function create(): never {
  throw new Error(
    'fontkit no está disponible en las pruebas: usa las fuentes estándar del PDF.',
  );
}
