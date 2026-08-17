// PromQL queries for the "All Jobs" page's Cronjobs and Jobs tabs
// (src/pages/Jobs/jobsPage.tsx), pasted verbatim from the given reference
// queries - same literal-translation convention as namespaceCpuQueries.ts
// etc. Unlike those, the given queries don't reference Grafana template
// variables at all - every cluster/namespace label matcher is hardcoded to
// `=~".+"` (match everything). Since this page needs real Cluster/Namespace
// filters, substituteJobsClusterNamespace() below does a literal-substring
// replacement of exactly `cluster=~".+"` / `namespace=~".+"` (and only those
// two exact substrings - e.g. `owner_name=~".+"` is left untouched) with the
// page's own cluster/namespace variable regex tokens. Some branches (e.g.
// the `kube_pod_owner{namespace=~".+", owner_name=~".+"}` selectors inside
// the Jobs "end_time" query) have no `cluster=~".+"` matcher at all - kept
// as given, not "fixed" to add one.

export const cronjobTableQueries = {
  exists: `max by (cluster, namespace, cronjob, join_name, schedule) (label_join(label_join(kube_cronjob_info{cluster=~".+", namespace=~".+"}, "workload", "", "cronjob"), "join_name", "-", "cluster", "namespace", "workload"))`,
  last_success: `max by (cluster, namespace, cronjob, join_name) (label_join(label_join(kube_cronjob_status_last_successful_time{cronjob!="", cluster=~".+", namespace=~".+"}, "workload", "", "cronjob"), "join_name", "-", "cluster", "namespace", "workload"))* 1000`,
  last_schedule: `max by (cluster, namespace, cronjob, join_name) (label_join(label_join(kube_cronjob_status_last_schedule_time{cluster=~".+", namespace=~".+"}, "workload", "", "cronjob"), "join_name", "-", "cluster", "namespace", "workload"))* 1000`,
  next_schedule: `max by (cluster, namespace, cronjob, join_name) (label_join(label_join(kube_cronjob_next_schedule_time{cluster=~".+", namespace=~".+"}, "workload", "", "cronjob"), "join_name", "-", "cluster", "namespace", "workload"))* 1000`,
  status: `max by (cluster, namespace, cronjob, join_name) (label_join(label_join(kube_cronjob_spec_suspend{cluster=~".+", namespace=~".+"}, "workload", "", "cronjob"), "join_name", "-", "cluster", "namespace", "workload"))`,
};

export type CronjobTableQueryKey = keyof typeof cronjobTableQueries;

export const jobTableQueries = {
  start: `max by (cluster, namespace, job_name, join_name) (last_over_time((label_join(kube_job_status_start_time{cluster=~".+", namespace=~".+"}, "join_name", "-", "cluster", "namespace", "job_name") > (time() - $__range))[$__range:]) * 1000)`,
  end_time: `last_over_time(((
      (
        max by (cluster, namespace, job_name, join_name) (label_join(kube_job_owner{cluster=~".+", namespace=~".+"}, "join_name", "-", "cluster", "namespace", "job_name"))
        * on (job_name, namespace, cluster) group_left() (
          max by (cluster, namespace, job_name) (kube_job_status_completion_time{job_name!="", cluster=~".+", namespace=~".+"})
        ) > (time() - $__range)
      )
      or
      (
        max by (cluster, namespace, job_name, join_name) (label_join(label_join(topk by (cluster, namespace, pod, owner_name) (1, kube_pod_owner{namespace=~".+", owner_name=~".+"}) * on (cluster, namespace, pod) group_left() (
                  max by (cluster, namespace, pod) (timestamp(kube_pod_status_phase{cluster=~".+", namespace=~".+", phase=~"Failed"} == 1))
                ), "job_name", "", "owner_name"), "join_name", "-", "cluster", "namespace", "job_name")) > (time() - $__range)
      )
      or
      (
        max by (cluster, namespace, job_name, join_name) (label_join(label_join(topk by (cluster, namespace, pod, owner_name) (1, kube_pod_owner{namespace=~".+", owner_name=~".+"}) * on (cluster, namespace, pod) group_left() (
                  max by (cluster, namespace, pod) (kube_pod_container_status_last_terminated_timestamp{cluster=~".+", namespace=~".+"})
                ), "job_name", "", "owner_name"), "join_name", "-", "cluster", "namespace", "job_name")) > (time() - $__range)
      )
    ))[$__range:]) * 1000`,
  success: `last_over_time(((
        max by (cluster, namespace, owner_name, job_name, owner_kind, join_name) (label_join(kube_job_owner{cluster=~".+", namespace=~".+"}, "join_name", "-", "cluster", "namespace", "job_name"))
        * on (job_name, namespace, cluster) group_left() (
          max by (cluster, namespace, job_name) (kube_job_status_succeeded{job_name!="", cluster=~".+"})
        )
      ))[$__range:])`,
  completion: `last_over_time((
      max by (cluster, namespace, job_name, join_name) (label_join(kube_job_spec_completions{cluster=~".+", namespace=~".+"}, "join_name", "-", "cluster", "namespace", "job_name"))
    )[$__range:])`,
  // Not part of the originally given query set - added so the PODS/COMPLETION
  // column can color itself by job status (complete/running/failed, matching
  // Grafana Play's own convention) instead of a plain ready-vs-desired scale.
  // Same shape as `success` above, just reading kube_job_status_failed.
  failed: `last_over_time(((
        max by (cluster, namespace, owner_name, job_name, owner_kind, join_name) (label_join(kube_job_owner{cluster=~".+", namespace=~".+"}, "join_name", "-", "cluster", "namespace", "job_name"))
        * on (job_name, namespace, cluster) group_left() (
          max by (cluster, namespace, job_name) (kube_job_status_failed{job_name!="", cluster=~".+"})
        )
      ))[$__range:])`,
};

export type JobTableQueryKey = keyof typeof jobTableQueries;

export function substituteJobsClusterNamespace(expr: string, clusterRegex: string, namespaceRegex: string): string {
  return expr.replaceAll('cluster=~".+"', `cluster=~"${clusterRegex}"`).replaceAll('namespace=~".+"', `namespace=~"${namespaceRegex}"`);
}
