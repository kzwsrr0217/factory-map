/**
 * data-source.ts — TypeORM CLI entry point.
 *
 * This file is used exclusively by the TypeORM CLI for migration commands.
 * It loads environment variables directly from .env so it can run standalone
 * without the full Express app bootstrap.
 *
 * Usage:
 *   npm run migration:generate -- src/migrations/MyMigration
 *   npm run migration:run
 *   npm run migration:revert
 *   npm run migration:show
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { Building } from './entities/Building.entity';
import { Floor } from './entities/Floor.entity';
import { WorkArea } from './entities/WorkArea.entity';
import { Section } from './entities/Section.entity';
import { Workstation } from './entities/Workstation.entity';
import { Asset } from './entities/Asset.entity';
import { AssetSoftware } from './entities/AssetSoftware.entity';
import { AssetConnection } from './entities/AssetConnection.entity';
import { User } from './entities/User.entity';
import { AuditLog } from './entities/AuditLog.entity';
import { AlertConfig } from './entities/AlertConfig.entity';
import { AlertLog } from './entities/AlertLog.entity';
import { ActiveSession } from './entities/ActiveSession.entity';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export default new DataSource({
  type: 'mssql',
  host: process.env.MSSQL_HOST ?? 'localhost',
  port: parseInt(process.env.MSSQL_PORT ?? '1433', 10),
  username: process.env.MSSQL_USER ?? 'sa',
  password: process.env.MSSQL_PASSWORD ?? '',
  database: process.env.MSSQL_DATABASE ?? 'factorymap',
  synchronize: false,
  logging: ['query', 'error'],
  entities: [
    Building, Floor, WorkArea, Section, Workstation,
    Asset, AssetSoftware, AssetConnection,
    User, AuditLog, AlertConfig, AlertLog, ActiveSession,
  ],
  migrations: ['src/migrations/*.ts'],
  migrationsTableName: 'typeorm_migrations',
  options: {
    encrypt: process.env.MSSQL_ENCRYPT === 'true',
    trustServerCertificate: process.env.MSSQL_TRUST_CERT !== 'false',
  },
});
