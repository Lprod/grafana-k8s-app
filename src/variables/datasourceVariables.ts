import { DataSourceVariable, QueryVariable } from '@grafana/scenes';
import { getDatasourceDefaults } from '../utils/appJsonData';

// Thanos is exposed to Grafana as a Prometheus-compatible datasource, so we
// pick from all configured "prometheus" datasources (Thanos included).
export const THANOS_VARIABLE_NAME = 'datasource';
export const ELASTIC_VARIABLE_NAME = 'elasticsearch';
export const RQLITE_VARIABLE_NAME = 'infraDatasource';
export const CLUSTER_VARIABLE_NAME = 'cluster';
export const NAMESPACE_VARIABLE_NAME = 'namespace';
export const WORKLOAD_VARIABLE_NAME = 'workload';

export function createThanosDatasourceVariable() {
  return new DataSourceVariable({
    name: THANOS_VARIABLE_NAME,
    label: 'Data source',
    pluginId: 'prometheus',
    value: getDatasourceDefaults().prometheusUid,
  });
}

export function createElasticDatasourceVariable() {
  return new DataSourceVariable({
    name: ELASTIC_VARIABLE_NAME,
    label: 'Logs',
    pluginId: 'elasticsearch',
    value: getDatasourceDefaults().elasticsearchUid,
  });
}

export function createRqliteDatasourceVariable() {
  return new DataSourceVariable({
    name: RQLITE_VARIABLE_NAME,
    label: 'Infra metadata',
    pluginId: 'g42-rqlite-datasource',
    value: getDatasourceDefaults().infraUid,
  });
}

export function createClusterFilterVariable(options: { isMulti?: boolean } = {}) {
  const isMulti = options.isMulti ?? true;
  return new QueryVariable({
    name: CLUSTER_VARIABLE_NAME,
    label: 'Cluster',
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    query: { refId: 'clusterVariableQuery', query: 'label_values(kube_node_info, cluster)' },
    isMulti,
    includeAll: isMulti,
    allValue: isMulti ? '.+' : undefined,
    value: isMulti ? '$__all' : '',
  });
}

export function createNamespaceFilterVariable(options: { isMulti?: boolean } = {}) {
  const isMulti = options.isMulti ?? true;
  return new QueryVariable({
    name: NAMESPACE_VARIABLE_NAME,
    label: 'Namespace',
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    query: {
      refId: 'namespaceVariableQuery',
      query: `label_values(kube_namespace_status_phase{cluster=~"\${${CLUSTER_VARIABLE_NAME}:regex}"}, namespace)`,
    },
    isMulti,
    includeAll: isMulti,
    allValue: isMulti ? '.+' : undefined,
    value: isMulti ? '$__all' : '',
  });
}

export function createWorkloadFilterVariable(options: { isMulti?: boolean } = {}) {
  const isMulti = options.isMulti ?? true;
  return new QueryVariable({
    name: WORKLOAD_VARIABLE_NAME,
    label: 'Workload',
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    query: {
      refId: 'workloadVariableQuery',
      query: `label_values(kube_pod_owner{cluster=~"\${${CLUSTER_VARIABLE_NAME}:regex}", namespace=~"\${${NAMESPACE_VARIABLE_NAME}:regex}"}, owner_name)`,
    },
    isMulti,
    includeAll: isMulti,
    allValue: isMulti ? '.+' : undefined,
    value: isMulti ? '$__all' : '',
  });
}
