// PromQL queries for the top-level Workloads table (Workloads page).
//
// Unlike nodeQueries.ts/namespaceQueries.ts, this table's row identity is
// multi-dimensional - (cluster, namespace, workload, workload_type) - since
// workload names routinely repeat across namespaces/clusters (e.g. an "api"
// Deployment in many namespaces), so a single-field join (joinByField) isn't
// safe here the way it was for unique node/namespace names. Grafana's
// "Merge series/tables" transform (id 'merge', see workloadsPage.tsx) matches
// rows by every field name common to ALL queries instead of one, so every
// query below keeps its full `by (cluster, namespace, workload, workload_type, ...)`
// grouping verbatim - no trimming needed, and no risk of the duplicate-column
// issue nodeQueries.ts/namespaceQueries.ts had with joinByField.
export const workloadTableQueries = {
  ready_pods: `max by (cluster, namespace, workload, workload_type, asserts_env, asserts_site) (
    # replicaset
    max by (cluster, namespace, replicaset, asserts_env, asserts_site) (kube_replicaset_status_ready_replicas{cluster=~"$cluster", namespace=~"$namespace", replicaset=~".+"})
    * on (cluster, namespace, replicaset) group_left (workload, workload_type)
    label_replace(label_replace(max by (cluster, namespace, replicaset) (kube_replicaset_owner{cluster=~"$cluster", namespace=~"$namespace", replicaset=~".+", owner_kind=~""}), "workload", "$1", "replicaset", "(.+)"), "workload_type", "replicaset", "", "")

    OR

    # deployment (kube_replicaset)
    max by (cluster, namespace, replicaset, asserts_env, asserts_site) (kube_replicaset_status_ready_replicas{cluster=~"$cluster", namespace=~"$namespace", replicaset=~".+"})
    * on (cluster, namespace, replicaset, asserts_env, asserts_site) group_left (workload, workload_type)
    label_replace(label_replace(max by (cluster, namespace, replicaset, owner_name) (kube_replicaset_owner{cluster=~"$cluster", namespace=~"$namespace", replicaset=~".+", owner_is_controller="true", owner_kind="Deployment", owner_name!=""}), "workload", "$1", "owner_name", "(.+)"), "workload_type", "deployment", "", "")

    OR

    # deployment (kube_deployment)
    label_replace(label_replace(max by (cluster, namespace, deployment, asserts_env, asserts_site) (kube_deployment_status_replicas_available{cluster=~"$cluster", namespace=~"$namespace", deployment=~".+"}), "workload", "$1", "deployment", "(.+)"), "workload_type", "deployment", "", "")

    OR

    # daemonset
    label_replace(label_replace(max by (cluster, namespace, daemonset, asserts_env, asserts_site) (kube_daemonset_status_number_ready{cluster=~"$cluster", namespace=~"$namespace", daemonset=~".+"}), "workload", "$1", "daemonset", "(.+)"), "workload_type", "daemonset", "", "")

    OR

    # job
    label_replace(label_replace(max by (cluster, namespace, job_name, asserts_env, asserts_site) (kube_job_status_succeeded{cluster=~"$cluster", namespace=~"$namespace", job_name=~".+"}), "workload", "$1", "job_name", "(.+)"), "workload_type", "job", "", "")

    OR

    # statefulset
    label_replace(label_replace(max by (cluster, namespace, statefulset, asserts_env, asserts_site) (kube_statefulset_status_replicas_ready{cluster=~"$cluster", namespace=~"$namespace", statefulset=~".+"}), "workload", "$1", "statefulset", "(.+)"), "workload_type", "statefulset", "", "")

    OR

    # bare pods
    label_replace(label_replace(max by (cluster, namespace, pod, asserts_env, asserts_site) (last_over_time((kube_pod_owner{cluster=~"$cluster", namespace=~"$namespace", pod=~".+", owner_kind=~""})[$__range:])), "workload", "$1", "pod", "(.+)"), "workload_type", "pod", "", "")

    OR

    # static pods
    label_replace(label_replace(max by (cluster, namespace, pod, asserts_env, asserts_site) (last_over_time((kube_pod_owner{cluster=~"$cluster", namespace=~"$namespace", pod=~".+", owner_kind=~"Node"})[$__range:])), "workload", "$1", "pod", "(.+)"), "workload_type", "staticpod", "", "")
  )`,
  desired_pods: `max by (cluster, namespace, workload, workload_type, asserts_env, asserts_site) (
    # bare pods
    label_replace(
        label_replace(
            max by (cluster, namespace, pod, asserts_env, asserts_site) (last_over_time((kube_pod_owner{cluster=~"$cluster", namespace=~"$namespace", pod=~".+", owner_kind=""})[$__range:]))
            , "workload", "$1", "pod", "(.+)"
        )
        , "workload_type", "pod", "", ""
    )

    OR

    # static pods
    label_replace(
        label_replace(
            max by (cluster, namespace, pod, asserts_env, asserts_site) (last_over_time((kube_pod_owner{cluster=~"$cluster", namespace=~"$namespace", pod=~".+", owner_kind="Node"})[$__range:]))
            , "workload", "$1", "pod", "(.+)"
        )
        , "workload_type", "staticpod", "", ""
    )

    OR

    # replicaset
    max by (cluster, namespace, replicaset, asserts_env, asserts_site) (last_over_time((kube_replicaset_spec_replicas{cluster=~"$cluster", namespace=~"$namespace", replicaset=~".+"})[$__range:]))
    * on (cluster, namespace, replicaset) group_left (workload, workload_type)
    label_replace(
        label_replace(
            max by (cluster, namespace, replicaset) (last_over_time((kube_replicaset_owner{cluster=~"$cluster", namespace=~"$namespace", replicaset=~".+", owner_kind=""})[$__range:]))
            , "workload", "$1", "replicaset", "(.+)"
        )
        , "workload_type", "replicaset", "", ""
    )

    OR

    # deployment (kube_replicaset)
    max by (cluster, namespace, replicaset, asserts_env, asserts_site) (last_over_time((kube_replicaset_spec_replicas{cluster=~"$cluster", namespace=~"$namespace", replicaset=~".+"})[$__range:]))
    * on (cluster, namespace, replicaset) group_left (workload, workload_type)
    label_replace(
        label_replace(
            max by (cluster, namespace, replicaset, owner_name) (last_over_time((kube_replicaset_owner{cluster=~"$cluster", namespace=~"$namespace", replicaset=~".+", owner_is_controller="true", owner_kind="Deployment", owner_name!=""})[$__range:]))
            , "workload", "$1", "owner_name", "(.+)"
        )
        , "workload_type", "deployment", "", ""
    )

    OR

    # deployment (kube_deployment)
    label_replace(
      label_replace(
          max by (cluster, namespace, deployment, asserts_env, asserts_site) (last_over_time((kube_deployment_spec_replicas{cluster=~"$cluster", namespace=~"$namespace", deployment=~".+"})[$__range:]))
          , "workload", "$1", "deployment", "(.+)"
      )
      , "workload_type", "deployment", "", ""
    )

    OR

    # daemonset
    label_replace(
        label_replace(
            max by (cluster, namespace, daemonset, asserts_env, asserts_site) (last_over_time((kube_daemonset_status_desired_number_scheduled{cluster=~"$cluster", namespace=~"$namespace", daemonset=~".+"})[$__range:]))
            , "workload", "$1", "daemonset", "(.+)"
        )
    , "workload_type", "daemonset", "", ""
    )

    OR

    # job
    label_replace(
        label_replace(
            max by (cluster, namespace, job_name, asserts_env, asserts_site) (last_over_time((kube_job_spec_completions{cluster=~"$cluster", namespace=~"$namespace", job_name=~".+"})[$__range:]))
            , "workload", "$1", "job_name", "(.+)"
        )
    , "workload_type", "job", "", ""
    )

    OR

    # statefulset
    label_replace(
        label_replace(
            max by (cluster, namespace, statefulset, asserts_env, asserts_site) (last_over_time((kube_statefulset_replicas{cluster=~"$cluster", namespace=~"$namespace", statefulset=~".+"})[$__range:]))
            , "workload", "$1", "statefulset", "(.+)"
        )
    , "workload_type", "statefulset", "", ""
    )
  )`,
  cpu_usage: `sum(
      node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster=~"$cluster", namespace=~"$namespace"}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace"}
  ) by (cluster, namespace, workload, workload_type)`,
  cpu_requests: `sum(
      kube_pod_container_resource_requests{job="kube-state-metrics", cluster=~"$cluster", namespace=~"$namespace", resource="cpu"}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace"}
  ) by (cluster, namespace, workload, workload_type)`,
  cpu_requests_percent: `sum(
      node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{cluster=~"$cluster", namespace=~"$namespace"}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace"}
  ) by (cluster, namespace, workload, workload_type)
  /sum(
      kube_pod_container_resource_requests{job="kube-state-metrics", cluster=~"$cluster", namespace=~"$namespace", resource="cpu"}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace"}
  ) by (cluster, namespace, workload, workload_type)`,
  mem_usage: `sum(
      container_memory_working_set_bytes{cluster=~"$cluster", namespace=~"$namespace", container!="", image!=""}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace"}
  ) by (cluster, namespace, workload, workload_type)`,
  mem_requests: `sum(
      kube_pod_container_resource_requests{job="kube-state-metrics", cluster=~"$cluster", namespace=~"$namespace", resource="memory"}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace"}
  ) by (cluster, namespace, workload, workload_type)`,
  mem_requests_percent: `sum(
      container_memory_working_set_bytes{cluster=~"$cluster", namespace=~"$namespace", container!="", image!=""}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace"}
  ) by (cluster, namespace, workload, workload_type)
  /sum(
      kube_pod_container_resource_requests{job="kube-state-metrics", cluster=~"$cluster", namespace=~"$namespace", resource="memory"}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace"}
  ) by (cluster, namespace, workload, workload_type)`,
  mem_limits: `sum(
      kube_pod_container_resource_limits{job="kube-state-metrics", cluster=~"$cluster", namespace=~"$namespace", resource="memory"}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace"}
  ) by (cluster, namespace, workload, workload_type)`,
  mem_limits_percent: `sum(
      container_memory_working_set_bytes{cluster=~"$cluster", namespace=~"$namespace", container!="", image!=""}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace"}
  ) by (cluster, namespace, workload, workload_type)
  /sum(
      kube_pod_container_resource_limits{job="kube-state-metrics", cluster=~"$cluster", namespace=~"$namespace", resource="memory"}
    * on(namespace, pod)
      group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~"$cluster", namespace=~"$namespace"}
  ) by (cluster, namespace, workload, workload_type)`,
};

export type WorkloadQueryKey = keyof typeof workloadTableQueries;

export function substituteClusterAndNamespace(expr: string, clusterRegex: string, namespaceRegex: string): string {
  return expr.replaceAll('$cluster', clusterRegex).replaceAll('$namespace', namespaceRegex);
}

export function buildWorkloadsListTargets(clusterRegex: string, namespaceRegex: string) {
  return (Object.keys(workloadTableQueries) as WorkloadQueryKey[]).map((key) => ({
    refId: key,
    expr: substituteClusterAndNamespace(workloadTableQueries[key], clusterRegex, namespaceRegex),
    format: 'table' as const,
    instant: true,
  }));
}
