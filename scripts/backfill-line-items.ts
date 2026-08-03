import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const client = new PrismaClient({
  adapter: new PrismaMariaDb(process.env.DATABASE_URL!),
});

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? 'DRY RUN MODE - no writes' : 'LIVE MODE - will write to database');

  const batchSize = parseInt(process.argv.find((a) => a.startsWith('--batch='))?.split('=')[1] || '50', 10);
  const orders = await client.shopifyOrder.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, external_order_id: true, line_items: true },
  });

  console.log(`Found ${orders.length} orders to process`);
  let processed = 0;
  let errors = 0;
  const errorDetails: { id: number; external_order_id: string; reason: string }[] = [];

  for (let i = 0; i < orders.length; i += batchSize) {
    const batch = orders.slice(i, i + batchSize);

    for (const order of batch) {
      processed++;
      try {
        const items = parseLineItems(order.line_items);
        if (!Array.isArray(items)) {
          errors++;
          errorDetails.push({ id: order.id, external_order_id: order.external_order_id, reason: 'line_items is not an array' });
          continue;
        }

        if (dryRun) continue;

        for (const item of items) {
          const li = item as any;
          const lineItemId = String(li.id);
          const quantity = parseInt(String(li.quantity) || '1', 10) || 0;

          await (client as any).shopifyLineItem.upsert({
            where: {
              shopify_order_id_shopify_line_item_id: {
                shopify_order_id: order.id,
                shopify_line_item_id: lineItemId,
              },
            },
            create: {
              shopify_order: { connect: { id: order.id } },
              shopify_line_item_id: lineItemId,
              shopify_product_id: li.product_id ? String(li.product_id) : null,
              shopify_variant_id: li.variant_id ? String(li.variant_id) : null,
              sku: li.sku || null,
              title: String(li.title || li.name || ''),
              variant_title: li.variant_title ? String(li.variant_title) : null,
              quantity,
              unit_price: parseFloat(li.price || '0'),
              discount_allocated: 0,
              tax_allocated: 0,
              category_source: 'UNKNOWN',
              unit_cost: null,
              total_cost: null,
              gross_sales: quantity * parseFloat(li.price || '0'),
              net_sales: quantity * parseFloat(li.price || '0'),
              gross_profit: null,
              profit_margin: null,
            },
            update: {
              title: String(li.title || li.name || ''),
              quantity,
              unit_price: parseFloat(li.price || '0'),
              gross_sales: quantity * parseFloat(li.price || '0'),
              net_sales: quantity * parseFloat(li.price || '0'),
            },
          });
        }
      } catch (e: any) {
        errors++;
        errorDetails.push({ id: order.id, external_order_id: order.external_order_id, reason: e.message || 'Unknown error' });
      }
    }

    console.log(`Processed ${processed}/${orders.length} (errors: ${errors})`);
  }

  console.log(`\nDone. Processed: ${processed}, Errors: ${errors}`);
  if (errors > 0) {
    console.log('\nError details:');
    for (const err of errorDetails.slice(0, 20)) {
      console.log(`  Order ${err.id} (${err.external_order_id}): ${err.reason}`);
    }
    if (errorDetails.length > 20) console.log(`  ...and ${errorDetails.length - 20} more`);
  }

  await client.$disconnect();
}

function parseLineItems(lineItems: any): any[] {
  if (Array.isArray(lineItems)) return lineItems;
  if (typeof lineItems === 'string') {
    try { return JSON.parse(lineItems); } catch { return []; }
  }
  return [];
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
