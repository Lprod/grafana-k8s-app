// PromQL query builders for the Job Drilldown's Overview tab
// (getJobOverviewScene in jobsPage.tsx). Every query already knows the exact
// (cluster, namespace, job_name) identity from the drilldown's own route
// params, so each is a plain exact-match selector - same "no fallback/merge
// needed one level down" reasoning as cronjobOverviewQueries.ts.

// kube_job_owner is empty (owner_kind="") for a standalone Job (see gotcha
// #31 in the All Jobs page's own build notes: Prometheus drops a label
// entirely when its value is the empty string, rather than keeping the field
// with an empty value) - the Overview tab treats a missing owner_name/
// owner_kind field as "not controlled by anything" rather than an error.
export function buildJobOwnerQuery(clusterRegex: string, namespaceRegex: string, jobName: string): string {
  return `max by (owner_name, owner_kind) (kube_job_owner{cluster="${clusterRegex}", namespace="${namespaceRegex}", job_name="${jobName}"})`;
}

export function buildJobStartQuery(clusterRegex: string, namespaceRegex: string, jobName: string): string {
  return `max(last_over_time(kube_job_status_start_time{cluster="${clusterRegex}", namespace="${namespaceRegex}", job_name="${jobName}"}[$__range])) * 1000`;
}

// kube_job_status_completion_time is only ever set for a Job that actually
// succeeded (real kube-state-metrics behavior, not a demo-data gap) - a
// failed Job's own "end" has to fall back to its last pod's Failed-phase or
// last-terminated timestamp instead, same three-branch `or` chain as the All
// Jobs page's own jobTableQueries.end_time, just scoped down to this one
// job_name/owner_name (exact match) instead of that page's cluster-wide
// merge-across-every-job version.
export function buildJobEndQuery(clusterRegex: string, namespaceRegex: string, jobName: string): string {
  return `last_over_time((
      (
        max(kube_job_status_completion_time{job_name="${jobName}", cluster="${clusterRegex}", namespace="${namespaceRegex}"})
      )
      or
      (
        max(
          topk by (cluster, namespace, pod, owner_name) (1, kube_pod_owner{cluster="${clusterRegex}", namespace="${namespaceRegex}", owner_name="${jobName}"})
          * on (cluster, namespace, pod) group_left() (
            max by (cluster, namespace, pod) (timestamp(kube_pod_status_phase{cluster="${clusterRegex}", namespace="${namespaceRegex}", phase="Failed"} == 1))
          )
        )
      )
      or
      (
        max(
          topk by (cluster, namespace, pod, owner_name) (1, kube_pod_owner{cluster="${clusterRegex}", namespace="${namespaceRegex}", owner_name="${jobName}"})
          * on (cluster, namespace, pod) group_left() (
            max by (cluster, namespace, pod) (kube_pod_container_status_last_terminated_timestamp{cluster="${clusterRegex}", namespace="${namespaceRegex}"})
          )
        )
      )
    )[$__range:]) * 1000`;
}

export function buildJobSuccessQuery(clusterRegex: string, namespaceRegex: string, jobName: string): string {
  return `last_over_time((max(kube_job_status_succeeded{job_name="${jobName}", cluster="${clusterRegex}", namespace="${namespaceRegex}"}))[$__range:])`;
}

export function buildJobFailedQuery(clusterRegex: string, namespaceRegex: string, jobName: string): string {
  return `last_over_time((max(kube_job_status_failed{job_name="${jobName}", cluster="${clusterRegex}", namespace="${namespaceRegex}"}))[$__range:])`;
}

