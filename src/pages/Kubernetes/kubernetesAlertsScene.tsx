import { EmbeddedScene, PanelBuilders, SceneFlexItem, SceneFlexLayout, SceneQueryRunner } from '@grafana/scenes';
import { LegendDisplayMode } from '@grafana/schema';
import { CLUSTER_VARIABLE_NAME, NAMESPACE_VARIABLE_NAME, THANOS_VARIABLE_NAME } from '../../variables/datasourceVariables';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { attachExploreMenus } from '../../scenes/panelExplore';

// As given, except that it follows the page's own Cluster/Namespace pickers
// instead of a fixed `cluster=~".*"` - same reason as applyHomeFilters
// (kubernetesOverviewQueries.ts): this tab showed every cluster's alerts
// whatever the pickers above it said. Both pickers' "All" value is ".*",
// which also matches an alert with no namespace label at all, so an
// unfiltered page still counts every firing alert.
const firingAlertsByClusterQuery = `count by(cluster) (ALERTS{alertstate="firing", cluster=~"\${${CLUSTER_VARIABLE_NAME}:regex}", namespace=~"\${${NAMESPACE_VARIABLE_NAME}:regex}"})`;

export function getKubernetesAlertsScene() {
  const runner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'firing', expr: firingAlertsByClusterQuery, legendFormat: '{{cluster}}' }],
  });

  const panel = PanelBuilders.timeseries()
    .setTitle('Firing alerts by cluster')
    .setUnit('short')
    .setData(runner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [new SceneFlexItem({ height: 400, body: panel })],
    }),
  });
}
