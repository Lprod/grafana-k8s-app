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
import { LegendDisplayMode, StackingMode, TableCellDisplayMode, VisibilityMode } from '@grafana/schema';
import { Badge, CustomCellRendererProps, useTheme2 } from '@grafana/ui';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { buildWorkloadsListTargets } from '../../queries/workloadQueries';
import {
  buildWorkloadAlertsSeverityQuery,
  buildWorkloadCreatedQuery,
  buildWorkloadReadyDesiredQueries,
  formatWorkloadTypeLabel,
  substituteWorkloadTokens,
  workloadCpuOptimizationQueries,
  workloadMemoryOptimizationQueries,
  workloadPodsTableQueries,
  WorkloadCpuOptimizationKey,
  WorkloadMemoryOptimizationKey,
} from '../../queries/workloadOverviewQueries';
import {
  buildEgressIpQueryTarget,
  buildWorkloadEventsLevelQueries,
  buildWorkloadEventsQuery,
  buildWorkloadLogsLevelQueries,
  buildWorkloadLogsQuery,
  namespaceEventTypeDefs,
  namespaceLogLevelDefs,
  NAMESPACE_LEVEL_OTHER,
  NAMESPACE_LEVEL_OTHER_COLOR,
} from '../../queries/namespaceOverviewQueries';
import { infraDatasource } from '../../queries/datasources';
import {
  UsageIcon,
  attachDesiredPodsField,
  attachFieldValues,
  attachPercentField,
  readyDesiredPodsCell,
  requestUsageCell,
  usageColorFromTier,
  usageThresholds,
  usageTierCell,
} from '../../scenes/tableCells';
import { InfoCard, NamespaceHealthBanner, findFieldAcrossFrames } from '../../scenes/clusterOverviewCards';
import { LogsEventsLevelToggle } from '../../scenes/logsEventsLevelToggle';
import { LogsTabLevelToggle, buildLogPanel } from '../../scenes/logPanels';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { getWorkloadCpuScene } from './workloadCpuScene';
import { getWorkloadMemoryScene } from './workloadMemoryScene';
import { getWorkloadNetworkScene } from './workloadNetworkScene';
import { getWorkloadStorageScene } from './workloadStorageScene';
import { getPodDetailPage } from '../Pods/podsPage';
import {
  CLUSTER_VARIABLE_NAME,
  LOGS_DATASOURCE_VARIABLE_NAME,
  NAMESPACE_VARIABLE_NAME,
  POD_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  WORKLOAD_VARIABLE_NAME,
  createClusterFilterVariable,
  createLogsDatasourceVariable,
  createNamespaceFilterVariable,
  createPodFilterVariable,
  createRqliteDatasourceVariable,
  createThanosDatasourceVariable,
  createWorkloadFilterVariable,
} from '../../variables/datasourceVariables';

const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;
const CLUSTERS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Clusters}`;
const NAMESPACES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Namespaces}`;
const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

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

