import { EmbeddedScene, PanelBuilders, SceneFlexItem, SceneFlexLayout, SceneQueryRunner, SceneVariableSet } from '@grafana/scenes';
import { GraphThresholdsStyleMode, LegendDisplayMode, ThresholdsMode } from '@grafana/schema';
import { VariableHide } from '@grafana/data';
import {
  nodeIopsByPodQueries,
  nodeIopsQueries,
  nodePvStatusQuery,
  nodePvcStatusQuery,
  nodePvcStorageClassQuery,
  nodePvcVolumeBytesByPodQuery,
  nodePvcVolumeBytesQueries,
  nodePvcVolumeInodesByPodQuery,
  nodePvcVolumeInodesQueries,
  nodeThroughputByPodQueries,
  nodeThroughputQueries,
} from '../../queries/nodeStorageQueries';
import { substituteClusterNodeAndPodToken } from '../../queries/nodeQueries';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { POD_VARIABLE_NAME, THANOS_VARIABLE_NAME, createNodePodFilterVariable } from '../../variables/datasourceVariables';

// Same green/orange/red capacity thresholds as the Namespace/Cluster
// Drilldowns' own Storage tabs - redeclared locally per this codebase's
// established "every tab file redeclares its own small constants"
// convention.
const pvcCapacityThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'green', value: -Infinity },
    { color: 'orange', value: 0.75 },
    { color: 'red', value: 0.95 },
  ],
};

