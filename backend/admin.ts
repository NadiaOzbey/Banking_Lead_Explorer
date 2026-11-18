import bcrypt from 'bcrypt';
import { pathToFileURL } from 'node:url';
import type { Database } from './db.ts';
import { connect, migrate } from './db.ts';
import { emailAddress, validPassword } from './security.ts';

export async function createAdmin(db: Database, emailValue: unknown, password: unknown) {
  const email = emailAddress(emailValue);
  if (!email || !validPassword(password)) throw new Error('Provide ADMIN_EMAIL and a strong ADMIN_PASSWORD (12 characters to 72 bytes)');
  const [user] = await db.User.findOrCreate({
    where: { email },
    defaults: { email, password_hash: await bcrypt.hash(password, 10), role: 'admin' },
  });
  if (user.role !== 'admin') throw new Error('An existing client cannot be promoted by bootstrap');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const db = connect(process.env.DATABASE_URL ?? '');
  try {
    await migrate(db);
    await createAdmin(db, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    console.log('Administrator is ready');
  } finally {
    await db.sequelize.close();
  }
}
