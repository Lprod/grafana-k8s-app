// PromQL queries for the Node Drilldown's Network tab (nodeNetworkScene.tsx),
// pasted verbatim from the reference dashboard (node.json). Bandwidth/
// Saturation are pure node-level (node_network_* metrics keyed by
// instance=~"$node", no $pod at all) - only the "by pod" pair references
// $pod, via container_network_* joined against
// namespace_workload_pod:kube_pod_owner:relabel for workload attribution,
// same shape as the Namespace/Workload Drilldowns' own Network tabs.

export const nodeNetworkBandwidthQueries = {
  rx: `sum(max by (cluster, instance, device) (rate(node_network_receive_bytes_total{cluster=~"$cluster", instance=~"$node"}[$__rate_interval])))`,
  tx: `- sum(max by (cluster, instance, device) (rate(node_network_transmit_bytes_total{cluster=~"$cluster", instance=~"$node"}[$__rate_interval])))`,
};

export const nodeNetworkSaturationQueries = {
  rx: `sum(max by (cluster, instance, device) (rate(node_network_receive_drop_total{cluster=~"$cluster", instance=~"$node"}[$__rate_interval])))`,
  tx: `- sum(max by (cluster, instance, device) (rate(node_network_transmit_drop_total{cluster=~"$cluster", instance=~"$node"}[$__rate_interval])))`,
};

// "Network Bandwidth by pod" - given verbatim, including the dashboard's own
// apparent copy-paste bug where the "tx" query reuses the *receive* counter
// (container_network_receive_bytes_total) instead of a transmit one. Unlike
// the two "Efficiency" panel bugs in the CPU/Memory tabs (fixed per explicit
// user confirmation after asking), this one wasn't flagged for a fix - left
// as given, matching this codebase's default "translate literally" rule for
// anything not explicitly called out.
export const nodeNetworkBandwidthByPodQueries = {
  rx: `sum by (cluster, namespace, pod, workload, workload_type) (max by (cluster, namespace, pod, interface) (rate(container_network_receive_bytes_total{cluster=~"$cluster", pod=~"$pod"}[$__rate_interval])) * on (cluster, namespace, pod) group_left (workload, workload_type) group by (cluster, namespace, workload, workload_type, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", pod=~"$pod"}))`,
  tx: `- sum by (cluster, namespace, pod, workload, workload_type) (max by (cluster, namespace, pod, interface) (rate(container_network_receive_bytes_total{cluster=~"$cluster", pod=~"$pod"}[$__rate_interval])) * on (cluster, namespace, pod) group_left (workload, workload_type) group by (cluster, namespace, workload, workload_type, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", pod=~"$pod"}))`,
};

export const nodeNetworkSaturationByPodQueries = {
  rx: `sum by (cluster, namespace, pod, workload, workload_type) (max by (cluster, namespace, pod, interface) (rate(container_network_receive_packets_dropped_total{cluster=~"$cluster", pod=~"$pod"}[$__rate_interval])) * on (cluster, namespace, pod) group_left (workload, workload_type) group by (cluster, namespace, workload, workload_type, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", pod=~"$pod"}))`,
  tx: `-sum by (cluster, namespace, pod, workload, workload_type) (max by (cluster, namespace, pod, interface) (rate(container_network_transmit_packets_dropped_total{cluster=~"$cluster", pod=~"$pod"}[$__rate_interval])) * on (cluster, namespace, pod) group_left (workload, workload_type) group by (cluster, namespace, workload, workload_type, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", pod=~"$pod"}))`,
};
