import { Logger } from '@nestjs/common';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { VersionService } from './version.service';

describe('VersionService', () => {
  const originalChangelogPath = process.env.CHANGELOG_PATH;
  const originalCommit = process.env.APP_COMMIT;
  let warn: jest.SpyInstance;

  const writeChangelog = (content: string): string => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'changelog-')),
      'CHANGELOG.md',
    );
    writeFileSync(path, content);
    return path;
  };

  const start = (): VersionService => {
    const service = new VersionService();
    service.onModuleInit();
    return service;
  };

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    delete process.env.APP_COMMIT;
  });

  afterEach(() => {
    warn.mockRestore();
    if (originalChangelogPath === undefined) {
      delete process.env.CHANGELOG_PATH;
    } else {
      process.env.CHANGELOG_PATH = originalChangelogPath;
    }
    if (originalCommit === undefined) {
      delete process.env.APP_COMMIT;
    } else {
      process.env.APP_COMMIT = originalCommit;
    }
  });

  it('sirve la versión y las notas del changelog', () => {
    process.env.CHANGELOG_PATH = writeChangelog(`## [1.2.0] - 2026-08-18

### Added

- Algo nuevo

## [1.1.0] - 2026-07-01

### Fixed

- Algo arreglado
`);

    const service = start();

    expect(service.getVersionInfo()).toMatchObject({
      version: '1.2.0',
      released_at: '2026-08-18',
      commit: null,
    });
    expect(service.getReleases().map((release) => release.version)).toEqual([
      '1.2.0',
      '1.1.0',
    ]);
  });

  it('arranca sin changelog, cae a la versión de package.json y deja un warn', () => {
    process.env.CHANGELOG_PATH = join(tmpdir(), 'no-existe-este-changelog.md');

    const service = start();
    const info = service.getVersionInfo();

    expect(service.getReleases()).toEqual([]);
    expect(info.released_at).toBeNull();
    // La del propio repo: el respaldo es real, no un literal.
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('No se pudo leer el changelog'),
    );
  });

  it('avisa de cada encabezado descartado sin perder las versiones legibles', () => {
    process.env.CHANGELOG_PATH = writeChangelog(`## [Unreleased]

### Added

- Sin publicar

## [1.0.0] - 2026-07-01

### Added

- Publicado
`);

    const service = start();

    expect(service.getReleases()).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('## [Unreleased]'),
    );
  });

  it('devuelve null cuando no hay commit, nunca una cadena de relleno', () => {
    process.env.CHANGELOG_PATH = writeChangelog(`## [1.0.0] - 2026-07-01

### Added

- Algo
`);

    expect(start().getVersionInfo().commit).toBeNull();

    process.env.APP_COMMIT = '   ';
    expect(start().getVersionInfo().commit).toBeNull();

    process.env.APP_COMMIT = 'a97ef29';
    expect(start().getVersionInfo().commit).toBe('a97ef29');
  });

  it('lee el archivo una sola vez aunque se consulte varias', () => {
    const path = writeChangelog(`## [1.0.0] - 2026-07-01

### Added

- Algo
`);
    process.env.CHANGELOG_PATH = path;

    const service = start();
    // Se cambia el archivo después de arrancar: el servicio no debe releerlo.
    writeFileSync(
      path,
      `## [9.9.9] - 2026-12-31

### Added

- Otra cosa
`,
    );

    expect(service.getVersionInfo().version).toBe('1.0.0');
    expect(service.getReleases()).toHaveLength(1);
  });

  it('sirve la versión aunque se pida antes del onModuleInit, como hace Swagger', () => {
    process.env.CHANGELOG_PATH = writeChangelog(`## [3.1.0] - 2026-08-18

### Added

- Algo
`);

    // Sin llamar a onModuleInit: es el orden real en main.ts, donde el contrato
    // de Swagger se construye antes de que Nest dispare los hooks.
    expect(new VersionService().getVersionInfo().version).toBe('3.1.0');
  });

  it('reporta started_at coherente con el tiempo que lleva vivo el proceso', () => {
    process.env.CHANGELOG_PATH = writeChangelog(`## [1.0.0] - 2026-07-01

### Added

- Algo
`);

    const startedAt = new Date(start().getVersionInfo().started_at).getTime();

    expect(startedAt).toBeLessThanOrEqual(Date.now());
    expect(Date.now() - startedAt).toBeCloseTo(process.uptime() * 1000, -3);
  });
});
