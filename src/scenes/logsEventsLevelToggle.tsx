import React, { useEffect, useState } from 'react';
import { rangeUtil } from '@grafana/data';
import { sceneGraph, SceneQueryRunner } from '@grafana/scenes';
import { InlineSwitch } from '@grafana/ui';

// Toggles a pair of Elasticsearch bar-chart query runners (one per-level
// Logs, one per-type Events) between their normal query set and a "warn/
// error only" variant, and keeps their date_histogram interval following the
// timepicker (floored at 1m - see buildElasticsearchLevelQuery in
// namespaceOverviewQueries.ts for why that's computed here in JS rather than
// left to the datasource). Bypasses Scenes' variable-interpolation machinery
// entirely for the toggle - CustomVariable's CSV/"label : value" option
// parser isn't a good fit for Lucene clauses full of colons and parens - so
// this just swaps each SceneQueryRunner's own `queries` state directly and
// calls `runQueries()` to force the re-fetch (setState alone doesn't trigger
// one; that only happens automatically for *variable-driven* query changes).
//
// The two `buildXQueries` callbacks (rather than baking in a fixed
// cluster/namespace pair) are what let both the Namespace Drilldown's own
// Overview tab and the Workload Drilldown's Overview tab share this one
// component - same shape as LogsTabLevelToggle's own `buildQuery` prop
// (namespacesPage.tsx) for the dedicated Logs/Events tabs.
export function LogsEventsLevelToggle({
  logsRunner,
  eventsRunner,
  buildLogsQueries,
  buildEventsQueries,
}: {
  logsRunner: SceneQueryRunner;
  eventsRunner: SceneQueryRunner;
  buildLogsQueries: (onlyWarnError: boolean, interval: string) => unknown[];
  buildEventsQueries: (onlyWarnError: boolean, interval: string) => unknown[];
}) {
  const [onlyWarnError, setOnlyWarnError] = useState(false);
  const timeRange = sceneGraph.getTimeRange(logsRunner).useState().value;

  useEffect(() => {
    // resolution 50 (not the ~100+ a timeseries panel would target): a Bar
    // Chart draws each time bucket as its own labeled category, so fewer,
    // wider buckets keep the x-axis legible at this panel's width.
    const interval = rangeUtil.calculateInterval(timeRange, 50, '1m').interval;
    logsRunner.setState({ queries: buildLogsQueries(onlyWarnError, interval) as any });
    logsRunner.runQueries();
    eventsRunner.setState({ queries: buildEventsQueries(onlyWarnError, interval) as any });
    eventsRunner.runQueries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange.from.valueOf(), timeRange.to.valueOf(), onlyWarnError]);

  return (
    <InlineSwitch
      transparent
      showLabel
      label="Only warn/error"
      value={onlyWarnError}
      onChange={(e) => setOnlyWarnError(e.currentTarget.checked)}
    />
  );
}
