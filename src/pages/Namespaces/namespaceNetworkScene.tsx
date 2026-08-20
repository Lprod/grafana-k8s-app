import { EmbeddedScene, PanelBuilders, SceneFlexItem, SceneFlexLayout, SceneQueryRunner } from '@grafana/scenes';
import { LegendDisplayMode } from '@grafana/schema';
import { substituteClusterAndNamespace } from '../../queries/namespaceQueries';
import {
  namespaceNetworkBandwidthByWorkloadQueries,
  namespaceNetworkBandwidthQueries,
  namespaceNetworkSaturationByWorkloadQueries,
  namespaceNetworkSaturationQueries,
} from '../../queries/namespaceNetworkQueries';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { THANOS_VARIABLE_NAME } from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';

// Same rx-positive/tx-negative ("- sum(...)" baked into the tx query text
// itself) two-series-per-panel shape as getClusterNetworkScene's own
// Network Bandwidth/Saturation panels in clustersApp.tsx - no stacking mode
// there either (plain multi-series lines), so none here.
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

export function getNamespaceNetworkScene(clusterRegex: string, namespaceRegex: string) {
  const substitute = (expr: string) => substituteClusterAndNamespace(expr, clusterRegex, namespaceRegex);

  const bandwidthPanel = buildRxTxPanel(
    'Network Bandwidth',
    'Bps',
    substitute(namespaceNetworkBandwidthQueries.rx),
    substitute(namespaceNetworkBandwidthQueries.tx),
    'Receive',
    'Transmit'
  );

  const saturationPanel = buildRxTxPanel(
    'Network Saturation',
    'pps',
    substitute(namespaceNetworkSaturationQueries.rx),
    substitute(namespaceNetworkSaturationQueries.tx),
    'Receive dropped packets',
    'Transmit dropped packets'
  );

  const bandwidthByWorkloadPanel = buildRxTxPanel(
    'Network Bandwidth by workload',
    'Bps',
    substitute(namespaceNetworkBandwidthByWorkloadQueries.rx),
    substitute(namespaceNetworkBandwidthByWorkloadQueries.tx),
    'Receive ({{workload_type}}/{{workload}})',
    'Transmit ({{workload_type}}/{{workload}})'
  );

  const saturationByWorkloadPanel = buildRxTxPanel(
    'Network Saturation by workload',
    'pps',
    substitute(namespaceNetworkSaturationByWorkloadQueries.rx),
    substitute(namespaceNetworkSaturationByWorkloadQueries.tx),
    'Receive dropped pakets ({{workload_type}}/{{workload}})',
    'Transmit dropped pakets ({{workload_type}}/{{workload}})'
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
            new SceneFlexItem({ height: 300, body: bandwidthByWorkloadPanel }),
            new SceneFlexItem({ height: 300, body: saturationByWorkloadPanel }),
          ],
        }),
      ],
    }),
  });
}
