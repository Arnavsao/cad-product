// Prisma 7 configuration. The CLI (migrate/studio/generate) reads the datasource
// URL from here — NOT from schema.prisma — and Prisma 7 no longer loads `.env`
// itself, hence the explicit dotenv import.
//
// DIRECT_DATABASE_URL is the non-pooled connection (Neon "direct" host in prod)
// because migrations need session-level features that PgBouncer-style poolers
// break. The runtime client uses the pooled DATABASE_URL via the driver adapter
// in `src/prisma/prisma.service.ts`.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DIRECT_DATABASE_URL'),
  },
});
