import { Op, fn } from 'sequelize';
import { setTimeout } from 'node:timers/promises';
import { resolve } from 'node:path';
import { createAdmin } from './admin.ts';
import { createApp } from './app.ts';
import { connect, migrate } from './db.ts';

const origin = process.env.APP_ORIGIN ?? '';
const parsed = new URL(origin);
if (parsed.protocol !== 'https:' || origin !== parsed.origin) throw new Error('APP_ORIGIN must be an HTTPS origin');

const db = connect(process.env.DATABASE_URL ?? '');
for (let attempt = 1; ; attempt++) {
  try {
    await migrate(db);
    break;
  } catch {
    if (attempt === 15) throw new Error('Could not apply database migrations');
    console.error('Database unavailable or migration failed; retrying');
    await setTimeout(2000);
  }
}

if (process.env.ADMIN_EMAIL || process.env.ADMIN_PASSWORD) {
  await createAdmin(db, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
}
await db.Session.destroy({ where: { expires_at: { [Op.lte]: fn('now') } } });

const app = createApp(db, {
  origin,
  commit: process.env.RENDER_GIT_COMMIT,
  staticDir: process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : undefined,
});
const server = app.listen(Number(process.env.PORT ?? '3000'), '0.0.0.0', () => console.log('API ready'));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => server.close(() => { void db.sequelize.close(); }));
}
