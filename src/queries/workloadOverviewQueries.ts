// PromQL query builders for the Workload Drilldown's Overview tab. Unlike
// workloadQueries.ts's big multi-workload OR-chains (which have to cover
// every workload in a namespace at once via fallback branches), every query
// here already knows the exact (cluster, namespace, workload, workload_type)
// identity from the drilldown's own route params, so a single type-specific
// metric selector is enough - no fallback chain needed.

export const WORKLOAD_TYPE_LABELS: Record<string, string> = {
  deployment: 'Deployment',
  daemonset: 'DaemonSet',
  statefulset: 'StatefulSet',
  job: 'Job',
  pod: 'Pod',
  staticpod: 'Static Pod',
  replicaset: 'ReplicaSet',
};

export function formatWorkloadTypeLabel(workloadType: string): string {
  return WORKLOAD_TYPE_LABELS[workloadType] ?? workloadType;
}

// Alerts don't carry a "workload" label of their own - joined against
// namespace_workload_pod:kube_pod_owner:relabel the same way workloadQueries.ts's
// cpu/mem queries attribute a pod to its workload, via `pod`. Alerts with no
// `pod` label at all (e.g. node-level alerts) simply drop out of the join,
// which is correct here - they aren't attributable to any single workload.
export function buildWorkloadAlertsSeverityQuery(
  clusterRegex: string,
  namespaceRegex: string,
  workload: string,
  workloadType: string
): string {
  return `count by (severity) (
    ALERTS{alertstate="firing", cluster="${clusterRegex}", namespace="${namespaceRegex}", alertname!~"ArgoCDSyncAlert"}
    * on (cluster, namespace, pod) group_left (workload, workload_type)
    namespace_workload_pod:kube_pod_owner:relabel{cluster="${clusterRegex}", namespace="${namespaceRegex}", workload="${workload}", workload_type="${workloadType}"}
  )`;
}

// ready/desired metric + own identifying label per workload kind - same
// metrics workloadQueries.ts's ready_pods/desired_pods OR-chain reads for
// each kind's branch, just selected directly instead of unioned.
const READY_DESIRED_METRIC_BY_TYPE: Record<string, { ready: string; desired: string; label: string }> = {
  deployment: { ready: 'kube_deployment_status_replicas_available', desired: 'kube_deployment_spec_replicas', label: 'deployment' },
  daemonset: { ready: 'kube_daemonset_status_number_ready', desired: 'kube_daemonset_status_desired_number_scheduled', label: 'daemonset' },
  statefulset: { ready: 'kube_statefulset_status_replicas_ready', desired: 'kube_statefulset_replicas', label: 'statefulset' },
  job: { ready: 'kube_job_status_succeeded', desired: 'kube_job_spec_completions', label: 'job_name' },
  replicaset: { ready: 'kube_replicaset_status_ready_replicas', desired: 'kube_replicaset_spec_replicas', label: 'replicaset' },
};

export function buildWorkloadReadyDesiredQueries(
  workloadType: string,
  clusterRegex: string,
  namespaceRegex: string,
  workload: string
): { ready: string; desired: string } {
  // Bare/static pods have no replica concept - kube_pod_owner is a
  // boolean-gauge "1" while the pod exists, so it doubles as both ready and
  // desired, same as workloadQueries.ts's own bare/static pod branches.
  if (workloadType === 'pod' || workloadType === 'staticpod') {
    const ownerKind = workloadType === 'staticpod' ? 'Node' : '';
    const expr = `max(kube_pod_owner{cluster="${clusterRegex}", namespace="${namespaceRegex}", pod="${workload}", owner_kind="${ownerKind}"})`;
    return { ready: expr, desired: expr };
  }
  const entry = READY_DESIRED_METRIC_BY_TYPE[workloadType] ?? READY_DESIRED_METRIC_BY_TYPE.deployment;
  return {
    ready: `max(${entry.ready}{cluster="${clusterRegex}", namespace="${namespaceRegex}", ${entry.label}="${workload}"})`,
    desired: `max(${entry.desired}{cluster="${clusterRegex}", namespace="${namespaceRegex}", ${entry.label}="${workload}"})`,
  };
}

