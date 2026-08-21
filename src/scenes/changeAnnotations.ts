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
// Both expressions follow the shape Grafana's own Prometheus-annotations
// documentation prescribes ("Service restart annotations" / "Scaling event
// annotations"): a `changes(...) > 0` range query, so a data point - and
// therefore an annotation - only exists at the instant the underlying value
// actually moved. A plain gauge like `kube_deployment_created` would instead
// produce one annotation per step interval across the whole window.
//
// NOTE for anyone testing this against the local demo stack: it will show
// nothing there, and that is expected, not a bug. `demo/kube-metrics/metrics`
// is a static file served by nginx, so no counter in it ever changes and
// `changes(...)` is always 0 - the same documented limitation that already
// makes the Kubernetes home page's "Restarting containers" panel and the
// Network/Storage tabs' `rate()`-based panels read zero.

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

function annotationLayer(name: string, iconColor: string, expr: string, textField: string) {
  return new dataLayers.AnnotationsDataLayer({
    name,
    query: {
      name,
      enable: true,
      hide: false,
      iconColor,
      datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
      // `expr` isn't part of the base DataQuery type - AnnotationQuery's
      // `target` is generic over it, and the Prometheus datasource's own
      // PromQuery shape isn't re-exported from any @grafana/* package this
      // plugin depends on, so the cast is the only way to name the field.
      target: { refId: name, expr } as AnnotationQuery['target'],
      // Field mappings, not the legacy titleFormat/textFormat pair - the
      // annotation tooltip should name the specific pod/workload the marker
      // belongs to rather than repeating the layer's own name.
      mappings: { text: { source: AnnotationEventFieldSource.Field, value: textField } },
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

  const generationMetric = scope.workloadType ? GENERATION_METRIC[scope.workloadType] : undefined;
  if (generationMetric && scope.workload) {
    const selector = `${generationMetric}{${base}, ${scope.workloadType}="${escapeLabelValue(scope.workload)}"}`;
    layers.push(annotationLayer('Rollouts', 'green', `changes(${selector}[$__rate_interval]) > 0`, scope.workloadType!));
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
    layers.push(annotationLayer('Container restarts', 'red', `changes(${selector}[$__rate_interval]) > 0`, 'container'));
  }

  // The set's own `name` is what SceneDataLayerControls labels the toggle
  // group with (it defaults to a generic "Data layers"). Scenes renders one
  // *unlabelled* InlineSwitch per layer under that single shared label -
  // there is no per-layer label in AnnotationsDataLayerRenderer - so the name
  // spells out the layers in the order their switches appear.
  return layers.length > 0 ? new SceneDataLayerSet({ name: layers.map((l) => l.state.name).join(' / '), layers }) : undefined;
}
