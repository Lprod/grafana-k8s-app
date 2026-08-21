import { MappingType, ValueMapping } from '@grafana/data';
import { TableCellDisplayMode } from '@grafana/schema';
import {
  EmbeddedScene,
  PanelBuilders,
  SceneAppPage,
  SceneControlsSpacer,
  SceneDataTransformer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneQueryRunner,
  SceneRefreshPicker,
  SceneTimePicker,
  SceneTimeRange,
  SceneVariableSet,
  VariableValueControl,
} from '@grafana/scenes';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { addActionField, InvestigateActionCell } from './investigateActionCell';
import {
  ALERTNAME_VARIABLE_NAME,
  CLUSTER_VARIABLE_NAME,
  NAMESPACE_VARIABLE_NAME,
  NODES_VARIABLE_NAME,
  POD_VARIABLE_NAME,
  SEVERITY_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createAlertnameFilterVariable,
  createClusterFilterVariable,
  createNamespaceFilterVariable,
  createNodesFilterVariable,
  createPodFilterVariable,
  createSeverityFilterVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';
import { addKubectlField, applyKubectlColumn } from '../../scenes/kubectlCell';
import { applyEntityDrilldownLinks } from '../../scenes/drilldownLinks';

const ALERTS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Alerts}`;
const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

// Value mappings drive the Severity column's colored background: exact
// matches for the known severities, everything else keeps the default
// (uncolored) cell styling since Grafana mappings have no generic "else".
const severityMappings: ValueMapping[] = [
  {
    type: MappingType.ValueToText,
    options: {
      info: { color: 'blue', index: 0 },
      warning: { color: 'yellow', index: 1 },
      critical: { color: 'red', index: 2 },
      none: { color: 'gray', index: 3 },
    },
  },
];

function getAlertsScene() {
  const clusterRegex = `\${${CLUSTER_VARIABLE_NAME}:regex}`;
  const namespaceRegex = `\${${NAMESPACE_VARIABLE_NAME}:regex}`;
  const nodeRegex = `\${${NODES_VARIABLE_NAME}:regex}`;
  const podRegex = `\${${POD_VARIABLE_NAME}:regex}`;
  const severityRegex = `\${${SEVERITY_VARIABLE_NAME}:regex}`;
  const alertnameRegex = `\${${ALERTNAME_VARIABLE_NAME}:regex}`;
  // ALERTS carries "node"/"pod" directly on whichever alerts are actually
  // node-/pod-scoped (same as cluster/namespace/severity/alertname) - no
  // join needed, unlike a hypothetical "workload" filter (ALERTS has no
  // such label of its own; see createWorkloadFilterVariable's own comment
  // on why that needs a separate join query instead of a plain selector -
  // deliberately not added here to avoid silently dropping alerts that
  // don't happen to have a matching pod-ownership record).
  const commonFilters = `cluster=~"${clusterRegex}", namespace=~"${namespaceRegex}", node=~"${nodeRegex}", pod=~"${podRegex}", severity=~"${severityRegex}", alertname!~"ArgoCDSyncAlert"`;

  const firingByClusterRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'firing',
        expr: `count by(cluster) (ALERTS{alertstate="firing", ${commonFilters}})`,
        legendFormat: '{{cluster}}',
      },
    ],
  });

  const firingByClusterPanel = PanelBuilders.timeseries()
    .setTitle('Firing alerts by cluster')
    .setUnit('short')
    .setData(firingByClusterRunner)
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const firingByNamespaceRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'firing',
        expr: `count by(namespace) (ALERTS{alertstate="firing", ${commonFilters}})`,
        legendFormat: '{{namespace}}',
      },
    ],
  });

  const firingByNamespacePanel = PanelBuilders.timeseries()
    .setTitle('Firing alerts by namespace')
    .setUnit('short')
    .setData(firingByNamespaceRunner)
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const severityRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'firing',
        expr: `count by(severity) (ALERTS{alertstate="firing", ${commonFilters}})`,
        legendFormat: '{{severity}}',
      },
    ],
  });

  const severityPanel = PanelBuilders.timeseries()
    .setTitle('Alert severity')
    .setUnit('short')
    .setData(severityRunner)
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  // ALERTS carries no "workload" label of its own, but the POD column's link
  // has to point at the Pod Drilldown, whose route is nested under its owning
  // workload (/workloads/:cluster/:namespace/:workloadType/:workload/pods/:pod).
  // Three mutually-exclusive branches (mutually exclusive so `or` can't
  // duplicate a row - `or` only drops a right-hand series whose label set
  // matches the left *exactly*, which the added workload labels would defeat):
  //   1. pod-scoped alerts whose pod has an ownership record - workload/
  //      workload_type joined on, same existence-join idiom every pod-level
  //      issue query on the Kubernetes home page uses.
  //   2. pod-scoped alerts whose pod has none (bare/standalone pods, static
  //      pods) - workload derived from the pod's own name with
  //      workload_type="pod", the same bare-pod fallback
  //      kubernetesTopStatQueries.workloads uses. Without this the POD link
  //      would resolve to a URL with empty workload segments.
  //   3. node-/cluster-level alerts, which have no `pod` label at all - passed
  //      through untouched so the join can't silently drop them.
  const alertsFilters = `alertstate="firing", ${commonFilters}, alertname=~"${alertnameRegex}"`;
  const podAlerts = `ALERTS{${alertsFilters}, pod!=""}`;
  const nonPodAlerts = `ALERTS{${alertsFilters}, pod=""}`;
  const podOwner = `namespace_workload_pod:kube_pod_owner:relabel{cluster=~"${clusterRegex}"}`;
  const ownedPodAlerts = `(${podAlerts} * on (cluster, namespace, pod) group_left (workload, workload_type) ${podOwner})`;
  const unownedPodAlerts = `label_replace(label_replace(${podAlerts} unless on (cluster, namespace, pod) (${podOwner}), "workload", "$1", "pod", "(.+)"), "workload_type", "pod", "", "")`;

  const alertsTableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'alerts',
        expr: `${ownedPodAlerts} or ${unownedPodAlerts} or ${nonPodAlerts}`,
        format: 'table',
        instant: true,
      },
    ],
  });

  const alertsTableData = new SceneDataTransformer({
    $data: alertsTableRunner,
    transformations: [
      {
        id: 'filterFieldsByName',
        options: {
          include: {
            names: [
              'cluster',
              'severity',
              'alertname',
              'node',
              'namespace',
              'pod',
              'workload',
              'workload_type',
              'container',
              'endpoint',
              'instance',
              'job',
            ],
          },
        },
      },
      addActionField,
      addKubectlField,
      {
        id: 'organize',
        options: {
          // Action goes first, not last: it hosts the "Investigate" button
          // (this page's whole Assistant integration) and this table is wide
          // enough to scroll horizontally on a normal screen, which used to
          // leave the button permanently off-screen to the right.
          indexByName: {
            action: 0,
            kubectl: 1,
            cluster: 2,
            severity: 3,
            alertname: 4,
            node: 5,
            namespace: 6,
            pod: 7,
            workload: 8,
            workload_type: 9,
            container: 10,
            endpoint: 11,
            instance: 12,
            job: 13,
          },
          renameByName: {
            cluster: 'CLUSTER',
            severity: 'SEVERITY',
            alertname: 'ALERTNAME',
            node: 'NODE',
            namespace: 'NAMESPACE',
            pod: 'POD',
            workload: 'WORKLOAD',
            workload_type: 'TYPE',
            container: 'CONTAINER',
            endpoint: 'ENDPOINT',
            instance: 'INSTANCE',
            job: 'JOB',
            action: 'Action',
          },
        },
      },
    ],
  });

  const alertsTable = PanelBuilders.table()
    .setTitle('Firing Alerts at ${__to:date:YYYY-MM-DD HH-mm-ss}')
    .setData(alertsTableData)
    // Icon-only kubectl column sits next to Investigate as the second half
    // of the same "act on this alert" pair.
    .setOverrides((b) =>
      applyKubectlColumn(applyEntityDrilldownLinks(b))
        // workload_type only exists as a column because the POD/WORKLOAD links
        // need it to build their URL (it can't be dropped from the frame and
        // still be readable by a `${__data.fields.workload_type}` macro, and
        // custom.hideFrom is a no-op on the Table panel - see the project's
        // own notes on that). Kept narrow so it costs as little width as
        // possible in an already-wide table.
        .matchFieldsWithName('workload_type')
        .overrideCustomFieldConfig('width', 90)
        .matchFieldsWithName('SEVERITY')
        .overrideMappings(severityMappings)
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorBackground })
        .matchFieldsWithName('Action')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: InvestigateActionCell,
        } as any)
        .overrideCustomFieldConfig('width', 120)

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
            new SceneFlexItem({ height: 300, body: firingByClusterPanel }),
            new SceneFlexItem({ height: 300, body: firingByNamespacePanel }),
            new SceneFlexItem({ height: 300, body: severityPanel }),
          ],
        }),
        new SceneFlexItem({ height: 400, body: alertsTable }),
      ],
    }),
  });
}

export function getAlertsPage() {
  return new SceneAppPage({
    title: 'Alerts',
    titleImg: KUBERNETES_ICON,
    url: ALERTS_URL,
    routePath: `/${ROUTES.Alerts}/*`,
    getScene: getAlertsScene,
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'browser' }),
    $variables: new SceneVariableSet({
      variables: [
        createThanosDatasourceVariable(),
        createClusterFilterVariable(),
        createNodesFilterVariable(`\${${CLUSTER_VARIABLE_NAME}:regex}`),
        createNamespaceFilterVariable(),
        createPodFilterVariable(`\${${CLUSTER_VARIABLE_NAME}:regex}`, `\${${NAMESPACE_VARIABLE_NAME}:regex}`),
        createSeverityFilterVariable(),
        createAlertnameFilterVariable(),
      ],
    }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new VariableValueControl({ variableName: CLUSTER_VARIABLE_NAME }),
      new VariableValueControl({ variableName: NODES_VARIABLE_NAME }),
      new VariableValueControl({ variableName: NAMESPACE_VARIABLE_NAME }),
      new VariableValueControl({ variableName: POD_VARIABLE_NAME }),
      new VariableValueControl({ variableName: SEVERITY_VARIABLE_NAME }),
      new VariableValueControl({ variableName: ALERTNAME_VARIABLE_NAME }),
      new SceneControlsSpacer(),
      new SceneTimePicker({}),
      new SceneRefreshPicker({ refresh: '1m' }),
    ],
    // Deliberately excludes the filter variables - see the same note in
    // namespacesPage.ts.
    preserveUrlKeys: ['from', 'to', 'timezone', 'refresh', `var-${THANOS_VARIABLE_NAME}`],
  });
}
