import { DataSourceVariable, QueryVariable } from '@grafana/scenes';
import { getDatasourceDefaults } from '../utils/appJsonData';
import { substituteClusterAndNamespace, workloadTableQueries } from '../queries/workloadQueries';

// Thanos is exposed to Grafana as a Prometheus-compatible datasource, so we
// pick from all configured "prometheus" datasources (Thanos included).
export const THANOS_VARIABLE_NAME = 'datasource';
export const ELASTIC_VARIABLE_NAME = 'elasticsearch';
export const LOGS_DATASOURCE_VARIABLE_NAME = 'logsDatasource';
export const RQLITE_VARIABLE_NAME = 'infraDatasource';
export const CLUSTER_VARIABLE_NAME = 'cluster';
export const NAMESPACE_VARIABLE_NAME = 'namespace';
export const WORKLOAD_VARIABLE_NAME = 'workload';
export const NODES_VARIABLE_NAME = 'nodes';
export const POD_VARIABLE_NAME = 'pod';
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

// The org runs many Elasticsearch datasource instances, but only these
// three hold the k8s-application log/event indices the Namespace
// Drilldown's Logs/Events panels query. DataSourceVariable's own `regex`
// state field filters its resolved option list down to just these, matched
// against each datasource's *name* (see DataSourceVariable's isValid(),
// which runs `regex.exec(source.name)` - not the uid).
const LOGS_DATASOURCE_NAMES = [
  'Elasticsearch Elastic Prod Debeka Cloud',
  'Elasticsearch Elastic Tech Debeka Cloud',
  'Elasticsearch Logmanagement Prod Main',
];

function exactNameMatchRegex(names: string[]): string {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `/^(${escaped.join('|')})$/`;
}

export function createLogsDatasourceVariable() {
  return new DataSourceVariable({
    name: LOGS_DATASOURCE_VARIABLE_NAME,
    label: 'Logs data source',
    pluginId: 'elasticsearch',
    regex: exactNameMatchRegex(LOGS_DATASOURCE_NAMES),
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
    // ".*" not ".+": these values feed a `label=~"$var:regex"` selector on a
    // metric where the label isn't guaranteed present on every series (e.g.
    // ALERTS doesn't carry "namespace" on every cluster/node-level alert,
    // or "severity" on every custom alerting rule) - ".+" requires at least
    // one character, so it silently excludes label-absent series even with
    // "All" selected, while ".*" (zero or more) matches those too. Confirmed
    // live against Prometheus: adding a plain `node=~".+"` filter dropped an
    // alert with no "node" label entirely, even though "All" should mean no
    // filtering at all.
    allValue: isMulti ? '.*' : undefined,
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
    // ".*" not ".+": these values feed a `label=~"$var:regex"` selector on a
    // metric where the label isn't guaranteed present on every series (e.g.
    // ALERTS doesn't carry "namespace" on every cluster/node-level alert,
    // or "severity" on every custom alerting rule) - ".+" requires at least
    // one character, so it silently excludes label-absent series even with
    // "All" selected, while ".*" (zero or more) matches those too. Confirmed
    // live against Prometheus: adding a plain `node=~".+"` filter dropped an
    // alert with no "node" label entirely, even though "All" should mean no
    // filtering at all.
    allValue: isMulti ? '.*' : undefined,
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
    // ".*" not ".+": these values feed a `label=~"$var:regex"` selector on a
    // metric where the label isn't guaranteed present on every series (e.g.
    // ALERTS doesn't carry "namespace" on every cluster/node-level alert,
    // or "severity" on every custom alerting rule) - ".+" requires at least
    // one character, so it silently excludes label-absent series even with
    // "All" selected, while ".*" (zero or more) matches those too. Confirmed
    // live against Prometheus: adding a plain `node=~".+"` filter dropped an
    // alert with no "node" label entirely, even though "All" should mean no
    // filtering at all.
    allValue: isMulti ? '.*' : undefined,
    value: isMulti ? '$__all' : '',
  });
  return syncValueFromUrlOnActivation(variable, NODES_VARIABLE_NAME);
}

