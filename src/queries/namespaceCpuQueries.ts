// PromQL queries for the Namespace Drilldown's CPU tab
// (src/pages/Namespaces/namespaceCpuScene.tsx), pasted verbatim from
// Grafana's own Kubernetes Monitoring app (play.grafana.org). Every query
// uses literal `$cluster`/`$namespace`/`$pod` placeholders, substituted via
// substituteClusterNamespacePod() below - same literal-translation
// convention as namespaceOverviewQueries.ts (kept as given, not "fixed" to
// use `=~` everywhere or to match sibling queries' filter sets exactly -
// e.g. namespaceCpuWorkloadAlignmentQuery's inner usage expr lacks the
// `container!=""` filter that namespaceCpuDistributionQuery's otherwise
// identical-looking inner expr has).

export const namespaceCpuStatQueries = {
  alertsFiring: `count(ALERTS{cluster="$cluster", alertstate=~"firing", alertname=~"Kube.*|CPUThrottlingHigh", namespace="$namespace", pod=~"$pod"}) or vector(0)`,
  schedulingRequestsSet: `count(group by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"})) / count(group by (cluster, namespace, pod, container) (kube_pod_container_info{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))`,
  alignmentUsageRequests: `sum by () (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"})) / sum by () (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))`,
};

export type NamespaceCpuStatKey = keyof typeof namespaceCpuStatQueries;

// "Overview: Usage (vCPU cores)" timeseries - refIds match
// applyNamespaceOptimizationSeriesOverrides' (namespacesPage.tsx) matchers
// (limits/requests/usage), so it's reused verbatim for the same red-dashed/
// orange-dashed/blue-solid styling as the Overview tab's own optimization
// charts.
export const namespaceCpuOverviewUsageQueries = {
  limits: `sum by () (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_limits{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))`,
  requests: `sum by () (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))`,
  usage: `sum by () (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))`,
};

export type NamespaceCpuOverviewUsageKey = keyof typeof namespaceCpuOverviewUsageQueries;

export const namespaceCpuDistributionQuery = `sum by (cluster, namespace, workload, workload_type) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"})) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~".+"}))`;

export const namespaceCpuWorkloadAlignmentQuery = `sum by (cluster, namespace, workload, workload_type) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="$cluster", namespace="$namespace", pod=~"$pod"})) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~".+"})) / on (cluster,namespace,workload,workload_type) group_left() sum by (cluster, namespace, workload, workload_type) (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~".+"}))`;
