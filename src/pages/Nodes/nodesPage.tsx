import React from 'react';
import {
  EmbeddedScene,
  FieldConfigOverridesBuilder,
  PanelBuilders,
  SceneAppPage,
  SceneAppPageLike,
  SceneControlsSpacer,
  SceneDataTransformer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneQueryRunner,
  SceneReactObject,
  SceneRefreshPicker,
  SceneRouteMatch,
  SceneTimePicker,
  SceneTimeRange,
  SceneVariableSet,
  VariableValueControl,
} from '@grafana/scenes';
import { FieldColorModeId } from '@grafana/data';
import { LegendDisplayMode, TableCellDisplayMode, ThresholdsMode } from '@grafana/schema';
import { Alert, Badge, useTheme2 } from '@grafana/ui';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { buildNodesListTargets, substituteClusterAndNode } from '../../queries/nodeQueries';
import { getNodeCpuScene } from './nodeCpuScene';
import { getNodeMemoryScene } from './nodeMemoryScene';
import { getNodeNetworkScene } from './nodeNetworkScene';
import { getNodeStorageScene } from './nodeStorageScene';
import {
  buildNodeAlertsSeverityQuery,
  buildNodeConditionQuery,
  buildNodeInfoQuery,
  buildNodeVcfInfoQuery,
  nodeCpuOptimizationQueries,
  nodeMemoryOptimizationQueries,
  nodePodsTableQueries,
  substituteClusterNodeAndPod,
  NodeCpuOptimizationKey,
  NodeMemoryOptimizationKey,
  NodePodsTableQueryKey,
} from '../../queries/nodeOverviewQueries';
import { InfoCard, NodeHealthBanner, findFieldAcrossFrames } from '../../scenes/clusterOverviewCards';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import {
  UsageIcon,
  attachPercentField,
  linkedValueCell,
  requestUsageCell,
  usageColorFromTier,
  usageThresholds,
  usageTierCell,
} from '../../scenes/tableCells';
import {
  CLUSTER_VARIABLE_NAME,
  LOGS_DATASOURCE_VARIABLE_NAME,
  NODES_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createClusterFilterVariable,
  createLogsDatasourceVariable,
  createNodesFilterVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';

const NODES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Nodes}`;
const CLUSTERS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Clusters}`;
const NAMESPACES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Namespaces}`;
const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;
const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

function SectionHeading({ title }: { title: string }) {
  const theme = useTheme2();
  return <h3 style={{ ...theme.typography.h3, margin: 0 }}>{title}</h3>;
}

function NodePageTitle({ title, cluster }: { title: string; cluster: string }) {
  const theme = useTheme2();
  const clusterUrl = `${CLUSTERS_URL}/${encodeURIComponent(cluster)}`;
  return (
    <div>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
        {title}
        <Badge text="node" color="darkgrey" />
      </h1>
      <div style={{ fontSize: theme.typography.body.fontSize, color: theme.colors.text.secondary, marginTop: 2 }}>
        in cluster{' '}
        {/* Real page load (not <a href>) - same "cluster" scene variable
            collision reasoning as every other drilldown's own page title. */}
        <button
          onClick={() => window.location.assign(clusterUrl)}
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: theme.colors.text.link, cursor: 'pointer' }}
        >
          {cluster}
        </button>
      </div>
    </div>
  );
}

const alertsThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'green', value: -Infinity },
    { color: 'red', value: 1 },
  ],
};

function ResourceUsageLegend() {
  const theme = useTheme2();
  const items: Array<{ label: string; tier: 'low' | 'med' | 'high' }> = [
    { label: 'low', tier: 'low' },
    { label: 'med', tier: 'med' },
    { label: 'high', tier: 'high' },
  ];
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, alignItems: 'center', padding: '4px 0' }}>
      <span style={{ opacity: 0.7 }}>Resource usage:</span>
      {items.map((item) => (
        <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <UsageIcon tier={item.tier} />
          <span style={{ color: usageColorFromTier(theme, item.tier) }}>{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function getNodesListScene() {
  const clusterRegex = `\${${CLUSTER_VARIABLE_NAME}:regex}`;
  const nodeRegex = `\${${NODES_VARIABLE_NAME}:regex}`;

  const queryRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: buildNodesListTargets(clusterRegex, nodeRegex),
  });

  const transformedData = new SceneDataTransformer({
    $data: queryRunner,
    transformations: [
      { id: 'joinByField', options: { byField: 'node', mode: 'outer' } },
      // Safety net, same reasoning as the Clusters list table's own copy of
      // this (clustersApp.tsx) - `joinByField` still emits a row for any
      // query result missing a "node" label entirely (join key ""), which
      // would otherwise show as an all-blank phantom row.
      {
        id: 'filterByValue',
        options: {
          filters: [{ fieldName: 'node', config: { id: 'regex', options: { value: '^$' } } }],
          type: 'exclude',
          match: 'any',
        },
      },
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, asserts_env: true, asserts_site: true, provider_id: true, 'Value #info': true },
          indexByName: {
            cluster: 0,
            node: 1,
            'Value #alerts': 2,
            'Value #cpu_usage_avg': 3,
            'Value #cpu_usage_avg_percent': 4,
            'Value #cpu_usage_max': 5,
            'Value #cpu_usage_max_percent': 6,
            'Value #mem_usage_avg': 7,
            'Value #mem_usage_avg_percent': 8,
            'Value #mem_usage_max': 9,
            'Value #mem_usage_max_percent': 10,
          },
          renameByName: {},
        },
      },
    ],
  });

  const table = PanelBuilders.table()
    .setTitle('Nodes')
    .setData(transformedData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('cluster')
        .overrideDisplayName('Cluster')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([{ title: 'View cluster', url: `${CLUSTERS_URL}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('node')
        .overrideDisplayName('Node')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          { title: 'View node', url: `${NODES_URL}/\${__data.fields.cluster}/\${__value.text}\${__url.params}` },
        ])
        .matchFieldsWithName('Value #alerts')
        .overrideDisplayName('Alerts')
        .overrideUnit('none')
        .overrideThresholds(alertsThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .overrideLinks([
          {
            title: 'View alerts',
            url: `${PLUGIN_BASE_URL}/${ROUTES.Alerts}?var-${CLUSTER_VARIABLE_NAME}=\${__data.fields.cluster}&var-${NODES_VARIABLE_NAME}=\${__data.fields.node}`,
          },
        ])
        .matchFieldsWithName('Value #cpu_usage_avg')
        .overrideDisplayName('CPU Avg')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #cpu_usage_avg_percent'),
        } as any)
        .matchFieldsWithName('Value #cpu_usage_avg_percent')
        .overrideDisplayName('CPU Avg %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #cpu_usage_max')
        .overrideDisplayName('CPU Max')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #cpu_usage_max_percent'),
        } as any)
        .matchFieldsWithName('Value #cpu_usage_max_percent')
        .overrideDisplayName('CPU Max %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #mem_usage_avg')
        .overrideDisplayName('Mem Avg')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #mem_usage_avg_percent'),
        } as any)
        .matchFieldsWithName('Value #mem_usage_avg_percent')
        .overrideDisplayName('Mem Avg %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
        .matchFieldsWithName('Value #mem_usage_max')
        .overrideDisplayName('Mem Max')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: linkedValueCell('Value #mem_usage_max_percent'),
        } as any)
        .matchFieldsWithName('Value #mem_usage_max_percent')
        .overrideDisplayName('Mem Max %')
        .overrideUnit('percentunit')
        .overrideThresholds(usageThresholds)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
    )
    .build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ body: new SceneControlsSpacer() }),
            new SceneFlexItem({
              xSizing: 'content',
              ySizing: 'content',
              body: new SceneReactObject({ reactNode: <ResourceUsageLegend /> }),
            }),
          ],
        }),
        new SceneFlexItem({ body: table }),
      ],
    }),
  });
}

