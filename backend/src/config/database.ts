/**
 * database.ts — TypeORM DataSource configuration and database connection helper.
 *
 * Exports:
 *  - `AppDataSource`: the singleton TypeORM DataSource used by all repositories.
 *  - `connectDatabase()`: initialises the DataSource and logs connection details.
 *
 * `synchronize: true` is intentionally enabled in non-production environments so
 * that entity changes are applied automatically without manual migrations during
 * development. In production, set NODE_ENV=production to disable this and use
 * TypeORM migrations instead.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import config from './config';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Section } from '../entities/Section.entity';
import { Workstation } from '../entities/Workstation.entity';
import { Asset } from '../entities/Asset.entity';
import { AssetSoftware } from '../entities/AssetSoftware.entity';
import { AssetConnection } from '../entities/AssetConnection.entity';
import { User } from '../entities/User.entity';
import { AuditLog } from '../entities/AuditLog.entity';
import { AlertConfig } from '../entities/AlertConfig.entity';
import { AlertLog } from '../entities/AlertLog.entity';
import { ScheduledAlert } from '../entities/ScheduledAlert.entity';
import { ActiveSession } from '../entities/ActiveSession.entity';
import { NetworkRoom } from '../entities/NetworkRoom.entity';
import { NetworkRack } from '../entities/NetworkRack.entity';
import { PatchPanel } from '../entities/PatchPanel.entity';
import { WallPort } from '../entities/WallPort.entity';

export const AppDataSource = new DataSource({
  type: 'mssql',
  host: config.mssql.host,
  port: config.mssql.port,
  username: config.mssql.username,
  password: config.mssql.password,
  database: config.mssql.database,
  synchronize: config.env !== 'production',
  logging: config.env === 'development' ? ['error', 'warn'] : false,
  entities: [Building, Floor, WorkArea, Section, Workstation, Asset, AssetSoftware, AssetConnection, User, AuditLog, AlertConfig, AlertLog, ScheduledAlert, ActiveSession, NetworkRoom, NetworkRack, PatchPanel, WallPort],
  migrations: ['dist/migrations/*.js'],
  migrationsTableName: 'typeorm_migrations',
  options: {
    encrypt: config.mssql.encrypt,
    trustServerCertificate: config.mssql.trustServerCertificate,
  },
});

export const connectDatabase = async (): Promise<void> => {
  try {
    await AppDataSource.initialize();
    console.log('✅ SQL Server connected successfully');
    console.log(`   Host: ${config.mssql.host}:${config.mssql.port}`);
    console.log(`   Database: ${config.mssql.database}`);
  } catch (error) {
    console.error('❌ SQL Server connection error:', error);
    process.exit(1);
  }
};
