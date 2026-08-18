// PromQL queries for the namespace drilldown Overview tab.
import { workloadTableQueries } from './workloadQueries';
import { infraDatasource } from './datasources';

// Namespaces have no synthetic health-probe CronJobs like clusters do (see
// buildClusterHealthQuery in clusterOverviewQueries.ts), so "health" here is
// derived from firing alerts instead: 0 = none, 1 = warning-only, 2 = at
// least one critical. Grouped by severity so the same frame can drive both
// the health banner and an alerts badge, mirroring ClusterAlertsBadge's
// alertsBadgeRunner in clustersApp.tsx.
export function buildNamespaceAlertsSeverityQuery(clusterRegex: string, namespaceRegex: string): string {
  return `count by (severity) (ALERTS{alertstate="firing", cluster="${clusterRegex}", namespace="${namespaceRegex}", alertname!~"ArgoCDSyncAlert"})`;
}

// Escapes a value going into a single-quoted SQL string literal.
function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

// EgressIP lookup, simplified: a direct RQLite CMDB query keyed by the plain
// k8s namespace name alone - no more cluster-name datacenter-coordinate
// parsing or an application/substage indirection through OVN's own
// `environment_debeka_de` label (that whole mechanism, and the Prometheus
// `ovn_egressip_info` query it fed, is gone). `r.result` is a JSON blob per
// resource row; the egress IP lives at its `$.egressip` path.
export function buildEgressIpQuery(namespace: string): string {
  return `SELECT json_extract(r.result, '$.egressip') AS egressip FROM resource r WHERE r.infra_key IN ('${escapeSqlLiteral(namespace)}') AND json_extract(r.result, '$.egressip') IS NOT NULL AND json_extract(r.result, '$.egressip') != '' ORDER BY r.infra_key`;
}

// Full query target for the panel above - shaped to match g42-rqlite-datasource's
// own Panel JSON model exactly (confirmed against a real panel built with its
// query editor in "code" mode): `rawSql` is the field the editor itself
// writes the SQL into, and the builder-mode scaffolding fields
// (table/columns/whereClause/groupBy/orderBy/limit/offset/timeColumns) are
// carried along even though they're unused in code mode - `editorMode:
// 'code'` is what tells the plugin to read `rawSql` directly rather than try
// to construct SQL from those (here: empty) builder fields.
export function buildEgressIpQueryTarget(namespace: string) {
  return {
    refId: 'egressip',
    datasource: infraDatasource(),
    rawSql: buildEgressIpQuery(namespace),
    format: 'table',
    editorMode: 'code',
    table: '',
    columns: [],
    whereClause: [],
    groupBy: [],
    orderBy: [],
    limit: '',
    offset: '',
    timeColumns: ['time'],
  };
}

// "Namespace optimization" charts on the Overview tab: capacity/limits/
// requests/usage over time, plus a synthetic "allocation" series (requests
// where set, falling back to usage where they aren't - the same idea as
// Kubernetes' own "requested or used, whichever is higher" scheduling
// signal). Literal "$cluster"/"$namespace" placeholders, substituted by
// callers via substituteClusterAndNamespace() (namespaceQueries.ts).
export const namespaceCpuOptimizationQueries = {
  allocation: `max by (namespace) (
    namespace_cpu:kube_pod_container_resource_requests:sum{cluster="$cluster", namespace="$namespace"}
    OR
    sum by (namespace) (max by (namespace, pod, container) (rate(container_cpu_usage_seconds_total{cluster="$cluster", namespace="$namespace", container!=""}[$__rate_interval])))
  )`,
  requests: `max by (cluster, namespace) (namespace_cpu:kube_pod_container_resource_requests:sum{cluster="$cluster", namespace="$namespace"})`,
  limits: `max by (cluster, namespace) (namespace_cpu:kube_pod_container_resource_limits:sum{cluster="$cluster", namespace="$namespace"})`,
  usage: `sum(max by (cluster, namespace, pod, container) (rate(container_cpu_usage_seconds_total{cluster="$cluster", namespace="$namespace", container!=""}[$__rate_interval])))`,
  capacity: `kube_resourcequota{cluster="$cluster", namespace="$namespace", resource="requests.cpu", type="hard"}`,
};

