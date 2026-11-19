import { McpKeyEntity, CreatedMcpKeyEntity } from './mcp-key.entity';

/*
 * El hash del token no debe poder salir por ninguna respuesta. Estas pruebas son
 * lo que hace que agregarlo a la proyección —por descuido o por un `select`
 * nuevo— rompa el build en vez de pasar en revisión.
 */
describe('proyección de una API key', () => {
  const fila = {
    id: 1,
    user_id: 9,
    owner_user_id: 1,
    name: 'Asistente de IA',
    token_prefix: 'k3Jd9aQ2',
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
    created_at: new Date('2026-08-25'),
  };

  it('el listado no expone el hash ni aunque venga en el origen', () => {
    const conHash = { ...fila, token_hash: 'no-debe-salir' } as any;

    const proyectada = new McpKeyEntity(conHash);

    expect(JSON.stringify(proyectada)).not.toContain('no-debe-salir');
    expect((proyectada as any).token_hash).toBeUndefined();
  });

  it('el listado sí trae el prefijo, que identifica sin servir para usarla', () => {
    const proyectada = new McpKeyEntity(fila as McpKeyEntity);

    expect(proyectada.token_prefix).toBe('k3Jd9aQ2');
    expect((proyectada as any).token).toBeUndefined();
  });

  it('sólo la respuesta de creación lleva el token completo', () => {
    const creada = new CreatedMcpKeyEntity({
      ...(fila as McpKeyEntity),
      token: 'pldx_k3Jd9aQ2_elsecreto',
    } as CreatedMcpKeyEntity);

    expect(creada.token).toBe('pldx_k3Jd9aQ2_elsecreto');
    expect((creada as any).token_hash).toBeUndefined();
  });
});
