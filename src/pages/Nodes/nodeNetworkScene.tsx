import { EmbeddedScene, PanelBuilders, SceneFlexItem, SceneFlexLayout, SceneQueryRunner, SceneVariableSet } from '@grafana/scenes';
import { LegendDisplayMode } from '@grafana/schema';
import { VariableHide } from '@grafana/data';
import {
  nodeNetworkBandwidthByPodQueries,
  nodeNetworkBandwidthQueries,
  nodeNetworkSaturationByPodQueries,
  nodeNetworkSaturationQueries,
} from '../../queries/nodeNetworkQueries';
import { substituteClusterNodeAndPodToken } from '../../queries/nodeQueries';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { POD_VARIABLE_NAME, THANOS_VARIABLE_NAME, createNodePodFilterVariable } from '../../variables/datasourceVariables';

// Same rx-positive/tx-negative two-series-per-panel shape as every other
// drilldown's own Network tab.
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

export function getNodeNetworkScene(clusterRegex: string, node: string, nodeRegex: string) {
  // Hidden pod variable - the dashboard's own Network tab has no visible Pod
  // picker (unlike CPU/Memory), but its own "by pod" panels still reference
  // $pod, resolved here to every pod on this node by default (same
  // reasoning as the Workload Drilldown's own Network tab, which has no
  // picker either since $pod already resolves without one).
  const podVariable = createNodePodFilterVariable(clusterRegex, node);
  podVariable.setState({ hide: VariableHide.hideVariable });
  const podToken = `\${${POD_VARIABLE_NAME}:regex}`;
  const substitute = (expr: string) => substituteClusterNodeAndPodToken(expr, clusterRegex, node, nodeRegex, podToken);

  const bandwidthPanel = buildRxTxPanel(
    'Network Bandwidth',
    'Bps',
    substitute(nodeNetworkBandwidthQueries.rx),
    substitute(nodeNetworkBandwidthQueries.tx),
    'Receive',
    'Transmit'
  );

  const saturationPanel = buildRxTxPanel(
    'Network Saturation',
    'pps',
    substitute(nodeNetworkSaturationQueries.rx),
    substitute(nodeNetworkSaturationQueries.tx),
    'Receive dropped packets',
    'Transmit dropped packets'
  );

  const bandwidthByPodPanel = buildRxTxPanel(
    'Network Bandwidth by pod',
    'Bps',
    substitute(nodeNetworkBandwidthByPodQueries.rx),
    substitute(nodeNetworkBandwidthByPodQueries.tx),
    'Receive ({{ pod }})',
    'Transmit ({{ pod }})'
  );

  const saturationByPodPanel = buildRxTxPanel(
    'Network Saturation by pod',
    'pps',
    substitute(nodeNetworkSaturationByPodQueries.rx),
    substitute(nodeNetworkSaturationByPodQueries.tx),
    'Receive dropped packets ({{ pod }})',
    'Transmit dropped packets ({{ pod }})'
  );

  return new EmbeddedScene({
    $variables: new SceneVariableSet({ variables: [podVariable] }),
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 400, body: bandwidthPanel }),
            new SceneFlexItem({ height: 400, body: saturationPanel }),
          ],
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 400, body: bandwidthByPodPanel }),
            new SceneFlexItem({ height: 400, body: saturationByPodPanel }),
          ],
        }),
      ],
    }),
  });
}
