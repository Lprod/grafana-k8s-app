// PromQL queries for the cluster drilldown Overview tab.

// A cluster runs two synthetic CronJobs in the "cluster-tests" namespace that
// probe for user-impacting vs. infra-only degradation. Each expression below
// resolves to 1 if its category's probe is currently failing (or a node is
// NotReady), 0 otherwise. The two are added together so the panel value is:
//   0 = healthy, 1 = degraded (no user impact), 2 = degraded (user impact).
function clusterHealthCategoryQuery(clusterRegex: string, labelCategory: 'infra' | 'user-impact'): string {
  return `(
  count(
    max without (owner_name, job_name) (
      label_replace(
        clamp_max(
          topk by (cluster, namespace, owner_name) (1, (
            max by (cluster, namespace, owner_name, job_name) (
              kube_job_status_start_time{k8s_cluster_name="${clusterRegex}", namespace="cluster-tests"}
              *
              on (cluster, job_name, namespace) group_left(owner_name) max by (cluster, namespace, owner_name, job_name) (
                kube_job_owner{k8s_cluster_name="${clusterRegex}", owner_kind="CronJob", namespace="cluster-tests"}
              )
            )
            and on (cluster, namespace, job_name) (
              kube_job_status_active{k8s_cluster_name="${clusterRegex}", namespace="cluster-tests"} == 0
            )
          )),
          1
        )
        *
        on (cluster, namespace, job_name) group_left(reason) (
          kube_job_status_failed{k8s_cluster_name="${clusterRegex}", namespace="cluster-tests"} == 1
        ),
        "cronjob", "$1", "owner_name", "(.+)"
      )
    )
    * on (cluster, cronjob) group_left(label_category) max by (cluster, cronjob, label_category) (
      kube_cronjob_labels{k8s_cluster_name="${clusterRegex}", exported_namespace="cluster-tests", label_category="${labelCategory}"}
    )
  ) by (cluster)
  OR
  count(kube_node_status_condition{k8s_cluster_name="${clusterRegex}", condition="Ready", status="false"}) by (cluster) * 0
) > bool 0`;
}

export function buildClusterHealthQuery(clusterRegex: string): string {
  const infra = clusterHealthCategoryQuery(clusterRegex, 'infra');
  const userImpact = clusterHealthCategoryQuery(clusterRegex, 'user-impact');
  return `(${infra}) * 1 + (${userImpact}) * 2`;
}

// Total node capacity for the cluster info boxes (not usage).
export const clusterCapacityQueries = {
  cpu: `sum by (cluster) (max by (cluster, node) (kube_node_status_capacity{cluster=~".+", resource="cpu"}))`,
  memory: `sum by (cluster) (max by (cluster, node) (kube_node_status_capacity{cluster=~".+", resource="memory"}))`,
  disk: `sum by (cluster) (max by (cluster, node) (kube_node_status_capacity{cluster=~".+", resource="ephemeral_storage"}))`,
};

export type ClusterCapacityQueryKey = keyof typeof clusterCapacityQueries;

// "Cluster optimization" section: capacity/limits/requests/usage over time,
// one chart for CPU and one for memory. These use a literal "$cluster"
// placeholder (rather than the ".+" fallback used above) so callers swap it
// in with substituteCluster().
export const clusterCpuOptimizationQueries = {
  cpuCapacity: `sum by (cluster) (max by (cluster, node, resource) (kube_node_status_capacity{cluster=~"$cluster", resource=~"cpu"}))`,
  cpuLimits: `sum by (cluster) (max by (cluster, namespace) (namespace_cpu:kube_pod_container_resource_limits:sum{cluster=~"$cluster"}))`,
  cpuRequests: `sum by (cluster) (max by (cluster, namespace) (namespace_cpu:kube_pod_container_resource_requests:sum{cluster=~"$cluster"}))`,
  cpuUsage: `sum( 1 - max by (cluster, instance, cpu, core) (rate(node_cpu_seconds_total{cluster=~"$cluster", mode=~"idle"}[$__rate_interval])) >= 0)`,
};

export const clusterMemoryOptimizationQueries = {
  memCapacity: `sum(max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource=~"memory"}))`,
  memLimits: `sum(max by (cluster, namespace) (namespace_memory:kube_pod_container_resource_limits:sum{cluster=~"$cluster"}))`,
  memRequests: `sum(max by (cluster, namespace) (namespace_memory:kube_pod_container_resource_requests:sum{cluster=~"$cluster"}))`,
  memUsage: `sum(max by (cluster, node) (kube_node_status_capacity{cluster="$cluster", resource="memory"}) - on (cluster, node) group_left max by (cluster, node) (label_replace(node_memory_MemAvailable_bytes{cluster="$cluster"}, "node", "$1", "instance", "([^:]+).*")))`,
};

export function substituteCluster(expr: string, clusterRegex: string): string {
  return expr.replaceAll('$cluster', clusterRegex);
}
