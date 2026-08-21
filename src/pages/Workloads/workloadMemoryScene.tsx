import {
  EmbeddedScene,
  FieldConfigOverridesBuilder,
  PanelBuilders,
  SceneDataTransformer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneQueryRunner,
  SceneVariableSet,
} from '@grafana/scenes';
import { BigValueColorMode, BigValueGraphMode, LegendDisplayMode, StackingMode, TableCellDisplayMode, ThresholdsMode } from '@grafana/schema';
import { FieldColorModeId, VariableHide } from '@grafana/data';
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
import { attachPercentField, coverageThresholds, requestUsageCell, usageThresholds } from '../../scenes/tableCells';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { POD_VARIABLE_NAME, THANOS_VARIABLE_NAME, createPodFilterVariable } from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';

// Same green-baseline/red-if-any thresholds as the Overview/CPU tabs' own
// alertsThresholds - redeclared locally rather than imported, matching this
// codebase's established "every page/tab file redeclares its own small
// constants" convention (see namespaceMemoryScene.tsx's own copy).
const alertsThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'green', value: -Infinity },
    { color: 'red', value: 1 },
  ],
};

// Same series styling as namespaceMemoryScene.tsx's own
// applyMemoryUsageSeriesOverrides - redeclared locally for the same reason.
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
  { key: 'schedulingRequestsSet', title: 'Scheduling: Containers with Memory requests set (p95)', unit: 'percentunit', thresholds: coverageThresholds },
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

export function getWorkloadMemoryScene(
  clusterRegex: string,
  namespaceRegex: string,
  workloadRegex: string,
  workload: string,
  podBaseUrl: string
) {
  // Hidden pod variable - same reasoning as the Overview/CPU tabs' own (see
  // getWorkloadOverviewScene in workloadsPage.tsx): every $pod-referencing
  // query below needs to resolve to "every pod belonging to this workload",
  // but there's no picker to expose it through since each tab is its own
  // EmbeddedScene (no $variables inherited from a sibling tab's scene).
  const podVariable = createPodFilterVariable(clusterRegex, namespaceRegex, { workload });
  podVariable.setState({ hide: VariableHide.hideVariable });
  const podToken = `\${${POD_VARIABLE_NAME}:regex}`;
  const substitute = (expr: string) => substituteWorkloadTokens(expr, clusterRegex, namespaceRegex, workloadRegex, podToken);

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

  // "Pods" table - POD/TYPE/REQUESTS/USAGE (P95). Only "timeline" carries
  // workload/workload_type/image_spec - "merge" matches rows by the fields
  // common to every query instead, (cluster, namespace, pod, container) -
  // see workloadMemoryQueries.ts's own comment.
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
      // Combines REQUESTS with its own usage-as-%-of-requests value
      // (memAggPercent) into one value+percent+bar cell (requestUsageCell)
      // instead of a separate "USAGE/CAPACITY (P95, %)" column - same
      // convention as every other Requests column in this app (Namespaces/
      // Workloads list tables, Overview tab's own Pods table) - stashed via
      // attachPercentField so the raw percent field can be fully dropped
      // below instead of kept as its own column.
      attachPercentField('Value #requests', 'Value #memAggPercent'),
      {
        id: 'organize',
        options: {
          excludeByName: {
            Time: true,
            cluster: true,
            namespace: true,
            workload: true,
            container: true,
            image_spec: true,
            'Value #timeline': true,
            'Value #memAggPercent': true,
          },
          indexByName: {
            pod: 0,
            workload_type: 1,
            'Value #requests': 2,
            'Value #memAgg': 3,
          },
          renameByName: {},
        },
      },
    ],
  });

  const table = PanelBuilders.table()
    .setTitle('Pods')
    .setData(tableData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('pod')
        .overrideDisplayName('POD')
        .overrideCustomFieldConfig('align', 'left')
        // This table is already scoped to one cluster/namespace/workload
        // (route params), so the Pod Drilldown's own URL prefix is passed in
        // pre-built rather than read per-row - `cluster`/`namespace`/
        // `workload` are excluded from the frame above and aren't available
        // to a `${__data.fields.X}` macro here.
        .overrideLinks([{ title: 'View pod', url: `${podBaseUrl}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('workload_type')
        .overrideDisplayName('TYPE')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #requests')
        .overrideDisplayName('REQUESTS')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.Custom, cellComponent: requestUsageCell() } as any)
        .matchFieldsWithName('Value #memAgg')
        .overrideDisplayName('USAGE (P95)')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
    )
    .build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    $variables: new SceneVariableSet({ variables: [podVariable] }),
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
          ySizing: 'content',
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
