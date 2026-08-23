// PromQL query builders for the CronJob Drilldown's CPU tab
// (getCronjobCpuScene in cronjobCpuScene.tsx). Same "namespace-wide, not
// scoped down to just this cronjob's own pods" situation as the Overview
// tab's own "Cronjob optimization" panels (cronjobOverviewQueries.ts) - see
// that file's own comment for why, and substituteCronjobResourceQuery
// (reused here, not redeclared) for how the given `pod=~""`/`k8s_pod_name=~""`
// tokens are translated.
//
// These queries are long, deeply-nested fallback chains (kube-state-metrics
// vs. a vSphere/k8s_*-labeled telemetry source) pasted verbatim from the
// given reference, but three sub-expressions recur byte-for-byte across
// several of them - factored out as shared constants below so this file
// has one source of truth for each instead of six independently-drifting
// copies, not a "fix" to the PromQL itself.

// Per-container CPU usage (kube-state-metrics recording rule, or the
// vSphere-style container_cpu_usage fallback) - used by Overview:usage's
// "usage" series, Distribution, Alignment, and the Pods table's own
// timeline/agg/aggPercent queries.
const CPU_USAGE_PER_CONTAINER = `sum by (cluster, namespace, pod, container) (max by (cluster, namespace, node, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_rate5m{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~""} or node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~""})) or sum by (cluster, namespace, pod, container) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (container_cpu_usage{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_container_name!="", k8s_namespace_name=~"util-ecommerce-prod", k8s_pod_name=~""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name"))`;

// Per-container CPU requests - used by Scheduling/Alignment stats,
// Overview:usage's "requests" series, Alignment panel, and the Pods table's
// own requests/aggPercent queries.
const CPU_REQUESTS_PER_CONTAINER = `sum by (cluster, namespace, pod, container) (max by (cluster, namespace, node, pod, container, resource) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~""})) or sum by (cluster, namespace, pod, container) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name) (k8s_container_cpu_request{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name") * on (cluster, node, pod) group_left() (label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name") <= bool 2 == 1))`;

// Per-container CPU limits - used only by Overview:usage's "limits" series.
const CPU_LIMITS_PER_CONTAINER = `sum by (cluster, namespace, pod, container) (max by (cluster, namespace, node, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_limits{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~""})) or sum by (cluster, namespace, pod, container) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name) (k8s_container_cpu_limit{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name") * on (cluster, node, pod) group_left() (label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name") <= bool 2 == 1))`;

// Attributes a pod to its owning workload (name + kind) - kube-state-metrics'
// own namespace_workload_pod:kube_pod_owner:relabel if present, else a
// 6-branch k8s_pod_phase-based fallback (ReplicaSet/Job/DaemonSet/
// StatefulSet/CronJob/Deployment, in that priority order via `or`) that
// derives "workload"/"workload_type" via label_replace off whichever
// k8s_*_name label is non-empty. Used by Distribution, Alignment, and every
// one of the Pods table's four queries (all group by workload/workload_type
// alongside pod). Grouped `by (cluster, namespace, pod, workload,
// workload_type)` here already - each call site adds its own `* on
// (cluster,namespace,pod) group_left(workload,workload_type)` join.
//
// Exported (not just this file's own concern) - it's pure pod-to-workload
// identity, unrelated to CPU specifically, and the CPU/Memory tabs' given
// reference queries both paste the exact same byte-for-byte expression, so
// cronjobMemoryQueries.ts reuses this export directly instead of a 7th copy.
export const WORKLOAD_ATTRIBUTION_JOIN = `group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~"", workload=~".+"} or max by (cluster, namespace, pod, workload, workload_type) (label_replace(label_replace(label_replace(label_replace(label_replace(label_replace(label_replace(label_replace(label_replace(label_replace(label_replace(label_replace(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"", k8s_replicaset_name=~".+", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name") or label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"", k8s_job_name=~".+", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name") or label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"", k8s_daemonset_name=~".+", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name") or label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"", k8s_statefulset_name=~".+", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name") or label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"", k8s_cronjob_name=~".+", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name") or label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"", k8s_deployment_name=~".+", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name"), "workload", "$1", "k8s_replicaset_name", "(.+)"), "workload_type", "ReplicaSet", "k8s_replicaset_name", ".+"), "workload", "$1", "k8s_job_name", "(.+)"), "workload_type", "Job", "k8s_job_name", ".+"), "workload", "$1", "k8s_daemonset_name", "(.+)"), "workload_type", "DaemonSet", "k8s_daemonset_name", ".+"), "workload", "$1", "k8s_statefulset_name", "(.+)"), "workload_type", "StatefulSet", "k8s_statefulset_name", ".+"), "workload", "$1", "k8s_cronjob_name", "(.+)"), "workload_type", "CronJob", "k8s_cronjob_name", ".+"), "workload", "$1", "k8s_deployment_name", "(.+)"), "workload_type", "Deployment", "k8s_deployment_name", ".+")))`;

