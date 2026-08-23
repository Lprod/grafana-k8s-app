// PromQL query builders for the CronJob Drilldown's Memory tab
// (getCronjobMemoryScene in cronjobMemoryScene.tsx). Structurally identical
// to cronjobCpuQueries.ts (same namespace-wide scope, same substitution via
// substituteCronjobResourceQuery, same shared workload-attribution join
// reused directly from that file) - only the per-container metric names
// differ (memory working-set/requests/limits instead of CPU).

import { cronjobCpuPodsTableQueries, WORKLOAD_ATTRIBUTION_JOIN } from './cronjobCpuQueries';

// Per-container memory usage (kube-state-metrics recording rule, or the
// vSphere-style container_memory_working_set_bytes fallback) - used by
// Overview:usage's "usage" series, Alignment stat, Distribution, Alignment
// panel, and the Pods table's own agg/aggPercent queries. Note the "max by"
// field order here (cluster, node, namespace, pod, container, image) - given
// this way, distinct from the requests/limits fragments' own ordering below.
const MEM_USAGE_PER_CONTAINER = `sum by (cluster, namespace, pod, container) (max by (cluster, node, namespace, pod, container, image) (node_namespace_pod_container:container_memory_working_set_bytes{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~""})) or sum by (cluster, namespace, pod, container) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (container_memory_working_set_bytes{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name"))`;

// Per-container memory requests - used by Scheduling/Alignment stats,
// Overview:usage's "requests" series, Alignment panel, and the Pods table's
// own requests/aggPercent queries.
const MEM_REQUESTS_PER_CONTAINER = `sum by (cluster, namespace, pod, container) (max by (cluster, namespace, node, pod, container, resource) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~""})) or sum by (cluster, namespace, pod, container) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name) (k8s_container_memory_request_bytes{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name") * on (cluster, node, pod) group_left() (label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name") <= bool 2 == 1))`;

// Per-container memory limits - used only by Overview:usage's "limits" series.
const MEM_LIMITS_PER_CONTAINER = `sum by (cluster, namespace, pod, container) (max by (cluster, namespace, node, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{container!="POD", container!="", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod", pod=~""})) or sum by (cluster, namespace, pod, container) (label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name) (k8s_container_memory_limit_bytes{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name") * on (cluster, node, pod) group_left() (label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_node_name, k8s_cronjob_name, k8s_daemonset_name, k8s_deployment_name, k8s_job_name, k8s_replicaset_name, k8s_statefulset_name) (k8s_pod_phase{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_pod_name=~"", k8s_namespace_name=~"util-ecommerce-prod"}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "node", ",", "k8s_node_name") <= bool 2 == 1))`;

export const cronjobMemoryStatQueries = {
  alertsFiring: `count(ALERTS{cluster=~"appenv-grafana-play-cluster", alertstate=~"firing", alertname=~"Kube.*|CPUThrottlingHigh", namespace=~"util-ecommerce-prod", pod=~""}) or vector(0)`,
  schedulingRequestsSet: `count(group by (cluster, namespace, pod, container) (${MEM_REQUESTS_PER_CONTAINER})) / count(group by (cluster, namespace, pod, container) (max by (cluster, namespace, pod, container, image_spec) (kube_pod_container_info{container!="POD", container!="", pod=~"", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod"}) or max by (cluster, namespace, pod, container, image_spec) (kube_pod_init_container_info{container!="POD", container!="", pod=~"", cluster=~"appenv-grafana-play-cluster", namespace=~"util-ecommerce-prod"}) or label_join(label_join(label_join(label_join(label_join(max by (k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_container_name, k8s_node_name) (k8s_container_restarts{k8s_cluster_name=~"appenv-grafana-play-cluster", k8s_namespace_name=~"util-ecommerce-prod", k8s_node_name!="", k8s_pod_name=~"", k8s_container_name!=""}), "cluster", ",", "k8s_cluster_name"), "namespace", ",", "k8s_namespace_name"), "pod", ",", "k8s_pod_name"), "container", ",", "k8s_container_name"), "node", ",", "k8s_node_name")))`,
  alignmentUsageRequests: `sum by () (max by (cluster, namespace, pod, container) (${MEM_USAGE_PER_CONTAINER})) / sum by () (max by (cluster, namespace, pod, container) (${MEM_REQUESTS_PER_CONTAINER}))`,
};

