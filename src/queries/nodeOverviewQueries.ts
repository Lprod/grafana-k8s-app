// PromQL query builders for the Node Drilldown's Overview tab. Like
// podOverviewQueries.ts, every query here already knows the exact
// (cluster, node) identity from the drilldown's own route params, so a plain
// metric selector is enough - no fallback/join chain needed.

// Health banner severity source - kube_node_status_condition, not alerts
// (the alerts action button in the banner is a separate query, see
// buildNodeAlertsSeverityQuery below). Same condition set as the Kubernetes
// home page's own "Nodes not ready"/pressure issue panels
// (kubernetesOverviewQueries.ts), narrowed to one node. "Bad" means a
// different status per condition - Ready is bad when false/unknown, every
// Pressure condition is bad when true - so each half needs its own status
// filter; kube-state-metrics emits one boolean-gauge series per condition
// *per possible status value*, so a single status=~"true|false|unknown"
// selector across both halves (the bug this replaced) would match whichever
// status happens to be current, healthy or not, and the "== 1" filter alone
// could never tell the two apart. With the status filters split like this,
// only genuinely "bad" rows come back at all - an empty result means the
// node is fully healthy, no separate healthy-case branch needed.
export function buildNodeConditionQuery(clusterRegex: string, node: string): string {
  return `max by (condition, status) (
    kube_node_status_condition{cluster="${clusterRegex}", node="${node}", condition="Ready", status=~"false|unknown"} == 1
    or
    kube_node_status_condition{cluster="${clusterRegex}", node="${node}", condition=~"MemoryPressure|DiskPressure|PIDPressure", status="true"} == 1
  )`;
}

// Deliberately just a direct "node" label match - grouped by severity to
// match every other health banner's own alerts-by-severity shape
// (buildNamespaceAlertsSeverityQuery etc.). A previous version of this also
// OR'd in pod-scoped alerts attributed to this node via a join against
// kube_pod_info (same idea as nodeTableQueries.alerts, nodeQueries.ts) -
// dropped here because this banner's own action button links straight to
// the Alerts page with just `var-nodes=<node>` in the URL, and that page's
// own Node filter (alertsPage.ts) can only do a plain "node" label match
// too, with no way to replicate the join from a URL param - the richer
// count made the banner and the page it links to disagree, showing e.g.
// "3 firing alerts" on the banner and an empty table after clicking
// through. Matching the simpler, actually-linkable query keeps the two
// consistent, even though it now misses pod-only alerts running on this
// node.
export function buildNodeAlertsSeverityQuery(clusterRegex: string, node: string): string {
  return `count by (severity) (ALERTS{alertstate="firing", cluster="${clusterRegex}", node="${node}", alertname!~"ArgoCDSyncAlert"})`;
}

// kube_node_info's own labels - internal_ip/os_image/kernel_version/
// kubelet_version/container_runtime_version all live on the one series, so
// one query covers the Overview tab's left+middle info card rows.
export function buildNodeInfoQuery(clusterRegex: string, node: string): string {
  return `max by (internal_ip, os_image, kernel_version, kubelet_version, container_runtime_version) (kube_node_info{cluster="${clusterRegex}", node="${node}"})`;
}

// VCF/vSphere identity chain, given verbatim: the node (as OpenShift/K8s
// knows it) is a VM, so vsphere_vm_cpu_idle_summation's own "vmname" label
// matches this node's name directly. From there the chain is vmname ->
// esxhostname (the ESX host it's running on) -> clustername (the vSphere/VCF
// cluster that ESX host belongs to) -> vcenter (the vCenter that cluster
// belongs to) - described as three sequential "same metric, different
// filter" lookups, translated here into one PromQL query via chained
// on(...)/group_left(...) self-joins against the same metric instead of
// three dependent Grafana panel queries (which would need JS-side chaining
// to feed one query's result into the next one's filter value). Not
// verifiable against the local demo stack - there's no vSphere/telegraf
// source in the demo compose stack - so this needs checking against a real
// environment.
export function buildNodeVcfInfoQuery(node: string): string {
  return `group by (esxhostname, clustername, vcenter) (
    vsphere_vm_cpu_idle_summation{vmname="${node}"}
    * on (esxhostname) group_left(clustername)
    group by (esxhostname, clustername) (vsphere_vm_cpu_idle_summation)
    * on (clustername) group_left(vcenter)
    group by (clustername, vcenter) (vsphere_vm_cpu_idle_summation)
  )`;
}