export const namespaceMemoryOptimizationQueries = {
  allocation: `max by (namespace) (
    namespace_memory:kube_pod_container_resource_requests:sum{cluster="$cluster", namespace="$namespace"}
    OR
    sum by (namespace) (max by (namespace, pod, container) (container_memory_working_set_bytes{cluster="$cluster", namespace="$namespace", container!=""}))
  )`,
  requests: `max by (cluster, namespace) (namespace_memory:kube_pod_container_resource_requests:sum{cluster="$cluster", namespace="$namespace"})`,
  limits: `max by (cluster, namespace) (namespace_memory:kube_pod_container_resource_limits:sum{cluster="$cluster", namespace="$namespace"})`,
  usage: `sum(max by (cluster, namespace, pod, container) (container_memory_working_set_bytes{cluster="$cluster", namespace="$namespace", container!=""}))`,
  capacity: `kube_resourcequota{cluster="$cluster", namespace="$namespace", resource="requests.memory", type="hard"}`,
};

export type NamespaceOptimizationQueryKey = keyof typeof namespaceCpuOptimizationQueries;

// "Workloads" table on the Overview tab: one row per workload in this
// namespace. Unlike the top-level Workloads page (workloadQueries.ts),
// every query here is already scoped to a single cluster+namespace (this
// page's own route params, not a multi-select variable), so the cpu/mem
// queries group only by (workload, workload_type) - no cluster/namespace
// columns needed after merge. ready_pods/desired_pods are reused verbatim
// from workloadTableQueries since they're identical regardless of scope.
export const namespaceWorkloadsTableQueries = {
  ready_pods: workloadTableQueries.ready_pods,
  desired_pods: workloadTableQueries.desired_pods,
  cpu_usage: `sum(
    node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="$cluster", namespace="$namespace"}
  * on(namespace, pod)
    group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
  ) by (workload, workload_type)`,
  cpu_requests: `sum(
    kube_pod_container_resource_requests{job="kube-state-metrics", cluster="$cluster", namespace="$namespace", resource="cpu"}
  * on(namespace, pod)
    group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
  ) by (workload, workload_type)`,
  cpu_requests_percent: `sum(
    node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="$cluster", namespace="$namespace"}
  * on(namespace, pod)
    group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
  ) by (workload, workload_type)
  /sum(
    kube_pod_container_resource_requests{job="kube-state-metrics", cluster="$cluster", namespace="$namespace", resource="cpu"}
  * on(namespace, pod)
    group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
  ) by (workload, workload_type)`,
  mem_usage: `sum(
      container_memory_working_set_bytes{job="kubelet", metrics_path="/metrics/cadvisor", cluster="$cluster", namespace="$namespace", container!="", image!=""}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
  ) by (workload, workload_type)`,
  mem_requests: `sum(
    kube_pod_container_resource_requests{job="kube-state-metrics", cluster="$cluster", namespace="$namespace", resource="memory"}
  * on(namespace, pod)
    group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
  ) by (workload, workload_type)`,
  mem_requests_percent: `sum(
      container_memory_working_set_bytes{job="kubelet", metrics_path="/metrics/cadvisor", cluster="$cluster", namespace="$namespace", container!="", image!=""}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
  ) by (workload, workload_type)
  /sum(
    kube_pod_container_resource_requests{job="kube-state-metrics", cluster="$cluster", namespace="$namespace", resource="memory"}
  * on(namespace, pod)
    group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
  ) by (workload, workload_type)`,
  mem_limits: `sum(
    kube_pod_container_resource_limits{job="kube-state-metrics", cluster="$cluster", namespace="$namespace", resource="memory"}
  * on(namespace, pod)
    group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
  ) by (workload, workload_type)`,
  mem_limits_percent: `sum(
      container_memory_working_set_bytes{job="kubelet", metrics_path="/metrics/cadvisor", cluster="$cluster", namespace="$namespace", container!="", image!=""}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
  ) by (workload, workload_type)
  /sum(
    kube_pod_container_resource_limits{job="kube-state-metrics", cluster="$cluster", namespace="$namespace", resource="memory"}
  * on(namespace, pod)
    group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
  ) by (workload, workload_type)`,
};

export type NamespaceWorkloadsQueryKey = keyof typeof namespaceWorkloadsTableQueries;

