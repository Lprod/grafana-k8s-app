import { EmbeddedScene, FieldConfigOverridesBuilder, PanelBuilders, SceneDataTransformer, SceneFlexItem, SceneFlexLayout, SceneQueryRunner } from '@grafana/scenes';
import { BigValueColorMode, BigValueGraphMode, LegendDisplayMode, StackingMode, TableCellDisplayMode, ThresholdsMode } from '@grafana/schema';
import { FieldColorModeId } from '@grafana/data';
import {
  workloadMemoryDistributionQuery,
  workloadMemoryOverviewUsageQueries,
  workloadMemoryPodAlignmentQuery,
  workloadMemoryPodsTableQueries,
  workloadMemoryStatQueries,
  WorkloadMemoryOverviewUsageKey,
  WorkloadMemoryPodsTableQueryKey,
  WorkloadMemoryStatKey,
} from '../../queries/workloadMemoryQueries';
import { substituteWorkloadTokens } from '../../queries/workloadOverviewQueries';
import { attachPercentField, requestUsageCell, usageThresholds } from '../../scenes/tableCells';
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
    .build();

  // "Containers" table merges by (cluster, namespace, pod, container) - same
  // as the Workload Drilldown's own (see workloadMemoryQueries.ts), which
  // means one level deeper this naturally becomes a per-container breakdown
  // of this single pod rather than collapsing to one row, unlike the CPU
  // table's own pod-only merge key. "timeline" already carries container/
  // image_spec (unlike the CPU table's own version, which needed swapping
  // for podContainerInfoQuery) - those two are now kept/shown instead of
  // excluded.
  const tableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(workloadMemoryPodsTableQueries) as WorkloadMemoryPodsTableQueryKey[]).map((key) => ({
      refId: key,
      expr: substitute(workloadMemoryPodsTableQueries[key]),
      format: 'table' as const,
      instant: true,
    })),
  });

  const tableData = new SceneDataTransformer({
    $data: tableRunner,
    transformations: [
      { id: 'merge', options: {} },
      // Combines REQUESTS with its own usage-as-%-of-requests value into one
      // value+percent+bar cell (requestUsageCell) instead of two separate
      // columns - same pattern as the Namespaces/Workloads list tables and
      // the Workload Overview tab's own Pods table.
      attachPercentField('Value #requests', 'Value #memAggPercent'),
      {
        id: 'organize',
        options: {
          excludeByName: {
            Time: true,
            cluster: true,
            namespace: true,
            workload: true,
            workload_type: true,
            pod: true,
            'Value #timeline': true,
            'Value #memAggPercent': true,
          },
          indexByName: {
            container: 0,
            image_spec: 1,
            'Value #requests': 2,
            'Value #memAgg': 3,
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
        .overrideDisplayName('CONTAINERS')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('image_spec')
        .overrideDisplayName('IMAGE_SPEC')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #requests')
        .overrideDisplayName('REQUESTS')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: requestUsageCell(),
        } as any)
        .matchFieldsWithName('Value #memAgg')
        .overrideDisplayName('USAGE (P95)')
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
