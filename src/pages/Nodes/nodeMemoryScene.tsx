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
  NodeMemoryOverviewUsageKey,
  NodeMemoryStatKey,
  nodeMemoryDistributionQuery,
  nodeMemoryOverviewUsageQueries,
  nodeMemoryPodAlignmentQuery,
  nodeMemoryStatQueries,
} from '../../queries/nodeMemoryQueries';
import { nodePodsTableQueries } from '../../queries/nodeOverviewQueries';
import { substituteClusterNodeAndPodToken } from '../../queries/nodeQueries';
import { attachPercentField, requestUsageCell, usageThresholds, usageTierCell } from '../../scenes/tableCells';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { POD_VARIABLE_NAME, THANOS_VARIABLE_NAME, createNodePodFilterVariable } from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';

const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;

const memoryStatPanelDefs: Array<{ key: NodeMemoryStatKey; title: string }> = [
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

export function getNodeMemoryScene(cluster: string, clusterRegex: string, node: string, nodeRegex: string) {
  const podVariable = createNodePodFilterVariable(clusterRegex, node);
  const podToken = `\${${POD_VARIABLE_NAME}:regex}`;
  const substitute = (expr: string) => substituteClusterNodeAndPodToken(expr, clusterRegex, node, nodeRegex, podToken);

  const statPanels = memoryStatPanelDefs.map((def) => buildStatPanel(def.title, substitute(nodeMemoryStatQueries[def.key])));

  const overviewUsageLegends: Record<NodeMemoryOverviewUsageKey, string> = {
    capacity: 'Physical capacity of node',
    requests: 'Sum of container Memory requests',
    usage: 'Sum of container Memory usage',
  };
  const overviewUsageRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(nodeMemoryOverviewUsageQueries) as NodeMemoryOverviewUsageKey[]).map((key) => ({
      refId: key,
      expr: substitute(nodeMemoryOverviewUsageQueries[key]),
      legendFormat: overviewUsageLegends[key],
    })),
  });
  const overviewUsagePanel = PanelBuilders.timeseries()
    .setTitle('Overview: Usage (memory bytes)')
    .setUnit('bytes')
    .setData(overviewUsageRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const distributionRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'distribution', expr: substitute(nodeMemoryDistributionQuery), legendFormat: '{{namespace}}/{{pod}}' }],
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
    queries: [{ refId: 'alignment', expr: substitute(nodeMemoryPodAlignmentQuery), legendFormat: '{{namespace}}/{{pod}}' }],
  });
  const alignmentPanel = PanelBuilders.timeseries()
    .setTitle('Efficiency: Pod Usage/Requests (%)')
    .setUnit('percentunit')
    .setData(alignmentRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  // "Pods" table - given verbatim as info+mem_usage+mem_requests+
  // mem_requests_percent (no mem_limits column here, unlike the Overview
  // tab's own Pods table) - reused directly from nodeOverviewQueries.ts.
  const tableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (['info', 'mem_usage', 'mem_requests', 'mem_requests_percent'] as const).map((key) => ({
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
      attachPercentField('Value #mem_requests', 'Value #mem_requests_percent'),
      attachPercentField('Value #mem_usage', 'Value #mem_requests_percent'),
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
            'Value #mem_requests_percent': true,
          },
          indexByName: {
            pod: 0,
            workload: 1,
            workload_type: 2,
            namespace: 3,
            phase: 4,
            'Value #mem_usage': 5,
            'Value #mem_requests': 6,
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
