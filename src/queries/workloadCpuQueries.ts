// PromQL queries for the Workload Drilldown's CPU tab
// (src/pages/Workloads/workloadCpuScene.tsx), pasted verbatim from Grafana's
// own Kubernetes Monitoring app - literal $cluster/$namespace/$workload/$pod
// placeholders, substituted via substituteWorkloadTokens
// (workloadOverviewQueries.ts). Structurally mirrors namespaceCpuQueries.ts
// (the Namespace Drilldown's own CPU tab), but scoped one level deeper -
// down to the individual pods of one already-known workload instead of the
// workloads within a namespace.

export const workloadCpuStatQueries = {
  alertsFiring: `count(ALERTS{cluster="$cluster", alertstate=~"firing", alertname=~"Kube.*|CPUThrottlingHigh", namespace="$namespace", pod=~"$pod"}) or vector(0)`,
  schedulingRequestsSet: `count(group by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"})) / count(group by (cluster, namespace, pod, container) (kube_pod_container_info{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))`,
  alignmentUsageRequests: `sum by () (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"})) / sum by () (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))`,
};

export type WorkloadCpuStatKey = keyof typeof workloadCpuStatQueries;

// "Overview: Usage (vCPU cores)" - refIds match applyCpuUsageSeriesOverrides'
// matchers (limits/requests/usage), same red-dashed/orange-dashed/blue-solid
// styling as the Namespace Drilldown's own CPU tab.
export const workloadCpuOverviewUsageQueries = {
  limits: `sum by () (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_limits{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))`,
  requests: `sum by () (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))`,
  usage: `sum by () (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))`,
};

export type WorkloadCpuOverviewUsageKey = keyof typeof workloadCpuOverviewUsageQueries;

// "Distribution: Pod usage" - same shape as the Namespace Drilldown's own
// "Distribution: Workload usage", grouped one level deeper (by pod, not just
// workload) since this page is already scoped to a single workload.
export const workloadCpuDistributionQuery = `sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"})) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~"$workload"}))`;

export const workloadCpuPodAlignmentQuery = `sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="$cluster", namespace="$namespace", pod=~"$pod"})) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~"$workload"})) / on (cluster,namespace,workload,workload_type,pod) group_left() sum by (cluster, namespace, workload, workload_type, pod) (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~"$workload"}))`;

// "Workloads" table - one row per pod belonging to this workload (given
// verbatim; the heading says "Workloads" even though it's pod-granular here,
// matching the Namespace Drilldown CPU tab's own table title literally
// rather than "fixing" it to say "Pods"). All 4 queries carry the exact same
// (cluster, namespace, workload, workload_type, pod, join_key) label set, so
// "merge" (see workloadCpuScene.tsx) matches rows unambiguously by all of
// them at once.
export const workloadCpuPodsTableQueries = {
  timeline: `label_join(group by (cluster, namespace, workload, workload_type, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~"$workload"}), "join_key", ".", "cluster", "namespace", "workload", "workload_type", "pod")`,
  requests: `label_join(last_over_time((sum by (cluster, namespace, workload, workload_type, pod) (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~"$workload"})))[$__range:]), "join_key", ".", "cluster", "namespace", "workload", "workload_type", "pod")`,
  cpuAgg: `label_join(quantile_over_time(0.95, sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"})) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~"$workload"}))[$__range:1m]), "join_key", ".", "cluster", "namespace", "workload", "workload_type", "pod")`,
  cpuAggPercent: `label_join(quantile_over_time(0.95, sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"})) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~"$workload"}))[$__range:1m]) / quantile_over_time(0.95, sum by (cluster, namespace, workload, workload_type, pod) (max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}) * on (cluster,namespace,pod) group_left(workload,workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~"$workload"}))[$__range:1m]), "join_key", ".", "cluster", "namespace", "workload", "workload_type", "pod")`,
};

export type WorkloadCpuPodsTableQueryKey = keyof typeof workloadCpuPodsTableQueries;
