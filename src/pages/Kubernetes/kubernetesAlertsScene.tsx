import { EmbeddedScene, PanelBuilders, SceneFlexItem, SceneFlexLayout, SceneQueryRunner } from '@grafana/scenes';
import { LegendDisplayMode } from '@grafana/schema';
import { THANOS_VARIABLE_NAME } from '../../variables/datasourceVariables';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';

// Given verbatim - see kubernetesOverviewQueries.ts's header comment for
// this repo's literal-translation convention for queries pasted from
// Grafana's own Kubernetes Monitoring app.
const firingAlertsByClusterQuery = `count by(cluster) (ALERTS{alertstate="firing", cluster=~".*"})`;

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
    body: new SceneFlexLayout({
      direction: 'column',
      children: [new SceneFlexItem({ height: 400, body: panel })],
    }),
  });
}
