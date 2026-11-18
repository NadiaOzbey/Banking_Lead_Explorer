import express from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import multer from 'multer';
import { Op, UniqueConstraintError, fn } from 'sequelize';
import { extname } from 'node:path';
import type { Actor, Database } from './db.ts';
import { findProfile, importProfiles, listProfiles } from './profiles.ts';
import { profileId, readProfiles } from './csv.ts';
import { digest, emailAddress, LoginLimiter, token, validPassword } from './security.ts';

const cookieName = '__Host-lead_explorer';
const cookie = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;
const sessionDuration = 8 * 60 * 60 * 1000;
const dummyHash = bcrypt.hash(token(), 10);
const deny = (res: Response, status: number, error: string) => res.status(status).json({ error });
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 + 1, files: 1, fields: 0, parts: 2 },
}).single('file');

export function createApp(db: Database, options: { origin: string; staticDir?: string; commit?: string }) {
  const app = express();
  const limit = new LoginLimiter();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'"], frameAncestors: ["'none'"], upgradeInsecureRequests: null } },
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)
        && (req.get('Origin') !== options.origin || req.get('X-Lead-CSRF') !== '1')) {
      deny(res, 403, 'Request origin or CSRF header rejected');
      return;
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await db.sequelize.authenticate();
    res.json({ status: 'ok', commit: options.commit });
  });

  app.post('/api/auth/register', async (req, res) => {
    const email = emailAddress(req.body?.email);
    const password = req.body?.password;
    if (!email || !validPassword(password) || Object.keys(req.body).some((key) => !['email', 'password'].includes(key))) {
      return deny(res, 400, 'Provide an email and a password of at least 12 characters and at most 72 bytes');
    }
    try {
      await db.User.create({ email, password_hash: await bcrypt.hash(password, 10), role: 'client' });
    } catch (error) {
      if (error instanceof UniqueConstraintError) return deny(res, 409, 'This email is already registered');
      throw error;
    }
    res.status(201).json({ email, role: 'client' });
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = emailAddress(req.body?.email);
    const password = req.body?.password;
    let actor: Actor | undefined;
    const outcome = await limit.verify(JSON.stringify([req.ip, email]), async () => {
      if (!email || !validPassword(password)) return false;
      const user = await db.User.findOne({ where: { email } });
      const matches = await bcrypt.compare(password, user?.password_hash ?? await dummyHash);
      if (!matches || !user) return false;
      actor = { id: user.id, email: user.email, role: user.role };
      return true;
    });
    if (outcome === 'limited') {
      res.set('Retry-After', '60');
      return deny(res, 429, 'Too many login attempts. Try again in a minute');
    }
    if (!actor) return deny(res, 401, 'Invalid email or password');
    const session = token();
    await db.Session.create({
      token_hash: digest(session), user_id: actor.id, expires_at: new Date(Date.now() + sessionDuration),
    });
    res.cookie(cookieName, session, { ...cookie, maxAge: sessionDuration }).json(actor);
  });

  app.use('/api', async (req, res, next) => {
    const session = req.cookies[cookieName];
    if (typeof session !== 'string' || !/^[\w-]{43}$/.test(session)) return deny(res, 401, 'Sign in required');
    const record = await db.Session.findOne({
      where: { token_hash: digest(session), expires_at: { [Op.gt]: fn('now') } },
      include: [{ model: db.User, as: 'user', required: true, attributes: ['id', 'email', 'role'] }],
    });
    if (!record?.user) return deny(res, 401, 'Sign in required');
    const { id, email, role } = record.user;
    res.locals.actor = { id, email, role };
    next();
  });

  app.get('/api/auth/me', (_req, res) => res.json(res.locals.actor));
  app.post('/api/auth/logout', async (req, res) => {
    await db.Session.destroy({ where: { token_hash: digest(req.cookies[cookieName]) } });
    res.clearCookie(cookieName, cookie).status(204).end();
  });

  app.use('/api/admin', (_req, res, next) => {
    if (res.locals.actor.role !== 'admin') return deny(res, 403, 'Administrator access required');
    next();
  });

  app.get('/api/profiles', async (req, res) => {
    const actor: Actor = res.locals.actor;
    const page = req.query.page === undefined ? 1 : Number(text(req.query.page));
    const q = text(req.query.q);
    const filters = [text(req.query.region), text(req.query.sector), text(req.query.signal)];
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || q.length > 200
        || filters.some((value) => value.length > 4000)) return deny(res, 400, 'Invalid search or page');
    res.json(await listProfiles(db, actor, page, q, filters));
  });

  app.get('/api/profiles/:id', async (req, res) => {
    const actor: Actor = res.locals.actor;
    if (!profileId.test(req.params.id)) return deny(res, 404, 'Profile not found');
    const profile = await findProfile(db, actor, req.params.id);
    if (!profile) return deny(res, 404, 'Profile not found');
    res.json(profile);
  });

  app.post('/api/admin/upload', upload, async (req, res) => {
    if (!req.file || extname(req.file.originalname).toLowerCase() !== '.csv'
        || !['text/csv', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream', 'text/plain'].includes(req.file.mimetype)) {
      return deny(res, 400, 'Choose a CSV file');
    }
    if (req.file.size > 5 * 1024 * 1024) return deny(res, 413, 'The upload limit is 5 MiB');
    const { profiles, errors } = readProfiles(req.file.buffer);
    if (errors.length) return res.status(422).json({ error: 'CSV validation failed', errors: errors.slice(0, 100), errorCount: errors.length });
    await importProfiles(db, profiles);
    res.status(201).json({ imported: profiles.length });
  });

  app.post('/api/admin/access-codes', async (req, res) => {
    const email = emailAddress(req.body?.email);
    const ids = req.body?.profileIds;
    if (!email || !Array.isArray(ids) || ids.length < 1 || ids.length > 500
        || ids.some((id) => typeof id !== 'string' || !profileId.test(id))) {
      return deny(res, 400, 'Provide a client email and 1 to 500 profile IDs');
    }
    const uniqueIds = [...new Set<string>(ids)];
    const code = token();
    const created = await db.sequelize.transaction(async (transaction) => {
      const valid = await db.Profile.findAll({
        attributes: ['id'], where: { id: uniqueIds }, order: [['id', 'ASC']],
        lock: transaction.LOCK.KEY_SHARE, transaction,
      });
      if (valid.length !== uniqueIds.length) return false;
      const code_hash = digest(code);
      await db.AccessCode.create({ code_hash, email }, { transaction });
      await db.AccessCodeProfile.bulkCreate(
        uniqueIds.map((profile_id) => ({ code_hash, profile_id })), { transaction },
      );
      return true;
    });
    if (!created) return deny(res, 400, 'One or more profile IDs do not exist');
    res.status(201).json({ code, expiresInDays: 7 });
  });

  app.post('/api/access-codes/redeem', async (req, res) => {
    const actor: Actor = res.locals.actor;
    if (actor.role !== 'client') return deny(res, 403, 'Client access required');
    const code = text(req.body?.code);
    if (!/^[\w-]{43}$/.test(code)) return deny(res, 400, 'Invalid or expired access code');
    const codeHash = digest(code);
    const redeemed = await db.sequelize.transaction(async (transaction) => {
      const [updated] = await db.AccessCode.update({ redeemed_at: fn('now') }, {
        where: { code_hash: codeHash, email: actor.email, redeemed_at: null, expires_at: { [Op.gt]: fn('now') } },
        transaction,
      });
      if (!updated) return false;
      const profiles = await db.AccessCodeProfile.findAll({
        where: { code_hash: codeHash }, order: [['profile_id', 'ASC']], transaction,
      });
      await db.Assignment.bulkCreate(
        profiles.map(({ profile_id }) => ({ user_id: actor.id, profile_id })),
        { ignoreDuplicates: true, transaction },
      );
      return true;
    });
    if (!redeemed) return deny(res, 400, 'Invalid or expired access code');
    res.status(204).end();
  });

  app.use('/api', (_req, res) => deny(res, 404, 'Route not found'));
  if (options.staticDir) {
    app.use(express.static(options.staticDir, { index: false }));
    app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: options.staticDir }));
  }

  app.use((error: Error & { code?: string; status?: number }, _req: Request, res: Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      return deny(res, error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'Upload rejected. Send one CSV file up to 5 MiB');
    }
    if (error.status === 400 || error.status === 413) return deny(res, error.status, 'Invalid request body');
    console.error('Request failed', { category: error.name, code: error.code });
    return deny(res, 503, 'Service temporarily unavailable');
  });
  return app;
}
