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
import { BigValueColorMode, BigValueGraphMode, LegendDisplayMode, StackingMode, TableCellDisplayMode } from '@grafana/schema';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import {
  NodeCpuOverviewUsageKey,
  NodeCpuStatKey,
  nodeCpuDistributionQuery,
  nodeCpuOverviewUsageQueries,
  nodeCpuPodAlignmentQuery,
  nodeCpuStatQueries,
} from '../../queries/nodeCpuQueries';
import { nodePodsTableQueries } from '../../queries/nodeOverviewQueries';
import { substituteClusterNodeAndPodToken } from '../../queries/nodeQueries';
import { attachPercentField, requestUsageCell, usageThresholds, usageTierCell } from '../../scenes/tableCells';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { POD_VARIABLE_NAME, THANOS_VARIABLE_NAME, createNodePodFilterVariable } from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';

const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;

const cpuStatPanelDefs: Array<{ key: NodeCpuStatKey; title: string }> = [
  { key: 'requestsCapacity', title: 'Efficiency: Requests/Capacity (p95)' },
  { key: 'usageCapacity', title: 'Efficiency: Usage/Capacity (p95)' },
  { key: 'usageRequests', title: 'Efficiency: Usage/Requests (p95)' },
];

function buildStatPanel(title: string, expr: string) {
  const runner = new SceneQueryRunner({ datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` }, queries: [{ refId: 'value', expr }] });
  return PanelBuilders.stat()
    .setTitle(title)
    .setUnit('percentunit')
    .setThresholds(usageThresholds)
    .setOption('colorMode', BigValueColorMode.Value)
    .setOption('graphMode', BigValueGraphMode.Area)
    .setData(runner)
    .build();
}

export function getNodeCpuScene(cluster: string, clusterRegex: string, node: string, nodeRegex: string) {
  // Visible Pod picker, scoped to this node's own pods (across every
  // namespace) - the dashboard's own volkovlabs-variable-panel widget on
  // this tab, translated to this codebase's usual VariableValueControl.
  const podVariable = createNodePodFilterVariable(clusterRegex, node);
  const podToken = `\${${POD_VARIABLE_NAME}:regex}`;
  const substitute = (expr: string) => substituteClusterNodeAndPodToken(expr, clusterRegex, node, nodeRegex, podToken);

  const statPanels = cpuStatPanelDefs.map((def) => buildStatPanel(def.title, substitute(nodeCpuStatQueries[def.key])));

  const overviewUsageLegends: Record<NodeCpuOverviewUsageKey, string> = {
    capacity: 'Physical capacity of node',
    requests: 'Sum of container CPU requests',
    usage: 'Sum of container CPU usage',
  };
  const overviewUsageRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(nodeCpuOverviewUsageQueries) as NodeCpuOverviewUsageKey[]).map((key) => ({
      refId: key,
      expr: substitute(nodeCpuOverviewUsageQueries[key]),
      legendFormat: overviewUsageLegends[key],
    })),
  });
  const overviewUsagePanel = PanelBuilders.timeseries()
    .setTitle('Overview: Usage (vCPU cores)')
    .setUnit('cores')
    .setData(overviewUsageRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const distributionRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'distribution', expr: substitute(nodeCpuDistributionQuery), legendFormat: '{{namespace}}/{{pod}}' }],
  });
  const distributionPanel = PanelBuilders.timeseries()
    .setTitle('Distribution: Pod Usage/Node Capacity (%, stacked)')
    .setUnit('percentunit')
    .setData(distributionRunner)
    .setCustomFieldConfig('stacking', { mode: StackingMode.Normal })
    .setCustomFieldConfig('lineWidth', 2)
    .setCustomFieldConfig('fillOpacity', 60)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const alignmentRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'alignment', expr: substitute(nodeCpuPodAlignmentQuery), legendFormat: '{{namespace}}/{{pod}}' }],
  });
  const alignmentPanel = PanelBuilders.timeseries()
    .setTitle('Efficiency: Pod Usage/Requests (%)')
    .setUnit('percentunit')
    .setData(alignmentRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  // "Pods" table - given verbatim as info+cpu_usage+cpu_requests+
  // cpu_requests_percent, the exact same 4 of the Overview tab's own
  // nodePodsTableQueries (reused directly rather than redeclared - same
  // "reuse a sibling drilldown's own query verbatim" convention as the Pod
  // Drilldown's own CPU/Memory tabs reusing the Workload Drilldown's).
  const tableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (['info', 'cpu_usage', 'cpu_requests', 'cpu_requests_percent'] as const).map((key) => ({
      refId: key,
      expr: substitute(nodePodsTableQueries[key]),
      format: 'table' as const,
      instant: true,
    })),
  });

  const tableData = new SceneDataTransformer({
    $data: tableRunner,
    transformations: [
      { id: 'merge', options: {} },
      attachPercentField('Value #cpu_requests', 'Value #cpu_requests_percent'),
      attachPercentField('Value #cpu_usage', 'Value #cpu_requests_percent'),
      {
        id: 'organize',
        options: {
          excludeByName: {
            Time: true,
            cluster: true,
            node: true,
            pod_ip: true,
            uid: true,
            asserts_env: true,
            asserts_site: true,
            'Value #info': true,
            'Value #cpu_requests_percent': true,
          },
          indexByName: {
            pod: 0,
            workload: 1,
            workload_type: 2,
            namespace: 3,
            phase: 4,
            'Value #cpu_usage': 5,
            'Value #cpu_requests': 6,
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
        .overrideLinks([
          {
            title: 'View pod',
            url: `${WORKLOADS_URL}/${encodeURIComponent(cluster)}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__data.fields.workload}/pods/\${__value.text}\${__url.params}`,
          },
        ])
        .matchFieldsWithName('workload')
        .overrideDisplayName('WORKLOAD')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          {
            title: 'View workload',
            url: `${WORKLOADS_URL}/${encodeURIComponent(cluster)}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__value.text}\${__url.params}`,
          },
        ])
        .matchFieldsWithName('workload_type')
        .overrideDisplayName('TYPE')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('namespace')
        .overrideDisplayName('NAMESPACE')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('phase')
        .overrideDisplayName('STATUS')
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
    $variables: new SceneVariableSet({ variables: [podVariable] }),
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          width: 220,
          ySizing: 'content',
          body: new VariableValueControl({ variableName: POD_VARIABLE_NAME }),
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
            new SceneFlexItem({ height: 400, body: overviewUsagePanel }),
            new SceneFlexItem({ height: 400, body: distributionPanel }),
            new SceneFlexItem({ height: 400, body: alignmentPanel }),
          ],
        }),
        new SceneFlexItem({ height: 400, body: table }),
      ],
    }),
  });
}
