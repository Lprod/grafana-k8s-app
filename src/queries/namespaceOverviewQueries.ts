// PromQL queries for the namespace drilldown Overview tab.
import { workloadTableQueries } from './workloadQueries';

// Namespaces have no synthetic health-probe CronJobs like clusters do (see
// buildClusterHealthQuery in clusterOverviewQueries.ts), so "health" here is
// derived from firing alerts instead: 0 = none, 1 = warning-only, 2 = at
// least one critical. Grouped by severity so the same frame can drive both
// the health banner and an alerts badge, mirroring ClusterAlertsBadge's
// alertsBadgeRunner in clustersApp.tsx.
export function buildNamespaceAlertsSeverityQuery(clusterRegex: string, namespaceRegex: string): string {
  return `count by (severity) (ALERTS{alertstate="firing", cluster="${clusterRegex}", namespace="${namespaceRegex}", alertname!~"ArgoCDSyncAlert"})`;
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

// Elasticsearch Lucene queries for the "Logs / Events" bar charts. Plain
// (non-backtick) strings so the literal "${cluster:lucene}"/"${namespace:...}"
// tokens below aren't mistaken for JS template interpolation - they're
// placeholders this file substitutes itself (see
// substituteLuceneClusterAndNamespace), since this page has no live
// "cluster"/"namespace" scene variables of its own to interpolate through
// (it's scoped to a single cluster+namespace via the drilldown route, same
// as every other query on this page).
//
// Events intentionally has no cluster filter and uses "${namespace:raw}"
// (unwrapped, unescaped) rather than Logs' "${namespace:lucene})" - given
// verbatim, not "fixed" to match Logs' style (see the project convention on
// preserving intentional per-panel query differences).
export const namespaceLogsLuceneQuery =
  '(logmgmt.kind:openshift AND NOT logmgmt.category:event AND k8s.cluster.name:(${cluster:lucene}) AND k8s.namespace.name:(${namespace:lucene}))';

export const namespaceEventsLuceneQuery =
  '(logmgmt.kind:openshift AND logmgmt.category:event AND k8s.namespace.name:${namespace:raw})';

function escapeLucene(value: string): string {
  return value.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
}

export function substituteLuceneClusterAndNamespace(expr: string, cluster: string, namespace: string): string {
  return expr
    .replaceAll('${cluster:lucene}', escapeLucene(cluster))
    .replaceAll('${namespace:lucene}', escapeLucene(namespace))
    .replaceAll('${namespace:raw}', namespace);
}

// Elasticsearch datasource query shape (bucketAggs/metrics) has no published
// TS types (it's a core-bundled datasource, not an npm package) - this is
// the well-established "terms outer, date_histogram inner" nesting that
// produces one time series per term value, matching Grafana's own ES
// dashboards. `min_doc_count: '0'` keeps zero-count buckets so the stacked
// bar chart doesn't show gaps between time buckets.
export function buildElasticsearchTermsOverTimeQuery(refId: string, query: string, termField: string) {
  return {
    refId,
    query,
    alias: `{{term ${termField}}}`,
    metrics: [{ id: '1', type: 'count' }],
    bucketAggs: [
      { id: '2', type: 'terms', field: termField, settings: { size: '0', order: 'desc', orderBy: '_count' } },
      { id: '3', type: 'date_histogram', field: '@timestamp', settings: { interval: 'auto', min_doc_count: '0' } },
    ],
  };
}
