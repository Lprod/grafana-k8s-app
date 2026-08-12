import React from 'react';
import {
  EmbeddedScene,
  PanelBuilders,
  SceneAppPage,
  SceneControlsSpacer,
  SceneDataTransformer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneQueryRunner,
  SceneReactObject,
  SceneRefreshPicker,
  SceneTimePicker,
  SceneTimeRange,
  SceneVariableSet,
  VariableValueControl,
} from '@grafana/scenes';
import { TableCellDisplayMode, ThresholdsMode } from '@grafana/schema';
import { useTheme2 } from '@grafana/ui';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { buildNamespacesListTargets } from '../../queries/namespaceQueries';
import { UsageIcon, linkedValueCell, usageColorFromTier } from '../../scenes/tableCells';
import {
  CLUSTER_VARIABLE_NAME,
  NAMESPACE_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createClusterFilterVariable,
  createNamespaceFilterVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';

const NAMESPACES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Namespaces}`;
const CLUSTERS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Clusters}`;
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
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true },
          indexByName: {
            cluster: 0,
            namespace: 1,
            'Value #info': 2,
            'Value #alerts': 3,
            'Value #cpu_usage': 4,
            'Value #cpu_requests': 5,
            'Value #cpu_requests_percent': 6,
            'Value #mem_usage': 7,
            'Value #mem_requests': 8,
            'Value #mem_requests_percent': 9,
            'Value #mem_limits': 10,
            'Value #mem_limits_percent': 11,
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
        .matchFieldsWithName('Value #cpu_requests')
        .overrideDisplayName('CPU Requests')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #cpu_requests_percent'),
        } as any)
        .matchFieldsWithName('Value #cpu_requests_percent')
        .overrideDisplayName('CPU Requests %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #mem_usage')
        .overrideDisplayName('Mem Usage')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #mem_requests')
        .overrideDisplayName('Mem Requests')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #mem_requests_percent'),
        } as any)
        .matchFieldsWithName('Value #mem_requests_percent')
        .overrideDisplayName('Mem Requests %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #mem_limits')
        .overrideDisplayName('Mem Limits')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #mem_limits_percent'),
        } as any)
        .matchFieldsWithName('Value #mem_limits_percent')
        .overrideDisplayName('Mem Limits %')
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

export function getNamespacesPage() {
  return new SceneAppPage({
    title: 'Namespaces',
    titleImg: KUBERNETES_ICON,
    url: NAMESPACES_URL,
    routePath: `/${ROUTES.Namespaces}/*`,
    getScene: getNamespacesListScene,
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'utc' }),
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
  });
}
