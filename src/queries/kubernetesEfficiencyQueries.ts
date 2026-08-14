// PromQL queries for the Kubernetes home page's Efficiency tab
// (src/pages/Kubernetes/kubernetesEfficiencyScene.tsx), pasted verbatim from
// Grafana's own Kubernetes Monitoring app (play.grafana.org). None of these
// reference `$cluster`/`$namespace` - they filter with `.+` throughout, same
// as most of the Overview tab's issue queries - kept as given rather than
// wired to this page's filter variables (see kubernetesOverviewQueries.ts's
// header comment for why).

export const kubernetesEfficiencyTopStatQueries = {
  no_resource_requests: `count((max by (cluster, namespace, pod, container) (kube_pod_container_status_restarts_total{cluster=~".+", namespace=~".+"})) unless on (cluster, namespace, pod, container)(max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_requests{container!="POD", container!="", cluster=~".+", namespace=~".+"})))) or vector(0)`,
  no_resource_limits: `count((max by (cluster, namespace, pod, container, resource, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_requests{container!="POD", container!="", cluster=~".+", namespace=~".+"}))) unless on (cluster, namespace, pod, container, resource, asserts_env)(max by (cluster, namespace, pod, container, resource, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_limits{container!="POD", container!="", cluster=~".+", namespace=~".+"})))) or vector(0)`,
  cpu_over_requested: `count((max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_requests{container!="POD", container!="", cluster=~".+", namespace=~".+", resource=~"cpu"})) - max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, namespace, node, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_rate5m{container!="POD", container!="", cluster=~".+", namespace=~".+"} or node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="POD", container!="", cluster=~".+", namespace=~".+"}))) > 0.01) or vector(0)`,
  memory_over_requested: `count((max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_requests{container!="POD", container!="", cluster=~".+", namespace=~".+", resource=~"memory"})) - max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, image) (node_namespace_pod_container:container_memory_working_set_bytes{container!="POD", container!="", cluster=~".+", namespace=~".+"}))) / (1024 * 1024 * 1024) > 0.01) or vector(0)`,
};

export type KubernetesEfficiencyTopStatKey = keyof typeof kubernetesEfficiencyTopStatQueries;

export const kubernetesEfficiencyWasteByNamespaceQueries = {
  cpu: `topk(10, sum by (cluster, namespace) ((max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_requests{container!="POD", container!="", cluster=~".+", namespace=~".+", resource=~"cpu"})) - max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, namespace, node, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_rate5m{container!="POD", container!="", cluster=~".+", namespace=~".+"} or node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="POD", container!="", cluster=~".+", namespace=~".+"}))) > 0.01))`,
  memory: `topk(10, sum by (cluster, namespace) ((max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_requests{container!="POD", container!="", cluster=~".+", namespace=~".+", resource=~"memory"})) - max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, image) (node_namespace_pod_container:container_memory_working_set_bytes{container!="POD", container!="", cluster=~".+", namespace=~".+"}))) / (1024 * 1024 * 1024) > 0.01))`,
};

interface EfficiencyTableDef {
  title: string;
  expr: string;
  noValueText: string;
}

export const kubernetesEfficiencyTableQueries: EfficiencyTableDef[] = [
  {
    title: 'Containers without resource requests - top 50',
    expr: `(topk(50, (max by (cluster, namespace, pod, container) (kube_pod_container_status_restarts_total{cluster=~".+", namespace=~".+"})) unless on (cluster, namespace, pod, container)(max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_requests{container!="POD", container!="", cluster=~".+", namespace=~".+"}))))) * on (cluster, namespace, pod) group_left (workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}`,
    noValueText: 'All containers have resource requests set.',
  },
  {
    title: 'Containers without memory limits - top 50',
    expr: `(topk(50, (max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_requests{container!="POD", container!="", cluster=~".+", namespace=~".+", resource=~"memory"}))) unless on (cluster, namespace, pod, container, asserts_env)(max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_limits{container!="POD", container!="", cluster=~".+", namespace=~".+", resource=~"memory"}))))) * on (cluster, namespace, pod) group_left (workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}`,
    noValueText: 'All containers have memory limits set.',
  },
  {
    title: 'Containers without CPU limits - top 50',
    expr: `(topk(50, (max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_requests{container!="POD", container!="", cluster=~".+", namespace=~".+", resource=~"cpu"}))) unless on (cluster, namespace, pod, container, asserts_env)(max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_limits{container!="POD", container!="", cluster=~".+", namespace=~".+", resource=~"cpu"}))))) * on (cluster, namespace, pod) group_left (workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}`,
    noValueText: 'All containers have CPU limits set.',
  },
  {
    title: 'CPU over-requested containers - top 50 (request far exceeds usage)',
    expr: `sort_desc(((topk(50, (max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_requests{container!="POD", container!="", cluster=~".+", namespace=~".+", resource=~"cpu"})) - max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, namespace, node, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_rate5m{container!="POD", container!="", cluster=~".+", namespace=~".+"} or node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="POD", container!="", cluster=~".+", namespace=~".+"}))) > 0.01)) * on (cluster, namespace, pod) group_left (workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}) or ((topk(50, (max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_requests{container!="POD", container!="", cluster=~".+", namespace=~".+", resource=~"cpu"})) - max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, namespace, node, pod, container) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_rate5m{container!="POD", container!="", cluster=~".+", namespace=~".+"} or node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{container!="POD", container!="", cluster=~".+", namespace=~".+"}))) > 0.01)) unless on (cluster, namespace, pod)(namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"})))`,
    noValueText: 'No containers with significant CPU over-requests detected.',
  },
  {
    title: 'Memory over-requested containers - top 50 (request far exceeds usage)',
    expr: `sort_desc(((topk(50, (max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_requests{container!="POD", container!="", cluster=~".+", namespace=~".+", resource=~"memory"})) - max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, image) (node_namespace_pod_container:container_memory_working_set_bytes{container!="POD", container!="", cluster=~".+", namespace=~".+"}))) / (1024 * 1024 * 1024) > 0.01)) * on (cluster, namespace, pod) group_left (workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}) or ((topk(50, (max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, resource) (kube_pod_container_resource_requests{container!="POD", container!="", cluster=~".+", namespace=~".+", resource=~"memory"})) - max by (cluster, namespace, pod, container, asserts_env) (max by (cluster, node, namespace, pod, container, image) (node_namespace_pod_container:container_memory_working_set_bytes{container!="POD", container!="", cluster=~".+", namespace=~".+"}))) / (1024 * 1024 * 1024) > 0.01)) unless on (cluster, namespace, pod)(namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"})))`,
    noValueText: 'No containers with significant memory over-requests detected.',
  },
];
