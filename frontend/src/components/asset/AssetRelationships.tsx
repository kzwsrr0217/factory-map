/**
 * AssetRelationships.tsx — Visual tree of an asset's predecessor/successor
 * and dependency relationships.
 *
 * Calls `assetService.getRelationships(assetId)` on open and renders the
 * result in three grouped sections: parents (predecessors), children
 * (successors), and dependencies. Each node shows the asset name, type badge,
 * and status badge. Clicking a node navigates to that asset's detail page.
 *
 * `RelationshipNode.level` indicates depth in the graph (0 = direct, 1 =
 * second-degree, etc.) and is used to apply indentation via CSS.
 */
import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import Badge from '../common/Badge';
import Card from '../common/Card';
import { assetService, Asset } from '../../services/asset.service';
import styles from '../../styles/components/AssetRelationships.module.css';

interface AssetRelationshipsProps {
  isOpen: boolean;
  onClose: () => void;
  assetId: string;
  assetName: string;
}

interface RelationshipNode {
  asset: Asset;
  level: number;
  type: 'parent' | 'child' | 'dependency';
}

const AssetRelationships: React.FC<AssetRelationshipsProps> = ({
  isOpen,
  onClose,
  assetId,
  assetName,
}) => {
  const [relationships, setRelationships] = useState<{
    parents: RelationshipNode[];
    children: RelationshipNode[];
    dependencies: RelationshipNode[];
  }>({
    parents: [],
    children: [],
    dependencies: [],
  });
  const [loading, setLoading] = useState(false);
  const [impactAnalysis, setImpactAnalysis] = useState<{
    affectedAssets: Asset[];
    riskLevel: 'low' | 'medium' | 'high';
    description: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadRelationships();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, assetId]);

  /**
   * Both directions of this asset's parent-child and dependency links.
   *
   * The direction convention here is the one the existing view already used: an edge
   * runs child → parent, so a link pointing AT this asset makes the other end a
   * child (or, for `dependency`, something that depends on this asset), and a link
   * FROM this asset points at its parent.
   *
   * Inbound links used to be found by downloading every asset and scanning each
   * one's connection list. `GET /assets?connected_to=` answers the same question in
   * the database, which is also the only version that stays correct: the download
   * was capped at 1000 rows, so a dependant past that cap was silently invisible
   * here — on the panel whose whole job is "what breaks if I touch this".
   */
  const loadRelationships = async () => {
    try {
      setLoading(true);
      const [currentAsset, inboundAssets] = await Promise.all([
        assetService.getAsset(assetId),
        assetService.getAssetsConnectedTo(assetId),
      ]);
      if (!currentAsset) return;

      const parents: RelationshipNode[] = [];
      const children: RelationshipNode[] = [];
      const dependencies: RelationshipNode[] = [];

      for (const other of inboundAssets) {
        for (const c of other.connections ?? []) {
          if (c.connected_asset_id !== assetId) continue;
          if (c.connection_type === 'parent-child') children.push({ asset: other, level: 1, type: 'child' });
          else if (c.connection_type === 'dependency') dependencies.push({ asset: other, level: 1, type: 'dependency' });
        }
      }

      // Outbound parent-child links name this asset's parents; resolve just those ids.
      const parentIds = [...new Set(
        (currentAsset.connections ?? [])
          .filter(c => c.connection_type === 'parent-child')
          .map(c => c.connected_asset_id),
      )];
      if (parentIds.length > 0) {
        const parentAssets = await assetService.getAssetsByIds(parentIds);
        parentAssets.forEach(a => parents.push({ asset: a, level: 1, type: 'parent' }));
      }

      setRelationships({ parents, children, dependencies });
      analyzeImpact(currentAsset, inboundAssets);
    } catch (error) {
      console.error('Error loading relationships:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * `inboundAssets` are exactly the assets with a link pointing at this one, so the
   * affected set is that list filtered to the two types that mean "breaks with it".
   */
  const analyzeImpact = (_asset: Asset, inboundAssets: Asset[]) => {
    const affectedAssets: Asset[] = inboundAssets.filter(other =>
      (other.connections ?? []).some(c =>
        c.connected_asset_id === assetId &&
        (c.connection_type === 'dependency' || c.connection_type === 'parent-child')),
    );
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    // Determine risk level based on number of affected assets and their criticality
    if (affectedAssets.length > 10) {
      riskLevel = 'high';
    } else if (affectedAssets.length > 5) {
      riskLevel = 'medium';
    }

    // Check for critical systems
    const hasCriticalAssets = affectedAssets.some(a => 
      a.custom_fields?.environment === 'production' || 
      a.basic_info.status === 'maintenance'
    );

    if (hasCriticalAssets) {
      riskLevel = riskLevel === 'low' ? 'medium' : 'high';
    }

    const description = `This asset affects ${affectedAssets.length} other asset${affectedAssets.length !== 1 ? 's' : ''}. ` +
      `Risk level: ${riskLevel}. ${hasCriticalAssets ? 'Includes critical production assets.' : ''}`;

    setImpactAnalysis({
      affectedAssets,
      riskLevel,
      description,
    });
  };

  const renderRelationshipSection = (
    title: string, 
    nodes: RelationshipNode[], 
    type: 'parent' | 'child' | 'dependency'
  ) => (
    <div className={styles.section}>
      <h4 className={styles.sectionTitle}>{title}</h4>
      {nodes.length === 0 ? (
        <p className={styles.empty}>No {type} relationships found</p>
      ) : (
        <div className={styles.relationshipList}>
          {nodes.map((node, index) => (
            <div key={index} className={styles.relationshipItem}>
              <div className={styles.assetInfo}>
                <span className={styles.assetName}>{node.asset.basic_info.display_name}</span>
                <Badge variant={type === 'dependency' ? 'warning' : 'info'}>
                  {type}
                </Badge>
              </div>
              <div className={styles.assetMeta}>
                <span>{node.asset.basic_info.model}</span>
                <span>{node.asset.basic_info.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Asset Relationships - ${assetName}`}>
      <div className={styles.container}>
        {loading && <div className={styles.loading}>Loading relationships...</div>}

        {!loading && (
          <>
            {/* Impact Analysis */}
            {impactAnalysis && (
              <Card padding="lg" className={`${styles.impactCard} ${styles[impactAnalysis.riskLevel]}`}>
                <h4>Impact Analysis</h4>
                <p>{impactAnalysis.description}</p>
                <div className={styles.impactStats}>
                  <span>Affected Assets: {impactAnalysis.affectedAssets.length}</span>
                  <Badge variant={
                    impactAnalysis.riskLevel === 'high' ? 'error' :
                    impactAnalysis.riskLevel === 'medium' ? 'warning' : 'success'
                  }>
                    {impactAnalysis.riskLevel.toUpperCase()} RISK
                  </Badge>
                </div>
              </Card>
            )}

            {/* Relationships */}
            <div className={styles.relationshipsGrid}>
              {renderRelationshipSection('Parent Assets', relationships.parents, 'parent')}
              {renderRelationshipSection('Child Assets', relationships.children, 'child')}
              {renderRelationshipSection('Dependencies', relationships.dependencies, 'dependency')}
            </div>

            {/* Relationship Diagram */}
            <Card padding="lg">
              <h4>Relationship Diagram</h4>
              {(() => {
                const allNodes = [
                  ...relationships.parents,
                  ...relationships.children,
                  ...relationships.dependencies,
                ];
                if (allNodes.length === 0) {
                  return (
                    <div className={styles.diagramPlaceholder}>
                      <p>No relationships found for this asset.</p>
                    </div>
                  );
                }
                const W = 560, H = 340;
                const cx = W / 2, cy = H / 2;
                const typeColor: { [k: string]: string } = {
                  parent: '#6366f1',
                  child: '#10b981',
                  dependency: '#f59e0b',
                };
                const positions: { node: RelationshipNode; x: number; y: number }[] = [];
                const sectors: { list: RelationshipNode[]; a0: number; a1: number }[] = [
                  { list: relationships.parents,      a0: -2.3, a1: -0.8 },
                  { list: relationships.children,     a0:  0.8, a1:  2.3 },
                  { list: relationships.dependencies, a0: -0.35, a1: 0.35 },
                ];
                sectors.forEach(({ list, a0, a1 }) => {
                  list.forEach((node, i) => {
                    const t = list.length === 1 ? 0.5 : i / (list.length - 1);
                    const angle = a0 + (a1 - a0) * t;
                    const r = 130 + (list.length > 4 ? (i % 2) * 30 : 0);
                    positions.push({ node, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
                  });
                });
                const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s;
                return (
                  <div className={styles.diagramWrapper}>
                    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className={styles.diagramSvg}>
                      {positions.map(({ node, x, y }) => (
                        <line
                          key={node.asset._id}
                          x1={cx} y1={cy} x2={x} y2={y}
                          stroke={typeColor[node.type]}
                          strokeWidth="2"
                          strokeOpacity="0.5"
                          strokeDasharray={node.type === 'dependency' ? '6 3' : undefined}
                        />
                      ))}
                      {positions.map(({ node, x, y }) => (
                        <g key={node.asset._id}>
                          <circle cx={x} cy={y} r={24} fill={typeColor[node.type]} />
                          <text x={x} y={y - 4} textAnchor="middle" dominantBaseline="central" fill="white" fontSize="9" fontWeight="600">
                            {truncate(node.asset.basic_info.display_name, 11)}
                          </text>
                          <text x={x} y={y + 8} textAnchor="middle" fill="white" fontSize="8" opacity="0.85">
                            {node.type}
                          </text>
                        </g>
                      ))}
                      <circle cx={cx} cy={cy} r={32} fill="#3b82f6" />
                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="white" fontSize="10" fontWeight="bold">
                        {truncate(assetName, 12)}
                      </text>
                    </svg>
                    <div className={styles.diagramLegend}>
                      <span style={{ color: '#6366f1' }}>● Parents</span>
                      <span style={{ color: '#10b981' }}>● Children</span>
                      <span style={{ color: '#f59e0b' }}>● Dependencies</span>
                    </div>
                  </div>
                );
              })()}
            </Card>
          </>
        )}
      </div>
    </Modal>
  );
};

export default AssetRelationships;