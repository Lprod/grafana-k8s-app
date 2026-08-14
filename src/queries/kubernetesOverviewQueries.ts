// PromQL queries for the Kubernetes home page's Overview tab
// (src/pages/Kubernetes/kubernetesOverviewScene.tsx), pasted verbatim from
// Grafana's own Kubernetes Monitoring app (play.grafana.org). Several of the
// 12 issue queries below hardcode `cluster=~".+"`/`namespace=~".+"` instead
// of using `$cluster`/`$namespace` like the top stat queries do - kept as
// given rather than "fixed" to use this page's filter variables, following
// this repo's established literal-translation convention (see summary.md).

export const kubernetesTopStatQueries = {
  clusters: `count(group by (cluster) (kube_pod_info{cluster=~".*", namespace=~".+"}))`,
  nodes: `count(group by (cluster, node) (kube_pod_info{cluster=~"$cluster", namespace=~".+", node!=""}))`,
  namespaces: `count(group by (cluster, namespace) (kube_namespace_status_phase{cluster=~"$cluster", namespace=~".+"}))`,
  workloads: `count(
    max by (cluster, namespace, workload, workload_type, asserts_env, asserts_site) (
      # bare pods
      label_replace(
          label_replace(
              max by (cluster, namespace, pod, asserts_env, asserts_site) (last_over_time((kube_pod_owner{cluster=~"$cluster", namespace=~".+", pod=~".+", owner_kind=""})[$__range:]))
              , "workload", "$1", "pod", "(.+)"
          )
          , "workload_type", "pod", "", ""
      )

      OR

      # static pods
      label_replace(
          label_replace(
              max by (cluster, namespace, pod, asserts_env, asserts_site) (last_over_time((kube_pod_owner{cluster=~"$cluster", namespace=~".+", pod=~".+", owner_kind="Node"})[$__range:]))
              , "workload", "$1", "pod", "(.+)"
          )
          , "workload_type", "staticpod", "", ""
      )

      OR

      # replicaset
      max by (cluster, namespace, replicaset, asserts_env, asserts_site) (last_over_time((kube_replicaset_spec_replicas{cluster=~"$cluster", namespace=~".+", replicaset=~".+"})[$__range:]))
      * on (cluster, namespace, replicaset) group_left (workload, workload_type)
      label_replace(
          label_replace(
              max by (cluster, namespace, replicaset) (last_over_time((kube_replicaset_owner{cluster=~"$cluster", namespace=~".+", replicaset=~".+", owner_kind=""})[$__range:]))
              , "workload", "$1", "replicaset", "(.+)"
          )
          , "workload_type", "replicaset", "", ""
      )

      OR

      # deployment (kube_replicaset )
      max by (cluster, namespace, replicaset, asserts_env, asserts_site) (last_over_time((kube_replicaset_spec_replicas{cluster=~"$cluster", namespace=~".+", replicaset=~".+"})[$__range:]))
      * on (cluster, namespace, replicaset) group_left (workload, workload_type)
      label_replace(
          label_replace(
              max by (cluster, namespace, replicaset, owner_name) (last_over_time((kube_replicaset_owner{cluster=~"$cluster", namespace=~".+", replicaset=~".+", owner_is_controller="true", owner_kind="Deployment", owner_name!=""})[$__range:]))
              , "workload", "$1", "owner_name", "(.+)"
          )
          , "workload_type", "deployment", "", ""
      )

      OR

      # deployment (kube_deployment)
      label_replace(
        label_replace(
            max by (cluster, namespace, deployment, asserts_env, asserts_site) (last_over_time((kube_deployment_spec_replicas{cluster=~"$cluster", namespace=~".+", deployment=~".+"})[$__range:]))
            , "workload", "$1", "deployment", "(.+)"
        )
        , "workload_type", "deployment", "", ""
      )

      OR

      # daemonset
      label_replace(
          label_replace(
              max by (cluster, namespace, daemonset, asserts_env, asserts_site) (last_over_time((kube_daemonset_status_desired_number_scheduled{cluster=~"$cluster", namespace=~".+", daemonset=~".+"})[$__range:]))
              , "workload", "$1", "daemonset", "(.+)"
          )
      , "workload_type", "daemonset", "", ""
      )

      OR

      # job
      label_replace(
          label_replace(
              max by (cluster, namespace, job_name, asserts_env, asserts_site) (last_over_time((kube_job_spec_completions{cluster=~"$cluster", namespace=~".+", job_name=~".+"})[$__range:]))
              , "workload", "$1", "job_name", "(.+)"
          )
      , "workload_type", "job", "", ""
      )

      OR

      # statefulset
      label_replace(
          label_replace(
              max by (cluster, namespace, statefulset, asserts_env, asserts_site) (last_over_time((kube_statefulset_replicas{cluster=~"$cluster", namespace=~".+", statefulset=~".+"})[$__range:]))
              , "workload", "$1", "statefulset", "(.+)"
          )
      , "workload_type", "statefulset", "", ""
      )
  )
    )`,
  pods: `count(group by (cluster, namespace, pod) (kube_pod_info{cluster=~"$cluster", namespace=~".+", pod!=""}))`,
  containers: `count(group by (cluster, namespace, pod, container) (kube_pod_container_info{cluster=~"$cluster", namespace=~".+", pod!="", container!=""}))`,
};

