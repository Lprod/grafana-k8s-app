import React from 'react';
import {
  EmbeddedScene,
  FieldConfigOverridesBuilder,
  SceneAppPage,
  SceneAppPageLike,
  SceneControlsSpacer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneDataTransformer,
  SceneQueryRunner,
  SceneReactObject,
  SceneRefreshPicker,
  SceneRouteMatch,
  SceneTimePicker,
  SceneTimeRange,
  SceneVariableSet,
  VariableValueControl,
  PanelBuilders,
} from '@grafana/scenes';
import { FieldColorModeId, GrafanaTheme2 } from '@grafana/data';
import { LegendDisplayMode, StackingMode, TableCellDisplayMode, VisibilityMode } from '@grafana/schema';
import { Badge, useTheme2 } from '@grafana/ui';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import {
  buildPodAlertsSeverityQuery,
  buildPodNodeQuery,
  buildPodRestartsQuery,
  buildPodStartTimeQuery,
  buildPodStatusQuery,
  podContainerInfoQuery,
} from '../../queries/podOverviewQueries';
import {
  buildPodEventsLevelQueries,
  buildPodEventsQuery,
  buildPodLogsLevelQueries,
  buildPodLogsQuery,
  namespaceEventTypeDefs,
  namespaceLogLevelDefs,
  NAMESPACE_LEVEL_OTHER,
  NAMESPACE_LEVEL_OTHER_COLOR,
} from '../../queries/namespaceOverviewQueries';
import {
  substituteWorkloadTokens,
  workloadCpuOptimizationQueries,
  workloadMemoryOptimizationQueries,
  WorkloadCpuOptimizationKey,
  WorkloadMemoryOptimizationKey,
} from '../../queries/workloadOverviewQueries';
import { workloadCpuPodsTableQueries } from '../../queries/workloadCpuQueries';
import { workloadMemoryPodsTableQueries } from '../../queries/workloadMemoryQueries';
import { InfoCard, NamespaceHealthBanner, findFieldAcrossFrames } from '../../scenes/clusterOverviewCards';
import { LogsEventsLevelToggle } from '../../scenes/logsEventsLevelToggle';
import { LogsTabLevelToggle, buildLogPanel } from '../../scenes/logPanels';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { attachPercentField, requestUsageCell } from '../../scenes/tableCells';
import {
  CLUSTER_VARIABLE_NAME,
  LOGS_DATASOURCE_VARIABLE_NAME,
  NAMESPACE_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createLogsDatasourceVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';
import { getPodCpuScene } from './podCpuScene';
import { getPodMemoryScene } from './podMemoryScene';
import { getPodNetworkScene } from './podNetworkScene';
import { getPodStorageScene } from './podStorageScene';

const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;
const CLUSTERS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Clusters}`;
const NAMESPACES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Namespaces}`;
const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

function SectionHeading({ title }: { title: string }) {
  const theme = useTheme2();
  return <h3 style={{ ...theme.typography.h3, margin: 0 }}>{title}</h3>;
}

function PodPageTitle({ title, cluster }: { title: string; cluster: string }) {
  const theme = useTheme2();
  const clusterUrl = `${CLUSTERS_URL}/${encodeURIComponent(cluster)}`;
  return (
    <div>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
        {title}
        <Badge text="pod" color="orange" />
      </h1>
      <div style={{ fontSize: theme.typography.body.fontSize, color: theme.colors.text.secondary, marginTop: 2 }}>
        in cluster{' '}
        {/* Real page load (not <a href>) - same "cluster" scene variable
            collision reasoning as WorkloadPageTitle in workloadsPage.tsx. */}
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

// Same phase color convention as podStatusCell (workloadsPage.tsx's own
// Pods table STATUS column) - Running/Succeeded is the "nothing to see
// here" green, Pending is a wait-and-see orange, Failed/Unknown are red -
// the two truly bad terminal-ish states a pod can land in.
function podStatusColor(phase: string | undefined, theme: GrafanaTheme2): string | undefined {
  switch (phase) {
    case 'Running':
    case 'Succeeded':
      return theme.visualization.getColorByName('green');
    case 'Pending':
      return theme.visualization.getColorByName('orange');
    case 'Failed':
    case 'Unknown':
      return theme.visualization.getColorByName('red');
    default:
      return undefined;
  }
}

// Same ">2 restarts" threshold the Kubernetes home page's "Restarting
// containers" issue panel already uses (kubernetesOverviewQueries.ts) - 0 is
// healthy green, 1-2 is a watch-it orange, 3+ is the same red the issue
// panel would flag.
function podRestartsColor(count: number | undefined, theme: GrafanaTheme2): string | undefined {
  if (count === undefined || count === null || Number.isNaN(count)) {
    return undefined;
  }
  if (count === 0) {
    return theme.visualization.getColorByName('green');
  }
  if (count <= 2) {
    return theme.visualization.getColorByName('orange');
  }
  return theme.visualization.getColorByName('red');
}

// Same allocation/limits/requests/usage series styling as
// applyWorkloadOptimizationSeriesOverrides (workloadsPage.tsx) - redeclared
// locally per this codebase's established "every page/tab file redeclares
// its own small style helpers" convention. No "capacity" branch, same as the
// Workload Drilldown's own optimization charts - neither a workload nor a
// single pod has a resourcequota-style hard ceiling the way a namespace does.
function applyPodOptimizationSeriesOverrides(b: FieldConfigOverridesBuilder<any>) {
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

// Same per-canonical-level/type color matching as workloadsPage.tsx's own
// applyLevelColorOverrides - redeclared locally for the same reason.
function applyLevelColorOverrides(b: FieldConfigOverridesBuilder<any>, defs: typeof namespaceLogLevelDefs) {
  for (const def of defs) {
    b = b.matchFieldsWithName(def.canonical).overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: def.color });
  }
  return b.matchFieldsWithName(NAMESPACE_LEVEL_OTHER).overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: NAMESPACE_LEVEL_OTHER_COLOR });
}

