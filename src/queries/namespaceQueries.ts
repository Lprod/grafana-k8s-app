// PromQL queries for the top-level Namespaces table (Namespaces page).
//
// Unlike nodeQueries.ts, this keeps every query's original `by (cluster,
// namespace)` grouping verbatim and joins with Grafana's "merge" transform
// (see namespacesPage.tsx) instead of joinByField. An earlier version of
// this file trimmed `cluster` down to just the `info` query to avoid
// duplicate-column output from joinByField - but that made the whole
// Cluster (and Workloads) column depend on `info` alone returning data. On
// a cluster/environment where `info`'s underlying metrics happen to be
// sparse or absent while other metrics aren't, the table silently lost its
// Cluster column and most of its rows. "merge" doesn't have that
// single-source-of-truth problem: it matches rows by every field common to
// all queries and only needs *some* query to carry `cluster` for a given
// row, so it doesn't matter which one.
export const namespaceTableQueries = {
  info: `sum by (cluster, namespace) (
    # prefer namespaces with a count of workloads
    group by (cluster, namespace, workload) (
      namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace", workload_type=~".+", workload!="", pod=~".+"}

      OR

      label_replace(
        label_replace(
          namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace", workload_type=~".+", workload="", pod=~".+"}
        , "workload", "$1", "pod", "(.+)-(.+)")
      , "workload_type", "replicaset", "", "")

      OR

      label_replace(
        label_replace(
          kube_pod_owner{cluster=~"$cluster", namespace=~"$namespace", pod=~".+", owner_kind=""}
        , "workload", "$1", "pod", "(.+)")
      , "workload_type", "pod", "", "")

      OR

      label_replace(
        label_replace(
          kube_pod_owner{cluster=~"$cluster", namespace=~"$namespace", pod=~".+", owner_kind="Node"}
        , "workload", "$1", "pod", "(.+)")
      , "workload_type", "staticpod", "", "")
    )
  )
  # otherwise fallback to a zero value for namespaces without workloads
  OR on (cluster, namespace)
  last_over_time(
    group by (cluster, namespace) (kube_namespace_status_phase{cluster=~"$cluster", namespace=~"$namespace", phase="Active"} == 1)
  [$__range:]) - 1`,
  alerts: `count by (namespace, cluster) (ALERTS{cluster=~"$cluster", namespace=~"$namespace", alertstate="firing"})`,
  cpu_usage: `sum(node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace, cluster)`,
  cpu_requests: `sum(cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace, cluster)`,
  cpu_requests_percent: `sum(node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace, cluster) / sum(cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace, cluster)`,
  mem_usage: `sum(container_memory_working_set_bytes{job="kubelet", metrics_path="/metrics/cadvisor", cluster=~"$cluster", namespace=~"$namespace", container!="", image!=""}) by (namespace, cluster)`,
  mem_requests: `sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace, cluster)`,
  mem_requests_percent: `sum(container_memory_working_set_bytes{job="kubelet", metrics_path="/metrics/cadvisor", cluster=~"$cluster", namespace=~"$namespace", container!="", image!=""}) by (namespace, cluster) / sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace, cluster)`,
  mem_limits: `sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace, cluster)`,
  mem_limits_percent: `sum(container_memory_working_set_bytes{job="kubelet", metrics_path="/metrics/cadvisor", cluster=~"$cluster", namespace=~"$namespace", container!="", image!=""}) by (namespace, cluster) / sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace, cluster)`,
};

export type NamespaceQueryKey = keyof typeof namespaceTableQueries;

export function substituteClusterAndNamespace(expr: string, clusterRegex: string, namespaceRegex: string): string {
  return expr.replaceAll('$cluster', clusterRegex).replaceAll('$namespace', namespaceRegex);
}

export function buildNamespacesListTargets(clusterRegex: string, namespaceRegex: string) {
  return (Object.keys(namespaceTableQueries) as NamespaceQueryKey[]).map((key) => ({
    refId: key,
    expr: substituteClusterAndNamespace(namespaceTableQueries[key], clusterRegex, namespaceRegex),
    format: 'table' as const,
    instant: true,
  }));
}
