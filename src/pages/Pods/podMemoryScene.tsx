import { EmbeddedScene, FieldConfigOverridesBuilder, PanelBuilders, SceneDataTransformer, SceneFlexItem, SceneFlexLayout, SceneQueryRunner } from '@grafana/scenes';
import { BigValueColorMode, BigValueGraphMode, LegendDisplayMode, StackingMode, ThresholdsMode } from '@grafana/schema';
import { FieldColorModeId } from '@grafana/data';
import {
  workloadMemoryDistributionQuery,
  workloadMemoryOverviewUsageQueries,
  workloadMemoryPodAlignmentQuery,
  workloadMemoryStatQueries,
  WorkloadMemoryOverviewUsageKey,
  WorkloadMemoryStatKey,
} from '../../queries/workloadMemoryQueries';
import { substituteWorkloadTokens } from '../../queries/workloadOverviewQueries';
import { podContainersTableQueries } from '../../queries/podOverviewQueries';
import { usageThresholds } from '../../scenes/tableCells';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { THANOS_VARIABLE_NAME } from '../../variables/datasourceVariables';

// Reuses the Workload Drilldown's own Memory tab queries verbatim
// (workloadMemoryQueries.ts) - see podCpuScene.tsx's own file-level comment
// for why no hidden Pod variable is needed here: $pod is substituted with
// this page's own single, already-known pod name directly.

const alertsThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'green', value: -Infinity },
    { color: 'red', value: 1 },
  ],
};

function applyMemoryUsageSeriesOverrides(b: FieldConfigOverridesBuilder<any>) {
  return b
    .matchFieldsByQuery('limits')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'red' })
    .overrideCustomFieldConfig('lineStyle', { fill: 'dash' })
    .matchFieldsByQuery('requests')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'orange' })
    .overrideCustomFieldConfig('lineStyle', { fill: 'dash' })
    .matchFieldsByQuery('usage')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'blue' });
}

const memoryStatPanelDefs: Array<{ key: WorkloadMemoryStatKey; title: string; unit: string; thresholds: typeof alertsThresholds }> = [
  { key: 'alertsFiring', title: 'Alerts: Firing (p95)', unit: 'short', thresholds: alertsThresholds },
  { key: 'schedulingRequestsSet', title: 'Scheduling: Containers with Memory requests set (p95)', unit: 'percentunit', thresholds: usageThresholds },
  { key: 'alignmentUsageRequests', title: 'Alignment: Usage/Requests (p95)', unit: 'percentunit', thresholds: usageThresholds },
];

function buildMemoryStatPanel(title: string, expr: string, unit: string, thresholds: typeof alertsThresholds) {
  const runner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'value', expr }],
  });
  return PanelBuilders.stat()
    .setTitle(title)
    .setUnit(unit)
    .setThresholds(thresholds)
    .setOption('colorMode', BigValueColorMode.Value)
    .setOption('graphMode', BigValueGraphMode.Area)
    .setData(runner)
    .build();
}

export function getPodMemoryScene(clusterRegex: string, namespaceRegex: string, workloadRegex: string, podRegex: string) {
  const substitute = (expr: string) => substituteWorkloadTokens(expr, clusterRegex, namespaceRegex, workloadRegex, podRegex);

  const statPanels = memoryStatPanelDefs.map((def) =>
    buildMemoryStatPanel(def.title, substitute(workloadMemoryStatQueries[def.key]), def.unit, def.thresholds)
  );

  const overviewUsageLegends: Record<WorkloadMemoryOverviewUsageKey, string> = {
    limits: 'Sum of container memory limits',
    requests: 'Sum of container memory requests',
    usage: 'Sum of container memory usage',
  };
  const overviewUsageRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(workloadMemoryOverviewUsageQueries) as WorkloadMemoryOverviewUsageKey[]).map((key) => ({
      refId: key,
      expr: substitute(workloadMemoryOverviewUsageQueries[key]),
      legendFormat: overviewUsageLegends[key],
    })),
  });
  const overviewUsagePanel = PanelBuilders.timeseries()
    .setTitle('Overview: Usage (memory bytes)')
    .setUnit('bytes')
    .setData(overviewUsageRunner)
    .setOverrides(applyMemoryUsageSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const distributionRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'distribution', expr: substitute(workloadMemoryDistributionQuery), legendFormat: '{{workload_type}}/{{pod}}' }],
  });
  const distributionPanel = PanelBuilders.timeseries()
    .setTitle('Distribution: Pod usage (bytes, stacked)')
    .setUnit('bytes')
    .setData(distributionRunner)
    .setCustomFieldConfig('stacking', { mode: StackingMode.Normal })
    .setCustomFieldConfig('lineWidth', 2)
    .setCustomFieldConfig('fillOpacity', 60)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const podAlignmentRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'alignment', expr: substitute(workloadMemoryPodAlignmentQuery), legendFormat: '{{workload_type}}/{{pod}}' }],
  });
  const podAlignmentPanel = PanelBuilders.timeseries()
    .setTitle('Alignment: Pod Usage/Requests (%)')
    .setUnit('percentunit')
    .setData(podAlignmentRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  // "Containers" table - one row per container in this pod, queried directly
  // at container granularity (podContainersTableQueries, shared with the Pod
  // Drilldown's own Overview tab and its CPU tab sibling - see that
  // constant's own comment in podOverviewQueries.ts). Only the
  // Memory-relevant subset of that query set is used here.
  const tableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'info', expr: substitute(podContainersTableQueries.info), format: 'table' as const, instant: true },
      { refId: 'memUsage', expr: substitute(podContainersTableQueries.memUsage), format: 'table' as const, instant: true },
      { refId: 'memRequests', expr: substitute(podContainersTableQueries.memRequests), format: 'table' as const, instant: true },
      { refId: 'memLimits', expr: substitute(podContainersTableQueries.memLimits), format: 'table' as const, instant: true },
    ],
  });

  const tableData = new SceneDataTransformer({
    $data: tableRunner,
    transformations: [
      { id: 'merge', options: {} },
      {
        id: 'organize',
        options: {
          excludeByName: {
            Time: true,
            cluster: true,
            namespace: true,
            pod: true,
            'Value #info': true,
          },
          indexByName: {
            container: 0,
            image_spec: 1,
            'Value #memUsage': 2,
            'Value #memRequests': 3,
            'Value #memLimits': 4,
          },
          renameByName: {},
        },
      },
    ],
  });

  const table = PanelBuilders.table()
    .setTitle('Containers')
    .setData(tableData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('container')
        .overrideDisplayName('CONTAINER')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('image_spec')
        .overrideDisplayName('IMAGE_SPEC')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #memUsage')
        .overrideDisplayName('MEMORY USAGE')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #memRequests')
        .overrideDisplayName('MEMORY REQUESTS')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #memLimits')
        .overrideDisplayName('MEMORY LIMITS')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
    )
    .build();

  return new EmbeddedScene({
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: statPanels.map((panel) => new SceneFlexItem({ height: 120, body: panel })),
        }),
        new SceneFlexLayout({
          direction: 'row',
          children: [
            new SceneFlexItem({ height: 300, body: overviewUsagePanel }),
            new SceneFlexItem({ height: 300, body: distributionPanel }),
            new SceneFlexItem({ height: 300, body: podAlignmentPanel }),
          ],
        }),
        new SceneFlexItem({ height: 400, body: table }),
      ],
    }),
  });
}
