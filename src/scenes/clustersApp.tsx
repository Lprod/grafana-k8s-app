import React from 'react';
import {
  EmbeddedScene,
  FieldConfigOverridesBuilder,
  PanelBuilders,
  SceneApp,
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
import { FieldColorModeId } from '@grafana/data';
import {
  BigValueColorMode,
  BigValueGraphMode,
  GraphThresholdsStyleMode,
  LegendDisplayMode,
  StackingMode,
  TableCellDisplayMode,
  ThresholdsMode,
} from '@grafana/schema';
import { Badge, Button, useTheme2 } from '@grafana/ui';
import { PLUGIN_BASE_URL, ROUTES } from '../constants';
import { clusterTableQueries } from '../queries/clusterQueries';
import {
  buildClusterHealthQuery,
  buildNodeTableTargets,
  clusterCapacityQueries,
  ClusterCapacityQueryKey,
  clusterCpuOptimizationQueries,
  clusterMemoryOptimizationQueries,
  substituteCluster,
} from '../queries/clusterOverviewQueries';
import { buildClusterTableTargets, withClusterFilter } from './queryHelpers';
import { ClusterAlertsBadge, ClusterHealthBanner, InfoCard } from './clusterOverviewCards';
import {
  CLUSTER_VARIABLE_NAME,
  createNodesFilterVariable,
  NAMESPACE_VARIABLE_NAME,
  NODES_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createClusterFilterVariable,
  createNamespaceFilterVariable,
  createThanosDatasourceVariable,
} from '../variables/datasourceVariables';
import { getResourceSimulatorPage } from '../pages/ResourceSimulator/resourceSimulatorPage';
import { getNamespacesPage } from '../pages/Namespaces/namespacesPage';
import { getWorkloadsPage } from '../pages/Workloads/workloadsPage';
import { getNodesPage } from '../pages/Nodes/nodesPage';
import { getAlertsPage } from '../pages/Alerts/alertsPage';
import { getJobsPage } from '../pages/Jobs/jobsPage';
import { getKubernetesHomePage } from '../pages/Kubernetes/kubernetesPage';
import { UsageIcon, linkedValueCell, usageColorFromTier, usageThresholds } from './tableCells';
import { PanelTimeRangeCompare } from './panelTimeRangeCompare';
import { attachExploreMenus } from './panelExplore';
import { SectionHeading } from './sectionHeading';
import { InvestigateEntityButton } from './investigateEntityButton';

const CLUSTERS_URL = `${PLUGIN_BASE_URL}/clusters`;
const NAMESPACES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Namespaces}`;
const NODES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Nodes}`;
const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

const pvcCapacityThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'green', value: -Infinity },
    { color: 'orange', value: 0.75 },
    { color: 'red', value: 0.95 },
  ],
};

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

function getClustersListScene() {
  const clusterRegex = `\${${CLUSTER_VARIABLE_NAME}:regex}`;

  const queryRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: buildClusterTableTargets(clusterRegex),
  });

  const transformedData = new SceneDataTransformer({
    $data: queryRunner,
    transformations: [
      { id: 'joinByField', options: { byField: 'cluster', mode: 'outer' } },
      // At least one of these queries' many OTel/fallback branches
      // (cpu_usage_avg etc. - see clusterQueries.ts) can return a real
      // number for a series that's missing a "cluster" label entirely in
      // this org's actual Prometheus data (e.g. a raw node-exporter target
      // that never got cluster-relabeled) - `joinByField` still emits a row
      // for it (empty-string join key), showing up as an all-blank phantom
      // row at the bottom of the table with real-looking CPU/Mem numbers
      // but no cluster name, no Nodes/Alerts count. Filtered out here
      // rather than chasing which specific fallback branch in these
      // already-large multi-source queries is responsible.
      {
        id: 'filterByValue',
        options: {
          filters: [{ fieldName: 'cluster', config: { id: 'regex', options: { value: '^$' } } }],
          type: 'exclude',
          match: 'any',
        },
      },
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, asserts_env: true, asserts_site: true, provider: true },
          indexByName: {
            cluster: 0,
            'Value #info': 1,
            'Value #alerts': 2,
            'Value #cpu_usage_avg': 3,
            'Value #cpu_usage_avg_percent': 4,
            'Value #cpu_usage_max': 5,
            'Value #cpu_usage_max_percent': 6,
            'Value #mem_usage_avg': 7,
            'Value #mem_usage_avg_percent': 8,
            'Value #mem_usage_max': 9,
            'Value #mem_usage_max_percent': 10,
          },
          renameByName: {},
        },
      },
    ],
  });

  const table = PanelBuilders.table()
    .setTitle('Clusters')
    .setData(transformedData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('cluster')
        .overrideDisplayName('Cluster')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([{ title: 'View cluster', url: `${CLUSTERS_URL}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('Value #info')
        .overrideDisplayName('Nodes')
        .overrideUnit('none')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          { title: 'View nodes', url: `${PLUGIN_BASE_URL}/${ROUTES.Nodes}?var-${CLUSTER_VARIABLE_NAME}=\${__data.fields.cluster}` },
        ])
        .matchFieldsWithName('Value #alerts')
        .overrideDisplayName('Alerts')
        .overrideUnit('none')
        .overrideThresholds(alertsThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .overrideLinks([
          { title: 'View alerts', url: `${PLUGIN_BASE_URL}/${ROUTES.Alerts}?var-${CLUSTER_VARIABLE_NAME}=\${__data.fields.cluster}` },
        ])
        .matchFieldsWithName('Value #cpu_usage_avg')
        .overrideDisplayName('CPU Avg')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #cpu_usage_avg_percent'),
        } as any)
        .matchFieldsWithName('Value #cpu_usage_avg_percent')
        .overrideDisplayName('CPU Avg %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #cpu_usage_max')
        .overrideDisplayName('CPU Max')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #cpu_usage_max_percent'),
        } as any)
        .matchFieldsWithName('Value #cpu_usage_max_percent')
        .overrideDisplayName('CPU Max %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #mem_usage_avg')
        .overrideDisplayName('Mem Avg')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #mem_usage_avg_percent'),
        } as any)
        .matchFieldsWithName('Value #mem_usage_avg_percent')
        .overrideDisplayName('Mem Avg %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #mem_usage_max')
        .overrideDisplayName('Mem Max')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #mem_usage_max_percent'),
        } as any)
        .matchFieldsWithName('Value #mem_usage_max_percent')
        .overrideDisplayName('Mem Max %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
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
          children: [
            new SceneFlexItem({
              width: 220,
              ySizing: 'content',
              body: new VariableValueControl({ variableName: CLUSTER_VARIABLE_NAME }),
            }),
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

function ClusterPageTitle({ title }: { title: string }) {
  return (
    <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
      {title}
      <Badge text="cluster" color="blue" />
      <InvestigateEntityButton kind="cluster" name={title} cluster={title} />
    </h1>
  );
}

// The Namespaces/Workloads pages declare their own "cluster" scene variable.
// Grafana's app shell intercepts clicks on internal <a href> links (even
// LinkButton's) and client-side-navigates instead of doing a real page load,
// which keeps this page's "cluster" variable mounted; the destination page's
// own "cluster" variable then collides with it and silently gets renamed
// ("var-cluster-2") in the URL, so the value we pass never reaches it. Using
// a plain Button (no href, so nothing intercepts it) and navigating via
// window.location forces a real page load, so the destination mounts fresh
// and "var-cluster" binds to its own variable. (Several other pages' own
// title components cite this note by name - keep it here if it moves.)
function ClusterOverviewLinks({ cluster }: { cluster: string }) {
  const namespacesUrl = `${PLUGIN_BASE_URL}/${ROUTES.Namespaces}?var-${CLUSTER_VARIABLE_NAME}=${encodeURIComponent(cluster)}`;
  const workloadsUrl = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}?var-${CLUSTER_VARIABLE_NAME}=${encodeURIComponent(cluster)}`;
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 8 }}>
      <Button onClick={() => window.location.assign(namespacesUrl)} variant="secondary" size="md">
        See Namespaces
      </Button>
      <Button onClick={() => window.location.assign(workloadsUrl)} variant="secondary" size="md">
        See Workloads
      </Button>
    </div>
  );
}

