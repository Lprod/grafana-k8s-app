// PromQL queries for the Workload Drilldown's Network tab
// (src/pages/Workloads/workloadNetworkScene.tsx), pasted verbatim from
// Grafana's own Kubernetes Monitoring app - same literal-translation
// convention as workloadCpuQueries.ts/workloadMemoryQueries.ts. Unlike the
// Namespace Drilldown's own Network tab (namespaceNetworkQueries.ts), every
// query here already carries a `pod=~"$pod"` filter - no bare-pod/
// static-pod/replicaset fallback chain is needed, since $pod (the hidden Pod
// variable, see workloadCpuScene.tsx) already resolves to exactly this
// workload's own pods. The two "by pod" queries don't even filter by
// `workload` explicitly (unlike the Overview/CPU/Memory tabs' own "by
// workload"/"by pod" joins) - redundant given $pod is already
// workload-scoped, but kept as given rather than added for consistency.
// Also kept as given: the "by pod" Saturation Tx query's `sum by (...)`
// clause lists "pod" twice (harmless no-op in PromQL, not deduplicated).

export const workloadNetworkBandwidthQueries = {
  rx: `sum(
              max by (cluster, namespace, pod, interface) (
                rate(container_network_receive_bytes_total{cluster="$cluster", namespace="$namespace", pod=~"$pod"}[$__rate_interval])
              )
            )`,
  tx: `- sum(
              max by (cluster, namespace, pod, interface) (
                rate(container_network_transmit_bytes_total{cluster="$cluster", namespace="$namespace", pod=~"$pod"}[$__rate_interval])
              )
            )`,
};

export const workloadNetworkSaturationQueries = {
  rx: `sum(
              max by (namespace, pod, interface) (
                rate(container_network_receive_packets_dropped_total{cluster="$cluster", namespace="$namespace", pod=~"$pod"}[$__rate_interval])
              )
            )`,
  tx: `- sum(
              max by (namespace, pod, interface) (
                rate(container_network_transmit_packets_dropped_total{cluster="$cluster", namespace="$namespace", pod=~"$pod"}[$__rate_interval])
              )
            )`,
};

export const workloadNetworkBandwidthByPodQueries = {
  rx: `sum by (cluster, namespace, workload, workload_type, pod) (
              max by (cluster, namespace, pod, interface) (
                rate(container_network_receive_bytes_total{cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"}[$__rate_interval])
              )
              * on (cluster, namespace, pod) group_left (workload, workload_type)
              group by (cluster, namespace, workload, workload_type, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"})
            )`,
  tx: `- sum by (cluster, namespace, workload, workload_type, pod) (
              max by (cluster, namespace, pod, interface) (
                rate(container_network_transmit_bytes_total{cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"}[$__rate_interval])
              )
              * on (cluster, namespace, pod) group_left (workload, workload_type)
              group by (cluster, namespace, workload, workload_type, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod"})
            )`,
};

export const workloadNetworkSaturationByPodQueries = {
  rx: `sum by (cluster, namespace, workload, workload_type, pod) (
              max by (cluster, namespace, pod, interface) (
                rate(container_network_receive_packets_dropped_total{cluster="$cluster", namespace="$namespace", pod=~"$pod"}[$__rate_interval])
              )
              * on (cluster, namespace, pod) group_left (workload, workload_type)
              group by (cluster, namespace, workload, workload_type, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod"})
            )`,
  tx: `- sum by (cluster, namespace, pod, workload, workload_type, pod) (
              max by (cluster, namespace, pod, interface) (
                rate(container_network_transmit_packets_dropped_total{cluster="$cluster", namespace="$namespace", pod=~"$pod"}[$__rate_interval])
              )
              * on (cluster, namespace, pod) group_left (workload, workload_type)
              group by (cluster, namespace, workload, workload_type, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace", pod=~"$pod"})
            )`,
};