// Elasticsearch Lucene queries for the "Logs / Events" bar charts.
//
// Each canonical level/type gets its OWN query (a plain date_histogram
// count, no terms bucket) with an "AND log.level:(A OR B OR ...)" filter
// covering every known spelling/casing variant of that level - rather than
// one query with a "terms" bucket-agg grouped by the raw field value, which
// would put "ERROR" and "Err" in separate buckets/series instead of
// merging them. One query per bar-chart series, matching what the "group
// by" ends up looking like once stacked.
function escapeLucene(value: string): string {
  return value.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
}

export interface LevelDef {
  canonical: string;
  variants: string[];
  color: string;
}

// "Only warn/error" keeps just the ERROR/WARN (Logs) or Error/Warning
// (Events) defs - see filterLevelDefs.
export const namespaceLogLevelDefs: LevelDef[] = [
  { canonical: 'ALERT', variants: ['ALERT', 'Alert', 'alert'], color: 'dark-red' },
  { canonical: 'ERROR', variants: ['ERROR', 'Error', 'error', 'ERR', 'Err', 'err'], color: 'red' },
  { canonical: 'WARN', variants: ['WARN', 'Warn', 'warn', 'WARNING', 'Warning', 'warning'], color: 'orange' },
  { canonical: 'INFO', variants: ['INFO', 'Info', 'info'], color: 'blue' },
  { canonical: 'DEBUG', variants: ['DEBUG', 'Debug', 'debug'], color: 'green' },
  { canonical: 'TRACE', variants: ['TRACE', 'Trace', 'trace'], color: 'purple' },
];

export const namespaceEventTypeDefs: LevelDef[] = [
  { canonical: 'Normal', variants: ['Normal', 'NORMAL', 'normal'], color: 'green' },
  { canonical: 'Warning', variants: ['Warning', 'WARNING', 'warning'], color: 'orange' },
  { canonical: 'Error', variants: ['Error', 'ERROR', 'error'], color: 'red' },
  { canonical: 'notice', variants: ['notice', 'Notice', 'NOTICE'], color: 'yellow' },
];

export const NAMESPACE_LEVEL_OTHER = 'Other';
// A plain hex value, not Grafana's "grey" CSS-color-name fallback - the Bar
// Chart panel's uPlot-based renderer parses fixedColor itself (hex/rgb/hsl/
// color() only) instead of resolving it through Grafana's own named-hue
// palette first, unlike red/orange/yellow/green/blue/purple above, which
// are registered viz hues and do get resolved before reaching uPlot.
export const NAMESPACE_LEVEL_OTHER_COLOR = '#8e8e8e';

export function filterLevelDefsWarnErrorOnly(defs: LevelDef[]): LevelDef[] {
  return defs.filter((d) => d.canonical === 'ERROR' || d.canonical === 'WARN' || d.canonical === 'Warning' || d.canonical === 'Error');
}

function luceneOrClause(field: string, variants: string[]): string {
  return `${field}:(${variants.join(' OR ')})`;
}

function luceneNotAnyClause(field: string, defs: LevelDef[]): string {
  return `NOT ${luceneOrClause(field, defs.flatMap((d) => d.variants))}`;
}

// Elasticsearch datasource query shape (bucketAggs/metrics) has no published
// TS types (it's a core-bundled datasource, not an npm package).
//
// `interval` is a concrete duration string (e.g. "1m", "5m") computed by
// the caller via @grafana/data's calculateInterval(timeRange, resolution,
// '1m') - NOT the "$__interval" macro. $__interval alone auto-sizes to the
// time range exactly like the timepicker, but Grafana's ES date_histogram
// has no "minimum interval" syntax of its own to floor it at 1m (confirmed
// against a live instance: interval values like ">1m"/"$__interval_ms"
// both 400 - only "auto", "$__interval", and concrete durations are
// accepted). calculateInterval() is the same helper Grafana panels use
// internally for this, so this reproduces "auto, floored at 1m" without
// relying on unsupported datasource syntax. `min_doc_count: '0'` keeps
// zero-count buckets so the stacked bar chart doesn't show gaps between
// time buckets.
function buildElasticsearchLevelQuery(refId: string, query: string, alias: string, interval: string) {
  return {
    refId,
    query,
    alias,
    metrics: [{ id: '1', type: 'count' }],
    bucketAggs: [{ id: '2', type: 'date_histogram', field: '@timestamp', settings: { interval, min_doc_count: '0' } }],
  };
}

