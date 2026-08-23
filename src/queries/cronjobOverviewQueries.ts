// PromQL query builders for the CronJob Drilldown's Overview tab
// (getCronjobOverviewScene in jobsPage.tsx). Every query already knows the
// exact (cluster, namespace, cronjob) identity from the drilldown's own
// route params, so each is a plain exact-match selector rather than the All
// Jobs Cronjobs tab's own merged-across-every-cronjob queries
// (cronjobTableQueries in jobsQueries.ts) - same "no fallback/merge needed
// one level down" reasoning as workloadOverviewQueries.ts.

// `by (schedule)` - a bare `max(...)` with no grouping clause drops every
// label (including "schedule") from the result, leaving format:'table' with
// nothing to split into its own field for the Overview tab's "schedule:" row
// to read.
export function buildCronjobInfoQuery(clusterRegex: string, namespaceRegex: string, cronjob: string): string {
  return `max by (schedule) (kube_cronjob_info{cluster="${clusterRegex}", namespace="${namespaceRegex}", cronjob="${cronjob}"})`;
}

export function buildCronjobStatusQuery(clusterRegex: string, namespaceRegex: string, cronjob: string): string {
  return `max(kube_cronjob_spec_suspend{cluster="${clusterRegex}", namespace="${namespaceRegex}", cronjob="${cronjob}"})`;
}

export function buildCronjobLastScheduleQuery(clusterRegex: string, namespaceRegex: string, cronjob: string): string {
  return `max(kube_cronjob_status_last_schedule_time{cluster="${clusterRegex}", namespace="${namespaceRegex}", cronjob="${cronjob}"}) * 1000`;
}

export function buildCronjobNextScheduleQuery(clusterRegex: string, namespaceRegex: string, cronjob: string): string {
  return `max(kube_cronjob_next_schedule_time{cluster="${clusterRegex}", namespace="${namespaceRegex}", cronjob="${cronjob}"}) * 1000`;
}

// kube-state-metrics exposes a "kube_cronjob_created" gauge (creationTimestamp,
// Unix seconds) - same convention as workloadOverviewQueries.ts's own
// CREATED_METRIC_BY_TYPE table and the *1000/last_over_time([$__range:])
// wrapping (a plain instant lookup can miss the most recent scrape for a
// value that almost never changes, showing InfoCard's "–" fallback even
// though the object obviously exists).
export function buildCronjobCreatedQuery(clusterRegex: string, namespaceRegex: string, cronjob: string): string {
  return `max(last_over_time(kube_cronjob_created{cluster="${clusterRegex}", namespace="${namespaceRegex}", cronjob="${cronjob}"}[$__range])) * 1000`;
}

// "Cronjob optimization" panels ("CronJob CPU"/"CronJob Memory") - pasted
// verbatim from the given reference queries. Unlike every query above, these
// have no cronjob/job_name filter at all - only cluster+namespace - so on a
// namespace that hosts more than one CronJob (like this demo's own
// "cluster-tests"), the panel is genuinely namespace-wide, not scoped to just
// this one cronjob's own pods. Translated literally rather than "fixed" to
// add a job-name filter, per this project's usual "preserve what was given,
// even if it looks surprising" convention.
//
// The given `pod=~"()"` / `k8s_pod_name=~"()"` matchers are a captured
// Grafana template-variable artifact, not a real filter: Prometheus regex
// matching is fully anchored, so "()" (an empty capture group) matches only
// a truly empty pod label, which no real pod ever has - taken completely
// literally, every branch containing it would always return nothing. This
// page has no live Pod variable to have produced that value from (same
// situation as the Node Drilldown's own pod-less queries), so
// substituteCronjobResourceQuery below replaces it with ".+" (match every
// pod) - the same "no Pod picker on this page, so every pod-shaped token
// matches everything" idiom as substituteClusterNodeAndPod in
// nodeOverviewQueries.ts.
export const cronjobCpuOptimizationQueries = {
  limits: `sum(max by (cluster, namespace, node, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_limits{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"()"}))`,
  allocation: `max by (namespace) (max by (namespace) (sum by (namespace, resource) (max by (cluster, namespace, node, pod, container, resource) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"()"})) or sum by (namespace) (max by (cluster, namespace, node, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_rate5m{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"()"} or node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"()"}))) or max by (namespace) (sum by (namespace, cluster) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name) (k8s_container_cpu_request{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"()", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name") * on (cluster, node, pod) group_left() (label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"()", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name") <= bool 2 == 1)) or sum by (namespace) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (container_cpu_usage{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_container_name!="", k8s_namespace_name=~"util-ecommerce-prod", k8s_pod_name=~"()"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name"))))`,
  requests: `sum by (resource) (max by (cluster, namespace, node, pod, container, resource) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"()"}))`,
  usage: `sum(max by (cluster, namespace, node, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_rate5m{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"()"} or node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"()"}))`,
};

