import { EmbeddedScene, SceneFlexItem, SceneFlexLayout, SceneQueryRunner, SceneVariableSet, PanelBuilders } from '@grafana/scenes';
import { LegendDisplayMode } from '@grafana/schema';
import { VariableHide } from '@grafana/data';
import {
  workloadNetworkBandwidthByPodQueries,
  workloadNetworkBandwidthQueries,
  workloadNetworkSaturationByPodQueries,
  workloadNetworkSaturationQueries,
} from '../../queries/workloadNetworkQueries';
import { substituteWorkloadTokens } from '../../queries/workloadOverviewQueries';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import { POD_VARIABLE_NAME, THANOS_VARIABLE_NAME, createPodFilterVariable } from '../../variables/datasourceVariables';

// Same rx-positive/tx-negative ("- sum(...)" baked into the tx query text
// itself) two-series-per-panel shape as the Namespace Drilldown's own
// Network tab (namespaceNetworkScene.tsx) and the Cluster Drilldown's - no
// stacking mode there either, so none here.
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

export function getWorkloadNetworkScene(clusterRegex: string, namespaceRegex: string, workloadRegex: string, workload: string) {
  // Hidden pod variable - same reasoning as the Overview/CPU/Memory tabs'
  // own: every $pod-referencing query below needs to resolve to "every pod
  // belonging to this workload", but there's no picker to expose it through
  // since each tab is its own EmbeddedScene.
  const podVariable = createPodFilterVariable(clusterRegex, namespaceRegex, { workload });
  podVariable.setState({ hide: VariableHide.hideVariable });
  const podToken = `\${${POD_VARIABLE_NAME}:regex}`;
  const substitute = (expr: string) => substituteWorkloadTokens(expr, clusterRegex, namespaceRegex, workloadRegex, podToken);

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
    $variables: new SceneVariableSet({ variables: [podVariable] }),
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