// Shared series styling for the "Cluster optimization" CPU/Memory charts:
// Capacity is the physical line (light purple, filled); Limits/Requests are
// dashed red/orange; Usage is a solid blue line. Matched by refId (stable
// across panels) rather than display name, since CPU/Memory use different
// legend labels for the same four queries.
function applyOptimizationSeriesOverrides(b: FieldConfigOverridesBuilder<any>) {
  return b
    .matchFieldsByQuery('capacity')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'rgb(202, 149, 229)' })
    .overrideCustomFieldConfig('fillOpacity', 14)
    .matchFieldsByQuery('limits')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'red' })
    .overrideCustomFieldConfig('lineStyle', { fill: 'dash' })
    .matchFieldsByQuery('requests')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'orange' })
    .overrideCustomFieldConfig('lineStyle', { fill: 'dash' })
    .matchFieldsByQuery('usage')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'blue' });
}

function getClusterOverviewScene(cluster: string, clusterRegex: string) {
  const infoRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'info', expr: withClusterFilter(clusterTableQueries.info, clusterRegex), format: 'table', instant: true },
    ],
  });

  const infoCard = new InfoCard({
    $data: infoRunner,
    rows: [
      { label: 'cluster name:', fieldName: 'cluster' },
      {
        label: 'nodes count:',
        fieldName: 'Value',
        href: `${PLUGIN_BASE_URL}/${ROUTES.Nodes}?var-${CLUSTER_VARIABLE_NAME}=${encodeURIComponent(cluster)}`,
      },
      { label: 'provider:', fieldName: 'provider' },
    ],
  });

  const capacityRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(clusterCapacityQueries) as ClusterCapacityQueryKey[]).map((key) => ({
      refId: key,
      expr: withClusterFilter(clusterCapacityQueries[key], clusterRegex),
      format: 'table' as const,
      instant: true,
    })),
  });

  const capacityData = new SceneDataTransformer({
    $data: capacityRunner,
    transformations: [{ id: 'joinByField', options: { byField: 'cluster', mode: 'outer' } }],
  });

  const capacityCard = new InfoCard({
    $data: capacityData,
    rows: [
      { label: 'cpu:', fieldName: 'Value #cpu', unit: 'cores' },
      { label: 'memory:', fieldName: 'Value #memory', unit: 'bytes' },
      { label: 'disk size:', fieldName: 'Value #disk', unit: 'bytes' },
    ],
  });

  const healthRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'health', expr: buildClusterHealthQuery(clusterRegex), instant: true }],
  });

  const healthBanner = new ClusterHealthBanner({ $data: healthRunner });

  const alertsBadgeRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'alerts',
        expr: `count by (severity) (ALERTS{alertstate="firing", cluster="${clusterRegex}", alertname!~"ArgoCDSyncAlert"})`,
        instant: true,
      },
    ],
  });

  const alertsBadge = new ClusterAlertsBadge({
    $data: alertsBadgeRunner,
    alertsUrl: `${PLUGIN_BASE_URL}/${ROUTES.Alerts}?var-${CLUSTER_VARIABLE_NAME}=${encodeURIComponent(cluster)}`,
  });

  const cpuOptimizationRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'capacity', expr: substituteCluster(clusterCpuOptimizationQueries.cpuCapacity, clusterRegex), legendFormat: 'Physical capacity of Cluster' },
      { refId: 'limits', expr: substituteCluster(clusterCpuOptimizationQueries.cpuLimits, clusterRegex), legendFormat: 'Sum of container cpu limits' },
      { refId: 'requests', expr: substituteCluster(clusterCpuOptimizationQueries.cpuRequests, clusterRegex), legendFormat: 'Sum of container cpu requests' },
      { refId: 'usage', expr: substituteCluster(clusterCpuOptimizationQueries.cpuUsage, clusterRegex), legendFormat: 'Cluster cpu usage' },
    ],
  });

  const cpuOptimizationPanel = PanelBuilders.timeseries()
    .setTitle('Cluster CPU')
    .setUnit('cores')
    .setData(cpuOptimizationRunner)
    .setOverrides(applyOptimizationSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const memoryOptimizationRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'capacity', expr: substituteCluster(clusterMemoryOptimizationQueries.memCapacity, clusterRegex), legendFormat: 'Physical capacity of Cluster' },
      { refId: 'limits', expr: substituteCluster(clusterMemoryOptimizationQueries.memLimits, clusterRegex), legendFormat: 'Sum of container memory limits' },
      { refId: 'requests', expr: substituteCluster(clusterMemoryOptimizationQueries.memRequests, clusterRegex), legendFormat: 'Sum of container memory requests' },
      { refId: 'usage', expr: substituteCluster(clusterMemoryOptimizationQueries.memUsage, clusterRegex), legendFormat: 'Cluster memory usage' },
    ],
  });

  const memoryOptimizationPanel = PanelBuilders.timeseries()
    .setTitle('Cluster Memory')
    .setUnit('bytes')
    .setData(memoryOptimizationRunner)
    .setOverrides(applyOptimizationSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const nodesRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: buildNodeTableTargets(clusterRegex),
  });

  const nodesData = new SceneDataTransformer({
    $data: nodesRunner,
    transformations: [
      { id: 'joinByField', options: { byField: 'node', mode: 'outer' } },
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, asserts_env: true, asserts_site: true, cluster: true, provider_id: true, 'Value #info': true },
          indexByName: {
            node: 0,
            'Value #cpu_usage_avg': 1,
            'Value #cpu_usage_avg_percent': 2,
            'Value #cpu_usage_max': 3,
            'Value #cpu_usage_max_percent': 4,
            'Value #mem_usage_avg': 5,
            'Value #mem_usage_avg_percent': 6,
            'Value #mem_usage_max': 7,
            'Value #mem_usage_max_percent': 8,
          },
          renameByName: {},
        },
      },
    ],
  });

  const nodesTable = PanelBuilders.table()
    .setTitle('Nodes')
    .setData(nodesData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('node')
        .overrideDisplayName('Node')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([{ title: 'View node', url: `${NODES_URL}/${encodeURIComponent(cluster)}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('Value #cpu_usage_avg')
        .overrideDisplayName('CPU Avg')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #cpu_usage_avg_percent'),
        } as any)
        .matchFieldsWithName('Value #cpu_usage_avg_percent')
        .overrideDisplayName('CPU Avg %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #cpu_usage_max')
        .overrideDisplayName('CPU Max')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #cpu_usage_max_percent'),
        } as any)
        .matchFieldsWithName('Value #cpu_usage_max_percent')
        .overrideDisplayName('CPU Max %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #mem_usage_avg')
        .overrideDisplayName('Mem Avg')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #mem_usage_avg_percent'),
        } as any)
        .matchFieldsWithName('Value #mem_usage_avg_percent')
        .overrideDisplayName('Mem Avg %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #mem_usage_max')
        .overrideDisplayName('Mem Max')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #mem_usage_max_percent'),
        } as any)
        .matchFieldsWithName('Value #mem_usage_max_percent')
        .overrideDisplayName('Mem Max %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
    )
    .build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    $variables: new SceneVariableSet({ variables: [createNodesFilterVariable(clusterRegex)] }),
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({
              xSizing: 'content',
              ySizing: 'content',
              body: new SceneReactObject({ reactNode: <ClusterOverviewLinks cluster={cluster} /> }),
            }),
            new SceneFlexItem({ width: 220, ySizing: 'content', body: alertsBadge }),
            new SceneFlexItem({ body: new SceneControlsSpacer() }),
          ],
        }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Cluster information" /> }),
        }),
        new SceneFlexItem({ ySizing: 'content', body: healthBanner }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ width: '50%', ySizing: 'content', minWidth: 0, body: infoCard }),
            new SceneFlexItem({ width: '50%', ySizing: 'content', minWidth: 0, body: capacityCard }),
          ],
        }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Cluster optimization" /> }),
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
          body: new SceneReactObject({ reactNode: <SectionHeading title="Nodes" /> }),
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({
              width: 220,
              ySizing: 'content',
              body: new VariableValueControl({ variableName: NODES_VARIABLE_NAME }),
            }),
            new SceneFlexItem({ body: new SceneControlsSpacer() }),
            new SceneFlexItem({
              xSizing: 'content',
              ySizing: 'content',
              body: new SceneReactObject({ reactNode: <ResourceUsageLegend /> }),
            }),
          ],
        }),
        new SceneFlexItem({ height: 400, body: nodesTable }),
      ],
    }),
  });
}

// Small colored KPI tile for a 0-1 ratio, using the same orange/green/red
// thresholds as the CPU/Mem % columns in the cluster tables.
function buildEfficiencyStatPanel(title: string, expr: string) {
  // A range query (not instant) is needed so the sparkline has history to draw.
  const runner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'ratio', expr }],
  });
  return PanelBuilders.stat()
    .setTitle(title)
    .setUnit('percentunit')
    .setThresholds(usageThresholds)
    .setOption('colorMode', BigValueColorMode.Value)
    .setOption('graphMode', BigValueGraphMode.Area)
    .setData(runner)
    .build();
}

function getClusterCpuScene(cluster: string, clusterRegex: string) {
  const namespaceRegex = `\${${NAMESPACE_VARIABLE_NAME}:regex}`;
  const nodeRegex = `\${${NODES_VARIABLE_NAME}:regex}`;

  const requestsCapacityPanel = buildEfficiencyStatPanel(
    'Efficiency: Requests/Capacity (p95)',
    `sum(max by (cluster, namespace) (namespace_cpu:kube_pod_container_resource_requests:sum{cluster="${clusterRegex}", namespace=~".+"})) / sum(max by (cluster, node) (kube_node_status_capacity{cluster="${clusterRegex}", resource="cpu", node=~".*"}))`
  );

  const usageCapacityPanel = buildEfficiencyStatPanel(
    'Efficiency: Usage/Capacity (p95)',
    `sum(node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="${clusterRegex}", namespace=~".+", node=~".*"}) / sum(max by (cluster, node) (kube_node_status_capacity{cluster="${clusterRegex}", resource="cpu", node=~".*"}))`
  );

  const usageRequestsPanel = buildEfficiencyStatPanel(
    'Efficiency: Usage/Requests (p95)',
    `sum(node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="${clusterRegex}", namespace=~".+", node=~".*"}) / sum(max by (cluster, namespace) (namespace_cpu:kube_pod_container_resource_requests:sum{cluster="${clusterRegex}", namespace=~".+"}))`
  );

  const namespaceUsageRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'usage',
        expr: `sum by (cluster, namespace) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="${clusterRegex}", namespace=~"${namespaceRegex}", node=~".*"})`,
        legendFormat: '{{namespace}}',
      },
    ],
  });

  const namespaceUsagePanel = PanelBuilders.timeseries()
    .setTitle('Overview: Usage by Namespace (vCPU cores)')
    .setUnit('cores')
    .setData(namespaceUsageRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const namespaceDistributionRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'distribution',
        expr: `sum by (cluster, namespace) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="${clusterRegex}", namespace=~"${namespaceRegex}", node=~".*"}) / on (cluster) group_left() sum by (cluster) (max by (cluster, node) (kube_node_status_capacity{cluster="${clusterRegex}", resource="cpu", node=~".*"}))`,
        legendFormat: '{{namespace}}',
      },
    ],
  });

  const namespaceDistributionPanel = PanelBuilders.timeseries()
    .setTitle('Distribution: Namespace Usage/Cluster Capacity (%, stacked)')
    .setUnit('percentunit')
    .setData(namespaceDistributionRunner)
    .setCustomFieldConfig('stacking', { mode: StackingMode.Normal })
    .setCustomFieldConfig('lineWidth', 2)
    .setCustomFieldConfig('fillOpacity', 60)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const namespaceAlignmentRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'alignment',
        expr: `sum by (namespace) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="${clusterRegex}", namespace=~"${namespaceRegex}", node=~".*"}) / on (namespace) sum by (namespace) (namespace_cpu:kube_pod_container_resource_requests:sum{cluster="${clusterRegex}", namespace=~"${namespaceRegex}"})`,
        legendFormat: '{{namespace}}',
      },
    ],
  });

  const namespaceAlignmentPanel = PanelBuilders.timeseries()
    .setTitle('Alignment: Namespace Usage/Requests (%)')
    .setUnit('percentunit')
    .setData(namespaceAlignmentRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const namespacesTableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'active',
        expr: `max by (cluster, namespace) (kube_namespace_status_phase{phase="Active", cluster="${clusterRegex}", namespace=~"${namespaceRegex}"} == 1)`,
        format: 'table',
        instant: true,
      },
      {
        refId: 'cpu_usage',
        expr: `quantile_over_time(0.95, sum by (cluster, namespace) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="${clusterRegex}", namespace=~"${namespaceRegex}", node=~".*"})[$__range:2m])`,
        format: 'table',
        instant: true,
      },
      {
        refId: 'cpu_usage_requests',
        expr: `quantile_over_time(0.95, sum by (cluster, namespace) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="${clusterRegex}", namespace=~"${namespaceRegex}", node=~".*"})[$__range:2m]) / quantile_over_time(0.95, sum by (cluster, namespace) (namespace_cpu:kube_pod_container_resource_requests:sum{cluster="${clusterRegex}", namespace=~".+"})[$__range:2m])`,
        format: 'table',
        instant: true,
      },
    ],
  });

  const namespacesTableData = new SceneDataTransformer({
    $data: namespacesTableRunner,
    transformations: [
      { id: 'joinByField', options: { byField: 'namespace', mode: 'inner' } },
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, cluster: true, 'Value #active': true },
          indexByName: { namespace: 0, 'Value #cpu_usage': 1, 'Value #cpu_usage_requests': 2 },
          renameByName: {},
        },
      },
    ],
  });

  const namespacesTable = PanelBuilders.table()
    .setTitle('Namespaces')
    .setData(namespacesTableData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('namespace')
        .overrideDisplayName('Namespace')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          { title: 'View namespace', url: `${NAMESPACES_URL}/${encodeURIComponent(cluster)}/\${__value.text}\${__url.params}` },
        ])
        .matchFieldsWithName('Value #cpu_usage')
        .overrideDisplayName('CPU Usage (p95)')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #cpu_usage_requests')
        .overrideDisplayName('Usage/Requests (p95)')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
    )
    .build();

  const nodeOverviewRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'capacity',
        expr: `sum(max by (cluster, node) (kube_node_status_capacity{cluster="${clusterRegex}", resource="cpu", node=~"${nodeRegex}"}))`,
        legendFormat: 'Physical capacity of cluster',
      },
      {
        refId: 'limits',
        expr: `sum(max by (cluster, namespace) (namespace_cpu:kube_pod_container_resource_limits:sum{cluster="${clusterRegex}", namespace=~".+"}))`,
        legendFormat: 'Sum of container cpu limits',
      },
      {
        refId: 'requests',
        expr: `sum(max by (cluster, namespace) (namespace_cpu:kube_pod_container_resource_requests:sum{cluster="${clusterRegex}", namespace=~".+"}))`,
        legendFormat: 'Sum of container cpu requests',
      },
      {
        refId: 'usage',
        expr: `sum(1 - max by (cluster, instance, cpu, core) (rate(node_cpu_seconds_total{cluster=~"${clusterRegex}", mode=~"idle"}[$__rate_interval])) >= 0)`,
        legendFormat: 'Sum of container cpu usage',
      },
    ],
  });

  const nodeOverviewPanel = PanelBuilders.timeseries()
    .setTitle('Overview: Usage (vCPU cores)')
    .setUnit('cores')
    .setData(nodeOverviewRunner)
    .setOverrides(applyOptimizationSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const nodeDistributionRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'distribution',
        expr: `sum by (cluster, node) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="${clusterRegex}", namespace=~".+", node=~"${nodeRegex}"}) / on (cluster) group_left() sum by (cluster) (max by (cluster, node) (kube_node_status_capacity{cluster="${clusterRegex}", resource="cpu", node=~"${nodeRegex}"}))`,
        legendFormat: '{{node}}',
      },
    ],
  });

  const nodeDistributionPanel = PanelBuilders.timeseries()
    .setTitle('Distribution: Node Usage/Cluster Capacity (%, stacked)')
    .setUnit('percentunit')
    .setMin(0)
    .setMax(1)
    .setThresholds(usageThresholds)
    .setCustomFieldConfig('thresholdsStyle', { mode: GraphThresholdsStyleMode.Dashed })
    .setData(nodeDistributionRunner)
    .setCustomFieldConfig('stacking', { mode: StackingMode.Normal })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const nodeEfficiencyRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'efficiency',
        expr: `sum by (cluster, node) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="${clusterRegex}", namespace=~".+", node=~"${nodeRegex}"}) / on (cluster, node) group_left() sum by (cluster, node) (max by (cluster, node) (kube_node_status_capacity{cluster="${clusterRegex}", resource="cpu", node=~"${nodeRegex}"}))`,
        legendFormat: '{{node}}',
      },
    ],
  });

  const nodeEfficiencyPanel = PanelBuilders.timeseries()
    .setTitle('Efficiency: Node Usage/node Capacity (%)')
    .setUnit('percentunit')
    .setMin(0)
    .setMax(1)
    .setThresholds(usageThresholds)
    .setCustomFieldConfig('thresholdsStyle', { mode: GraphThresholdsStyleMode.Dashed })
    .setData(nodeEfficiencyRunner)
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const nodesTableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'info',
        expr: `max by (cluster, node, os_image) (kube_node_info{cluster="${clusterRegex}", node=~"${nodeRegex}"})`,
        format: 'table',
        instant: true,
      },
      {
        refId: 'capacity',
        expr: `last_over_time((max by (cluster, node) (kube_node_status_capacity{cluster="${clusterRegex}", resource="cpu", node=~"${nodeRegex}"}))[$__range:1m])`,
        format: 'table',
        instant: true,
      },
      {
        refId: 'usage',
        expr: `quantile_over_time(0.95, sum by (cluster, node) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="${clusterRegex}", namespace=~".+", node=~"${nodeRegex}"})[$__range:1m])`,
        format: 'table',
        instant: true,
      },
      {
        refId: 'usage_capacity',
        expr: `quantile_over_time(0.95, sum by (cluster, node) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="${clusterRegex}", namespace=~".+", node=~"${nodeRegex}"})[$__range:1m]) / quantile_over_time(0.95, sum by (cluster, node) (max by (cluster, node) (kube_node_status_capacity{cluster="${clusterRegex}", resource="cpu", node=~"${nodeRegex}"}))[$__range:1m])`,
        format: 'table',
        instant: true,
      },
    ],
  });

  const nodesTableData = new SceneDataTransformer({
    $data: nodesTableRunner,
    transformations: [
      { id: 'joinByField', options: { byField: 'node', mode: 'inner' } },
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, cluster: true, 'Value #info': true },
          indexByName: { node: 0, os_image: 1, 'Value #capacity': 2, 'Value #usage': 3, 'Value #usage_capacity': 4 },
          renameByName: {},
        },
      },
    ],
  });

  const nodesTable = PanelBuilders.table()
    .setTitle('Nodes')
    .setData(nodesTableData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('node')
        .overrideDisplayName('Nodes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([{ title: 'View node', url: `${NODES_URL}/${encodeURIComponent(cluster)}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('os_image')
        .overrideDisplayName('OS')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #capacity')
        .overrideDisplayName('Capacity (vCPU)')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #usage')
        .overrideDisplayName('Usage (P95)')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #usage_capacity')
        .overrideDisplayName('Usage/Capacity (P95, %)')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
    )
    .build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    $variables: new SceneVariableSet({
      variables: [createNodesFilterVariable(clusterRegex), createNamespaceFilterVariable({ clusterRegex })],
    }),
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 120, body: requestsCapacityPanel }),
            new SceneFlexItem({ height: 120, body: usageCapacityPanel }),
            new SceneFlexItem({ height: 120, body: usageRequestsPanel }),
          ],
        }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="by Namespace" /> }),
        }),
        new SceneFlexItem({
          width: 220,
          ySizing: 'content',
          body: new VariableValueControl({ variableName: NAMESPACE_VARIABLE_NAME }),
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: namespaceUsagePanel }),
            new SceneFlexItem({ height: 300, body: namespaceDistributionPanel }),
            new SceneFlexItem({ height: 300, body: namespaceAlignmentPanel }),
          ],
        }),
        new SceneFlexItem({ height: 400, body: namespacesTable }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="by node" /> }),
        }),
        new SceneFlexItem({
          width: 220,
          ySizing: 'content',
          body: new VariableValueControl({ variableName: NODES_VARIABLE_NAME }),
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: nodeOverviewPanel }),
            new SceneFlexItem({ height: 300, body: nodeDistributionPanel }),
            new SceneFlexItem({ height: 300, body: nodeEfficiencyPanel }),
          ],
        }),
        new SceneFlexItem({ height: 400, body: nodesTable }),
      ],
    }),
  });
}

