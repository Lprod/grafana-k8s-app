import {
  EmbeddedScene,
  PanelBuilders,
  SceneDataTransformer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneQueryRunner,
  SceneVariableSet,
  VariableValueControl,
} from '@grafana/scenes';
import { BigValueColorMode, BigValueGraphMode, LegendDisplayMode, StackingMode, TableCellDisplayMode, ThresholdsMode } from '@grafana/schema';
import { FieldColorModeId } from '@grafana/data';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { substituteClusterAndNamespace } from '../../queries/namespaceQueries';
import { namespaceWorkloadsTableQueries } from '../../queries/namespaceOverviewQueries';
import {
  namespaceMemoryDistributionQuery,
  namespaceMemoryOverviewUsageQueries,
  namespaceMemoryStatQueries,
  namespaceMemoryWorkloadAlignmentQuery,
  NamespaceMemoryStatKey,
} from '../../queries/namespaceMemoryQueries';
import { attachPercentField, coverageThresholds, requestUsageCell, usageThresholds, usageTierCell } from '../../scenes/tableCells';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { THANOS_VARIABLE_NAME, WORKLOAD_VARIABLE_NAME, createWorkloadFilterVariable } from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';

const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;

// Same green-baseline/red-if-any thresholds as namespaceCpuScene.tsx's own
// alertsThresholds - redeclared locally rather than imported, matching this
// codebase's established "every page/tab file redeclares its own small
// constants" convention (see KUBERNETES_ICON in alertsPage.ts).
const alertsThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'green', value: -Infinity },
    { color: 'red', value: 1 },
  ],
};

