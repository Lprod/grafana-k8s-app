// PromQL queries for the Namespace Drilldown's Network tab
// (src/pages/Namespaces/namespaceNetworkScene.tsx), pasted verbatim from
// Grafana's own Kubernetes Monitoring app (play.grafana.org) - same
// literal-translation convention as namespaceCpuQueries.ts/
// namespaceMemoryQueries.ts. None of these reference a `$pod` placeholder
// (unlike the CPU/Memory tabs), so this tab has no Pod picker. Kept as
// given even where a query's `cluster`/`namespace` filter operator (`=` vs
// `=~`) differs from its sibling - the "by workload" pair uses `=` for
// Bandwidth but `=~` for Saturation, both inside the workload-attribution
// join and in the outer rate() selector - not "fixed" to be consistent.

export const namespaceNetworkBandwidthQueries = {
  rx: `sum(
              max by (cluster, namespace, pod, interface) (
                rate(container_network_receive_bytes_total{cluster="$cluster", namespace="$namespace"}[$__rate_interval])
              )
            )`,
  tx: `- sum(
              max by (cluster, namespace, pod, interface) (
                rate(container_network_transmit_bytes_total{cluster="$cluster", namespace="$namespace"}[$__rate_interval])
              )
            )`,
};

export const namespaceNetworkSaturationQueries = {
  rx: `sum(
              max by (namespace, pod, interface) (
                rate(container_network_receive_packets_dropped_total{cluster="$cluster", namespace="$namespace", pod!=""}[$__rate_interval])
              )
            )`,
  tx: `- sum(
              max by (namespace, pod, interface) (
                rate(container_network_transmit_packets_dropped_total{cluster="$cluster", namespace="$namespace", pod!=""}[$__rate_interval])
              )
            )`,
};

// The bare-pod/static-pod/replicaset/attributed-workload fallback chain,
// exactly as given - a simpler 4-branch version of the one
// kubernetesTopStatQueries.workloads (kubernetesOverviewQueries.ts) uses
// (that one also covers daemonset/job/statefulset/kube_deployment
// directly), so kept as its own separate fragment rather than reusing that
// one. Parameterized by the `cluster`/`namespace` match operator since the
// two "by workload" queries below embed it with different operators.
function workloadAttributionFragment(operator: '=' | '=~'): string {
  return `
          namespace_workload_pod:kube_pod_owner:relabel{cluster${operator}"$cluster", namespace${operator}"$namespace", workload_type=~".+", workload!="", pod=~".+"}

          OR

          label_replace(
            label_replace(
              namespace_workload_pod:kube_pod_owner:relabel{cluster${operator}"$cluster", namespace${operator}"$namespace", workload_type=~".+", workload="", pod=~".+"}
            , "workload", "$1", "pod", "(.+)-(.+)")
          , "workload_type", "replicaset", "", "")

          OR

          label_replace(
            label_replace(
              kube_pod_owner{cluster${operator}"$cluster", namespace${operator}"$namespace", pod=~".+", owner_kind=""}
            , "workload", "$1", "pod", "(.+)")
          , "workload_type", "pod", "", "")

          OR

          label_replace(
            label_replace(
              kube_pod_owner{cluster${operator}"$cluster", namespace${operator}"$namespace", pod=~".+", owner_kind="Node"}
            , "workload", "$1", "pod", "(.+)")
          , "workload_type", "staticpod", "", "")
      `;
}

export const namespaceNetworkBandwidthByWorkloadQueries = {
  rx: `sum by (cluster, namespace, workload, workload_type) (
              max by (cluster, namespace, pod, interface) (
                rate(container_network_receive_bytes_total{cluster="$cluster", namespace="$namespace"}[$__rate_interval])
              )
              * on (cluster, namespace, pod) group_left (workload, workload_type)
              group by (cluster, namespace, pod, workload, workload_type) (
${workloadAttributionFragment('=')}
              )
            )`,
  tx: `- sum by (cluster, namespace, workload, workload_type) (
              max by (cluster, namespace, pod, interface) (
                rate(container_network_transmit_bytes_total{cluster="$cluster", namespace="$namespace"}[$__rate_interval])
              )
              * on (cluster, namespace, pod) group_left (workload, workload_type)
              group by (cluster, namespace, pod, workload, workload_type) (
${workloadAttributionFragment('=')}
              )
            )`,
};

export const namespaceNetworkSaturationByWorkloadQueries = {
  rx: `sum by (cluster, namespace, workload, workload_type) (
              max by (cluster, namespace, pod, interface) (
                rate(container_network_receive_packets_dropped_total{cluster=~"$cluster", namespace=~"$namespace"}[$__rate_interval])
              )
              * on (cluster, namespace, pod) group_left (workload, workload_type)
              group by (cluster, namespace, pod, workload, workload_type) (
${workloadAttributionFragment('=~')}
              )
            )`,
  tx: `- sum by (cluster, namespace, workload, workload_type) (
              max by (cluster, namespace, pod, interface) (
                rate(container_network_transmit_packets_dropped_total{cluster=~"$cluster", namespace=~"$namespace"}[$__rate_interval])
              )
              * on (cluster, namespace, pod) group_left (workload, workload_type)
              group by (cluster, namespace, pod, workload, workload_type) (
${workloadAttributionFragment('=~')}
              )
            )`,
};
