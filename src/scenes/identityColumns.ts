import { VizPanel } from '@grafana/scenes';

// Minimum widths for the columns that say *which* object a row is about.
//
// The Table panel gives every column the same share of the width. With ten
// or so columns at 1600px that is roughly 150px each - enough for "0.42
// cores", not for a name: every row of the Nodes table read
// "demo-cluster-aws-nc", and real node, pod and job names are longer still
// and share even longer prefixes. A table whose rows cannot be told apart is
// not usable, whatever else it shows. These columns therefore get a floor;
// the table scrolls sideways a little sooner instead.
//
// Matched on the raw Prometheus label, like applyEntityDrilldownLinks - a
// column a table does not have is simply not matched.
const IDENTITY_COLUMN_MIN_WIDTH: Record<string, number> = {
  node: 260,
  pod: 260,
  job_name: 240,
  alertname: 240,
  workload: 220,
  deployment: 220,
  cronjob: 200,
  cluster: 190,
  namespace: 170,
};

// Called for every table panel from attachExploreMenus. Prepended, so a
// table's own overrides for the same column (an explicit width, say) win.
export function addIdentityColumnWidths(panel: VizPanel) {
  const { fieldConfig } = panel.state;
  const overrides = Object.entries(IDENTITY_COLUMN_MIN_WIDTH).map(([name, minWidth]) => ({
    matcher: { id: 'byName', options: name },
    properties: [{ id: 'custom.minWidth', value: minWidth }],
  }));
  panel.setState({ fieldConfig: { ...fieldConfig, overrides: [...overrides, ...fieldConfig.overrides] } });
}
