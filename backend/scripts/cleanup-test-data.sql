-- cleanup-test-data.sql
-- Removes known test-run artifacts from the development/production database.
-- Run this against the factorymap database (NOT factorymap_test).
--
-- Usage (Docker):
--   docker exec factory-map-mssql /opt/mssql-tools18/bin/sqlcmd \
--     -S localhost -U sa -P "<password>" -d factorymap \
--     -i /path/to/cleanup-test-data.sql -No
--
-- Review the SELECT statements first, then uncomment the DELETE blocks.

USE factorymap;
GO

-- ── Preview: assets matching test patterns ─────────────────────────────────
SELECT id, display_name, created_at
FROM assets
WHERE display_name IN (
  'RBAC Viewer Target Asset',
  'Operator Test Asset',
  'Blocking Asset',
  'Floor Blocking Asset',
  'Cascade Section',
  'Viewer Attempted Building'   -- in case this ended up as an asset name
)
   OR display_name LIKE 'RBAC%'
   OR display_name LIKE '__test\_%' ESCAPE '\'
ORDER BY created_at DESC;
GO

-- ── Preview: buildings matching test patterns ──────────────────────────────
SELECT id, name, created_at
FROM buildings
WHERE name IN ('__test_building__', '__test_building_updated__', 'Viewer Attempted Building')
   OR name LIKE 'fl\_bldg\_%'    ESCAPE '\'
   OR name LIKE 'sec\_%'         ESCAPE '\'
   OR name LIKE 'wa\_%'          ESCAPE '\'
   OR name LIKE 'ws\_%'          ESCAPE '\'
   OR name LIKE 'net\_test\_bldg\_%' ESCAPE '\'
   OR name LIKE 'aud\_%'         ESCAPE '\'
   OR name LIKE 'cascade\_bldg\_%'   ESCAPE '\'
   OR name LIKE 'blocked\_bldg\_%'   ESCAPE '\'
   OR name LIKE 'E2E\_Bldg\_%'   ESCAPE '\'
   OR name LIKE 'RBAC%'
   OR name LIKE 'rbac\_%'        ESCAPE '\'
ORDER BY created_at DESC;
GO

-- ── DELETE: assets ─────────────────────────────────────────────────────────
-- Uncomment after reviewing the SELECT output above.
/*
DELETE FROM assets
WHERE display_name IN (
  'RBAC Viewer Target Asset',
  'Operator Test Asset',
  'Blocking Asset',
  'Floor Blocking Asset'
)
   OR display_name LIKE 'RBAC%'
   OR display_name LIKE '__test\_%' ESCAPE '\';
*/

-- ── DELETE: buildings (cascades to floors/workareas/sections/workstations) ─
-- WARNING: buildings with assets assigned cannot be deleted via SQL cascade
-- unless you delete the assets first (FK constraint).
-- Uncomment after reviewing the SELECT output above.
/*
DELETE FROM buildings
WHERE name IN ('__test_building__', '__test_building_updated__', 'Viewer Attempted Building')
   OR name LIKE 'fl\_bldg\_%'    ESCAPE '\'
   OR name LIKE 'sec\_%'         ESCAPE '\'
   OR name LIKE 'wa\_%'          ESCAPE '\'
   OR name LIKE 'ws\_%'          ESCAPE '\'
   OR name LIKE 'net\_test\_bldg\_%' ESCAPE '\'
   OR name LIKE 'aud\_%'         ESCAPE '\'
   OR name LIKE 'cascade\_bldg\_%'   ESCAPE '\'
   OR name LIKE 'blocked\_bldg\_%'   ESCAPE '\'
   OR name LIKE 'E2E\_Bldg\_%'   ESCAPE '\'
   OR name LIKE 'RBAC%'
   OR name LIKE 'rbac\_%'        ESCAPE '\';
*/