// "Job optimization" panels (Job CPU/Job Memory) - pasted verbatim from the
// given reference queries, one level deeper than the CronJob Drilldown's own
// namespace-wide optimization panels: these carry a real `pod=~"(...)"`
// matcher (a *resolved* Grafana template variable, unlike the CronJob-level
// queries' own always-empty "()" artifact) - scoped to exactly this Job's
// own pod(s). Since a Job can have more than one pod (retries/parallelism),
// this page creates a genuine hidden Pod variable (same "one level deeper
// needs a real variable" pattern as the Workload Drilldown's own CPU/Memory
// tabs) rather than reusing the CronJob Drilldown's "no picker, so match
// everything" idiom - substituteJobResourceQuery below swaps the given
// literal pod name for that variable's own `${pod:regex}` token.
export const jobCpuOptimizationQueries = {
  limits: `sum(max by (cluster, namespace, node, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_limits{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"(background-load-29791140-5m7cr)"}))`,
  allocation: `max by (namespace) (max by (namespace) (sum by (namespace, resource) (max by (cluster, namespace, node, pod, container, resource) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"(background-load-29791140-5m7cr)"})) or sum by (namespace) (max by (cluster, namespace, node, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_rate5m{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"(background-load-29791140-5m7cr)"} or node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"(background-load-29791140-5m7cr)"}))) or max by (namespace) (sum by (namespace, cluster) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name) (k8s_container_cpu_request{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"(background-load-29791140-5m7cr)", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name") * on (cluster, node, pod) group_left() (label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"(background-load-29791140-5m7cr)", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name") <= bool 2 == 1)) or sum by (namespace) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (container_cpu_usage{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_container_name!="", k8s_namespace_name=~"util-ecommerce-prod", k8s_pod_name=~"(background-load-29791140-5m7cr)"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name"))))`,
  requests: `sum by (resource) (max by (cluster, namespace, node, pod, container, resource) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"(background-load-29791140-5m7cr)"}))`,
  usage: `sum(max by (cluster, namespace, node, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_rate5m{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"(background-load-29791140-5m7cr)"} or node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"(background-load-29791140-5m7cr)"}))`,
};

export type JobCpuOptimizationKey = keyof typeof jobCpuOptimizationQueries;

export const jobMemoryOptimizationQueries = {
  limits: `sum(max by (cluster, namespace, node, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"(background-load-29791140-5m7cr)"}))`,
  allocation: `max by (namespace) (max by (namespace) (sum by (namespace, resource) (max by (cluster, namespace, node, pod, container, resource) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"(background-load-29791140-5m7cr)"})) or sum by (namespace) (max by (cluster, node, namespace, pod, container, image) (node_namespace_pod_container:container_memory_working_set_bytes{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"(background-load-29791140-5m7cr)"}))) or max by (namespace) (sum by (namespace, cluster) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name) (k8s_container_memory_request_bytes{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"(background-load-29791140-5m7cr)", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name") * on (cluster, node, pod) group_left() (label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"(background-load-29791140-5m7cr)", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name") <= bool 2 == 1)) or sum by (namespace) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (container_memory_working_set_bytes{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"(background-load-29791140-5m7cr)", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name"))))`,
  requests: `sum(max by (cluster, namespace, node, pod, container, resource) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"(background-load-29791140-5m7cr)"}))`,
  usage: `sum(max by (cluster, namespace, pod, container) (max by (cluster, instance, namespace, pod, container, image, name) (container_memory_working_set_bytes{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"(background-load-29791140-5m7cr)"})) or max by (cluster, namespace, pod, container) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (container_memory_working_set_bytes{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"(background-load-29791140-5m7cr)", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name")))`,
};

export type JobMemoryOptimizationKey = keyof typeof jobMemoryOptimizationQueries;

// Handles both captured-pod-variable forms seen across this reference
// dashboard's own panels - a *resolved* literal pod name in parens (the
// Overview tab's own "Job optimization" panels above, captured against a
// single-pod reference Job) and a plain empty "" (the CPU/Memory tabs' own
// queries, reused byte-for-byte from cronjobCpuQueries.ts/
// cronjobMemoryQueries.ts) - both get the same real hidden Pod variable
// token here, unlike the CronJob Drilldown's own substituteCronjobResourceQuery
// (no Pod picker at that level, so it maps to ".+" instead).
export function substituteJobResourceQuery(expr: string, clusterRegex: string, namespaceRegex: string, podToken: string): string {
  return expr
    .replaceAll('cluster=~"appenv-grafana-play-cluster"', `cluster=~"${clusterRegex}"`)
    .replaceAll('k8s_cluster_name=~"appenv-grafana-play-cluster"', `k8s_cluster_name=~"${clusterRegex}"`)
    .replaceAll('namespace=~"util-ecommerce-prod"', `namespace=~"${namespaceRegex}"`)
    .replaceAll('k8s_namespace_name=~"util-ecommerce-prod"', `k8s_namespace_name=~"${namespaceRegex}"`)
    .replaceAll('pod=~"(background-load-29791140-5m7cr)"', `pod=~"${podToken}"`)
    .replaceAll('k8s_pod_name=~"(background-load-29791140-5m7cr)"', `k8s_pod_name=~"${podToken}"`)
    .replaceAll('pod=~""', `pod=~"${podToken}"`)
    .replaceAll('k8s_pod_name=~""', `k8s_pod_name=~"${podToken}"`);
}

