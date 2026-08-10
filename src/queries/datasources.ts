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
