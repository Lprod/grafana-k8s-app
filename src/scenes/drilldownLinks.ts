import { FieldConfigOverridesBuilder } from '@grafana/scenes';
import { PLUGIN_BASE_URL, ROUTES } from '../constants';

const CLUSTERS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Clusters}`;
const NODES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Nodes}`;
const NAMESPACES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Namespaces}`;
const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;

/**
 * Adds this app's standard Drilldown links to whichever of the
 * `cluster`/`node`/`namespace`/`workload`/`pod` columns a table actually has.
 *
 * Matched on the *raw* Prometheus label names, not on a column's displayed
 * header: `organize`'s `renameByName` only sets `field.config.displayName`,
 * while `matchFieldsWithName` checks `field.name` first, so a table that
 * renames `pod` to `POD` still matches here. A `matchFieldsWithName` for a
 * column the current query doesn't return is simply a no-op, which is what
 * makes one shared override set safe for tables whose label sets differ
 * per row-source (the Kubernetes home page's 12 swapped-in issue queries,
 * the Alerts table's mix of node-, pod- and cluster-scoped alerts).
 *
 * The Pod Drilldown's route is nested under its owning workload
 * (/workloads/:cluster/:namespace/:workloadType/:workload/pods/:pod), so a
 * `pod` column only gets a *working* link when the same frame also carries
 * `workload`/`workload_type`. Tables whose query doesn't join those on
 * (see `namespace_workload_pod:kube_pod_owner:relabel`, plus the bare-pod
 * `label_replace` fallback for pods with no ownership record) will render a
 * link with empty path segments - join them in rather than relying on this
 * helper to paper over it.
 */
export function applyEntityDrilldownLinks(b: FieldConfigOverridesBuilder<any>) {
  return b
    .matchFieldsWithName('cluster')
    .overrideLinks([{ title: 'View cluster', url: `${CLUSTERS_URL}/\${__value.text}\${__url.params}` }])
    .matchFieldsWithName('node')
    .overrideLinks([{ title: 'View node', url: `${NODES_URL}/\${__data.fields.cluster}/\${__value.text}\${__url.params}` }])
    .matchFieldsWithName('namespace')
    .overrideLinks([
      { title: 'View namespace', url: `${NAMESPACES_URL}/\${__data.fields.cluster}/\${__value.text}\${__url.params}` },
    ])
    .matchFieldsWithName('workload')
    .overrideLinks([
      {
        title: 'View workload',
        url: `${WORKLOADS_URL}/\${__data.fields.cluster}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__value.text}\${__url.params}`,
      },
    ])
    // A `deployment` column (the Kubernetes home page's "Zero replica
    // deployments" issue query returns one, with no workload/workload_type
    // labels of its own) is a workload whose type is known outright, so the
    // type segment is a literal here rather than a field macro.
    .matchFieldsWithName('deployment')
    .overrideLinks([
      {
        title: 'View workload',
        url: `${WORKLOADS_URL}/\${__data.fields.cluster}/\${__data.fields.namespace}/deployment/\${__value.text}\${__url.params}`,
      },
    ])
    .matchFieldsWithName('pod')
    .overrideLinks([
      {
        title: 'View pod',
        url: `${WORKLOADS_URL}/\${__data.fields.cluster}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__data.fields.workload}/pods/\${__value.text}\${__url.params}`,
      },
    ]);
}
