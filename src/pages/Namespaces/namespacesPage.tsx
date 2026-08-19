import React from 'react';
import {
  EmbeddedScene,
  FieldConfigOverridesBuilder,
  PanelBuilders,
  SceneAppPage,
  SceneAppPageLike,
  SceneControlsSpacer,
  SceneDataTransformer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneQueryRunner,
  SceneReactObject,
  SceneRefreshPicker,
  SceneRouteMatch,
  SceneTimePicker,
  SceneTimeRange,
  SceneVariableSet,
  VariableValueControl,
} from '@grafana/scenes';
import { FieldColorModeId, VariableHide } from '@grafana/data';
import { LegendDisplayMode, StackingMode, TableCellDisplayMode, ThresholdsMode, VisibilityMode } from '@grafana/schema';
import { Badge, useTheme2 } from '@grafana/ui';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { buildNamespacesListTargets, namespaceTableQueries, substituteClusterAndNamespace } from '../../queries/namespaceQueries';
import {
  buildEgressIpQueryTarget,
  buildNamespaceAlertsSeverityQuery,
  buildNamespaceEventsLevelQueries,
  buildNamespaceEventsQuery,
  buildNamespaceLogsLevelQueries,
  buildNamespaceLogsQuery,
  namespaceCpuOptimizationQueries,
  namespaceEventTypeDefs,
  namespaceLogLevelDefs,
  namespaceMemoryOptimizationQueries,
  namespaceWorkloadsTableQueries,
  NAMESPACE_LEVEL_OTHER,
  NAMESPACE_LEVEL_OTHER_COLOR,
  NamespaceOptimizationQueryKey,
  NamespaceWorkloadsQueryKey,
} from '../../queries/namespaceOverviewQueries';
import { mixedDatasource } from '../../queries/datasources';
import { simulatorQuotaQuery } from '../../queries/resourceSimulator';
import {
  UsageIcon,
  attachDesiredPodsField,
  attachPercentField,
  readyDesiredPodsCell,
  requestUsageCell,
  usageColorFromTier,
  usageTierCell,
} from '../../scenes/tableCells';
import { InfoCard, NamespaceHealthBanner } from '../../scenes/clusterOverviewCards';
import { LogsEventsLevelToggle } from '../../scenes/logsEventsLevelToggle';
import { LogsTabLevelToggle, buildLogPanel } from '../../scenes/logPanels';
import { getNamespaceCpuScene } from './namespaceCpuScene';
import { getNamespaceMemoryScene } from './namespaceMemoryScene';
import { getNamespaceNetworkScene } from './namespaceNetworkScene';
import { getNamespaceStorageScene } from './namespaceStorageScene';
import { NamespaceQuotaCard } from '../../scenes/namespaceOverviewCards';
import { PanelLinkTitleItem } from '../../scenes/panelLinks';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import {
  CLUSTER_VARIABLE_NAME,
  LOGS_DATASOURCE_VARIABLE_NAME,
  NAMESPACE_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createClusterFilterVariable,
  createLogsDatasourceVariable,
  createNamespaceFilterVariable,
  createRqliteDatasourceVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';

const NAMESPACES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Namespaces}`;
const CLUSTERS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Clusters}`;
const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;
const RESOURCE_SIMULATOR_URL = `${PLUGIN_BASE_URL}/${ROUTES.ResourceSimulator}`;
const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

const alertsThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'green', value: -Infinity },
    { color: 'red', value: 1 },
  ],
};

