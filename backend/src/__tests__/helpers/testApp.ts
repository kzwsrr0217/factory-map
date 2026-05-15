/**
 * testApp.ts — Shared test setup for supertest integration tests.
 *
 * Connects to the real MSSQL database (the same Docker instance used in
 * development, or the CI test DB). Because server.ts skips startServer() in
 * NODE_ENV=test, we initialise the DB connection here once for all test suites.
 *
 * Also ensures an admin user (admin / Admin@1234) exists so that getAdminToken()
 * can log in reliably against a fresh database with only the synced schema.
 *
 * Usage:
 *   const { app, getAdminToken } = await setupTests();
 *   await request(app).get('/api/...')
 */
import 'reflect-metadata';
import { connectDatabase, AppDataSource } from '../../config/database';
import { User } from '../../entities/User.entity';
import app from '../../server';
import request from 'supertest';

let initialized = false;

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
