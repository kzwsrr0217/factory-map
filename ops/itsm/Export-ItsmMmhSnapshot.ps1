# Export-ItsmMmhSnapshot.ps1
# Read-only export of MMH-location ITSM (Alemba/Operaio) hardware assets to a
# JSON file, for import into factorymap via `npm run import:itsm -- <dir>`.
#
# WHY THIS SCRIPT EXISTS: factorymap's backend runs in a Podman container with
# no confirmed path to authenticate to the real ITSM View API (no service
# account / API key today — see docs/DEVELOPER_GUIDE.md, ITSM section). The
# only proven access pattern is Windows Integrated/Kerberos SSO from a
# domain-joined machine, exactly like the sibling IPCdata reconciliation
# script (`Run-ItsmValidation.ps1`) already does. This script reuses that same
# query half — ONE OData call, filtered to MMH — but only ever writes a JSON
# file; it has no SQL Server dependency and never compares/writes anything.
#
# Run on a domain-joined Windows machine (the executing user's AD session
# authenticates — no password needed):
#   pwsh -File .\Export-ItsmMmhSnapshot.ps1
# Then copy the output file into the factorymap backend container and run:
#   docker exec factory-map-backend npm run import:itsm -- /path/to/export/dir
#
# READ-ONLY, single call: this makes exactly one filtered ITSM request
# (Count is typically in the low hundreds for one location, not the ~18k-row
# full catalogue) and writes nothing back to ITSM.
param(
    [string]$BaseUrl = 'https://servicemanager.maxonmotor.com',
    [string]$ViewId  = '3570d01e-0812-a0c1-1ac7-31bc1ce1f07d',
    [string]$LocationFilter = 'MMH',
    [string]$OutDir  = $PSScriptRoot,
    [string]$OutFile = 'itsm-mmh-hardware.json'
)

$ErrorActionPreference = 'Stop'

function Get-ItsmFiltered([string]$filter) {
    $u = "$BaseUrl/api/ViewAPI/GetViewData/$ViewId" + '?$filter=' + [uri]::EscapeDataString($filter)
    return Invoke-RestMethod -Uri $u -UseDefaultCredentials -TimeoutSec 300
}

# Every ITSM field comes back as an object with a .Value; nav-properties (the
# related Location / Catalog Item / Person records) nest one level deeper via
# .DisplayName.Value or .'$Id$'.Value. Each accessor is defensive (silently
# returns $null on a renamed/missing column) so a view change degrades
# gracefully instead of aborting the whole export.
function Get-Field($item, [string]$name) {
    try { return $item.$name.Value } catch { return $null }
}
function Get-NavDisplayName($item, [string]$navName) {
    try { return $item.$navName.DisplayName.Value } catch { return $null }
}
function Get-NavId($item, [string]$navName) {
    try { return $item.$navName.'$Id$'.Value } catch { return $null }
}

# Confirmed against a raw GetViewData dump (2026-07-27):
#  - the asset's own display name field is `DisplayName`, not `Name`.
#  - the person relationship is `HardwareAssetIsUsedByPerson`, not
#    `HardwareAssetIsAssignedToPerson` (that name never matched anything, so
#    AssignedPersonName silently came back null in every prior export).
#  - Manufacturer/Model/OperatingSystem/OSVersion do NOT exist as fields on
#    the Hardware Asset itself — Manufacturer/Model live on the linked
#    Catalog Item (see hardware-catalog-items.csv join in
#    import-itsm-snapshot.ts); OS isn't tracked as a queryable relationship
#    at all in this ITSM instance, confirmed by inspecting the Hardware
#    Asset's Software Assets list (applications only, no OS entry) — dropped.
function Get-AssetRecord($item) {
    [pscustomobject]@{
        HardwareAssetID = Get-Field $item 'HardwareAssetID'
        Guid            = Get-Field $item '$Id$'
        DisplayName     = Get-Field $item 'DisplayName'
        SerialNumber    = Get-Field $item 'SerialNumber'
        AssetTag        = Get-Field $item 'CompanyAssetTag'
        Status          = Get-Field $item 'Status'
        MACAddress      = Get-Field $item 'MACAddress'
        AssignedPersonName = Get-NavDisplayName $item 'HardwareAssetIsUsedByPerson'
        PersonId        = Get-NavId $item 'HardwareAssetIsUsedByPerson'
        ModifiedDate    = Get-Field $item 'LastModified'
        Location        = Get-NavDisplayName $item 'HardwareAssetIsAssignedToLocation'
        CatalogItem     = Get-NavDisplayName $item 'HardwareAssetIsBasedOnCatalogItem'
        CatalogItemId   = Get-NavId $item 'HardwareAssetIsBasedOnCatalogItem'
    }
}

Write-Host "ITSM lekérdezés (Location contains '$LocationFilter')..."
$resp = Get-ItsmFiltered "contains(HardwareAssetIsAssignedToLocation/DisplayName/Value,'$LocationFilter')"
$records = @($resp.Items | ForEach-Object { Get-AssetRecord $_ } | Where-Object { $_.HardwareAssetID })
Write-Host "  $($records.Count) $LocationFilter-s asset az ITSM-ben."

$outPath = Join-Path $OutDir $OutFile
$records | ConvertTo-Json -Depth 5 | Out-File -FilePath $outPath -Encoding utf8
Write-Host "KÉSZ. Kiírva: $outPath ($($records.Count) rekord)"
