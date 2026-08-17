// PromQL queries for the Namespace Drilldown's CPU tab
// (src/pages/Namespaces/namespaceCpuScene.tsx), pasted verbatim from
// Grafana's own Kubernetes Monitoring app (play.grafana.org) - kept as given
// even where a query's filter set isn't fully consistent with its sibling -
// e.g. namespaceCpuWorkloadAlignmentQuery's inner usage expr lacks the
// `container!=""` filter that namespaceCpuDistributionQuery's otherwise
// identical-looking inner expr has.
//
// The tab has no Pod filter (removed - every `pod=~"$pod"` matcher these
// queries used to carry was stripped so they cover every pod
// unconditionally).
//
// namespaceCpuDistributionQuery/namespaceCpuWorkloadAlignmentQuery's
// `workload=~".+"` matcher (originally a fixed "non-empty workload only"
// filter with no picker behind it) was changed to `workload=~"$workload"`
// to back the CPU tab's own Workload filter, substituted in
// namespaceCpuScene.tsx.

export const namespaceCpuStatQueries = {
  alertsFiring: `count(ALERTS{cluster="$cluster", alertstate=~"firing", alertname=~"Kube.*|CPUThrottlingHigh", namespace="$namespace"}) or vector(0)`,
  schedulingRequestsSet: `count(group by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace"})) / count(group by (cluster, namespace, pod, container) (kube_pod_container_info{container!="", cluster="$cluster", namespace="$namespace"}))`,
  alignmentUsageRequests: `sum by () (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="", cluster="$cluster", namespace="$namespace"})) / sum by () (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace"}))`,
};

export type NamespaceCpuStatKey = keyof typeof namespaceCpuStatQueries;

// "Overview: Usage (vCPU cores)" timeseries - refIds match
// applyNamespaceOptimizationSeriesOverrides' (namespacesPage.tsx) matchers
// (limits/requests/usage), so it's reused verbatim for the same red-dashed/
// orange-dashed/blue-solid styling as the Overview tab's own optimization
// charts.
//
// Originally (as given) these had no workload dimension at all - just a
// flat per-container sum, so the Workload filter had no effect on this
// panel while Distribution/Alignment (which already join against
// namespace_workload_pod:kube_pod_owner:relabel) did respect it. Each query
// now inner-joins against that same relabel metric, filtered by
// `workload=~"$workload"`, purely to restrict *which pods* count toward the
// sum - same "* on (...) group_left() group by (...) (...)" existence-join
// idiom namespaceCpuDistributionQuery already uses (the `group by` on the
// right-hand side makes every matching series' value 1, so the multiply
// only acts as a filter, not a scale).
export const namespaceCpuOverviewUsageQueries = {
  limits: `sum by () (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_limits{container!="", cluster="$cluster", namespace="$namespace"})) * on (cluster,namespace,pod) group_left() group by (cluster, namespace, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", workload=~"$workload"}))`,
  requests: `sum by () (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace"})) * on (cluster,namespace,pod) group_left() group by (cluster, namespace, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", workload=~"$workload"}))`,
  usage: `sum by () (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="", cluster="$cluster", namespace="$namespace"})) * on (cluster,namespace,pod) group_left() group by (cluster, namespace, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", workload=~"$workload"}))`,
};

export type NamespaceCpuOverviewUsageKey = keyof typeof namespaceCpuOverviewUsageQueries;

export const namespaceCpuDistributionQuery = `sum by (cluster, namespace, workload, workload_type) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="", cluster="$cluster", namespace="$namespace"})) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", workload=~"$workload"}))`;

export const namespaceCpuWorkloadAlignmentQuery = `sum by (cluster, namespace, workload, workload_type) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="$cluster", namespace="$namespace"})) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", workload=~"$workload"})) / on (cluster,namespace,workload,workload_type) group_left() sum by (cluster, namespace, workload, workload_type) (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace"}) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", workload=~"$workload"}))`;
