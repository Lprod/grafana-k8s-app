// PromQL queries for the Namespace Drilldown's Storage tab
// (src/pages/Namespaces/namespaceStorageScene.tsx), pasted verbatim from
// Grafana's own Kubernetes Monitoring app (play.grafana.org) - same
// literal-translation convention as namespaceCpuQueries.ts/
// namespaceMemoryQueries.ts/namespaceNetworkQueries.ts. Kept as given even
// where a query's `cluster`/`namespace` filter operator (`=` vs `=~`)
// differs from its sibling - e.g. Throughput by workload uses `=` but IOPS
// by workload uses `=~`, both inside the workload-attribution join and the
// outer rate() selector.
//
// The tab has no Pod filter (removed - every `pod=~"$pod"` matcher this
// tab's queries used to carry, on Ephemeral Volume Usage and the
// Throughput/IOPS "by workload" pair, was stripped so they cover every pod
// unconditionally instead); every PVC-related query (Storage Class, Volume
// Bytes/inodes, PVC/PV Status) never had one, since a PersistentVolumeClaim
// isn't filtered by which pod currently mounts it in these queries.

export const FS_DEVICE_REGEX = '(/dev.+)|mmcblk.p.+|nvme.+|rbd.+|sd.+|vd.+|xvd.+|dm-.+|dasd.+';

export const namespaceEphemeralVolumeUsageQuery = `container_fs_usage_bytes{k8s_cluster_name="$cluster", k8s_namespace_name="$namespace", container!="POD"}
/ on(pod, container, k8s_namespace_name) group_left
  max by (pod, container, k8s_namespace_name) (
    kube_pod_container_resource_limits{k8s_cluster_name="$cluster", k8s_namespace_name="$namespace", resource="ephemeral_storage"})`;

export const namespacePvcStorageClassQuery = `count by (storageclass) (
        group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
          kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
        )
        * on (cluster, namespace, persistentvolumeclaim) group_left(storageclass)
        max by (cluster, namespace, pod, persistentvolumeclaim, storageclass) (
          kube_persistentvolumeclaim_info{cluster="$cluster", namespace="$namespace", storageclass!=""}
        )
      )`;

export const namespacePvcVolumeBytesQueries = {
  requests: `sum by (cluster, namespace) (
            group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
              kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
            )
            * on (cluster, namespace, persistentvolumeclaim) group_left()
            max by (cluster, namespace, pod, persistentvolumeclaim) (
              kube_persistentvolumeclaim_resource_requests_storage_bytes{cluster="$cluster", namespace="$namespace"}
            )
          )`,
  capacity: `sum by (cluster, namespace) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left()
          max by (cluster, namespace, persistentvolumeclaim) (
            kubelet_volume_stats_capacity_bytes{cluster="$cluster", namespace="$namespace"}
          )
        )`,
  used: `sum by (cluster, namespace) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left()
          max by (cluster, namespace, persistentvolumeclaim) (
            kubelet_volume_stats_used_bytes{cluster="$cluster", namespace="$namespace"}
          )
        )`,
  alertsWarning: `group by (cluster, namespace, alertname, severity) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left(alertname, severity)
          ALERTS{alertname="KubePersistentVolumeFillingUp", alertstate="firing", severity="warning", cluster="$cluster", namespace="$namespace"}
        )`,
  alertsCritical: `group by (cluster, namespace, alertname, severity) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left(alertname, severity)
          ALERTS{alertname="KubePersistentVolumeFillingUp", alertstate="firing", severity="critical", cluster="$cluster", namespace="$namespace"}
        )`,
};

export const namespacePvcVolumeBytesByWorkloadQuery = `sum by (cluster, namespace, workload, workload_type) (
          sum by (cluster, namespace, pod) (
            group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
              kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
            )
            * on (cluster, namespace, persistentvolumeclaim) group_left()
            max by (cluster, namespace, persistentvolumeclaim) (
              kubelet_volume_stats_used_bytes{cluster="$cluster", namespace="$namespace"}
            )
          )
          * on (cluster, namespace, pod) group_left(workload, workload_type)
          namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
        )
        /
        sum by (cluster, namespace, workload, workload_type) (
          sum by (cluster, namespace, pod) (
            group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
              kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
            )
            * on (cluster, namespace, persistentvolumeclaim) group_left()
            max by (cluster, namespace, persistentvolumeclaim) (
              kubelet_volume_stats_capacity_bytes{cluster="$cluster", namespace="$namespace"}
            )
          )
          * on (cluster, namespace, pod) group_left(workload, workload_type)
          namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
        )`;

export const namespacePvcVolumeInodesQueries = {
  total: `sum by (cluster, namespace) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left()
          max by (cluster, namespace, persistentvolumeclaim) (
            kubelet_volume_stats_inodes{cluster="$cluster", namespace="$namespace"}
          )
        )`,
  used: `sum by (cluster, namespace) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left()
          max by (cluster, namespace, persistentvolumeclaim) (
            kubelet_volume_stats_inodes_used{cluster="$cluster", namespace="$namespace"}
          )
        )`,
  alertsWarning: `sum by (cluster, namespace, alertname, severity) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left(alertname, severity)
          ALERTS{alertname="KubePersistentVolumeInodesFillingUp", alertstate="firing", severity="warning", cluster="$cluster", namespace="$namespace"}
        )`,
  alertsCritical: `sum by (cluster, namespace, alertname, severity) (
          group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
            kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
          )
          * on (cluster, namespace, persistentvolumeclaim) group_left(alertname, severity)
          ALERTS{alertname="KubePersistentVolumeInodesFillingUp", alertstate="firing", severity="critical", cluster="$cluster", namespace="$namespace"}
        )`,
};

