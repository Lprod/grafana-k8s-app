export type EntityScope = {
  cluster?: string;
  namespace?: string;
  workload?: string;
  workloadType?: string;
  pod?: string;
  node?: string;
};

export function matcher(label: string, value?: string, operator = '=~') {
  if (!value) {
    return '';
  }

  return `${label}${operator}"${value}"`;
}

export function joinMatchers(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(', ');
}

export function scopedMatchers(scope: EntityScope = {}) {
  return joinMatchers(
    matcher('cluster', scope.cluster ?? '${cluster:regex}'),
    matcher('namespace', scope.namespace),
    matcher('workload', scope.workload),
    matcher('workload_type', scope.workloadType),
    matcher('pod', scope.pod),
    matcher('node', scope.node)
  );
}

export const countClusters = () => 'count(count by (cluster) (kube_node_info{cluster=~"${cluster:regex}"}))';

export const countNodes = () => 'count(count by (cluster, node) (kube_node_info{cluster=~"${cluster:regex}", node!=""}))';

export const countNamespaces = () =>
  'count(count by (cluster, namespace) (kube_namespace_status_phase{cluster=~"${cluster:regex}", namespace!=""}))';

export const countWorkloads = () =>
  'count(count by (cluster, namespace, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~"${cluster:regex}", namespace!="", workload!=""}))';

export const countPods = () =>
  'count(count by (cluster, namespace, pod) (kube_pod_info{cluster=~"${cluster:regex}", namespace!="", pod!=""}))';

export const firingAlerts = (scope: EntityScope = {}) => {
  const filters = joinMatchers(scopedMatchers(scope), 'alertstate="firing"');
  return `count by (cluster, namespace, alertname, severity) (ALERTS{${filters}})`;
};

export const clusterInventory = () => `
count by (cluster) (kube_node_info{cluster=~"\${cluster:regex}"})
`;

export const namespaceInventory = () => `
count by (cluster, namespace) (
  kube_pod_info{cluster=~"\${cluster:regex}", namespace=~"\${namespace:regex}", namespace!="", pod!=""}
)
`;

export const workloadInventory = () => `
count by (cluster, namespace, workload, workload_type) (
  namespace_workload_pod:kube_pod_owner:relabel{
    cluster=~"\${cluster:regex}",
    namespace=~"\${namespace:regex}",
    workload!="",
    workload_type!="",
    pod!="",
    pod=~".*"
  }
)
`;

export const nodeInventory = () => `
max by (cluster, node, kernel_version, kubelet_version, container_runtime_version, os_image) (
  kube_node_info{cluster=~"\${cluster:regex}", node!=""}
)
`;

export const clusterCpuUsage = (scope: EntityScope = {}) => {
  const filters = scopedMatchers(scope);
  return `
sum by (cluster) (
  rate(container_cpu_usage_seconds_total{${filters}, container!="", container!="POD"}[$__rate_interval])
)
`;
};

export const clusterMemoryWorkingSet = (scope: EntityScope = {}) => {
  const filters = scopedMatchers(scope);
  return `
sum by (cluster) (
  container_memory_working_set_bytes{${filters}, container!="", container!="POD"}
)
`;
};

export const namespaceCpuUsage = (scope: EntityScope = {}) => {
  const filters = scopedMatchers(scope);
  return `
sum by (cluster, namespace) (
  rate(container_cpu_usage_seconds_total{${filters}, container!="", container!="POD"}[$__rate_interval])
)
`;
};

export const namespaceMemoryWorkingSet = (scope: EntityScope = {}) => {
  const filters = scopedMatchers(scope);
  return `
sum by (cluster, namespace) (
  container_memory_working_set_bytes{${filters}, container!="", container!="POD"}
)
`;
};

export const podPhases = (scope: EntityScope = {}) => {
  const filters = scopedMatchers(scope);
  return `
sum by (cluster, namespace, phase) (
  kube_pod_status_phase{${filters}, phase=~"Pending|Running|Succeeded|Failed|Unknown"} == 1
)
`;
};

export const nodeConditions = (scope: EntityScope = {}) => {
  const filters = scopedMatchers(scope);
  return `
max by (cluster, node, condition, status) (
  kube_node_status_condition{${filters}, condition=~"Ready|MemoryPressure|DiskPressure|PIDPressure", status=~"true|false|unknown"}
)
`;
};

export const namespaceQuota = (scope: EntityScope = {}) => {
  const filters = scopedMatchers(scope);
  return `
max by (cluster, namespace, resource, type) (
  kube_resourcequota{${filters}, resource=~"requests.cpu|requests.memory|limits.cpu|limits.memory"}
)
`;
};
