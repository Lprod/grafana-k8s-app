import React from 'react';
import {
  EmbeddedScene,
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
import { TableCellDisplayMode, ThresholdsMode } from '@grafana/schema';
import { useTheme2 } from '@grafana/ui';
import { PLUGIN_BASE_URL } from '../constants';
import { clusterTableQueries } from '../queries/clusterQueries';
import { buildClusterTableTargets, withClusterFilter } from './queryHelpers';
import {
  CLUSTER_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createClusterFilterVariable,
  createThanosDatasourceVariable,
} from '../variables/datasourceVariables';
import { getResourceSimulatorPage } from '../pages/ResourceSimulator/resourceSimulatorPage';
import { UsageIcon, linkedValueCell, usageColorFromTier } from './tableCells';

const CLUSTERS_URL = `${PLUGIN_BASE_URL}/clusters`;
const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

// green < 50%, yellow 50-80%, red > 80% of capacity used.
const usageThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'green', value: -Infinity },
    { color: 'yellow', value: 0.5 },
    { color: 'red', value: 0.8 },
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
        .overrideLinks([{ title: 'View cluster', url: `${CLUSTERS_URL}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('Value #info')
        .overrideDisplayName('Nodes')
        .overrideUnit('none')
        .overrideCustomFieldConfig('align', 'center')
        .matchFieldsWithName('Value #alerts')
        .overrideDisplayName('Alerts')
        .overrideUnit('none')
        .overrideThresholds(alertsThresholds)
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #cpu_usage_avg')
        .overrideDisplayName('CPU Avg')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #cpu_usage_avg_percent'),
        } as any)
        .matchFieldsWithName('Value #cpu_usage_avg_percent')
        .overrideDisplayName('CPU Avg %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #cpu_usage_max')
        .overrideDisplayName('CPU Max')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #cpu_usage_max_percent'),
        } as any)
        .matchFieldsWithName('Value #cpu_usage_max_percent')
        .overrideDisplayName('CPU Max %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #mem_usage_avg')
        .overrideDisplayName('Mem Avg')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #mem_usage_avg_percent'),
        } as any)
        .matchFieldsWithName('Value #mem_usage_avg_percent')
        .overrideDisplayName('Mem Avg %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #mem_usage_max')
        .overrideDisplayName('Mem Max')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #mem_usage_max_percent'),
        } as any)
        .matchFieldsWithName('Value #mem_usage_max_percent')
        .overrideDisplayName('Mem Max %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
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

function getClusterDetailScene(cluster: string) {
  const clusterRegex = cluster.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const infoRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'info', expr: withClusterFilter(clusterTableQueries.info, clusterRegex), format: 'table', instant: true },
    ],
  });

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

  const infoTable = new SceneDataTransformer({
    $data: infoRunner,
    transformations: [
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, asserts_env: true, asserts_site: true },
          renameByName: { cluster: 'Cluster', provider_id: 'Provider', Value: 'Nodes' },
        },
      },
    ],
  });

  return new EmbeddedScene({
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({ height: 120, body: PanelBuilders.table().setTitle('Cluster information').setData(infoTable).build() }),
        new SceneFlexLayout({
          direction: 'row',
          children: [
            new SceneFlexItem({ height: 300, body: PanelBuilders.timeseries().setTitle('CPU usage').setUnit('cores').setData(cpuTimeSeries).build() }),
            new SceneFlexItem({ height: 300, body: PanelBuilders.timeseries().setTitle('Memory usage').setUnit('bytes').setData(memTimeSeries).build() }),
          ],
        }),
        new SceneFlexItem({ height: 300, body: PanelBuilders.table().setTitle('Firing alerts').setData(alertsTable).build() }),
      ],
    }),
  });
}

function getClusterDetailPage(routeMatch: SceneRouteMatch<{ cluster: string }>, parent: SceneAppPageLike) {
  const cluster = decodeURIComponent(routeMatch.params.cluster);

  return new SceneAppPage({
    title: cluster,
    titleImg: KUBERNETES_ICON,
    url: `${CLUSTERS_URL}/${encodeURIComponent(cluster)}`,
    routePath: `${CLUSTERS_URL}/${encodeURIComponent(cluster)}`,
    getParentPage: () => parent,
    getScene: () => getClusterDetailScene(cluster),
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
    pages: [clustersPage, getResourceSimulatorPage()],
    urlSyncOptions: { updateUrlOnInit: true, createBrowserHistorySteps: true },
  });
}
