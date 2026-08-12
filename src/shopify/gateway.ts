/*
 * Normalización del identificador de gateway.
 *
 * El `gateway` de una transacción de Shopify no siempre es un nombre técnico
 * como `shopify_payments`: los métodos de pago manuales llevan el nombre que le
 * puso el comerciante, así que puede ser «Tarjeta MercadoPago», con espacios y
 * mayúsculas. Es una cadena opaca y hay que tratarla como tal.
 *
 * Por eso esto sólo recorta y baja a minúsculas. Quitar los espacios interiores
 * —que es lo que hacía el formulario— rompe la correspondencia con el valor que
 * manda Shopify, y como el mapeo se busca por igualdad exacta, esos ingresos
 * caían silenciosamente en la cuenta por defecto de la conexión.
 *
 * La regla es que esto se aplique en los dos extremos: al guardar el mapeo y al
 * resolverlo. Si sólo se aplicara en uno, volvería el mismo fallo.
 */
export function normalizeGateway(gateway: string | null | undefined): string {
  return String(gateway ?? '')
    .trim()
    .toLowerCase();
}