function getPodOverviewScene(
  cluster: string,
  namespace: string,
  pod: string,
  clusterRegex: string,
  namespaceRegex: string,
  workloadRegex: string,
  podRegex: string
) {
  const clusterUrl = `${CLUSTERS_URL}/${encodeURIComponent(cluster)}`;
  const namespaceUrl = `${NAMESPACES_URL}/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}`;
  const substitute = (expr: string) => substituteWorkloadTokens(expr, clusterRegex, namespaceRegex, workloadRegex, podRegex);

  const healthRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'alerts', expr: buildPodAlertsSeverityQuery(clusterRegex, namespaceRegex, pod), instant: true }],
  });
  const healthBanner = new NamespaceHealthBanner({
    $data: healthRunner,
    subject: 'Pod',
    alertsUrl: `${PLUGIN_BASE_URL}/${ROUTES.Alerts}?var-${CLUSTER_VARIABLE_NAME}=${encodeURIComponent(cluster)}&var-${NAMESPACE_VARIABLE_NAME}=${encodeURIComponent(namespace)}`,
  });

  // format: 'table' on every query below - without it, the Prometheus
  // datasource never disambiguates each query's own "Value" field to
  // "Value #<refId>" for InfoCard's fieldName lookups (confirmed via network
  // capture: a plain instant query stays a bare "Value" field forever, no
  // matter how many sibling queries share the runner) and label-derived
  // dimensions like "phase"/"node" never get split into their own scalar
  // columns for a plain findFieldAcrossFrames(frames, 'phase') lookup either
  // - they'd stay attached as the Value field's own .labels instead.
  const leftRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'status', expr: buildPodStatusQuery(clusterRegex, namespaceRegex, pod), instant: true, format: 'table' },
      { refId: 'startTime', expr: buildPodStartTimeQuery(clusterRegex, namespaceRegex, pod), instant: true, format: 'table' },
      { refId: 'restarts', expr: buildPodRestartsQuery(clusterRegex, namespaceRegex, pod), instant: true, format: 'table' },
    ],
  });

  const leftCard = new InfoCard({
    $data: leftRunner,
    rows: [
      {
        label: 'status:',
        render: (frames) => findFieldAcrossFrames(frames, 'phase')?.values[0] ?? '–',
        color: (frames, theme) => podStatusColor(findFieldAcrossFrames(frames, 'phase')?.values[0], theme),
      },
      // dateTimeAsIso -> "YYYY-MM-DD HH:mm:ss", browser-local time zone.
      { label: 'pod start time:', fieldName: 'Value #startTime', unit: 'dateTimeAsIso' },
      {
        label: 'number of restarts:',
        fieldName: 'Value #restarts',
        color: (frames, theme) => podRestartsColor(findFieldAcrossFrames(frames, 'Value #restarts')?.values[0], theme),
      },
    ],
  });

  const rightRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'node', expr: buildPodNodeQuery(clusterRegex, namespaceRegex, pod), instant: true, format: 'table' }],
  });

  const rightCard = new InfoCard({
    $data: rightRunner,
    rows: [
      { label: 'cluster:', render: () => cluster, href: clusterUrl },
      {
        label: 'node:',
        render: (frames) => findFieldAcrossFrames(frames, 'node')?.values[0] ?? '–',
      },
      { label: 'namespace:', render: () => namespace, href: namespaceUrl },
    ],
  });

  // "Pod optimization" - same allocation/limits/requests/usage CPU/Memory
  // timeseries as the Workload Drilldown's own "Workload optimization"
  // section (getWorkloadOverviewScene, workloadsPage.tsx), reusing its exact
  // queries (workloadCpuOptimizationQueries/workloadMemoryOptimizationQueries
  // - every one already carries its own `pod=~"$pod"` filter) since they're
  // already scoped down to whatever `$pod` resolves to; here that's this
  // page's own single literal pod instead of a live "every pod in the
  // workload" variable.
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
    .setTitle('Pod CPU')
    .setUnit('cores')
    .setData(cpuOptimizationRunner)
    .setOverrides(applyPodOptimizationSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    .setHeaderActions(new PanelTimeRangeCompare())
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
    .setTitle('Pod Memory')
    .setUnit('bytes')
    .setData(memoryOptimizationRunner)
    .setOverrides(applyPodOptimizationSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .build();

  // "Containers" table - the CPU tab's and Memory tab's own "Containers"
  // tables combined into one (CONTAINERS/IMAGE_SPEC identity + CPU/Memory
  // REQUESTS+USAGE side by side), same idea as the Workload Overview tab's
  // own "Pods" table combining that page's CPU/Memory tabs' columns. Reuses
  // podContainerInfoQuery for identity and the exact same CPU/Memory table
  // queries the CPU/Memory tabs themselves use for the numbers.
  const containersRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'timeline', expr: substitute(podContainerInfoQuery), format: 'table' as const, instant: true },
      { refId: 'cpuRequests', expr: substitute(workloadCpuPodsTableQueries.requests), format: 'table' as const, instant: true },
      { refId: 'cpuUsage', expr: substitute(workloadCpuPodsTableQueries.cpuAgg), format: 'table' as const, instant: true },
      { refId: 'cpuRequestsPercent', expr: substitute(workloadCpuPodsTableQueries.cpuAggPercent), format: 'table' as const, instant: true },
      { refId: 'memRequests', expr: substitute(workloadMemoryPodsTableQueries.requests), format: 'table' as const, instant: true },
      { refId: 'memUsage', expr: substitute(workloadMemoryPodsTableQueries.memAgg), format: 'table' as const, instant: true },
      { refId: 'memRequestsPercent', expr: substitute(workloadMemoryPodsTableQueries.memAggPercent), format: 'table' as const, instant: true },
    ],
  });

  const containersData = new SceneDataTransformer({
    $data: containersRunner,
    transformations: [
      { id: 'merge', options: {} },
      attachPercentField('Value #cpuRequests', 'Value #cpuRequestsPercent'),
      attachPercentField('Value #memRequests', 'Value #memRequestsPercent'),
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
            'Value #cpuRequestsPercent': true,
            'Value #memRequestsPercent': true,
          },
          indexByName: {
            container: 0,
            image_spec: 1,
            'Value #cpuRequests': 2,
            'Value #cpuUsage': 3,
            'Value #memRequests': 4,
            'Value #memUsage': 5,
          },
          renameByName: {},
        },
      },
    ],
  });

  const containersTable = PanelBuilders.table()
    .setTitle('Containers')
    .setData(containersData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('container')
        .overrideDisplayName('CONTAINERS')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('image_spec')
        .overrideDisplayName('IMAGE_SPEC')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #cpuRequests')
        .overrideDisplayName('CPU REQUESTS (CORES)')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: requestUsageCell(),
        } as any)
        .matchFieldsWithName('Value #cpuUsage')
        .overrideDisplayName('CPU USAGE (P95)')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #memRequests')
        .overrideDisplayName('MEMORY REQUESTS')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: requestUsageCell(),
        } as any)
        .matchFieldsWithName('Value #memUsage')
        .overrideDisplayName('MEMORY USAGE (P95)')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
    )
    .build();

  // "Logs / Events" - same per-canonical-level bar-chart mechanism as the
  // Workload Drilldown's own Overview tab, scoped via buildPodLogsLevelQueries/
  // buildPodEventsLevelQueries's exact-pod-name clause instead of a
  // workload-name wildcard. Queries start empty and are populated by
  // LogsEventsLevelToggle's effect (it needs the live time range to compute
  // the interval, which isn't known yet here at scene-construction time).
  const logsRunner = new SceneQueryRunner({ datasource: { uid: `\${${LOGS_DATASOURCE_VARIABLE_NAME}}` }, queries: [] });
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

  const eventsRunner = new SceneQueryRunner({ datasource: { uid: `\${${LOGS_DATASOURCE_VARIABLE_NAME}}` }, queries: [] });
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

  return new EmbeddedScene({
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Pod information" /> }),
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
          body: new SceneReactObject({ reactNode: <SectionHeading title="Pod optimization" /> }),
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
          body: new SceneReactObject({ reactNode: <SectionHeading title="Containers" /> }),
        }),
        new SceneFlexItem({ height: 400, body: containersTable }),
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
                buildLogsQueries={(onlyWarnError, interval) => buildPodLogsLevelQueries(cluster, namespace, pod, onlyWarnError, interval)}
                buildEventsQueries={(onlyWarnError, interval) => buildPodEventsLevelQueries(namespace, pod, onlyWarnError, interval)}
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