// Same "literal cluster/namespace inlined, no scene-level variable to
// reference" reasoning as createNodesFilterVariable - the Namespace
// Drilldown's CPU tab is scoped to a single cluster+namespace via its own
// drilldown route params, not a picker.
//
// `workload` (exact name, not a regex) narrows this further to just one
// workload's own pods, via the same namespace_workload_pod:kube_pod_owner:relabel
// join workloadTableQueries.ts's own ready_pods/desired_pods use - kube_pod_info
// (the plain namespace-wide query below) has no "workload" label of its own.
// The Workload Drilldown Overview tab uses this to build a hidden pod
// variable (every pod belonging to its one workload) rather than a picker.
export function createPodFilterVariable(
  clusterRegex: string,
  namespaceRegex: string,
  options: { isMulti?: boolean; workload?: string } = {}
) {
  const isMulti = options.isMulti ?? true;
  const query = options.workload
    ? `label_values(namespace_workload_pod:kube_pod_owner:relabel{cluster="${clusterRegex}", namespace="${namespaceRegex}", workload="${options.workload}"}, pod)`
    : `label_values(kube_pod_info{cluster="${clusterRegex}", namespace="${namespaceRegex}"}, pod)`;
  const variable = new QueryVariable({
    name: POD_VARIABLE_NAME,
    label: 'Pod',
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    query: { refId: 'podVariableQuery', query },
    isMulti,
    includeAll: isMulti,
    // A hardcoded ".+" allValue makes "${pod:regex}" match *every* pod in the
    // namespace once "All" is selected, regardless of what the query above
    // actually returned - fine for the no-workload case (every caller today
    // always passes `workload`, so this branch is currently unused, but kept
    // for a hypothetical future namespace-wide picker), but it silently
    // defeats the workload-scoped query's own filtering: every CPU/Memory/
    // Network/Storage/Overview tab's hidden pod variable defaults to "All"
    // (`value: '$__all'` below), so every one of their $pod-filtered queries
    // was actually matching every pod in the *namespace*, not just this
    // workload's own pods - the Overview/Memory tabs' own "Pods" tables
    // showed it directly since their non-workload-joined queries (cpuUsage,
    // memUsage, memRequests, memLimits, infoWaiting) have no other filter to
    // fall back on; the CPU tab's own table only looked correct because its
    // queries also carry a redundant `* on (...) group_left(...)
    // namespace_workload_pod:kube_pod_owner:relabel{...workload=~"$workload"}`
    // join of their own, masking the broken variable. Leaving `allValue`
    // undefined here makes Grafana build "All" from the query's own
    // (already workload-scoped) result list instead.
    // ".*" not ".+" for the same "label isn't guaranteed present on every
    // series" reason as every other filter variable's own allValue here -
    // e.g. the Alerts page's own Pod filter (this branch) runs against
    // ALERTS, which doesn't carry "pod" on every cluster/node-level alert.
    allValue: isMulti && !options.workload ? '.*' : undefined,
    value: isMulti ? '$__all' : '',
  });
  return syncValueFromUrlOnActivation(variable, POD_VARIABLE_NAME);
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
    // ".*" not ".+": these values feed a `label=~"$var:regex"` selector on a
    // metric where the label isn't guaranteed present on every series (e.g.
    // ALERTS doesn't carry "namespace" on every cluster/node-level alert,
    // or "severity" on every custom alerting rule) - ".+" requires at least
    // one character, so it silently excludes label-absent series even with
    // "All" selected, while ".*" (zero or more) matches those too. Confirmed
    // live against Prometheus: adding a plain `node=~".+"` filter dropped an
    // alert with no "node" label entirely, even though "All" should mean no
    // filtering at all.
    allValue: isMulti ? '.*' : undefined,
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
    // ".*" not ".+": these values feed a `label=~"$var:regex"` selector on a
    // metric where the label isn't guaranteed present on every series (e.g.
    // ALERTS doesn't carry "namespace" on every cluster/node-level alert,
    // or "severity" on every custom alerting rule) - ".+" requires at least
    // one character, so it silently excludes label-absent series even with
    // "All" selected, while ".*" (zero or more) matches those too. Confirmed
    // live against Prometheus: adding a plain `node=~".+"` filter dropped an
    // alert with no "node" label entirely, even though "All" should mean no
    // filtering at all.
    allValue: isMulti ? '.*' : undefined,
    value: isMulti ? '$__all' : '',
  });
  return syncValueFromUrlOnActivation(variable, ALERTNAME_VARIABLE_NAME);
}

