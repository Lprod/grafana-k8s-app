// PromQL queries for the Node Drilldown's Storage tab (nodeStorageScene.tsx),
// pasted verbatim from the reference dashboard (node.json). Every PVC-related
// query starts from the same join fragment - group every
// kube_pod_spec_volumes_persistentvolumeclaims_info row down to just this
// node's own pods via a group_left existence-join against
// kube_pod_info{node="$node"} (an *exact* match in the source, not a regex -
// see substituteClusterNodeAndPodToken's own comment in nodeQueries.ts for
// why that needs the raw node name, not the escaped nodeRegex, substituted
// in). Titles say "by workload" on three panels whose queries actually group
// by `pod`, not `workload` - given verbatim, matching this codebase's
// "preserve intentional-looking naming quirks" convention (same pattern as
// the Namespace/Workload Drilldowns' own "Workloads" tables that are
// genuinely pod-grained).

const pvcNodeJoinFragment = `group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
    kube_pod_spec_volumes_persistentvolumeclaims_info{cluster=~"$cluster", pod=~"$pod", volume!=""}
    * on (cluster, namespace, pod) group_left()
    max by (cluster, namespace, pod) (
      kube_pod_info{cluster=~"$cluster", node="$node"}
    )
  )`;

export const nodePvcStorageClassQuery = `count by (storageclass) (
  ${pvcNodeJoinFragment}
  * on (cluster, namespace, persistentvolumeclaim) group_left(storageclass)
  max by (cluster, namespace, persistentvolumeclaim, storageclass) (
    kube_persistentvolumeclaim_info{cluster=~"$cluster", storageclass!=""}
  )
)`;

export const nodePvcVolumeBytesQueries = {
  requested: `sum by (cluster) (
    ${pvcNodeJoinFragment}
    * on (cluster, namespace, persistentvolumeclaim) group_left()
    max by (cluster, namespace, pod, persistentvolumeclaim) (
      kube_persistentvolumeclaim_resource_requests_storage_bytes{cluster=~"$cluster"}
    )
  )`,
  capacity: `sum by (cluster) (
    ${pvcNodeJoinFragment}
    * on (cluster, namespace, persistentvolumeclaim) group_left()
    max by (cluster, namespace, persistentvolumeclaim) (
      kubelet_volume_stats_capacity_bytes{cluster=~"$cluster"}
    )
  )`,
  used: `sum by (cluster) (
    ${pvcNodeJoinFragment}
    * on (cluster, namespace, persistentvolumeclaim) group_left()
    max by (cluster, namespace, persistentvolumeclaim) (
      kubelet_volume_stats_used_bytes{cluster=~"$cluster"}
    )
  )`,
};

export const nodePvcVolumeBytesByPodQuery = `avg by (cluster, namespace, pod) (
  ${pvcNodeJoinFragment}
  * on (cluster, namespace, persistentvolumeclaim) group_left() (
    max by (cluster, namespace, persistentvolumeclaim) (
      kubelet_volume_stats_used_bytes{cluster=~"$cluster"}
    )
    / on (cluster, namespace, persistentvolumeclaim) group_left()
    max by (cluster, namespace, persistentvolumeclaim) (
      kubelet_volume_stats_capacity_bytes{cluster=~"$cluster"}
    )
  )
)`;

export const nodePvcVolumeInodesQueries = {
  capacity: `sum by (cluster) (
    ${pvcNodeJoinFragment}
    * on (cluster, namespace, persistentvolumeclaim) group_left()
    max by (cluster, namespace, persistentvolumeclaim) (
      kubelet_volume_stats_inodes{cluster=~"$cluster"}
    )
  )`,
  used: `sum by (cluster) (
    ${pvcNodeJoinFragment}
    * on (cluster, namespace, persistentvolumeclaim) group_left()
    max by (cluster, namespace, persistentvolumeclaim) (
      kubelet_volume_stats_inodes_used{cluster=~"$cluster"}
    )
  )`,
};

