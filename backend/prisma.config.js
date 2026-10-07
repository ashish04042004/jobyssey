import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Migrations need a direct (non-pooled) connection; on Supabase that is the
    // port-5432 URL, while the app itself uses the pooler via DATABASE_URL.
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
  },
});
