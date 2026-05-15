# TypeORM Migrations

TypeORM `synchronize: true` is used **only in development** (when `NODE_ENV != production`).
In production, all schema changes must go through migrations.

## Workflow

### 1. Generate a migration after changing an entity

```bash
# Inside the backend Docker container:
docker exec factory-map-backend npm run migration:generate -- src/migrations/InitialSchema

# Or locally (requires .env with MSSQL_* vars pointing to a running SQL Server):
npm run migration:generate -- src/migrations/InitialSchema
```

This compares the current entity definitions against the database and generates an SQL migration file.

### 2. Review the generated file

Check `src/migrations/<timestamp>-InitialSchema.ts` and confirm the SQL is correct before committing.

### 3. Apply migrations

```bash
npm run migration:run
```

### 4. Revert the last migration

```bash
npm run migration:revert
```

### 5. List applied migrations

```bash
npm run migration:show
```

## Generating the baseline migration (first time)

Run this once against a **clean, empty database** to capture the full current schema:

```bash
docker exec factory-map-backend npm run migration:generate -- src/migrations/InitialSchema
docker exec factory-map-backend npm run migration:run
```

After that, new entity changes should be captured with a descriptive name:

```bash
npm run migration:generate -- src/migrations/AddMaintenanceFields
```

## Production deployment checklist

- [ ] Set `NODE_ENV=production` — disables `synchronize: true`
- [ ] Run `npm run migration:run` as part of the deployment step (before starting the app)
- [ ] Never run `npm run migration:generate` against a production database
