import { PrismaClient } from '@prisma/client';

const email = process.argv[2];
if (!email) {
  console.error('Usage: npx ts-node -r tsconfig-paths/register scripts/bootstrap-admin.ts <email>');
  process.exit(1);
}

async function main() {
  const prisma = new PrismaClient();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email "${email}"`);
    await prisma.$disconnect();
    process.exit(1);
  }
  const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });
  if (!adminRole) {
    console.error('Admin role not found in database');
    await prisma.$disconnect();
    process.exit(1);
  }
  await prisma.user.update({ where: { id: user.id }, data: { role_id: adminRole.id } });
  console.log(`Promoted user "${email}" (id=${user.id}) to admin role`);
  await prisma.$disconnect();
}

main();