// "Node optimization" section - capacity/limits/requests/usage CPU/Memory
// timeseries, given verbatim. Unlike the Pod/Workload Drilldowns' own
// optimization charts (no hard ceiling at that level), this one has a
// "capacity" line like the Cluster Drilldown's own Overview tab - a node
// *does* have a hard physical resource ceiling - so it reuses that same
// styling convention (applyNodeOptimizationSeriesOverrides in
// nodesPage.tsx), not the Pod/Workload one.
export const nodeCpuOptimizationQueries = {
  cpuCapacity: `max by (cluster, node, resource) (kube_node_status_capacity{cluster=~"$cluster", node=~"$node", resource=~"cpu"})`,
  cpuLimits: `sum(max by (cluster, namespace, node, pod, container) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_limits{container!="", cluster=~"$cluster", node=~"$node"}))`,
  cpuRequests: `sum(max by (cluster, namespace, node, pod, container, resource) (cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{container!="", cluster=~"$cluster", node=~"$node"}))`,
  cpuUsage: `sum(label_join(sum by (cluster, instance) (max by (cluster, instance, cpu, core) (1 - rate(node_cpu_seconds_total{cluster=~"$cluster", instance=~"$node", mode=~"idle"}[$__rate_interval]) >= 0)) or sum by (cluster, instance) (rate(node_cpu_usage_seconds_total{cluster=~"$cluster", instance=~"$node"}[$__rate_interval]) >= 0), "node", ",", "instance") or label_join(sum by (cluster, instance) (max by (cluster, instance, cpu, core) (1 - rate(node_cpu_seconds_total{cluster=~"$cluster", node=~"$node", mode=~"idle"}[$__rate_interval]) >= 0)) or sum by (cluster, instance) (rate(node_cpu_usage_seconds_total{cluster=~"$cluster", node=~"$node"}[$__rate_interval]) >= 0), "node", ",", "instance"))`,
};

export type NodeCpuOptimizationKey = keyof typeof nodeCpuOptimizationQueries;

export const nodeMemoryOptimizationQueries = {
  memCapacity: `max by (cluster, node, resource) (kube_node_status_capacity{cluster=~"$cluster", node=~"$node", resource=~"memory"})`,
  memLimits: `sum(max by (cluster, namespace, node, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{container!="", cluster=~"$cluster", node=~"$node"}))`,
  // Given verbatim - reuses the *limits* metric a second time rather than a
  // requests one, same "translate literally, don't fix" convention as every
  // other given-query asymmetry in this codebase.
  memRequests: `sum(max by (cluster, namespace, node, pod, container) (cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{container!="", cluster=~"$cluster", node=~"$node"}))`,
  memUsage: `label_join(max by (cluster, instance) (node_memory_Active_file_bytes{cluster=~"$cluster", instance=~"$node"}) + on (cluster, instance) group_left max by (cluster, instance) (node_memory_AnonPages_bytes{cluster=~"$cluster", instance=~"$node"}) or max by (cluster, instance) (node_memory_working_set_bytes{cluster=~"$cluster", instance=~"$node"}), "node", ",", "instance")`,
};

export type NodeMemoryOptimizationKey = keyof typeof nodeMemoryOptimizationQueries;

