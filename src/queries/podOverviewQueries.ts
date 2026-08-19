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
