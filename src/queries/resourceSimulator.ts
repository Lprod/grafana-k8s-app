import { EntityScope, scopedMatchers } from './prometheus';

function simulatorMatchers(scope: EntityScope = {}) {
  return scopedMatchers({
    cluster: scope.cluster,
    namespace: scope.namespace ?? '${namespace:regex}',
  });
}

function workloadOwnerSelector(scope: EntityScope = {}) {
  return `
group by (cluster, namespace, pod, workload, workload_type) (
  namespace_workload_pod:kube_pod_owner:relabel{
    ${simulatorMatchers(scope)},
    pod!="",
    workload!="",
    workload_type=~"deployment|statefulset"
  }
)
`;
}

export function simulatorQuotaQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, namespace, resource, type) (
  kube_resourcequota{
    ${simulatorMatchers(scope)},
    resource=~"requests[.]cpu|requests[.]memory|limits[.]cpu|limits[.]memory|requests[.]storage|pods|persistentvolumeclaims|count/.*"
  }
)
`;
}

export function simulatorWorkloadReplicasQuery(scope: EntityScope = {}) {
  const filters = simulatorMatchers(scope);

  return `
max by (cluster, namespace, workload, workload_type) (
  label_replace(
    label_replace(
      kube_deployment_spec_replicas{${filters}, deployment!=""},
      "workload",
      "$1",
      "deployment",
      "(.+)"
    ),
    "workload_type",
    "deployment",
    "deployment",
    ".*"
  )
)
or
max by (cluster, namespace, workload, workload_type) (
  label_replace(
    label_replace(
      kube_statefulset_replicas{${filters}, statefulset!=""},
      "workload",
      "$1",
      "statefulset",
      "(.+)"
    ),
    "workload_type",
    "statefulset",
    "statefulset",
    ".*"
  )
)
`;
}

export function simulatorWorkloadPodsQuery(scope: EntityScope = {}) {
  return `
count by (cluster, namespace, workload, workload_type) (
  ${workloadOwnerSelector(scope)}
)
`;
}

export function simulatorWorkloadContainersQuery(scope: EntityScope = {}) {
  return `
count by (cluster, namespace, workload, workload_type, container) (
  kube_pod_container_info{
    ${simulatorMatchers(scope)},
    pod!="",
    container!="",
    container!="POD"
  }
  * on (cluster, namespace, pod) group_left(workload, workload_type)
  ${workloadOwnerSelector(scope)}
)
`;
}

export function simulatorWorkloadRequestsQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, namespace, workload, workload_type, container, resource) (
  kube_pod_container_resource_requests{
    ${simulatorMatchers(scope)},
    pod!="",
    container!="",
    container!="POD",
    resource=~"cpu|memory"
  }
  * on (cluster, namespace, pod) group_left(workload, workload_type)
  ${workloadOwnerSelector(scope)}
)
`;
}

export function simulatorWorkloadLimitsQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, namespace, workload, workload_type, container, resource) (
  kube_pod_container_resource_limits{
    ${simulatorMatchers(scope)},
    pod!="",
    container!="",
    container!="POD",
    resource=~"cpu|memory"
  }
  * on (cluster, namespace, pod) group_left(workload, workload_type)
  ${workloadOwnerSelector(scope)}
)
`;
}

export function simulatorWorkloadCpuUsageQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, namespace, workload, workload_type, container) (
  rate(container_cpu_usage_seconds_total{
    ${simulatorMatchers(scope)},
    pod!="",
    container!="",
    container!="POD"
  }[5m])
  * on (cluster, namespace, pod) group_left(workload, workload_type)
  ${workloadOwnerSelector(scope)}
)
`;
}

export function simulatorWorkloadMemoryUsageQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, namespace, workload, workload_type, container) (
  container_memory_working_set_bytes{
    ${simulatorMatchers(scope)},
    pod!="",
    container!="",
    container!="POD"
  }
  * on (cluster, namespace, pod) group_left(workload, workload_type)
  ${workloadOwnerSelector(scope)}
)
`;
}

function workloadPvcSelector(scope: EntityScope = {}) {
  return `
group by (cluster, namespace, workload, workload_type, persistentvolumeclaim) (
  kube_pod_spec_volumes_persistentvolumeclaims_info{
    ${simulatorMatchers(scope)},
    pod!="",
    persistentvolumeclaim=~".+"
  }
  * on (cluster, namespace, pod) group_left(workload, workload_type)
  ${workloadOwnerSelector(scope)}
)
`;
}

export function simulatorWorkloadPvcUsedQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, namespace, workload, workload_type) (
  max by (cluster, namespace, persistentvolumeclaim) (
    kubelet_volume_stats_used_bytes{
      ${simulatorMatchers(scope)},
      persistentvolumeclaim=~".+"
    }
  )
  * on (cluster, namespace, persistentvolumeclaim) group_right()
  ${workloadPvcSelector(scope)}
)
`;
}

