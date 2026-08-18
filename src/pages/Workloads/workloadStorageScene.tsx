import { EmbeddedScene, PanelBuilders, SceneFlexItem, SceneFlexLayout, SceneQueryRunner, SceneVariableSet } from '@grafana/scenes';
import { GraphThresholdsStyleMode, LegendDisplayMode, ThresholdsMode } from '@grafana/schema';
import { VariableHide } from '@grafana/data';
import {
  workloadEphemeralVolumeUsageQuery,
  workloadIopsByPodQueries,
  workloadIopsQueries,
  workloadPvcStatusQuery,
  workloadPvcStorageClassQuery,
  workloadPvcVolumeBytesByWorkloadQuery,
  workloadPvcVolumeBytesQueries,
  workloadPvcVolumeInodesByWorkloadQuery,
  workloadPvcVolumeInodesQueries,
  workloadPvStatusQuery,
  workloadThroughputByPodQueries,
  workloadThroughputQueries,
} from '../../queries/workloadStorageQueries';
import { substituteWorkloadTokens } from '../../queries/workloadOverviewQueries';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { POD_VARIABLE_NAME, THANOS_VARIABLE_NAME, createPodFilterVariable } from '../../variables/datasourceVariables';

// Same green/orange/red capacity thresholds as the Namespace Drilldown's own
// pvcCapacityThresholds (namespaceStorageScene.tsx) - redeclared locally
// rather than imported, matching this codebase's established "every tab
// file redeclares its own small constants" convention.
const pvcCapacityThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'green', value: -Infinity },
    { color: 'orange', value: 0.75 },
    { color: 'red', value: 0.95 },
  ],
};

