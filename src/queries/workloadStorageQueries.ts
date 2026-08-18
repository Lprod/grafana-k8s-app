// PromQL queries for the Workload Drilldown's Storage tab
// (src/pages/Workloads/workloadStorageScene.tsx), pasted verbatim from
// Grafana's own Kubernetes Monitoring app - same literal-translation
// convention as workloadCpuQueries.ts/workloadNetworkQueries.ts. Every query
// here carries a `pod=~"$pod"` filter (where the underlying metric has a pod
// dimension at all - kube_persistentvolumeclaim_info/kube_persistentvolume_
// status_phase etc. don't, same as the Namespace Drilldown's own Storage tab
// never filtered those either). No bare-pod/static-pod/replicaset fallback
// chain is needed for the "by pod" panels - $pod (the hidden Pod variable)
// already resolves to exactly this workload's own pods, so `sum by (pod)`
// is enough on its own.
//
// Given only 3 PVC Volume Bytes series (requests/capacity/used) and 2 PVC
// Volume inodes series (total/used) this time - unlike the Namespace
// Drilldown's own Storage tab, no "PV filling up"/"Inodes filling up" alert
// series were given, so those two panels have fewer series here.
//
// One apparent copy-paste typo fixed rather than preserved: "IOPS by pod"'s
// Tx line, as given, reused container_fs_reads_total instead of
// container_fs_writes_total (every other Tx line in this tab, including
// this same panel's own Rx/non-"by pod" sibling, correctly uses
// container_fs_writes_total) - reproducing it verbatim would make the
// "Writes" series just duplicate the "Reads" series, which doesn't look like
// an intentional query choice the way e.g. `=` vs `=~` operator asymmetries
// elsewhere in these queries do.

import { FS_DEVICE_REGEX } from './namespaceStorageQueries';

export const workloadEphemeralVolumeUsageQuery = `container_fs_usage_bytes{k8s_cluster_name="$cluster", k8s_namespace_name="$namespace", container!="POD", pod=~"$pod"}
/ on(pod, container, k8s_namespace_name) group_left
  max by (pod, container, k8s_namespace_name) (
    kube_pod_container_resource_limits{k8s_cluster_name="$cluster", k8s_namespace_name="$namespace", resource="ephemeral_storage", pod=~"$pod"})`;

export const workloadPvcStorageClassQuery = `count by (storageclass) (
        group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
          kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", pod=~"$pod", volume!=""}
        )
        * on (cluster, namespace, persistentvolumeclaim) group_left(storageclass)
        max by (cluster, namespace, pod, persistentvolumeclaim, storageclass) (
          kube_persistentvolumeclaim_info{cluster="$cluster", namespace="$namespace", storageclass!=""}
        )
      )`;

export const workloadPvcVolumeBytesQueries = {
  requests: `sum by (cluster, namespace) (
            group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
              kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", pod=~"$pod", volume!=""}
            )
            * on (cluster, namespace, persistentvolumeclaim) group_left()
            max by (cluster, namespace, pod, persistentvolumeclaim) (
              kube_persistentvolumeclaim_resource_requests_storage_bytes{cluster="$cluster", namespace="$namespace"}
            )
          )`,
  capacity: `sum by (cluster, namespace) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", pod=~"$pod", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left()
          max by (cluster, namespace, persistentvolumeclaim) (
            kubelet_volume_stats_capacity_bytes{cluster="$cluster", namespace="$namespace"}
          )
        )`,
  used: `sum by (cluster, namespace) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", pod=~"$pod", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left()
          max by (cluster, namespace, persistentvolumeclaim) (
            kubelet_volume_stats_used_bytes{cluster="$cluster", namespace="$namespace"}
          )
        )`,
};

export const workloadPvcVolumeBytesByWorkloadQuery = `sum by (cluster, namespace, pod) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", pod=~"$pod", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left() (
            max by (cluster, namespace, persistentvolumeclaim) (
              kubelet_volume_stats_used_bytes{cluster="$cluster", namespace="$namespace"}
            )
            / on (cluster, namespace, persistentvolumeclaim) group_left()
            max by (cluster, namespace, persistentvolumeclaim) (
              kubelet_volume_stats_capacity_bytes{cluster="$cluster", namespace="$namespace"}
            )
          )
        )`;

