import { normalizeGateway } from './gateway';

describe('normalizeGateway', () => {
  /*
   * Este es el caso que rompió en producción. El formulario quitaba los
   * espacios interiores antes de guardar, así que el mapeo de «tarjeta
   * mercadopago» se archivaba como «tarjetamercadopago» y nunca casaba con lo
   * que manda Shopify: los ingresos caían en la cuenta por defecto sin aviso.
   */
  it('conserva los espacios interiores', () => {
    expect(normalizeGateway('tarjeta mercadopago')).toBe('tarjeta mercadopago');
  });

  it('recorta los extremos y baja a minúsculas', () => {
    expect(normalizeGateway('  Tarjeta MercadoPago ')).toBe(
      'tarjeta mercadopago',
    );
  });

  it('deja intactos los nombres técnicos de Shopify', () => {
    expect(normalizeGateway('shopify_payments')).toBe('shopify_payments');
    expect(normalizeGateway('cash')).toBe('cash');
  });

  it('es idempotente', () => {
    const once = normalizeGateway(' Tarjeta MercadoPago ');
    expect(normalizeGateway(once)).toBe(once);
  });

  it('trata null y undefined como cadena vacía', () => {
    expect(normalizeGateway(null)).toBe('');
    expect(normalizeGateway(undefined)).toBe('');
  });
});
