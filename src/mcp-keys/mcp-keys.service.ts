import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { PrismaService } from 'src/prisma.service';

/*
 * `pldx_<prefijo>_<secreto>`. El prefijo se guarda en claro y va indizado, así
 * que verificar es una consulta por índice en vez de recorrer todas las filas
 * hasheando contra cada una. El secreto sólo se guarda hasheado.
 */
export const API_KEY_PREFIX = 'pldx_';

/*
 * El prefijo va en hexadecimal y el secreto en base64url, y la diferencia
 * importa: el alfabeto de base64url incluye `_`, que es el separador. Con un
 * prefijo en base64url, una de cada ocho llaves salía con un `_` dentro y
 * `indexOf('_')` partía el token por el sitio equivocado —la llave no se
 * encontraba y devolvía 401 sin explicación—. En hexadecimal ([0-9a-f]) eso no
 * puede pasar. El secreto sí puede llevar `_`: es todo lo que va después del
 * primer separador.
 */
const PREFIX_BYTES = 4; // 8 caracteres en hexadecimal
const SECRET_BYTES = 32; // 256 bits de CSPRNG

/*
 * Sólo se toca `last_used_at` si lo guardado tiene más de esto. Escribirlo en
 * cada petición duplicaría el tráfico a la base de una tool de sólo lectura, y
 * la pregunta que responde el campo —«¿esta llave sigue en uso?»— no necesita
 * precisión de segundos.
 */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

/*
 * Lo único que puede salir de una llave hacia afuera. `token_hash` no está aquí
 * a propósito: si un día alguien lo agrega, este objeto es el sitio donde se
 * nota, y hay una prueba que lo vigila.
 */
const PUBLIC_KEY_SELECT = {
  id: true,
  user_id: true,
  owner_user_id: true,
  name: true,
  token_prefix: true,
  last_used_at: true,
  expires_at: true,
  revoked_at: true,
  created_at: true,
} as const;

export interface VerifiedKey {
  id: number;
  user_id: number;
  /** Cuyos libros toca la llave. `null` = llave sin dueño: se rechaza al escribir. */
  owner_user_id: number | null;
  email: string;
}

@Injectable()
export class McpKeysService {
  private readonly logger = new Logger(McpKeysService.name);

  constructor(private prisma: PrismaService) {}

  /*
   * SHA-256 y no bcrypt/argon2 a propósito. Esos son lentos aposta para
   * defender contraseñas humanas —poca entropía— de un ataque offline. Aquí el
   * secreto son 256 bits de CSPRNG: la fuerza bruta ya es inviable, y bcrypt
   * sumaría ~100 ms a *cada llamada* a una tool sin ganar nada. Para un token de
   * alta entropía, hashear rápido es lo correcto. No lo "arregles" a bcrypt.
   */
  private hash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  async create(params: {
    userId: number;
    name: string;
    expiresAt?: string | null;
    createdBy: number;
    ownerUserId?: number;
  }) {
    /*
     * El valor por omisión se resuelve aquí, al crear, y no al llamar: una llave
     * nunca nace sin dueño, y en la ruta de petición no hay fallback que esconda
     * justo el error que esto existe para evitar.
     */
    const ownerUserId = params.ownerUserId ?? params.createdBy;
    await this.assertActiveOwner(ownerUserId);

    const prefix = randomBytes(PREFIX_BYTES).toString('hex');
    const secret = randomBytes(SECRET_BYTES).toString('base64url');

    const key = await this.prisma.mcpApiKey.create({
      data: {
        user_id: params.userId,
        name: params.name,
        token_prefix: prefix,
        token_hash: this.hash(secret),
        expires_at: params.expiresAt ? new Date(params.expiresAt) : null,
        created_by: params.createdBy,
        owner_user_id: ownerUserId,
      },
      select: PUBLIC_KEY_SELECT,
    });

    /*
     * La única vez que el token completo existe fuera de quien lo pidió. No se
     * registra en el log ni se puede recuperar después: si se pierde, se emite
     * otro y se revoca éste, que es para lo que sirve rotar.
     */
    return { ...key, token: `${API_KEY_PREFIX}${prefix}_${secret}` };
  }