function ResourceUsageLegend() {
  const theme = useTheme2();
  const items: Array<{ label: string; tier: 'low' | 'med' | 'high' }> = [
    { label: 'low', tier: 'low' },
    { label: 'med', tier: 'med' },
    { label: 'high', tier: 'high' },
  ];
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, alignItems: 'center', padding: '4px 0' }}>
      <span style={{ opacity: 0.7 }}>Resource usage:</span>
      {items.map((item) => (
        <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <UsageIcon tier={item.tier} />
          <span style={{ color: usageColorFromTier(theme, item.tier) }}>{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function getNamespacesListScene() {
  const clusterRegex = `\${${CLUSTER_VARIABLE_NAME}:regex}`;
  const namespaceRegex = `\${${NAMESPACE_VARIABLE_NAME}:regex}`;

  const queryRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: buildNamespacesListTargets(clusterRegex, namespaceRegex),
  });

  // "merge" (not "joinByField"): every query keeps its original `by
  // (cluster, namespace)` grouping (see namespaceQueries.ts), so merge
  // matches rows by both fields and only needs *some* query to carry
  // `cluster`/`namespace` for a given row - unlike joinByField-by-namespace,
  // it doesn't leave the whole Cluster column hostage to one specific query
  // (e.g. `info`) actually returning data.
  const transformedData = new SceneDataTransformer({
    $data: queryRunner,
    transformations: [
      { id: 'merge', options: {} },
      // Stashes each "X_percent" field onto its own value field (see
      // attachPercentField's own comment for why), so the raw percent
      // field/column can be fully dropped below instead of merely hidden -
      // requestUsageCell renders both together as one value+percent+bar cell.
      // CPU Usage is also stashed with the *requests* percent, and Mem Usage
      // with the *limits* percent (not requests) - usage vs. a hard limit is
      // the closer read of "about to hit the ceiling" (limits are enforced,
      // OOM-kill on memory; requests are only a scheduling reservation), so
      // that's the more meaningful ratio to color Mem Usage's fill-level icon
      // and text by (usageTierCell).
      attachPercentField('Value #cpu_requests', 'Value #cpu_requests_percent'),
      attachPercentField('Value #cpu_usage', 'Value #cpu_requests_percent'),
      attachPercentField('Value #mem_requests', 'Value #mem_requests_percent'),
      attachPercentField('Value #mem_limits', 'Value #mem_limits_percent'),
      attachPercentField('Value #mem_usage', 'Value #mem_limits_percent'),
      {
        id: 'organize',
        options: {
          excludeByName: {
            Time: true,
            'Value #cpu_requests_percent': true,
            'Value #mem_requests_percent': true,
            'Value #mem_limits_percent': true,
          },
          indexByName: {
            cluster: 0,
            namespace: 1,
            'Value #info': 2,
            'Value #alerts': 3,
            'Value #cpu_usage': 4,
            'Value #cpu_requests': 5,
            'Value #mem_usage': 6,
            'Value #mem_requests': 7,
            'Value #mem_limits': 8,
          },
          renameByName: {},
        },
      },
    ],
  });

  const table = PanelBuilders.table()
    .setTitle('Namespaces')
    .setData(transformedData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('cluster')
        .overrideDisplayName('Cluster')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([{ title: 'View cluster', url: `${CLUSTERS_URL}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('namespace')
        .overrideDisplayName('Namespace')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          { title: 'View namespace', url: `${NAMESPACES_URL}/\${__data.fields.cluster}/\${__value.text}\${__url.params}` },
        ])
        .matchFieldsWithName('Value #info')
        .overrideDisplayName('Workloads')
        .overrideUnit('none')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          {
            title: 'View workloads',
            url: `${PLUGIN_BASE_URL}/${ROUTES.Workloads}?var-${CLUSTER_VARIABLE_NAME}=\${__data.fields.cluster}&var-${NAMESPACE_VARIABLE_NAME}=\${__data.fields.namespace}`,
          },
        ])
        .matchFieldsWithName('Value #alerts')
        .overrideDisplayName('Alerts')
        .overrideUnit('none')
        .overrideThresholds(alertsThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .overrideLinks([
          {
            title: 'View alerts',
            url: `${PLUGIN_BASE_URL}/${ROUTES.Alerts}?var-${CLUSTER_VARIABLE_NAME}=\${__data.fields.cluster}&var-${NAMESPACE_VARIABLE_NAME}=\${__data.fields.namespace}`,
          },
        ])
        .matchFieldsWithName('Value #cpu_usage')
        .overrideDisplayName('CPU Usage')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: usageTierCell(),
        } as any)
        .matchFieldsWithName('Value #cpu_requests')
        .overrideDisplayName('CPU Requests')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: requestUsageCell(),
        } as any)
        .matchFieldsWithName('Value #mem_usage')
        .overrideDisplayName('Mem Usage')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: usageTierCell(),
        } as any)
        .matchFieldsWithName('Value #mem_requests')
        .overrideDisplayName('Mem Requests')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: requestUsageCell(),
        } as any)
        .matchFieldsWithName('Value #mem_limits')
        .overrideDisplayName('Mem Limits')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: requestUsageCell(),
        } as any)
    )
    .build();

  return new EmbeddedScene({
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ body: new SceneControlsSpacer() }),
            new SceneFlexItem({
              xSizing: 'content',
              ySizing: 'content',
              body: new SceneReactObject({ reactNode: <ResourceUsageLegend /> }),
            }),
          ],
        }),
        new SceneFlexItem({ body: table }),
      ],
    }),
  });
}

function SectionHeading({ title }: { title: string }) {
  const theme = useTheme2();
  return <h3 style={{ ...theme.typography.h3, margin: 0 }}>{title}</h3>;
}

function NamespacePageTitle({ title, cluster }: { title: string; cluster: string }) {
  const theme = useTheme2();
  const clusterUrl = `${CLUSTERS_URL}/${encodeURIComponent(cluster)}`;
  return (
    <div>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
        {title}
        <Badge text="namespace" color="purple" />
      </h1>
      <div style={{ fontSize: theme.typography.body.fontSize, color: theme.colors.text.secondary, marginTop: 2 }}>
        in cluster{' '}
        {/* Real page load (not <a href>) - see the same note above
            SectionHeading in clustersApp.tsx for why: this page's own
            "cluster" scene variable would otherwise collide with the
            destination's and silently rename itself in the URL. */}
        <button
          onClick={() => window.location.assign(clusterUrl)}
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: theme.colors.text.link, cursor: 'pointer' }}
        >
          {cluster}
        </button>
      </div>
    </div>
  );
}

// Shared series styling for the "Namespace optimization" CPU/Memory charts:
// Capacity (the resourcequota hard ceiling) is a solid red line; Limits a
// dashed red line; Requests a dashed orange line; Allocation (requests,
// falling back to usage where none are set) a finely-dashed green line;
// Usage a solid blue line. Matched by refId, mirroring
// applyOptimizationSeriesOverrides in clustersApp.tsx.
function applyNamespaceOptimizationSeriesOverrides(b: FieldConfigOverridesBuilder<any>) {
  return b
    .matchFieldsByQuery('capacity')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'red' })
    .matchFieldsByQuery('limits')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'red' })
    .overrideCustomFieldConfig('lineStyle', { fill: 'dash' })
    .matchFieldsByQuery('requests')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'orange' })
    .overrideCustomFieldConfig('lineStyle', { fill: 'dash' })
    .matchFieldsByQuery('allocation')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'green' })
    .overrideCustomFieldConfig('lineStyle', { fill: 'dash', dash: [2, 3] })
    .matchFieldsByQuery('usage')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'blue' });
}

function buildNamespaceOptimizationPanel(
  title: string,
  unit: string,
  queries: Record<NamespaceOptimizationQueryKey, string>,
  legends: Record<NamespaceOptimizationQueryKey, string>,
  clusterRegex: string,
  namespaceRegex: string
) {
  const runner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(queries) as NamespaceOptimizationQueryKey[]).map((key) => ({
      refId: key,
      expr: substituteClusterAndNamespace(queries[key], clusterRegex, namespaceRegex),
      legendFormat: legends[key],
    })),
  });

  return PanelBuilders.timeseries()
    .setTitle(title)
    .setUnit(unit)
    .setData(runner)
    .setOverrides(applyNamespaceOptimizationSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();
}

function getNamespaceOverviewScene(cluster: string, namespace: string, clusterRegex: string, namespaceRegex: string, baseUrl: string) {
  // EgressIP now comes straight from the RQLite CMDB, keyed by the plain k8s
  // namespace name alone - no more cluster-name datacenter-coordinate
  // parsing or an application/substage indirection (see buildEgressIpQuery's
  // own comment). Combined into the same info card as the "cluster"/
  // "workloads" rows via a Mixed-datasource query (Thanos + RQLite in one
  // $data), so this stays one card instead of splitting into two.
  const rqliteDatasourceVariable = createRqliteDatasourceVariable();
  rqliteDatasourceVariable.setState({ hide: VariableHide.hideVariable });

  const infoRunner = new SceneQueryRunner({
    datasource: mixedDatasource(),
    queries: [
      {
        refId: 'info',
        datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
        expr: substituteClusterAndNamespace(namespaceTableQueries.info, clusterRegex, namespaceRegex),
        format: 'table',
        instant: true,
      },
      buildEgressIpQueryTarget(namespace) as any,
    ],
  });

  const infoCard = new InfoCard({
    $data: infoRunner,
    rows: [
      { label: 'cluster:', fieldName: 'cluster', href: `${CLUSTERS_URL}/${encodeURIComponent(cluster)}` },
      {
        label: 'workloads:',
        // Prometheus only disambiguates to "Value #info" when it receives
        // more than one query in the SAME request. Now that "egressip" goes
        // to RQLite via a Mixed datasource, Thanos gets the "info" query
        // dispatched alone (Mixed fans each target out to its own
        // datasource's own sub-request) - so this is back to the bare
        // "Value" name, the same as before "egressip" existed on this card.
        fieldName: 'Value',
        href: `${PLUGIN_BASE_URL}/${ROUTES.Workloads}?var-${CLUSTER_VARIABLE_NAME}=${encodeURIComponent(cluster)}&var-${NAMESPACE_VARIABLE_NAME}=${encodeURIComponent(namespace)}`,
      },
      { label: 'egress ip:', fieldName: 'egressip' },
    ],
  });

  const simulatorUrl = `${RESOURCE_SIMULATOR_URL}?var-${CLUSTER_VARIABLE_NAME}=${encodeURIComponent(cluster)}&var-${NAMESPACE_VARIABLE_NAME}=${encodeURIComponent(namespace)}`;

  // Two separate runners (one per card): each SceneObject needs to own its
  // own $data in the scene graph, same reasoning as healthRunner/
  // alertsBadgeRunner below.
  const cpuQuotaRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'quota', expr: simulatorQuotaQuery({ cluster: clusterRegex, namespace: namespaceRegex }), format: 'time_series', instant: true, range: false },
    ],
    maxDataPoints: 1,
  });

  const cpuQuotaCard = new NamespaceQuotaCard({
    $data: cpuQuotaRunner,
    title: 'CPU requests quota',
    resource: 'requests.cpu',
    unit: 'cores',
    simulatorUrl,
  });

  const memQuotaRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'quota', expr: simulatorQuotaQuery({ cluster: clusterRegex, namespace: namespaceRegex }), format: 'time_series', instant: true, range: false },
    ],
    maxDataPoints: 1,
  });

  const memQuotaCard = new NamespaceQuotaCard({
    $data: memQuotaRunner,
    title: 'Memory requests quota',
    resource: 'requests.memory',
    unit: 'bytes',
    simulatorUrl,
  });

  // The alerts button now lives inside the health banner itself (its Alert
  // `action` slot) rather than as a separate badge elsewhere on the page,
  // so one query/runner covers both the banner's message and its button.
  const healthRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'alerts', expr: buildNamespaceAlertsSeverityQuery(clusterRegex, namespaceRegex), instant: true }],
  });

  const healthBanner = new NamespaceHealthBanner({
    $data: healthRunner,
    alertsUrl: `${PLUGIN_BASE_URL}/${ROUTES.Alerts}?var-${CLUSTER_VARIABLE_NAME}=${encodeURIComponent(cluster)}&var-${NAMESPACE_VARIABLE_NAME}=${encodeURIComponent(namespace)}`,
  });

  const cpuOptimizationPanel = buildNamespaceOptimizationPanel(
    'Namespace CPU',
    'cores',
    namespaceCpuOptimizationQueries,
    {
      allocation: 'Sum of container cpu allocation',
      requests: 'Sum of container cpu requests',
      limits: 'Sum of container cpu limits',
      usage: 'Sum of container cpu usage',
      capacity: 'Namespace Capacity',
    },
    clusterRegex,
    namespaceRegex
  );

  const memoryOptimizationPanel = buildNamespaceOptimizationPanel(
    'Namespace Memory',
    'bytes',
    namespaceMemoryOptimizationQueries,
    {
      allocation: 'Sum of container memory allocation',
      requests: 'Sum of container memory requests',
      limits: 'Sum of container memory limits',
      usage: 'Sum of container memory usage',
      capacity: 'Namespace Capacity',
    },
    clusterRegex,
    namespaceRegex
  );

  // Workload identity here is just (workload, workload_type) - every query
  // is already scoped to this page's single cluster+namespace (route
  // params), unlike the top-level Workloads page, which needs the fuller
  // (cluster, namespace, workload, workload_type) identity because it can
  // span several of each. "merge" still applies (see workloadQueries.ts) -
  // ready_pods/desired_pods additionally carry cluster/namespace/
  // asserts_env/asserts_site, but workload+workload_type alone is a common
  // field set across all 10 queries, which is all merge needs.
  const workloadsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(namespaceWorkloadsTableQueries) as NamespaceWorkloadsQueryKey[]).map((key) => ({
      refId: key,
      expr: substituteClusterAndNamespace(namespaceWorkloadsTableQueries[key], clusterRegex, namespaceRegex),
      format: 'table' as const,
      instant: true,
    })),
  });

  const workloadsData = new SceneDataTransformer({
    $data: workloadsRunner,
    transformations: [
      { id: 'merge', options: {} },
      // Same CPU-usage-by-requests / Mem-usage-by-limits coloring choice as
      // the Namespaces list page (getNamespacesListScene above) - see its
      // own comment for the "usage vs. hard limit" reasoning.
      attachPercentField('Value #cpu_requests', 'Value #cpu_requests_percent'),
      attachPercentField('Value #cpu_usage', 'Value #cpu_requests_percent'),
      attachPercentField('Value #mem_requests', 'Value #mem_requests_percent'),
      attachPercentField('Value #mem_limits', 'Value #mem_limits_percent'),
      attachPercentField('Value #mem_usage', 'Value #mem_limits_percent'),
      attachDesiredPodsField('Value #ready_pods', 'Value #desired_pods'),
      {
        id: 'organize',
        options: {
          excludeByName: {
            Time: true,
            cluster: true,
            namespace: true,
            asserts_env: true,
            asserts_site: true,
            'Value #desired_pods': true,
            'Value #cpu_requests_percent': true,
            'Value #mem_requests_percent': true,
            'Value #mem_limits_percent': true,
          },
          indexByName: {
            workload: 0,
            workload_type: 1,
            'Value #cpu_usage': 2,
            'Value #cpu_requests': 3,
            'Value #mem_usage': 4,
            'Value #mem_requests': 5,
            'Value #mem_limits': 6,
            'Value #ready_pods': 7,
          },
          renameByName: {},
        },
      },
    ],
  });

  const workloadsTable = PanelBuilders.table()
    .setTitle('Workloads')
    .setData(workloadsData)
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
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: usageTierCell(),
        } as any)
        .matchFieldsWithName('Value #cpu_requests')
        .overrideDisplayName('CPU Requests')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: requestUsageCell(),
        } as any)
        .matchFieldsWithName('Value #mem_usage')
        .overrideDisplayName('Mem Usage')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: usageTierCell(),
        } as any)
        .matchFieldsWithName('Value #mem_requests')
        .overrideDisplayName('Mem Requests')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: requestUsageCell(),
        } as any)
        .matchFieldsWithName('Value #mem_limits')
        .overrideDisplayName('Mem Limits')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: requestUsageCell(),
        } as any)
        .matchFieldsWithName('Value #ready_pods')
        .overrideDisplayName('Pods')
        .overrideUnit('none')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: readyDesiredPodsCell(),
        } as any)
    )
    .build();

  // Logs/Events bar charts: one Elasticsearch date_histogram-only query per
  // canonical level/type (see buildNamespaceLogsLevelQueries/
  // buildNamespaceEventsLevelQueries), each already merging every known
  // spelling/casing variant via its own Lucene OR-clause - so "ERROR" and
  // "Err" land in the same series/bucket instead of two. "joinByField" on
  // Time reshapes those per-level frames into the single wide table the Bar
  // Chart panel needs to stack them. Colors are now plain exact-name
  // matches since each query's alias already IS the canonical name.
  function applyLevelColorOverrides(b: FieldConfigOverridesBuilder<any>, defs: typeof namespaceLogLevelDefs) {
    for (const def of defs) {
      b = b.matchFieldsWithName(def.canonical).overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: def.color });
    }
    return b.matchFieldsWithName(NAMESPACE_LEVEL_OTHER).overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: NAMESPACE_LEVEL_OTHER_COLOR });
  }

  // Queries start empty and are populated by LogsEventsLevelToggle's effect
  // as soon as it mounts (it needs the live time range to compute the
  // interval, which isn't known yet here at scene-construction time).
  const logsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${LOGS_DATASOURCE_VARIABLE_NAME}}` },
    queries: [],
  });

  const logsData = new SceneDataTransformer({
    $data: logsRunner,
    transformations: [{ id: 'joinByField', options: { byField: 'Time' } }],
  });

  const logsPanel = PanelBuilders.barchart()
    .setTitle('Logs')
    .setData(logsData)
    .setOption('stacking', StackingMode.Normal)
    .setOption('xTickLabelRotation', -45)
    .setOption('showValue', VisibilityMode.Never)
    .setColor({ mode: FieldColorModeId.Fixed, fixedColor: NAMESPACE_LEVEL_OTHER_COLOR })
    .setOverrides((b) => applyLevelColorOverrides(b, namespaceLogLevelDefs))
    .build();
  logsPanel.setState({ titleItems: <PanelLinkTitleItem title="View Logs" url={`${baseUrl}/logs`} /> });

  const eventsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${LOGS_DATASOURCE_VARIABLE_NAME}}` },
    queries: [],
  });

  const eventsData = new SceneDataTransformer({
    $data: eventsRunner,
    transformations: [{ id: 'joinByField', options: { byField: 'Time' } }],
  });

  const eventsPanel = PanelBuilders.barchart()
    .setTitle('Events')
    .setData(eventsData)
    .setOption('stacking', StackingMode.Normal)
    .setOption('xTickLabelRotation', -45)
    .setOption('showValue', VisibilityMode.Never)
    .setColor({ mode: FieldColorModeId.Fixed, fixedColor: NAMESPACE_LEVEL_OTHER_COLOR })
    .setOverrides((b) => applyLevelColorOverrides(b, namespaceEventTypeDefs))
    .build();
  eventsPanel.setState({ titleItems: <PanelLinkTitleItem title="View Events" url={`${baseUrl}/events`} /> });

  return new EmbeddedScene({
    $variables: new SceneVariableSet({ variables: [rqliteDatasourceVariable] }),
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Namespace information" /> }),
        }),
        new SceneFlexItem({ ySizing: 'content', body: healthBanner }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ width: '50%', ySizing: 'content', minWidth: 0, body: infoCard }),
            // No ySizing here (defaults to 'fill'/alignSelf:stretch) - unlike
            // infoCard, these should stretch to match its content-driven
            // height rather than sit at their own (shorter) natural height,
            // which used to leave a visible gap below each quota card.
            new SceneFlexItem({ width: '25%', minWidth: 0, body: cpuQuotaCard }),
            new SceneFlexItem({ width: '25%', minWidth: 0, body: memQuotaCard }),
          ],
        }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Namespace optimization" /> }),
        }),
        new SceneFlexLayout({
          direction: 'row',
          children: [
            new SceneFlexItem({ height: 400, body: cpuOptimizationPanel }),
            new SceneFlexItem({ height: 400, body: memoryOptimizationPanel }),
          ],
        }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Workloads" /> }),
        }),
        new SceneFlexItem({ height: 400, body: workloadsTable }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Logs / Events" /> }),
        }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({
            reactNode: (
              <LogsEventsLevelToggle
                logsRunner={logsRunner}
                eventsRunner={eventsRunner}
                buildLogsQueries={(onlyWarnError, interval) => buildNamespaceLogsLevelQueries(cluster, namespace, onlyWarnError, interval)}
                buildEventsQueries={(onlyWarnError, interval) => buildNamespaceEventsLevelQueries(namespace, onlyWarnError, interval)}
              />
            ),
          }),
        }),
        new SceneFlexLayout({
          direction: 'row',
          children: [
            new SceneFlexItem({ height: 400, body: logsPanel }),
            new SceneFlexItem({ height: 400, body: eventsPanel }),
          ],
        }),
      ],
    }),
  });
}

function getNamespaceLogsScene(cluster: string, namespace: string) {
  const logsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${LOGS_DATASOURCE_VARIABLE_NAME}}` },
    queries: [
      { refId: 'logs', query: buildNamespaceLogsQuery(cluster, namespace, false), metrics: [{ id: '1', type: 'logs' }], bucketAggs: [] },
    ] as any,
  });
  const logsPanel = buildLogPanel('Logs', logsRunner);

  return new EmbeddedScene({
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({
            reactNode: <LogsTabLevelToggle runner={logsRunner} buildQuery={(onlyWarnError) => buildNamespaceLogsQuery(cluster, namespace, onlyWarnError)} />,
          }),
        }),
        new SceneFlexItem({ body: logsPanel }),
      ],
    }),
  });
}

