// PromQL queries for the Node Drilldown's Memory tab (nodeMemoryScene.tsx),
// pasted verbatim from the reference dashboard (node.json) - mirrors
// nodeCpuQueries.ts one resource over. See that file's own comments for the
// "Efficiency: Pod Usage/Requests (%)" copy-paste-bug fix, applied here too.

export const nodeMemoryStatQueries = {
  requestsCapacity: `sum by (cluster, node) (max by (cluster, namespace, pod, container, node) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{cluster=~"$cluster", node=~"$node", pod=~"$pod"})) / sum by (cluster, node) (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource=~"memory", node=~"$node"}))`,
  usageCapacity: `sum by () (max by (cluster, namespace, pod, container, node) (node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"$cluster", node=~"$node", pod=~"$pod"})) / sum by () (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource=~"memory", node=~"$node"}))`,
  usageRequests: `sum by () (max by (cluster, namespace, pod, container, node) (node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"$cluster", node=~"$node", pod=~"$pod"})) / sum by () (max by (cluster, namespace, pod, container, node) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{cluster=~"$cluster", node=~"$node", pod=~"$pod"}))`,
};

export type NodeMemoryStatKey = keyof typeof nodeMemoryStatQueries;

// "Overview: Usage (memory bytes)" - given verbatim, mislabeled refIds in
// the source ("limits" holding a capacity expression) translated to their
// actual meaning (capacity/requests/usage, no real limits line) - same
// no-limits shape as the CPU tab's own Overview panel.
export const nodeMemoryOverviewUsageQueries = {
  capacity: `sum by () (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource=~"memory", node=~"$node"}))`,
  requests: `sum by () (max by (cluster, namespace, pod, container, node) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{cluster=~"$cluster", node=~"$node", pod=~"$pod"}))`,
  usage: `sum by () (max by (cluster, namespace, pod, container, node) (node_namespace_pod_container:container_memory_working_set_bytes{container!="", cluster=~"$cluster", node=~"$node", pod=~"$pod"}))`,
};

export type NodeMemoryOverviewUsageKey = keyof typeof nodeMemoryOverviewUsageQueries;

// "Distribution: Pod Usage/Node Capacity (%, stacked)", given verbatim.
export const nodeMemoryDistributionQuery = `sum by (cluster, namespace, pod, node) (max by (cluster, namespace, pod, container, node) (node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"$cluster", node=~"$node", pod=~"$pod"})) * on (cluster, namespace, pod) group_left(workload, workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", pod=~"$pod"}) / on (cluster, node) group_left() sum by (cluster, node) (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource=~"memory", node=~"$node"}))`;

// "Efficiency: Pod Usage/Requests (%)" - fixed to divide by the pod's own
// memory requests instead of node capacity again, same reasoning as
// nodeCpuPodAlignmentQuery.
export const nodeMemoryPodAlignmentQuery = `sum by (cluster, namespace, pod, node) (max by (cluster, namespace, pod, container, node) (node_namespace_pod_container:container_memory_working_set_bytes{cluster=~"$cluster", node=~"$node", pod=~"$pod"})) * on (cluster, namespace, pod) group_left(workload, workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", pod=~"$pod"}) / on (cluster, namespace, pod) group_left() sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container, node) (cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{cluster=~"$cluster", node=~"$node", pod=~"$pod"}))`;