export type CronjobCpuOptimizationKey = keyof typeof cronjobCpuOptimizationQueries;

export const cronjobMemoryOptimizationQueries = {
  limits: `sum(max by (cluster, namespace, node, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"()"}))`,
  allocation: `max by (namespace) (max by (namespace) (sum by (namespace, resource) (max by (cluster, namespace, node, pod, container, resource) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"()"})) or sum by (namespace) (max by (cluster, node, namespace, pod, container, image) (node_namespace_pod_container:container_memory_working_set_bytes{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"()"}))) or max by (namespace) (sum by (namespace, cluster) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name) (k8s_container_memory_request_bytes{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"()", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name") * on (cluster, node, pod) group_left() (label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"()", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name") <= bool 2 == 1)) or sum by (namespace) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (container_memory_working_set_bytes{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"()", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name"))))`,
  requests: `sum(max by (cluster, namespace, node, pod, container, resource) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"()"}))`,
  usage: `sum(max by (cluster, namespace, pod, container) (max by (cluster, instance, namespace, pod, container, image, name) (container_memory_working_set_bytes{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"()"})) or max by (cluster, namespace, pod, container) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (container_memory_working_set_bytes{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"()", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name")))`,
};

export type CronjobMemoryOptimizationKey = keyof typeof cronjobMemoryOptimizationQueries;

// Handles both captured-empty-variable forms seen across this reference
// dashboard's own panels - "()" (Cronjob optimization panels above) and a
// plain "" (the CPU tab's own queries, cronjobCpuQueries.ts) - both are the
// same "Grafana resolved $pod to nothing, and there's no Pod picker on this
// page to give it a real value" situation, just captured at two different
// points in that variable's own life cycle.
export function substituteCronjobResourceQuery(expr: string, clusterRegex: string, namespaceRegex: string): string {
  return expr
    .replaceAll('cluster=~"appenv-grafana-play-cluster"', `cluster=~"${clusterRegex}"`)
    .replaceAll('k8s_cluster_name=~"appenv-grafana-play-cluster"', `k8s_cluster_name=~"${clusterRegex}"`)
    .replaceAll('namespace=~"util-ecommerce-prod"', `namespace=~"${namespaceRegex}"`)
    .replaceAll('k8s_namespace_name=~"util-ecommerce-prod"', `k8s_namespace_name=~"${namespaceRegex}"`)
    .replaceAll('pod=~"()"', 'pod=~".+"')
    .replaceAll('k8s_pod_name=~"()"', 'k8s_pod_name=~".+"')
    .replaceAll('pod=~""', 'pod=~".+"')
    .replaceAll('k8s_pod_name=~""', 'k8s_pod_name=~".+"');
}

