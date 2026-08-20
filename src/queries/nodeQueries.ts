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
  // Deliberately just a direct "node" label match, not also OR-ing in
  // pod-scoped alerts attributed to the node via a kube_pod_info join (an
  // earlier version of this did) - this column's own "View alerts" link
  // goes straight to the Alerts page with just `var-nodes=<node>` in the
  // URL, and that page's own Node filter can only do the same plain "node"
  // label match, with no way to replicate a join from a URL param. The
  // richer join-based count disagreed with what the linked-to page could
  // actually show (a real "N firing alerts" here, an empty table after
  // clicking through) - same fix, same reasoning, as
  // buildNodeAlertsSeverityQuery (nodeOverviewQueries.ts) already got for
  // the Node Drilldown's own health banner.
  // "node!=''" additionally excludes alerts with no "node" label at all
  // from this by-node count - without it, `count by (node)` still emits an
  // explicit node="" group for them (any filter variable's "All" value is
  // ".*", which matches an absent label too - see gotcha in v1.10.10's
  // CHANGELOG entry), showing up as a phantom all-blank row at the bottom
  // of the Nodes table with only a real (but node-less) alert count.
  alerts: `count by (node) (ALERTS{alertstate="firing", cluster=~"$cluster", node=~"$node", node!=""})`,
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

// CPU/Memory/Network/Storage tabs' own substitute - same $cluster/$node
// handling as substituteClusterAndNode, plus a $pod token for their own
// (visible on CPU/Memory, hidden on Network/Storage) Pod picker. The given
// Storage tab queries mix two different $node usages verbatim: a regex
// `node=~"$node"` (every other tab's own form, wants the escaped nodeRegex)
// and one exact `node="$node"` inside their shared
// `kube_pod_info{cluster=~"$cluster", node="$node"}` join fragment (wants
// the raw, unescaped node name - substituting an escaped regex string like
// `\.` into an exact-match position would break any node name containing a
// character regexp-escaping touches). The `node="$node"` replace runs first
// and is a no-op for tabs that never use that exact-match form.
export function substituteClusterNodeAndPodToken(expr: string, clusterRegex: string, node: string, nodeRegex: string, podToken: string): string {
  return expr
    .replaceAll('node="$node"', `node="${node}"`)
    .replaceAll('$cluster', clusterRegex)
    .replaceAll('$node', nodeRegex)
    .replaceAll('$pod', podToken);
}

export function buildNodesListTargets(clusterRegex: string, nodeRegex: string) {
  return (Object.keys(nodeTableQueries) as NodeQueryKey[]).map((key) => ({
    refId: key,
    expr: substituteClusterAndNode(nodeTableQueries[key], clusterRegex, nodeRegex),
    format: 'table' as const,
    instant: true,
  }));
}
