/**
 * testApp.ts — Shared test setup for supertest integration tests.
 *
 * Connects to the real MSSQL database (the same Docker instance used in
 * development). Because server.ts skips startServer() in NODE_ENV=test,
 * we initialise the DB connection here once for all test suites.
 *
 * Usage:
 *   const { app, getAdminToken } = await setupTests();
 *   await request(app).get('/api/...')
 */
import 'reflect-metadata';
import { connectDatabase, AppDataSource } from '../../config/database';
import app from '../../server';
import request from 'supertest';

let initialized = false;

export async function setupTests(): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any;
  getAdminToken: () => Promise<string>;
}> {
  if (!initialized) {
    if (!AppDataSource.isInitialized) {
      await connectDatabase();
    }
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
