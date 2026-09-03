import React from 'react';
import { DataFrame, Field, FieldColorModeId, FieldType } from '@grafana/data';
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
  buildNodeConditionQuery,
  buildNodeInfoQuery,
  buildNodeVcfInfoQuery,
  buildPodReadyQuery,
  nodeCpuOptimizationQueries,
  nodeMemoryOptimizationQueries,
  nodePodsTableQueries,
  substituteClusterNodeAndPod,
} from '../../queries/nodeOverviewQueries';
import { substituteClusterAndNode } from '../../queries/nodeQueries';
import { THANOS_VARIABLE_NAME } from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';
import { SectionHeading } from '../../scenes/sectionHeading';

const NAMESPACES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Namespaces}`;
const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;

// Edges stay a plain neutral color - see the pod-edge/infra-edge
// construction below for what carries the real signal instead.
const EDGE_COLOR = '#999';

// Distinct per-hop colors for the vSphere chain, deliberately *not* using
// orange/green/red (those are reserved for the CPU/Mem usage-tier rings
// below) - there's no metric to color these by (no per-ESXi-host/VCF-cluster
// usage data in this app), so this is a plain categorical distinction rather
// than a data-driven one, replacing the earlier "everything is the same
// flat blue" look.
const ESXI_COLOR = '#5794F2';
const VCF_CLUSTER_COLOR = '#8F3BB8';
const VCENTER_COLOR = '#1F60C4';

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

function numberField(name: string, values: Array<number | null>, unit?: string, decimals?: number): Field {
  return { name, type: FieldType.number, config: { unit, decimals }, values };
}

function boolField(name: string, values: boolean[]): Field {
  return { name, type: FieldType.boolean, config: {}, values };
}

// Node Graph's own rendering (public/app/plugins/panel/nodeGraph/Node.tsx in
// the actual Grafana source - checked directly rather than guessed, see the
// session notes) only colors an arc__* *segment* from that FIELD's own
// `config.color.fixedColor` - a single color for the entire column, not a
// per-row value. There is no per-row/threshold-driven arc coloring at all.
// To still get this app's usual 0-60% orange / 60-90% green / 90-100% red
// read (`usageThresholds` in tableCells.tsx) on a per-row basis, each metric
// gets *three* arc fields, one per tier - only the row's own actual tier
// gets a non-zero value, the other two stay 0 and are skipped entirely by
// the renderer (it filters out zero-valued sections) - so exactly one
// correctly-colored segment renders per metric, sized by the real fraction.
interface UsageBucket {
  low: number;
  med: number;
  high: number;
}

function usageBucket(fraction: number | undefined): UsageBucket {
  if (fraction === undefined || Number.isNaN(fraction)) {
    return { low: 0, med: 0, high: 0 };
  }
  const v = Math.min(Math.max(fraction, 0), 1);
  if (v >= 0.9) {
    return { low: 0, med: 0, high: v };
  }
  if (v >= 0.6) {
    return { low: 0, med: v, high: 0 };
  }
  return { low: v, med: 0, high: 0 };
}

function arcField(name: string, values: number[], fixedColor: string): Field {
  return { name, type: FieldType.number, config: { color: { mode: FieldColorModeId.Fixed, fixedColor } }, values };
}

interface GraphNodeRow {
  id: string;
  title: string;
  subtitle: string;
  cpuFraction: number | undefined;
  memFraction: number | undefined;
  color: string;
  highlighted: boolean;
  detailType: string;
  detailNamespace: string;
  detailWorkload: string;
  detailCpuUsage: string;
  detailMemUsage: string;
  detailReady: string;
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

function emptyDetailRow(id: string, title: string, subtitle: string, detailType: string, color: string): GraphNodeRow {
  return {
    id,
    title,
    subtitle,
    cpuFraction: undefined,
    memFraction: undefined,
    color,
    highlighted: false,
    detailType,
    detailNamespace: '–',
    detailWorkload: '–',
    detailCpuUsage: '–',
    detailMemUsage: '–',
    detailReady: '–',
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
        const podsMemFrame = frameByRef(frames, 'podsMemUsage');
        const podsReadyFrame = frameByRef(frames, 'podsReady');
        const nodeInfoFrame = frameByRef(frames, 'nodeInfo');
        const vcfInfoFrame = frameByRef(frames, 'vcfInfo');
        const nodeConditionFrame = frameByRef(frames, 'nodeCondition');

        const nodeCpuCapacity = singleValue(frameByRef(frames, 'nodeCapacity'));
        const nodeCpuUsage = singleValue(frameByRef(frames, 'nodeCpuUsage'));
        const nodeMemCapacity = singleValue(frameByRef(frames, 'nodeMemCapacity'));
        const nodeMemUsage = singleValue(frameByRef(frames, 'nodeMemUsage'));
        // "vcf_vcenter" is kube_node_info's own "provider" label (see
        // buildNodeVcfInfoQuery's own comment on the Overview tab) - only
        // esxhostname/clustername are a genuine vSphere lookup.
        const vcenter = singleString(nodeInfoFrame, 'provider');
        const esxHost = singleString(vcfInfoFrame, 'esxhostname');
        const vcfCluster = singleString(vcfInfoFrame, 'clustername');

        // Same "no bad-condition rows means healthy" convention as this
        // node's own Overview tab health banner (NodeHealthBanner) -
        // buildNodeConditionQuery only ever returns rows for a *bad*
        // condition, an empty result is the healthy/Ready case.
        const conditionNames = columnValues(nodeConditionFrame, 'condition') as string[];
        const nodeNotReady = conditionNames.length > 0;
        const nodeReadyDetail = nodeNotReady
          ? conditionNames.map((c) => (c === 'Ready' ? 'Not Ready' : c)).join(', ')
          : 'Ready';

        const readyPodNames = new Set((columnValues(podsReadyFrame, 'pod') as string[]).map(String));

        const cpuByPod = new Map<string, number>();
        const cpuPodNames = columnValues(podsCpuFrame, 'pod') as string[];
        const cpuValues = columnValues(podsCpuFrame, 'Value') as number[];
        cpuPodNames.forEach((podName, i) => {
          if (typeof cpuValues[i] === 'number') {
            cpuByPod.set(String(podName), cpuValues[i]);
          }
        });

        const memByPod = new Map<string, number>();
        const memPodNames = columnValues(podsMemFrame, 'pod') as string[];
        const memValues = columnValues(podsMemFrame, 'Value') as number[];
        memPodNames.forEach((podName, i) => {
          if (typeof memValues[i] === 'number') {
            memByPod.set(String(podName), memValues[i]);
          }
        });

        const podNames = columnValues(podsInfoFrame, 'pod') as string[];
        const podNamespaces = columnValues(podsInfoFrame, 'namespace') as string[];
        const podWorkloads = columnValues(podsInfoFrame, 'workload') as string[];
        const podWorkloadTypes = columnValues(podsInfoFrame, 'workload_type') as string[];

        const nodeRows: GraphNodeRow[] = [];
        const edgeRows: GraphEdgeRow[] = [];

        const nodeId = `node:${node}`;
        const nodeCpuFraction =
          nodeCpuCapacity !== undefined && nodeCpuCapacity > 0 && nodeCpuUsage !== undefined
            ? Math.min(nodeCpuUsage / nodeCpuCapacity, 1)
            : undefined;
        const nodeMemFraction =
          nodeMemCapacity !== undefined && nodeMemCapacity > 0 && nodeMemUsage !== undefined
            ? Math.min(nodeMemUsage / nodeMemCapacity, 1)
            : undefined;
        nodeRows.push({
          ...emptyDetailRow(nodeId, node, 'Kubernetes Node', 'Kubernetes Node', 'darkgrey'),
          cpuFraction: nodeCpuFraction,
          memFraction: nodeMemFraction,
          highlighted: nodeNotReady,
          detailReady: nodeReadyDetail,
          detailCpuUsage: nodeCpuFraction !== undefined ? `${Math.round(nodeCpuFraction * 100)}% CPU` : '–',
          detailMemUsage: nodeMemFraction !== undefined ? `${Math.round(nodeMemFraction * 100)}% Memory` : '–',
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
          const memUsage = memByPod.get(podName);
          const cpuFraction =
            nodeCpuCapacity !== undefined && nodeCpuCapacity > 0 && cpuUsage !== undefined
              ? Math.min(cpuUsage / nodeCpuCapacity, 1)
              : undefined;
          const memFraction =
            nodeMemCapacity !== undefined && nodeMemCapacity > 0 && memUsage !== undefined
              ? Math.min(memUsage / nodeMemCapacity, 1)
              : undefined;
          const ready = readyPodNames.has(podName);
          const podId = `pod:${podName}`;

          nodeRows.push({
            id: podId,
            title: podName,
            subtitle: namespace,
            cpuFraction,
            memFraction,
            // Fallback ring color, only ever visible if both cpu/mem
            // fractions come back 0/unknown (no arc segment to draw at
            // all) - the real signal is `highlighted` (ready state) plus
            // the arc segments built below.
            color: 'blue',
            highlighted: !ready,
            detailType: 'Pod',
            detailNamespace: namespace || '–',
            detailWorkload: workload ? `${workload} (${workloadType})` : '–',
            detailCpuUsage: cpuFraction !== undefined ? `${Math.round(cpuFraction * 100)}% of node CPU capacity` : '–',
            detailMemUsage: memFraction !== undefined ? `${Math.round(memFraction * 100)}% of node memory capacity` : '–',
            detailReady: ready ? 'Ready' : 'Not ready',
            namespace,
            workload,
            workloadType,
            pod: podName,
          });

          // Edges stay a plain neutral color - the usage/ready highlight
          // lives on the *node* circle itself, not the line connecting it,
          // per explicit follow-up ask. Thickness still scales with the
          // pod's own CPU share of the node, as a second, uncolored signal.
          edgeRows.push({
            id: `edge:node-pod:${podName}`,
            source: nodeId,
            target: podId,
            color: EDGE_COLOR,
            thickness: 1 + (cpuFraction ?? 0) * 4,
            strokeDasharray: '',
          });
        });

        // The physical vSphere chain - vCenter -> VCF cluster -> ESXi host ->
        // node - the "other direction" from the node's own pods. Edges point
        // *toward* the node (the reverse of the pod edges above, which point
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
          nodeRows.push(emptyDetailRow(esxId, esxHost, 'ESXi Host', 'ESXi Host', ESXI_COLOR));
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
          nodeRows.push(emptyDetailRow(vcfId, vcfCluster, 'VCF Cluster', 'VCF Cluster', VCF_CLUSTER_COLOR));
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
          nodeRows.push(emptyDetailRow(vcenterId, vcenter, 'vCenter', 'vCenter', VCENTER_COLOR));
          edgeRows.push({
            id: 'edge:vcenter-vcfcluster',
            source: vcenterId,
            target: chainChildId,
            color: EDGE_COLOR,
            thickness: 2,
            strokeDasharray: '4,4',
          });
        }

        const cpuBuckets = nodeRows.map((r) => usageBucket(r.cpuFraction));
        const memBuckets = nodeRows.map((r) => usageBucket(r.memFraction));

        const nodesFrame: DataFrame = {
          name: 'nodes',
          refId: 'nodes',
          length: nodeRows.length,
          fields: [
            stringField('id', nodeRows.map((r) => r.id)),
            stringField('title', nodeRows.map((r) => r.title)),
            stringField('subtitle', nodeRows.map((r) => r.subtitle)),
            numberField(
              'mainStat',
              nodeRows.map((r) => (r.cpuFraction !== undefined ? Math.round(r.cpuFraction * 100) : null)),
              '% CPU',
              0
            ),
            numberField(
              'secondaryStat',
              nodeRows.map((r) => (r.memFraction !== undefined ? Math.round(r.memFraction * 100) : null)),
              '% Mem',
              0
            ),
            // Ready/not-ready is shown via `highlighted` (a hard-coded solid
            // fill on the node's circle, not a themable color - see
            // Node.tsx's own `highlightedNodeColor`) rather than through
            // `color`, freeing the ring itself up entirely for the CPU/Mem
            // usage-tier arcs below - Node Graph can only show one or the
            // other per node (any `arc__*` field with a non-zero value
            // suppresses the plain `color` ring outright), and the user
            // explicitly asked for the *node* to reflect ready state, the
            // *values inside it* to reflect usage.
            boolField('highlighted', nodeRows.map((r) => r.highlighted)),
            // Fallback ring color for rows with no arc data at all (the
            // vSphere chain nodes, or a pod/node with genuinely 0%/unknown
            // usage on both metrics) - ignored by the renderer whenever a
            // real arc segment exists.
            stringField('color', nodeRows.map((r) => r.color)),
            // Three-bucket-per-metric trick (see usageBucket's own comment
            // above) - orange/green/red per this app's usual 60%/90% split
            // (`usageThresholds`, tableCells.tsx), CPU declared before Mem so
            // the CPU segment always starts at the top of the ring.
            arcField('arc__cpu_low', cpuBuckets.map((b) => b.low), 'orange'),
            arcField('arc__cpu_med', cpuBuckets.map((b) => b.med), 'green'),
            arcField('arc__cpu_high', cpuBuckets.map((b) => b.high), 'red'),
            arcField('arc__mem_low', memBuckets.map((b) => b.low), 'orange'),
            arcField('arc__mem_med', memBuckets.map((b) => b.med), 'green'),
            arcField('arc__mem_high', memBuckets.map((b) => b.high), 'red'),
            stringField('detail__Type', nodeRows.map((r) => r.detailType)),
            stringField('detail__Ready', nodeRows.map((r) => r.detailReady)),
            stringField('detail__Namespace', nodeRows.map((r) => r.detailNamespace)),
            stringField('detail__Workload', nodeRows.map((r) => r.detailWorkload)),
            stringField('detail__CPU_usage', nodeRows.map((r) => r.detailCpuUsage)),
            stringField('detail__Memory_usage', nodeRows.map((r) => r.detailMemUsage)),
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
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, alignItems: 'center', padding: '4px 0', opacity: 0.7, flexWrap: 'wrap' }}>
      <span>Solid red fill = not ready.</span>
      <span>Ring: CPU (top) / Memory (bottom) usage -</span>
      <span style={{ color: 'orange' }}>0-60%</span>
      <span style={{ color: 'green' }}>60-90%</span>
      <span style={{ color: 'red' }}>90-100%</span>
      <span>- exact values shown inside each node.</span>
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
      { refId: 'podsMemUsage', expr: substitutePod(nodePodsTableQueries.mem_usage), format: 'table', instant: true },
      { refId: 'podsReady', expr: buildPodReadyQuery(clusterRegex), format: 'table', instant: true },
      { refId: 'nodeCapacity', expr: substituteNode(nodeCpuOptimizationQueries.cpuCapacity), format: 'table', instant: true },
      { refId: 'nodeCpuUsage', expr: substituteNode(nodeCpuOptimizationQueries.cpuUsage), format: 'table', instant: true },
      { refId: 'nodeMemCapacity', expr: substituteNode(nodeMemoryOptimizationQueries.memCapacity), format: 'table', instant: true },
      { refId: 'nodeMemUsage', expr: substituteNode(nodeMemoryOptimizationQueries.memUsage), format: 'table', instant: true },
      { refId: 'nodeCondition', expr: buildNodeConditionQuery(clusterRegex, node), format: 'table', instant: true },
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
      'The physical vSphere chain this node runs on - vCenter, VCF cluster, ESXi host (left) - and the pods scheduled on it, heaviest CPU share first (right). Ring = CPU/Memory usage tier, solid red fill = not ready.'
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
