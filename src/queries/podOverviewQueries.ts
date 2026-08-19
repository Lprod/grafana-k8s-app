// PromQL query builders for the Pod Drilldown's Overview tab. Like
// workloadOverviewQueries.ts, every query here already knows the exact
// (cluster, namespace, pod) identity from the drilldown's own route params,
// so a plain metric selector is enough - no fallback/join chain needed.

// ALERTS already carries its own "pod" label directly (confirmed against the
// demo data and buildWorkloadAlertsSeverityQuery's own join, which only
// needs namespace_workload_pod:kube_pod_owner:relabel to *add*
// workload/workload_type - the join's own on(...,pod) clause only works
// because ALERTS already has a pod label to match against). So unlike the
// Workload Drilldown's version, this can filter by pod directly, no join.
export function buildPodAlertsSeverityQuery(clusterRegex: string, namespaceRegex: string, pod: string): string {
  return `count by (severity) (ALERTS{alertstate="firing", cluster="${clusterRegex}", namespace="${namespaceRegex}", pod="${pod}", alertname!~"ArgoCDSyncAlert"})`;
}

// Current phase (Running/Pending/Succeeded/Failed/Unknown) - kube-state-metrics
// exposes one boolean-gauge series per possible phase, the one currently "1"
// is the pod's real phase. Read off the "phase" label, not the value itself.
export function buildPodStatusQuery(clusterRegex: string, namespaceRegex: string, pod: string): string {
  return `max by (phase) (kube_pod_status_phase{cluster="${clusterRegex}", namespace="${namespaceRegex}", pod="${pod}"} == 1)`;
}

// kube-state-metrics reports Unix seconds; *1000 for Grafana's
// dateTimeFromNow unit, same convention as buildWorkloadCreatedQuery.
export function buildPodStartTimeQuery(clusterRegex: string, namespaceRegex: string, pod: string): string {
  return `max(kube_pod_start_time{cluster="${clusterRegex}", namespace="${namespaceRegex}", pod="${pod}"}) * 1000`;
}

// Summed across every container in the pod. "or vector(0)" so a pod with no
// restarts at all (the metric only gets scraped once a container has run)
// still shows a real "0" instead of the InfoCard's generic "-" no-data dash.
export function buildPodRestartsQuery(clusterRegex: string, namespaceRegex: string, pod: string): string {
  return `sum(kube_pod_container_status_restarts_total{cluster="${clusterRegex}", namespace="${namespaceRegex}", pod="${pod}"}) or vector(0)`;
}

// The node the pod is scheduled on - read off kube_pod_info's own "node" label.
export function buildPodNodeQuery(clusterRegex: string, namespaceRegex: string, pod: string): string {
  return `max by (node) (kube_pod_info{cluster="${clusterRegex}", namespace="${namespaceRegex}", pod="${pod}"})`;
}

// Container identity (name + deployed image) for the CPU/Memory tabs' own
// "Containers" table - given verbatim, and identical to
// workloadMemoryPodsTableQueries.timeline (workloadMemoryQueries.ts, which
// already needed container/image_spec for its own per-container merge key).
// Duplicated here rather than cross-imported from that Memory-specific file
// so both podCpuScene.tsx and podMemoryScene.tsx can depend on one
// Pod-scoped source - podCpuScene.tsx in particular needs it since
// workloadCpuPodsTableQueries.timeline (the CPU tab's own equivalent) never
// carried container/image_spec at all, only cluster/namespace/workload/
// workload_type/pod.
export const podContainerInfoQuery = `group by (cluster, namespace, pod, container, workload, workload_type, image_spec) (kube_pod_container_info{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"} / on (cluster, namespace, pod) group_left(workload,workload_type) group by (cluster, namespace, workload, workload_type, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod", workload=~"$workload"}))`;

// "Containers" table (Overview tab) - one row per container in the pod,
// queried directly at container granularity (plain instant values, no
// quantile_over_time(0.95) range aggregation). Deliberately not the CPU/
// Memory tabs' own pod-level p95 queries (workloadCpuPodsTableQueries.cpuAgg
// / workloadMemoryPodsTableQueries.memAgg): those compute the *pod's total*
// p95 usage and, having no "container" dimension of their own, repeat that
// one pod-level number on every container row instead of breaking it down
// per container - inflated and misleading for a multi-metric container
// listing. This mirrors the reference Kubernetes dashboards' own Containers
// table instead: current per-container usage/requests/limits, `pod="$pod"`
// exact match since the Pod Drilldown already knows one literal pod.
export const podContainersTableQueries = {
  info: `last_over_time((max by (cluster, namespace, pod, container, image_spec) (kube_pod_container_info{pod="$pod", cluster="$cluster", namespace="$namespace"}))[$__range:])`,
  cpuUsage: `sum(node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="$cluster", namespace="$namespace", pod="$pod", container!=""}) by (container)`,
  cpuRequests: `sum(cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{cluster="$cluster", namespace="$namespace", pod="$pod", container!=""}) by (container)`,
  memUsage: `sum(container_memory_working_set_bytes{job="kubelet", metrics_path="/metrics/cadvisor", cluster="$cluster", namespace="$namespace", pod="$pod", container!="", image!=""}) by (container)`,
  memRequests: `sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{cluster="$cluster", namespace="$namespace", pod="$pod"}) by (container)`,
  memLimits: `sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{cluster="$cluster", namespace="$namespace", pod="$pod"}) by (container)`,
};

export type PodContainersTableQueryKey = keyof typeof podContainersTableQueries;
