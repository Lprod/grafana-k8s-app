import { EmbeddedScene, PanelBuilders, SceneFlexItem, SceneFlexLayout, SceneQueryRunner, SceneVariableSet, VariableValueControl } from '@grafana/scenes';
import { GraphThresholdsStyleMode, LegendDisplayMode, ThresholdsMode } from '@grafana/schema';
import { substituteClusterNamespacePod } from '../../queries/namespaceQueries';
import {
  namespaceEphemeralVolumeUsageQuery,
  namespaceIopsByWorkloadQueries,
  namespaceIopsQueries,
  namespacePvcStatusQuery,
  namespacePvcStorageClassQuery,
  namespacePvcVolumeBytesByWorkloadQuery,
  namespacePvcVolumeBytesQueries,
  namespacePvcVolumeInodesByWorkloadQuery,
  namespacePvcVolumeInodesQueries,
  namespacePvStatusQuery,
  namespaceThroughputByWorkloadQueries,
  namespaceThroughputQueries,
} from '../../queries/namespaceStorageQueries';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { POD_VARIABLE_NAME, THANOS_VARIABLE_NAME, createPodFilterVariable } from '../../variables/datasourceVariables';

// Same green/orange/red capacity thresholds as clustersApp.tsx's own
// pvcCapacityThresholds (Cluster Storage tab's "by namespace (avg)" panels)
// - redeclared locally rather than imported, matching this codebase's
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

export function getNamespaceStorageScene(clusterRegex: string, namespaceRegex: string) {
  const podRegex = `\${${POD_VARIABLE_NAME}:regex}`;
  const substitute = (expr: string) => substituteClusterNamespacePod(expr, clusterRegex, namespaceRegex, podRegex);

  const ephemeralUsageRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'usage', expr: substitute(namespaceEphemeralVolumeUsageQuery), legendFormat: '{{pod}}/{{container}}' }],
  });

  const ephemeralUsagePanel = PanelBuilders.timeseries()
    .setTitle('Ephemeral Volume Usage')
    .setUnit('percentunit')
    .setData(ephemeralUsageRunner)
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const pvcStorageClassRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'storageclass', expr: substitute(namespacePvcStorageClassQuery), legendFormat: '{{storageclass}}' }],
  });

  const pvcStorageClassPanel = PanelBuilders.timeseries()
    .setTitle('PVC Storage Class')
    .setUnit('short')
    .setData(pvcStorageClassRunner)
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const pvcVolumeBytesRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'requests', expr: substitute(namespacePvcVolumeBytesQueries.requests), legendFormat: 'Requests' },
      { refId: 'capacity', expr: substitute(namespacePvcVolumeBytesQueries.capacity), legendFormat: 'Capacity' },
      { refId: 'used', expr: substitute(namespacePvcVolumeBytesQueries.used), legendFormat: 'Used' },
      { refId: 'alertsWarning', expr: substitute(namespacePvcVolumeBytesQueries.alertsWarning), legendFormat: 'PV filling up (warning)' },
      { refId: 'alertsCritical', expr: substitute(namespacePvcVolumeBytesQueries.alertsCritical), legendFormat: 'PV filling up (critical)' },
    ],
  });

  const pvcVolumeBytesPanel = PanelBuilders.timeseries()
    .setTitle('PVC Volume Bytes')
    .setUnit('bytes')
    .setData(pvcVolumeBytesRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const pvcVolumeBytesByWorkloadRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'usage_pct', expr: substitute(namespacePvcVolumeBytesByWorkloadQuery), legendFormat: '{{workload_type}}/{{workload}}' }],
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

  const pvcVolumeInodesRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'total', expr: substitute(namespacePvcVolumeInodesQueries.total), legendFormat: 'Total' },
      { refId: 'used', expr: substitute(namespacePvcVolumeInodesQueries.used), legendFormat: 'Used' },
      { refId: 'alertsWarning', expr: substitute(namespacePvcVolumeInodesQueries.alertsWarning), legendFormat: 'Inodes filling up (warning)' },
      { refId: 'alertsCritical', expr: substitute(namespacePvcVolumeInodesQueries.alertsCritical), legendFormat: 'Inodes filling up (critical)' },
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
    queries: [{ refId: 'inodes_used_pct', expr: substitute(namespacePvcVolumeInodesByWorkloadQuery), legendFormat: '{{workload_type}}/{{workload}}' }],
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
    queries: [{ refId: 'phase', expr: substitute(namespacePvcStatusQuery), legendFormat: '{{phase}}' }],
  });

  const pvcStatusPanel = PanelBuilders.timeseries()
    .setTitle('PVC Status')
    .setUnit('short')
    .setData(pvcStatusRunner)
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const pvStatusRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'phase', expr: substitute(namespacePvStatusQuery), legendFormat: '{{phase}}' }],
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
      { refId: 'reads', expr: substitute(namespaceThroughputQueries.rx), legendFormat: 'Reads' },
      { refId: 'writes', expr: substitute(namespaceThroughputQueries.tx), legendFormat: 'Writes' },
    ],
  });

  const throughputPanel = PanelBuilders.timeseries()
    .setTitle('Throughput')
    .setUnit('Bps')
    .setData(throughputRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const throughputByWorkloadRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'reads', expr: substitute(namespaceThroughputByWorkloadQueries.rx), legendFormat: 'Reads ({{workload_type}}/{{workload}})' },
      { refId: 'writes', expr: substitute(namespaceThroughputByWorkloadQueries.tx), legendFormat: 'Writes ({{workload_type}}/{{workload}})' },
    ],
  });

  const throughputByWorkloadPanel = PanelBuilders.timeseries()
    .setTitle('Throughput by workload')
    .setUnit('Bps')
    .setData(throughputByWorkloadRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const iopsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'reads', expr: substitute(namespaceIopsQueries.rx), legendFormat: 'Reads' },
      { refId: 'writes', expr: substitute(namespaceIopsQueries.tx), legendFormat: 'Writes' },
    ],
  });

  const iopsPanel = PanelBuilders.timeseries()
    .setTitle('IOPS')
    .setUnit('iops')
    .setData(iopsRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const iopsByWorkloadRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'reads', expr: substitute(namespaceIopsByWorkloadQueries.rx), legendFormat: 'Reads ({{workload_type}}/{{workload}})' },
      { refId: 'writes', expr: substitute(namespaceIopsByWorkloadQueries.tx), legendFormat: 'Writes ({{workload_type}}/{{workload}})' },
    ],
  });

  const iopsByWorkloadPanel = PanelBuilders.timeseries()
    .setTitle('IOPS by workload')
    .setUnit('iops')
    .setData(iopsByWorkloadRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  return new EmbeddedScene({
    $variables: new SceneVariableSet({ variables: [createPodFilterVariable(clusterRegex, namespaceRegex)] }),
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          width: 220,
          ySizing: 'content',
          body: new VariableValueControl({ variableName: POD_VARIABLE_NAME }),
        }),
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
            new SceneFlexItem({ height: 300, body: throughputByWorkloadPanel }),
          ],
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: iopsPanel }),
            new SceneFlexItem({ height: 300, body: iopsByWorkloadPanel }),
          ],
        }),
      ],
    }),
  });
}
