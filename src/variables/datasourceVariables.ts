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
export const NODES_VARIABLE_NAME = 'nodes';
export const SEVERITY_VARIABLE_NAME = 'severity';
export const ALERTNAME_VARIABLE_NAME = 'alertname';

// SceneAppPage's `$variables` are constructed eagerly (unlike the lazily
// invoked `getScene` factory) for EVERY top-level page at once, as soon as
// `getClustersSceneApp()` runs - not just for whichever page the user is
// actually navigating to. So when several top-level pages each declare
// their own same-named variable (e.g. every top-level page has its own
// "cluster"), Scenes' URL-key deduplication silently renames every page but
// the first-registered one to "-2"/"-3" etc in the whole scene graph, and a
// cross-page link's plain `var-cluster=...` query param lands on a
// suffixed key nothing reads, leaving the destination page showing "All".
//
// The fix must NOT read this from the constructor: on a hard reload landing
// directly on, say, Alerts with `?var-cluster=demo-cluster-aws`, every
// top-level page's variable is constructed at that same instant and would
// ALL see that query param - including Clusters, Namespaces etc, which the
// user never visited. That value then sits latent in memory and leaks back
// out the next time the user navigates to one of those other pages (via
// Scenes' own url sync re-serializing whatever the variable currently
// holds). Only reacting on *activation* - which fires when a page's own
// variable set actually mounts as the active page, not merely once
// constructed - correctly scopes the fix to the page actually being viewed.
function initialValueFromUrl(variableName: string): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return new URLSearchParams(window.location.search).get(`var-${variableName}`) ?? undefined;
}

function syncValueFromUrlOnActivation(variable: QueryVariable, variableName: string): QueryVariable {
  variable.addActivationHandler(() => {
    const urlValue = initialValueFromUrl(variableName);
    if (urlValue !== undefined) {
      variable.changeValueTo(urlValue);
    }
  });
  return variable;
}

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
  const variable = new QueryVariable({
    name: CLUSTER_VARIABLE_NAME,
    label: 'Cluster',
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    query: { refId: 'clusterVariableQuery', query: 'label_values(kube_node_info, cluster)' },
    isMulti,
    includeAll: isMulti,
    allValue: isMulti ? '.+' : undefined,
    value: isMulti ? '$__all' : '',
  });
  return syncValueFromUrlOnActivation(variable, CLUSTER_VARIABLE_NAME);
}

// clusterRegex defaults to referencing the scene-level "cluster" variable,
// but pages without one (e.g. the cluster detail page, scoped to a single
// cluster via the drilldown route) can pass the literal cluster name/regex.
export function createNamespaceFilterVariable(options: { isMulti?: boolean; clusterRegex?: string } = {}) {
  const isMulti = options.isMulti ?? true;
  const clusterRegex = options.clusterRegex ?? `\${${CLUSTER_VARIABLE_NAME}:regex}`;
  const variable = new QueryVariable({
    name: NAMESPACE_VARIABLE_NAME,
    label: 'Namespace',
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    query: {
      refId: 'namespaceVariableQuery',
      query: `label_values(kube_namespace_status_phase{cluster=~"${clusterRegex}"}, namespace)`,
    },
    isMulti,
    includeAll: isMulti,
    allValue: isMulti ? '.+' : undefined,
    value: isMulti ? '$__all' : '',
  });
  return syncValueFromUrlOnActivation(variable, NAMESPACE_VARIABLE_NAME);
}

// Unlike the other filter variables, the cluster detail page doesn't have a
// scene-level "cluster" variable to reference (it's scoped to one cluster by
// the drilldown route) - so the cluster is inlined directly into the query.
export function createNodesFilterVariable(clusterRegex: string, options: { isMulti?: boolean } = {}) {
  const isMulti = options.isMulti ?? true;
  const variable = new QueryVariable({
    name: NODES_VARIABLE_NAME,
    label: 'Node',
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    query: {
      refId: 'nodesVariableQuery',
      query: `label_values(kube_node_info{cluster=~"${clusterRegex}"}, node)`,
    },
    isMulti,
    includeAll: isMulti,
    allValue: isMulti ? '.+' : undefined,
    value: isMulti ? '$__all' : '',
  });
  return syncValueFromUrlOnActivation(variable, NODES_VARIABLE_NAME);
}

export function createSeverityFilterVariable(options: { isMulti?: boolean } = {}) {
  const isMulti = options.isMulti ?? true;
  const variable = new QueryVariable({
    name: SEVERITY_VARIABLE_NAME,
    label: 'Severity',
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    query: {
      refId: 'severityVariableQuery',
      query: `label_values(ALERTS{cluster=~"\${${CLUSTER_VARIABLE_NAME}:regex}"}, severity)`,
    },
    isMulti,
    includeAll: isMulti,
    allValue: isMulti ? '.+' : undefined,
    value: isMulti ? '$__all' : '',
  });
  return syncValueFromUrlOnActivation(variable, SEVERITY_VARIABLE_NAME);
}

export function createAlertnameFilterVariable(options: { isMulti?: boolean } = {}) {
  const isMulti = options.isMulti ?? true;
  const variable = new QueryVariable({
    name: ALERTNAME_VARIABLE_NAME,
    label: 'Alert name',
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    query: {
      refId: 'alertnameVariableQuery',
      query: `label_values(ALERTS{cluster=~"\${${CLUSTER_VARIABLE_NAME}:regex}"}, alertname)`,
    },
    isMulti,
    includeAll: isMulti,
    allValue: isMulti ? '.+' : undefined,
    value: isMulti ? '$__all' : '',
  });
  return syncValueFromUrlOnActivation(variable, ALERTNAME_VARIABLE_NAME);
}

export function createWorkloadFilterVariable(options: { isMulti?: boolean } = {}) {
  const isMulti = options.isMulti ?? true;
  const variable = new QueryVariable({
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
  return syncValueFromUrlOnActivation(variable, WORKLOAD_VARIABLE_NAME);
}