export function getWorkloadStorageScene(clusterRegex: string, namespaceRegex: string, workloadRegex: string, workload: string) {
  // Hidden pod variable - same reasoning as the Overview/CPU/Memory/Network
  // tabs' own: every $pod-referencing query below needs to resolve to
  // "every pod belonging to this workload", but there's no picker to expose
  // it through since each tab is its own EmbeddedScene.
  const podVariable = createPodFilterVariable(clusterRegex, namespaceRegex, { workload });
  podVariable.setState({ hide: VariableHide.hideVariable });
  const podToken = `\${${POD_VARIABLE_NAME}:regex}`;
  const substitute = (expr: string) => substituteWorkloadTokens(expr, clusterRegex, namespaceRegex, workloadRegex, podToken);

  const ephemeralUsageRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'usage', expr: substitute(workloadEphemeralVolumeUsageQuery), legendFormat: '{{pod}}/{{container}}' }],
  });

  const ephemeralUsagePanel = PanelBuilders.timeseries()
    .setTitle('Ephemeral Volume Usage')
    .setUnit('percentunit')
    .setData(ephemeralUsageRunner)
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const pvcStorageClassRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'storageclass', expr: substitute(workloadPvcStorageClassQuery), legendFormat: '{{storageclass}}' }],
  });

  const pvcStorageClassPanel = PanelBuilders.timeseries()
    .setTitle('PVC Storage Class')
    .setUnit('short')
    .setData(pvcStorageClassRunner)
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  // Only requests/capacity/used given this time - no "PV filling up" alert
  // series, unlike the Namespace Drilldown's own PVC Volume Bytes panel.
  const pvcVolumeBytesRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'requests', expr: substitute(workloadPvcVolumeBytesQueries.requests), legendFormat: 'Requests' },
      { refId: 'capacity', expr: substitute(workloadPvcVolumeBytesQueries.capacity), legendFormat: 'Capacity' },
      { refId: 'used', expr: substitute(workloadPvcVolumeBytesQueries.used), legendFormat: 'Used' },
    ],
  });

  const pvcVolumeBytesPanel = PanelBuilders.timeseries()
    .setTitle('PVC Volume Bytes')
    .setUnit('bytes')
    .setData(pvcVolumeBytesRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  // Grouped by pod (not workload/workload_type) - this page is already
  // scoped to one workload, so pod is the actual varying dimension. Title
  // kept exactly as given even though it still says "by workload".
  const pvcVolumeBytesByWorkloadRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'usage_pct', expr: substitute(workloadPvcVolumeBytesByWorkloadQuery), legendFormat: '{{pod}}' }],
  });

  const pvcVolumeBytesByWorkloadPanel = PanelBuilders.timeseries()
    .setTitle('PVC Volume bytes by workload (avg)')
    .setUnit('percentunit')
    .setMin(0)
    .setMax(1)
    .setThresholds(pvcCapacityThresholds)
    .setCustomFieldConfig('thresholdsStyle', { mode: GraphThresholdsStyleMode.Dashed })
    .setData(pvcVolumeBytesByWorkloadRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  // Only total/used given this time - no "Inodes filling up" alert series.
  const pvcVolumeInodesRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'total', expr: substitute(workloadPvcVolumeInodesQueries.total), legendFormat: 'Total' },
      { refId: 'used', expr: substitute(workloadPvcVolumeInodesQueries.used), legendFormat: 'Used' },
    ],
  });

  const pvcVolumeInodesPanel = PanelBuilders.timeseries()
    .setTitle('PVC Volume inodes')
    .setUnit('short')
    .setData(pvcVolumeInodesRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const pvcVolumeInodesByWorkloadRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'inodes_used_pct', expr: substitute(workloadPvcVolumeInodesByWorkloadQuery), legendFormat: '{{pod}}' }],
  });

  const pvcVolumeInodesByWorkloadPanel = PanelBuilders.timeseries()
    .setTitle('PVC Volume inodes by workload (avg)')
    .setUnit('percentunit')
    .setMin(0)
    .setMax(1)
    .setThresholds(pvcCapacityThresholds)
    .setCustomFieldConfig('thresholdsStyle', { mode: GraphThresholdsStyleMode.Dashed })
    .setData(pvcVolumeInodesByWorkloadRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const pvcStatusRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'phase', expr: substitute(workloadPvcStatusQuery), legendFormat: '{{phase}}' }],
  });

  const pvcStatusPanel = PanelBuilders.timeseries()
    .setTitle('PVC Status')
    .setUnit('short')
    .setData(pvcStatusRunner)
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const pvStatusRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'phase', expr: substitute(workloadPvStatusQuery), legendFormat: '{{phase}}' }],
  });

  const pvStatusPanel = PanelBuilders.timeseries()
    .setTitle('PV Status')
    .setUnit('short')
    .setData(pvStatusRunner)
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const throughputRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'reads', expr: substitute(workloadThroughputQueries.rx), legendFormat: 'Reads' },
      { refId: 'writes', expr: substitute(workloadThroughputQueries.tx), legendFormat: 'Writes' },
    ],
  });

  const throughputPanel = PanelBuilders.timeseries()
    .setTitle('Throughput')
    .setUnit('Bps')
    .setData(throughputRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'bottom', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const throughputByPodRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'reads', expr: substitute(workloadThroughputByPodQueries.rx), legendFormat: 'Reads ({{pod}})' },
      { refId: 'writes', expr: substitute(workloadThroughputByPodQueries.tx), legendFormat: 'Writes ({{pod}})' },
    ],
  });

  const throughputByPodPanel = PanelBuilders.timeseries()
    .setTitle('Throughput by pod')
    .setUnit('Bps')
    .setData(throughputByPodRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'bottom', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const iopsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'reads', expr: substitute(workloadIopsQueries.rx), legendFormat: 'Reads' },
      { refId: 'writes', expr: substitute(workloadIopsQueries.tx), legendFormat: 'Writes' },
    ],
  });

  const iopsPanel = PanelBuilders.timeseries()
    .setTitle('IOPS')
    .setUnit('iops')
    .setData(iopsRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'bottom', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const iopsByPodRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'reads', expr: substitute(workloadIopsByPodQueries.rx), legendFormat: 'Reads ({{pod}})' },
      { refId: 'writes', expr: substitute(workloadIopsByPodQueries.tx), legendFormat: 'Writes ({{pod}})' },
    ],
  });

  const iopsByPodPanel = PanelBuilders.timeseries()
    .setTitle('IOPS by pod')
    .setUnit('iops')
    .setData(iopsByPodRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'bottom', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  return new EmbeddedScene({
    $variables: new SceneVariableSet({ variables: [podVariable] }),
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({ height: 300, body: ephemeralUsagePanel }),
        new SceneFlexItem({ height: 300, body: pvcStorageClassPanel }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: pvcVolumeBytesPanel }),
            new SceneFlexItem({ height: 300, body: pvcVolumeBytesByWorkloadPanel }),
          ],
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: pvcVolumeInodesPanel }),
            new SceneFlexItem({ height: 300, body: pvcVolumeInodesByWorkloadPanel }),
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