// "Pods" table (POD/CURRENT PHASE/START/END/DURATION/RESTART POLICY) -
// pasted verbatim from the given reference queries except for the job-name
// selector (see substituteJobPodsTableQuery below). owner_name identifies
// this Job's own pods directly (no fallback chain needed - same "exact
// identity already known one level down" reasoning as every other query on
// this page); the pod=~"<job>.*" matchers on the joined-in metrics exist
// because a Job's pod names are the job name plus a random suffix
// (Kubernetes' own naming convention), not because of any uncertainty about
// which job owns them.
export const jobPodsTableQueries = {
  pods: `last_over_time((max by (owner_name, pod) (kube_pod_owner{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", owner_name=~"background-load-29791140"}))[$__range:])`,
  phase: `last_over_time((max by (cluster, namespace, pod) (kube_pod_owner{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", owner_name=~"background-load-29791140"}) * on (cluster, namespace, pod) group_left(phase) (
      max by (cluster, namespace, phase, pod) (kube_pod_status_phase{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", phase=~"Failed|Pending|Running|Succeeded", pod=~"background-load-29791140.*"} == 1)
    ))[$__range:])`,
  end: `last_over_time((max by (cluster, namespace, pod) (kube_pod_owner{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", owner_name=~"background-load-29791140"}) * on (cluster, namespace, pod) group_left() (
      max by (cluster, namespace, pod) (kube_pod_container_status_last_terminated_timestamp{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"background-load-29791140.*"})
      or
      max by (cluster, namespace, pod) (kube_pod_completion_time{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"background-load-29791140.*"})
    ))[$__range:]) * 1000`,
  start: `last_over_time((max by (cluster, namespace, pod) (kube_pod_owner{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", owner_name=~"background-load-29791140"}) * on (cluster, namespace, pod) group_left() (
      max by (cluster, namespace, pod) (kube_pod_start_time{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"background-load-29791140.*"})
    ))[$__range:]) * 1000`,
  restartPolicy: `last_over_time((max by (cluster, namespace, pod) (kube_pod_owner{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", owner_name=~"background-load-29791140"}) * on (cluster, namespace, pod) group_left(type) (
      max by (cluster, namespace, pod, type) (kube_pod_restart_policy{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"background-load-29791140.*"})
    ))[$__range:])`,
  // Not one of this table's own visible columns - stashed onto the CURRENT
  // PHASE cell instead (see jobPodPhaseCell in jobsPage.tsx), same
  // attach-then-render idea as every other "extra context on an existing
  // column" cell in this app.
  reason: `last_over_time((
      max by (cluster, namespace, pod) (kube_pod_owner{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", owner_name=~"background-load-29791140"})
      * on(cluster, namespace, pod) group_left(reason)
      (
        max by (cluster, namespace, pod, reason) (kube_pod_container_status_last_terminated_reason{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"background-load-29791140.*"})
        or
        max by (cluster, namespace, pod, reason) (kube_pod_container_status_terminated_reason{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"background-load-29791140.*"})
      )
    )[$__range:])`,
};

export type JobPodsTableQueryKey = keyof typeof jobPodsTableQueries;

export function substituteJobPodsTableQuery(expr: string, clusterRegex: string, namespaceRegex: string, jobRegex: string): string {
  return expr
    .replaceAll('cluster=~"appenv-grafana-play-cluster"', `cluster=~"${clusterRegex}"`)
    .replaceAll('namespace=~"util-ecommerce-prod"', `namespace=~"${namespaceRegex}"`)
    .replaceAll('owner_name=~"background-load-29791140"', `owner_name=~"${jobRegex}"`)
    .replaceAll('pod=~"background-load-29791140.*"', `pod=~"${jobRegex}.*"`);
}

