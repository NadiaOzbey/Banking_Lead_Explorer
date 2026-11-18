import { Op, Transaction, col, fn, where } from 'sequelize';
import type { IncludeOptions, WhereOptions } from 'sequelize';
import type { Actor, Database } from './db.ts';
import type { Profile } from './csv.ts';

const filterNames = ['region', 'sector', 'signal'] as const;
const summaryFields = ['id', 'name', ...filterNames];
export const pageSize = 12;

function assignmentScope(db: Database, actor: Actor): IncludeOptions[] {
  if (actor.role === 'admin') return [];
  return [{
    model: db.Assignment, as: 'assignments', required: true, duplicating: false,
    attributes: [], where: { user_id: actor.id },
  }];
}

export function listProfiles(db: Database, actor: Actor, page: number, query: string, filters: string[]) {
  const include = assignmentScope(db, actor);
  const matching: WhereOptions<Profile>[] = filterNames.flatMap((key, index) =>
    filters[index] ? [{ [key]: filters[index] }] : []);
  if (query) {
    matching.push({
      [Op.or]: ['name', 'id'].map((key) =>
        where(fn('strpos', fn('lower', col('profile.' + key)), fn('lower', query)), Op.gt, 0)),
    });
  }
  const match = { [Op.and]: matching };

  // Keep page, counts and facets consistent if an import or redemption commits during the request.
  return db.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async (transaction) => {
    const scope = { include, transaction };
    const total = await db.Profile.count({ ...scope, where: match });
    const rows = await db.Profile.findAll({
      ...scope, where: match, attributes: summaryFields, order: [['name', 'ASC'], ['id', 'ASC']],
      limit: pageSize, offset: (page - 1) * pageSize,
    });
    const unassignedCount = actor.role === 'admin' ? 0
      : await db.Profile.count({ transaction }) - await db.Profile.count(scope);
    const facets: Record<string, string[]> = {};
    for (const key of filterNames) {
      const values = await db.Profile.findAll({
        ...scope, raw: true, attributes: [key], group: [col('profile.' + key)], order: [[key, 'ASC']],
      });
      facets[key] = values.map((row) => row[key]);
    }
    return {
      items: rows.map((row) => row.get({ plain: true })),
      total,
      unassignedCount,
      filters: facets,
      page,
      pageSize,
    };
  });
}

export async function findProfile(db: Database, actor: Actor, id: string) {
  const row = await db.Profile.findOne({ where: { id }, include: assignmentScope(db, actor) });
  if (!row) return null;
  const profile = row.get({ plain: true }) as Profile;
  const details = { ...profile.details };
  if (actor.role === 'client') delete details.internal_reference;
  return { ...profile, details };
}

export async function importProfiles(db: Database, profiles: Profile[]) {
  profiles.sort((a, b) => a.id.localeCompare(b.id));
  await db.sequelize.transaction(async (transaction) => {
    for (let index = 0; index < profiles.length; index += 1000) {
      await db.Profile.bulkCreate(profiles.slice(index, index + 1000), {
        updateOnDuplicate: ['name', 'region', 'sector', 'signal', 'details'],
        returning: false,
        transaction,
      });
    }
  });
}