// Level-restriction clause shared by the raw-log-line queries below (the
// dedicated Logs/Events tabs' Log panels) - the same "only ERROR/WARN(ING)"
// filter the Overview tab's bar charts apply by dropping every other
// per-level query, expressed here as a single extra Lucene AND-clause
// instead, since a Log panel is one query returning individual documents,
// not one query per canonical level.
function buildLevelRestrictionClause(field: string, defs: LevelDef[], onlyWarnError: boolean): string {
  if (!onlyWarnError) {
    return '';
  }
  return ` AND ${luceneOrClause(field, filterLevelDefsWarnErrorOnly(defs).flatMap((d) => d.variants))}`;
}

// Raw log-line queries for the dedicated Logs/Events tabs' Log panels - as
// opposed to the per-level date_histogram queries above (Overview tab's bar
// charts), these use metrics:[{type:'logs'}] with no bucketAggs, so the
// Elasticsearch datasource returns individual documents (message, level,
// timestamp, ...) instead of per-interval counts.
export function buildNamespaceLogsQuery(cluster: string, namespace: string, onlyWarnError: boolean): string {
  return `logmgmt.kind:openshift AND NOT logmgmt.category:event AND k8s.cluster.name:(${escapeLucene(cluster)}) AND k8s.namespace.name:(${escapeLucene(namespace)})${buildLevelRestrictionClause('log.level', namespaceLogLevelDefs, onlyWarnError)}`;
}

// Same "no cluster filter, unescaped namespace" asymmetry as
// buildNamespaceEventsLevelQueries below - given verbatim per the original
// request, not "fixed" to match Logs' style.
export function buildNamespaceEventsQuery(namespace: string, onlyWarnError: boolean): string {
  return `logmgmt.kind:openshift AND logmgmt.category:event AND k8s.namespace.name:${namespace}${buildLevelRestrictionClause('event.type', namespaceEventTypeDefs, onlyWarnError)}`;
}

// Events intentionally has no cluster filter and uses the namespace value
// unwrapped/unescaped, rather than Logs' parenthesized/escaped form - given
// verbatim per the original request, not "fixed" to match Logs' style (see
// the project convention on preserving intentional per-panel query
// differences).
export function buildNamespaceLogsLevelQueries(cluster: string, namespace: string, onlyWarnError: boolean, interval: string) {
  const base = (extra: string) =>
    `(logmgmt.kind:openshift AND NOT logmgmt.category:event AND k8s.cluster.name:(${escapeLucene(cluster)}) AND k8s.namespace.name:(${escapeLucene(namespace)}) AND ${extra})`;

  const defs = onlyWarnError ? filterLevelDefsWarnErrorOnly(namespaceLogLevelDefs) : namespaceLogLevelDefs;
  const queries = defs.map((d) => buildElasticsearchLevelQuery(d.canonical, base(luceneOrClause('log.level', d.variants)), d.canonical, interval));

  if (!onlyWarnError) {
    queries.push(
      buildElasticsearchLevelQuery(NAMESPACE_LEVEL_OTHER, base(luceneNotAnyClause('log.level', namespaceLogLevelDefs)), NAMESPACE_LEVEL_OTHER, interval)
    );
  }

  return queries;
}

export function buildNamespaceEventsLevelQueries(namespace: string, onlyWarnError: boolean, interval: string) {
  const base = (extra: string) => `(logmgmt.kind:openshift AND logmgmt.category:event AND k8s.namespace.name:${namespace} AND ${extra})`;

  const defs = onlyWarnError ? filterLevelDefsWarnErrorOnly(namespaceEventTypeDefs) : namespaceEventTypeDefs;
  const queries = defs.map((d) => buildElasticsearchLevelQuery(d.canonical, base(luceneOrClause('event.type', d.variants)), d.canonical, interval));

  if (!onlyWarnError) {
    queries.push(
      buildElasticsearchLevelQuery(NAMESPACE_LEVEL_OTHER, base(luceneNotAnyClause('event.type', namespaceEventTypeDefs)), NAMESPACE_LEVEL_OTHER, interval)
    );
  }

  return queries;
}

