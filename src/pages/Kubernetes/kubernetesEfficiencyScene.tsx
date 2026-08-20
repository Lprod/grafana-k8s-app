import {
  EmbeddedScene,
  PanelBuilders,
  SceneDataTransformer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneQueryRunner,
  SceneReactObject,
} from '@grafana/scenes';
import { BigValueColorMode, BigValueGraphMode, ThresholdsMode, VizOrientation } from '@grafana/schema';
import React from 'react';
import { THANOS_VARIABLE_NAME } from '../../variables/datasourceVariables';
import { SectionHeading } from '../../scenes/clustersApp';
import {
  kubernetesEfficiencyTableQueries,
  kubernetesEfficiencyTopStatQueries,
  KubernetesEfficiencyTopStatKey,
  kubernetesEfficiencyWasteByNamespaceQueries,
} from '../../queries/kubernetesEfficiencyQueries';
import { attachExploreMenus } from '../../scenes/panelExplore';

// Same green/orange-background convention as Grafana's own reference for
// this tab (distinct from the Overview tab's red/green - that one still
// shows a value + sparkline, these are flat/no-sparkline like the Overview
// top 6 tiles).
const efficiencyStatThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'green', value: -Infinity },
    { color: 'orange', value: 1 },
  ],
};

function buildEfficiencyStatPanel(title: string, expr: string) {
  const runner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'value', expr, instant: true }],
  });
  return PanelBuilders.stat()
    .setTitle(title)
    .setUnit('short')
    .setThresholds(efficiencyStatThresholds)
    .setOption('colorMode', BigValueColorMode.Background)
    .setOption('graphMode', BigValueGraphMode.None)
    .setData(runner)
    .build();
}

function buildWasteByNamespacePanel(title: string, expr: string) {
  const runner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'waste', expr, legendFormat: '{{cluster}} / {{namespace}}' }],
  });
  return PanelBuilders.bargauge()
    .setTitle(title)
    .setUnit('short')
    .setOption('orientation', VizOrientation.Horizontal)
    .setData(runner)
    .build();
}

function buildEfficiencyTable(def: (typeof kubernetesEfficiencyTableQueries)[number]) {
  const runner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'table', expr: def.expr, format: 'table', instant: true }],
  });
  const data = new SceneDataTransformer({
    $data: runner,
    transformations: [{ id: 'organize', options: { excludeByName: { Time: true } } }],
  });
  return PanelBuilders.table().setTitle(def.title).setData(data).setNoValue(def.noValueText).build();
}

export function getKubernetesEfficiencyScene() {
  const statDefs: Array<{ title: string; key: KubernetesEfficiencyTopStatKey }> = [
    { title: 'No Resource Requests', key: 'no_resource_requests' },
    { title: 'No Resource Limits', key: 'no_resource_limits' },
    { title: 'CPU Over-requested', key: 'cpu_over_requested' },
    { title: 'Memory Over-requested', key: 'memory_over_requested' },
  ];

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: statDefs.map(
            (def) =>
              new SceneFlexItem({
                height: 100,
                body: buildEfficiencyStatPanel(def.title, kubernetesEfficiencyTopStatQueries[def.key]),
              })
          ),
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({
              height: 300,
              body: buildWasteByNamespacePanel('CPU waste by namespace (top 10)', kubernetesEfficiencyWasteByNamespaceQueries.cpu),
            }),
            new SceneFlexItem({
              height: 300,
              body: buildWasteByNamespacePanel('Memory waste by namespace (top 10)', kubernetesEfficiencyWasteByNamespaceQueries.memory),
            }),
          ],
        }),
        new SceneFlexItem({ ySizing: 'content', body: new SceneReactObject({ reactNode: <SectionHeading title="Container details" /> }) }),
        ...kubernetesEfficiencyTableQueries.map(
          (def) => new SceneFlexItem({ height: 400, body: buildEfficiencyTable(def) })
        ),
      ],
    }),
  });
}
