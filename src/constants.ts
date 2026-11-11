import pluginJson from './plugin.json';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

export enum ROUTES {
  Clusters = 'clusters',
  ResourceSimulator = 'resource-simulator',
  Namespaces = 'namespaces',
  Workloads = 'workloads',
  Nodes = 'nodes',
  Alerts = 'alerts',
  Jobs = 'jobs',
  Search = 'search',
}

// The org's own "cluster-tests" dashboard (the synthetic health-check
// CronJobs behind the Cluster Drilldown's health banner). Takes
// `var-cluster` and `var-datasource`.
export const CLUSTER_TESTS_DASHBOARD_PATH = '/d/aehmig9tia5fkb/cluster-tests';

// Fall back to our demo stack's datasource UIDs until an admin sets real
// defaults on the plugin's Configuration page.
export const DEFAULT_PROMETHEUS_UID = 'thanos-demo';
export const DEFAULT_ELASTICSEARCH_UID = 'elastic-demo';
export const DEFAULT_INFRA_UID = 'rqlite-demo';