export type KubernetesTopStatKey = keyof typeof kubernetesTopStatQueries;

export interface IssueQueryDef {
  title: string;
  expr: string;
}

export const kubernetesAvailabilityQueries: Record<string, IssueQueryDef> = {
  zero_replica_deployments: {
    title: 'Zero replica deployments',
    expr: `sort_desc((max by (cluster, namespace, deployment, asserts_env) (kube_deployment_status_replicas_available{cluster=~".+", namespace=~".+"}) == 0) and on (cluster, namespace, deployment, asserts_env)(max by (cluster, namespace, deployment, asserts_env) (kube_deployment_spec_replicas{cluster=~".+", namespace=~".+"}) > 0))`,
  },
  deployment_rollout_issues: {
    title: 'Deployment rollout issues',
    expr: `sort_desc(label_replace(max by (cluster, namespace, deployment, condition, reason, asserts_env) (label_replace(kube_deployment_status_condition{cluster=~".+", namespace=~".+", condition=~"Progressing", status=~"false"} == 1, "condition", "Not Progressing", "condition", ".*") or label_replace(kube_deployment_status_condition{cluster=~".+", namespace=~".+", condition=~"ReplicaFailure", status=~"true"} == 1, "condition", "Replica Failure", "condition", ".*")), "workload", "$1", "deployment", "(.*)") * on (cluster, namespace, workload) group_left (workload_type) max by (cluster, namespace, workload, workload_type) (namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+", workload_type=~"deployment"}))`,
  },
  nodes_not_ready: {
    title: 'Nodes not ready',
    expr: `sort_desc(max by (cluster, node, status) (kube_node_status_condition{cluster=~".+", condition=~"Ready", status=~"false|unknown"} == 1))`,
  },
  pods_not_ready: {
    title: 'Pods not ready',
    expr: `(((max by (cluster, namespace, pod, asserts_env) (kube_pod_status_condition{cluster=~".+", namespace=~".+", condition=~"Ready", status=~"false"} == 1)) and on (cluster, namespace, pod, asserts_env)(max by (cluster, namespace, pod, asserts_env) (kube_pod_status_phase{cluster=~".+", namespace=~".+", phase=~"Running"}))) * on (cluster, namespace, pod) group_left (workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}) or (((max by (cluster, namespace, pod, asserts_env) (kube_pod_status_condition{cluster=~".+", namespace=~".+", condition=~"Ready", status=~"false"} == 1)) and on (cluster, namespace, pod, asserts_env)(max by (cluster, namespace, pod, asserts_env) (kube_pod_status_phase{cluster=~".+", namespace=~".+", phase=~"Running"}))) unless on (cluster, namespace, pod)(namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}))`,
  },
};

