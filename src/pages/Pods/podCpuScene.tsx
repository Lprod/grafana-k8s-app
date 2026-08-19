import { EmbeddedScene, FieldConfigOverridesBuilder, PanelBuilders, SceneDataTransformer, SceneFlexItem, SceneFlexLayout, SceneQueryRunner } from '@grafana/scenes';
import { BigValueColorMode, BigValueGraphMode, LegendDisplayMode, StackingMode, TableCellDisplayMode, ThresholdsMode } from '@grafana/schema';
import { FieldColorModeId } from '@grafana/data';
import {
  workloadCpuDistributionQuery,
  workloadCpuOverviewUsageQueries,
  workloadCpuPodAlignmentQuery,
  workloadCpuPodsTableQueries,
  workloadCpuStatQueries,
  WorkloadCpuOverviewUsageKey,
  WorkloadCpuStatKey,
} from '../../queries/workloadCpuQueries';
import { substituteWorkloadTokens } from '../../queries/workloadOverviewQueries';
import { podContainerInfoQuery } from '../../queries/podOverviewQueries';
import { attachPercentField, requestUsageCell, usageThresholds } from '../../scenes/tableCells';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { THANOS_VARIABLE_NAME } from '../../variables/datasourceVariables';

// Reuses the Workload Drilldown's own CPU tab queries verbatim
// (workloadCpuQueries.ts) - every one of them already carries its own
// `pod=~"$pod"` filter (confirmed against the source before building this),
// so the only thing that changes one level deeper is what `$pod` resolves
// to: the Workload Drilldown needs a live *variable* (every pod belonging to
// the workload, since it doesn't know a single pod up front), this page
// already knows exactly one pod from its own route params, so `$pod` is
// substituted with that pod's own literal escaped name directly - no hidden
// variable needed at all, unlike getWorkloadCpuScene.

// Same green-baseline/red-if-any thresholds as the Workload/Namespace CPU
// tabs' own alertsThresholds - redeclared locally per this codebase's
// established "every tab file redeclares its own small constants" convention.
const alertsThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'green', value: -Infinity },
    { color: 'red', value: 1 },
  ],
};

function applyCpuUsageSeriesOverrides(b: FieldConfigOverridesBuilder<any>) {
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

const cpuStatPanelDefs: Array<{ key: WorkloadCpuStatKey; title: string; unit: string; thresholds: typeof alertsThresholds }> = [
  { key: 'alertsFiring', title: 'Alerts: Firing (p95)', unit: 'short', thresholds: alertsThresholds },
  { key: 'schedulingRequestsSet', title: 'Scheduling: Containers with CPU requests set (p95)', unit: 'percentunit', thresholds: usageThresholds },
  { key: 'alignmentUsageRequests', title: 'Alignment: Usage/Requests (p95)', unit: 'percentunit', thresholds: usageThresholds },
];

function buildCpuStatPanel(title: string, expr: string, unit: string, thresholds: typeof alertsThresholds) {
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

export function getPodCpuScene(clusterRegex: string, namespaceRegex: string, workloadRegex: string, podRegex: string) {
  const substitute = (expr: string) => substituteWorkloadTokens(expr, clusterRegex, namespaceRegex, workloadRegex, podRegex);

  const statPanels = cpuStatPanelDefs.map((def) =>
    buildCpuStatPanel(def.title, substitute(workloadCpuStatQueries[def.key]), def.unit, def.thresholds)
  );

  const overviewUsageLegends: Record<WorkloadCpuOverviewUsageKey, string> = {
    limits: 'Sum of container CPU limits',
    requests: 'Sum of container CPU requests',
    usage: 'Sum of container CPU usage',
  };
  const overviewUsageRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(workloadCpuOverviewUsageQueries) as WorkloadCpuOverviewUsageKey[]).map((key) => ({
      refId: key,
      expr: substitute(workloadCpuOverviewUsageQueries[key]),
      legendFormat: overviewUsageLegends[key],
    })),
  });
  const overviewUsagePanel = PanelBuilders.timeseries()
    .setTitle('Overview: Usage (vCPU cores)')
    .setUnit('cores')
    .setData(overviewUsageRunner)
    .setOverrides(applyCpuUsageSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const distributionRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'distribution', expr: substitute(workloadCpuDistributionQuery), legendFormat: '{{workload_type}}/{{pod}}' }],
  });
  const distributionPanel = PanelBuilders.timeseries()
    .setTitle('Distribution: Pod usage (cores, stacked)')
    .setUnit('cores')
    .setData(distributionRunner)
    .setCustomFieldConfig('stacking', { mode: StackingMode.Normal })
    .setCustomFieldConfig('lineWidth', 2)
    .setCustomFieldConfig('fillOpacity', 60)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  const podAlignmentRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'alignment', expr: substitute(workloadCpuPodAlignmentQuery), legendFormat: '{{workload_type}}/{{pod}}' }],
  });
  const podAlignmentPanel = PanelBuilders.timeseries()
    .setTitle('Alignment: Pod Usage/Requests (%)')
    .setUnit('percentunit')
    .setData(podAlignmentRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  // "Containers" table - one row per container in this pod. "timeline" is
  // swapped from workloadCpuPodsTableQueries' own version (which only ever
  // carried cluster/namespace/workload/workload_type/pod - no container
  // dimension at all, since the Workload Drilldown's own CPU table lists
  // pods, not containers) for podContainerInfoQuery, which additionally
  // carries container/image_spec - the CONTAINERS/IMAGE_SPEC columns below.
  // requests/cpuAgg/cpuAggPercent are otherwise unchanged from the Workload
  // Drilldown's own CPU table - they're already pod-level sums (no container
  // dimension of their own), so a pod with more than one container would
  // still only show that one summed value repeated per container row; every
  // container in this demo has exactly one anyway.
  const tableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'timeline', expr: substitute(podContainerInfoQuery), format: 'table' as const, instant: true },
      { refId: 'requests', expr: substitute(workloadCpuPodsTableQueries.requests), format: 'table' as const, instant: true },
      { refId: 'cpuAgg', expr: substitute(workloadCpuPodsTableQueries.cpuAgg), format: 'table' as const, instant: true },
      { refId: 'cpuAggPercent', expr: substitute(workloadCpuPodsTableQueries.cpuAggPercent), format: 'table' as const, instant: true },
    ],
  });

  const tableData = new SceneDataTransformer({
    $data: tableRunner,
    transformations: [
      { id: 'merge', options: {} },
      // Combines REQUESTS with its own usage-as-%-of-requests value into one
      // value+percent+bar cell (requestUsageCell) instead of two separate
      // columns - same pattern as the Namespaces/Workloads list tables and
      // the Workload Overview tab's own Pods table.
      attachPercentField('Value #requests', 'Value #cpuAggPercent'),
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
            join_key: true,
            'Value #timeline': true,
            'Value #cpuAggPercent': true,
          },
          indexByName: {
            container: 0,
            image_spec: 1,
            'Value #requests': 2,
            'Value #cpuAgg': 3,
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
        .overrideDisplayName('REQUESTS (CORES)')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: requestUsageCell(),
        } as any)
        .matchFieldsWithName('Value #cpuAgg')
        .overrideDisplayName('USAGE (P95)')
        .overrideUnit('cores')
        .overrideDecimals(2)
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
