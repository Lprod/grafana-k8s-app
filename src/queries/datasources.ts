import { DataSourceRef } from '@grafana/schema';

export const prometheusDatasource = (): DataSourceRef => ({
  type: 'prometheus',
  uid: '${datasource}',
});

export const elasticsearchDatasource = (): DataSourceRef => ({
  type: 'elasticsearch',
  uid: '${elasticsearch}',
});

export const infraDatasource = (): DataSourceRef => ({
  type: 'g42-rqlite-datasource',
  uid: '${infraDatasource}',
});

// Grafana's built-in "Mixed" pseudo-datasource - lets one SceneQueryRunner
// combine queries against several real datasources (e.g. Thanos + RQLite) in
// a single $data/query set, each target carrying its own `datasource`
// override. `'-- Mixed --'` is the literal uid Grafana's own dataSourceSrv
// resolves internally (confirmed against @grafana/runtime's source - not
// exported as a named constant from either @grafana/data or @grafana/runtime).
export const mixedDatasource = (): DataSourceRef => ({
  uid: '-- Mixed --',
});
