import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ShopifyGraphQLService } from './shopify-graphql.service';

/* Un renglón por variante, con las existencias de todas sus sucursales sumadas. */
export interface InventoryLevelRow {
  shopify_variant_id: string | null;
  shopify_inventory_item_id: string | null;
  sku: string | null;
  title: string;
  /*
   * Siempre nulo por ahora: leer el nombre de la sucursal exige el scope
   * `read_locations`, que la app no pide. La columna se conserva para poder
   * desglosar por sucursal el día que se pida ese permiso.
   */
  location_name: string | null;
  /* Nulo = Shopify no rastrea esta variante. No es cero: es «no sé». */
  quantity_on_hand: number | null;
  tracked: boolean;
  shopify_unit_cost: number | null;
}

/*
 * Se pregunta `on_hand`, nunca `available`.
 *
 * `available` ya descuenta lo comprometido por pedidos sin surtir, y esa
 * mercancía sigue siendo del negocio hasta que sale por la puerta. Valuar con
 * `available` subvalúa el inventario justo en la temporada de más pedidos
 * abiertos, que es cuando más importa el número.
 *
 * No se pide `location { name }`: ese campo exige el scope `read_locations`,
 * que la app no pide, y pedirlo hacía que Shopify rechazara la consulta entera
 * —con datos parciales y un error de acceso— en vez de devolver existencias. Se
 * suman las sucursales y se pierde el desglose, que es un dato de detalle; el
 * total, que es el que se valúa, sale idéntico.
 *
 * `productVariants` va en la raíz —y no `products { variants { ... } }`— porque
 * así el anidamiento de conexiones queda en dos niveles: es el requisito para
 * poder mover esta misma consulta a una Bulk Operation si alguna tienda llegara
 * a no terminar por páginas.
 */
const INVENTORY_QUERY = `
  query inventoryLevels($pageSize: Int!, $cursor: String) {
    productVariants(first: $pageSize, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          sku
          title
          product { id title }
          inventoryItem {
            id
            tracked
            unitCost { amount }
            inventoryLevels(first: 50) {
              edges {
                node {
                  quantities(names: ["on_hand"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }
  }
`;

@Injectable()
export class ShopifyInventorySyncService {
  private readonly logger = new Logger(ShopifyInventorySyncService.name);

  /* 250 es el máximo por página de la Admin API; 40 páginas = 10 000 variantes. */
  private readonly PAGE_SIZE = 250;
  private readonly MAX_PAGES = 40;

  constructor(
    private prisma: PrismaService,
    private graphql: ShopifyGraphQLService,
  ) {}

