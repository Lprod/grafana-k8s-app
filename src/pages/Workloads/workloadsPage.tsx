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
import { TableCellDisplayMode } from '@grafana/schema';
import { useTheme2 } from '@grafana/ui';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { buildWorkloadsListTargets } from '../../queries/workloadQueries';
import {
  UsageIcon,
  attachDesiredPodsField,
  attachPercentField,
  readyDesiredPodsCell,
  requestUsageCell,
  usageColorFromTier,
  usageTierCell,
} from '../../scenes/tableCells';
import {
  CLUSTER_VARIABLE_NAME,
  NAMESPACE_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  WORKLOAD_VARIABLE_NAME,
  createClusterFilterVariable,
  createNamespaceFilterVariable,
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
  });
}