// kube-state-metrics exposes a "<kind>_created" metric (the object's
// creationTimestamp, Unix seconds) for every workload kind.
const CREATED_METRIC_BY_TYPE: Record<string, { metric: string; label: string }> = {
  deployment: { metric: 'kube_deployment_created', label: 'deployment' },
  daemonset: { metric: 'kube_daemonset_created', label: 'daemonset' },
  statefulset: { metric: 'kube_statefulset_created', label: 'statefulset' },
  job: { metric: 'kube_job_created', label: 'job_name' },
  replicaset: { metric: 'kube_replicaset_created', label: 'replicaset' },
  pod: { metric: 'kube_pod_created', label: 'pod' },
  staticpod: { metric: 'kube_pod_created', label: 'pod' },
};

export function buildWorkloadCreatedQuery(workloadType: string, clusterRegex: string, namespaceRegex: string, workload: string): string {
  const entry = CREATED_METRIC_BY_TYPE[workloadType] ?? CREATED_METRIC_BY_TYPE.deployment;
  // *1000: kube-state-metrics reports Unix seconds, Grafana's dateTimeFromNow
  // unit (same as the All Jobs page's LAST SUCCEEDED/LAST SCHEDULE columns)
  // expects milliseconds. last_over_time(...[$__range:]) - same defensive
  // wrapping as every other single-sample instant lookup in this file (e.g.
  // workloadPodsTableQueries.info) - a plain instant query can miss the most
  // recent scrape/evaluation cycle and return no data at all for a value
  // that barely ever changes, showing the InfoCard's "–" fallback even
  // though the object obviously exists.
  return `max(last_over_time(${entry.metric}{cluster="${clusterRegex}", namespace="${namespaceRegex}", ${entry.label}="${workload}"}[$__range])) * 1000`;
}

// Substitutes the literal $cluster/$namespace/$workload/$pod placeholders
// used by the queries below (pasted verbatim from Grafana's own Kubernetes
// Monitoring app) - $cluster/$namespace/$workload are baked in directly
// (this page has no live scene variable for any of the three, it's scoped to
// exactly one of each via the drilldown route), $pod is swapped for a live
// `${pod:regex}` token pointing at a *hidden* Pod variable (every pod
// belonging to this one workload - see createPodFilterVariable's `workload`
// option) so Grafana itself resolves it at query-run time.
export function substituteWorkloadTokens(
  expr: string,
  clusterRegex: string,
  namespaceRegex: string,
  workloadRegex: string,
  podToken: string
): string {
  return expr
    .replaceAll('$cluster', clusterRegex)
    .replaceAll('$namespace', namespaceRegex)
    .replaceAll('$workload', workloadRegex)
    .replaceAll('$pod', podToken);
}

// "Workload optimization" section (Overview tab) - CPU/Memory
// allocation/limits/requests/usage timeseries, pasted verbatim from Grafana's
// own Kubernetes Monitoring app. Kept as given even where it's internally
// inconsistent with its own siblings - e.g. cpu's queries match cluster/
// namespace with `=~`, memory's with `=` - same "translate literally, don't
// fix" convention as every other tab's queries in this codebase.
export const workloadCpuOptimizationQueries = {
  allocation: `max(sum by (resource) (max by (cluster, namespace, node, pod, container, resource) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"})) or sum(max by (cluster, namespace, node, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="", cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"})))`,
  limits: `sum(max by (cluster, namespace, node, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_limits{container!="", cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"}))`,
  requests: `sum by (resource) (max by (cluster, namespace, node, pod, container, resource) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"}))`,
  usage: `sum(max by (cluster, namespace, node, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="", cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"}))`,
};

export type WorkloadCpuOptimizationKey = keyof typeof workloadCpuOptimizationQueries;