function getWorkloadsListScene() {
  const clusterRegex = `\${${CLUSTER_VARIABLE_NAME}:regex}`;
  const namespaceRegex = `\${${NAMESPACE_VARIABLE_NAME}:regex}`;

  const queryRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: buildWorkloadsListTargets(clusterRegex, namespaceRegex),
  });

  // "merge" (not "joinByField"): a workload's identity is
  // (cluster, namespace, workload, workload_type), not a single field -
  // workload names routinely repeat across namespaces/clusters. "Merge
  // series/tables" matches rows by every field name common to all 10
  // queries instead of a single join key, so it handles that composite
  // identity natively - see workloadQueries.ts for why.
  const transformedData = new SceneDataTransformer({
    $data: queryRunner,
    transformations: [
      { id: 'merge', options: {} },
      // The "workload" field only exists after the queries' own label_replace
      // calls (see workloadQueries.ts), so it can't be filtered with a
      // PromQL selector like cluster/namespace are - this row-filters the
      // merged table instead. SceneDataTransformer interpolates scene
      // variables into a transformation's `options` (JSON.stringify -> scene
      // interpolate -> JSON.parse) the same way it does for query
      // expressions, so `${workload:regex}` resolves before this runs.
      {
        id: 'filterByValue',
        options: {
          filters: [
            {
              fieldName: 'workload',
              config: { id: 'regex', options: { value: `\${${WORKLOAD_VARIABLE_NAME}:regex}` } },
            },
          ],
          type: 'include',
          match: 'any',
        },
      },
      // Jobs/CronJobs/ConfigMaps are short-lived/completed-once or not even
      // pod-owning objects - their replica count (ready/desired) and
      // resource columns don't mean the same thing here as a long-running
      // Deployment/StatefulSet/DaemonSet's, and only cluttered this list.
      // Excluded the same way as the workload-name filter above, since
      // "workload_type" is another field synthesized by this query's own
      // label_replace calls (workloadQueries.ts), not a raw metric label a
      // PromQL selector could filter on directly.
      {
        id: 'filterByValue',
        options: {
          filters: [{ fieldName: 'workload_type', config: { id: 'regex', options: { value: '^(job|cronjob|configmap)$' } } }],
          type: 'exclude',
          match: 'any',
        },
      },
      // Stashes "Value #desired_pods" onto "Value #ready_pods" (see
      // attachDesiredPodsField's own comment for why), so the raw
      // "Value #desired_pods" field/column can be fully dropped below
      // instead of merely hidden.
      attachDesiredPodsField('Value #ready_pods', 'Value #desired_pods'),
      // Same combined value+percent+bar cell treatment as the Namespaces
      // page's table (see getNamespacesListScene in namespacesPage.tsx) -
      // CPU Usage colored by the CPU Requests ratio, Mem Usage by the Mem
      // *Limits* ratio (the hard OOM-kill ceiling, not just a scheduling
      // reservation), stashed via attachPercentField so the raw percent
      // fields can be fully dropped below instead of kept as separate
      // "... %" columns.
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
            asserts_env: true,
            asserts_site: true,
            'Value #desired_pods': true,
            'Value #cpu_requests_percent': true,
            'Value #mem_requests_percent': true,
            'Value #mem_limits_percent': true,
          },
          indexByName: {
            cluster: 0,
            namespace: 1,
            workload: 2,
            workload_type: 3,
            'Value #ready_pods': 4,
            'Value #cpu_usage': 5,
            'Value #cpu_requests': 6,
            'Value #mem_usage': 7,
            'Value #mem_requests': 8,
            'Value #mem_limits': 9,
          },
          renameByName: {},
        },
      },
    ],
  });

  const table = PanelBuilders.table()
    .setTitle('Workloads')
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
        .overrideLinks([{ title: 'View namespace', url: `${NAMESPACES_URL}/\${__data.fields.cluster}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('workload')
        .overrideDisplayName('Workload')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          {
            title: 'View workload',
            url: `${WORKLOADS_URL}/\${__data.fields.cluster}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__value.text}\${__url.params}`,
          },
        ])
        .matchFieldsWithName('workload_type')
        .overrideDisplayName('Type')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #ready_pods')
        .overrideDisplayName('Pods')
        .overrideUnit('none')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: readyDesiredPodsCell(),
        } as any)
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

function WorkloadPageTitle({ title, cluster, workloadType }: { title: string; cluster: string; workloadType: string }) {
  const theme = useTheme2();
  const clusterUrl = `${CLUSTERS_URL}/${encodeURIComponent(cluster)}`;
  return (
    <div>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
        {title}
        <Badge text={formatWorkloadTypeLabel(workloadType)} color="green" />
      </h1>
      <div style={{ fontSize: theme.typography.body.fontSize, color: theme.colors.text.secondary, marginTop: 2 }}>
        in cluster{' '}
        {/* Real page load (not <a href>) - same "cluster" scene variable
            collision reasoning as NamespacePageTitle in namespacesPage.tsx. */}
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

// Same allocation/limits/requests/usage series styling as
// applyNamespaceOptimizationSeriesOverrides (namespacesPage.tsx) - redeclared
// locally rather than imported, matching this codebase's established
// "every page/tab file redeclares its own small style helpers" convention
// (see namespaceCpuScene.tsx's own applyCpuUsageSeriesOverrides). No
// "capacity" branch here - a workload has no resourcequota-style hard
// ceiling the way a namespace does.
function applyWorkloadOptimizationSeriesOverrides(b: FieldConfigOverridesBuilder<any>) {
  return b
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

// Same per-canonical-level/type color matching as namespacesPage.tsx's own
// applyLevelColorOverrides - redeclared locally for the same reason as
// applyWorkloadOptimizationSeriesOverrides above.
function applyLevelColorOverrides(b: FieldConfigOverridesBuilder<any>, defs: typeof namespaceLogLevelDefs) {
  for (const def of defs) {
    b = b.matchFieldsWithName(def.canonical).overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: def.color });
  }
  return b.matchFieldsWithName(NAMESPACE_LEVEL_OTHER).overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: NAMESPACE_LEVEL_OTHER_COLOR });
}

const WAITING_REASON_KEY = 'waitingReason';

// Pods table's STATUS column: a waiting-container reason (e.g.
// ImagePullBackOff/CrashLoopBackOff), stashed onto the "phase" field via
// attachFieldValues, takes priority over the plain pod phase when present -
// more informative than a generic "Running"/"Pending" when something's
// actually wrong with one of the pod's containers.
function podStatusCell() {
  return function PodStatusCell({ rowIndex, field, value }: CustomCellRendererProps) {
    const theme = useTheme2();
    const reasonValues = field.config?.custom?.[WAITING_REASON_KEY] as Array<string | null | undefined> | undefined;
    const reason = reasonValues?.[rowIndex];
    const phase = typeof value === 'string' ? value : undefined;
    const text = reason || phase || '–';
    const color = reason
      ? theme.visualization.getColorByName('red')
      : phase === 'Running' || phase === 'Succeeded'
        ? theme.visualization.getColorByName('green')
        : phase === 'Pending'
          ? theme.visualization.getColorByName('orange')
          : theme.visualization.getColorByName('grey');

    return <span style={{ color }}>{text}</span>;
  };
}

function getWorkloadOverviewScene(
  cluster: string,
  namespace: string,
  workloadType: string,
  workload: string,
  clusterRegex: string,
  namespaceRegex: string,
  workloadRegex: string
) {
  // EgressIP now comes straight from the RQLite CMDB, keyed by the plain k8s
  // namespace name alone - identical to the Namespace Drilldown's own
  // Overview tab (see getNamespaceOverviewScene in namespacesPage.tsx and
  // buildEgressIpQuery's own comment).
  const rqliteDatasourceVariable = createRqliteDatasourceVariable();
  rqliteDatasourceVariable.setState({ hide: VariableHide.hideVariable });

  const clusterUrl = `${CLUSTERS_URL}/${encodeURIComponent(cluster)}`;
  const namespaceUrl = `${NAMESPACES_URL}/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}`;

  const leftRunner = new SceneQueryRunner({
    datasource: infraDatasource(),
    queries: [buildEgressIpQueryTarget(namespace) as any],
  });

  const leftCard = new InfoCard({
    $data: leftRunner,
    rows: [
      { label: 'cluster:', render: () => cluster, href: clusterUrl },
      { label: 'namespace:', render: () => namespace, href: namespaceUrl },
      { label: 'egress ip:', fieldName: 'egressip' },
    ],
  });

  const { ready, desired } = buildWorkloadReadyDesiredQueries(workloadType, clusterRegex, namespaceRegex, workload);

  // format: 'table' on every query below - without it, a plain instant
  // Prometheus query's "Value" field is never disambiguated to
  // "Value #<refId>", so InfoCard's fieldName-based lookups (findFieldAcrossFrames
  // below) silently return nothing even with multiple queries sharing one
  // runner - same gotcha as the Pod Overview tab's own info cards
  // (podsPage.tsx), latent here since this card was first built (see 1.10.0
  // CHANGELOG entry).
  const rightRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'ready', expr: ready, instant: true, format: 'table' },
      { refId: 'desired', expr: desired, instant: true, format: 'table' },
      { refId: 'created', expr: buildWorkloadCreatedQuery(workloadType, clusterRegex, namespaceRegex, workload), instant: true, format: 'table' },
    ],
  });

  const rightCard = new InfoCard({
    $data: rightRunner,
    rows: [
      {
        label: 'ready replicas:',
        render: (frames) => {
          const readyValue = findFieldAcrossFrames(frames, 'Value #ready')?.values[0];
          const desiredValue = findFieldAcrossFrames(frames, 'Value #desired')?.values[0];
          if (readyValue === undefined || readyValue === null || desiredValue === undefined || desiredValue === null) {
            return '–';
          }
          return `${readyValue} / ${desiredValue}`;
        },
      },
      { label: 'create date:', fieldName: 'Value #created', unit: 'dateTimeFromNow' },
      { label: 'workload type:', render: () => formatWorkloadTypeLabel(workloadType) },
    ],
  });

  // 'ready'/'desired' alongside 'alerts' - same refId-filtered multi-query
  // pattern as NodeHealthBanner's own conditions+alerts runner. Lets the
  // banner factor pod readiness into its severity (not all pods ready is a
  // warning, none ready is critical) on top of real alerts, without
  // reaching into a different scene object's own $data - reuses the exact
  // same ready/desired expressions the info card's rightRunner above
  // already built, just as a second runner instance (SceneQueryRunner
  // objects can't be shared as $data between two scene objects).
  const healthRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'alerts', expr: buildWorkloadAlertsSeverityQuery(clusterRegex, namespaceRegex, workload, workloadType), instant: true },
      { refId: 'ready', expr: ready, instant: true },
      { refId: 'desired', expr: desired, instant: true },
    ],
  });

  const healthBanner = new NamespaceHealthBanner({
    $data: healthRunner,
    subject: 'Workload',
    alertsUrl: `${PLUGIN_BASE_URL}/${ROUTES.Alerts}?var-${CLUSTER_VARIABLE_NAME}=${encodeURIComponent(cluster)}&var-${NAMESPACE_VARIABLE_NAME}=${encodeURIComponent(namespace)}`,
  });

  // Hidden pod variable - not a user-facing picker (there's nothing left to
  // narrow on this page, it's already scoped to one workload), just the
  // mechanism the $pod-referencing queries below need: most metrics/logs/
  // events don't carry a "workload" label of their own, so they filter by
  // pod instead - this resolves to every pod belonging to this workload
  // (see createPodFilterVariable's own comment for the underlying query).
  const podVariable = createPodFilterVariable(clusterRegex, namespaceRegex, { workload });
  podVariable.setState({ hide: VariableHide.hideVariable });
  const podToken = `\${${POD_VARIABLE_NAME}:regex}`;
  const substitute = (expr: string) => substituteWorkloadTokens(expr, clusterRegex, namespaceRegex, workloadRegex, podToken);

  const cpuLegends: Record<WorkloadCpuOptimizationKey, string> = {
    allocation: 'Sum of container CPU allocation',
    limits: 'Sum of container CPU limits',
    requests: 'Sum of container CPU requests',
    usage: 'Sum of container CPU usage',
  };
  const cpuOptimizationRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(workloadCpuOptimizationQueries) as WorkloadCpuOptimizationKey[]).map((key) => ({
      refId: key,
      expr: substitute(workloadCpuOptimizationQueries[key]),
      legendFormat: cpuLegends[key],
    })),
  });
  const cpuOptimizationPanel = PanelBuilders.timeseries()
    .setTitle('Workload CPU')
    .setUnit('cores')
    .setData(cpuOptimizationRunner)
    .setOverrides(applyWorkloadOptimizationSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const memoryLegends: Record<WorkloadMemoryOptimizationKey, string> = {
    allocation: 'Sum of container memory allocation',
    limits: 'Sum of container memory limits',
    requests: 'Sum of container memory requests',
    usage: 'Sum of container memory usage',
  };
  const memoryOptimizationRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(workloadMemoryOptimizationQueries) as WorkloadMemoryOptimizationKey[]).map((key) => ({
      refId: key,
      expr: substitute(workloadMemoryOptimizationQueries[key]),
      legendFormat: memoryLegends[key],
    })),
  });
  const memoryOptimizationPanel = PanelBuilders.timeseries()
    .setTitle('Workload Memory')
    .setUnit('bytes')
    .setData(memoryOptimizationRunner)
    .setOverrides(applyWorkloadOptimizationSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  // "Pods" table - one row per pod belonging to this workload. All 7
  // queries are format:'table'/instant, merged by their shared 'pod' field
  // (see workloadPodsTableQueries' own comment on why memRequests/memLimits'
  // per-container grouping isn't summed away, unlike their cpu siblings).
  const podsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(workloadPodsTableQueries) as Array<keyof typeof workloadPodsTableQueries>).map((key) => ({
      refId: key,
      expr: substitute(workloadPodsTableQueries[key]),
      format: 'table' as const,
      instant: true,
    })),
  });

  const podsData = new SceneDataTransformer({
    $data: podsRunner,
    transformations: [
      { id: 'merge', options: {} },
      // Stashes the waiting-container reason (if any) onto the "phase"
      // field so podStatusCell can show it instead - see its own comment.
      attachFieldValues('phase', 'reason', WAITING_REASON_KEY),
      // Requests %/Limits % have no dedicated percent queries of their own
      // (unlike the Namespaces/Workloads list tables' cpu_requests_percent
      // etc.), so computed client-side first...
      {
        id: 'calculateField',
        options: {
          mode: 'binary',
          binary: { left: 'Value #cpuUsage', operator: '/', right: 'Value #cpuRequests' },
          alias: 'cpu_requests_percent',
          replaceFields: false,
        },
      },
      {
        id: 'calculateField',
        options: {
          mode: 'binary',
          binary: { left: 'Value #memUsage', operator: '/', right: 'Value #memRequests' },
          alias: 'mem_requests_percent',
          replaceFields: false,
        },
      },
      {
        id: 'calculateField',
        options: {
          mode: 'binary',
          binary: { left: 'Value #memUsage', operator: '/', right: 'Value #memLimits' },
          alias: 'mem_limits_percent',
          replaceFields: false,
        },
      },
      // ...then, same as the Namespaces/Workloads list tables, the Requests
      // columns combine their value with the computed percent into one
      // value+percent+bar cell (requestUsageCell) instead of a separate "...
      // %" column - stashed via attachPercentField so the raw percent field
      // can be fully dropped below. Limits stays a plain colored-percent
      // column (not asked to combine).
      attachPercentField('Value #cpuRequests', 'cpu_requests_percent'),
      attachPercentField('Value #memRequests', 'mem_requests_percent'),
      {
        id: 'organize',
        options: {
          excludeByName: {
            Time: true,
            cluster: true,
            namespace: true,
            workload: true,
            workload_type: true,
            pod_ip: true,
            uid: true,
            asserts_env: true,
            asserts_site: true,
            container: true,
            join_key: true,
            reason: true,
            'Value #info': true,
            'Value #infoWaiting': true,
            cpu_requests_percent: true,
            mem_requests_percent: true,
          },
          indexByName: {
            pod: 0,
            node: 1,
            phase: 2,
            'Value #cpuUsage': 3,
            'Value #cpuRequests': 4,
            'Value #memUsage': 5,
            'Value #memRequests': 6,
            'Value #memLimits': 7,
            mem_limits_percent: 8,
          },
          renameByName: {},
        },
      },
    ],
  });

  const podsTable = PanelBuilders.table()
    .setTitle('Pods')
    .setData(podsData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('pod')
        .overrideDisplayName('POD')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          {
            title: 'View pod',
            url: `${WORKLOADS_URL}/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}/${encodeURIComponent(workloadType)}/${encodeURIComponent(workload)}/pods/\${__value.text}\${__url.params}`,
          },
        ])
        .matchFieldsWithName('node')
        .overrideDisplayName('NODE')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('phase')
        .overrideDisplayName('STATUS')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.Custom, cellComponent: podStatusCell() } as any)
        .matchFieldsWithName('Value #cpuUsage')
        .overrideDisplayName('CPU USAGE')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #cpuRequests')
        .overrideDisplayName('CPU REQUESTS')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.Custom, cellComponent: requestUsageCell() } as any)
        .matchFieldsWithName('Value #memUsage')
        .overrideDisplayName('MEMORY USAGE')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #memRequests')
        .overrideDisplayName('MEMORY REQUESTS')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.Custom, cellComponent: requestUsageCell() } as any)
        .matchFieldsWithName('Value #memLimits')
        .overrideDisplayName('MEMORY LIMITS')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('mem_limits_percent')
        .overrideDisplayName('MEMORY LIMITS %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
    )
    .build();

  // "Logs / Events" - same per-canonical-level bar-chart mechanism as the
  // Namespace Drilldown's own Overview tab (see getNamespaceOverviewScene),
  // just scoped down to this one workload via buildWorkloadLogsLevelQueries/
  // buildWorkloadEventsLevelQueries's extra orchestrator.resource.name
  // clause. Queries start empty and are populated by LogsEventsLevelToggle's
  // effect (it needs the live time range to compute the interval, which
  // isn't known yet here at scene-construction time).
  const logsRunner = new SceneQueryRunner({ datasource: { uid: `\${${LOGS_DATASOURCE_VARIABLE_NAME}}` }, queries: [] });
  const logsData = new SceneDataTransformer({ $data: logsRunner, transformations: [{ id: 'joinByField', options: { byField: 'Time' } }] });
  const logsPanel = PanelBuilders.barchart()
    .setTitle('Logs')
    .setData(logsData)
    .setOption('stacking', StackingMode.Normal)
    .setOption('xTickLabelRotation', -45)
    .setOption('showValue', VisibilityMode.Never)
    .setColor({ mode: FieldColorModeId.Fixed, fixedColor: NAMESPACE_LEVEL_OTHER_COLOR })
    .setOverrides((b) => applyLevelColorOverrides(b, namespaceLogLevelDefs))
    .build();

  const eventsRunner = new SceneQueryRunner({ datasource: { uid: `\${${LOGS_DATASOURCE_VARIABLE_NAME}}` }, queries: [] });
  const eventsData = new SceneDataTransformer({ $data: eventsRunner, transformations: [{ id: 'joinByField', options: { byField: 'Time' } }] });
  const eventsPanel = PanelBuilders.barchart()
    .setTitle('Events')
    .setData(eventsData)
    .setOption('stacking', StackingMode.Normal)
    .setOption('xTickLabelRotation', -45)
    .setOption('showValue', VisibilityMode.Never)
    .setColor({ mode: FieldColorModeId.Fixed, fixedColor: NAMESPACE_LEVEL_OTHER_COLOR })
    .setOverrides((b) => applyLevelColorOverrides(b, namespaceEventTypeDefs))
    .build();

  return new EmbeddedScene({
    $variables: new SceneVariableSet({ variables: [rqliteDatasourceVariable, podVariable] }),
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Workload information" /> }),
        }),
        new SceneFlexItem({ ySizing: 'content', body: healthBanner }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ width: '50%', ySizing: 'content', minWidth: 0, body: leftCard }),
            new SceneFlexItem({ width: '50%', ySizing: 'content', minWidth: 0, body: rightCard }),
          ],
        }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Workload optimization" /> }),
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
          body: new SceneReactObject({ reactNode: <SectionHeading title="Pods" /> }),
        }),
        new SceneFlexItem({ height: 400, body: podsTable }),
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
                buildLogsQueries={(onlyWarnError, interval) => buildWorkloadLogsLevelQueries(cluster, namespace, workload, onlyWarnError, interval)}
                buildEventsQueries={(onlyWarnError, interval) => buildWorkloadEventsLevelQueries(namespace, workload, onlyWarnError, interval)}
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

function getWorkloadLogsScene(cluster: string, namespace: string, workload: string) {
  const logsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${LOGS_DATASOURCE_VARIABLE_NAME}}` },
    queries: [
      { refId: 'logs', query: buildWorkloadLogsQuery(cluster, namespace, workload, false), metrics: [{ id: '1', type: 'logs' }], bucketAggs: [] },
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
            reactNode: (
              <LogsTabLevelToggle
                runner={logsRunner}
                buildQuery={(onlyWarnError) => buildWorkloadLogsQuery(cluster, namespace, workload, onlyWarnError)}
              />
            ),
          }),
        }),
        new SceneFlexItem({ body: logsPanel }),
      ],
    }),
  });
}

