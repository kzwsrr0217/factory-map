/**
 * testApp.ts — Shared test setup for supertest integration tests.
 *
 * Connects to an **isolated `_test` database** on the same SQL Server
 * instance used in development (see jestEnv.ts, which redirects
 * MSSQL_DATABASE before config.ts ever reads it) — never the real dev
 * database. Because server.ts skips startServer() in NODE_ENV=test, we
 * initialise the DB connection here once for all test suites.
 *
 * The `_test` database won't exist yet on a fresh SQL Server instance —
 * `ensureTestDatabaseCreated()` creates it (via a raw connection to `master`)
 * before TypeORM connects; `synchronize: true` (non-production) then builds
 * the schema from the entities on first connect.
 *
 * Also ensures an admin user (admin / Admin@1234) exists so that getAdminToken()
 * can log in reliably against a fresh database with only the synced schema.
 *
 * Usage:
 *   const { app, getAdminToken } = await setupTests();
 *   await request(app).get('/api/...')
 */
import 'reflect-metadata';
import sql from 'mssql';
import { connectDatabase, AppDataSource } from '../../config/database';
import { User } from '../../entities/User.entity';
import config from '../../config/config';
import app from '../../server';
import request from 'supertest';

let initialized = false;

async function ensureTestDatabaseCreated(): Promise<void> {
  const pool = await sql.connect({
    server: config.mssql.host,
    port: config.mssql.port,
    user: config.mssql.username,
    password: config.mssql.password,
    database: 'master',
    options: {
      encrypt: config.mssql.encrypt,
      trustServerCertificate: config.mssql.trustServerCertificate,
    },
  });
  try {
    await pool.request().query(
      `IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'${config.mssql.database}') ` +
      `CREATE DATABASE [${config.mssql.database}]`
    );
  } finally {
    await pool.close();
  }
}

async function ensureAdminUser(): Promise<void> {
  const repo = AppDataSource.getRepository(User);
  const existing = await repo.findOne({ where: { username: 'admin' } });
  if (!existing) {
    const user = repo.create({
      username: 'admin',
      password: 'Admin@1234',
      role: 'admin',
      active: true,
      auth_provider: 'local',
      email: null,
      ldap_dn: null,
    });
    await repo.save(user);
  }
}

export async function setupTests(): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any;
  getAdminToken: () => Promise<string>;
}> {
  if (!initialized) {
    if (!AppDataSource.isInitialized) {
      await ensureTestDatabaseCreated();
      await connectDatabase();
    }
    await ensureAdminUser();
    initialized = true;
  }
  return { app, getAdminToken };
}

let cachedToken: string | null = null;

async function getAdminToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: 'Admin@1234' });
  if (!res.body?.data?.token) {
    throw new Error(`Login failed in test helper: ${JSON.stringify(res.body)}`);
  }
  cachedToken = res.body.data.token as string;
  return cachedToken;
}