export const workloadMemoryOptimizationQueries = {
  allocation: `max by (namespace) (
        sum by (namespace, resource) (kube_pod_container_resource_requests{cluster="$cluster", namespace="$namespace", pod=~"$pod", container!="", resource="memory"})
        OR
        sum by (namespace) (max by (namespace, pod, container) (container_memory_working_set_bytes{cluster="$cluster", namespace="$namespace", pod=~"$pod", container!=""}))
      )`,
  limits: `sum(max by (cluster, namespace, node, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))`,
  requests: `sum(max by (cluster, namespace, node, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))`,
  usage: `sum(
    container_memory_working_set_bytes{cluster="$cluster", namespace="$namespace", container!="", image!=""}
  * on(namespace,pod)
    group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod"}
)`,
};

export type WorkloadMemoryOptimizationKey = keyof typeof workloadMemoryOptimizationQueries;

// "Pods" table (Overview tab) - one row per pod belonging to this workload.
// memRequests/memLimits/cpuRequests all sum away their inner `max by (...,
// container)` grouping via an outer `sum by (cluster, namespace, pod)`,
// same as the Node Drilldown's own pods table (nodePodsTableQueries) and
// cpuUsage's own plain `by (cluster, namespace, pod)` shape - every query in
// this set now ends up with that exact same (cluster, namespace, pod) field
// set, nothing more. Two real bugs this avoids: (a) a multi-container pod
// would otherwise contribute one row per container to the table's "merge"
// transformation for whichever query still carried a "container" dimension,
// fanning out every other column's value across N duplicate rows instead of
// yielding one row per pod; (b) cpuRequests used to additionally carry
// workload/workload_type/join_key fields (from an inner `label_join` +
// workload-attribution join, dropped now that $pod is already correctly
// workload-scoped by createPodFilterVariable - see its own comment) that
// none of its merge siblings had, which broke the calculateField division
// feeding CPU REQUESTS' percent/color further below - cpuRequests being the
// only query with a differently-shaped output than cpuUsage silently
// desynced "Value #cpuUsage / Value #cpuRequests" per row, unlike the
// memory side (memUsage/memRequests/memLimits), which never had that
// mismatch and always computed correctly.
export const workloadPodsTableQueries = {
  // Takes the most recent entry of each pod (ip/uid can change over time),
  // joined against its workload attribution and its most recent phase.
  info: `topk by (cluster, namespace, workload, workload_type, pod) (1,
      max by (cluster, namespace, pod, node, pod_ip, uid, asserts_env, asserts_site) (
        last_over_time((timestamp(kube_pod_info{cluster="$cluster", namespace=~"$namespace", node=~".+", pod=~"$pod"}))[$__range:])
      )
      * on (cluster, namespace, pod) group_left (workload, workload_type)
      last_over_time((group by (cluster, namespace, workload, workload_type, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace=~"$namespace", workload=~"$workload", pod=~"$pod"}))[$__range:])
      * on (cluster, namespace, pod) group_left (phase)
      group by (cluster, namespace, pod, phase) (
        topk by (cluster, namespace, pod) (1,
          last_over_time((timestamp(kube_pod_status_phase{cluster="$cluster", namespace=~"$namespace", pod=~"$pod"} == 1))[$__range:])
        )
      )
    )`,
  infoWaiting: `sum by (cluster, namespace, pod, reason) (kube_pod_container_status_waiting_reason{cluster="$cluster", namespace=~"$namespace", pod=~"$pod"} > 0)`,
  cpuUsage: `sum(node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="$cluster", namespace=~"$namespace", pod=~"$pod"}) by (cluster, namespace, pod)`,
  cpuRequests: `sum by (cluster, namespace, pod) (last_over_time((max by (cluster, namespace, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))[$__range:]))`,
  memUsage: `sum(
    container_memory_working_set_bytes{cluster="$cluster", namespace="$namespace", container!="", image!=""}
  * on(namespace,pod)
    group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod"}
) by (pod)`,
  memRequests: `sum by (cluster, namespace, pod) (last_over_time((max by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))[$__range:]))`,
  memLimits: `sum by (cluster, namespace, pod) (last_over_time((max by (cluster, namespace, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{container!="", cluster="$cluster", namespace="$namespace", pod=~"$pod"}))[$__range:]))`,
};

export type WorkloadPodsTableQueryKey = keyof typeof workloadPodsTableQueries;
