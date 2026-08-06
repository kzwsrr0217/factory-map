/**
 * catalog-type-classify.test.ts — Reading the device type out of the catalogue name.
 *
 * The rule exists because the `Type` dropdown on an Alemba catalogue item is hand-set and
 * has been set wrongly, and because the first version of the rule was too eager: it read
 * "Switch" out of `Switch / Server 19" Rack` and would have turned 23 racks into switches.
 * Both of those are cases below.
 */
import { classifyAssetType, classifyFromCatalogName } from '../services/itsm/snapshotImport';

describe('classifyFromCatalogName', () => {
  it('reads a docking station, however the catalogue spells it', () => {
    expect(classifyFromCatalogName('DELL Dockingstation USB-C (WD19S)')).toBe('dock');
    expect(classifyFromCatalogName('DELL CAD Docking Station USB-C (WD19DCS)')).toBe('dock');
  });

  it('reads a switch that the Type field never classified', () => {
    expect(classifyFromCatalogName('Aruba Switches')).toBe('switch');
  });

  it('leaves a name that mentions two categories alone', () => {
    expect(classifyFromCatalogName('Switch / Server 19" Rack')).toBeNull();
  });

  it('does not turn a docking monitor into a dock', () => {
    expect(classifyFromCatalogName('Dell 24 UltraSharp Docking Monitor U2421E')).toBeNull();
  });

  it('says nothing about names it does not recognise', () => {
    expect(classifyFromCatalogName('Apple iPad Air')).toBeNull();
    expect(classifyFromCatalogName('UPS/USV')).toBeNull();
    expect(classifyFromCatalogName(null)).toBeNull();
    expect(classifyFromCatalogName('   ')).toBeNull();
  });
});

describe('classifyAssetType — the name against the Type field', () => {
  it('lets the name win where the Type field contradicts it', () => {
    // The real case: this catalogue item carries Type = Monitor in Alemba, and five
    // docking stations were counted as screens because of it.
    expect(classifyAssetType('Monitor', 'DELL CAD Docking Station USB-C (WD19DCS)')).toBe('dock');
  });

  it('still uses the Type field where the name says nothing', () => {
    expect(classifyAssetType('Notebook', 'Dell Latitude 5440')).toBe('laptop');
    expect(classifyAssetType('Monitor', 'Dell 24 UltraSharp Monitor U2415')).toBe('monitor');
  });

  it('still tells network devices apart by name', () => {
    expect(classifyAssetType('Network Device', 'W1-EG-AP-03')).toBe('access_point');
  });

  it('falls back to other when neither says anything', () => {
    expect(classifyAssetType('Accessory', 'USB Stick')).toBe('other');
    expect(classifyAssetType(null, null)).toBe('other');
  });
});
