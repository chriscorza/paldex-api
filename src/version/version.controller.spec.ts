import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../globalConstants';
import { ParsedRelease } from './changelog.parser';
import { VersionController } from './version.controller';
import { VersionInfo, VersionService } from './version.service';

describe('VersionController', () => {
  const reflector = new Reflector();

  const build = (info: VersionInfo, releases: ParsedRelease[]) =>
    new VersionController({
      getVersionInfo: () => info,
      getReleases: () => releases,
    } as unknown as VersionService);

  const info: VersionInfo = {
    version: '1.2.0',
    released_at: '2026-08-18',
    commit: 'a97ef29',
    started_at: '2026-08-18T23:00:00.000Z',
  };

  const release: ParsedRelease = {
    version: '1.2.0',
    released_at: '2026-08-18',
    changes: {
      added: ['Algo nuevo'],
      changed: [],
      fixed: ['Algo arreglado'],
      removed: [],
    },
  };

  it('publica la versión con sus metadatos de build', () => {
    expect(build(info, [release]).getVersion()).toEqual(info);
  });

  it('devuelve el historial de versiones con sus cambios agrupados', () => {
    const releases = build(info, [release]).getReleases();

    expect(releases).toHaveLength(1);
    expect(releases[0]).toEqual({
      version: '1.2.0',
      released_at: '2026-08-18',
      changes: {
        added: ['Algo nuevo'],
        changed: [],
        fixed: ['Algo arreglado'],
        removed: [],
      },
    });
  });

  it('devuelve una lista vacía —no un error— cuando no hay changelog', () => {
    expect(build({ ...info, released_at: null }, []).getReleases()).toEqual([]);
  });

  it('GET /version es público: se puede leer con un curl sin token', () => {
    expect(
      reflector.get<boolean>(
        IS_PUBLIC_KEY,
        VersionController.prototype.getVersion,
      ),
    ).toBe(true);
  });

  it('GET /releases exige sesión pero ningún permiso concreto', () => {
    expect(
      reflector.get<boolean>(
        IS_PUBLIC_KEY,
        VersionController.prototype.getReleases,
      ),
    ).toBeUndefined();
    // Lista vacía = "sólo autenticado", el mismo patrón de /user/me. Un permiso
    // concreto escondería las notas justo de quien menos permisos tiene.
    expect(
      reflector.get<string[]>(
        PERMISSIONS_KEY,
        VersionController.prototype.getReleases,
      ),
    ).toEqual([]);
  });
});
