import { AnnotationEventFieldSource, AnnotationQuery } from '@grafana/data';
import { dataLayers, SceneDataLayerSet } from '@grafana/scenes';
import { THANOS_VARIABLE_NAME } from '../variables/datasourceVariables';

// Deploy/restart markers, drawn as vertical annotation lines across every
// timeseries panel on a Drilldown page.
//
// Placed as the *page's* `$data` rather than each tab's: `getDataLayers`
// (@grafana/scenes) walks up from each panel's own SceneQueryRunner and
// collects any ancestor whose `$data` is a data layer, and a tab's
// EmbeddedScene's parent is the SceneAppPage - so one layer set at the page
// covers all of that page's tabs at once, with one toggle in the page
// controls instead of one per tab.
//
// Every expression here is an `increase(...) > 0` (or, for vMotion, a
// `max_over_time(...) > 1`) range query wrapped in an edge filter (see
// withEdgeFilter() below), so a data point - and therefore an annotation - only
// exists at the instant the underlying value actually moved. A plain gauge
// like `kube_deployment_created` would instead produce one annotation per
// step interval across the whole window.
//
// `increase()`, not `changes()` (confirmed live, on a real cluster): this app
// queries through Thanos, which keeps full-resolution data for only a few
// hours before compacting older ranges into downsampled 5m/1h blocks that
// store, per series, a handful of aggregates (count/sum/min/max/**counter**)
// rather than every raw sample. `changes()` has no way to read that -
// confirmed it correctly caught a restart in the last hour or so, but came
// back completely empty for one from earlier the same day, on a query that
// otherwise plots `kube_pod_container_status_restarts_total` itself
// (a plain graph, no function) rising 0->1 at the right time just fine.
// `increase()` is a different story: `counter` is exactly the aggregate
// Thanos keeps *so that* `rate()`/`increase()` stay correct across that
// compaction, since those two are the ones every Prometheus-compatible
// downsampling scheme is built to preserve.
//
// A *fixed* window (2h), not `$__rate_interval` - confirmed live that even
// `increase()` still needs a window this wide to reliably see across a
// downsampled block (consistent with Thanos's 1h-resolution blocks: a window
// narrower than ~2 downsampled points can't be sure of catching one on each
// side of the real change). `$__rate_interval` grows with the dashboard's own
// time range and was nowhere near that wide for a same-day restart - it
// isn't sized off how compacted the *data* is, only off how wide the
// *panel* is. Grafana's own Prometheus-annotations docs use a fixed window
// for exactly this kind of query (5m/10m in their examples; this one needs
// to be wider only because of the downsampling above), not `$__rate_interval`.
//
// A wide window alone isn't enough, though: annotation queries are evaluated
// at every step across the dashboard's time range, and every step whose own
// lookback still reaches the event produces its own annotation - confirmed
// live as a smear spanning the *entire* window following the real event, not
// a single line at it. An earlier version of this fixed that by also setting
// `interval` (Min step) to match the window, collapsing every one of those
// steps down to a single (coarse) one - but that meant the marker could only
// ever land on that coarse step's own grid, up to a full window-width after
// the real event (confirmed live: a vMotion at ~14:00 showed up at 15:00,
// the first hourly tick whose lookback reached it). withEdgeFilter() below is the
// better fix: it turns *any* "was this still true a moment ago" query into a
// once-only marker regardless of how fine the step is, so `interval` can go
// back to being small (for precise placement) without the smear returning.
//
// NOTE for anyone testing this against the local demo stack: it will show
// nothing there, and that is expected, not a bug. `demo/kube-metrics/metrics`
// is a static file served by nginx, so no counter in it ever changes and
// `increase(...)` is always 0 - the same documented limitation that already
// makes the Kubernetes home page's "Restarting containers" panel and the
// Network/Storage tabs' `rate()`-based panels read zero.

// Turns a filtered range expression that stays true for a while (e.g.
// `increase(x[2h]) > 0`, true at every step for the full 2h after a restart)
// into one that's true only at the *first* such step: `current unless past`
// keeps only the results with no match in `past`, so a result that was
// *already* present a step ago (i.e. not new) drops out. `past` must be the
// exact same expression as `current` but with `offset $__interval` attached
// to its own range-vector selector or subquery - not to the comparison as a
// whole, which `offset` can't attach to - which is why this takes the two
// full expressions rather than adding the offset itself: where `offset`
// belongs depends on whether the caller's selector is bare (Rollouts/
// restarts) or a subquery (vMotion). `$__interval` is Grafana's own per-step
// spacing, substituted as a literal duration - not a guess at data
// resolution like `$__rate_interval`, just "however far apart this
// dashboard's own evaluation points are," which is exactly the "one step
// back" this needs regardless of zoom level.
function withEdgeFilter(current: string, past: string): string {
  return `(${current}) unless (${past})`;
}

