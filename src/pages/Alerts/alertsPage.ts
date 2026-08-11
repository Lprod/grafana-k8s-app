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
import { addActionField, InvestigateActionCell } from './investigateActionCell';
import {
  ALERTNAME_VARIABLE_NAME,
  CLUSTER_VARIABLE_NAME,
  NAMESPACE_VARIABLE_NAME,
  NODES_VARIABLE_NAME,
  SEVERITY_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createAlertnameFilterVariable,
  createClusterFilterVariable,
  createNamespaceFilterVariable,
  createNodesFilterVariable,
  createSeverityFilterVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';

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
  const severityRegex = `\${${SEVERITY_VARIABLE_NAME}:regex}`;
  const alertnameRegex = `\${${ALERTNAME_VARIABLE_NAME}:regex}`;

  const firingByClusterRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'firing',
        expr: `count by(cluster) (ALERTS{alertstate="firing", cluster=~"${clusterRegex}", severity=~"${severityRegex}", namespace=~"${namespaceRegex}", alertname!~"ArgoCDSyncAlert"})`,
        legendFormat: '{{cluster}}',
      },
    ],
  });

  const firingByClusterPanel = PanelBuilders.timeseries()
    .setTitle('Firing alerts by cluster')
    .setUnit('short')
    .setData(firingByClusterRunner)
    .build();

  const firingByNamespaceRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'firing',
        expr: `count by(namespace) (ALERTS{alertstate="firing", cluster=~"${clusterRegex}", severity=~"${severityRegex}", namespace=~"${namespaceRegex}", alertname!~"ArgoCDSyncAlert"})`,
        legendFormat: '{{namespace}}',
      },
    ],
  });

  const firingByNamespacePanel = PanelBuilders.timeseries()
    .setTitle('Firing alerts by namespace')
    .setUnit('short')
    .setData(firingByNamespaceRunner)
    .build();

  const severityRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'firing',
        expr: `count by(severity) (ALERTS{alertstate="firing", cluster=~"${clusterRegex}", severity=~"${severityRegex}", namespace=~"${namespaceRegex}", alertname!~"ArgoCDSyncAlert"})`,
        legendFormat: '{{severity}}',
      },
    ],
  });

  const severityPanel = PanelBuilders.timeseries().setTitle('Alert severity').setUnit('short').setData(severityRunner).build();

  const alertsTableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      {
        refId: 'alerts',
        expr: `ALERTS{alertstate="firing", cluster=~"${clusterRegex}", namespace=~"${namespaceRegex}", severity=~"${severityRegex}", alertname=~"${alertnameRegex}", alertname!~"ArgoCDSyncAlert"}`,
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
          include: { names: ['cluster', 'severity', 'alertname', 'namespace', 'pod', 'container', 'endpoint', 'instance', 'job'] },
        },
      },
      addActionField,
      {
        id: 'organize',
        options: {
          indexByName: {
            cluster: 0,
            severity: 1,
            alertname: 2,
            namespace: 3,
            pod: 4,
            container: 5,
            endpoint: 6,
            instance: 7,
            job: 8,
            action: 9,
          },
          renameByName: {
            cluster: 'CLUSTER',
            severity: 'SEVERITY',
            alertname: 'ALERTNAME',
            namespace: 'NAMESPACE',
            pod: 'POD',
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
    .setOverrides((b) =>
      b
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
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'utc' }),
    $variables: new SceneVariableSet({
      variables: [
        createThanosDatasourceVariable(),
        createClusterFilterVariable(),
        createNodesFilterVariable(`\${${CLUSTER_VARIABLE_NAME}:regex}`),
        createNamespaceFilterVariable(),
        createSeverityFilterVariable(),
        createAlertnameFilterVariable(),
      ],
    }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new VariableValueControl({ variableName: CLUSTER_VARIABLE_NAME }),
      new VariableValueControl({ variableName: NODES_VARIABLE_NAME }),
      new VariableValueControl({ variableName: NAMESPACE_VARIABLE_NAME }),
      new VariableValueControl({ variableName: SEVERITY_VARIABLE_NAME }),
      new VariableValueControl({ variableName: ALERTNAME_VARIABLE_NAME }),
      new SceneControlsSpacer(),
      new SceneTimePicker({}),
      new SceneRefreshPicker({ refresh: '1m' }),
    ],
    preserveUrlKeys: [
      'from',
      'to',
      'timezone',
      'refresh',
      `var-${THANOS_VARIABLE_NAME}`,
      `var-${CLUSTER_VARIABLE_NAME}`,
      `var-${NODES_VARIABLE_NAME}`,
      `var-${NAMESPACE_VARIABLE_NAME}`,
      `var-${SEVERITY_VARIABLE_NAME}`,
      `var-${ALERTNAME_VARIABLE_NAME}`,
    ],
  });
}
