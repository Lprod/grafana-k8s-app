import React from 'react';
import { DataFrame, Field, FieldType } from '@grafana/data';
import {
  CustomTransformOperator,
  EmbeddedScene,
  PanelBuilders,
  SceneDataTransformer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneQueryRunner,
  SceneReactObject,
} from '@grafana/scenes';
import { map } from 'rxjs/operators';
// Not re-exported from '@grafana/schema''s own top-level index (Node Graph's
// options aren't part of the "common" schema surface) - same deep-import
// path @grafana/scenes' own PanelBuilders.nodegraph() typing resolves to
// internally, confirmed present in this package's own package.json#exports.
import { LayoutAlgorithm } from '@grafana/schema/dist/esm/raw/composable/nodegraph/panelcfg/x/NodeGraphPanelCfg_types.gen';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import {
  buildNodeInfoQuery,
  buildNodeVcfInfoQuery,
  nodeCpuOptimizationQueries,
  nodePodsTableQueries,
  substituteClusterNodeAndPod,
} from '../../queries/nodeOverviewQueries';
import { substituteClusterAndNode } from '../../queries/nodeQueries';
import { THANOS_VARIABLE_NAME } from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';
import { SectionHeading } from '../../scenes/sectionHeading';

const NAMESPACES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Namespaces}`;
const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;

// Edges are deliberately never tier-colored (see the pod-edge/infra-edge
// construction below) - the "this pod is hogging the node" highlight lives
// entirely on the node's own circle fill, per explicit follow-up ask.
const EDGE_COLOR = '#999';

function frameByRef(frames: DataFrame[], refId: string) {
  return frames.find((f) => f.refId === refId);
}

function columnValues(frame: DataFrame | undefined, name: string): unknown[] {
  return frame?.fields.find((f) => f.name === name)?.values ?? [];
}

function singleValue(frame: DataFrame | undefined, name = 'Value'): number | undefined {
  const v = frame?.fields.find((f) => f.name === name)?.values?.[0];
  return typeof v === 'number' ? v : undefined;
}

function singleString(frame: DataFrame | undefined, name: string): string | undefined {
  const v = frame?.fields.find((f) => f.name === name)?.values?.[0];
  return v === undefined || v === null || v === '' ? undefined : String(v);
}

function stringField(name: string, values: Array<string | null>): Field {
  return { name, type: FieldType.string, config: {}, values };
}

function numberField(name: string, values: Array<number | null>, unit?: string): Field {
  return { name, type: FieldType.number, config: unit ? { unit } : {}, values };
}

// A pod "hogging" its node is a different scale than this app's usual
// usageThresholds (tableCells.tsx) - that one colors *request/limit
// efficiency* (a cost-planning read, where under 60% is orange for wasted
// capacity). Here there's no request/limit involved at all, just "how much
// of the node's shared physical CPU pool does this one pod occupy" - a
// plain the-bigger-the-worse ramp instead.
type ShareTier = 'low' | 'med' | 'high';

function nodeShareTier(fraction: number | undefined): ShareTier {
  if (fraction === undefined || Number.isNaN(fraction)) {
    return 'low';
  }
  if (fraction >= 0.7) {
    return 'high';
  }
  if (fraction >= 0.3) {
    return 'med';
  }
  return 'low';
}

function nodeShareColor(tier: ShareTier): string {
  switch (tier) {
    case 'high':
      return 'red';
    case 'med':
      return 'orange';
    default:
      return 'green';
  }
}

interface GraphNodeRow {
  id: string;
  title: string;
  subtitle: string;
  mainStat: number | null;
  secondaryStat: number | null;
  color: string;
  detailType: string;
  detailNamespace: string;
  detailWorkload: string;
  detailCpuUsage: string;
  detailNodeShare: string;
  namespace: string;
  workload: string;
  workloadType: string;
  pod: string;
}

interface GraphEdgeRow {
  id: string;
  source: string;
  target: string;
  color: string;
  thickness: number;
  strokeDasharray: string;
}

function emptyDetailRow(id: string, title: string, subtitle: string, detailType: string): GraphNodeRow {
  return {
    id,
    title,
    subtitle,
    mainStat: null,
    secondaryStat: null,
    color: 'blue',
    detailType,
    detailNamespace: '–',
    detailWorkload: '–',
    detailCpuUsage: '–',
    detailNodeShare: '–',
    namespace: '',
    workload: '',
    workloadType: '',
    pod: '',
  };
}

// Builds the Node Graph's two required frames ("nodes"/"edges", see
// https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/node-graph/)
// from this tab's own raw query results, rather than via any built-in
// transform - a topology like this (one node in the middle, its pods
// fanning out one way, the physical vSphere chain fanning out the other)
// isn't something `merge`/`joinByField` can produce, so the whole graph is
// assembled by hand here, same spirit as this app's other custom
// CustomTransformOperators (attachPercentField etc. in tableCells.tsx) but
// replacing the frame set entirely instead of augmenting it.
function buildDependencyGraphFrames(cluster: string, node: string): CustomTransformOperator {
  return () => (source) =>
    source.pipe(
      map((frames) => {
        const podsInfoFrame = frameByRef(frames, 'podsInfo');
        const podsCpuFrame = frameByRef(frames, 'podsCpuUsage');
        const nodeInfoFrame = frameByRef(frames, 'nodeInfo');
        const vcfInfoFrame = frameByRef(frames, 'vcfInfo');

        const nodeCapacity = singleValue(frameByRef(frames, 'nodeCapacity'));
        // "vcf_vcenter" is kube_node_info's own "provider" label (see
        // buildNodeVcfInfoQuery's own comment on the Overview tab) - only
        // esxhostname/clustername are a genuine vSphere lookup.
        const vcenter = singleString(nodeInfoFrame, 'provider');
        const esxHost = singleString(vcfInfoFrame, 'esxhostname');
        const vcfCluster = singleString(vcfInfoFrame, 'clustername');

        const cpuByPod = new Map<string, number>();
        const cpuPodNames = columnValues(podsCpuFrame, 'pod') as string[];
        const cpuValues = columnValues(podsCpuFrame, 'Value') as number[];
        cpuPodNames.forEach((podName, i) => {
          if (typeof cpuValues[i] === 'number') {
            cpuByPod.set(String(podName), cpuValues[i]);
          }
        });

        const podNames = columnValues(podsInfoFrame, 'pod') as string[];
        const podNamespaces = columnValues(podsInfoFrame, 'namespace') as string[];
        const podWorkloads = columnValues(podsInfoFrame, 'workload') as string[];
        const podWorkloadTypes = columnValues(podsInfoFrame, 'workload_type') as string[];

        const nodeRows: GraphNodeRow[] = [];
        const edgeRows: GraphEdgeRow[] = [];

        const nodeId = `node:${node}`;
        nodeRows.push({
          ...emptyDetailRow(nodeId, node, 'Kubernetes Node', 'Kubernetes Node'),
          // Node itself isn't colored by the pod-share scale (it IS the
          // 100% reference, not a slice of itself) - a neutral tint, same
          // "darkgrey" family as this page's own node Badge.
          color: 'darkgrey',
        });

        // Heaviest-CPU-share pod first - with 30-40 pods fanned out into one
        // layered-layout column (see below), insertion order is the only
        // lever available for *where in that column* a pod lands, so this
        // puts the pods most worth noticing at the top instead of leaving
        // them at whatever position the underlying query happened to return.
        const podOrder = podNames
          .map((rawPodName, i) => ({ rawPodName, i, cpuUsage: cpuByPod.get(String(rawPodName)) ?? -1 }))
          .sort((a, b) => b.cpuUsage - a.cpuUsage);

        podOrder.forEach(({ rawPodName, i }) => {
          const podName = String(rawPodName);
          const namespace = podNamespaces[i] !== undefined ? String(podNamespaces[i]) : '';
          const workload = podWorkloads[i] !== undefined ? String(podWorkloads[i]) : '';
          const workloadType = podWorkloadTypes[i] !== undefined ? String(podWorkloadTypes[i]) : '';
          const cpuUsage = cpuByPod.get(podName);
          const fraction =
            nodeCapacity !== undefined && nodeCapacity > 0 && cpuUsage !== undefined
              ? Math.min(cpuUsage / nodeCapacity, 1)
              : undefined;
          const tier = nodeShareTier(fraction);
          const color = nodeShareColor(tier);
          const podId = `pod:${podName}`;

          nodeRows.push({
            id: podId,
            title: podName,
            subtitle: namespace,
            mainStat: cpuUsage ?? null,
            secondaryStat: fraction ?? null,
            color,
            detailType: 'Pod',
            detailNamespace: namespace || '–',
            detailWorkload: workload ? `${workload} (${workloadType})` : '–',
            detailCpuUsage: cpuUsage !== undefined ? `${cpuUsage.toFixed(2)} cores` : '–',
            detailNodeShare: fraction !== undefined ? `${Math.round(fraction * 100)}% of node capacity` : '–',
            namespace,
            workload,
            workloadType,
            pod: podName,
          });

          // Edges stay a plain neutral color - the pod-share highlight lives
          // on the *node* circle itself (see `color` above), not the line
          // connecting it, per explicit follow-up ask. Thickness still scales
          // with the pod's own share of the node, as a second, more subtle
          // signal.
          edgeRows.push({
            id: `edge:node-pod:${podName}`,
            source: nodeId,
            target: podId,
            color: EDGE_COLOR,
            thickness: 1 + (fraction ?? 0) * 4,
            strokeDasharray: '',
          });
        });

        // The physical vSphere chain - vCenter -> VCF cluster -> ESXi host ->
        // node - the "other direction" from the node's own pods. Edges point
        // *toward* the node (the reverse of the pod edges below, which point
        // *away* from it) so the panel's layered layout (see
        // getNodeDependenciesScene's own `layoutAlgorithm` option) - which
        // ranks nodes into columns by directed distance from a root - puts
        // this whole chain in the columns left of the node and every pod in
        // the columns to its right, node dead center, instead of an
        // undirected jumble. Each hop is only added when its own query
        // actually returned data (the demo stack has no vSphere/telegraf
        // source, see buildNodeVcfInfoQuery's own comment - a real
        // environment may only have some of these resolve).
        let chainChildId = nodeId;
        if (esxHost) {
          const esxId = `esxi:${esxHost}`;
          nodeRows.push(emptyDetailRow(esxId, esxHost, 'ESXi Host', 'ESXi Host'));
          edgeRows.push({
            id: 'edge:esxi-node',
            source: esxId,
            target: chainChildId,
            color: EDGE_COLOR,
            thickness: 2,
            strokeDasharray: '4,4',
          });
          chainChildId = esxId;
        }
        if (vcfCluster) {
          const vcfId = `vcfcluster:${vcfCluster}`;
          nodeRows.push(emptyDetailRow(vcfId, vcfCluster, 'VCF Cluster', 'VCF Cluster'));
          edgeRows.push({
            id: 'edge:vcfcluster-esxi',
            source: vcfId,
            target: chainChildId,
            color: EDGE_COLOR,
            thickness: 2,
            strokeDasharray: '4,4',
          });
          chainChildId = vcfId;
        }
        if (vcenter) {
          const vcenterId = `vcenter:${vcenter}`;
          nodeRows.push(emptyDetailRow(vcenterId, vcenter, 'vCenter', 'vCenter'));
          edgeRows.push({
            id: 'edge:vcenter-vcfcluster',
            source: vcenterId,
            target: chainChildId,
            color: EDGE_COLOR,
            thickness: 2,
            strokeDasharray: '4,4',
          });
        }

        const nodesFrame: DataFrame = {
          name: 'nodes',
          refId: 'nodes',
          length: nodeRows.length,
          fields: [
            stringField('id', nodeRows.map((r) => r.id)),
            stringField('title', nodeRows.map((r) => r.title)),
            stringField('subtitle', nodeRows.map((r) => r.subtitle)),
            numberField('mainStat', nodeRows.map((r) => r.mainStat), 'cores'),
            numberField('secondaryStat', nodeRows.map((r) => r.secondaryStat), 'percentunit'),
            // Two coloring paths on purpose: `color` per the Node Graph
            // docs, plus a single full-circle `arc__fill` (~1, nudged just
            // under to sidestep a known Grafana rendering bug where an arc
            // value of exactly 1.0 shows no color at all -
            // github.com/grafana/grafana/issues/54683) paired with its own
            // `arc__fill_color`. A *proportional* arc (actual %-of-node
            // fraction, e.g. 0.02 for a 2% pod) was tried first and made
            // every node render as a barely-visible sliver, only really
            // showing up once a hover highlight enlarged it - the arc__
            // mechanism is meant for a ring, not a fill level. A constant
            // near-1 arc makes the whole circle solid instead.
            stringField('color', nodeRows.map((r) => r.color)),
            numberField('arc__fill', nodeRows.map(() => 0.999)),
            stringField('arc__fill_color', nodeRows.map((r) => r.color)),
            stringField('detail__Type', nodeRows.map((r) => r.detailType)),
            stringField('detail__Namespace', nodeRows.map((r) => r.detailNamespace)),
            stringField('detail__Workload', nodeRows.map((r) => r.detailWorkload)),
            stringField('detail__CPU_usage', nodeRows.map((r) => r.detailCpuUsage)),
            stringField('detail__Node_share', nodeRows.map((r) => r.detailNodeShare)),
            // Not shown by the panel itself (Node Graph only renders the
            // field names above) - carried purely so the "id" field's own
            // link overrides below can interpolate `${__data.fields.X}` per
            // row, same mechanism as every other per-row table link in this
            // app (e.g. the Overview tab's own Pods table).
            stringField('namespace', nodeRows.map((r) => r.namespace)),
            stringField('workload', nodeRows.map((r) => r.workload)),
            stringField('workload_type', nodeRows.map((r) => r.workloadType)),
            stringField('pod', nodeRows.map((r) => r.pod)),
          ],
        };

        const edgesFrame: DataFrame = {
          name: 'edges',
          refId: 'edges',
          length: edgeRows.length,
          fields: [
            stringField('id', edgeRows.map((r) => r.id)),
            stringField('source', edgeRows.map((r) => r.source)),
            stringField('target', edgeRows.map((r) => r.target)),
            stringField('color', edgeRows.map((r) => r.color)),
            numberField('thickness', edgeRows.map((r) => r.thickness)),
            stringField('strokeDasharray', edgeRows.map((r) => r.strokeDasharray)),
          ],
        };

        return [nodesFrame, edgesFrame];
      })
    );
}

function DependenciesLegend() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, alignItems: 'center', padding: '4px 0', opacity: 0.7 }}>
      <span>Pod color = share of this node&apos;s CPU capacity:</span>
      <span style={{ color: 'green' }}>low</span>
      <span style={{ color: 'orange' }}>moderate</span>
      <span style={{ color: 'red' }}>dominates the node</span>
    </div>
  );
}

export function getNodeDependenciesScene(cluster: string, node: string, clusterRegex: string, nodeRegex: string) {
  const substitutePod = (expr: string) => substituteClusterNodeAndPod(expr, clusterRegex, nodeRegex);
  const substituteNode = (expr: string) => substituteClusterAndNode(expr, clusterRegex, nodeRegex);

  const graphRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'podsInfo', expr: substitutePod(nodePodsTableQueries.info), format: 'table', instant: true },
      { refId: 'podsCpuUsage', expr: substitutePod(nodePodsTableQueries.cpu_usage), format: 'table', instant: true },
      { refId: 'nodeCapacity', expr: substituteNode(nodeCpuOptimizationQueries.cpuCapacity), format: 'table', instant: true },
      { refId: 'nodeInfo', expr: buildNodeInfoQuery(clusterRegex, node), format: 'table', instant: true },
      { refId: 'vcfInfo', expr: buildNodeVcfInfoQuery(node), format: 'table', instant: true },
    ],
  });

  const graphData = new SceneDataTransformer({
    $data: graphRunner,
    transformations: [buildDependencyGraphFrames(cluster, node)],
  });

  // Field overrides live on the "id" field (present/unique on every row,
  // same field the wider Grafana community uses for this - see the node
  // graph's own docs on data links) rather than "pod" directly, since "id"
  // is prefixed uniquely per node kind (pod:/node:/esxi:/...) while "pod" is
  // blank for non-pod rows. Known rough edge: because Node Graph's own
  // link config is per-*field*, not per-row-kind, the This-Node/ESXi/VCF
  // Cluster/vCenter rows will also carry these 3 menu entries - just with
  // blank namespace/workload/pod segments, since only pod rows populate
  // them. Nothing to click through to there in practice, so left as a
  // cosmetic follow-up rather than blocking this feature on it.
  const nodeGraphPanel = PanelBuilders.nodegraph()
    .setTitle('Dependencies')
    .setDescription(
      'The physical vSphere chain this node runs on - vCenter, VCF cluster, ESXi host (left) - and the pods scheduled on it, heaviest CPU share first (right).'
    )
    .setData(graphData)
    .setNoValue('No dependency data for this node.')
    // "Layered" (not the "force" physics-simulation default) ranks nodes into
    // columns by directed distance from a root instead of letting them settle
    // wherever a physics simulation happens to push them - with 30-40 pods on
    // a real node, force layout turns into an unreadable, constantly-jiggling
    // ball. Layered turns the same data into a predictable vCenter/VCF
    // cluster/ESXi host -> node -> pods left-to-right flow instead (see the
    // reversed vSphere-chain edge directions in buildDependencyGraphFrames
    // above - layered layout takes its column order from edge direction).
    // Grafana's own docs flag layered as slow past ~500 nodes and recommend
    // force beyond that, well above what a single node's own pod count would
    // ever reach here.
    .setOption('layoutAlgorithm', LayoutAlgorithm.Layered)
    .setOverrides((b) =>
      b.matchFieldsWithName('id').overrideLinks([
        {
          title: 'View namespace',
          url: `${NAMESPACES_URL}/${encodeURIComponent(cluster)}/\${__data.fields.namespace}\${__url.params}`,
        },
        {
          title: 'View workload',
          url: `${WORKLOADS_URL}/${encodeURIComponent(cluster)}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__data.fields.workload}\${__url.params}`,
        },
        {
          title: 'View pod',
          url: `${WORKLOADS_URL}/${encodeURIComponent(cluster)}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__data.fields.workload}/pods/\${__data.fields.pod}\${__url.params}`,
        },
      ])
    )
    .build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Dependencies" /> }),
        }),
        new SceneFlexItem({ ySizing: 'content', body: new SceneReactObject({ reactNode: <DependenciesLegend /> }) }),
        // Taller than this app's usual panel height (600) - the layered
        // layout stacks every one of a node's pods into one column, and a
        // real node here runs 30-40 of them.
        new SceneFlexItem({ height: 900, body: nodeGraphPanel }),
      ],
    }),
  });
}