// Per-pod "Pod phase: <pod>" state-timeline panels - one per pod this Job
// owns, built by a SceneByFrameRepeater over jobPodsTableQueries.pods' own
// result (see getJobPodPhaseRepeater in jobsPage.tsx). podRegex here is a
// single already-known, already-escaped pod name (not a variable) - each
// repeated panel is scoped to exactly the one pod it represents.
export function buildJobPodPhaseQuery(clusterRegex: string, namespaceRegex: string, podRegex: string): string {
  return `group by (phase) (kube_pod_status_phase{phase!="", cluster=~"${clusterRegex}", namespace=~"${namespaceRegex}", pod=~"${podRegex}"} == 1)`;
}

export function buildJobPodReasonQuery(clusterRegex: string, namespaceRegex: string, podRegex: string): string {
  return `group by (reason) (kube_pod_container_status_terminated_reason{cluster=~"${clusterRegex}", namespace=~"${namespaceRegex}", pod=~"${podRegex}"})`;
}

// "Previous runs" table - every other run of this same recurring Job
// (same name minus its own trailing "-<unix-minutes>" suffix, the same
// naming convention as a CronJob's own spawned Jobs - see
// substituteCronjobRunsQuery's own comment in cronjobOverviewQueries.ts)
// that started before *this* Job's own start time. Degrades cleanly for a
// truly standalone one-off Job with no numeric suffix at all (e.g.
// "db-migrate"): the derived family regex just won't match anything else,
// so the table is legitimately empty rather than erroring.
//
// Pasted verbatim from the given reference queries, which captured one
// concrete sibling-job enumeration (the family) and one concrete "this job"
// reference - both get substituted below, same two-token-replacement idea
// as substituteCronjobRunsQuery.
export const jobPreviousRunsTableQueries = {
  // The value here is genuinely a start timestamp (kube_job_status_start_time)
  // - it's the "start" refId, but it's also this table's only source of the
  // job_name label (via label_join), which is what actually becomes the JOB
  // column after merge - same dual-purpose role as the "start" query on the
  // All Jobs page's own Jobs tab.
  start: `label_join((max by (cluster, namespace, job_name) (last_over_time(((kube_job_status_start_time{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29790780|background-load-29790840|background-load-29790900|background-load-29790960|background-load-29791020|background-load-29791080|background-load-29791140|background-load-29791200|background-load-29791260|background-load-29791320"}>(time()-$__range)))[$__range:]))<scalar(min_over_time((max by (cluster, namespace, job_name) (kube_job_status_start_time{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29791140"}))[$__range:]))) * 1000, "join_name", "-", "cluster", "namespace", "job_name")`,
  end: `label_join(scalar(min_over_time((max by (cluster, namespace, job_name) (kube_job_status_start_time{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29791140"}))[$__range:]))>(max by (cluster, namespace, job_name) (last_over_time((kube_job_status_completion_time{job_name=~"background-load-29790780|background-load-29790840|background-load-29790900|background-load-29790960|background-load-29791020|background-load-29791080|background-load-29791140|background-load-29791200|background-load-29791260|background-load-29791320", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod"})[$__range:])) or max by (cluster, namespace, job_name) (last_over_time((max by (cluster, namespace, job_name, join_name) (label_join(label_join(topk by (cluster, namespace, pod, owner_name) (1, max by (cluster, namespace, pod, owner_name) (kube_pod_owner{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", owner_name=~"background-load-29790780|background-load-29790840|background-load-29790900|background-load-29790960|background-load-29791020|background-load-29791080|background-load-29791140|background-load-29791200|background-load-29791260|background-load-29791320"}))*on(cluster,namespace,pod)group_left()max by (cluster, namespace, pod) (timestamp(kube_pod_status_phase{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", phase=~"Failed"}==1)), "job_name", "", "owner_name"), "join_name", "-", "cluster", "namespace", "job_name")))[$__range:])) or max by (cluster, namespace, job_name) (last_over_time((max by (cluster, namespace, job_name, join_name) (label_join(label_join(topk by (cluster, namespace, pod, owner_name) (1, max by (cluster, namespace, pod, owner_name) (kube_pod_owner{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", owner_name=~"background-load-29790780|background-load-29790840|background-load-29790900|background-load-29790960|background-load-29791020|background-load-29791080|background-load-29791140|background-load-29791200|background-load-29791260|background-load-29791320"}))*on(cluster,namespace,pod)group_left() max by (cluster, namespace, pod) (kube_pod_container_status_last_terminated_timestamp{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod"}), "job_name", "", "owner_name"), "join_name", "-", "cluster", "namespace", "job_name")))[$__range:]))), "join_name", "-", "cluster", "namespace", "job_name")*1000`,
  failed: `label_join(group by (cluster, namespace, job_name, reason) (min_over_time((timestamp(max by (cluster, namespace, job_name, reason) (kube_job_status_failed{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29790780|background-load-29790840|background-load-29790900|background-load-29790960|background-load-29791020|background-load-29791080|background-load-29791140|background-load-29791200|background-load-29791260|background-load-29791320"})))[$__range:]) < on() group_left()min_over_time((max by (cluster, namespace, job_name) (kube_job_status_start_time{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29791140"}))[$__range:]))* on (cluster, namespace, job_name, reason) (max by (cluster, namespace, job_name, reason) (last_over_time((kube_job_status_failed{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29790780|background-load-29790840|background-load-29790900|background-load-29790960|background-load-29791020|background-load-29791080|background-load-29791140|background-load-29791200|background-load-29791260|background-load-29791320"})[$__range:]))), "join_name", "-", "cluster", "namespace", "job_name")`,
  success: `label_join(group by (cluster, namespace, job_name) (min_over_time(((timestamp(max by (cluster, namespace, job_name) (kube_job_status_succeeded{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29790780|background-load-29790840|background-load-29790900|background-load-29790960|background-load-29791020|background-load-29791080|background-load-29791140|background-load-29791200|background-load-29791260|background-load-29791320"}))))[$__range:]) < on() group_left()min_over_time(((max by (cluster, namespace, job_name) (kube_job_status_start_time{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29791140"})))[$__range:])) * on(cluster,namespace,job_name)last_over_time(((max by (cluster, namespace, job_name) (kube_job_status_succeeded{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29790780|background-load-29790840|background-load-29790900|background-load-29790960|background-load-29791020|background-load-29791080|background-load-29791140|background-load-29791200|background-load-29791260|background-load-29791320"})))[$__range:]), "join_name", "-", "cluster", "namespace", "job_name")`,
  completion: `label_join(group by (cluster, namespace, job_name) (min_over_time((timestamp(max by (cluster, namespace, job_name) (kube_job_spec_completions{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29790780|background-load-29790840|background-load-29790900|background-load-29790960|background-load-29791020|background-load-29791080|background-load-29791140|background-load-29791200|background-load-29791260|background-load-29791320"})))[$__range:]) < on() group_left() min_over_time((max by (cluster, namespace, job_name) (kube_job_status_start_time{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29791140"}))[$__range:])) * on (cluster, namespace, job_name) max by (cluster, namespace, job_name) (last_over_time((kube_job_spec_completions{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", job_name=~"background-load-29790780|background-load-29790840|background-load-29790900|background-load-29790960|background-load-29791020|background-load-29791080|background-load-29791140|background-load-29791200|background-load-29791260|background-load-29791320"})[$__range:])), "join_name", "-", "cluster", "namespace", "job_name")`,
};

export type JobPreviousRunsTableQueryKey = keyof typeof jobPreviousRunsTableQueries;

export function deriveJobFamilyRegex(jobRegex: string): string {
  return `${jobRegex.replace(/-\d+$/, '')}-[0-9]+`;
}

export function substituteJobPreviousRunsQuery(
  expr: string,
  clusterRegex: string,
  namespaceRegex: string,
  familyRegex: string,
  jobRegex: string
): string {
  const familyEnum =
    'background-load-29790780|background-load-29790840|background-load-29790900|background-load-29790960|background-load-29791020|background-load-29791080|background-load-29791140|background-load-29791200|background-load-29791260|background-load-29791320';
  return expr
    .replaceAll('cluster=~"appenv-grafana-play-cluster"', `cluster=~"${clusterRegex}"`)
    .replaceAll('namespace=~"util-ecommerce-prod"', `namespace=~"${namespaceRegex}"`)
    .replaceAll(`job_name=~"${familyEnum}"`, `job_name=~"${familyRegex}"`)
    .replaceAll(`owner_name=~"${familyEnum}"`, `owner_name=~"${familyRegex}"`)
    .replaceAll('job_name=~"background-load-29791140"', `job_name=~"${jobRegex}"`);
}