function kafkaPoolPodSelector(scope: EntityScope = {}) {
  const filters = simulatorMatchers(scope);

  return `
group by (cluster, namespace, pod, kafka, pool, role) (
  label_replace(
    label_replace(
      label_replace(
        group by (cluster, namespace, pod, label_strimzi_io_cluster, label_strimzi_io_pool_name) (
          kube_pod_labels{
            ${filters},
            pod!="",
            label_strimzi_io_kind="Kafka",
            label_strimzi_io_component_type="kafka",
            label_strimzi_io_broker_role="true",
            label_strimzi_io_cluster!="",
            label_strimzi_io_pool_name!=""
          }
        ),
        "kafka",
        "$1",
        "label_strimzi_io_cluster",
        "(.+)"
      ),
      "pool",
      "$1",
      "label_strimzi_io_pool_name",
      "(.+)"
    ),
    "role",
    "broker",
    "label_strimzi_io_cluster",
    ".*"
  )
)
or
group by (cluster, namespace, pod, kafka, pool, role) (
  label_replace(
    label_replace(
      label_replace(
        group by (cluster, namespace, pod, label_strimzi_io_cluster, label_strimzi_io_pool_name) (
          kube_pod_labels{
            ${filters},
            pod!="",
            label_strimzi_io_kind="Kafka",
            label_strimzi_io_component_type="kafka",
            label_strimzi_io_controller_role="true",
            label_strimzi_io_cluster!="",
            label_strimzi_io_pool_name!=""
          }
        ),
        "kafka",
        "$1",
        "label_strimzi_io_cluster",
        "(.+)"
      ),
      "pool",
      "$1",
      "label_strimzi_io_pool_name",
      "(.+)"
    ),
    "role",
    "controller",
    "label_strimzi_io_cluster",
    ".*"
  )
)
`;
}

export function simulatorKafkaPodsQuery(scope: EntityScope = {}) {
  return `
count by (cluster, namespace, kafka, pool, role) (
  ${kafkaPoolPodSelector(scope)}
)
`;
}

export function simulatorKafkaContainersQuery(scope: EntityScope = {}) {
  return `
count by (cluster, namespace, kafka, pool, role, container) (
  kube_pod_container_info{
    ${simulatorMatchers(scope)},
    pod!="",
    container!="",
    container!="POD"
  }
  * on (cluster, namespace, pod) group_left(kafka, pool, role)
  (${kafkaPoolPodSelector(scope)})
)
`;
}

export function simulatorKafkaRequestsQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, namespace, kafka, pool, role, container, resource) (
  kube_pod_container_resource_requests{
    ${simulatorMatchers(scope)},
    pod!="",
    container!="",
    container!="POD",
    resource=~"cpu|memory"
  }
  * on (cluster, namespace, pod) group_left(kafka, pool, role)
  (${kafkaPoolPodSelector(scope)})
)
`;
}

export function simulatorKafkaLimitsQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, namespace, kafka, pool, role, container, resource) (
  kube_pod_container_resource_limits{
    ${simulatorMatchers(scope)},
    pod!="",
    container!="",
    container!="POD",
    resource=~"cpu|memory"
  }
  * on (cluster, namespace, pod) group_left(kafka, pool, role)
  (${kafkaPoolPodSelector(scope)})
)
`;
}

export function simulatorKafkaCpuUsageQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, namespace, kafka, pool, role, container) (
  rate(container_cpu_usage_seconds_total{
    ${simulatorMatchers(scope)},
    pod!="",
    container!="",
    container!="POD"
  }[5m])
  * on (cluster, namespace, pod) group_left(kafka, pool, role)
  (${kafkaPoolPodSelector(scope)})
)
`;
}

export function simulatorKafkaMemoryUsageQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, namespace, kafka, pool, role, container) (
  container_memory_working_set_bytes{
    ${simulatorMatchers(scope)},
    pod!="",
    container!="",
    container!="POD"
  }
  * on (cluster, namespace, pod) group_left(kafka, pool, role)
  (${kafkaPoolPodSelector(scope)})
)
`;
}

function kafkaPvcSelector(scope: EntityScope = {}) {
  return `
group by (cluster, namespace, kafka, pool, role, persistentvolumeclaim) (
  kube_pod_spec_volumes_persistentvolumeclaims_info{
    ${simulatorMatchers(scope)},
    pod!="",
    persistentvolumeclaim=~".+"
  }
  * on (cluster, namespace, pod) group_left(kafka, pool, role)
  (${kafkaPoolPodSelector(scope)})
)
`;
}

export function simulatorKafkaPvcUsedQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, namespace, kafka, pool, role) (
  max by (cluster, namespace, persistentvolumeclaim) (
    kubelet_volume_stats_used_bytes{
      ${simulatorMatchers(scope)},
      persistentvolumeclaim=~".+"
    }
  )
  * on (cluster, namespace, persistentvolumeclaim) group_left(kafka, pool, role)
  ${kafkaPvcSelector(scope)}
)
`;
}

export function simulatorKafkaPvcCountQuery(scope: EntityScope = {}) {
  return `
count by (cluster, namespace, kafka, pool, role) (
  ${kafkaPvcSelector(scope)}
)
`;
}

export function simulatorKafkaPvcStorageQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, namespace, kafka, pool, role) (
  max by (cluster, namespace, persistentvolumeclaim) (
    kube_persistentvolumeclaim_resource_requests_storage_bytes{
      ${simulatorMatchers(scope)},
      persistentvolumeclaim=~".+"
    }
  )
  * on (cluster, namespace, persistentvolumeclaim) group_left(kafka, pool, role)
  ${kafkaPvcSelector(scope)}
)
`;
}

export function simulatorWorkloadPvcCountQuery(scope: EntityScope = {}) {
  return `
count by (cluster, namespace, workload, workload_type) (
  ${workloadPvcSelector(scope)}
)
`;
}

export function simulatorWorkloadPvcStorageQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, namespace, workload, workload_type) (
  max by (cluster, namespace, persistentvolumeclaim) (
    kube_persistentvolumeclaim_resource_requests_storage_bytes{
      ${simulatorMatchers(scope)},
      persistentvolumeclaim=~".+"
    }
  )
  * on (cluster, namespace, persistentvolumeclaim) group_right()
  ${workloadPvcSelector(scope)}
)
`;
}

export function simulatorClusterAllocatableQuery(scope: EntityScope = {}) {
  return `
sum by (cluster, resource) (
  kube_node_status_allocatable{
    cluster=~"${scope.cluster ?? '${cluster:regex}'}",
    resource=~"cpu|memory|pods"
  }
)
`;
}