function getNamespaceEventsScene(namespace: string) {
  const eventsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${LOGS_DATASOURCE_VARIABLE_NAME}}` },
    queries: [
      { refId: 'logs', query: buildNamespaceEventsQuery(namespace, false), metrics: [{ id: '1', type: 'logs' }], bucketAggs: [] },
    ] as any,
  });
  const eventsPanel = buildLogPanel('Events', eventsRunner);

  return new EmbeddedScene({
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({
            reactNode: <LogsTabLevelToggle runner={eventsRunner} buildQuery={(onlyWarnError) => buildNamespaceEventsQuery(namespace, onlyWarnError)} />,
          }),
        }),
        new SceneFlexItem({ body: eventsPanel }),
      ],
    }),
  });
}

interface NamespaceTabDef {
  slug: string;
  title: string;
  getScene: () => EmbeddedScene;
}

function getNamespaceDetailPage(routeMatch: SceneRouteMatch<{ cluster: string; namespace: string }>, parent: SceneAppPageLike) {
  const cluster = decodeURIComponent(routeMatch.params.cluster);
  const namespace = decodeURIComponent(routeMatch.params.namespace);
  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clusterRegex = escapeRegex(cluster);
  const namespaceRegex = escapeRegex(namespace);
  const baseUrl = `${NAMESPACES_URL}/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}`;

  const tabDefs: NamespaceTabDef[] = [
    { slug: 'overview', title: 'Overview', getScene: () => getNamespaceOverviewScene(cluster, namespace, clusterRegex, namespaceRegex, baseUrl) },
    { slug: 'cpu', title: 'CPU', getScene: () => getNamespaceCpuScene(cluster, namespace, clusterRegex, namespaceRegex) },
    { slug: 'memory', title: 'Memory', getScene: () => getNamespaceMemoryScene(cluster, namespace, clusterRegex, namespaceRegex) },
    { slug: 'network', title: 'Network', getScene: () => getNamespaceNetworkScene(clusterRegex, namespaceRegex) },
    { slug: 'storage', title: 'Storage', getScene: () => getNamespaceStorageScene(clusterRegex, namespaceRegex) },
    { slug: 'logs', title: 'Logs', getScene: () => getNamespaceLogsScene(cluster, namespace) },
    { slug: 'events', title: 'Events', getScene: () => getNamespaceEventsScene(namespace) },
  ];

  const tabs = tabDefs.map(
    (tab) =>
      new SceneAppPage({
        title: tab.title,
        url: `${baseUrl}/${tab.slug}`,
        routePath: tab.slug,
        getScene: tab.getScene,
      })
  );

  return new SceneAppPage({
    title: namespace,
    titleImg: KUBERNETES_ICON,
    renderTitle: (title) => <NamespacePageTitle title={title} cluster={cluster} />,
    url: baseUrl,
    routePath: `${NAMESPACES_URL}/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}`,
    getParentPage: () => parent,
    tabs,
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'browser' }),
    $variables: new SceneVariableSet({ variables: [createThanosDatasourceVariable(), createLogsDatasourceVariable()] }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new VariableValueControl({ variableName: LOGS_DATASOURCE_VARIABLE_NAME }),
      new SceneControlsSpacer(),
      new SceneTimePicker({}),
      new SceneRefreshPicker({ refresh: '1m' }),
    ],
    preserveUrlKeys: ['from', 'to', 'timezone', 'refresh', `var-${THANOS_VARIABLE_NAME}`, `var-${LOGS_DATASOURCE_VARIABLE_NAME}`],
  });
}

export function getNamespacesPage() {
  return new SceneAppPage({
    title: 'Namespaces',
    titleImg: KUBERNETES_ICON,
    url: NAMESPACES_URL,
    routePath: `/${ROUTES.Namespaces}/*`,
    getScene: getNamespacesListScene,
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'browser' }),
    $variables: new SceneVariableSet({
      variables: [createThanosDatasourceVariable(), createClusterFilterVariable(), createNamespaceFilterVariable()],
    }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new VariableValueControl({ variableName: CLUSTER_VARIABLE_NAME }),
      new VariableValueControl({ variableName: NAMESPACE_VARIABLE_NAME }),
      new SceneControlsSpacer(),
      new SceneTimePicker({}),
      new SceneRefreshPicker({ refresh: '1m' }),
    ],
    // Deliberately excludes the filter variables - see the same note in
    // the pre-existing stub this file replaces.
    preserveUrlKeys: ['from', 'to', 'timezone', 'refresh', `var-${THANOS_VARIABLE_NAME}`],
    drilldowns: [
      {
        routePath: `/:cluster/:namespace/*`,
        getPage: getNamespaceDetailPage,
      },
    ],
  });
}
