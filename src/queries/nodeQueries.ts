// PromQL queries for the top-level Nodes table (Nodes page).
// refId doubles as the join key: after joinByField(node), each metric's
// value field is disambiguated by Grafana as "Value #<refId>".
//
// Unlike the per-cluster Overview "Nodes" table (clusterOverviewQueries.ts'
// clusterNodeTableQueries, scoped to a single cluster), this table spans
// every selected cluster at once, joined by `node`. Grafana's "Join by
// field" transform does not disambiguate duplicate non-value field names
// across frames the way it does for "Value", so if every query's outermost
// grouping kept `cluster`, the join would produce one duplicate "cluster"
// column per query. To avoid that, only the `info` query's grouping keeps
// `cluster` - every other query's OUTERMOST `by (...)` drops it (inner
// aggregations/vector matches that need `cluster` for correctness are left
// untouched). This assumes node names are unique across clusters, which is
// already assumed elsewhere in this codebase (e.g. buildNodeTableTargets
// also joins on `node` alone).
export const nodeTableQueries = {
  info: `last_over_time(
    max by (asserts_env, asserts_site, cluster, node, provider_id) (
      kube_node_info{cluster=~"$cluster", node=~"$node"}
    )
  [$__range:])`,
  alerts: `count by (node) (
    # node alerts
    ALERTS{alertstate="firing", cluster=~"$cluster", node=~"$node"}

    OR

    # pod alerts by node
    max by (cluster, namespace, pod) (ALERTS{alertstate="firing", cluster=~"$cluster", node=~"$node", pod!=""})
    * on (cluster, namespace, pod) group_left (node)
    max by (cluster, namespace, pod, node) (kube_pod_info{cluster=~"$cluster", node=~"$node"})
  )`,
  cpu_usage_avg: `avg_over_time(sum by (node) (
    label_replace(
      1 - max by (cluster, instance, cpu, core) (rate(node_cpu_seconds_total{cluster=~"$cluster", mode="idle", instance=~"$node"}[$__rate_interval]))
    , "node", "$1", "instance", "([^:]+).*")
  )[$__range:$__rate_interval])`,
  cpu_usage_avg_percent: `avg_over_time(sum by (node) (
    label_replace(
      1 - max by (cluster, instance, cpu, core) (rate(node_cpu_seconds_total{cluster=~"$cluster", mode="idle", instance=~"$node"}[$__rate_interval]))
    , "node", "$1", "instance", "([^:]+).*")
  )[$__range:$__rate_interval]) /
  sum by (node) (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource="cpu", node=~"$node"}))`,
  cpu_usage_max: `max_over_time(sum by (node) (
    label_replace(
      1 - max by (cluster, instance, cpu, core) (rate(node_cpu_seconds_total{cluster=~"$cluster", mode="idle", instance=~"$node"}[$__rate_interval]))
    , "node", "$1", "instance", "([^:]+).*")
  )[$__range:$__rate_interval])`,
  cpu_usage_max_percent: `max_over_time(sum by (node) (
    label_replace(
      1 - max by (cluster, instance, cpu, core) (rate(node_cpu_seconds_total{cluster=~"$cluster", mode="idle", instance=~"$node"}[$__rate_interval]))
    , "node", "$1", "instance", "([^:]+).*")
  )[$__range:$__rate_interval]) /
  sum by (node) (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource="cpu", node=~"$node"}))`,
  mem_usage_avg: `avg_over_time(sum by (node) (
    sum by (cluster, node) (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource="memory", node=~"$node"}))
    - on (cluster, node) group_left
    max by (cluster, node) (
      label_replace(
        windows_memory_available_bytes{cluster=~"$cluster", instance=~"$node"}
        OR
        node_memory_MemAvailable_bytes{cluster=~"$cluster", instance=~"$node"}
      , "node", "$1", "instance", "([^:]+).*")
    )
  )[$__range:1m])`,
  mem_usage_avg_percent: `avg_over_time(sum by (node) (
    sum by (cluster, node) (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource="memory", node=~"$node"}))
    - on (cluster, node) group_left
    max by (cluster, node) (
      label_replace(
        windows_memory_available_bytes{cluster=~"$cluster", instance=~"$node"}
        OR
        node_memory_MemAvailable_bytes{cluster=~"$cluster", instance=~"$node"}
      , "node", "$1", "instance", "([^:]+).*")
    )
  )[$__range:1m]) /
  sum by (node) (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource="memory", node=~"$node"}))`,
  mem_usage_max: `max_over_time(sum by (node) (
    sum by (cluster, node) (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource="memory", node=~"$node"}))
    - on (cluster, node) group_left
    max by (cluster, node) (
      label_replace(
        windows_memory_available_bytes{cluster=~"$cluster", instance=~"$node"}
        OR
        node_memory_MemAvailable_bytes{cluster=~"$cluster", instance=~"$node"}
      , "node", "$1", "instance", "([^:]+).*")
    )
  )[$__range:1m])`,
  mem_usage_max_percent: `max_over_time(sum by (node) (
    sum by (cluster, node) (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource="memory", node=~"$node"}))
    - on (cluster, node) group_left
    max by (cluster, node) (
      label_replace(
        windows_memory_available_bytes{cluster=~"$cluster", instance=~"$node"}
        OR
        node_memory_MemAvailable_bytes{cluster=~"$cluster", instance=~"$node"}
      , "node", "$1", "instance", "([^:]+).*")
    )
  )[$__range:1m]) /
  sum by (node) (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource="memory", node=~"$node"}))`,
};

export type NodeQueryKey = keyof typeof nodeTableQueries;

export function substituteClusterAndNode(expr: string, clusterRegex: string, nodeRegex: string): string {
  return expr.replaceAll('$cluster', clusterRegex).replaceAll('$node', nodeRegex);
}

export function buildNodesListTargets(clusterRegex: string, nodeRegex: string) {
  return (Object.keys(nodeTableQueries) as NodeQueryKey[]).map((key) => ({
    refId: key,
    expr: substituteClusterAndNode(nodeTableQueries[key], clusterRegex, nodeRegex),
    format: 'table' as const,
    instant: true,
  }));
}