// Same shape as getWorkloadLogsScene/getWorkloadEventsScene
// (workloadsPage.tsx) - a single raw-log-line Log panel + "Only warn/error"
// toggle, just scoped to this one pod's exact name via buildPodLogsQuery/
// buildPodEventsQuery instead of a workload-name wildcard.
function getPodLogsScene(cluster: string, namespace: string, pod: string) {
  const logsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${LOGS_DATASOURCE_VARIABLE_NAME}}` },
    queries: [
      { refId: 'logs', query: buildPodLogsQuery(cluster, namespace, pod, false), metrics: [{ id: '1', type: 'logs' }], bucketAggs: [] },
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
            reactNode: <LogsTabLevelToggle runner={logsRunner} buildQuery={(onlyWarnError) => buildPodLogsQuery(cluster, namespace, pod, onlyWarnError)} />,
          }),
        }),
        new SceneFlexItem({ body: logsPanel }),
      ],
    }),
  });
}

function getPodEventsScene(namespace: string, pod: string) {
  const eventsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${LOGS_DATASOURCE_VARIABLE_NAME}}` },
    queries: [{ refId: 'logs', query: buildPodEventsQuery(namespace, pod, false), metrics: [{ id: '1', type: 'logs' }], bucketAggs: [] }] as any,
  });
  const eventsPanel = buildLogPanel('Events', eventsRunner);

  return new EmbeddedScene({
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({
            reactNode: <LogsTabLevelToggle runner={eventsRunner} buildQuery={(onlyWarnError) => buildPodEventsQuery(namespace, pod, onlyWarnError)} />,
          }),
        }),
        new SceneFlexItem({ body: eventsPanel }),
      ],
    }),
  });
}

