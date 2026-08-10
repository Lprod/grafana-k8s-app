import { DEFAULT_ELASTICSEARCH_UID, DEFAULT_INFRA_UID, DEFAULT_PROMETHEUS_UID } from '../constants';

export type AppJsonData = {
  prometheusUid?: string;
  elasticsearchUid?: string;
  infraUid?: string;
};

export type ResolvedDatasourceDefaults = {
  prometheusUid: string;
  elasticsearchUid: string;
  infraUid: string;
};

let currentJsonData: AppJsonData = {};

export function setAppJsonData(jsonData: AppJsonData | undefined) {
  currentJsonData = jsonData ?? {};
}

export function getDatasourceDefaults(): ResolvedDatasourceDefaults {
  return {
    prometheusUid: currentJsonData.prometheusUid || DEFAULT_PROMETHEUS_UID,
    elasticsearchUid: currentJsonData.elasticsearchUid || DEFAULT_ELASTICSEARCH_UID,
    infraUid: currentJsonData.infraUid || DEFAULT_INFRA_UID,
  };
}
