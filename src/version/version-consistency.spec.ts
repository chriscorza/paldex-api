import { readFileSync } from 'fs';
import { join } from 'path';

import { parseChangelog } from './changelog.parser';

/**
 * La versión vive en dos archivos: `CHANGELOG.md` (la fuente de verdad, lo que
 * lee el usuario) y `package.json` (lo que usa el respaldo cuando el changelog
 * falta). Dos copias del mismo número se separan solas con el tiempo, y una
 * versión que no corresponde a ninguna entrada del changelog es peor que no
 * tener versión: afirma algo falso. Esta prueba es lo único que las ata.
 */
describe('consistencia de la versión', () => {
  const root = join(__dirname, '..', '..');

  it('la versión de package.json coincide con la entrada más reciente del changelog', () => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as { version: string };
    const { releases } = parseChangelog(
      readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
    );

    expect(releases.length).toBeGreaterThan(0);

    const latest = releases[0].version;
    expect(
      pkg.version === latest
        ? true
        : `package.json declara ${pkg.version} pero la entrada más reciente de CHANGELOG.md es ${latest}`,
    ).toBe(true);
  });
});
