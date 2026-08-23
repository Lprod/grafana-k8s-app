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
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import {
  cronjobCpuDistributionQuery,
  cronjobCpuOverviewUsageQueries,
  cronjobCpuPodAlignmentQuery,
  cronjobCpuPodsTableQueries,
  cronjobCpuStatQueries,
  CronjobCpuOverviewUsageKey,
  CronjobCpuPodsTableQueryKey,
  CronjobCpuStatKey,
} from '../../queries/cronjobCpuQueries';
import { substituteJobResourceQuery } from '../../queries/jobOverviewQueries';
import { attachPercentField, coverageThresholds, requestUsageCell, usageThresholds } from '../../scenes/tableCells';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { POD_VARIABLE_NAME, THANOS_VARIABLE_NAME, createPodFilterVariable } from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';

// The Job Drilldown's own CPU tab - given queries are byte-for-byte
// identical to the CronJob Drilldown's own CPU tab (cronjobCpuQueries.ts,
// reused directly here rather than duplicated), the only real difference
// being the `pod=~""` empty-variable token: the CronJob Drilldown has no Pod
// picker at all (substituteCronjobResourceQuery maps it to ".+", matching
// everything namespace-wide), while this page - one level deeper, already
// scoped to a single known Job - has a genuine hidden Pod variable to
// resolve it to (see getJobOverviewScene's own "Job optimization" panels for
// the same reasoning, first established there).

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
// as every other CPU tab's own "Overview: usage" panel - redeclared locally
// for the same reason.
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

// Panel titles given verbatim (note the lowercase "usage/requests" on the
// third stat, same as the CronJob Drilldown's own CPU tab - not "fixed" to
// match the Namespace/Workload Drilldowns' own "Usage/Requests" casing).
const cpuStatPanelDefs: Array<{ key: CronjobCpuStatKey; title: string; unit: string; thresholds: typeof alertsThresholds }> = [
  { key: 'alertsFiring', title: 'Alerts: Firing (p95)', unit: 'short', thresholds: alertsThresholds },
  { key: 'schedulingRequestsSet', title: 'Scheduling: Containers with CPU requests set (p95)', unit: 'percentunit', thresholds: coverageThresholds },
  { key: 'alignmentUsageRequests', title: 'Alignment: usage/requests (p95)', unit: 'percentunit', thresholds: usageThresholds },
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

export function getJobCpuScene(cluster: string, namespace: string, job: string, clusterRegex: string, namespaceRegex: string) {
  // Hidden pod variable - same reasoning as the Overview tab's own (a Job
  // can have more than one pod - retries/parallelism), redeclared per-tab
  // since each tab is its own EmbeddedScene with no $variables inherited
  // from the Overview tab's scene (same pattern as the Workload Drilldown's
  // own per-tab hidden Pod variable).
  const podVariable = createPodFilterVariable(clusterRegex, namespaceRegex, { workload: job });
  podVariable.setState({ hide: VariableHide.hideVariable });
  const podToken = `\${${POD_VARIABLE_NAME}:regex}`;
  const substitute = (expr: string) => substituteJobResourceQuery(expr, clusterRegex, namespaceRegex, podToken);

  const statPanels = cpuStatPanelDefs.map((def) =>
    buildCpuStatPanel(def.title, substitute(cronjobCpuStatQueries[def.key]), def.unit, def.thresholds)
  );

  const overviewUsageLegends: Record<CronjobCpuOverviewUsageKey, string> = {
    limits: 'Sum of container CPU limits',
    requests: 'Sum of container CPU requests',
    usage: 'Sum of container CPU usage',
  };
  const overviewUsageRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(cronjobCpuOverviewUsageQueries) as CronjobCpuOverviewUsageKey[]).map((key) => ({
      refId: key,
      expr: substitute(cronjobCpuOverviewUsageQueries[key]),
      legendFormat: overviewUsageLegends[key],
    })),
  });
  const overviewUsagePanel = PanelBuilders.timeseries()
    .setTitle('Overview: usage (vCPU cores)')
    .setUnit('cores')
    .setData(overviewUsageRunner)
    .setOverrides(applyCpuUsageSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const distributionRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'distribution', expr: substitute(cronjobCpuDistributionQuery), legendFormat: '{{workload_type}}/{{pod}}' }],
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
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const podAlignmentRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'alignment', expr: substitute(cronjobCpuPodAlignmentQuery), legendFormat: '{{workload_type}}/{{pod}}' }],
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
    queries: (Object.keys(cronjobCpuPodsTableQueries) as CronjobCpuPodsTableQueryKey[]).map((key) => ({
      refId: key,
      expr: substitute(cronjobCpuPodsTableQueries[key]),
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
        .overrideDisplayName('REQUESTS (CORES)')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.Custom, cellComponent: requestUsageCell() } as any)
        .matchFieldsWithName('Value #agg')
        .overrideDisplayName('USAGE (P95)')
        .overrideUnit('cores')
        .overrideDecimals(2)
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