export function getNodeStorageScene(clusterRegex: string, node: string, nodeRegex: string) {
  // Hidden pod variable, same reasoning as the Network tab's own - the
  // dashboard's Storage tab has no visible Pod picker either, but several
  // panels' queries still reference $pod.
  const podVariable = createNodePodFilterVariable(clusterRegex, node);
  podVariable.setState({ hide: VariableHide.hideVariable });
  const podToken = `\${${POD_VARIABLE_NAME}:regex}`;
  const substitute = (expr: string) => substituteClusterNodeAndPodToken(expr, clusterRegex, node, nodeRegex, podToken);

  const pvcStorageClassRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'storageclass', expr: substitute(nodePvcStorageClassQuery), legendFormat: '{{storageclass}}' }],
  });
  const pvcStorageClassPanel = PanelBuilders.timeseries()
    .setTitle('PVC Storage Class')
    .setUnit('short')
    .setData(pvcStorageClassRunner)
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const pvcVolumeBytesRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'requested', expr: substitute(nodePvcVolumeBytesQueries.requested), legendFormat: 'requested' },
      { refId: 'capacity', expr: substitute(nodePvcVolumeBytesQueries.capacity), legendFormat: 'capacity' },
      { refId: 'used', expr: substitute(nodePvcVolumeBytesQueries.used), legendFormat: 'used' },
    ],
  });
  const pvcVolumeBytesPanel = PanelBuilders.timeseries()
    .setTitle('PVC Volume Bytes')
    .setUnit('bytes')
    .setData(pvcVolumeBytesRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  // Title says "by pod", not "by workload" - the dashboard's own literal
  // title, matching its pod-grained (not workload-grained) query.
  const pvcVolumeBytesByPodRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'usage_pct', expr: substitute(nodePvcVolumeBytesByPodQuery), legendFormat: '{{pod}}' }],
  });
  const pvcVolumeBytesByPodPanel = PanelBuilders.timeseries()
    .setTitle('PVC Volume bytes by pod (avg)')
    .setUnit('percentunit')
    .setMin(0)
    .setMax(1)
    .setThresholds(pvcCapacityThresholds)
    .setCustomFieldConfig('thresholdsStyle', { mode: GraphThresholdsStyleMode.Dashed })
    .setData(pvcVolumeBytesByPodRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const pvcVolumeInodesRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'capacity', expr: substitute(nodePvcVolumeInodesQueries.capacity), legendFormat: 'capacity' },
      { refId: 'used', expr: substitute(nodePvcVolumeInodesQueries.used), legendFormat: 'used' },
    ],
  });
  const pvcVolumeInodesPanel = PanelBuilders.timeseries()
    .setTitle('PVC Volume inodes')
    .setUnit('short')
    .setData(pvcVolumeInodesRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  // Dashboard's own title says "by workload" - given verbatim even though
  // the query groups by pod, same "preserve the literal title" rule as the
  // Volume Bytes panel above.
  const pvcVolumeInodesByPodRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'inodes_used_pct', expr: substitute(nodePvcVolumeInodesByPodQuery), legendFormat: '{{pod}}' }],
  });
  const pvcVolumeInodesByPodPanel = PanelBuilders.timeseries()
    .setTitle('PVC Volume inodes by workload (avg)')
    .setUnit('percentunit')
    .setMin(0)
    .setMax(1)
    .setThresholds(pvcCapacityThresholds)
    .setCustomFieldConfig('thresholdsStyle', { mode: GraphThresholdsStyleMode.Dashed })
    .setData(pvcVolumeInodesByPodRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const pvcStatusRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'phase', expr: substitute(nodePvcStatusQuery), legendFormat: '{{phase}}' }],
  });
  const pvcStatusPanel = PanelBuilders.timeseries()
    .setTitle('PVC Status')
    .setUnit('short')
    .setData(pvcStatusRunner)
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const pvStatusRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'phase', expr: substitute(nodePvStatusQuery), legendFormat: '{{phase}}' }],
  });
  const pvStatusPanel = PanelBuilders.timeseries()
    .setTitle('PV Status')
    .setUnit('short')
    .setData(pvStatusRunner)
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const throughputRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'read', expr: substitute(nodeThroughputQueries.rx), legendFormat: 'read' },
      { refId: 'write', expr: substitute(nodeThroughputQueries.tx), legendFormat: 'write' },
    ],
  });
  const throughputPanel = PanelBuilders.timeseries()
    .setTitle('Throughput')
    .setUnit('Bps')
    .setData(throughputRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'bottom', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const throughputByPodRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'read', expr: substitute(nodeThroughputByPodQueries.rx), legendFormat: 'read ({{pod}})' },
      { refId: 'write', expr: substitute(nodeThroughputByPodQueries.tx), legendFormat: 'write ({{pod}})' },
    ],
  });
  const throughputByPodPanel = PanelBuilders.timeseries()
    .setTitle('Throughput by workload')
    .setUnit('Bps')
    .setData(throughputByPodRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'bottom', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const iopsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'read', expr: substitute(nodeIopsQueries.rx), legendFormat: 'read' },
      { refId: 'write', expr: substitute(nodeIopsQueries.tx), legendFormat: 'write' },
    ],
  });
  const iopsPanel = PanelBuilders.timeseries()
    .setTitle('IOPS')
    .setUnit('iops')
    .setData(iopsRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'bottom', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const iopsByPodRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'read', expr: substitute(nodeIopsByPodQueries.rx), legendFormat: 'read ({{pod}})' },
      { refId: 'write', expr: substitute(nodeIopsByPodQueries.tx), legendFormat: 'write ({{pod}})' },
    ],
  });
  const iopsByPodPanel = PanelBuilders.timeseries()
    .setTitle('IOPS by workload')
    .setUnit('iops')
    .setData(iopsByPodRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'bottom', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  return new EmbeddedScene({
    $variables: new SceneVariableSet({ variables: [podVariable] }),
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({ height: 300, body: pvcStorageClassPanel }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: pvcVolumeBytesPanel }),
            new SceneFlexItem({ height: 300, body: pvcVolumeBytesByPodPanel }),
          ],
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: pvcVolumeInodesPanel }),
            new SceneFlexItem({ height: 300, body: pvcVolumeInodesByPodPanel }),
          ],
        }),
        new SceneFlexItem({ height: 300, body: pvcStatusPanel }),
        new SceneFlexItem({ height: 300, body: pvStatusPanel }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: throughputPanel }),
            new SceneFlexItem({ height: 300, body: throughputByPodPanel }),
          ],
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: iopsPanel }),
            new SceneFlexItem({ height: 300, body: iopsByPodPanel }),
          ],
        }),
      ],
    }),
  });
}