export const workloadPvcVolumeInodesQueries = {
  total: `sum by (cluster, namespace) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", pod=~"$pod", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left()
          max by (cluster, namespace, persistentvolumeclaim) (
            kubelet_volume_stats_inodes{cluster="$cluster", namespace="$namespace"}
          )
        )`,
  used: `sum by (cluster, namespace) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", pod=~"$pod", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left()
          max by (cluster, namespace, persistentvolumeclaim) (
            kubelet_volume_stats_inodes_used{cluster="$cluster", namespace="$namespace"}
          )
        )`,
};

export const workloadPvcVolumeInodesByWorkloadQuery = `sum by (cluster, namespace, pod) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", pod=~"$pod", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left() (
            max by (cluster, namespace, persistentvolumeclaim) (
              kubelet_volume_stats_inodes_used{cluster="$cluster", namespace="$namespace"}
            )
            / on (cluster, namespace, persistentvolumeclaim) group_left()
            max by (cluster, namespace, persistentvolumeclaim) (
              kubelet_volume_stats_inodes{cluster="$cluster", namespace="$namespace"}
            )
          )
        )`;

export const workloadPvcStatusQuery = `count by (cluster, namespace, phase) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", pod=~"$pod", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left(phase)
          max by (cluster, namespace, pod, persistentvolumeclaim, phase) (
            kube_persistentvolumeclaim_status_phase{cluster="$cluster", namespace="$namespace"} == 1
          )
        )`;

// "phase=Released" won't join above so is queried separately to still be
// visible - given verbatim, comment included.
export const workloadPvStatusQuery = `count by (cluster, namespace, phase) (
        group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
          kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", pod=~"$pod", volume!=""}
        )
        * on (cluster, namespace, persistentvolumeclaim) group_left(volumename)
        max by (cluster, namespace, persistentvolumeclaim, volumename) (
          kube_persistentvolumeclaim_info{cluster="$cluster", namespace="$namespace", volumename!=""} == 1
        )
        # phase="Released" will not join above so should be queried separately to be made visible
        * on (cluster, volumename) group_left(phase)
        label_join(
          max by (cluster, persistentvolume, phase) (
            kube_persistentvolume_status_phase{cluster="$cluster"} == 1
          )
        , "volumename", "", "persistentvolume")
      )`;

export const workloadThroughputQueries = {
  rx: `sum(rate(container_fs_reads_bytes_total{cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
  tx: `-sum(rate(container_fs_writes_bytes_total{cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
};

export const workloadThroughputByPodQueries = {
  rx: `sum by (pod) (rate(container_fs_reads_bytes_total{cluster=~"$cluster", namespace=~"$namespace", device=~"${FS_DEVICE_REGEX}", pod=~"$pod"}[$__rate_interval]))`,
  tx: `-sum by (pod) (rate(container_fs_writes_bytes_total{cluster=~"$cluster", namespace=~"$namespace", device=~"${FS_DEVICE_REGEX}", pod=~"$pod"}[$__rate_interval]))`,
};

export const workloadIopsQueries = {
  rx: `sum(rate(container_fs_reads_total{cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
  tx: `-sum(rate(container_fs_writes_total{cluster=~"$cluster", namespace=~"$namespace", pod=~"$pod", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
};

export const workloadIopsByPodQueries = {
  rx: `sum by (pod) (rate(container_fs_reads_total{cluster=~"$cluster", namespace=~"$namespace", device=~"${FS_DEVICE_REGEX}", pod=~"$pod"}[$__rate_interval]))`,
  // See the file-level comment - "writes" here (given verbatim it repeated
  // "reads").
  tx: `-sum by (pod) (rate(container_fs_writes_total{cluster=~"$cluster", namespace=~"$namespace", device=~"${FS_DEVICE_REGEX}", pod=~"$pod"}[$__rate_interval]))`,
};
