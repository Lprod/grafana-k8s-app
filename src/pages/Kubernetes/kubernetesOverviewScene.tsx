import React from 'react';
import {
  EmbeddedScene,
  PanelBuilders,
  SceneComponentProps,
  SceneDataTransformer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneObjectBase,
  SceneObjectState,
  SceneQueryRunner,
  SceneReactObject,
} from '@grafana/scenes';
import { BarGaugeDisplayMode, BigValueColorMode, BigValueGraphMode, TableCellDisplayMode, ThresholdsMode } from '@grafana/schema';
import { FieldColorModeId } from '@grafana/data';
import { Combobox, ComboboxOption, Icon } from '@grafana/ui';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { CLUSTER_VARIABLE_NAME, THANOS_VARIABLE_NAME } from '../../variables/datasourceVariables';
import { SectionHeading } from '../../scenes/clustersApp';
import {
  deployedContainerImagesQuery,
  IssueQueryDef,
  kubernetesAvailabilityQueries,
  kubernetesInfrastructureQueries,
  kubernetesIssueQueries,
  KubernetesIssueKey,
  kubernetesStabilityQueries,
  kubernetesTopStatQueries,
} from '../../queries/kubernetesOverviewQueries';

const CLUSTERS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Clusters}`;
const NODES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Nodes}`;
const NAMESPACES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Namespaces}`;
const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;

// The 6 top tiles are informational counts, not health signals - always the
// same flat color regardless of value (a single threshold step pins it).
const flatStatThresholds = { mode: ThresholdsMode.Absolute, steps: [{ color: 'blue', value: -Infinity }] };

// Same shape as `alertsThresholds` in clustersApp.tsx (green baseline, red
// as soon as anything shows up) - kept local rather than imported since
// every page file in this codebase already redeclares its own small
// per-file constants like this (see KUBERNETES_ICON in alertsPage.ts).
const issueCountThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'green', value: -Infinity },
    { color: 'red', value: 1 },
  ],
};

function substituteCluster(expr: string): string {
  return expr.replaceAll('$cluster', `\${${CLUSTER_VARIABLE_NAME}:regex}`);
}

function buildTopStatPanel(title: string, expr: string, linkUrl?: string) {
  const runner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'value', expr: substituteCluster(expr), instant: true }],
  });
  const builder = PanelBuilders.stat()
    .setTitle(title)
    .setUnit('short')
    .setThresholds(flatStatThresholds)
    .setOption('colorMode', BigValueColorMode.Background)
    .setOption('graphMode', BigValueGraphMode.None)
    .setData(runner);
  if (linkUrl) {
    builder.setOverrides((b) => b.matchFieldsWithName('Value').overrideLinks([{ title: `View ${title}`, url: linkUrl }]));
  }
  return builder.build();
}

// Shared, single query runner behind the "Detail view" table at the bottom
// of the page - every mini issue panel's "View detail" link and the
// dropdown itself just point it at a different raw (unwrapped) query.
//
// `queryRunner` is deliberately NOT a SceneObjectState field: any state
// value that's itself a SceneObject gets auto-parented (SceneObjectBase's
// `_setParent` walks all state values, not just `$`-prefixed ones), and
// this same runner is also `$data` on the actual detail-table VizPanel -
// two owners for one SceneObject trips Scenes' "already has a parent"
// warning and silently reparents it. Keeping it a plain instance field
// sidesteps that; its real (and only) scene-graph parent is the VizPanel.
interface DetailViewSelectionState extends SceneObjectState {
  selectedKey: KubernetesIssueKey;
}

class DetailViewSelection extends SceneObjectBase<DetailViewSelectionState> {
  static Component = DetailViewSelectionRenderer;
  private queryRunner: SceneQueryRunner;

  constructor(state: DetailViewSelectionState, queryRunner: SceneQueryRunner) {
    super(state);
    this.queryRunner = queryRunner;
  }

  select(key: KubernetesIssueKey) {
    const def = kubernetesIssueQueries[key];
    this.queryRunner.setState({ queries: [{ refId: 'detail', expr: def.expr, format: 'table', instant: true }] });
    this.queryRunner.runQueries();
    this.setState({ selectedKey: key });
  }
}

const detailViewOptions: Array<ComboboxOption<KubernetesIssueKey>> = (Object.keys(kubernetesIssueQueries) as KubernetesIssueKey[]).map(
  (key) => ({ label: kubernetesIssueQueries[key].title, value: key })
);

function DetailViewSelectionRenderer({ model }: SceneComponentProps<DetailViewSelection>) {
  const { selectedKey } = model.useState();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span>Detail view</span>
      <div style={{ minWidth: 280 }}>
        <Combobox<KubernetesIssueKey>
          options={detailViewOptions}
          value={selectedKey}
          onChange={(option) => model.select(option.value)}
        />
      </div>
    </div>
  );
}

// Header-action button placed on every mini issue panel - clicking it just
// re-points the shared DetailViewSelection at this panel's own query,
// mirroring how Grafana's own reference groups all 12 issue tables behind
// one dropdown+table pair instead of 12 separate tables.
//
// `onSelect` is a plain closure, not a SceneObject reference, for the same
// reason `queryRunner` above isn't a state field - it lets 12 of these
// panels all reach the one shared DetailViewSelection without each trying
// to claim it as their own child.
interface ViewDetailLinkState extends SceneObjectState {
  onSelect: () => void;
}

class ViewDetailLink extends SceneObjectBase<ViewDetailLinkState> {
  static Component = ViewDetailLinkRenderer;
}

function ViewDetailLinkRenderer({ model }: SceneComponentProps<ViewDetailLink>) {
  const { onSelect } = model.useState();
  return (
    <button
      onClick={onSelect}
      style={{
        background: 'none',
        border: 'none',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12,
        opacity: 0.8,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 0,
      }}
    >
      View detail
      <Icon name="arrow-right" size="sm" />
    </button>
  );
}

function buildIssueCountStatPanel(def: IssueQueryDef, detailView: DetailViewSelection, issueKey: KubernetesIssueKey) {
  const runner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'count', expr: `count(${def.expr})` }],
  });
  return PanelBuilders.stat()
    .setTitle(def.title)
    .setUnit('short')
    .setThresholds(issueCountThresholds)
    .setOption('colorMode', BigValueColorMode.Value)
    .setOption('graphMode', BigValueGraphMode.Area)
    .setData(runner)
    .setHeaderActions(new ViewDetailLink({ onSelect: () => detailView.select(issueKey) }))
    .build();
}

function buildIssueSection(title: string, defs: Record<string, IssueQueryDef>, detailView: DetailViewSelection) {
  const keys = Object.keys(defs) as KubernetesIssueKey[];
  return new SceneFlexLayout({
    direction: 'column',
    ySizing: 'content',
    children: [
      new SceneFlexItem({ ySizing: 'content', body: new SceneReactObject({ reactNode: <SectionHeading title={title} /> }) }),
      new SceneFlexLayout({
        direction: 'row',
        ySizing: 'content',
        children: keys.map(
          (key) =>
            new SceneFlexItem({
              height: 150,
              body: buildIssueCountStatPanel(defs[key], detailView, key),
            })
        ),
      }),
    ],
  });
}

export function getKubernetesOverviewScene() {
  const initialKey: KubernetesIssueKey = 'zero_replica_deployments';
  const detailQueryRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'detail', expr: kubernetesIssueQueries[initialKey].expr, format: 'table', instant: true }],
  });
  const detailView = new DetailViewSelection({ selectedKey: initialKey }, detailQueryRunner);

  const detailTable = PanelBuilders.table().setTitle('Issue details').setData(detailQueryRunner).build();

  const imagesRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'images', expr: substituteCluster(deployedContainerImagesQuery), format: 'table', instant: true }],
  });
  const imagesData = new SceneDataTransformer({
    $data: imagesRunner,
    transformations: [
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true },
          renameByName: { image_spec: 'Image spec', Value: 'Containers' },
        },
      },
    ],
  });
  const imagesTable = PanelBuilders.table()
    .setTitle('Deployed container images (as of ${__to:date:YYYY-MM-DD HH:mm:ss})')
    .setData(imagesData)
    .setOption('sortBy', [{ displayName: 'Containers', desc: true }])
    .setOverrides((b) =>
      b
        .matchFieldsWithName('Containers')
        .overrideUnit('none')
        .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'blue' })
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.Gauge, mode: BarGaugeDisplayMode.Gradient })
        .overrideCustomFieldConfig('footer', { reducers: ['count'] })
    )
    .build();

  return new EmbeddedScene({
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 100, body: buildTopStatPanel('Clusters', kubernetesTopStatQueries.clusters, CLUSTERS_URL) }),
            new SceneFlexItem({ height: 100, body: buildTopStatPanel('Nodes', kubernetesTopStatQueries.nodes, NODES_URL) }),
            new SceneFlexItem({
              height: 100,
              body: buildTopStatPanel('Namespaces', kubernetesTopStatQueries.namespaces, NAMESPACES_URL),
            }),
            new SceneFlexItem({
              height: 100,
              body: buildTopStatPanel('Workloads', kubernetesTopStatQueries.workloads, WORKLOADS_URL),
            }),
            new SceneFlexItem({ height: 100, body: buildTopStatPanel('Pods', kubernetesTopStatQueries.pods) }),
            new SceneFlexItem({ height: 100, body: buildTopStatPanel('Containers', kubernetesTopStatQueries.containers) }),
          ],
        }),
        buildIssueSection('Availability', kubernetesAvailabilityQueries, detailView),
        buildIssueSection('Stability', kubernetesStabilityQueries, detailView),
        buildIssueSection('Infrastructure', kubernetesInfrastructureQueries, detailView),
        new SceneFlexItem({ ySizing: 'content', body: detailView }),
        new SceneFlexItem({ height: 400, body: detailTable }),
        new SceneFlexItem({ height: 400, body: imagesTable }),
      ],
    }),
  });
}
