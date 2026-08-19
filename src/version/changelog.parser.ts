/**
 * Parser del `CHANGELOG.md` en formato Keep a Changelog.
 *
 * Sólo entiende el subconjunto que este proyecto usa:
 *
 *   ## [1.4.0] - 2026-08-18
 *   ### Added
 *   - Texto de la nota
 *
 * Es deliberadamente tolerante: un encabezado que no cumpla el formato se
 * descarta y se informa al llamador, en lugar de lanzar. Publicar notas de
 * versión es una función accesoria y no puede tumbar el arranque de la API.
 */

export const CHANGE_TYPES = ['added', 'changed', 'fixed', 'removed'] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

export type ReleaseChanges = Record<ChangeType, string[]>;

export interface ParsedRelease {
  version: string;
  /** Fecha declarada en el encabezado, `YYYY-MM-DD`. */
  released_at: string;
  changes: ReleaseChanges;
}

export interface ParsedChangelog {
  /** De más reciente a más antigua, por versión semántica. */
  releases: ParsedRelease[];
  /** Encabezados que no se pudieron interpretar, tal cual venían. */
  skippedHeadings: string[];
}

const RELEASE_HEADING =
  /^##\s+\[(\d+\.\d+\.\d+)\]\s+-\s+(\d{4}-\d{2}-\d{2})\s*$/;
const SECTION_HEADING = /^###\s+(.+?)\s*$/;
const BULLET = /^[-*]\s+(.*)$/;

const emptyChanges = (): ReleaseChanges => ({
  added: [],
  changed: [],
  fixed: [],
  removed: [],
});

/**
 * Compara dos versiones semánticas por sus números, no como texto: `1.10.0`
 * es posterior a `1.9.0`, aunque alfabéticamente vaya antes.
 */
export function compareVersions(a: string, b: string): number {
  // Se rellena a tres números: una cadena ilegible queda en 0.0.0, o sea la
  // más antigua posible, en lugar de producir NaN y un orden indefinido.
  const parse = (version: string): [number, number, number] => {
    const parts = version
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}

export function parseChangelog(content: string): ParsedChangelog {
  const releases: ParsedRelease[] = [];
  const skippedHeadings: string[] = [];

  let current: ParsedRelease | null = null;
  let section: ChangeType | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (line.startsWith('## ')) {
      const match = RELEASE_HEADING.exec(line);
      if (!match) {
        // Un encabezado de versión ilegible se lleva consigo su contenido, pero
        // no al resto del archivo: las demás versiones se sirven con normalidad.
        skippedHeadings.push(line.trim());
        current = null;
        section = null;
        continue;
      }
      current = {
        version: match[1],
        released_at: match[2],
        changes: emptyChanges(),
      };
      section = null;
      releases.push(current);
      continue;
    }

    if (!current) {
      // Preámbulo del archivo: el título, las notas de formato, lo que sea.
      continue;
    }

    const sectionMatch = SECTION_HEADING.exec(line);
    if (sectionMatch) {
      const name = sectionMatch[1].trim().toLowerCase();
      const known = CHANGE_TYPES.find((type) => type === name);
      if (!known) {
        skippedHeadings.push(line.trim());
        section = null;
        continue;
      }
      section = known;
      continue;
    }

    if (!section) {
      continue;
    }

    const bulletMatch = BULLET.exec(line.trimStart());
    if (bulletMatch) {
      const text = bulletMatch[1].trim();
      if (text) {
        current.changes[section].push(text);
      }
      continue;
    }

    // Continuación de la viñeta anterior: una nota larga partida en dos líneas
    // es una nota, no dos.
    const bullets = current.changes[section];
    if (line.trim() && bullets.length > 0) {
      bullets[bullets.length - 1] =
        `${bullets[bullets.length - 1]} ${line.trim()}`;
    }
  }

  releases.sort((a, b) => compareVersions(b.version, a.version));

  return { releases, skippedHeadings };
}
