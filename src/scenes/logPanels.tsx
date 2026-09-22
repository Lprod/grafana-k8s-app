import React, { useState } from 'react';
import { EmbeddedScene, PanelBuilders, SceneFlexItem, SceneFlexLayout, SceneQueryRunner, SceneReactObject } from '@grafana/scenes';
import { LOGS_DATASOURCE_VARIABLE_NAME } from '../variables/datasourceVariables';
import { attachExploreMenus } from './panelExplore';
import { LogsSortOrder } from '@grafana/schema';
import { InlineSwitch } from '@grafana/ui';

// Shared "only warn/error" toggle for a dedicated Logs/Events tab's single
// Log panel - simpler than the Overview tab's LogsEventsLevelToggle
// (logsEventsLevelToggle.tsx): a Log panel needs no date_histogram interval
// (it lists individual documents, not per-bucket counts), so there's no
// live-time-range effect to run here, just a straight query-string swap on
// toggle. `buildQuery` (rather than a hardcoded cluster/namespace) is what
// lets both the Namespace Drilldown's and Workload Drilldown's Logs/Events
// tabs share this one component.
export function LogsTabLevelToggle({ runner, buildQuery }: { runner: SceneQueryRunner; buildQuery: (onlyWarnError: boolean) => string }) {
  const [onlyWarnError, setOnlyWarnError] = useState(false);

  const toggle = (checked: boolean) => {
    setOnlyWarnError(checked);
    runner.setState({ queries: [{ refId: 'logs', query: buildQuery(checked), metrics: [{ id: '1', type: 'logs' }], bucketAggs: [] }] as any });
    runner.runQueries();
  };

  return (
    <InlineSwitch transparent showLabel label="Only warn/error" value={onlyWarnError} onChange={(e) => toggle(e.currentTarget.checked)} />
  );
}

export function buildLogPanel(title: string, runner: SceneQueryRunner) {
  return PanelBuilders.logs()
    .setTitle(title)
    .setData(runner)
    .setOption('sortOrder', LogsSortOrder.Descending)
    .setOption('showTime', true)
    .setOption('wrapLogMessage', true)
    .build();
}

// A whole dedicated Logs or Events tab: one raw-log-line Log panel against
// the page's logs datasource variable, with the "Only warn/error" toggle
// above it. The Namespace/Workload/Pod Drilldowns each still build this same
// shape by hand (getPodLogsScene etc.); the Node/CronJob/Job Drilldowns'
// tabs - the last ones that were "coming soon" placeholders - use this
// instead of copying it a fourth, fifth and sixth time.
export function getRawLogsTabScene(title: 'Logs' | 'Events', buildQuery: (onlyWarnError: boolean) => string) {
  const runner = new SceneQueryRunner({
    datasource: { uid: `\${${LOGS_DATASOURCE_VARIABLE_NAME}}` },
    queries: [{ refId: 'logs', query: buildQuery(false), metrics: [{ id: '1', type: 'logs' }], bucketAggs: [] }] as any,
  });

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <LogsTabLevelToggle runner={runner} buildQuery={buildQuery} /> }),
        }),
        new SceneFlexItem({ body: buildLogPanel(title, runner) }),
      ],
    }),
  });
}
