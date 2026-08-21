// Shared PromQL label-matcher helpers.
//
// This file used to also hold ~17 exported query builders (countClusters,
// firingAlerts, clusterInventory, clusterCpuUsage, podPhases, ...) from an
// early iteration of the app. Every page has since moved to its own
// `src/queries/<page>Queries.ts` file holding the exact PromQL the reference
// dashboards use, and none of those builders had a single remaining consumer
// - they were removed rather than left as a second, silently-diverging source
// of truth for the same metrics. `scopedMatchers` is the one piece still in
// use (by `resourceSimulator.ts`).
export type EntityScope = {
  cluster?: string;
  namespace?: string;
  workload?: string;
  workloadType?: string;
  pod?: string;
  node?: string;
};

function matcher(label: string, value?: string, operator = '=~') {
  if (!value) {
    return '';
  }

  return `${label}${operator}"${value}"`;
}

function joinMatchers(...parts: Array<string | undefined>) {
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