// No Pod picker on this page (it lists every pod scheduled on this node, not
// one specific pod) - $pod is left to match every pod, same as the
// hardcoded namespace=~".+"/workload=~".+" wildcards already baked into
// "info" below by the queries as given.
export function substituteClusterNodeAndPod(expr: string, clusterRegex: string, nodeRegex: string): string {
  return expr.replaceAll('$cluster', clusterRegex).replaceAll('$node', nodeRegex).replaceAll('$pod', '.+');
}

// "Pods" table (Overview tab) - one row per pod scheduled on this node,
// given verbatim (same shape as workloadPodsTableQueries.info - most recent
// pod info/workload-attribution/phase, each via its own topk-by-time
// dedup). The given query set also included an "infoWaiting" query (avg of
// kube_pod_status_phase{phase="Running"}) - deliberately dropped rather than
// translated literally: unlike every other query here, it has no
// node=~"$node" filter at all, so merging it in injected a phantom row for
// every Running pod cluster-wide (not just this node's own pods) - confirmed
// live (curl against Prometheus showed it returning debug-shell-aws/
// cache-0-aws/db-migrate-1-aws for a query scoped to a node none of them are
// scheduled on). Its own value was never going to be shown as a column
// either way (same "queried but excluded from display" treatment as
// "info"), so there's no display-fidelity trade-off in leaving it out
// entirely - only the phantom-row bug it was causing.
export const nodePodsTableQueries = {
  info: `topk by (cluster, namespace, workload, workload_type, pod) (1,
      max by (cluster, namespace, pod, node, pod_ip, uid, asserts_env, asserts_site) (
        last_over_time((timestamp(kube_pod_info{cluster=~"$cluster", namespace=~".+", node=~"$node", pod=~"$pod"}))[$__range:])
      )
      * on (cluster, namespace, pod) group_left (workload, workload_type)
      last_over_time((group by (cluster, namespace, workload, workload_type, pod) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~".+", workload=~".+", pod=~"$pod"}))[$__range:])
      * on (cluster, namespace, pod) group_left (phase)
      group by (cluster, namespace, pod, phase) (
        topk by (cluster, namespace, pod) (1,
          last_over_time((timestamp(kube_pod_status_phase{cluster=~"$cluster", namespace=~".+", pod=~"$pod"} == 1))[$__range:])
        )
      )
    )`,
  cpu_usage: `sum(node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="$cluster", node=~"$node"}) by (cluster, namespace, pod)`,
  cpu_requests: `sum(cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{cluster="$cluster", node=~"$node"}) by (cluster, namespace, pod)`,
  cpu_requests_percent: `sum(node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster="$cluster", node=~"$node"}) by (cluster, namespace, pod) / sum(cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests{cluster="$cluster", node=~"$node"}) by (cluster, namespace, pod)`,
  mem_usage: `sum(node_namespace_pod_container:container_memory_working_set_bytes{cluster="$cluster", node=~"$node",container!=""}) by (cluster, namespace, pod)`,
  mem_requests: `sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{cluster="$cluster", node=~"$node"}) by (cluster, namespace, pod)`,
  mem_requests_percent: `sum(node_namespace_pod_container:container_memory_working_set_bytes{cluster="$cluster", node=~"$node",container!=""}) by (cluster, namespace, pod) / sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_requests{cluster="$cluster", node=~"$node"}) by (cluster, namespace, pod)`,
  mem_limits: `sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{cluster="$cluster", node=~"$node"}) by (cluster, namespace, pod)`,
  mem_limits_percent: `sum(node_namespace_pod_container:container_memory_working_set_bytes{cluster="$cluster", node=~"$node",container!=""}) by (cluster, namespace, pod) / sum(cluster:namespace:pod_memory:active:kube_pod_container_resource_limits{cluster="$cluster", node=~"$node"}) by (cluster, namespace, pod)`,
};

export type NodePodsTableQueryKey = keyof typeof nodePodsTableQueries;
