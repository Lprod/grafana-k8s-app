import {
  EmbeddedScene,
  FieldConfigOverridesBuilder,
  PanelBuilders,
  SceneDataTransformer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneQueryRunner,
} from '@grafana/scenes';
import { BigValueColorMode, BigValueGraphMode, LegendDisplayMode, StackingMode, TableCellDisplayMode, ThresholdsMode } from '@grafana/schema';
import { FieldColorModeId } from '@grafana/data';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import {
  cronjobMemoryDistributionQuery,
  cronjobMemoryOverviewUsageQueries,
  cronjobMemoryPodAlignmentQuery,
  cronjobMemoryPodsTableQueries,
  cronjobMemoryStatQueries,
  CronjobMemoryOverviewUsageKey,
  CronjobMemoryPodsTableQueryKey,
  CronjobMemoryStatKey,
} from '../../queries/cronjobMemoryQueries';
import { substituteJobResourceQuery } from '../../queries/jobOverviewQueries';
import { attachPercentField, coverageThresholds, requestUsageCell, usageThresholds } from '../../scenes/tableCells';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { THANOS_VARIABLE_NAME } from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';

// The Job Drilldown's own Memory tab - same "given queries are byte-for-byte
// identical to the CronJob Drilldown's own tab, reused directly rather than
// duplicated" situation as jobCpuScene.tsx, just resolving the `pod=~""`
// empty-variable token to a literal `<job>.*` regex instead of the CronJob
// Drilldown's namespace-wide ".+" fallback. **Bug fixed here**: see
// jobCpuScene.tsx's own module-level comment - this used to go through a
// hidden Pod QueryVariable that resolved to nothing (and so `pod=~"()"`,
// matching zero series) for any standalone Job with no
// `namespace_workload_pod:kube_pod_owner:relabel` row.
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;

// Same green-baseline/red-if-any thresholds as every other tab's own
// alertsThresholds - redeclared locally per this codebase's established
// "every tab file redeclares its own small constants" convention.
const alertsThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'green', value: -Infinity },
    { color: 'red', value: 1 },
  ],
};

// Same limits(red dashed)/requests(orange dashed)/usage(blue solid) styling
// as every other Memory tab's own "Overview: usage" panel - redeclared
// locally for the same reason.
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

// Panel titles given verbatim (same lowercase "usage/requests" on the third
// stat as the CPU tab's own - not "fixed" to match the Namespace/Workload
// Drilldowns' own "Usage/Requests" casing, per this project's usual
// literal-translation convention).
const memoryStatPanelDefs: Array<{ key: CronjobMemoryStatKey; title: string; unit: string; thresholds: typeof alertsThresholds }> = [
  { key: 'alertsFiring', title: 'Alerts: Firing (p95)', unit: 'short', thresholds: alertsThresholds },
  { key: 'schedulingRequestsSet', title: 'Scheduling: Containers with Memory requests set (p95)', unit: 'percentunit', thresholds: coverageThresholds },
  { key: 'alignmentUsageRequests', title: 'Alignment: usage/requests (p95)', unit: 'percentunit', thresholds: usageThresholds },
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

export function getJobMemoryScene(cluster: string, namespace: string, job: string, clusterRegex: string, namespaceRegex: string) {
  // `<job>.*` - see jobCpuScene.tsx's own module-level comment for why this
  // replaced a hidden Pod QueryVariable lookup.
  const podToken = `${escapeRegex(job)}.*`;
  const substitute = (expr: string) => substituteJobResourceQuery(expr, clusterRegex, namespaceRegex, podToken);

  const statPanels = memoryStatPanelDefs.map((def) =>
    buildMemoryStatPanel(def.title, substitute(cronjobMemoryStatQueries[def.key]), def.unit, def.thresholds)
  );

  const overviewUsageLegends: Record<CronjobMemoryOverviewUsageKey, string> = {
    limits: 'Sum of container memory limits',
    requests: 'Sum of container memory requests',
    usage: 'Sum of container memory usage',
  };
  const overviewUsageRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(cronjobMemoryOverviewUsageQueries) as CronjobMemoryOverviewUsageKey[]).map((key) => ({
      refId: key,
      expr: substitute(cronjobMemoryOverviewUsageQueries[key]),
      legendFormat: overviewUsageLegends[key],
    })),
  });
  const overviewUsagePanel = PanelBuilders.timeseries()
    .setTitle('Overview: usage (memory bytes)')
    .setUnit('bytes')
    .setData(overviewUsageRunner)
    .setOverrides(applyMemoryUsageSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const distributionRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'distribution', expr: substitute(cronjobMemoryDistributionQuery), legendFormat: '{{workload_type}}/{{pod}}' }],
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
    queries: [{ refId: 'alignment', expr: substitute(cronjobMemoryPodAlignmentQuery), legendFormat: '{{workload_type}}/{{pod}}' }],
  });
  const podAlignmentPanel = PanelBuilders.timeseries()
    .setTitle('Alignment: Pod Usage/Requests (%)')
    .setUnit('percentunit')
    .setData(podAlignmentRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  // "Pods" table - scoped to this Job's own pod(s) via the hidden Pod
  // variable above (unlike the CronJob Drilldown's own namespace-wide
  // version). All 4 queries carry the same (cluster, namespace, workload,
  // workload_type, pod, join_key) label set, so `merge` aligns them without
  // ambiguity.
  const tableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(cronjobMemoryPodsTableQueries) as CronjobMemoryPodsTableQueryKey[]).map((key) => ({
      refId: key,
      expr: substitute(cronjobMemoryPodsTableQueries[key]),
      format: 'table' as const,
      instant: true,
    })),
  });

  const tableData = new SceneDataTransformer({
    $data: tableRunner,
    transformations: [
      { id: 'merge', options: {} },
      // Combines REQUESTS with its own usage-as-%-of-requests value
      // (aggPercent) into one value+percent+bar cell (requestUsageCell),
      // same convention as every other Requests column in this app.
      attachPercentField('Value #requests', 'Value #aggPercent'),
      {
        id: 'organize',
        options: {
          excludeByName: {
            Time: true,
            cluster: true,
            namespace: true,
            join_key: true,
            'Value #timeline': true,
            'Value #aggPercent': true,
          },
          indexByName: {
            pod: 0,
            workload: 1,
            workload_type: 2,
            'Value #requests': 3,
            'Value #agg': 4,
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
            url: `${WORKLOADS_URL}/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}/\${__data.fields.workload_type}/\${__data.fields.workload}/pods/\${__value.text}\${__url.params}`,
          },
        ])
        .matchFieldsWithName('workload')
        .overrideDisplayName('WORKLOAD')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          {
            title: 'View workload',
            url: `${WORKLOADS_URL}/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}/\${__data.fields.workload_type}/\${__value.text}\${__url.params}`,
          },
        ])
        .matchFieldsWithName('workload_type')
        .overrideDisplayName('TYPE')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #requests')
        .overrideDisplayName('REQUESTS (BYTES)')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.Custom, cellComponent: requestUsageCell() } as any)
        .matchFieldsWithName('Value #agg')
        .overrideDisplayName('USAGE (P95)')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
    )
    .build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
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