  async fetchInventory(connectionId: number): Promise<InventoryLevelRow[]> {
    await this.assertInventoryScope(connectionId);

    const rows: InventoryLevelRow[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < this.MAX_PAGES; page++) {
      /*
       * Un fallo de GraphQL salía como «Internal server error», sin decir qué
       * faltaba. Lo que casi siempre falla es un scope no concedido, y eso se
       * arregla reinstalando: el mensaje tiene que llegar hasta quien lo pidió.
       */
      let data: any;
      try {
        data = await this.graphql.graphql(connectionId, INVENTORY_QUERY, {
          pageSize: this.PAGE_SIZE,
          cursor,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new BadRequestException(
          `Shopify rechazó la consulta de inventario de la conexión ${connectionId}: ${detail}`,
        );
      }

      const connection = data?.productVariants;
      for (const edge of connection?.edges ?? []) {
        rows.push(...this.mapVariant(edge?.node));
      }

      if (!connection?.pageInfo?.hasNextPage) {
        this.logger.log(
          `Inventario de la conexión ${connectionId}: ${rows.length} renglones en ${page + 1} página(s)`,
        );
        return rows;
      }
      cursor = connection.pageInfo.endCursor;
    }

    /*
     * Cortar es mejor que seguir: el cron corre a las 6:15 y una tienda que no
     * termina no puede quedarse paginando indefinidamente. La foto queda FAILED
     * y se ve, en vez de colgar el trabajo.
     */
    throw new Error(
      `El catálogo de la conexión ${connectionId} excede ${this.MAX_PAGES * this.PAGE_SIZE} variantes`,
    );
  }

  /*
   * Lo que vale es el scope que Shopify concedió al instalar, no el que pide
   * hoy `SHOPIFY_SCOPES`: una conexión instalada antes de que `read_inventory`
   * estuviera en la lista sigue viva y sin ese permiso. Sin esta comprobación
   * el fallo llega como un error de autorización de GraphQL sin contexto, a las
   * 6:15 de la mañana, dentro de un cron.
   */
  private async assertInventoryScope(connectionId: number): Promise<void> {
    const conn = await this.prisma.shopifyConnection.findUnique({
      where: { id: connectionId },
      select: { shop_domain: true, scope: true },
    });

    if (!conn)
      throw new NotFoundException(`Connection ${connectionId} not found`);

    const granted = (conn.scope ?? '')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);

    if (!granted.includes('read_inventory')) {
      throw new BadRequestException(
        `La conexión ${connectionId} (${conn.shop_domain}) no tiene el permiso ` +
          '`read_inventory`. Hay que reinstalarla para poder leer existencias.',
      );
    }
  }

  private mapVariant(node: any): InventoryLevelRow[] {
    if (!node) return [];

    const item = node.inventoryItem;
    const base = {
      shopify_variant_id: this.legacyId(node.id),
      shopify_inventory_item_id: this.legacyId(item?.id),
      sku: node.sku || null,
      title: this.titleFor(node),
      shopify_unit_cost:
        item?.unitCost?.amount !== undefined && item?.unitCost?.amount !== null
          ? Number(item.unitCost.amount)
          : null,
    };

    /* Sin rastreo no hay cantidad que valga: existencia desconocida. */
    if (item?.tracked === false) {
      return [
        {
          ...base,
          location_name: null,
          quantity_on_hand: null,
          tracked: false,
        },
      ];
    }

    /*
     * Rastreada pero en ninguna sucursal: eso sí es cero de verdad. Y con
     * varias, la suma —sin el nombre no habría forma de distinguir un renglón
     * de otro, y el avalúo los sumaría igual.
     */
    const levels = item?.inventoryLevels?.edges ?? [];
    const onHand = levels.reduce(
      (total: number, edge: any) => total + this.onHand(edge?.node),
      0,
    );

    return [
      { ...base, location_name: null, quantity_on_hand: onHand, tracked: true },
    ];
  }

  /*
   * Una existencia negativa —se vendió más de lo registrado— se conserva tal
   * cual. Redondearla a cero escondería un descuadre real de inventario.
   */
  private onHand(level: any): number {
    const quantity = (level?.quantities ?? []).find(
      (q: any) => q?.name === 'on_hand',
    );
    const value = quantity?.quantity;
    return typeof value === 'number' ? value : 0;
  }

  /*
   * GraphQL devuelve GIDs y el resto del proyecto guarda el id numérico —así lo
   * dejan el webhook y `ShopifyBackfillService.legacyId`—. Guardar el GID aquí
   * haría que el cruce contra `ProductCost` por variante no acertara nunca y se
   * cayera en silencio al costo de Shopify, que es justo el error que la
   * precedencia de costos existe para evitar.
   */
  private legacyId(gid: any): string | null {
    if (!gid) return null;
    const match = /\/(\d+)(?:\?.*)?$/.exec(String(gid));
    return match ? match[1] : null;
  }

  private titleFor(node: any): string {
    const product = node?.product?.title ? String(node.product.title) : '';
    const variant = node?.title ? String(node.title) : '';
    if (product && variant && variant !== 'Default Title') {
      return `${product} - ${variant}`;
    }
    return product || variant || node?.sku || 'Sin nombre';
  }
}
