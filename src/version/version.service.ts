import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

import { ParsedRelease, parseChangelog } from './changelog.parser';

export interface VersionInfo {
  version: string;
  /** Fecha declarada en el changelog. `null` si no se pudo leer el archivo. */
  released_at: string | null;
  /** Commit del que se construyó la imagen. `null` cuando no se sabe. */
  commit: string | null;
  /** Desde cuándo lleva corriendo este proceso. */
  started_at: string;
}

@Injectable()
export class VersionService implements OnModuleInit {
  private readonly logger = new Logger(VersionService.name);

  private releases: ParsedRelease[] = [];
  private packageVersion = '0.0.0';
  private loaded = false;

  onModuleInit() {
    this.ensureLoaded();
  }

  /**
   * Carga perezosa además del `onModuleInit`, porque `main.ts` lee la versión
   * para el contrato de Swagger **antes** de que Nest dispare los hooks de
   * ciclo de vida: sin esto el contrato se publicaba como `0.0.0`.
   *
   * Sigue leyéndose una sola vez, y los `warn` siguen saliendo durante el
   * arranque, no en la primera petición.
   */
  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    this.packageVersion = this.readPackageVersion();
    this.releases = this.readChangelog();
  }

  /**
   * El changelog sólo cambia cuando cambia la imagen, así que se lee una vez al
   * arrancar y se sirve desde memoria.
   */
  getReleases(): ParsedRelease[] {
    this.ensureLoaded();
    return this.releases;
  }

  getVersionInfo(): VersionInfo {
    this.ensureLoaded();
    const latest = this.releases[0];
    return {
      // La entrada más reciente del changelog manda; `package.json` es el
      // respaldo para cuando el archivo falta o no parsea.
      version: latest?.version ?? this.packageVersion,
      released_at: latest?.released_at ?? null,
      commit: this.getCommit(),
      started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    };
  }

  /**
   * `null`, nunca `"unknown"`: quien lo lee necesita distinguir "no se sabe" de
   * un valor real, y una cadena de relleno se acaba mostrando tal cual en
   * pantalla. Lo inyecta el `Dockerfile` desde el build arg `SOURCE_COMMIT`.
   */
  private getCommit(): string | null {
    const commit = process.env.APP_COMMIT?.trim();
    return commit ? commit : null;
  }

  private changelogPath(): string {
    return process.env.CHANGELOG_PATH ?? join(process.cwd(), 'CHANGELOG.md');
  }

  private readChangelog(): ParsedRelease[] {
    const path = this.changelogPath();
    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      // Que la contabilidad de un negocio deje de arrancar porque falta un
      // archivo de notas de versión sería un intercambio absurdo.
      this.logger.warn(
        `No se pudo leer el changelog en ${path}: GET /releases devolverá una lista vacía y la versión saldrá de package.json.`,
      );
      return [];
    }

    const { releases, skippedHeadings } = parseChangelog(content);
    for (const heading of skippedHeadings) {
      this.logger.warn(`Encabezado del changelog descartado: ${heading}`);
    }
    if (releases.length === 0) {
      this.logger.warn(
        `El changelog en ${path} no contiene ninguna versión legible.`,
      );
    }
    return releases;
  }

  private readPackageVersion(): string {
    const path = join(process.cwd(), 'package.json');
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
        version?: string;
      };
      return pkg.version ?? '0.0.0';
    } catch {
      this.logger.warn(`No se pudo leer la versión de ${path}.`);
      return '0.0.0';
    }
  }
}
