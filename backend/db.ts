import { readFile, readdir } from 'node:fs/promises';
import { DataTypes, Sequelize, literal } from 'sequelize';
import type { Model } from 'sequelize';
import type { Profile as ProfileRow } from './csv.ts';

export type Actor = { id: string; email: string; role: 'admin' | 'client' };
type UserRow = Actor & { password_hash: string };
type SessionRow = { token_hash: string; user_id: string; expires_at: Date; user?: Actor };
type AssignmentRow = { user_id: string; profile_id: string };
type CodeRow = { code_hash: string; email: string; expires_at: Date; redeemed_at: Date | null };
type CodeProfileRow = { code_hash: string; profile_id: string };
type Row<T extends object> = Model<T, Partial<T>> & T;

export function connect(connectionString: string) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const sequelize = new Sequelize(connectionString, {
    dialect: 'postgres',
    logging: false,
    pool: { max: 10, acquire: 5000 },
    dialectOptions: { connectionTimeoutMillis: 3000, statement_timeout: 8000 },
  });
  const User = sequelize.define<Row<UserRow>>('user', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    email: { type: DataTypes.TEXT, unique: true, allowNull: false },
    password_hash: { type: DataTypes.TEXT, allowNull: false },
    role: { type: DataTypes.TEXT, allowNull: false },
  }, { tableName: 'users', timestamps: false });
  const Session = sequelize.define<Row<SessionRow>>('session', {
    token_hash: { type: DataTypes.TEXT, primaryKey: true },
    user_id: { type: DataTypes.UUID, allowNull: false },
    expires_at: { type: DataTypes.DATE, allowNull: false },
  }, { tableName: 'sessions', timestamps: false });
  const Profile = sequelize.define<Row<ProfileRow>>('profile', {
    id: { type: DataTypes.TEXT, primaryKey: true },
    name: { type: DataTypes.TEXT, allowNull: false },
    region: { type: DataTypes.TEXT, allowNull: false },
    sector: { type: DataTypes.TEXT, allowNull: false },
    signal: { type: DataTypes.TEXT, allowNull: false },
    details: { type: DataTypes.JSONB, allowNull: false },
  }, { tableName: 'profiles', timestamps: false });
  const Assignment = sequelize.define<Row<AssignmentRow>>('assignment', {
    user_id: { type: DataTypes.UUID, primaryKey: true },
    profile_id: { type: DataTypes.TEXT, primaryKey: true },
  }, { tableName: 'assignments', timestamps: false });
  const AccessCode = sequelize.define<Row<CodeRow>>('accessCode', {
    code_hash: { type: DataTypes.TEXT, primaryKey: true },
    email: { type: DataTypes.TEXT, allowNull: false },
    expires_at: { type: DataTypes.DATE, defaultValue: literal("now() + interval '7 days'"), allowNull: false },
    redeemed_at: { type: DataTypes.DATE },
  }, { tableName: 'access_codes', timestamps: false });
  const AccessCodeProfile = sequelize.define<Row<CodeProfileRow>>('accessCodeProfile', {
    code_hash: { type: DataTypes.TEXT, primaryKey: true },
    profile_id: { type: DataTypes.TEXT, primaryKey: true },
  }, { tableName: 'access_code_profiles', timestamps: false });
  const Migration = sequelize.define<Row<{ version: string }>>('migration', {
    version: { type: DataTypes.TEXT, primaryKey: true },
  }, { tableName: 'schema_migrations', timestamps: false });
  Session.belongsTo(User, { as: 'user', foreignKey: 'user_id' });
  Profile.hasMany(Assignment, { as: 'assignments', foreignKey: 'profile_id' });

  return { sequelize, User, Session, Profile, Assignment, AccessCode, AccessCodeProfile, Migration };
}

export type Database = ReturnType<typeof connect>;

// Keep the existing migration ledger and apply only checked-in SQL files.
export async function migrate({ sequelize, Migration }: Database) {
  await sequelize.transaction(async (transaction) => {
    await sequelize.query('SELECT pg_advisory_xact_lock(231702)', { transaction });
    await sequelize.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY)', { transaction });
    const dir = new URL('./migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
      if (await Migration.findByPk(file, { transaction })) continue;
      await sequelize.query(await readFile(new URL(file, dir), 'utf8'), { transaction });
      await Migration.create({ version: file }, { transaction });
    }
  });
}
