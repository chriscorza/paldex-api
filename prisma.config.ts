import * as dotenv from 'dotenv';
import { defineConfig, env } from 'prisma/config';

dotenv.config({ path: '.env.prod', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