export const cronjobCpuStatQueries = {
  alertsFiring: `count(ALERTS{cluster=~"appenv-grafana-play-cluster", alertstate=~"firing", alertname=~"Kube.*|CPUThrottlingHigh", namespace=~"util-ecommerce-prod", pod=~""}) or vector(0)`,
  schedulingRequestsSet: `count(group by (cluster, namespace, pod, container) (${CPU_REQUESTS_PER_CONTAINER})) / count(group by (cluster, namespace, pod, container) (max by (cluster, namespace, pod, container, image_spec) (kube_pod_container_info{container!="POD", container!="", pod=~"", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod"}) or max by (cluster, namespace, pod, container, image_spec) (kube_pod_init_container_info{container!="POD", container!="", pod=~"", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod"}) or label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name) (k8s_container_restarts{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name")))`,
  alignmentUsageRequests: `sum by () (max by (cluster, namespace, pod, container) (${CPU_USAGE_PER_CONTAINER})) / sum by () (max by (cluster, namespace, pod, container) (${CPU_REQUESTS_PER_CONTAINER}))`,
};

export type CronjobCpuStatKey = keyof typeof cronjobCpuStatQueries;

// "Overview: usage" panel - limits/requests/usage, refId-matched (see
// applyCpuUsageSeriesOverrides in cronjobCpuScene.tsx) for the same red-
// dashed/orange-dashed/blue-solid styling as every other CPU/Memory
// "Overview: usage" panel in this app.
export const cronjobCpuOverviewUsageQueries = {
  limits: `sum by () (max by (cluster, namespace, pod, container) (${CPU_LIMITS_PER_CONTAINER}))`,
  requests: `sum by () (max by (cluster, namespace, pod, container) (${CPU_REQUESTS_PER_CONTAINER}))`,
  usage: `sum by () (max by (cluster, namespace, pod, container) (${CPU_USAGE_PER_CONTAINER}))`,
};

export type CronjobCpuOverviewUsageKey = keyof typeof cronjobCpuOverviewUsageQueries;

// "Distribution: Pod usage" panel (stacked) - per-pod usage, attributed to
// its owning workload for the {{workload_type}}/{{pod}} legend.
export const cronjobCpuDistributionQuery = `sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (${CPU_USAGE_PER_CONTAINER})) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN})`;

// "Alignment: Pod Usage/Requests (%)" panel - per-pod usage/requests ratio,
// same workload attribution join as Distribution above.
export const cronjobCpuPodAlignmentQuery = `sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (${CPU_USAGE_PER_CONTAINER})) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN}) / on (cluster,namespace,workload,workload_type,pod) group_left() sum by (cluster, namespace, workload, workload_type, pod) (max by (cluster, namespace, pod, container) (${CPU_REQUESTS_PER_CONTAINER}) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN})`;

// "Pods" table - timeline (pod/workload/workload_type identity, one row per
// currently-attributable pod), requests (last_over_time, [$__range:]),
// agg (p95 over [$__range:1m]), aggPercent (p95 usage/p95 requests ratio,
// same [$__range:1m] window) - all 4 label_join'd on a "join_key" of
// (cluster.namespace.workload.workload_type.pod) so `merge` can align them
// without relying on any one field alone being unique.
export const cronjobCpuPodsTableQueries = {
  timeline: `label_join(${WORKLOAD_ATTRIBUTION_JOIN}, "join_key", ".", "cluster", "namespace", "workload", "workload_type", "pod")`,
  requests: `label_join(last_over_time((sum by (cluster, namespace, workload, workload_type, pod) (max by (cluster, namespace, pod, container) (${CPU_REQUESTS_PER_CONTAINER}) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN}))[$__range:]), "join_key", ".", "cluster", "namespace", "workload", "workload_type", "pod")`,
  agg: `label_join(quantile_over_time(0.95, sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (${CPU_USAGE_PER_CONTAINER})) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN})[$__range:1m]), "join_key", ".", "cluster", "namespace", "workload", "workload_type", "pod")`,
  aggPercent: `label_join(quantile_over_time(0.95, sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (${CPU_USAGE_PER_CONTAINER})) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN})[$__range:1m]) / quantile_over_time(0.95, sum by (cluster, namespace, workload, workload_type, pod) (max by (cluster, namespace, pod, container) (${CPU_REQUESTS_PER_CONTAINER}) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN})[$__range:1m]), "join_key", ".", "cluster", "namespace", "workload", "workload_type", "pod")`,
};

export type CronjobCpuPodsTableQueryKey = keyof typeof cronjobCpuPodsTableQueries;
