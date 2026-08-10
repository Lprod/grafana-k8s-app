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
import { BigValueColorMode, BigValueGraphMode, LegendDisplayMode, TableCellDisplayMode, ThresholdsMode } from '@grafana/schema';
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
import { ClusterHealthBanner, InfoCard } from './clusterOverviewCards';
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
import { getComingSoonScene } from './comingSoon';
import { UsageIcon, linkedValueCell, usageColorFromTier } from './tableCells';

const CLUSTERS_URL = `${PLUGIN_BASE_URL}/clusters`;
const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

// orange < 60% (underused), green 60-90% (healthy), red > 90% (near capacity).
const usageThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'orange', value: -Infinity },
    { color: 'green', value: 0.6 },
    { color: 'red', value: 0.9 },
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
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, asserts_env: true, asserts_site: true, provider_id: true },
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
// and "var-cluster" binds to its own variable.
function SectionHeading({ title }: { title: string }) {
  const theme = useTheme2();
  return <h3 style={{ ...theme.typography.h3, margin: 0 }}>{title}</h3>;
}

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
      { label: 'provider:', fieldName: 'provider_id' },
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
    $variables: new SceneVariableSet({ variables: [createNodesFilterVariable(clusterRegex)] }),
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <ClusterOverviewLinks cluster={cluster} /> }),
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
            new SceneFlexItem({ ySizing: 'content', body: infoCard }),
            new SceneFlexItem({ ySizing: 'content', body: capacityCard }),
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

function getClusterCpuScene(clusterRegex: string) {
  const cpuTimeSeries = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'cpu',
        expr: `sum by (cluster) (label_join(sum by (cluster, instance) (max by (cluster, instance, cpu, core) (1 - rate(node_cpu_seconds_total{cluster="${clusterRegex}", mode="idle"}[$__rate_interval]) >= 0)) or max by (cluster, instance) (rate(node_cpu_usage_seconds_total{cluster="${clusterRegex}"}[$__rate_interval]) >= 0), "node", ",", "instance"))`,
        legendFormat: 'CPU usage (cores)',
      },
    ],
  });

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

  return new EmbeddedScene({
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
            new SceneFlexItem({
              width: 220,
              ySizing: 'content',
              body: new VariableValueControl({ variableName: NODES_VARIABLE_NAME }),
            }),
            new SceneFlexItem({
              width: 220,
              ySizing: 'content',
              body: new VariableValueControl({ variableName: NAMESPACE_VARIABLE_NAME }),
            }),
            new SceneFlexItem({ body: new SceneControlsSpacer() }),
          ],
        }),
        new SceneFlexLayout({
          direction: 'row',
          children: [
            new SceneFlexItem({ height: 120, body: requestsCapacityPanel }),
            new SceneFlexItem({ height: 120, body: usageCapacityPanel }),
            new SceneFlexItem({ height: 120, body: usageRequestsPanel }),
          ],
        }),
        new SceneFlexItem({ height: 300, body: PanelBuilders.timeseries().setTitle('CPU usage').setUnit('cores').setData(cpuTimeSeries).build() }),
      ],
    }),
  });
}

function getClusterMemoryScene(clusterRegex: string) {
  const memTimeSeries = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'mem',
        expr: `sum by (cluster) (label_join(max by (cluster, instance) (node_memory_Active_file_bytes{cluster="${clusterRegex}"}) + on (cluster, instance) group_left() max by (cluster, instance) (node_memory_AnonPages_bytes{cluster="${clusterRegex}"}) or max by (cluster, instance) (node_memory_working_set_bytes{cluster="${clusterRegex}"}), "node", ",", "instance"))`,
        legendFormat: 'Memory usage (bytes)',
      },
    ],
  });

  return new EmbeddedScene({
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({ height: 300, body: PanelBuilders.timeseries().setTitle('Memory usage').setUnit('bytes').setData(memTimeSeries).build() }),
      ],
    }),
  });
}

function getClusterAlertsScene(clusterRegex: string) {
  const alertsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'alerts',
        expr: `(ALERTS{alertname=~"(Kube.*|CPUThrottlingHigh)", alertstate="firing", cluster="${clusterRegex}"} or GRAFANA_ALERTS{alertname=~"(Kube.*|CPUThrottlingHigh)", alertstate="firing", cluster="${clusterRegex}"})`,
        format: 'table',
        instant: true,
      },
    ],
  });

  const alertsTable = new SceneDataTransformer({
    $data: alertsRunner,
    transformations: [
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, Value: true, __name__: true, cluster: true },
        },
      },
    ],
  });

  return new EmbeddedScene({
    body: new SceneFlexLayout({
      direction: 'column',
      children: [new SceneFlexItem({ height: 300, body: PanelBuilders.table().setTitle('Firing alerts').setData(alertsTable).build() })],
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
    { slug: 'cpu', title: 'CPU', getScene: () => getClusterCpuScene(clusterRegex) },
    { slug: 'memory', title: 'Memory', getScene: () => getClusterMemoryScene(clusterRegex) },
    {
      slug: 'network-storage',
      title: 'Network Storage',
      getScene: () => getComingSoonScene('The network storage tab has not been built yet.'),
    },
    { slug: 'logs', title: 'Logs', getScene: () => getComingSoonScene('The logs tab has not been built yet.') },
    { slug: 'events', title: 'Events', getScene: () => getComingSoonScene('The events tab has not been built yet.') },
    { slug: 'alerts', title: 'Alerts', getScene: () => getClusterAlertsScene(clusterRegex) },
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
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'utc' }),
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
  $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'utc' }),
  $variables: new SceneVariableSet({
    variables: [createThanosDatasourceVariable(), createClusterFilterVariable()],
  }),
  controls: [
    new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
    new SceneControlsSpacer(),
    new SceneTimePicker({}),
    new SceneRefreshPicker({ refresh: '1m' }),
  ],
  preserveUrlKeys: ['from', 'to', 'timezone', 'refresh', `var-${THANOS_VARIABLE_NAME}`, `var-${CLUSTER_VARIABLE_NAME}`],
  drilldowns: [
    {
      routePath: `/:cluster/*`,
      getPage: getClusterDetailPage,
    },
  ],
});

export function getClustersSceneApp() {
  return new SceneApp({
    pages: [clustersPage, getResourceSimulatorPage(), getNamespacesPage(), getWorkloadsPage(), getNodesPage()],
    urlSyncOptions: { updateUrlOnInit: true, createBrowserHistorySteps: true },
  });
}
