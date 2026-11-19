import {
  buildOwnerFilter,
  buildWriteTargetFilter,
  effectiveOwnerId,
  isDelegated,
} from './ownership';

describe('ownership', () => {
  describe('buildOwnerFilter', () => {
    it('sin ownerUserId filtra por quien llama (REST, sin cambios)', () => {
      expect(buildOwnerFilter({ userId: 9, scope: 'OWN' })).toEqual({
        user_id: 9,
      });
    });

    it('con ownerUserId y scope OWN filtra por el propietario', () => {
      expect(
        buildOwnerFilter({ userId: 9, scope: 'OWN', ownerUserId: 1 }),
      ).toEqual({ user_id: 1 });
    });

    it('con ownerUserId y scope ANY el filtro sigue vacío: el scope manda', () => {
      expect(
        buildOwnerFilter({ userId: 9, scope: 'ANY', ownerUserId: 1 }),
      ).toEqual({});
      expect(buildOwnerFilter({ userId: 9, scope: 'ANY' })).toEqual({});
    });
  });

  it('effectiveOwnerId: ownerUserId ?? userId', () => {
    expect(effectiveOwnerId({ userId: 9, scope: 'OWN' })).toBe(9);
    expect(effectiveOwnerId({ userId: 9, scope: 'OWN', ownerUserId: 1 })).toBe(
      1,
    );
  });

  describe('buildWriteTargetFilter', () => {
    it('ANY sin delegar: sin restricción (comportamiento previo)', () => {
      expect(buildWriteTargetFilter({ userId: 9, scope: 'ANY' })).toEqual({});
      expect(
        buildWriteTargetFilter({ userId: 9, scope: 'ANY', ownerUserId: 9 }),
      ).toEqual({});
    });

    it('ANY actuando en nombre de otro: sólo estructuras del propietario', () => {
      expect(
        buildWriteTargetFilter({ userId: 9, scope: 'ANY', ownerUserId: 1 }),
      ).toEqual({ user_id: 1 });
      expect(isDelegated({ userId: 9, scope: 'ANY', ownerUserId: 1 })).toBe(
        true,
      );
    });

    it('OWN: siempre las del propietario efectivo', () => {
      expect(buildWriteTargetFilter({ userId: 9, scope: 'OWN' })).toEqual({
        user_id: 9,
      });
    });
  });
});