// kube-state-metrics bumps `metadata_generation` on every spec change, which
// is the closest thing to a "a rollout happened here" signal that exists
// without a deployment-tracking system pushing its own metric. Only these
// three kinds have one; a Job/CronJob/bare Pod has no rollout concept, and a
// ReplicaSet's own generation changes are already covered by its Deployment.
const GENERATION_METRIC: Record<string, string | undefined> = {
  deployment: 'kube_deployment_metadata_generation',
  statefulset: 'kube_statefulset_metadata_generation',
  daemonset: 'kube_daemonset_metadata_generation',
};

function escapeLabelValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export type ChangeAnnotationScope = {
  cluster: string;
  namespace: string;
  /** Omit for a page scoped to a whole workload rather than a single pod. */
  pod?: string;
  workload?: string;
  workloadType?: string;
};

// `text` is a field name to pull from the result by default (e.g. the
// container/pod/esxhostname the marker is about) - pass `textSource: Text` to
// write `text` itself as a constant string instead, for a query whose result
// has no label left to pull from (see createNodeChangeAnnotations).
//
// `interval` is the query's own Min step (see withEdgeFilter above for why
// this can now stay small/precise instead of matching the window - the smear
// that used to require a coarse interval is handled by the expression
// itself).
function annotationLayer(
  name: string,
  iconColor: string,
  expr: string,
  interval: string,
  text: string,
  textSource: AnnotationEventFieldSource = AnnotationEventFieldSource.Field
) {
  return new dataLayers.AnnotationsDataLayer({
    name,
    query: {
      name,
      enable: true,
      hide: false,
      iconColor,
      datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
      // `expr`/`interval` aren't part of the base DataQuery type -
      // AnnotationQuery's `target` is generic over it, and the Prometheus
      // datasource's own PromQuery shape isn't re-exported from any
      // @grafana/* package this plugin depends on, so the cast is the only
      // way to name the fields.
      target: { refId: name, expr, interval } as AnnotationQuery['target'],
      // Field mappings, not the legacy titleFormat/textFormat pair - the
      // annotation tooltip should name the specific pod/workload the marker
      // belongs to rather than repeating the layer's own name.
      mappings: { text: { source: textSource, value: text } },
    },
  });
}

/**
 * Builds the annotation layer set for a Workload or Pod Drilldown page.
 * Returns `undefined` when neither layer would have anything to query, so a
 * caller can leave the page's `$data` unset rather than mounting an empty
 * layer set (which would still render a toggle with nothing behind it).
 */
export function createChangeAnnotations(scope: ChangeAnnotationScope): SceneDataLayerSet | undefined {
  const cluster = escapeLabelValue(scope.cluster);
  const namespace = escapeLabelValue(scope.namespace);
  const base = `cluster="${cluster}", namespace="${namespace}"`;
  const layers: dataLayers.AnnotationsDataLayer[] = [];

  // 2h, not $__rate_interval - see the file-level comment above for why a
  // fixed, downsampling-sized window replaces it across every layer in this
  // function. `interval` (Min step) stays small/precise (5m) - it no longer
  // needs to match `window` now that withEdgeFilter() collapses the smear on
  // its own.
  const window = '2h';
  const interval = '5m';

  const generationMetric = scope.workloadType ? GENERATION_METRIC[scope.workloadType] : undefined;
  if (generationMetric && scope.workload) {
    const selector = `${generationMetric}{${base}, ${scope.workloadType}="${escapeLabelValue(scope.workload)}"}`;
    const expr = withEdgeFilter(
      `increase(${selector}[${window}]) > 0`,
      `increase(${selector}[${window}] offset $__interval) > 0`
    );
    layers.push(annotationLayer('Rollouts', 'green', expr, interval, scope.workloadType!));
  }

  // Restarts are scoped to the exact pod on a Pod Drilldown and to every pod
  // of the workload one level up. Pods are matched by regex on their own
  // name there because kube_pod_container_status_restarts_total carries no
  // workload label of its own - the pod-name prefix is how every other
  // workload-scoped query in this app narrows it too.
  const podSelector = scope.pod
    ? `pod="${escapeLabelValue(scope.pod)}"`
    : scope.workload
      ? `pod=~"${escapeLabelValue(scope.workload)}.*"`
      : undefined;
  if (podSelector) {
    const selector = `kube_pod_container_status_restarts_total{${base}, ${podSelector}}`;
    const restartsExpr = withEdgeFilter(
      `increase(${selector}[${window}]) > 0`,
      `increase(${selector}[${window}] offset $__interval) > 0`
    );
    layers.push(annotationLayer('Container restarts', 'red', restartsExpr, interval, 'container'));

    // Catches the case "Container restarts" can't: a pod that was replaced
    // outright (kubectl delete pod, a rollout, an eviction) rather than
    // crash-looping in place. kube_pod_container_status_restarts_total is
    // per-container and resets to 0 on the replacement pod, so increase()
    // never fires there - and on a Deployment/ReplicaSet the new pod usually
    // gets a new name too, so there is no single continuous series to diff a
    // value change on at all. kube_pod_status_phase sidesteps that: every new
    // pod object (whatever its name) emits its own Pending=1 sample and then
    // flips Running from 0 to 1 as it comes up, and *that* transition is a
    // change on the new pod's own series regardless of whether its name is
    // new or reused. Narrow scrape-interval races (pod reaches Running
    // between two scrapes, so kube-state-metrics only ever observes it at 1)
    // can still miss the transition - the same undercount risk the
    // restarts_total query already has for two crashes inside one interval.
    const phaseSelector = `kube_pod_status_phase{${base}, ${podSelector}, phase="Running"}`;
    const podRestartsExpr = withEdgeFilter(
      `increase(${phaseSelector}[${window}]) > 0`,
      `increase(${phaseSelector}[${window}] offset $__interval) > 0`
    );
    layers.push(annotationLayer('Pod restarts', 'orange', podRestartsExpr, interval, 'pod'));
  }

  // The set's own `name` is what SceneDataLayerControls labels the toggle
  // group with (it defaults to a generic "Data layers"). Scenes renders one
  // *unlabelled* InlineSwitch per layer under that single shared label -
  // there is no per-layer label in AnnotationsDataLayerRenderer - so the name
  // spells out the layers in the order their switches appear.
  return layers.length > 0 ? new SceneDataLayerSet({ name: layers.map((l) => l.state.name).join(' / '), layers }) : undefined;
}