export type CronjobMemoryStatKey = keyof typeof cronjobMemoryStatQueries;

// "Overview: usage" panel - limits/requests/usage, refId-matched (see
// applyMemoryUsageSeriesOverrides in cronjobMemoryScene.tsx) for the same
// red-dashed/orange-dashed/blue-solid styling as every other CPU/Memory
// "Overview: usage" panel in this app.
export const cronjobMemoryOverviewUsageQueries = {
  limits: `sum by () (max by (cluster, namespace, pod, container) (${MEM_LIMITS_PER_CONTAINER}))`,
  requests: `sum by () (max by (cluster, namespace, pod, container) (${MEM_REQUESTS_PER_CONTAINER}))`,
  usage: `sum by () (max by (cluster, namespace, pod, container) (${MEM_USAGE_PER_CONTAINER}))`,
};

export type CronjobMemoryOverviewUsageKey = keyof typeof cronjobMemoryOverviewUsageQueries;

// "Distribution: Pod usage" panel (stacked) - per-pod usage, attributed to
// its owning workload for the {{workload_type}}/{{pod}} legend.
export const cronjobMemoryDistributionQuery = `sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (${MEM_USAGE_PER_CONTAINER})) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN})`;

// "Alignment: Pod Usage/Requests (%)" panel - per-pod usage/requests ratio,
// same workload attribution join as Distribution above.
export const cronjobMemoryPodAlignmentQuery = `sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (${MEM_USAGE_PER_CONTAINER})) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN}) / on (cluster,namespace,workload,workload_type,pod) group_left() sum by (cluster, namespace, workload, workload_type, pod) (max by (cluster, namespace, pod, container) (${MEM_REQUESTS_PER_CONTAINER}) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN})`;

// "Pods" table - timeline (pure pod/workload/workload_type identity, no
// memory metric at all - byte-for-byte the same given query as the CPU
// tab's own, reused directly rather than duplicated), requests
// (last_over_time, [$__range:]), agg (p95 over [$__range:1m], "app" in the
// given reference - kept as "agg" here for naming consistency with the CPU
// tab's own key), aggPercent (p95 usage/p95 requests ratio, same
// [$__range:1m] window) - all 4 label_join'd on a "join_key" so `merge` can
// align them without relying on any one field alone being unique.
export const cronjobMemoryPodsTableQueries = {
  timeline: cronjobCpuPodsTableQueries.timeline,
  requests: `label_join(last_over_time((sum by (cluster, namespace, workload, workload_type, pod) (max by (cluster, namespace, pod, container) (${MEM_REQUESTS_PER_CONTAINER}) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN}))[$__range:]), "join_key", ".", "cluster", "namespace", "workload", "workload_type", "pod")`,
  agg: `label_join(quantile_over_time(0.95, sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (${MEM_USAGE_PER_CONTAINER})) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN})[$__range:1m]), "join_key", ".", "cluster", "namespace", "workload", "workload_type", "pod")`,
  aggPercent: `label_join(quantile_over_time(0.95, sum by (cluster, namespace, workload, workload_type, pod) (sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container) (${MEM_USAGE_PER_CONTAINER})) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN})[$__range:1m]) / quantile_over_time(0.95, sum by (cluster, namespace, workload, workload_type, pod) (max by (cluster, namespace, pod, container) (${MEM_REQUESTS_PER_CONTAINER}) * on (cluster,namespace,pod) group_left(workload,workload_type) ${WORKLOAD_ATTRIBUTION_JOIN})[$__range:1m]), "join_key", ".", "cluster", "namespace", "workload", "workload_type", "pod")`,
};

export type CronjobMemoryPodsTableQueryKey = keyof typeof cronjobMemoryPodsTableQueries;