// clusterRegex/namespaceRegex default to referencing the scene-level
// "cluster"/"namespace" variables, but pages without those (e.g. the
// Namespace Drilldown's CPU/Memory tabs, scoped to a single cluster+
// namespace via the drilldown route) can pass literal overrides - same
// "optional literal override" pattern as createNamespaceFilterVariable's
// own clusterRegex option.
export function createWorkloadFilterVariable(options: { isMulti?: boolean; clusterRegex?: string; namespaceRegex?: string } = {}) {
  const isMulti = options.isMulti ?? true;
  const clusterRegex = options.clusterRegex ?? `\${${CLUSTER_VARIABLE_NAME}:regex}`;
  const namespaceRegex = options.namespaceRegex ?? `\${${NAMESPACE_VARIABLE_NAME}:regex}`;
  // kube_pod_owner{owner_name=...} (the previous source here) only carries
  // owner_name for pods WITHOUT an owner (bare pods) - every other workload
  // type gets its "workload" label from a different source metric via
  // label_replace (see workloadTableQueries.ready_pods), so that query
  // always came back empty except for bare pods. Reusing ready_pods itself
  // guarantees this variable's options match exactly what the Workloads
  // table's own "workload" column can show, however it's derived.
  //
  // Can't use `label_values(<expr>, workload)` for that: Grafana sends
  // <expr> as Prometheus's `match[]` parameter (a GET to
  // /api/v1/label/workload/values?match[]=<expr>), and match[] only accepts
  // a plain series selector - not an expression with aggregations,
  // label_replace, or the `OR`/`*`/`group_left` this one has ("invalid
  // parameter \"match[]\": ... unexpected \"(\""). `query_result(<expr>)`
  // runs it as a normal instant query via /api/v1/query instead, which has
  // no such restriction (verified directly against Prometheus) - but only
  // if Grafana actually recognizes the `query_result(...)` wrapper: its
  // detection regex doesn't span newlines, and ready_pods is a formatted
  // multi-line expression with `#`-comments, so left as-is Grafana failed
  // to match the wrapper and sent the whole literal string (including the
  // "query_result(" text) to match[] again, same failure as label_values.
  // Comments are stripped and every line joined with spaces first - once
  // it's single-line, Grafana correctly treats it as an instant query and
  // the regex below pulls the "workload" label out of each result series.
  const toSingleLinePromQL = (expr: string) =>
    expr
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter(Boolean)
      .join(' ');
  const readyPodsExpr = toSingleLinePromQL(substituteClusterAndNamespace(workloadTableQueries.ready_pods, clusterRegex, namespaceRegex));
  const variable = new QueryVariable({
    name: WORKLOAD_VARIABLE_NAME,
    label: 'Workload',
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    query: {
      refId: 'workloadVariableQuery',
      query: `query_result(${readyPodsExpr})`,
    },
    regex: '/workload="([^"]+)"/',
    isMulti,
    includeAll: isMulti,
    // ".*" not ".+": these values feed a `label=~"$var:regex"` selector on a
    // metric where the label isn't guaranteed present on every series (e.g.
    // ALERTS doesn't carry "namespace" on every cluster/node-level alert,
    // or "severity" on every custom alerting rule) - ".+" requires at least
    // one character, so it silently excludes label-absent series even with
    // "All" selected, while ".*" (zero or more) matches those too. Confirmed
    // live against Prometheus: adding a plain `node=~".+"` filter dropped an
    // alert with no "node" label entirely, even though "All" should mean no
    // filtering at all.
    allValue: isMulti ? '.*' : undefined,
    value: isMulti ? '$__all' : '',
  });
  return syncValueFromUrlOnActivation(variable, WORKLOAD_VARIABLE_NAME);
}
