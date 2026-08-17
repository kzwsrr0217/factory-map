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
import { Zone } from './entities/Zone.entity';
import { ItsmHardwareSnapshot } from './entities/ItsmHardwareSnapshot.entity';
import { NexthinkDeviceSnapshot } from './entities/NexthinkDeviceSnapshot.entity';
import { NexthinkLoginSnapshot } from './entities/NexthinkLoginSnapshot.entity';
import { NormalisationTask } from './entities/NormalisationTask.entity';
import { NameCorrection } from './entities/NameCorrection.entity';
import { WorkArea } from './entities/WorkArea.entity';
import { Section } from './entities/Section.entity';
import { Workstation } from './entities/Workstation.entity';
import { ProductionLine } from './entities/ProductionLine.entity';
import { WorkCenter } from './entities/WorkCenter.entity';
import { EntityKind } from './entities/EntityKind.entity';
import { Asset } from './entities/Asset.entity';
import { MasterAsset } from './entities/MasterAsset.entity';
import { AssetSoftware } from './entities/AssetSoftware.entity';
import { AssetConnection } from './entities/AssetConnection.entity';
import { User } from './entities/User.entity';
import { AuditLog } from './entities/AuditLog.entity';
import { AlertConfig } from './entities/AlertConfig.entity';
import { AlertLog } from './entities/AlertLog.entity';
import { ScheduledAlert } from './entities/ScheduledAlert.entity';
import { ActiveSession } from './entities/ActiveSession.entity';
import { NetworkRoom } from './entities/NetworkRoom.entity';
import { NetworkRack } from './entities/NetworkRack.entity';
import { PatchPanel } from './entities/PatchPanel.entity';
import { WallPort } from './entities/WallPort.entity';

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
  // Must stay the same set as config/database.ts. It had drifted — Zone,
  // ItsmHardwareSnapshot, NormalisationTask and NameCorrection were missing here, which does
  // not affect `migration:run` (migrations are explicit SQL) but makes `migration:generate`
  // propose dropping four real tables, because an entity this file cannot see looks like a
  // table nothing owns.
  entities: [
    Building, Floor, Zone, WorkArea, Section, Workstation,
    Asset, MasterAsset, ItsmHardwareSnapshot, NexthinkDeviceSnapshot, NexthinkLoginSnapshot,
    NormalisationTask, NameCorrection,
    AssetSoftware, AssetConnection,
    User, AuditLog, AlertConfig, AlertLog, ScheduledAlert, ActiveSession,
    NetworkRoom, NetworkRack, PatchPanel, WallPort,
    ProductionLine, WorkCenter, EntityKind,
  ],
  migrations: ['src/migrations/*.ts'],
  migrationsTableName: 'typeorm_migrations',
  options: {
    encrypt: process.env.MSSQL_ENCRYPT === 'true',
    trustServerCertificate: process.env.MSSQL_TRUST_CERT !== 'false',
  },
});
