// PromQL queries for the Workload Drilldown's Memory tab
// (src/pages/Workloads/workloadMemoryScene.tsx), pasted verbatim from
// Grafana's own Kubernetes Monitoring app - literal $cluster/$namespace/
// $workload/$pod placeholders, substituted via substituteWorkloadTokens
// (workloadOverviewQueries.ts). Structurally mirrors namespaceMemoryQueries.ts
// (the Namespace Drilldown's own Memory tab), but scoped one level deeper -
// down to the individual pods of one already-known workload instead of the
// workloads within a namespace. alertsFiring still references
// "CPUThrottlingHigh" alongside "Kube.*" - given verbatim, same as
// namespaceMemoryQueries.ts's own copy, not "fixed" to drop the CPU-specific
// alertname.

export const workloadMemoryStatQueries = {
  alertsFiring: `count(ALERTS{cluster="$cluster", alertstate=~"firing", alertname=~"Kube.*|CPUThrottlingHigh", namespace="$namespace", pod=~"$pod"}) or vector(0)`,
  schedulingRequestsSet: `count(group by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="", cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"})) / count(group by (cluster, namespace, pod, container) (kube_pod_container_info{container!="", cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"}))`,
  alignmentUsageRequests: `sum by () (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_memory_working_set_bytes{container!="", cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"})) / sum by () (max by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="", cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"}))`,
};

export type WorkloadMemoryStatKey = keyof typeof workloadMemoryStatQueries;

// "Overview: Usage (memory bytes)" - refIds match applyMemoryUsageSeriesOverrides'
// matchers (limits/requests/usage), same red-dashed/orange-dashed/blue-solid
// styling as the Namespace Drilldown's own Memory tab.
export const workloadMemoryOverviewUsageQueries = {
  limits: `sum by () (max by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{container!="", cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"}))`,
  requests: `sum by () (max by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="", cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"}))`,
  usage: `sum by () (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_memory_working_set_bytes{container!="", cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"}))`,
};

export type WorkloadMemoryOverviewUsageKey = keyof typeof workloadMemoryOverviewUsageQueries;

// "Distribution: Pod usage" - same shape as the Namespace Drilldown's own
// "Distribution: Workload usage", grouped one level deeper (by pod, not just
// workload) since this page is already scoped to a single workload.
export const workloadMemoryDistributionQuery = `sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_memory_working_set_bytes{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"})) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~"$workload"}))`;

export const workloadMemoryPodAlignmentQuery = `sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_memory_working_set_bytes{cluster="$cluster", namespace="$namespace", pod=~"$pod"})) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~"$workload"})) / on (cluster,namespace,workload,workload_type,pod) group_left() sum by (cluster, namespace, workload, workload_type, pod) (max by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~"$workload"}))`;

// "Pods" table - one row per (pod, container). Unlike the CPU tab's own
// pods-table queries, none of these are wrapped in label_join, and only
// "timeline" carries workload/workload_type/image_spec at all - "merge"
// (see workloadMemoryScene.tsx) matches rows by the fields common to every
// query instead, (cluster, namespace, pod, container). Kept as given even
// though that's a finer grain than the CPU table's own (pod-only) merge key
// - in practice this still yields one row per pod as long as each pod has a
// single container, same "translate literally" caveat as the Overview tab's
// own memRequests/memLimits queries.
export const workloadMemoryPodsTableQueries = {
  timeline: `group by (cluster, namespace, pod, container, workload, workload_type, image_spec) (kube_pod_container_info{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"} / on (cluster, namespace, pod) group_left(workload,workload_type) group by (cluster, namespace, workload, workload_type, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~"$workload"}))`,
  requests: `last_over_time((max by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))[$__range:])`,
  memAgg: `quantile_over_time(0.95, max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_memory_working_set_bytes{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"})[$__range:1m])`,
  memAggPercent: `quantile_over_time(0.95, max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_memory_working_set_bytes{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"})[$__range:1m]) / quantile_over_time(0.95, max by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"})[$__range:1m])`,
};

export type WorkloadMemoryPodsTableQueryKey = keyof typeof workloadMemoryPodsTableQueries;
