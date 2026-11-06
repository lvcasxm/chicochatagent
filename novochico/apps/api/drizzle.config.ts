import { defineConfig } from 'drizzle-kit';

// `generate` só lê o schema e escreve SQL em ./drizzle; não precisa de conexão com o banco.
// As migrations são aplicadas por src/db/migrate.ts (npm run db:migrate), nunca automaticamente.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
});
