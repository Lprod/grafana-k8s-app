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
import { buildWorkloadsListTargets } from '../../queries/workloadQueries';
import { UsageIcon, linkedValueCell, usageColorFromTier } from '../../scenes/tableCells';
import {
  CLUSTER_VARIABLE_NAME,
  NAMESPACE_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createClusterFilterVariable,
  createNamespaceFilterVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';

const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;
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
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, asserts_env: true, asserts_site: true },
          indexByName: {
            cluster: 0,
            namespace: 1,
            workload: 2,
            workload_type: 3,
            'Value #ready_pods': 4,
            'Value #desired_pods': 5,
            'Value #cpu_usage': 6,
            'Value #cpu_requests': 7,
            'Value #cpu_requests_percent': 8,
            'Value #mem_usage': 9,
            'Value #mem_requests': 10,
            'Value #mem_requests_percent': 11,
            'Value #mem_limits': 12,
            'Value #mem_limits_percent': 13,
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
        .matchFieldsWithName('workload')
        .overrideDisplayName('Workload')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('workload_type')
        .overrideDisplayName('Type')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #ready_pods')
        .overrideDisplayName('Ready Pods')
        .overrideUnit('none')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #desired_pods')
        .overrideDisplayName('Desired Pods')
        .overrideUnit('none')
        .overrideCustomFieldConfig('align', 'left')
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

export function getWorkloadsPage() {
  return new SceneAppPage({
    title: 'Workloads',
    titleImg: KUBERNETES_ICON,
    url: WORKLOADS_URL,
    routePath: `/${ROUTES.Workloads}/*`,
    getScene: getWorkloadsListScene,
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
