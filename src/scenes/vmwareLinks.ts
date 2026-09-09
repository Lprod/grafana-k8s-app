// Cross-plugin links into the sibling "grafana-vmware-app" plugin
// (id "debeka-vmware-app", https://github.com/Lprod/grafana-vmware-app) -
// wherever this app surfaces a VMware entity that plugin has its own page
// for: a node's underlying VCF cluster / ESXi host (Clusters/Hosts
// drilldowns, read from kube_node_info + the vsphere_vm_cpu_* self-join in
// buildNodeVcfInfoQuery, nodeOverviewQueries.ts), and vcf_vcenter/provider
// itself (the VMware app's own Overview page, which always shows exactly
// one whole vCenter - scoped via its own multi-value "vcenter" QueryVariable,
// see vsphereVariables.ts - a single `var-vcenter=X` URL param is a normal,
// supported way to pre-select just one value on a multi-select variable).
//
// Deliberately plain paths, no `${__url.params}`/query-string carryover
// like this app's own intra-app cross-page links use (see NAMESPACES_URL/
// WORKLOADS_URL in nodeDependenciesScene.tsx) - both apps happen to name
// their Thanos datasource template variable "datasource" (see each repo's
// own datasourceVariables.ts/vsphereVariables.ts) but point it at different
// default UIDs ("thanos-demo" here vs. "thanos-vmware-demo" there), so
// blindly forwarding this app's var-datasource would hand the VMware app a
// UID that isn't one of its own variable's options.
const VMWARE_BASE_URL = '/a/debeka-vmware-app';
export const VMWARE_CLUSTERS_URL = `${VMWARE_BASE_URL}/clusters`;
export const VMWARE_HOSTS_URL = `${VMWARE_BASE_URL}/hosts`;
export const VMWARE_OVERVIEW_URL = `${VMWARE_BASE_URL}/overview`;

export function vmwareClusterUrl(clustername: string): string {
  return `${VMWARE_CLUSTERS_URL}/${encodeURIComponent(clustername)}`;
}

export function vmwareHostUrl(esxhostname: string): string {
  return `${VMWARE_HOSTS_URL}/${encodeURIComponent(esxhostname)}`;
}

export function vmwareOverviewUrl(vcenter: string): string {
  return `${VMWARE_OVERVIEW_URL}?var-vcenter=${encodeURIComponent(vcenter)}`;
}