interface PodTabDef {
  slug: string;
  title: string;
  getScene: () => EmbeddedScene;
}

export function getPodDetailPage(
  routeMatch: SceneRouteMatch<{ cluster: string; namespace: string; workloadType: string; workload: string; pod: string }>,
  parent: SceneAppPageLike
) {
  const cluster = decodeURIComponent(routeMatch.params.cluster);
  const namespace = decodeURIComponent(routeMatch.params.namespace);
  const workloadType = decodeURIComponent(routeMatch.params.workloadType);
  const workload = decodeURIComponent(routeMatch.params.workload);
  const pod = decodeURIComponent(routeMatch.params.pod);
  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clusterRegex = escapeRegex(cluster);
  const namespaceRegex = escapeRegex(namespace);
  const workloadRegex = escapeRegex(workload);
  const podRegex = escapeRegex(pod);
  const baseUrl = `${WORKLOADS_URL}/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}/${encodeURIComponent(workloadType)}/${encodeURIComponent(workload)}/pods/${encodeURIComponent(pod)}`;

  const tabDefs: PodTabDef[] = [
    {
      slug: 'overview',
      title: 'Overview',
      getScene: () => getPodOverviewScene(cluster, namespace, pod, clusterRegex, namespaceRegex, workloadRegex, podRegex),
    },
    { slug: 'cpu', title: 'CPU', getScene: () => getPodCpuScene(clusterRegex, namespaceRegex, workloadRegex, podRegex) },
    { slug: 'memory', title: 'Memory', getScene: () => getPodMemoryScene(clusterRegex, namespaceRegex, workloadRegex, podRegex) },
    { slug: 'network', title: 'Network', getScene: () => getPodNetworkScene(clusterRegex, namespaceRegex, workloadRegex, podRegex) },
    { slug: 'storage', title: 'Storage', getScene: () => getPodStorageScene(clusterRegex, namespaceRegex, workloadRegex, podRegex) },
    { slug: 'logs', title: 'Logs', getScene: () => getPodLogsScene(cluster, namespace, pod) },
    { slug: 'events', title: 'Events', getScene: () => getPodEventsScene(namespace, pod) },
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
    title: pod,
    titleImg: KUBERNETES_ICON,
    renderTitle: (title) => <PodPageTitle title={title} cluster={cluster} />,
    url: baseUrl,
    routePath: baseUrl,
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