function getClusterMemoryScene(cluster: string, clusterRegex: string) {
  const namespaceRegex = `\${${NAMESPACE_VARIABLE_NAME}:regex}`;
  const nodeRegex = `\${${NODES_VARIABLE_NAME}:regex}`;

  const requestsCapacityPanel = buildEfficiencyStatPanel(
    'Efficiency: Requests/Capacity (p95)',
    `sum(max by (cluster, namespace) (namespace_memory:kube_pod_container_resource_requests:sum{cluster=~"${clusterRegex}", namespace=~".+"})) / sum(max by (cluster, node) (kube_node_status_capacity{cluster=~"${clusterRegex}", resource=~"memory", node=~".*"}))`
  );

  const usageCapacityPanel = buildEfficiencyStatPanel(
    'Efficiency: Usage/Capacity (p95)',
    `sum(node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"${clusterRegex}", namespace=~".+", node=~".*"}) / sum(max by (cluster, node) (kube_node_status_capacity{cluster=~"${clusterRegex}", resource=~"memory", node=~".*"}))`
  );

  const usageRequestsPanel = buildEfficiencyStatPanel(
    'Efficiency: Usage/Requests (p95)',
    `sum(node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"${clusterRegex}", namespace=~".+"}) / sum(max by (cluster, namespace) (namespace_memory:kube_pod_container_resource_requests:sum{cluster=~"${clusterRegex}", namespace=~".+"}))`
  );

  const namespaceUsageRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'usage',
        expr: `sum by (cluster, namespace) (node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"${clusterRegex}", namespace=~"${namespaceRegex}", node=~".*"})`,
        legendFormat: '{{namespace}}',
      },
    ],
  });

  const namespaceUsagePanel = PanelBuilders.timeseries()
    .setTitle('Overview: Usage by Namespace (memory bytes)')
    .setUnit('bytes')
    .setData(namespaceUsageRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const namespaceDistributionRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'distribution',
        expr: `sum by (cluster, namespace) (node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"${clusterRegex}", namespace=~"${namespaceRegex}", node=~".*"}) / on (cluster) group_left() sum by (cluster) (max by (cluster, node) (kube_node_status_capacity{cluster=~"${clusterRegex}", resource=~"memory", node=~".*"}))`,
        legendFormat: '{{namespace}}',
      },
    ],
  });

  const namespaceDistributionPanel = PanelBuilders.timeseries()
    .setTitle('Distribution: Namespace Usage/Cluster Capacity (%, stacked)')
    .setUnit('percentunit')
    .setData(namespaceDistributionRunner)
    .setCustomFieldConfig('stacking', { mode: StackingMode.Normal })
    .setCustomFieldConfig('lineWidth', 2)
    .setCustomFieldConfig('fillOpacity', 60)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const namespaceAlignmentRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'alignment',
        expr: `sum by (namespace, cluster) (node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"${clusterRegex}", namespace=~"${namespaceRegex}", node=~".*"}) / on (namespace, cluster) sum by (namespace, cluster) (namespace_memory:kube_pod_container_resource_requests:sum{cluster=~"${clusterRegex}", namespace=~".+"})`,
        legendFormat: '{{namespace}}',
      },
    ],
  });

  const namespaceAlignmentPanel = PanelBuilders.timeseries()
    .setTitle('Alignment: Namespace Usage/Requests (%)')
    .setUnit('percentunit')
    .setData(namespaceAlignmentRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['p95'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const namespacesTableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'active',
        expr: `max by (cluster, namespace) (kube_namespace_status_phase{phase="Active", cluster="${clusterRegex}", namespace=~"${namespaceRegex}"} == 1)`,
        format: 'table',
        instant: true,
      },
      {
        refId: 'mem_usage',
        expr: `quantile_over_time(0.95, sum by (cluster, namespace) (node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"${clusterRegex}", namespace=~"${namespaceRegex}", node=~".*"})[$__range:1m])`,
        format: 'table',
        instant: true,
      },
      {
        refId: 'mem_usage_requests',
        expr: `quantile_over_time(0.95, sum by (cluster, namespace) (node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"${clusterRegex}", namespace=~"${namespaceRegex}", node=~".*"})[$__range:1m]) / quantile_over_time(0.95, sum by (cluster, namespace) (namespace_memory:kube_pod_container_resource_requests:sum{cluster=~"${clusterRegex}", namespace=~"${namespaceRegex}"})[$__range:1m])`,
        format: 'table',
        instant: true,
      },
    ],
  });

  const namespacesTableData = new SceneDataTransformer({
    $data: namespacesTableRunner,
    transformations: [
      { id: 'joinByField', options: { byField: 'namespace', mode: 'inner' } },
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, cluster: true, 'Value #active': true },
          indexByName: { namespace: 0, 'Value #mem_usage': 1, 'Value #mem_usage_requests': 2 },
          renameByName: {},
        },
      },
    ],
  });

  const namespacesTable = PanelBuilders.table()
    .setTitle('Namespaces')
    .setData(namespacesTableData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('namespace')
        .overrideDisplayName('Namespace')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          { title: 'View namespace', url: `${NAMESPACES_URL}/${encodeURIComponent(cluster)}/\${__value.text}\${__url.params}` },
        ])
        .matchFieldsWithName('Value #mem_usage')
        .overrideDisplayName('Usage (P95)')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #mem_usage_requests')
        .overrideDisplayName('Usage/Capacity (P95, %)')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
    )
    .build();

  const nodeOverviewRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'capacity',
        expr: `sum(max by (cluster, node) (kube_node_status_capacity{cluster=~"${clusterRegex}", resource=~"memory", node=~".*"}))`,
        legendFormat: 'Physical capacity of cluster',
      },
      {
        refId: 'limits',
        expr: `sum(max by (cluster, namespace) (namespace_memory:kube_pod_container_resource_limits:sum{cluster=~"${clusterRegex}", namespace=~".+"}))`,
        legendFormat: 'Sum of container memory limits',
      },
      {
        refId: 'requests',
        expr: `sum(max by (cluster, namespace) (namespace_memory:kube_pod_container_resource_requests:sum{cluster=~"${clusterRegex}", namespace=~".+"}))`,
        legendFormat: 'Sum of container memory requests',
      },
      {
        refId: 'usage',
        expr: `sum(node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"${clusterRegex}", namespace=~".+", node=~".*"})`,
        legendFormat: 'Sum of container memory usage',
      },
    ],
  });

  const nodeOverviewPanel = PanelBuilders.timeseries()
    .setTitle('Overview: Usage (memory bytes)')
    .setUnit('bytes')
    .setData(nodeOverviewRunner)
    .setOverrides(applyOptimizationSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const nodeDistributionRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'distribution',
        expr: `sum by (cluster, node) (node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"${clusterRegex}", namespace=~".+", node=~".*"}) / on (cluster) group_left() sum by (cluster) (max by (cluster, node) (kube_node_status_capacity{cluster=~"${clusterRegex}", resource=~"memory", node=~".*"}))`,
        legendFormat: '{{node}}',
      },
    ],
  });

  const nodeDistributionPanel = PanelBuilders.timeseries()
    .setTitle('Distribution: Node Usage/Cluster Capacity (%, stacked)')
    .setUnit('percentunit')
    .setMin(0)
    .setMax(1)
    .setThresholds(usageThresholds)
    .setCustomFieldConfig('thresholdsStyle', { mode: GraphThresholdsStyleMode.Dashed })
    .setData(nodeDistributionRunner)
    .setCustomFieldConfig('stacking', { mode: StackingMode.Normal })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const nodeEfficiencyRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'efficiency',
        expr: `sum by (cluster, node) (node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"${clusterRegex}", namespace=~".+", node=~".*"}) / on (cluster, node) group_left() sum by (cluster, node) (max by (cluster, node) (kube_node_status_capacity{cluster=~"${clusterRegex}", resource=~"memory", node=~".*"}))`,
        legendFormat: '{{node}}',
      },
    ],
  });

  const nodeEfficiencyPanel = PanelBuilders.timeseries()
    .setTitle('Efficiency: Node Usage/Node Capacity (%)')
    .setUnit('percentunit')
    .setMin(0)
    .setMax(1)
    .setThresholds(usageThresholds)
    .setCustomFieldConfig('thresholdsStyle', { mode: GraphThresholdsStyleMode.Dashed })
    .setData(nodeEfficiencyRunner)
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const nodesTableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'info',
        expr: `max by (cluster, node, os_image) (kube_node_info{cluster="${clusterRegex}", node=~"${nodeRegex}"})`,
        format: 'table',
        instant: true,
      },
      {
        refId: 'capacity',
        expr: `last_over_time((max by (cluster, node) (kube_node_status_capacity{cluster="${clusterRegex}", resource="memory", node=~"${nodeRegex}"}))[$__range:1m])`,
        format: 'table',
        instant: true,
      },
      {
        refId: 'usage',
        expr: `quantile_over_time(0.95, sum by (cluster, node) (node_namespace_pod_container:container_memory_working_set_bytes{cluster="${clusterRegex}", namespace=~".+", node=~"${nodeRegex}"})[$__range:1m])`,
        format: 'table',
        instant: true,
      },
      {
        refId: 'usage_capacity',
        expr: `quantile_over_time(0.95, sum by (cluster, node) (node_namespace_pod_container:container_memory_working_set_bytes{cluster="${clusterRegex}", namespace=~".+", node=~"${nodeRegex}"})[$__range:1m]) / quantile_over_time(0.95, sum by (cluster, node) (max by (cluster, node) (kube_node_status_capacity{cluster="${clusterRegex}", resource="memory", node=~"${nodeRegex}"}))[$__range:1m])`,
        format: 'table',
        instant: true,
      },
    ],
  });

  const nodesTableData = new SceneDataTransformer({
    $data: nodesTableRunner,
    transformations: [
      { id: 'joinByField', options: { byField: 'node', mode: 'inner' } },
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, cluster: true, 'Value #info': true },
          indexByName: { node: 0, os_image: 1, 'Value #capacity': 2, 'Value #usage': 3, 'Value #usage_capacity': 4 },
          renameByName: {},
        },
      },
    ],
  });

  const nodesTable = PanelBuilders.table()
    .setTitle('Nodes')
    .setData(nodesTableData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('node')
        .overrideDisplayName('Node')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([{ title: 'View node', url: `${NODES_URL}/${encodeURIComponent(cluster)}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('os_image')
        .overrideDisplayName('OS')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #capacity')
        .overrideDisplayName('Capacity (bytes)')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #usage')
        .overrideDisplayName('Usage (P95)')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #usage_capacity')
        .overrideDisplayName('Usage/Capacity (P95, %)')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
    )
    .build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    $variables: new SceneVariableSet({
      variables: [createNodesFilterVariable(clusterRegex), createNamespaceFilterVariable({ clusterRegex })],
    }),
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 120, body: requestsCapacityPanel }),
            new SceneFlexItem({ height: 120, body: usageCapacityPanel }),
            new SceneFlexItem({ height: 120, body: usageRequestsPanel }),
          ],
        }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="by Namespace" /> }),
        }),
        new SceneFlexItem({
          width: 220,
          ySizing: 'content',
          body: new VariableValueControl({ variableName: NAMESPACE_VARIABLE_NAME }),
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: namespaceUsagePanel }),
            new SceneFlexItem({ height: 300, body: namespaceDistributionPanel }),
            new SceneFlexItem({ height: 300, body: namespaceAlignmentPanel }),
          ],
        }),
        new SceneFlexItem({ height: 400, body: namespacesTable }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="by node" /> }),
        }),
        new SceneFlexItem({
          width: 220,
          ySizing: 'content',
          body: new VariableValueControl({ variableName: NODES_VARIABLE_NAME }),
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: nodeOverviewPanel }),
            new SceneFlexItem({ height: 300, body: nodeDistributionPanel }),
            new SceneFlexItem({ height: 300, body: nodeEfficiencyPanel }),
          ],
        }),
        new SceneFlexItem({ height: 400, body: nodesTable }),
      ],
    }),
  });
}

function getClusterNetworkScene(clusterRegex: string) {
  const bandwidthRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'rx',
        expr: `sum (max by (cluster, node, device) (label_replace(rate(node_network_receive_bytes_total{cluster=~"${clusterRegex}"}[$__rate_interval]), "node", "$1", "instance", "([^:]+).*")))`,
        legendFormat: 'Receive',
      },
      {
        refId: 'tx',
        expr: `- sum (max by (cluster, node, device) (label_replace(rate(node_network_transmit_bytes_total{cluster="${clusterRegex}"}[$__rate_interval]), "node", "$1", "instance", "([^:]+).*")))`,
        legendFormat: 'Transmit',
      },
    ],
  });

  const bandwidthPanel = PanelBuilders.timeseries().setTitle('Network Bandwidth').setUnit('Bps').setData(bandwidthRunner).setHeaderActions(new PanelTimeRangeCompare()).setCustomFieldConfig('spanNulls', true).build();

  const saturationRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'rx',
        expr: `sum (max by (cluster, node, device) (label_replace(rate(node_network_receive_drop_total{cluster="${clusterRegex}"}[$__rate_interval]), "node", "$1", "instance", "([^:]+).*")))`,
        legendFormat: 'Receive',
      },
      {
        refId: 'tx',
        expr: `- sum (max by (cluster, node, device) (label_replace(rate(node_network_transmit_drop_total{cluster="${clusterRegex}"}[$__rate_interval]), "node", "$1", "instance", "([^:]+).*")))`,
        legendFormat: 'Transmit',
      },
    ],
  });

  const saturationPanel = PanelBuilders.timeseries().setTitle('Network Saturation').setUnit('pps').setData(saturationRunner).setHeaderActions(new PanelTimeRangeCompare()).setCustomFieldConfig('spanNulls', true).build();

  const saturationByNodeRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'rx',
        expr: `sum by (cluster, node) (max by (cluster, node, device) (label_replace(rate(node_network_receive_drop_total{cluster="${clusterRegex}"}[$__rate_interval]), "node", "$1", "instance", "([^:]+).*")))`,
        legendFormat: '{{node}} Receive',
      },
      {
        refId: 'tx',
        expr: `- sum by (cluster, node) (max by (cluster, node, device) (label_replace(rate(node_network_transmit_drop_total{cluster="${clusterRegex}"}[$__rate_interval]), "node", "$1", "instance", "([^:]+).*")))`,
        legendFormat: '{{node}} Transmit',
      },
    ],
  });

  const saturationByNodePanel = PanelBuilders.timeseries().setTitle('Network Saturation by node').setUnit('pps').setData(saturationByNodeRunner).setHeaderActions(new PanelTimeRangeCompare()).setCustomFieldConfig('spanNulls', true).build();

  const bandwidthByNodeRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'rx',
        expr: `sum by (cluster, node) (max by (cluster, node, device) (label_replace(rate(node_network_receive_bytes_total{cluster=~"${clusterRegex}"}[$__rate_interval]), "node", "$1", "instance", "([^:]+).*")))`,
        legendFormat: '{{node}} Receive',
      },
      {
        refId: 'tx',
        expr: `- sum by (cluster, node) (max by (cluster, node, device) (label_replace(rate(node_network_transmit_bytes_total{cluster="${clusterRegex}"}[$__rate_interval]), "node", "$1", "instance", "([^:]+).*")))`,
        legendFormat: '{{node}} Transmit',
      },
    ],
  });

  const bandwidthByNodePanel = PanelBuilders.timeseries().setTitle('Network Bandwidth by node').setUnit('Bps').setData(bandwidthByNodeRunner).setHeaderActions(new PanelTimeRangeCompare()).setCustomFieldConfig('spanNulls', true).build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: bandwidthPanel }),
            new SceneFlexItem({ height: 300, body: saturationPanel }),
          ],
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: saturationByNodePanel }),
            new SceneFlexItem({ height: 300, body: bandwidthByNodePanel }),
          ],
        }),
      ],
    }),
  });
}

const FS_DEVICE_REGEX = '(/dev.+)|mmcblk.p.+|nvme.+|rbd.+|sd.+|vd.+|xvd.+|dm-.+|dasd.+';

function getClusterStorageScene(clusterRegex: string) {
  const ephemeralUsageRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'usage',
        expr: `container_fs_usage_bytes{k8s_cluster_name="${clusterRegex}", container!="POD"} / on(pod, container, k8s_namespace_name) group_left max by (pod, container, k8s_namespace_name) (kube_pod_container_resource_limits{k8s_cluster_name="${clusterRegex}", resource="ephemeral_storage"})`,
        legendFormat: '{{k8s_namespace_name}}/{{pod}}/{{container}}',
      },
    ],
  });

  const ephemeralUsagePanel = PanelBuilders.timeseries().setTitle('Ephemeral Volume Usage').setUnit('percentunit').setMin(0).setMax(1).setData(ephemeralUsageRunner).setHeaderActions(new PanelTimeRangeCompare()).setCustomFieldConfig('spanNulls', true).build();

  const pvcStorageClassRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'storageclass',
        expr: `count by (storageclass) (max by (cluster, namespace, persistentvolumeclaim, storageclass) (kube_persistentvolumeclaim_info{cluster="${clusterRegex}", namespace!="", persistentvolumeclaim!="", storageclass!=""}))`,
        legendFormat: '{{storageclass}}',
      },
    ],
  });

  const pvcStorageClassPanel = PanelBuilders.timeseries().setTitle('PVC Storage Class').setUnit('short').setData(pvcStorageClassRunner).setHeaderActions(new PanelTimeRangeCompare()).setCustomFieldConfig('spanNulls', true).build();

  const pvcVolumeBytesRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'requests',
        expr: `sum by (cluster) (max by (cluster, namespace, persistentvolumeclaim) (kube_persistentvolumeclaim_resource_requests_storage_bytes{cluster="${clusterRegex}", namespace!="", persistentvolumeclaim!=""}))`,
        legendFormat: 'Requests',
      },
      {
        refId: 'capacity',
        expr: `sum by (cluster) (max by (cluster, namespace, persistentvolumeclaim) (kubelet_volume_stats_capacity_bytes{cluster="${clusterRegex}", namespace!="", persistentvolumeclaim!=""}))`,
        legendFormat: 'Capacity',
      },
      {
        refId: 'used',
        expr: `sum by (cluster) (max by (cluster, namespace, persistentvolumeclaim) (kubelet_volume_stats_used_bytes{cluster="${clusterRegex}", namespace!="", persistentvolumeclaim!=""}))`,
        legendFormat: 'Used',
      },
    ],
  });

  const pvcVolumeBytesPanel = PanelBuilders.timeseries()
    .setTitle('PVC Volume Bytes')
    .setUnit('bytes')
    .setData(pvcVolumeBytesRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const pvcVolumeBytesByNamespaceRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'usage_pct',
        expr: `avg by (cluster, namespace) (max by (cluster, namespace, persistentvolumeclaim) (kubelet_volume_stats_used_bytes{cluster="${clusterRegex}"}) / on (cluster, namespace, persistentvolumeclaim) group_left() max by (cluster, namespace, persistentvolumeclaim) (kubelet_volume_stats_capacity_bytes{cluster="${clusterRegex}"}))`,
        legendFormat: '{{namespace}}',
      },
    ],
  });

  const pvcVolumeBytesByNamespacePanel = PanelBuilders.timeseries()
    .setTitle('PVC Volume bytes by namespace (avg)')
    .setUnit('percentunit')
    .setMin(0)
    .setMax(1)
    .setThresholds(pvcCapacityThresholds)
    .setCustomFieldConfig('thresholdsStyle', { mode: GraphThresholdsStyleMode.Dashed })
    .setData(pvcVolumeBytesByNamespaceRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const pvcVolumeInodesRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'inodes',
        expr: `sum by (cluster) (max by (cluster, namespace, persistentvolumeclaim) (kubelet_volume_stats_inodes{cluster="${clusterRegex}", namespace!="", persistentvolumeclaim!=""}))`,
        legendFormat: 'Total',
      },
      {
        refId: 'inodes_used',
        expr: `sum by (cluster) (max by (cluster, namespace, persistentvolumeclaim) (kubelet_volume_stats_inodes_used{cluster="${clusterRegex}", namespace!="", persistentvolumeclaim!=""}))`,
        legendFormat: 'Used',
      },
    ],
  });

  const pvcVolumeInodesPanel = PanelBuilders.timeseries()
    .setTitle('PVC Volume inodes')
    .setUnit('short')
    .setData(pvcVolumeInodesRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const pvcVolumeInodesByNamespaceRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'inodes_used_pct',
        expr: `avg by (cluster, namespace) (max by (cluster, namespace, persistentvolumeclaim) (kubelet_volume_stats_inodes_used{cluster="${clusterRegex}"}) / on (cluster, namespace, persistentvolumeclaim) group_left() max by (cluster, namespace, persistentvolumeclaim) (kubelet_volume_stats_inodes{cluster="${clusterRegex}"}))`,
        legendFormat: '{{namespace}}',
      },
    ],
  });

  const pvcVolumeInodesByNamespacePanel = PanelBuilders.timeseries()
    .setTitle('PVC Volume inodes by namespace (avg)')
    .setUnit('percentunit')
    .setMin(0)
    .setMax(1)
    .setThresholds(pvcCapacityThresholds)
    .setCustomFieldConfig('thresholdsStyle', { mode: GraphThresholdsStyleMode.Dashed })
    .setData(pvcVolumeInodesByNamespaceRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const pvcStatusRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'phase',
        expr: `count by (cluster, phase) (max by (cluster, namespace, persistentvolumeclaim, phase) (kube_persistentvolumeclaim_status_phase{cluster="${clusterRegex}", namespace!="", persistentvolumeclaim!="", phase!=""} == 1))`,
        legendFormat: '{{phase}}',
      },
    ],
  });

  const pvcStatusPanel = PanelBuilders.timeseries().setTitle('PVC Status').setUnit('short').setData(pvcStatusRunner).setHeaderActions(new PanelTimeRangeCompare()).setCustomFieldConfig('spanNulls', true).build();

  const pvStatusRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'phase',
        expr: `count by (cluster, phase) (max by (cluster, persistentvolume, phase) (kube_persistentvolume_status_phase{cluster="${clusterRegex}", persistentvolume!="", phase!=""} == 1))`,
        legendFormat: '{{phase}}',
      },
    ],
  });

  const pvStatusPanel = PanelBuilders.timeseries().setTitle('PV Status').setUnit('short').setData(pvStatusRunner).setHeaderActions(new PanelTimeRangeCompare()).setCustomFieldConfig('spanNulls', true).build();

  const throughputRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'reads',
        expr: `sum(rate(container_fs_reads_bytes_total{cluster=~"${clusterRegex}", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
        legendFormat: 'Reads',
      },
      {
        refId: 'writes',
        expr: `-sum(rate(container_fs_writes_bytes_total{cluster=~"${clusterRegex}", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
        legendFormat: 'Writes',
      },
    ],
  });

  const throughputPanel = PanelBuilders.timeseries()
    .setTitle('Throughput')
    .setUnit('Bps')
    .setData(throughputRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const throughputByNamespaceRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'reads',
        expr: `sum by (namespace) (rate(container_fs_reads_bytes_total{cluster=~"${clusterRegex}", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
        legendFormat: '{{namespace}} Reads',
      },
      {
        refId: 'writes',
        expr: `-sum by (namespace) (rate(container_fs_writes_bytes_total{cluster=~"${clusterRegex}", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
        legendFormat: '{{namespace}} Writes',
      },
    ],
  });

  const throughputByNamespacePanel = PanelBuilders.timeseries()
    .setTitle('Throughput by namespace')
    .setUnit('Bps')
    .setData(throughputByNamespaceRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const iopsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'reads',
        expr: `sum(rate(container_fs_reads_total{cluster=~"${clusterRegex}", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
        legendFormat: 'Reads',
      },
      {
        refId: 'writes',
        expr: `-sum(rate(container_fs_writes_total{cluster=~"${clusterRegex}", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
        legendFormat: 'Writes',
      },
    ],
  });

  const iopsPanel = PanelBuilders.timeseries()
    .setTitle('IOPS')
    .setUnit('iops')
    .setData(iopsRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const iopsByNamespaceRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'reads',
        expr: `sum by (namespace) (rate(container_fs_reads_total{cluster=~"${clusterRegex}", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
        legendFormat: '{{namespace}} Reads',
      },
      {
        refId: 'writes',
        expr: `-sum by (namespace) (rate(container_fs_writes_total{cluster=~"${clusterRegex}", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
        legendFormat: '{{namespace}} Writes',
      },
    ],
  });

  const iopsByNamespacePanel = PanelBuilders.timeseries()
    .setTitle('IOPS by namespace')
    .setUnit('iops')
    .setData(iopsByNamespaceRunner)
    .setOption('legend', { displayMode: LegendDisplayMode.List, placement: 'right', calcs: ['lastNotNull'] })
    
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({ height: 300, body: ephemeralUsagePanel }),
        new SceneFlexItem({ height: 300, body: pvcStorageClassPanel }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: pvcVolumeBytesPanel }),
            new SceneFlexItem({ height: 300, body: pvcVolumeBytesByNamespacePanel }),
          ],
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: pvcVolumeInodesPanel }),
            new SceneFlexItem({ height: 300, body: pvcVolumeInodesByNamespacePanel }),
          ],
        }),
        new SceneFlexItem({ height: 300, body: pvcStatusPanel }),
        new SceneFlexItem({ height: 300, body: pvStatusPanel }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: throughputPanel }),
            new SceneFlexItem({ height: 300, body: throughputByNamespacePanel }),
          ],
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: iopsPanel }),
            new SceneFlexItem({ height: 300, body: iopsByNamespacePanel }),
          ],
        }),
      ],
    }),
  });
}

interface ClusterTabDef {
  slug: string;
  title: string;
  getScene: () => EmbeddedScene;
}

function getClusterDetailPage(routeMatch: SceneRouteMatch<{ cluster: string }>, parent: SceneAppPageLike) {
  const cluster = decodeURIComponent(routeMatch.params.cluster);
  const clusterRegex = cluster.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const baseUrl = `${CLUSTERS_URL}/${encodeURIComponent(cluster)}`;

  const tabDefs: ClusterTabDef[] = [
    { slug: 'overview', title: 'Overview', getScene: () => getClusterOverviewScene(cluster, clusterRegex) },
    { slug: 'cpu', title: 'CPU', getScene: () => getClusterCpuScene(cluster, clusterRegex) },
    { slug: 'memory', title: 'Memory', getScene: () => getClusterMemoryScene(cluster, clusterRegex) },
    { slug: 'network', title: 'Network', getScene: () => getClusterNetworkScene(clusterRegex) },
    { slug: 'storage', title: 'Storage', getScene: () => getClusterStorageScene(clusterRegex) },
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
    title: cluster,
    titleImg: KUBERNETES_ICON,
    renderTitle: (title) => <ClusterPageTitle title={title} />,
    url: baseUrl,
    routePath: `${CLUSTERS_URL}/${encodeURIComponent(cluster)}`,
    getParentPage: () => parent,
    tabs,
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'browser' }),
    $variables: new SceneVariableSet({ variables: [createThanosDatasourceVariable()] }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new SceneControlsSpacer(),
      new SceneTimePicker({}),
      new SceneRefreshPicker({ refresh: '1m' }),
    ],
    preserveUrlKeys: ['from', 'to', 'timezone', 'refresh', `var-${THANOS_VARIABLE_NAME}`],
  });
}

const clustersPage = new SceneAppPage({
  title: 'Clusters',
  titleImg: KUBERNETES_ICON,
  url: CLUSTERS_URL,
  routePath: `/clusters/*`,
  getScene: getClustersListScene,
  $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'browser' }),
  $variables: new SceneVariableSet({
    variables: [createThanosDatasourceVariable(), createClusterFilterVariable()],
  }),
  controls: [
    new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
    new SceneControlsSpacer(),
    new SceneTimePicker({}),
    new SceneRefreshPicker({ refresh: '1m' }),
  ],
  preserveUrlKeys: ['from', 'to', 'timezone', 'refresh', `var-${THANOS_VARIABLE_NAME}`],
  drilldowns: [
    {
      routePath: `/:cluster/*`,
      getPage: getClusterDetailPage,
    },
  ],
});

export function getClustersSceneApp() {
  return new SceneApp({
    pages: [
      getKubernetesHomePage(),
      clustersPage,
      getResourceSimulatorPage(),
      getNamespacesPage(),
      getWorkloadsPage(),
      getJobsPage(),
      getNodesPage(),
      getAlertsPage(),
    ],
    urlSyncOptions: { updateUrlOnInit: true, createBrowserHistorySteps: true },
  });
}
