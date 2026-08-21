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
  namespaceCpuDistributionQuery,
  namespaceCpuOverviewUsageQueries,
  namespaceCpuStatQueries,
  namespaceCpuWorkloadAlignmentQuery,
  NamespaceCpuStatKey,
} from '../../queries/namespaceCpuQueries';
import { attachPercentField, coverageThresholds, requestUsageCell, usageThresholds, usageTierCell } from '../../scenes/tableCells';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { THANOS_VARIABLE_NAME, WORKLOAD_VARIABLE_NAME, createWorkloadFilterVariable } from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';

const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;

// Same green-baseline/red-if-any thresholds as namespacesPage.tsx's own
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

// Same series styling as namespacesPage.tsx's own
// applyNamespaceOptimizationSeriesOverrides (Overview tab's CPU/Memory
// optimization charts) - redeclared locally rather than imported, to avoid
// a namespacesPage.tsx <-> namespaceCpuScene.tsx circular import (this file
// is itself imported by namespacesPage.tsx to wire up the CPU tab).
function applyCpuUsageSeriesOverrides(b: any) {
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

const cpuStatPanelDefs: Array<{ key: NamespaceCpuStatKey; title: string; unit: string; thresholds: typeof alertsThresholds }> = [
  { key: 'alertsFiring', title: 'Alerts: Firing (p95)', unit: 'short', thresholds: alertsThresholds },
  { key: 'schedulingRequestsSet', title: 'Scheduling: Containers with CPU requests set (p95)', unit: 'percentunit', thresholds: coverageThresholds },
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

export function getNamespaceCpuScene(cluster: string, namespace: string, clusterRegex: string, namespaceRegex: string) {
  const workloadRegex = `\${${WORKLOAD_VARIABLE_NAME}:regex}`;
  const substitute = (expr: string) => substituteClusterAndNamespace(expr, clusterRegex, namespaceRegex).replaceAll('$workload', workloadRegex);

  const statPanels = cpuStatPanelDefs.map((def) =>
    buildCpuStatPanel(def.title, substitute(namespaceCpuStatQueries[def.key]), def.unit, def.thresholds)
  );

  const overviewUsageLegends: Record<keyof typeof namespaceCpuOverviewUsageQueries, string> = {
    limits: 'Sum of container CPU limits',
    requests: 'Sum of container CPU requests',
    usage: 'Sum of container CPU usage',
  };

  const overviewUsageRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(namespaceCpuOverviewUsageQueries) as Array<keyof typeof namespaceCpuOverviewUsageQueries>).map((key) => ({
      refId: key,
      expr: substitute(namespaceCpuOverviewUsageQueries[key]),
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
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const distributionRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'distribution', expr: substitute(namespaceCpuDistributionQuery), legendFormat: '{{workload_type}}/{{workload}}' }],
  });

  const distributionPanel = PanelBuilders.timeseries()
    .setTitle('Distribution: Workload usage (cores, stacked)')
    .setUnit('cores')
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
    queries: [{ refId: 'alignment', expr: substitute(namespaceCpuWorkloadAlignmentQuery), legendFormat: '{{workload_type}}/{{workload}}' }],
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
  // via attachPercentField) - CPU-only here, no Mem columns, since this is
  // the CPU tab specifically. The three queries are reused verbatim from
  // namespaceOverviewQueries.ts (byte-for-byte the same PromQL the Overview
  // tab's Workloads table already runs).
  const tableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'cpu_usage',
        expr: substituteClusterAndNamespace(namespaceWorkloadsTableQueries.cpu_usage, clusterRegex, namespaceRegex),
        format: 'table',
        instant: true,
      },
      {
        refId: 'cpu_requests',
        expr: substituteClusterAndNamespace(namespaceWorkloadsTableQueries.cpu_requests, clusterRegex, namespaceRegex),
        format: 'table',
        instant: true,
      },
      {
        refId: 'cpu_requests_percent',
        expr: substituteClusterAndNamespace(namespaceWorkloadsTableQueries.cpu_requests_percent, clusterRegex, namespaceRegex),
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
      attachPercentField('Value #cpu_requests', 'Value #cpu_requests_percent'),
      attachPercentField('Value #cpu_usage', 'Value #cpu_requests_percent'),
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, 'Value #cpu_requests_percent': true },
          indexByName: { workload: 0, workload_type: 1, 'Value #cpu_usage': 2, 'Value #cpu_requests': 3 },
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
        .matchFieldsWithName('Value #cpu_usage')
        .overrideDisplayName('CPU Usage')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.Custom, cellComponent: usageTierCell() } as any)
        .matchFieldsWithName('Value #cpu_requests')
        .overrideDisplayName('CPU Requests')
        .overrideUnit('cores')
        .overrideDecimals(2)
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