// Workload Drilldown Overview tab's own Logs/Events bar charts - same
// per-canonical-level query-per-series structure as
// buildNamespaceLogsLevelQueries/buildNamespaceEventsLevelQueries above, with
// an extra orchestrator.resource.name wildcard clause (most log/event
// documents don't carry a dedicated "workload" field of their own, so this
// matches on the resource name prefix instead) scoping down to just this one
// workload.
export function buildWorkloadLogsLevelQueries(cluster: string, namespace: string, workload: string, onlyWarnError: boolean, interval: string) {
  const base = (extra: string) =>
    `(logmgmt.kind:openshift AND NOT logmgmt.category:event AND k8s.cluster.name:(${escapeLucene(cluster)}) AND k8s.namespace.name:(${escapeLucene(namespace)}) AND orchestrator.resource.name:(${escapeLucene(workload)}*) AND ${extra})`;

  const defs = onlyWarnError ? filterLevelDefsWarnErrorOnly(namespaceLogLevelDefs) : namespaceLogLevelDefs;
  const queries = defs.map((d) => buildElasticsearchLevelQuery(d.canonical, base(luceneOrClause('log.level', d.variants)), d.canonical, interval));

  if (!onlyWarnError) {
    queries.push(
      buildElasticsearchLevelQuery(NAMESPACE_LEVEL_OTHER, base(luceneNotAnyClause('log.level', namespaceLogLevelDefs)), NAMESPACE_LEVEL_OTHER, interval)
    );
  }

  return queries;
}

// Same "no cluster filter, orchestrator.namespace instead of
// k8s.namespace.name" asymmetry as buildNamespaceEventsLevelQueries above -
// given verbatim per the original request, not "fixed" to match Logs' style.
export function buildWorkloadEventsLevelQueries(namespace: string, workload: string, onlyWarnError: boolean, interval: string) {
  const base = (extra: string) =>
    `(logmgmt.kind:openshift AND logmgmt.category:event AND orchestrator.namespace:(${escapeLucene(namespace)}) AND orchestrator.resource.name:(${escapeLucene(workload)}*) AND ${extra})`;

  const defs = onlyWarnError ? filterLevelDefsWarnErrorOnly(namespaceEventTypeDefs) : namespaceEventTypeDefs;
  const queries = defs.map((d) => buildElasticsearchLevelQuery(d.canonical, base(luceneOrClause('event.type', d.variants)), d.canonical, interval));

  if (!onlyWarnError) {
    queries.push(
      buildElasticsearchLevelQuery(NAMESPACE_LEVEL_OTHER, base(luceneNotAnyClause('event.type', namespaceEventTypeDefs)), NAMESPACE_LEVEL_OTHER, interval)
    );
  }

  return queries;
}

// Raw log-line queries for the Workload Drilldown's own dedicated Logs/
// Events tabs - same shape as buildNamespaceLogsQuery/buildNamespaceEventsQuery
// above (a single query, no bucketAggs), with the same
// orchestrator.resource.name wildcard clause buildWorkloadLogsLevelQueries/
// buildWorkloadEventsLevelQueries already use to scope the Overview tab's
// bar charts down to one workload.
export function buildWorkloadLogsQuery(cluster: string, namespace: string, workload: string, onlyWarnError: boolean): string {
  return `logmgmt.kind:openshift AND NOT logmgmt.category:event AND k8s.cluster.name:(${escapeLucene(cluster)}) AND k8s.namespace.name:(${escapeLucene(namespace)}) AND orchestrator.resource.name:(${escapeLucene(workload)}*)${buildLevelRestrictionClause('log.level', namespaceLogLevelDefs, onlyWarnError)}`;
}

// Same "no cluster filter, orchestrator.namespace instead of
// k8s.namespace.name" asymmetry as buildWorkloadEventsLevelQueries above -
// given verbatim per the original request.
export function buildWorkloadEventsQuery(namespace: string, workload: string, onlyWarnError: boolean): string {
  return `logmgmt.kind:openshift AND logmgmt.category:event AND orchestrator.namespace:(${escapeLucene(namespace)}) AND orchestrator.resource.name:(${escapeLucene(workload)}*)${buildLevelRestrictionClause('event.type', namespaceEventTypeDefs, onlyWarnError)}`;
}
