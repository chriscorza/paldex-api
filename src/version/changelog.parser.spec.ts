import { compareVersions, parseChangelog } from './changelog.parser';

describe('parseChangelog', () => {
  it('lee varias versiones con varias secciones', () => {
    const { releases, skippedHeadings } = parseChangelog(`# Changelog

Preámbulo que no es de ninguna versión.

## [1.1.0] - 2026-08-18

### Added

- Reporte de valor de inventario
- Ventas por empleado

### Fixed

- El cambio de rol ya se refleja sin cerrar sesión

## [1.0.0] - 2026-07-01

### Added

- Primera versión
`);

    expect(skippedHeadings).toEqual([]);
    expect(releases).toHaveLength(2);
    expect(releases[0]).toEqual({
      version: '1.1.0',
      released_at: '2026-08-18',
      changes: {
        added: ['Reporte de valor de inventario', 'Ventas por empleado'],
        changed: [],
        fixed: ['El cambio de rol ya se refleja sin cerrar sesión'],
        removed: [],
      },
    });
    expect(releases[1].version).toBe('1.0.0');
    expect(releases[1].changes.added).toEqual(['Primera versión']);
  });

  it('devuelve las versiones de más reciente a más antigua aunque el archivo esté desordenado', () => {
    const { releases } = parseChangelog(`## [1.9.0] - 2026-01-01

### Added

- Vieja

## [1.10.0] - 2026-02-01

### Added

- Nueva
`);

    expect(releases.map((release) => release.version)).toEqual([
      '1.10.0',
      '1.9.0',
    ]);
  });

  it('omite el encabezado mal formado sin arrastrar a las demás versiones', () => {
    const { releases, skippedHeadings } = parseChangelog(`## [Unreleased]

### Added

- Algo sin publicar

## [1.0.0] - 2026-07-01

### Added

- Primera versión
`);

    expect(skippedHeadings).toEqual(['## [Unreleased]']);
    expect(releases).toHaveLength(1);
    expect(releases[0].version).toBe('1.0.0');
    expect(releases[0].changes.added).toEqual(['Primera versión']);
  });

  it('omite las secciones que no son un tipo de cambio conocido', () => {
    const { releases, skippedHeadings } =
      parseChangelog(`## [1.0.0] - 2026-07-01

### Notas del equipo

- Esto no es un tipo de cambio

### Added

- Esto sí
`);

    expect(skippedHeadings).toEqual(['### Notas del equipo']);
    expect(releases[0].changes.added).toEqual(['Esto sí']);
  });

  it('une la continuación de una viñeta partida en dos líneas', () => {
    const { releases } = parseChangelog(`## [1.0.0] - 2026-07-01

### Changed

- Una nota larga
  que sigue en la línea siguiente
`);

    expect(releases[0].changes.changed).toEqual([
      'Una nota larga que sigue en la línea siguiente',
    ]);
  });

  it('devuelve vacío con un archivo vacío, sin lanzar', () => {
    expect(parseChangelog('')).toEqual({ releases: [], skippedHeadings: [] });
  });
});

describe('compareVersions', () => {
  it('compara por números, no alfabéticamente', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.0.1', '1.0.2')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('trata una versión ilegible como la más antigua', () => {
    expect(compareVersions('lo-que-sea', '0.0.1')).toBeLessThan(0);
  });
});
