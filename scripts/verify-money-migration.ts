import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import * as fs from 'fs';
import * as path from 'path';

const client = new PrismaClient({
  adapter: new PrismaMariaDb(process.env.DATABASE_URL!),
});

interface MoneySnapshot {
  timestamp: string;
  mode: 'before' | 'after';
  accounts: { balance_sum: number; balance_row_count: number; credit_limit_sum: number };
  expenses: { amount_sum: number; amount_row_count: number };
  incomes: { amount_sum: number; amount_row_count: number };
}

async function captureSnapshot(mode: 'before' | 'after'): Promise<MoneySnapshot> {
  const accounts: { balance_sum: number; balance_row_count: number } =
    await client.$queryRawUnsafe<[{ balance_sum: string; balance_row_count: string }]>(
      'SELECT COALESCE(SUM(CAST(balance AS DECIMAL(14,2))), 0) AS balance_sum, COUNT(*) AS balance_row_count FROM accounts'
    ).then((r: { balance_sum: string; balance_row_count: string }[]) => ({
      balance_sum: parseFloat(r[0].balance_sum),
      balance_row_count: parseInt(r[0].balance_row_count, 10),
    }));

  const creditLimit = await client.$queryRawUnsafe<[{ credit_limit_sum: string }]>(
    'SELECT COALESCE(SUM(CAST(credit_limit AS DECIMAL(14,2))), 0) AS credit_limit_sum FROM accounts WHERE credit_limit IS NOT NULL'
  ).then((r: { credit_limit_sum: string }[]) => ({
    credit_limit_sum: parseFloat(r[0].credit_limit_sum),
  }));

  const expenses = await client.$queryRawUnsafe<[{ amount_sum: string; amount_row_count: string }]>(
    'SELECT COALESCE(SUM(CAST(amount AS DECIMAL(14,2))), 0) AS amount_sum, COUNT(*) AS amount_row_count FROM expenses'
  ).then((r: { amount_sum: string; amount_row_count: string }[]) => ({
    amount_sum: parseFloat(r[0].amount_sum),
    amount_row_count: parseInt(r[0].amount_row_count, 10),
  }));

  const incomes = await client.$queryRawUnsafe<[{ amount_sum: string; amount_row_count: string }]>(
    'SELECT COALESCE(SUM(CAST(amount AS DECIMAL(14,2))), 0) AS amount_sum, COUNT(*) AS amount_row_count FROM incomes'
  ).then((r: { amount_sum: string; amount_row_count: string }[]) => ({
    amount_sum: parseFloat(r[0].amount_sum),
    amount_row_count: parseInt(r[0].amount_row_count, 10),
  }));

  return {
    timestamp: new Date().toISOString(),
    mode,
    accounts: { ...accounts, ...creditLimit },
    expenses,
    incomes,
  };
}

function compareSnapshots(before: MoneySnapshot, after: MoneySnapshot): boolean {
  const epsilon = 0.01;
  let ok = true;

  for (const [key, beforeVal, afterVal] of [
    ['accounts.balance_sum', before.accounts.balance_sum, after.accounts.balance_sum],
    ['accounts.balance_row_count', before.accounts.balance_row_count, after.accounts.balance_row_count],
    ['accounts.credit_limit_sum', before.accounts.credit_limit_sum, after.accounts.credit_limit_sum],
    ['expenses.amount_sum', before.expenses.amount_sum, after.expenses.amount_sum],
    ['expenses.amount_row_count', before.expenses.amount_row_count, after.expenses.amount_row_count],
    ['incomes.amount_sum', before.incomes.amount_sum, after.incomes.amount_sum],
    ['incomes.amount_row_count', before.incomes.amount_row_count, after.incomes.amount_row_count],
  ] as const) {
    const diff = Math.abs((beforeVal as number) - (afterVal as number));
    if (diff > epsilon) {
      console.error(`MISMATCH in ${key}: before=${beforeVal} after=${afterVal} diff=${diff}`);
      ok = false;
    }
  }

  return ok;
}

async function main() {
  const modeArg = process.argv[2];
  const outputFile = path.join(__dirname, 'money-snapshot.json');

  if (modeArg === '--before' || modeArg === 'before') {
    const snapshot = await captureSnapshot('before');
    fs.writeFileSync(outputFile, JSON.stringify(snapshot, null, 2));
    console.log(`Snapshot (before) saved to ${outputFile}`);
  } else if (modeArg === '--after' || modeArg === 'after') {
    const snapshot = await captureSnapshot('after');
    fs.writeFileSync(outputFile, JSON.stringify(snapshot, null, 2));
    console.log(`Snapshot (after) saved to ${outputFile}`);

    if (fs.existsSync(outputFile + '.before')) {
      const beforeSnapshot: MoneySnapshot = JSON.parse(fs.readFileSync(outputFile + '.before', 'utf8'));
      fs.renameSync(outputFile + '.before', outputFile + '.before.bak');
      const ok = compareSnapshots(beforeSnapshot, snapshot);
      if (!ok) {
        console.error('VERIFICATION FAILED: monetary drift detected during migration');
        process.exit(1);
      }
      console.log('Verification PASSED: monetary values preserved');
    } else {
      console.log('No before snapshot found, skipping comparison');
    }
  } else if (modeArg === '--compare' || modeArg === 'compare') {
    const beforeFile = process.argv[3] || outputFile + '.before';
    const afterFile = process.argv[4] || outputFile;

    if (!fs.existsSync(beforeFile) || !fs.existsSync(afterFile)) {
      console.error('Both before and after snapshots must exist');
      process.exit(1);
    }

    const beforeSnapshot: MoneySnapshot = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
    const afterSnapshot: MoneySnapshot = JSON.parse(fs.readFileSync(afterFile, 'utf8'));
    const ok = compareSnapshots(beforeSnapshot, afterSnapshot);
    process.exit(ok ? 0 : 1);
  } else {
    console.log('Usage: npx ts-node scripts/verify-money-migration.ts [before|after|compare] [before_file] [after_file]');
    process.exit(1);
  }

  await client.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
