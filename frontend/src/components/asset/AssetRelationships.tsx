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

  const loadRelationships = async () => {
    try {
      setLoading(true);
      const allAssets = await assetService.getAssets();
      const currentAsset = allAssets.find(a => a._id === assetId);
      
      if (!currentAsset) return;

      const parents: RelationshipNode[] = [];
      const children: RelationshipNode[] = [];
      const dependencies: RelationshipNode[] = [];

      // Find parent-child relationships
      allAssets.forEach(asset => {
        if (asset.connections) {
          asset.connections.forEach(connection => {
            if (connection.connection_type === 'parent-child') {
              if (connection.connected_asset_id === assetId) {
                // This asset is a child of current asset
                const parentAsset = allAssets.find(a => a._id === asset._id);
                if (parentAsset) {
                  children.push({
                    asset: parentAsset,
                    level: 1,
                    type: 'child',
                  });
                }
              } else if (asset._id === assetId) {
                // Current asset has a parent
                const childAsset = allAssets.find(a => a._id === connection.connected_asset_id);
                if (childAsset) {
                  parents.push({
                    asset: childAsset,
                    level: 1,
                    type: 'parent',
                  });
                }
              }
            } else if (connection.connection_type === 'dependency') {
              if (connection.connected_asset_id === assetId) {
                // This asset depends on current asset
                const dependentAsset = allAssets.find(a => a._id === asset._id);
                if (dependentAsset) {
                  dependencies.push({
                    asset: dependentAsset,
                    level: 1,
                    type: 'dependency',
                  });
                }
              }
            }
          });
        }
      });

      setRelationships({ parents, children, dependencies });
      analyzeImpact(currentAsset, allAssets);
    } catch (error) {
      console.error('Error loading relationships:', error);
    } finally {
      setLoading(false);
    }
  };

  const analyzeImpact = (_asset: Asset, allAssets: Asset[]) => {
    const affectedAssets: Asset[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    // Find assets that depend on this asset
    allAssets.forEach(otherAsset => {
      if (otherAsset.connections) {
        otherAsset.connections.forEach(connection => {
          if (connection.connected_asset_id === assetId && 
              (connection.connection_type === 'dependency' || connection.connection_type === 'parent-child')) {
            affectedAssets.push(otherAsset);
          }
        });
      }
    });

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