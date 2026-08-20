import { EmbeddedScene, SceneFlexItem, SceneFlexLayout, SceneQueryRunner, PanelBuilders } from '@grafana/scenes';
import { LegendDisplayMode } from '@grafana/schema';
import {
  workloadNetworkBandwidthByPodQueries,
  workloadNetworkBandwidthQueries,
  workloadNetworkSaturationByPodQueries,
  workloadNetworkSaturationQueries,
} from '../../queries/workloadNetworkQueries';
import { substituteWorkloadTokens } from '../../queries/workloadOverviewQueries';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { THANOS_VARIABLE_NAME } from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';

// Reuses the Workload Drilldown's own Network tab queries verbatim
// (workloadNetworkQueries.ts) - see podCpuScene.tsx's own file-level comment
// for why no hidden Pod variable is needed here.
function buildRxTxPanel(title: string, unit: string, rxExpr: string, txExpr: string, rxLegend: string, txLegend: string) {
  const runner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'rx', expr: rxExpr, legendFormat: rxLegend },
      { refId: 'tx', expr: txExpr, legendFormat: txLegend },
    ],
  });
  return PanelBuilders.timeseries()
    .setTitle(title)
    .setUnit(unit)
    .setData(runner)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'p90', 'max'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();
}

export function getPodNetworkScene(clusterRegex: string, namespaceRegex: string, workloadRegex: string, podRegex: string) {
  const substitute = (expr: string) => substituteWorkloadTokens(expr, clusterRegex, namespaceRegex, workloadRegex, podRegex);

  const bandwidthPanel = buildRxTxPanel(
    'Network Bandwidth',
    'Bps',
    substitute(workloadNetworkBandwidthQueries.rx),
    substitute(workloadNetworkBandwidthQueries.tx),
    'Receive',
    'Transmit'
  );

  const saturationPanel = buildRxTxPanel(
    'Network Saturation',
    'pps',
    substitute(workloadNetworkSaturationQueries.rx),
    substitute(workloadNetworkSaturationQueries.tx),
    'Receive dropped packets',
    'Transmit dropped packets'
  );

  const bandwidthByPodPanel = buildRxTxPanel(
    'Network Bandwidth by pod',
    'Bps',
    substitute(workloadNetworkBandwidthByPodQueries.rx),
    substitute(workloadNetworkBandwidthByPodQueries.tx),
    'Receive ({{workload_type}}/{{pod}})',
    'Transmit ({{workload_type}}/{{pod}})'
  );

  const saturationByPodPanel = buildRxTxPanel(
    'Network Saturation by pod',
    'pps',
    substitute(workloadNetworkSaturationByPodQueries.rx),
    substitute(workloadNetworkSaturationByPodQueries.tx),
    'Receive dropped packets ({{workload_type}}/{{pod}})',
    'Transmit dropped packets ({{workload_type}}/{{pod}})'
  );

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: bandwidthPanel }),
            new SceneFlexItem({ height: 300, body: saturationPanel }),
          ],
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: bandwidthByPodPanel }),
            new SceneFlexItem({ height: 300, body: saturationByPodPanel }),
          ],
        }),
      ],
    }),
  });
}