export const namespacePvcVolumeInodesByWorkloadQuery = `sum by (cluster, namespace, workload, workload_type) (
          sum by (cluster, namespace, pod) (
            group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
              kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
            )
            * on (cluster, namespace, persistentvolumeclaim) group_left()
            max by (cluster, namespace, persistentvolumeclaim) (
              kubelet_volume_stats_inodes_used{cluster="$cluster", namespace="$namespace"}
            )
          )
          * on (cluster, namespace, pod) group_left(workload, workload_type)
          namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
        )
        /
        sum by (cluster, namespace, workload, workload_type) (
          sum by (cluster, namespace, pod) (
            group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
              kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
            )
            * on (cluster, namespace, persistentvolumeclaim) group_left()
            max by (cluster, namespace, persistentvolumeclaim) (
              kubelet_volume_stats_inodes{cluster="$cluster", namespace="$namespace"}
            )
          )
          * on (cluster, namespace, pod) group_left(workload, workload_type)
          namespace_workload_pod:kube_pod_owner:relabel{cluster="$cluster", namespace="$namespace"}
        )`;

export const namespacePvcStatusQuery = `count by (cluster, namespace, phase) (
        group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
          kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
        )
        * on (cluster, namespace, persistentvolumeclaim) group_left(phase)
        max by (cluster, namespace, pod, persistentvolumeclaim, phase) (
          kube_persistentvolumeclaim_status_phase{cluster="$cluster", namespace="$namespace"} == 1
        )
      )`;

// "phase=Released" won't join above so is queried separately to still be
// visible - given verbatim, comment included.
export const namespacePvStatusQuery = `count by (cluster, namespace, phase) (
        group by (cluster, namespace, pod, persistentvolumeclaim, volume) (
          kube_pod_spec_volumes_persistentvolumeclaims_info{cluster="$cluster", namespace="$namespace", volume!=""}
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

export const namespaceThroughputQueries = {
  rx: `sum by (namespace) (rate(container_fs_reads_bytes_total{cluster=~"$cluster", namespace=~"$namespace", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
  tx: `-sum by (namespace) (rate(container_fs_writes_bytes_total{cluster=~"$cluster", namespace=~"$namespace", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
};

export const namespaceIopsQueries = {
  rx: `sum by (namespace) (rate(container_fs_reads_total{cluster="$cluster", namespace="$namespace", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
  tx: `-sum(rate(container_fs_writes_total{cluster="$cluster", namespace="$namespace", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))`,
};

// Same bare-pod/static-pod/replicaset/attributed-workload fallback chain as
// namespaceNetworkQueries.ts's workloadAttributionFragment (this tab has no
// Pod filter either, since the Pod filter was removed from the Storage tab
// entirely).
function workloadAttributionFragment(operator: '=' | '=~'): string {
  return `
          namespace_workload_pod:kube_pod_owner:relabel{cluster${operator}"$cluster", namespace${operator}"$namespace", workload_type=~".+", workload!=""}

          OR

          label_replace(
            label_replace(
              namespace_workload_pod:kube_pod_owner:relabel{cluster${operator}"$cluster", namespace${operator}"$namespace", workload_type=~".+", workload=""}
            , "workload", "$1", "pod", "(.+)-(.+)")
          , "workload_type", "replicaset", "", "")

          OR

          label_replace(
            label_replace(
              kube_pod_owner{cluster${operator}"$cluster", namespace${operator}"$namespace", owner_kind=""}
            , "workload", "$1", "pod", "(.+)")
          , "workload_type", "pod", "", "")

          OR

          label_replace(
            label_replace(
              kube_pod_owner{cluster${operator}"$cluster", namespace${operator}"$namespace", owner_kind="Node"}
            , "workload", "$1", "pod", "(.+)")
          , "workload_type", "staticpod", "", "")
      `;
}

export const namespaceThroughputByWorkloadQueries = {
  rx: `sum by (workload, workload_type) (sum by (cluster, namespace, pod, workload, workload_type) (sum by (cluster, namespace, pod) (rate(container_fs_reads_bytes_total{cluster="$cluster", namespace="$namespace", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))
            * on (cluster, namespace, pod) group_left(workload, workload_type)
            group by (cluster, namespace, pod, workload, workload_type)  (
${workloadAttributionFragment('=')}
        )))`,
  tx: `-sum by (workload, workload_type) (sum by (cluster, namespace, pod, workload, workload_type) (sum by (cluster, namespace, pod) (rate(container_fs_writes_bytes_total{cluster="$cluster", namespace="$namespace", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))
            * on (cluster, namespace, pod) group_left(workload, workload_type)
            group by (cluster, namespace, pod, workload, workload_type)  (
${workloadAttributionFragment('=')}
        )))`,
};

export const namespaceIopsByWorkloadQueries = {
  rx: `sum by (cluster, namespace, workload, workload_type) (sum by (cluster, namespace, pod, workload, workload_type) (sum by (cluster, namespace, pod) (rate(container_fs_reads_total{cluster=~"$cluster", namespace=~"$namespace", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))
            * on (cluster, namespace, pod) group_left(workload, workload_type)
            group by (cluster, namespace, pod, workload, workload_type)  (
${workloadAttributionFragment('=~')}
        )))`,
  tx: `-sum by (workload, workload_type) (sum by (cluster, namespace, pod, workload, workload_type) (sum by (cluster, namespace, pod) (rate(container_fs_writes_total{cluster=~"$cluster", namespace=~"$namespace", device=~"${FS_DEVICE_REGEX}"}[$__rate_interval]))
            * on (cluster, namespace, pod) group_left(workload, workload_type)
            group by (cluster, namespace, pod, workload, workload_type)  (
${workloadAttributionFragment('=~')}
        )))`,
};
