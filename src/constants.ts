import pluginJson from './plugin.json';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

export enum ROUTES {
  Clusters = 'clusters',
  ResourceSimulator = 'resource-simulator',
  Namespaces = 'namespaces',
  Workloads = 'workloads',
  Nodes = 'nodes',
  Alerts = 'alerts',
}

// Fall back to our demo stack's datasource UIDs until an admin sets real
// defaults on the plugin's Configuration page.
export const DEFAULT_PROMETHEUS_UID = 'thanos-demo';
export const DEFAULT_ELASTICSEARCH_UID = 'elastic-demo';
export const DEFAULT_INFRA_UID = 'rqlite-demo';