function getWorkloadEventsScene(namespace: string, workload: string) {
  const eventsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${LOGS_DATASOURCE_VARIABLE_NAME}}` },
    queries: [
      { refId: 'logs', query: buildWorkloadEventsQuery(namespace, workload, false), metrics: [{ id: '1', type: 'logs' }], bucketAggs: [] },
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
            reactNode: (
              <LogsTabLevelToggle runner={eventsRunner} buildQuery={(onlyWarnError) => buildWorkloadEventsQuery(namespace, workload, onlyWarnError)} />
            ),
          }),
        }),
        new SceneFlexItem({ body: eventsPanel }),
      ],
    }),
  });
}

interface WorkloadTabDef {
  slug: string;
  title: string;
  getScene: () => EmbeddedScene;
}

function getWorkloadDetailPage(
  routeMatch: SceneRouteMatch<{ cluster: string; namespace: string; workloadType: string; workload: string }>,
  parent: SceneAppPageLike
) {
  const cluster = decodeURIComponent(routeMatch.params.cluster);
  const namespace = decodeURIComponent(routeMatch.params.namespace);
  const workloadType = decodeURIComponent(routeMatch.params.workloadType);
  const workload = decodeURIComponent(routeMatch.params.workload);
  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clusterRegex = escapeRegex(cluster);
  const namespaceRegex = escapeRegex(namespace);
  const workloadRegex = escapeRegex(workload);
  const baseUrl = `${WORKLOADS_URL}/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}/${encodeURIComponent(workloadType)}/${encodeURIComponent(workload)}`;

  const tabDefs: WorkloadTabDef[] = [
    {
      slug: 'overview',
      title: 'Overview',
      getScene: () => getWorkloadOverviewScene(cluster, namespace, workloadType, workload, clusterRegex, namespaceRegex, workloadRegex),
    },
    { slug: 'cpu', title: 'CPU', getScene: () => getWorkloadCpuScene(clusterRegex, namespaceRegex, workloadRegex, workload) },
    { slug: 'memory', title: 'Memory', getScene: () => getWorkloadMemoryScene(clusterRegex, namespaceRegex, workloadRegex, workload) },
    { slug: 'network', title: 'Network', getScene: () => getWorkloadNetworkScene(clusterRegex, namespaceRegex, workloadRegex, workload) },
    { slug: 'storage', title: 'Storage', getScene: () => getWorkloadStorageScene(clusterRegex, namespaceRegex, workloadRegex, workload) },
    { slug: 'logs', title: 'Logs', getScene: () => getWorkloadLogsScene(cluster, namespace, workload) },
    { slug: 'events', title: 'Events', getScene: () => getWorkloadEventsScene(namespace, workload) },
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
    title: workload,
    titleImg: KUBERNETES_ICON,
    renderTitle: (title) => <WorkloadPageTitle title={title} cluster={cluster} workloadType={workloadType} />,
    url: baseUrl,
    routePath: `${WORKLOADS_URL}/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}/${encodeURIComponent(workloadType)}/${encodeURIComponent(workload)}`,
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
    // Pod Drilldown - nested one level deeper than this page's own tabs
    // (reached from the Pods table above), not a separate top-level nav
    // entry of its own. Tabs and drilldowns coexist fine on the same
    // SceneAppPage - both just add their own routes to this page's own
    // internal <Routes> (confirmed against @grafana/scenes' compiled
    // SceneAppPage.js: `if (tabs) {...}` and `if (drilldowns) {...}` are two
    // independent blocks feeding the same route list).
    drilldowns: [
      {
        routePath: `/pods/:pod/*`,
        getPage: getPodDetailPage,
      },
    ],
  });
}

export function getWorkloadsPage() {
  return new SceneAppPage({
    title: 'Workloads',
    titleImg: KUBERNETES_ICON,
    url: WORKLOADS_URL,
    routePath: `/${ROUTES.Workloads}/*`,
    getScene: getWorkloadsListScene,
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'browser' }),
    $variables: new SceneVariableSet({
      variables: [
        createThanosDatasourceVariable(),
        createClusterFilterVariable(),
        createNamespaceFilterVariable(),
        createWorkloadFilterVariable(),
      ],
    }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new VariableValueControl({ variableName: CLUSTER_VARIABLE_NAME }),
      new VariableValueControl({ variableName: NAMESPACE_VARIABLE_NAME }),
      new VariableValueControl({ variableName: WORKLOAD_VARIABLE_NAME }),
      new SceneControlsSpacer(),
      new SceneTimePicker({}),
      new SceneRefreshPicker({ refresh: '1m' }),
    ],
    // Deliberately excludes the filter variables - see the same note in
    // the pre-existing stub this file replaces.
    preserveUrlKeys: ['from', 'to', 'timezone', 'refresh', `var-${THANOS_VARIABLE_NAME}`],
    drilldowns: [
      {
        routePath: `/:cluster/:namespace/:workloadType/:workload/*`,
        getPage: getWorkloadDetailPage,
      },
    ],
  });
}