// "Runs" table - one row per Job this CronJob has spawned, pasted verbatim
// from the given reference queries except for the job_name enumeration (see
// substituteCronjobRunsQuery below). Same query shapes as jobTableQueries in
// jobsQueries.ts (start/end_time/success/completion), plus a `failed` query
// that already carries its own `reason` label and `> 0` filter here (given
// this way, unlike jobTableQueries.failed which this project's own earlier
// session had to add from scratch).
export const cronjobRunsTableQueries = {
  start: `last_over_time(((
      max by (cluster, namespace, job_name, join_name) (label_join(kube_job_status_start_time{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29791140|background-load-29791200|background-load-29791260"}, "join_name", "-", "cluster", "namespace", "job_name")) > (time() - $__range)
    ))[$__range:]) * 1000`,
  end_time: `last_over_time((label_join(
          (
            max by (cluster, namespace, job_name) (kube_job_status_completion_time{job_name=~"background-load-29791140|background-load-29791200|background-load-29791260", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod"})
            or
            label_join(
                topk by (cluster, namespace, pod, owner_name) (1, max by (cluster, namespace, pod, owner_name) (kube_pod_owner{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", owner_name=~"background-load-29791140|background-load-29791200|background-load-29791260"})) * on (cluster, namespace, pod) group_left() (
                  max by (cluster, namespace, pod) (kube_pod_container_status_last_terminated_timestamp{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~""})
                )
              , "job_name", "", "owner_name")
            or
            max by (cluster, namespace, job_name) (last_over_time((
                  max by (cluster, namespace, job_name, join_name) (label_join(label_join(
                          topk by (cluster, namespace, pod, owner_name) (1, kube_pod_owner{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", owner_name=~"background-load-29791140|background-load-29791200|background-load-29791260"}) * on (cluster, namespace, pod) group_left() (
                            max by (cluster, namespace, pod) (timestamp(kube_pod_status_phase{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", phase=~"Failed"} == 1))
                          )
                        , "job_name", "", "owner_name"), "join_name", "-", "cluster", "namespace", "job_name"))
                )[$__range:]))
          )
        , "join_name", "-", "cluster", "namespace", "job_name"))[$__range:]) * 1000`,
  failed: `last_over_time((max by (cluster, namespace, job_name, reason, join_name) (label_join(kube_job_status_failed{reason!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29791140|background-load-29791200|background-load-29791260"} > 0, "join_name", "-", "cluster", "namespace", "job_name")))[$__range:])`,
  success: `label_join(last_over_time((max by (cluster, namespace, job_name) (kube_job_status_succeeded{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29791140|background-load-29791200|background-load-29791260"}))[$__range:]), "join_name", "-", "cluster", "namespace", "job_name")`,
  completion: `last_over_time((label_join(max by (cluster, namespace, job_name) (kube_job_spec_completions{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29791140|background-load-29791200|background-load-29791260"}), "join_name", "-", "cluster", "namespace", "job_name"))[$__range:])`,
};

export type CronjobRunsTableQueryKey = keyof typeof cronjobRunsTableQueries;

// The given queries enumerate a fixed, literal list of job names
// (job_name=~"background-load-<ts1>|background-load-<ts2>|..." - a snapshot
// of whichever specific Jobs existed when this reference was captured).
// Since this page is generic per-cronjob (route param, not a fixed list),
// that's replaced with a real "every Job this CronJob owns" regex instead:
// Kubernetes names a CronJob's own Jobs "<cronjob>-<unix-minutes>", so
// "${cronjob}-[0-9]+" matches every run regardless of when it happened -
// `pod=~""` (a real, literal empty-string matcher in the given END query,
// distinct from the resource queries' own "()" artifact above) is replaced
// the same way as "()" for the same "no Pod variable on this page" reason.
export function substituteCronjobRunsQuery(expr: string, clusterRegex: string, namespaceRegex: string, cronjobRegex: string): string {
  const jobNameRegex = `${cronjobRegex}-[0-9]+`;
  return expr
    .replaceAll('cluster=~"appenv-grafana-play-cluster"', `cluster=~"${clusterRegex}"`)
    .replaceAll('namespace=~"util-ecommerce-prod"', `namespace=~"${namespaceRegex}"`)
    .replaceAll('job_name=~"background-load-29791140|background-load-29791200|background-load-29791260"', `job_name=~"${jobNameRegex}"`)
    .replaceAll('owner_name=~"background-load-29791140|background-load-29791200|background-load-29791260"', `owner_name=~"${jobNameRegex}"`)
    .replaceAll('pod=~""', 'pod=~".+"');
}