// Same series styling as namespaceCpuScene.tsx's own
// applyCpuUsageSeriesOverrides - redeclared locally for the same
// no-circular-import reason (this file is imported by namespacesPage.tsx).
function applyMemoryUsageSeriesOverrides(b: any) {
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

const memoryStatPanelDefs: Array<{ key: NamespaceMemoryStatKey; title: string; unit: string; thresholds: typeof alertsThresholds }> = [
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

export function getNamespaceMemoryScene(cluster: string, namespace: string, clusterRegex: string, namespaceRegex: string) {
  const workloadRegex = `\${${WORKLOAD_VARIABLE_NAME}:regex}`;
  const substitute = (expr: string) => substituteClusterAndNamespace(expr, clusterRegex, namespaceRegex).replaceAll('$workload', workloadRegex);

  const statPanels = memoryStatPanelDefs.map((def) =>
    buildMemoryStatPanel(def.title, substitute(namespaceMemoryStatQueries[def.key]), def.unit, def.thresholds)
  );

  const overviewUsageLegends: Record<keyof typeof namespaceMemoryOverviewUsageQueries, string> = {
    limits: 'Sum of container Memory limits',
    requests: 'Sum of container Memory requests',
    usage: 'Sum of container Memory usage',
  };

  const overviewUsageRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(namespaceMemoryOverviewUsageQueries) as Array<keyof typeof namespaceMemoryOverviewUsageQueries>).map((key) => ({
      refId: key,
      expr: substitute(namespaceMemoryOverviewUsageQueries[key]),
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
    queries: [{ refId: 'distribution', expr: substitute(namespaceMemoryDistributionQuery), legendFormat: '{{workload_type}}/{{workload}}' }],
  });

  const distributionPanel = PanelBuilders.timeseries()
    .setTitle('Distribution: Workload usage (bytes, stacked)')
    .setUnit('bytes')
    .setData(distributionRunner)
    .setCustomFieldConfig('stacking', { mode: StackingMode.Normal })
    .setCustomFieldConfig('lineWidth', 2)
    .setCustomFieldConfig('fillOpacity', 60)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const workloadAlignmentRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'alignment', expr: substitute(namespaceMemoryWorkloadAlignmentQuery), legendFormat: '{{workload_type}}/{{workload}}' }],
  });

  const workloadAlignmentPanel = PanelBuilders.timeseries()
    .setTitle('Alignment: Workload Usage/Requests (%)')
    .setUnit('percentunit')
    .setData(workloadAlignmentRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  // Same combined value+percent+bar cells as the Namespaces list page and
  // the Overview tab's own Workloads table (usageTierCell/requestUsageCell
  // via attachPercentField), including the same "Mem Usage colored by the
  // Limits ratio, not Requests" convention (limits are the hard OOM-kill
  // ceiling, requests are only a scheduler reservation - see
  // namespacesPage.tsx's own comment on this). The five queries are reused
  // verbatim from namespaceOverviewQueries.ts (byte-for-byte the same
  // PromQL the Overview tab's Workloads table already runs).
  const tableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'mem_usage',
        expr: substituteClusterAndNamespace(namespaceWorkloadsTableQueries.mem_usage, clusterRegex, namespaceRegex),
        format: 'table',
        instant: true,
      },
      {
        refId: 'mem_requests',
        expr: substituteClusterAndNamespace(namespaceWorkloadsTableQueries.mem_requests, clusterRegex, namespaceRegex),
        format: 'table',
        instant: true,
      },
      {
        refId: 'mem_requests_percent',
        expr: substituteClusterAndNamespace(namespaceWorkloadsTableQueries.mem_requests_percent, clusterRegex, namespaceRegex),
        format: 'table',
        instant: true,
      },
      {
        refId: 'mem_limits',
        expr: substituteClusterAndNamespace(namespaceWorkloadsTableQueries.mem_limits, clusterRegex, namespaceRegex),
        format: 'table',
        instant: true,
      },
      {
        refId: 'mem_limits_percent',
        expr: substituteClusterAndNamespace(namespaceWorkloadsTableQueries.mem_limits_percent, clusterRegex, namespaceRegex),
        format: 'table',
        instant: true,
      },
    ],
  });

  const tableData = new SceneDataTransformer({
    $data: tableRunner,
    transformations: [
      { id: 'merge', options: {} },
      // The Workloads table's own "workload" field isn't filterable via a
      // PromQL selector (workloadTableQueries doesn't take one) - row-filtered
      // client-side instead, same filterByValue pattern as the Workloads
      // page's own Workload filter (workloadsPage.tsx).
      {
        id: 'filterByValue',
        options: {
          filters: [{ fieldName: 'workload', config: { id: 'regex', options: { value: workloadRegex } } }],
          type: 'include',
          match: 'any',
        },
      },
      attachPercentField('Value #mem_requests', 'Value #mem_requests_percent'),
      attachPercentField('Value #mem_limits', 'Value #mem_limits_percent'),
      attachPercentField('Value #mem_usage', 'Value #mem_limits_percent'),
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, 'Value #mem_requests_percent': true, 'Value #mem_limits_percent': true },
          indexByName: {
            workload: 0,
            workload_type: 1,
            'Value #mem_usage': 2,
            'Value #mem_requests': 3,
            'Value #mem_limits': 4,
          },
          renameByName: {},
        },
      },
    ],
  });

  const table = PanelBuilders.table()
    .setTitle('Workloads')
    .setData(tableData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('workload')
        .overrideDisplayName('Workload')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          {
            title: 'View workload',
            url: `${WORKLOADS_URL}/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}/\${__data.fields.workload_type}/\${__value.text}\${__url.params}`,
          },
        ])
        .matchFieldsWithName('workload_type')
        .overrideDisplayName('Type')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #mem_usage')
        .overrideDisplayName('Mem Usage')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.Custom, cellComponent: usageTierCell() } as any)
        .matchFieldsWithName('Value #mem_requests')
        .overrideDisplayName('Mem Requests')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.Custom, cellComponent: requestUsageCell() } as any)
        .matchFieldsWithName('Value #mem_limits')
        .overrideDisplayName('Mem Limits')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.Custom, cellComponent: requestUsageCell() } as any)
    )
    .build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    $variables: new SceneVariableSet({ variables: [createWorkloadFilterVariable({ clusterRegex, namespaceRegex })] }),
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          width: 220,
          ySizing: 'content',
          body: new VariableValueControl({ variableName: WORKLOAD_VARIABLE_NAME }),
        }),
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
            new SceneFlexItem({ height: 300, body: workloadAlignmentPanel }),
          ],
        }),
        new SceneFlexItem({ height: 400, body: table }),
      ],
    }),
  });
}
