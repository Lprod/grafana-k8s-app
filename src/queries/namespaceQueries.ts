// PromQL queries for the top-level Namespaces table (Namespaces page).
// refId doubles as the join key: after joinByField(namespace), each metric's
// value field is disambiguated by Grafana as "Value #<refId>".
//
// Same duplicate-"Cluster"-column problem as nodeQueries.ts: this table
// spans every selected cluster at once, joined by `namespace`. Only the
// `info` query's grouping keeps `cluster` - every other query's OUTERMOST
// `by (...)` drops it (these are all flat `sum(...)/count(...) by (...)`
// with no nested vector-match that would need it preserved). Assumes
// namespace names are unique across clusters, which the join already
// implicitly assumes regardless of this trimming.
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
  alerts: `count by (namespace) (ALERTS{cluster=~"$cluster", namespace=~"$namespace", alertstate="firing"})`,
  cpu_usage: `sum(node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace)`,
  cpu_requests: `sum(cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace)`,
  cpu_requests_percent: `sum(node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace) / sum(cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace)`,
  mem_usage: `sum(container_memory_working_set_bytes{job="kubelet", metrics_path="/metrics/cadvisor", cluster=~"$cluster", namespace=~"$namespace", container!="", image!=""}) by (namespace)`,
  mem_requests: `sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace)`,
  mem_requests_percent: `sum(container_memory_working_set_bytes{job="kubelet", metrics_path="/metrics/cadvisor", cluster=~"$cluster", namespace=~"$namespace", container!="", image!=""}) by (namespace) / sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace)`,
  mem_limits: `sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace)`,
  mem_limits_percent: `sum(container_memory_working_set_bytes{job="kubelet", metrics_path="/metrics/cadvisor", cluster=~"$cluster", namespace=~"$namespace", container!="", image!=""}) by (namespace) / sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{cluster=~"$cluster", namespace=~"$namespace"}) by (namespace)`,
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
