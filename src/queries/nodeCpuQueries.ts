// PromQL queries for the Node Drilldown's CPU tab (nodeCpuScene.tsx), pasted
// verbatim from the reference dashboard (node.json) - $cluster/$node/$pod
// placeholders, substituted via substituteClusterNodeAndPodToken
// (nodeQueries.ts). Structurally mirrors workloadCpuQueries.ts, but scoped
// to a node's own pods (across every namespace) instead of one workload's.

export const nodeCpuStatQueries = {
  requestsCapacity: `sum by (cluster, node) (max by (cluster, namespace, pod, container, node) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{cluster=~"$cluster", node=~"$node", pod=~"$pod"})) / sum by (cluster, node) (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource=~"cpu", node=~"$node"}))`,
  usageCapacity: `sum by () (max by (cluster, namespace, pod, container, node) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster=~"$cluster", node=~"$node", pod=~"$pod"})) / sum by () (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource=~"cpu", node=~"$node"}))`,
  usageRequests: `sum by () (max by (cluster, namespace, pod, container, node) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster=~"$cluster", node=~"$node", pod=~"$pod"})) / sum by () (max by (cluster, namespace, pod, container, node) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{cluster=~"$cluster", node=~"$node", pod=~"$pod"}))`,
};

export type NodeCpuStatKey = keyof typeof nodeCpuStatQueries;

// "Overview: Usage (vCPU cores)" - capacity/requests/usage only, given
// verbatim - unlike the Overview tab's own "Node CPU" panel (4 series
// including limits), this one has no limits line at all.
export const nodeCpuOverviewUsageQueries = {
  capacity: `sum by () (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource=~"cpu", node=~"$node"}))`,
  requests: `sum by () (max by (cluster, namespace, pod, container, node) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{cluster=~"$cluster", node=~"$node", pod=~"$pod"}))`,
  usage: `sum by () (max by (cluster, namespace, pod, container, node) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster=~"$cluster", node=~"$node", pod=~"$pod"}))`,
};

export type NodeCpuOverviewUsageKey = keyof typeof nodeCpuOverviewUsageQueries;

// "Distribution: Pod Usage/Node Capacity (%, stacked)", given verbatim.
export const nodeCpuDistributionQuery = `sum by (cluster, namespace, pod, node) (max by (cluster, namespace, pod, container, node) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster=~"$cluster", node=~"$node", pod=~"$pod"})) * on (cluster, namespace, pod) group_left(workload, workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", pod=~"$pod"}) / on (cluster, node) group_left() sum by (cluster, node) (max by (cluster, node) (kube_node_status_capacity{cluster=~"$cluster", resource=~"cpu", node=~"$node"}))`;

// "Efficiency: Pod Usage/Requests (%)" - the reference dashboard's own copy
// of this panel divides by node *capacity* again (byte-for-byte identical to
// the Distribution panel above despite the different title) - a copy-paste
// bug in the source, not an intentional-looking oddity, per explicit user
// confirmation. Fixed here to actually divide by the pod's own CPU requests,
// matched on (cluster, namespace, pod) - same numerator (usage joined for
// workload/workload_type attribution) as Distribution, different
// denominator.
export const nodeCpuPodAlignmentQuery = `sum by (cluster, namespace, pod, node) (max by (cluster, namespace, pod, container, node) (node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster=~"$cluster", node=~"$node", pod=~"$pod"})) * on (cluster, namespace, pod) group_left(workload, workload_type) group by (cluster, namespace, pod, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", pod=~"$pod"}) / on (cluster, namespace, pod) group_left() sum by (cluster, namespace, pod) (max by (cluster, namespace, pod, container, node) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{cluster=~"$cluster", node=~"$node", pod=~"$pod"}))`;