export const kubernetesStabilityQueries: Record<string, IssueQueryDef> = {
  restarting_containers: {
    title: 'Restarting containers',
    expr: `sort_desc(((round(max by (cluster, namespace, pod, container, asserts_env) (increase(kube_pod_container_status_restarts_total{cluster=~".+", namespace=~".+"}[1h]))) > 2) * on (cluster, namespace, pod) group_left (workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}) or ((round(max by (cluster, namespace, pod, container, asserts_env) (increase(kube_pod_container_status_restarts_total{cluster=~".+", namespace=~".+"}[1h]))) > 2) unless on (cluster, namespace, pod)(namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"})))`,
  },
  oomkilled_containers: {
    title: 'OOMKilled containers',
    expr: `((max by (cluster, namespace, pod, container, asserts_env) (kube_pod_container_status_last_terminated_reason{cluster=~".+", namespace=~".+", reason=~"OOMKilled"}) == 1) * on (cluster, namespace, pod) group_left (workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}) or ((max by (cluster, namespace, pod, container, asserts_env) (kube_pod_container_status_last_terminated_reason{cluster=~".+", namespace=~".+", reason=~"OOMKilled"}) == 1) unless on (cluster, namespace, pod)(namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}))`,
  },
  pending_pods: {
    title: 'Pending pods',
    expr: `((max by (cluster, namespace, pod, asserts_env) (kube_pod_status_phase{cluster=~".+", namespace=~".+", phase=~"Pending"}) == 1) * on (cluster, namespace, pod) group_left (workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}) or ((max by (cluster, namespace, pod, asserts_env) (kube_pod_status_phase{cluster=~".+", namespace=~".+", phase=~"Pending"}) == 1) unless on (cluster, namespace, pod)(namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}))`,
  },
  image_pull_errors: {
    title: 'Image pull errors',
    expr: `((max by (cluster, namespace, pod, container, asserts_env, reason) (kube_pod_container_status_waiting_reason{cluster=~".+", namespace=~".+", reason=~"ImagePullBackOff|ErrImagePull"} == 1)) * on (cluster, namespace, pod) group_left (workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}) or ((max by (cluster, namespace, pod, container, asserts_env, reason) (kube_pod_container_status_waiting_reason{cluster=~".+", namespace=~".+", reason=~"ImagePullBackOff|ErrImagePull"} == 1)) unless on (cluster, namespace, pod)(namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}))`,
  },
};

export const kubernetesInfrastructureQueries: Record<string, IssueQueryDef> = {
  node_pressure: {
    title: 'Node pressure',
    expr: `sort_desc(max by (cluster, node, condition) (kube_node_status_condition{cluster=~".+", condition=~"MemoryPressure|DiskPressure|PIDPressure", status=~"true"} == 1))`,
  },
  evicted_pods: {
    title: 'Evicted pods',
    expr: `((max by (cluster, namespace, pod, asserts_env) (kube_pod_status_reason{cluster=~".+", namespace=~".+", reason=~"Evicted"}) == 1) * on (cluster, namespace, pod) group_left (workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}) or ((max by (cluster, namespace, pod, asserts_env) (kube_pod_status_reason{cluster=~".+", namespace=~".+", reason=~"Evicted"}) == 1) unless on (cluster, namespace, pod)(namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}))`,
  },
  pods_unknown_phase: {
    title: 'Pods unknown phase',
    expr: `((max by (cluster, namespace, pod, asserts_env) (kube_pod_status_phase{cluster=~".+", namespace=~".+", phase=~"Unknown"}) == 1) * on (cluster, namespace, pod) group_left (workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}) or ((max by (cluster, namespace, pod, asserts_env) (kube_pod_status_phase{cluster=~".+", namespace=~".+", phase=~"Unknown"}) == 1) unless on (cluster, namespace, pod)(namespace_workload_pod:kube_pod_owner:relabel{cluster=~".+"}))`,
  },
  unschedulable_nodes: {
    title: 'Unschedulable nodes',
    expr: `sort_desc(max by (cluster, node) (kube_node_spec_unschedulable{cluster=~".+", node=~".+"} == 1))`,
  },
};

export const kubernetesIssueQueries: Record<string, IssueQueryDef> = {
  ...kubernetesAvailabilityQueries,
  ...kubernetesStabilityQueries,
  ...kubernetesInfrastructureQueries,
};

export type KubernetesIssueKey = keyof typeof kubernetesIssueQueries;

export const deployedContainerImagesQuery = `sum by (image_spec) (kube_pod_container_info{cluster=~"$cluster", namespace=~".+"})`;