  /*
   * Devuelve al dueño de la llave, o `null` si el token no sirve por cualquier
   * motivo —formato, prefijo desconocido, secreto que no cuadra, revocada o
   * vencida—. No se distingue entre ellos hacia afuera: decirle a quien prueba
   * llaves *por qué* falló le ayuda a acertar.
   */
  async verify(token: string): Promise<VerifiedKey | null> {
    if (!token.startsWith(API_KEY_PREFIX)) return null;

    const rest = token.slice(API_KEY_PREFIX.length);
    const separator = rest.indexOf('_');
    if (separator <= 0) return null;

    const prefix = rest.slice(0, separator);
    const secret = rest.slice(separator + 1);
    if (!secret) return null;

    const key = await this.prisma.mcpApiKey.findUnique({
      where: { token_prefix: prefix },
      select: {
        id: true,
        user_id: true,
        owner_user_id: true,
        token_hash: true,
        revoked_at: true,
        expires_at: true,
        last_used_at: true,
        user: { select: { email: true } },
        owner: { select: { books_owner_id: true } },
      },
    });
    if (!key) return null;

    if (!this.secretMatches(secret, key.token_hash)) return null;

    /*
     * Revocada o vencida se comprueba en cada petición, sin caché: por eso
     * revocar surte efecto en la siguiente llamada y no cuando expire nada.
     */
    if (key.revoked_at) return null;
    if (key.expires_at && key.expires_at.getTime() <= Date.now()) return null;

    this.touch(key.id, key.last_used_at);

    return {
      id: key.id,
      user_id: key.user_id,
      // Una llave ligada a un socio trabaja, como él, en los libros del dueño.
      owner_user_id: key.owner?.books_owner_id ?? key.owner_user_id,
      email: key.user.email,
    };
  }

  private secretMatches(secret: string, storedHash: string): boolean {
    const candidate = Buffer.from(this.hash(secret), 'hex');
    const stored = Buffer.from(storedHash, 'hex');

    /*
     * `timingSafeEqual` explota si las longitudes difieren, y esa comparación
     * de longitudes ya filtraría información por sí sola. Ambos lados son un
     * SHA-256, así que sólo puede pasar con una fila corrupta.
     */
    if (candidate.length !== stored.length) return false;
    return timingSafeEqual(candidate, stored);
  }

  /*
   * Al vuelo y sin esperar: anotar cuándo se usó una llave no puede tumbar la
   * petición que está anotando.
   */
  private touch(id: number, lastUsedAt: Date | null): void {
    const fresh =
      lastUsedAt && Date.now() - lastUsedAt.getTime() < LAST_USED_THROTTLE_MS;
    if (fresh) return;

    this.prisma.mcpApiKey
      .update({ where: { id }, data: { last_used_at: new Date() } })
      .catch((error) =>
        this.logger.warn(
          `No se pudo anotar last_used_at de la llave ${id}`,
          error,
        ),
      );
  }

  /*
   * El dueño existe y no está dado de baja. «Activo» aquí = el usuario existe y su
   * invitación, si la tiene, no está REVOCADA (el admin del bootstrap no tiene
   * invitación y cuenta como activo). Rechaza con el id en el mensaje.
   */
  private async assertActiveOwner(ownerUserId: number): Promise<void> {
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { id: true, invitation: { select: { status: true } } },
    });
    if (!owner) {
      throw new BadRequestException(
        `owner_user_id ${ownerUserId}: el usuario no existe`,
      );
    }
    if (owner.invitation?.status === 'REVOKED') {
      throw new BadRequestException(
        `owner_user_id ${ownerUserId}: el usuario no está activo (invitación revocada)`,
      );
    }
  }

  /*
   * Re-enlazar la llave a otra persona. Cambia a la vez lo que lee y lo que
   * escribe, porque ambos son «actuar en nombre de esa cuenta».
   */
  async setOwner(id: number, ownerUserId: number) {
    const existing = await this.prisma.mcpApiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`MCP API key with id ${id} not found`);
    }
    await this.assertActiveOwner(ownerUserId);

    return this.prisma.mcpApiKey.update({
      where: { id },
      data: { owner_user_id: ownerUserId },
      select: PUBLIC_KEY_SELECT,
    });
  }

  findAll(userId?: number) {
    return this.prisma.mcpApiKey.findMany({
      where: userId ? { user_id: userId } : {},
      orderBy: { created_at: 'desc' },
      select: PUBLIC_KEY_SELECT,
    });
  }

  /*
   * Revocación blanda: la fila se queda. `last_used_at` es justo lo que quieres
   * mirar si sospechas que una llave se filtró —si la usaron antes de matarla—,
   * y un borrado duro destruiría esa evidencia en el momento en que importa.
   */
  async revoke(id: number) {
    const existing = await this.prisma.mcpApiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`MCP API key with id ${id} not found`);
    }
    if (existing.revoked_at) return existing;

    return this.prisma.mcpApiKey.update({
      where: { id },
      data: { revoked_at: new Date() },
      select: PUBLIC_KEY_SELECT,
    });
  }
}