export type NodeAnnotationScope = {
  node: string;
};

// vMotion markers for the Node Drilldown. A node's underlying VM can be
// live-migrated to a different ESXi host with nothing Kubernetes-visible
// happening - no reboot, no pod eviction, nothing in kube-state-metrics -
// so vsphere_vm_mem_memorySizeMB{vmname=$node} (confirmed against a live
// cluster: vmname is the node's own name, same identity buildNodeVcfInfoQuery
// already relies on, and this metric carries no k8s "cluster" label at all)
// is the only place it shows up.
//
// `count by (esxhostname) (...)` normally has exactly one group - the node
// lives on one host at a time - so the outer `count(...)` collapsing that
// down to a single label-less series is normally 1. During the live
// migration itself the VM briefly reports under both the source and
// destination esxhostname, so the count reads 2 for that instant before
// dropping back to 1 (confirmed live: this lasted under 3 minutes for a real
// migration) - unlike a plain "series A stops, series B starts" diff, this is
// a real value change on one continuous series, so there's something here
// for a range function to actually catch.
//
// Not `increase()` like the layers above, though, despite this also being a
// Thanos-backed query with the exact same downsampling exposure - this
// signal goes back down (1 -> 2 -> 1) within the same window, and increase()
// only looks at the *net* change between the window's first and last value,
// which would just cancel back out to ~0 and miss it entirely. max_over_time
// asks a weaker, better-fitting question instead - "did this ever reach 2?" -
// answerable from a single sample rather than needing to catch a transition,
// and one of the aggregates (min/max/sum/count/counter) Thanos's downsampling
// keeps per series. There's still a real ceiling on an already-downsampled
// window, though: `count by (esxhostname)` is computed query-time from two
// *separate* underlying esxhostname-labeled series, each downsampled
// independently - if the block boundaries Thanos happened to compact them
// into don't land on the same bucket, the co-occurrence this whole query
// depends on was never preserved anywhere for any function to recover
// afterwards.
//
// Not `$__rate_interval` for the outer window either, same reasoning as the
// layers above - it isn't sized off the data's own resolution - and wrapped
// in the same withEdgeFilter() for the same reason: confirmed live as a
// smear spanning the entire lookback window after the real migration
// (specifically, a marker on *every* hourly tick for the whole hour
// following it) before the edge filter was added.
export function createNodeChangeAnnotations(scope: NodeAnnotationScope): SceneDataLayerSet {
  const node = escapeLabelValue(scope.node);
  // A subquery ([range:resolution]), not a plain range selector like the
  // other layers use - `count(...)` is itself an aggregation, not a bare
  // metric selector, and only a bare selector can take a direct [range]; an
  // arbitrary expression needs the subquery form to be sampled over a range
  // at all. Resolution is explicit, not left empty (an *empty* resolution
  // defaults to Prometheus's global `evaluation_interval` server setting,
  // unrelated to how often vsphere/telegraf actually scrapes) - and 5m, not
  // 1m: confirmed live in Explore that a step finer than the real vSphere
  // scrape interval (~5m) doesn't resample more data, it just risks landing
  // every resampled point *between* two real samples instead of on one - a
  // real vMotion's overlap only showed up once the step was widened to
  // actually match the data's own resolution.
  const window = '1h';
  const inner = `count(count by (esxhostname) (vsphere_vm_mem_memorySizeMB{vmname="${node}"}))`;
  // offset attaches to the subquery bracket itself (shifting its whole
  // reference point back by one step), not to the comparison - see
  // withEdgeFilter's own comment for why that placement is load-bearing.
  const expr = withEdgeFilter(
    `max_over_time(${inner}[${window}:5m]) > 1`,
    `max_over_time(${inner}[${window}:5m] offset $__interval) > 1`
  );
  const layer = annotationLayer('vMotion', 'purple', expr, '5m', 'vMotion', AnnotationEventFieldSource.Text);
  return new SceneDataLayerSet({ name: layer.state.name, layers: [layer] });
}