export const nodePvcVolumeInodesByPodQuery = `avg by (cluster, namespace, pod) (
  ${pvcNodeJoinFragment}
  * on (cluster, namespace, persistentvolumeclaim) group_left() (
    max by (cluster, namespace, persistentvolumeclaim) (
      kubelet_volume_stats_inodes_used{cluster=~"$cluster"}
    )
    / on (cluster, namespace, persistentvolumeclaim) group_left()
    max by (cluster, namespace, persistentvolumeclaim) (
      kubelet_volume_stats_inodes{cluster=~"$cluster"}
    )
  )
)`;

export const nodePvcStatusQuery = `count by (cluster, phase) (
  ${pvcNodeJoinFragment}
  * on (cluster, namespace, persistentvolumeclaim) group_left(phase)
  max by (cluster, namespace, persistentvolumeclaim, phase) (
    kube_persistentvolumeclaim_status_phase{cluster=~"$cluster"} == 1
  )
)`;

// "PV Status" - given verbatim, including the source's own comment about
// why "Released" needs a second, separately-joined lookup (a released PVC no
// longer has a matching PVC-side row to join against by definition).
export const nodePvStatusQuery = `count by (cluster, phase) (
  ${pvcNodeJoinFragment}
  * on (cluster, namespace, persistentvolumeclaim) group_left(volumename)
  max by (cluster, namespace, persistentvolumeclaim, volumename) (
    kube_persistentvolumeclaim_info{cluster=~"$cluster"} == 1
  )
  # phase="Released" will not join above so should be queried separately to be made visible
  * on (cluster, volumename) group_left(phase)
  label_join(
    max by (cluster, persistentvolume, phase) (
      kube_persistentvolume_status_phase{cluster=~"$cluster"} == 1
    )
  , "volumename", "", "persistentvolume")
)`;

const fsDeviceRegex = `(/dev.+)|mmcblk.p.+|nvme.+|rbd.+|sd.+|vd.+|xvd.+|dm-.+|dasd.+`;

export const nodeThroughputQueries = {
  rx: `sum by (instance) (rate(container_fs_reads_bytes_total{cluster=~"$cluster", device=~"${fsDeviceRegex}", node=~"$node"}[$__rate_interval]))`,
  tx: `-sum by (instance) (rate(container_fs_writes_bytes_total{cluster=~"$cluster", device=~"${fsDeviceRegex}", node=~"$node"}[$__rate_interval]))`,
};

export const nodeThroughputByPodQueries = {
  rx: `sum by (pod) (rate(container_fs_reads_bytes_total{cluster=~"$cluster", device=~"${fsDeviceRegex}", node=~"$node"}[$__rate_interval]))`,
  tx: `-sum by (pod) (rate(container_fs_writes_bytes_total{cluster=~"$cluster", device=~"${fsDeviceRegex}", node=~"$node"}[$__rate_interval]))`,
};

export const nodeIopsQueries = {
  rx: `sum by (node) (rate(container_fs_reads_total{cluster=~"$cluster", device=~"${fsDeviceRegex}", node=~"$node"}[$__rate_interval]))`,
  // "node=" (exact) in the given tx query, unlike every sibling rx/tx query
  // here which all use "node=~" - given verbatim, not "fixed" to match.
  tx: `-sum by(node) (rate(container_fs_writes_total{cluster=~"$cluster", device=~"${fsDeviceRegex}", node="$node"}[$__rate_interval]))`,
};

export const nodeIopsByPodQueries = {
  rx: `sum by (pod) (rate(container_fs_reads_total{cluster=~"$cluster", device=~"${fsDeviceRegex}", node=~"$node"}[$__rate_interval]))`,
  tx: `-sum by (pod) (rate(container_fs_writes_total{cluster=~"$cluster", device=~"${fsDeviceRegex}", node=~"$node"}[$__rate_interval]))`,
};