// Same capacity(light-purple fill)/limits(red dashed)/requests(orange
// dashed)/usage(blue solid) styling as the Cluster Drilldown's own
// applyOptimizationSeriesOverrides (clustersApp.tsx) - a node, like a
// cluster, has a hard physical resource ceiling (unlike the Pod/Workload
// Drilldowns' own optimization charts, which have no "capacity" line at
// all) - redeclared locally per this codebase's established "every tab file
// redeclares its own small style helpers" convention.
function applyNodeOptimizationSeriesOverrides(b: FieldConfigOverridesBuilder<any>) {
  return b
    .matchFieldsByQuery('capacity')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'rgb(202, 149, 229)' })
    .overrideCustomFieldConfig('fillOpacity', 14)
    .matchFieldsByQuery('limits')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'red' })
    .overrideCustomFieldConfig('lineStyle', { fill: 'dash' })
    .matchFieldsByQuery('requests')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'orange' })
    .overrideCustomFieldConfig('lineStyle', { fill: 'dash' })
    .matchFieldsByQuery('usage')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'blue' });
}

function getNodeOverviewScene(cluster: string, node: string, clusterRegex: string, nodeRegex: string) {
  const clusterUrl = `${CLUSTERS_URL}/${encodeURIComponent(cluster)}`;

  const healthRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'conditions', expr: buildNodeConditionQuery(clusterRegex, node), instant: true },
      { refId: 'alerts', expr: buildNodeAlertsSeverityQuery(clusterRegex, node), instant: true },
    ],
  });
  const healthBanner = new NodeHealthBanner({
    $data: healthRunner,
    alertsUrl: `${PLUGIN_BASE_URL}/${ROUTES.Alerts}?var-${CLUSTER_VARIABLE_NAME}=${encodeURIComponent(cluster)}&var-${NODES_VARIABLE_NAME}=${encodeURIComponent(node)}`,
  });

  // Two separate runners for the left/middle cards (both reading the exact
  // same kube_node_info query) rather than one shared $data - giving the
  // same SceneQueryRunner instance as $data to two different InfoCard
  // objects hits the same silent-reparenting gotcha as sharing any other
  // non-$-prefixed scene object between siblings (see NodeHealthBanner's own
  // comment above). format: 'table' on both - without it, kube_node_info's
  // labels never split into their own scalar columns for a plain
  // findFieldAcrossFrames(frames, '<label>') lookup (confirmed while
  // building the Pod Drilldown's own Overview tab).
  const leftRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'info', expr: buildNodeInfoQuery(clusterRegex, node), instant: true, format: 'table' }],
  });

  const leftCard = new InfoCard({
    $data: leftRunner,
    rows: [
      { label: 'clustername:', render: () => cluster, href: clusterUrl },
      { label: 'node:', render: () => node },
      { label: 'node_ip:', render: (frames) => findFieldAcrossFrames(frames, 'internal_ip')?.values[0] ?? '–' },
      { label: 'node_os_image:', render: (frames) => findFieldAcrossFrames(frames, 'os_image')?.values[0] ?? '–' },
    ],
  });

  const middleRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'info', expr: buildNodeInfoQuery(clusterRegex, node), instant: true, format: 'table' }],
  });

  const middleCard = new InfoCard({
    $data: middleRunner,
    rows: [
      { label: 'node_kernel_version:', render: (frames) => findFieldAcrossFrames(frames, 'kernel_version')?.values[0] ?? '–' },
      { label: 'node_kubelet_version:', render: (frames) => findFieldAcrossFrames(frames, 'kubelet_version')?.values[0] ?? '–' },
      {
        label: 'node_container_runtime_version:',
        render: (frames) => findFieldAcrossFrames(frames, 'container_runtime_version')?.values[0] ?? '–',
      },
    ],
  });

  // Two queries sharing one $data - "vcf_vcenter" comes from kube_node_info's
  // own "provider" label (info), "vcf_clustername"/"vcf_esx_host" from the
  // separate 2-hop vSphere chain (vcf) - see buildNodeVcfInfoQuery's own
  // comment for why these are genuinely two different sources, not one query
  // split for convenience. InfoCard already searches every frame, same as
  // the health banner's own conditions/alerts split.
  const rightRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'info', expr: buildNodeInfoQuery(clusterRegex, node), instant: true, format: 'table' },
      { refId: 'vcf', expr: buildNodeVcfInfoQuery(node), instant: true, format: 'table' },
    ],
  });

  const rightCard = new InfoCard({
    $data: rightRunner,
    rows: [
      { label: 'vcf_vcenter:', render: (frames) => findFieldAcrossFrames(frames, 'provider')?.values[0] ?? '–' },
      { label: 'vcf_clustername:', render: (frames) => findFieldAcrossFrames(frames, 'clustername')?.values[0] ?? '–' },
      { label: 'vcf_esx_host:', render: (frames) => findFieldAcrossFrames(frames, 'esxhostname')?.values[0] ?? '–' },
    ],
  });

  // "Node optimization" - capacity/limits/requests/usage CPU/Memory
  // timeseries, given verbatim.
  const substitute = (expr: string) => substituteClusterAndNode(expr, clusterRegex, nodeRegex);

  const cpuLegends: Record<NodeCpuOptimizationKey, string> = {
    cpuCapacity: 'Physical capacity of Node',
    cpuLimits: 'Sum of container cpu limits',
    cpuRequests: 'Sum of container cpu requests',
    cpuUsage: 'Node cpu usage',
  };
  const cpuOptimizationRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(nodeCpuOptimizationQueries) as NodeCpuOptimizationKey[]).map((key) => ({
      // refId drives applyNodeOptimizationSeriesOverrides' matching
      // (capacity/limits/requests/usage), not the map's own "cpu..." keys.
      refId: key.replace(/^cpu/, '').toLowerCase(),
      expr: substitute(nodeCpuOptimizationQueries[key]),
      legendFormat: cpuLegends[key],
    })),
  });
  const cpuOptimizationPanel = PanelBuilders.timeseries()
    .setTitle('Node CPU')
    .setUnit('cores')
    .setData(cpuOptimizationRunner)
    .setOverrides(applyNodeOptimizationSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const memoryLegends: Record<NodeMemoryOptimizationKey, string> = {
    memCapacity: 'Physical capacity of Node',
    memLimits: 'Sum of container memory limits',
    memRequests: 'Sum of container memory requests',
    memUsage: 'Node memory usage',
  };
  const memoryOptimizationRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(nodeMemoryOptimizationQueries) as NodeMemoryOptimizationKey[]).map((key) => ({
      refId: key.replace(/^mem/, '').toLowerCase(),
      expr: substitute(nodeMemoryOptimizationQueries[key]),
      legendFormat: memoryLegends[key],
    })),
  });
  const memoryOptimizationPanel = PanelBuilders.timeseries()
    .setTitle('Node Memory')
    .setUnit('bytes')
    .setData(memoryOptimizationRunner)
    .setOverrides(applyNodeOptimizationSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  // "Pods" table - one row per pod scheduled on this node. No Pod picker on
  // this page (see substituteClusterNodeAndPod's own comment), so every
  // query's own $pod token matches everything.
  const substitutePod = (expr: string) => substituteClusterNodeAndPod(expr, clusterRegex, nodeRegex);
  const podsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(nodePodsTableQueries) as NodePodsTableQueryKey[]).map((key) => ({
      refId: key,
      expr: substitutePod(nodePodsTableQueries[key]),
      format: 'table' as const,
      instant: true,
    })),
  });

  const podsData = new SceneDataTransformer({
    $data: podsRunner,
    transformations: [
      { id: 'merge', options: {} },
      // Same combined value+percent+bar cell treatment as the Namespaces
      // list table (see getNamespacesListScene in namespacesPage.tsx) - CPU
      // Usage colored by the CPU Requests ratio, Mem Usage by the Mem
      // *Limits* ratio (the hard OOM-kill ceiling, not just a scheduling
      // reservation).
      attachPercentField('Value #cpu_requests', 'Value #cpu_requests_percent'),
      attachPercentField('Value #cpu_usage', 'Value #cpu_requests_percent'),
      attachPercentField('Value #mem_requests', 'Value #mem_requests_percent'),
      attachPercentField('Value #mem_limits', 'Value #mem_limits_percent'),
      attachPercentField('Value #mem_usage', 'Value #mem_limits_percent'),
      {
        id: 'organize',
        options: {
          // "cluster" is fully dropped (not just hidden) rather than kept
          // for the link macros below - this page is already scoped to one
          // cluster via its own route param, so the links below inline that
          // known JS value directly instead of reading a per-row field
          // (which also sidesteps needing to keep an unrequested "cluster"
          // column visible just to feed a link macro). "workload_type"
          // *is* kept and shown (as TYPE) - genuinely varies per row, and
          // every other Workload-linking table in this app pairs a WORKLOAD
          // column with a TYPE one right next to it, so this isn't just a
          // link-plumbing artifact.
          excludeByName: {
            Time: true,
            cluster: true,
            node: true,
            pod_ip: true,
            uid: true,
            asserts_env: true,
            asserts_site: true,
            // The "info" query's own value (a group-by-collapsed "1", not
            // anything meaningful to show) - was never excluded, a latent
            // bug only invisible here because this table has enough other
            // columns to push it off the right edge of a typical viewport;
            // it's directly visible (and fixed) on the CPU/Memory tabs' own
            // narrower Pods tables, which reuse this same query set.
            'Value #info': true,
            'Value #cpu_requests_percent': true,
            'Value #mem_requests_percent': true,
            'Value #mem_limits_percent': true,
          },
          indexByName: {
            pod: 0,
            workload: 1,
            workload_type: 2,
            namespace: 3,
            phase: 4,
            'Value #cpu_usage': 5,
            'Value #cpu_requests': 6,
            'Value #mem_usage': 7,
            'Value #mem_requests': 8,
            'Value #mem_limits': 9,
          },
          renameByName: {},
        },
      },
    ],
  });

  const podsTable = PanelBuilders.table()
    .setTitle('Pods')
    .setData(podsData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('pod')
        .overrideDisplayName('POD')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          {
            title: 'View pod',
            url: `${WORKLOADS_URL}/${encodeURIComponent(cluster)}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__data.fields.workload}/pods/\${__value.text}\${__url.params}`,
          },
        ])
        .matchFieldsWithName('workload')
        .overrideDisplayName('WORKLOAD')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          {
            title: 'View workload',
            url: `${WORKLOADS_URL}/${encodeURIComponent(cluster)}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__value.text}\${__url.params}`,
          },
        ])
        .matchFieldsWithName('workload_type')
        .overrideDisplayName('TYPE')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('namespace')
        .overrideDisplayName('NAMESPACE')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([{ title: 'View namespace', url: `${NAMESPACES_URL}/${encodeURIComponent(cluster)}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('phase')
        .overrideDisplayName('STATUS')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('Value #cpu_usage')
        .overrideDisplayName('CPU Usage')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: usageTierCell(),
        } as any)
        .matchFieldsWithName('Value #cpu_requests')
        .overrideDisplayName('CPU Requests')
        .overrideUnit('cores')
        .overrideDecimals(2)
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: requestUsageCell(),
        } as any)
        .matchFieldsWithName('Value #mem_usage')
        .overrideDisplayName('Mem Usage')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: usageTierCell(),
        } as any)
        .matchFieldsWithName('Value #mem_requests')
        .overrideDisplayName('Mem Requests')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: requestUsageCell(),
        } as any)
        .matchFieldsWithName('Value #mem_limits')
        .overrideDisplayName('Mem Limits')
        .overrideUnit('bytes')
        .overrideCustomFieldConfig('align', 'left')
        .overrideCustomFieldConfig('cellOptions', {
          type: TableCellDisplayMode.Custom,
          cellComponent: requestUsageCell(),
        } as any)
    )
    .build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Node information" /> }),
        }),
        new SceneFlexItem({ ySizing: 'content', body: healthBanner }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            // Only the left card gets ySizing:'content' (it has the most
            // rows, so it drives the row's natural height) - the other two
            // are left at the default 'fill'/alignSelf:'stretch' so they
            // match it instead of leaving dead space below their own
            // shorter content (see the same fix on the Namespace
            // Drilldown's own quota cards).
            new SceneFlexItem({ width: '33.3%', ySizing: 'content', minWidth: 0, body: leftCard }),
            new SceneFlexItem({ width: '33.3%', minWidth: 0, body: middleCard }),
            new SceneFlexItem({ width: '33.3%', minWidth: 0, body: rightCard }),
          ],
        }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Node optimization" /> }),
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 400, body: cpuOptimizationPanel }),
            new SceneFlexItem({ height: 400, body: memoryOptimizationPanel }),
          ],
        }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Pods" /> }),
        }),
        new SceneFlexItem({ height: 400, body: podsTable }),
      ],
    }),
  });
}

// Same shape as the other drilldowns' own placeholder scaffold (e.g.
// getPodPlaceholderScene in podsPage.tsx) for the tabs not built out yet.
function getNodePlaceholderScene(title: string) {
  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({
            reactNode: (
              <Alert severity="info" title={`${title} - coming soon`}>
                This tab is scaffolded but not built out yet.
              </Alert>
            ),
          }),
        }),
      ],
    }),
  });
}

interface NodeTabDef {
  slug: string;
  title: string;
  getScene: () => EmbeddedScene;
}

function getNodeDetailPage(routeMatch: SceneRouteMatch<{ cluster: string; node: string }>, parent: SceneAppPageLike) {
  const cluster = decodeURIComponent(routeMatch.params.cluster);
  const node = decodeURIComponent(routeMatch.params.node);
  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clusterRegex = escapeRegex(cluster);
  const nodeRegex = escapeRegex(node);
  const baseUrl = `${NODES_URL}/${encodeURIComponent(cluster)}/${encodeURIComponent(node)}`;

  const tabDefs: NodeTabDef[] = [
    { slug: 'overview', title: 'Overview', getScene: () => getNodeOverviewScene(cluster, node, clusterRegex, nodeRegex) },
    { slug: 'cpu', title: 'CPU', getScene: () => getNodeCpuScene(cluster, clusterRegex, node, nodeRegex) },
    { slug: 'memory', title: 'Memory', getScene: () => getNodeMemoryScene(cluster, clusterRegex, node, nodeRegex) },
    { slug: 'network', title: 'Network', getScene: () => getNodeNetworkScene(clusterRegex, node, nodeRegex) },
    { slug: 'storage', title: 'Storage', getScene: () => getNodeStorageScene(clusterRegex, node, nodeRegex) },
    // No reference dashboard content for either tab (Logs' own panel had no
    // query configured at all; Events doesn't exist as a tab there), and the
    // demo Elasticsearch data has no node-identifying field to filter by -
    // left as placeholders per explicit user decision rather than guessing
    // at an ES query shape with nothing to verify it against.
    { slug: 'logs', title: 'Logs', getScene: () => getNodePlaceholderScene('Logs') },
    { slug: 'events', title: 'Events', getScene: () => getNodePlaceholderScene('Events') },
  ];

  const tabs = tabDefs.map(
    (tab) =>
      new SceneAppPage({
        title: tab.title,
        url: `${baseUrl}/${tab.slug}`,
        routePath: tab.slug,
        getScene: tab.getScene,
      })
  );

  return new SceneAppPage({
    title: node,
    titleImg: KUBERNETES_ICON,
    renderTitle: (title) => <NodePageTitle title={title} cluster={cluster} />,
    url: baseUrl,
    routePath: baseUrl,
    getParentPage: () => parent,
    tabs,
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'browser' }),
    $variables: new SceneVariableSet({ variables: [createThanosDatasourceVariable(), createLogsDatasourceVariable()] }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new VariableValueControl({ variableName: LOGS_DATASOURCE_VARIABLE_NAME }),
      new SceneControlsSpacer(),
      new SceneTimePicker({}),
      new SceneRefreshPicker({ refresh: '1m' }),
    ],
    preserveUrlKeys: ['from', 'to', 'timezone', 'refresh', `var-${THANOS_VARIABLE_NAME}`, `var-${LOGS_DATASOURCE_VARIABLE_NAME}`],
  });
}

export function getNodesPage() {
  return new SceneAppPage({
    title: 'Nodes',
    titleImg: KUBERNETES_ICON,
    url: NODES_URL,
    routePath: `/${ROUTES.Nodes}/*`,
    getScene: getNodesListScene,
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'browser' }),
    $variables: new SceneVariableSet({
      variables: [
        createThanosDatasourceVariable(),
        createClusterFilterVariable(),
        createNodesFilterVariable(`\${${CLUSTER_VARIABLE_NAME}:regex}`),
      ],
    }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new VariableValueControl({ variableName: CLUSTER_VARIABLE_NAME }),
      new VariableValueControl({ variableName: NODES_VARIABLE_NAME }),
      new SceneControlsSpacer(),
      new SceneTimePicker({}),
      new SceneRefreshPicker({ refresh: '1m' }),
    ],
    // Deliberately excludes the filter variables - see the same note in
    // namespacesPage.ts.
    preserveUrlKeys: ['from', 'to', 'timezone', 'refresh', `var-${THANOS_VARIABLE_NAME}`],
    drilldowns: [
      {
        routePath: `/:cluster/:node/*`,
        getPage: getNodeDetailPage,
      },
    ],
  });
}
