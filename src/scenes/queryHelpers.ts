import { clusterTableQueries, ClusterQueryKey } from '../queries/clusterQueries';

// All queries filter on `cluster=~".+"` (and the OTel fallback branch on
// `k8s_cluster_name=~".+"`). Swapping that fragment lets the "cluster" scene
// variable narrow the table down to the selected cluster(s) without having
// to hand-maintain a second copy of these large PromQL expressions.
export function withClusterFilter(expr: string, clusterRegex: string): string {
  return expr
    .replaceAll('cluster=~".+"', `cluster=~"${clusterRegex}"`)
    .replaceAll('k8s_cluster_name=~".+"', `k8s_cluster_name=~"${clusterRegex}"`);
}

export function buildClusterTableTargets(clusterRegexVar: string) {
  return (Object.keys(clusterTableQueries) as ClusterQueryKey[]).map((key) => ({
    refId: key,
    expr: withClusterFilter(clusterTableQueries[key], clusterRegexVar),
    format: 'table' as const,
    instant: true,
  }));
}
