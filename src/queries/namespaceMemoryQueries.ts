// PromQL queries for the Namespace Drilldown's Memory tab
// (src/pages/Namespaces/namespaceMemoryScene.tsx), pasted verbatim from
// Grafana's own Kubernetes Monitoring app (play.grafana.org) - same
// literal-translation convention as namespaceCpuQueries.ts. Kept as given
// even where a query's `cluster`/`namespace` filter operator (`=` vs `=~`)
// differs from its CPU-tab equivalent (e.g. schedulingRequestsSet and
// alignmentUsageRequests use `=~` here, matching regex, while the CPU tab's
// versions use plain `=` equality) - not "fixed" to be consistent, per this
// project's convention of preserving intentional per-panel query
// differences.
//
// The tab has no Pod filter (removed - every `pod=~"$pod"` matcher these
// queries used to carry was stripped so they cover every pod
// unconditionally, same as the CPU tab).
//
// namespaceMemoryDistributionQuery/namespaceMemoryWorkloadAlignmentQuery's
// `workload=~".+"` matcher was changed to `workload=~"$workload"` to back
// the Memory tab's own Workload filter, same as the CPU tab.

export const namespaceMemoryStatQueries = {
  alertsFiring: `count(ALERTS{cluster="$cluster", alertstate=~"firing", alertname=~"Kube.*|CPUThrottlingHigh", namespace="$namespace"}) or vector(0)`,
  schedulingRequestsSet: `count(group by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="", cluster=~"$cluster", namespace=~"$namespace"})) / count(group by (cluster, namespace, pod, container) (kube_pod_container_info{container!="", cluster=~"$cluster", namespace=~"$namespace"}))`,
  alignmentUsageRequests: `sum by () (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_memory_working_set_bytes{container!="", cluster=~"$cluster", namespace=~"$namespace"})) / sum by () (max by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="", cluster=~"$cluster", namespace=~"$namespace"}))`,
};

export type NamespaceMemoryStatKey = keyof typeof namespaceMemoryStatQueries;

// "Overview: Usage (memory bytes)" timeseries - refIds match
// applyMemoryUsageSeriesOverrides' matchers (limits/requests/usage), same
// red-dashed/orange-dashed/blue-solid styling as the CPU tab's Overview
// chart.
//
// Same workload-attribution inner join added as the CPU tab's own
// namespaceCpuOverviewUsageQueries - originally these had no workload
// dimension at all, so the Workload filter had no effect on this panel.
export const namespaceMemoryOverviewUsageQueries = {
  limits: `sum by () (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{container!="", cluster=~"$cluster", namespace=~"$namespace"})) * on (cluster,namespace,pod) group_left() group by (cluster, namespace, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", workload=~"$workload"}))`,
  requests: `sum by () (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="", cluster=~"$cluster", namespace=~"$namespace"})) * on (cluster,namespace,pod) group_left() group by (cluster, namespace, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", workload=~"$workload"}))`,
  usage: `sum by () (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_memory_working_set_bytes{container!="", cluster=~"$cluster", namespace=~"$namespace"})) * on (cluster,namespace,pod) group_left() group by (cluster, namespace, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", workload=~"$workload"}))`,
};

export type NamespaceMemoryOverviewUsageKey = keyof typeof namespaceMemoryOverviewUsageQueries;

export const namespaceMemoryDistributionQuery = `sum by (cluster, namespace, workload, workload_type) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_memory_working_set_bytes{container!="", cluster="$cluster", namespace="$namespace"})) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", workload=~"$workload"}))`;

export const namespaceMemoryWorkloadAlignmentQuery = `sum by (cluster, namespace, workload, workload_type) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_memory_working_set_bytes{cluster="$cluster", namespace="$namespace"})) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", workload=~"$workload"})) / on (cluster,namespace,workload,workload_type) group_left() sum by (cluster, namespace, workload, workload_type) (max by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace"}) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", workload=~"$workload"}))`;
