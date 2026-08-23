import React from 'react';
import { FieldColorModeId, GrafanaTheme2, MappingType, SpecialValueMatch, ValueMapping } from '@grafana/data';
import { LegendDisplayMode, TableCellDisplayMode } from '@grafana/schema';
import { Alert, Badge, CustomCellRendererProps, useTheme2 } from '@grafana/ui';
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
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { CronjobTableQueryKey, cronjobTableQueries, jobTableQueries, substituteJobsClusterNamespace } from '../../queries/jobsQueries';
import {
  buildCronjobCreatedQuery,
  buildCronjobInfoQuery,
  buildCronjobLastScheduleQuery,
  buildCronjobNextScheduleQuery,
  buildCronjobStatusQuery,
  cronjobCpuOptimizationQueries,
  cronjobMemoryOptimizationQueries,
  cronjobRunsTableQueries,
  substituteCronjobResourceQuery,
  substituteCronjobRunsQuery,
  CronjobCpuOptimizationKey,
  CronjobMemoryOptimizationKey,
  CronjobRunsTableQueryKey,
} from '../../queries/cronjobOverviewQueries';
import { attachFieldValues } from '../../scenes/tableCells';
import { InfoCard, findFieldAcrossFrames } from '../../scenes/clusterOverviewCards';
import { SectionHeading } from '../../scenes/sectionHeading';
import { InvestigateEntityButton } from '../../scenes/investigateEntityButton';
import { PanelTimeRangeCompare } from '../../scenes/panelTimeRangeCompare';
import {
  CLUSTER_VARIABLE_NAME,
  NAMESPACE_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createClusterFilterVariable,
  createNamespaceFilterVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';
import { getCronjobCpuScene } from './cronjobCpuScene';
import { getCronjobMemoryScene } from './cronjobMemoryScene';

const JOBS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Jobs}`;
const CLUSTERS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Clusters}`;
const NAMESPACES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Namespaces}`;
const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

// "PODS/COMPLETION" (Jobs tab) - plain colored "succeeded / completions"
// text, colored by job status (complete/running/failed) rather than the
// Workloads page's ready-vs-desired scale, matching Grafana Play's own
// Jobs table. completionValues/failedValues are stashed onto the "success"
// field's own config via attachFieldValues (same mechanism as
// attachDesiredPodsField/attachPercentField in tableCells.tsx, just with
// two separate keys instead of one).
function jobPodsCompletionCell() {
  return function JobPodsCompletionCell({ rowIndex, field, value }: CustomCellRendererProps) {
    const theme = useTheme2();
    const success = typeof value === 'number' ? value : Number(value ?? 0);
    const completionValues = field.config?.custom?.completionValues as Array<number | null | undefined> | undefined;
    const failedValues = field.config?.custom?.failedValues as Array<number | null | undefined> | undefined;
    const completion = (completionValues?.[rowIndex] as number | undefined) ?? 0;
    const failed = (failedValues?.[rowIndex] as number | undefined) ?? 0;
    const color =
      failed > 0
        ? theme.visualization.getColorByName('red')
        : completion > 0 && success >= completion
          ? theme.visualization.getColorByName('green')
          : theme.visualization.getColorByName('orange');

    return <span style={{ color }}>{success} / {completion}</span>;
  };
}

// Explains PODS/COMPLETION's coloring above the Jobs table - same
// right-aligned "label: colored words" layout as the Namespaces list page's
// own ResourceUsageLegend (namespacesPage.tsx).
function JobStatusLegend() {
  const theme = useTheme2();
  const items: Array<{ label: string; colorName: string }> = [
    { label: 'complete', colorName: 'green' },
    { label: 'running', colorName: 'orange' },
    { label: 'failed', colorName: 'red' },
  ];
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, alignItems: 'center', padding: '4px 0' }}>
      <span style={{ opacity: 0.7 }}>Job status:</span>
      {items.map((item) => (
        <span key={item.label} style={{ color: theme.visualization.getColorByName(item.colorName) }}>
          {item.label}
        </span>
      ))}
    </div>
  );
}

// kube_cronjob_spec_suspend is 0/1 (not suspended/suspended) - mapped to the
// same colored-text-on-background treatment as alertsPage.ts's own
// severityMappings, rather than a bespoke cell component.
const cronjobStatusMappings: ValueMapping[] = [
  {
    type: MappingType.ValueToText,
    options: {
      '0': { text: 'Active', color: 'green', index: 0 },
      '1': { text: 'Suspended', color: 'orange', index: 1 },
    },
  },
];

function getCronjobsScene(clusterRegex: string, namespaceRegex: string) {
  const substitute = (expr: string) => substituteJobsClusterNamespace(expr, clusterRegex, namespaceRegex);

  const tableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(cronjobTableQueries) as CronjobTableQueryKey[]).map((key) => ({
      refId: key,
      expr: substitute(cronjobTableQueries[key]),
      format: 'table',
      instant: true,
    })),
  });

  // "exists" is the only query that also groups by `schedule` - the other
  // four only share (cluster, namespace, cronjob, join_name), which is what
  // `merge` actually aligns rows on (see namespacesPage.tsx's own comment on
  // `merge` vs `joinByField` for a composite, non-single-field identity).
  // "Value #exists" itself carries no meaningful value (kube_cronjob_info is
  // just a presence signal) - dropped below along with join_name.
  const tableData = new SceneDataTransformer({
    $data: tableRunner,
    transformations: [
      { id: 'merge', options: {} },
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, join_name: true, 'Value #exists': true },
          indexByName: {
            cronjob: 0,
            cluster: 1,
            namespace: 2,
            schedule: 3,
            'Value #last_success': 4,
            'Value #last_schedule': 5,
            'Value #next_schedule': 6,
            'Value #status': 7,
          },
          renameByName: {
            cronjob: 'CRONJOB (CONTROLLER)',
            cluster: 'CLUSTER',
            namespace: 'NAMESPACE',
            schedule: 'SCHEDULE',
            'Value #last_success': 'LAST SUCCEEDED',
            'Value #last_schedule': 'LAST SCHEDULE',
            'Value #next_schedule': 'NEXT SCHEDULE',
            'Value #status': 'STATUS',
          },
        },
      },
    ],
  });

  const table = PanelBuilders.table()
    .setTitle('Cronjobs')
    .setData(tableData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('CRONJOB (CONTROLLER)')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([
          {
            title: 'View cronjob',
            url: `${JOBS_URL}/cronjob/\${__data.fields.cluster}/\${__data.fields.namespace}/\${__value.text}\${__url.params}`,
          },
        ])
        .matchFieldsWithName('CLUSTER')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([{ title: 'View cluster', url: `${CLUSTERS_URL}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('NAMESPACE')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([{ title: 'View namespace', url: `${NAMESPACES_URL}/\${__data.fields.cluster}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('SCHEDULE')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('LAST SUCCEEDED')
        .overrideUnit('dateTimeFromNow')
        .matchFieldsWithName('LAST SCHEDULE')
        .overrideUnit('dateTimeFromNow')
        .matchFieldsWithName('NEXT SCHEDULE')
        .overrideUnit('dateTimeFromNow')
        .matchFieldsWithName('STATUS')
        .overrideMappings(cronjobStatusMappings)
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.ColorText })
    )
    .build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    body: new SceneFlexLayout({ direction: 'column', children: [new SceneFlexItem({ body: table })] }),
  });
}

function getJobsScene(clusterRegex: string, namespaceRegex: string) {
  const substitute = (expr: string) => substituteJobsClusterNamespace(expr, clusterRegex, namespaceRegex);

  const tableRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'start', expr: substitute(jobTableQueries.start), format: 'table', instant: true },
      { refId: 'end_time', expr: substitute(jobTableQueries.end_time), format: 'table', instant: true },
      { refId: 'success', expr: substitute(jobTableQueries.success), format: 'table', instant: true },
      { refId: 'completion', expr: substitute(jobTableQueries.completion), format: 'table', instant: true },
      { refId: 'failed', expr: substitute(jobTableQueries.failed), format: 'table', instant: true },
    ],
  });

  // "success" is the only query that also carries owner_name/owner_kind
  // (CONTROLLED-BY/TYPE) - the other three only share (cluster, namespace,
  // job_name, join_name), same "merge aligns on the fields that ARE shared,
  // not every field" reasoning as the Cronjobs table above.
  const tableData = new SceneDataTransformer({
    $data: tableRunner,
    transformations: [
      { id: 'merge', options: {} },
      {
        id: 'calculateField',
        options: {
          mode: 'binary',
          binary: { left: 'Value #end_time', operator: '-', right: 'Value #start' },
          alias: 'DURATION',
          replaceFields: false,
        },
      },
      // completion/failed counts stashed onto the "success" field's own
      // config (see jobPodsCompletionCell above) instead of a ready/desired
      // bar - both raw fields get excludeByName'd below, same
      // attach-then-exclude pattern as attachPercentField/attachDesiredPodsField.
      attachFieldValues('Value #success', 'Value #completion', 'completionValues'),
      attachFieldValues('Value #success', 'Value #failed', 'failedValues'),
      {
        id: 'organize',
        options: {
          excludeByName: { Time: true, join_name: true, 'Value #completion': true, 'Value #failed': true },
          indexByName: {
            job_name: 0,
            owner_name: 1,
            cluster: 2,
            namespace: 3,
            owner_kind: 4,
            'Value #start': 5,
            'Value #end_time': 6,
            DURATION: 7,
            'Value #success': 8,
          },
          renameByName: {
            job_name: 'JOB',
            owner_name: 'CONTROLLED-BY',
            cluster: 'CLUSTER',
            namespace: 'NAMESPACE',
            owner_kind: 'TYPE',
            'Value #start': 'START',
            'Value #end_time': 'END',
            'Value #success': 'PODS/COMPLETION',
          },
        },
      },
    ],
  });

  const table = PanelBuilders.table()
    .setTitle('Jobs')
    .setData(tableData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('JOB')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('CONTROLLED-BY')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('CLUSTER')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([{ title: 'View cluster', url: `${CLUSTERS_URL}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('NAMESPACE')
        .overrideCustomFieldConfig('align', 'left')
        .overrideLinks([{ title: 'View namespace', url: `${NAMESPACES_URL}/\${__data.fields.cluster}/\${__value.text}\${__url.params}` }])
        .matchFieldsWithName('TYPE')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('START')
        .overrideUnit('dateTimeFromNow')
        .matchFieldsWithName('END')
        .overrideUnit('dateTimeFromNow')
        .matchFieldsWithName('DURATION')
        .overrideUnit('dtdurationms')
        .matchFieldsWithName('PODS/COMPLETION')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.Custom, cellComponent: jobPodsCompletionCell() } as any)
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
            new SceneFlexItem({ xSizing: 'content', ySizing: 'content', body: new SceneReactObject({ reactNode: <JobStatusLegend /> }) }),
          ],
        }),
        new SceneFlexItem({ body: table }),
      ],
    }),
  });
}

// kube_cronjob_spec_suspend is 0/1 - same value the Cronjobs table's own
// STATUS column maps via cronjobStatusMappings above, reused here as a
// plain color function since InfoCard rows render text + color separately
// rather than through a table cell's value-mapping/cellOptions mechanism.
function cronjobStatusColor(value: number | undefined, theme: GrafanaTheme2): string | undefined {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return undefined;
  }
  return value === 0 ? theme.visualization.getColorByName('green') : theme.visualization.getColorByName('orange');
}

function cronjobStatusLabel(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '–';
  }
  return value === 0 ? 'Active' : 'Suspended';
}

function CronjobPageTitle({ title, cluster }: { title: string; cluster: string }) {
  const theme = useTheme2();
  const clusterUrl = `${CLUSTERS_URL}/${encodeURIComponent(cluster)}`;
  return (
    <div>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
        {title}
        <Badge text="cronjob" color="brand" />
        <InvestigateEntityButton kind="cronjob" name={title} cluster={cluster} />
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

// "Cronjob optimization" panels - same limits(red dashed)/requests(orange
// dashed)/allocation(green finely-dashed)/usage(blue solid) styling as the
// Pod/Workload/Namespace Drilldowns' own "optimization" panels (no
// "capacity" line - a CronJob's pods have no resourcequota-style physical
// ceiling of their own, same reasoning as those pages) - redeclared locally
// per this codebase's established "every tab file redeclares its own small
// style helpers" convention (see applyPodOptimizationSeriesOverrides in
// podsPage.tsx).
function applyCronjobOptimizationSeriesOverrides(b: FieldConfigOverridesBuilder<any>) {
  return b
    .matchFieldsByQuery('limits')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'red' })
    .overrideCustomFieldConfig('lineStyle', { fill: 'dash' })
    .matchFieldsByQuery('requests')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'orange' })
    .overrideCustomFieldConfig('lineStyle', { fill: 'dash' })
    .matchFieldsByQuery('allocation')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'green' })
    .overrideCustomFieldConfig('lineStyle', { fill: 'dash', dash: [2, 3] })
    .matchFieldsByQuery('usage')
    .overrideColor({ mode: FieldColorModeId.Fixed, fixedColor: 'blue' });
}

// DURATION is `Value #end_time - Value #start` (calculateField, see runsData
// below) - a still-running job has no end_time yet, so this evaluates to
// NaN. Mapped to a plain dash instead of Grafana's default literal "NaN"
// text, same idea as cronjobStatusMappings above.
const durationMappings: ValueMapping[] = [
  { type: MappingType.SpecialValue, options: { match: SpecialValueMatch.NullAndNaN, result: { text: '–' } } },
];

// "Runs" table's PODS/COMPLETION cell - same success/completion/failed-count
// logic as jobPodsCompletionCell above (the All Jobs page's own Jobs tab),
// just with "running" colored yellow instead of orange - an explicit,
// page-specific choice for this table's own legend, not a change to the All
// Jobs page's existing green/orange/red convention.
function cronjobRunsPodsCompletionCell() {
  return function CronjobRunsPodsCompletionCell({ rowIndex, field, value }: CustomCellRendererProps) {
    const theme = useTheme2();
    // A still-running job has no "success" value yet - the underlying field
    // is a duplicate of "Value #success" via a `+0` calculateField (see
    // runsData below), and Grafana's calculateField turns a missing/null
    // input into NaN rather than staying null, unlike a plain unmerged field
    // (Number(null ?? 0) === 0). NaN is still `typeof 'number'`, so it has
    // to be caught explicitly here rather than falling out of the `?? 0`.
    const rawSuccess = typeof value === 'number' ? value : Number(value ?? 0);
    const success = Number.isNaN(rawSuccess) ? 0 : rawSuccess;
    const completionValues = field.config?.custom?.completionValues as Array<number | null | undefined> | undefined;
    const failedValues = field.config?.custom?.failedValues as Array<number | null | undefined> | undefined;
    const completion = (completionValues?.[rowIndex] as number | undefined) ?? 0;
    const failed = (failedValues?.[rowIndex] as number | undefined) ?? 0;
    const color =
      failed > 0
        ? theme.visualization.getColorByName('red')
        : completion > 0 && success >= completion
          ? theme.visualization.getColorByName('green')
          : theme.visualization.getColorByName('yellow');

    return <span style={{ color }}>{success} / {completion}</span>;
  };
}

// Explains the Runs table's PODS/COMPLETION coloring - same right-aligned
// layout as JobStatusLegend above, with "running" as yellow instead of
// orange per this table's own explicit color choice.
function CronjobRunsStatusLegend() {
  const theme = useTheme2();
  const items: Array<{ label: string; colorName: string }> = [
    { label: 'complete', colorName: 'green' },
    { label: 'running', colorName: 'yellow' },
    { label: 'failed', colorName: 'red' },
  ];
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, alignItems: 'center', padding: '4px 0' }}>
      <span style={{ opacity: 0.7 }}>Job status:</span>
      {items.map((item) => (
        <span key={item.label} style={{ color: theme.visualization.getColorByName(item.colorName) }}>
          {item.label}
        </span>
      ))}
    </div>
  );
}

function getCronjobOverviewScene(
  cluster: string,
  namespace: string,
  cronjob: string,
  clusterRegex: string,
  namespaceRegex: string,
  cronjobRegex: string
) {
  const clusterUrl = `${CLUSTERS_URL}/${encodeURIComponent(cluster)}`;
  const namespaceUrl = `${NAMESPACES_URL}/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}`;

  // A single-query runner's "Value" field is never disambiguated to
  // "Value #<refId>" - Grafana's Prometheus datasource only does that once a
  // request has more than one query (confirmed via /api/ds/query - a lone
  // instant query stays literally named "Value" regardless of format:
  // 'table'). Only one query here, so read plain "Value" instead of the
  // "Value #<refId>" convention the multi-query rightRunner below uses.
  const leftRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [{ refId: 'status', expr: buildCronjobStatusQuery(clusterRegex, namespaceRegex, cronjob), instant: true, format: 'table' }],
  });

  const leftCard = new InfoCard({
    $data: leftRunner,
    rows: [
      { label: 'cluster:', render: () => cluster, href: clusterUrl },
      { label: 'namespace:', render: () => namespace, href: namespaceUrl },
      { label: 'cronjob:', render: () => cronjob },
      {
        label: 'status:',
        render: (frames) => cronjobStatusLabel(findFieldAcrossFrames(frames, 'Value')?.values[0]),
        color: (frames, theme) => cronjobStatusColor(findFieldAcrossFrames(frames, 'Value')?.values[0], theme),
      },
    ],
  });

  const rightRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [
      { refId: 'info', expr: buildCronjobInfoQuery(clusterRegex, namespaceRegex, cronjob), instant: true, format: 'table' },
      { refId: 'created', expr: buildCronjobCreatedQuery(clusterRegex, namespaceRegex, cronjob), instant: true, format: 'table' },
      { refId: 'nextSchedule', expr: buildCronjobNextScheduleQuery(clusterRegex, namespaceRegex, cronjob), instant: true, format: 'table' },
      { refId: 'lastSchedule', expr: buildCronjobLastScheduleQuery(clusterRegex, namespaceRegex, cronjob), instant: true, format: 'table' },
    ],
  });

  const rightCard = new InfoCard({
    $data: rightRunner,
    rows: [
      { label: 'schedule:', render: (frames) => findFieldAcrossFrames(frames, 'schedule')?.values[0] ?? '–' },
      { label: 'created:', fieldName: 'Value #created', unit: 'dateTimeFromNow' },
      { label: 'next scheduled:', fieldName: 'Value #nextSchedule', unit: 'dateTimeFromNow' },
      { label: 'last scheduled:', fieldName: 'Value #lastSchedule', unit: 'dateTimeFromNow' },
    ],
  });

  // "Cronjob optimization" - CPU/Memory, given verbatim (see the
  // cronjobCpuOptimizationQueries/cronjobMemoryOptimizationQueries comment in
  // cronjobOverviewQueries.ts for why these are namespace-wide, not scoped
  // down to just this cronjob's own pods).
  const substituteResource = (expr: string) => substituteCronjobResourceQuery(expr, clusterRegex, namespaceRegex);

  const cpuOptimizationRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(cronjobCpuOptimizationQueries) as CronjobCpuOptimizationKey[]).map((key) => ({
      refId: key,
      expr: substituteResource(cronjobCpuOptimizationQueries[key]),
    })),
  });
  const cpuOptimizationPanel = PanelBuilders.timeseries()
    .setTitle('CronJob CPU')
    .setUnit('cores')
    .setData(cpuOptimizationRunner)
    .setOverrides(applyCronjobOptimizationSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  const memoryOptimizationRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(cronjobMemoryOptimizationQueries) as CronjobMemoryOptimizationKey[]).map((key) => ({
      refId: key,
      expr: substituteResource(cronjobMemoryOptimizationQueries[key]),
    })),
  });
  const memoryOptimizationPanel = PanelBuilders.timeseries()
    .setTitle('CronJob Memory')
    .setUnit('bytes')
    .setData(memoryOptimizationRunner)
    .setOverrides(applyCronjobOptimizationSeriesOverrides)
    .setOption('legend', { displayMode: LegendDisplayMode.Table, placement: 'bottom', calcs: ['min', 'mean', 'max'] })
    .setHeaderActions(new PanelTimeRangeCompare())
    .setCustomFieldConfig('spanNulls', true)
    .build();

  // "Runs" table - one row per Job this cronjob has spawned.
  const substituteRuns = (expr: string) => substituteCronjobRunsQuery(expr, clusterRegex, namespaceRegex, cronjobRegex);

  const runsRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: (Object.keys(cronjobRunsTableQueries) as CronjobRunsTableQueryKey[]).map((key) => ({
      refId: key,
      expr: substituteRuns(cronjobRunsTableQueries[key]),
      format: 'table' as const,
      instant: true,
    })),
  });

  // "success" is duplicated (via a +0 calculateField) into its own base
  // field for PODS/COMPLETION - "Value #success" itself stays a plain
  // numeric SUCCESS column, so the same underlying value can drive two
  // differently-rendered columns at once (a single field can't be both a
  // plain number and a custom-rendered cell simultaneously).
  const runsData = new SceneDataTransformer({
    $data: runsRunner,
    transformations: [
      { id: 'merge', options: {} },
      {
        id: 'calculateField',
        options: {
          mode: 'binary',
          binary: { left: 'Value #end_time', operator: '-', right: 'Value #start' },
          alias: 'DURATION',
          replaceFields: false,
        },
      },
      {
        id: 'calculateField',
        options: {
          mode: 'binary',
          binary: { left: 'Value #success', operator: '+', right: '0' },
          alias: 'PodsCompletionBase',
          replaceFields: false,
        },
      },
      attachFieldValues('PodsCompletionBase', 'Value #completion', 'completionValues'),
      attachFieldValues('PodsCompletionBase', 'Value #failed', 'failedValues'),
      {
        id: 'organize',
        options: {
          excludeByName: {
            Time: true,
            cluster: true,
            namespace: true,
            join_name: true,
            reason: true,
            'Value #completion': true,
            'Value #failed': true,
          },
          indexByName: {
            job_name: 0,
            'Value #start': 1,
            'Value #end_time': 2,
            DURATION: 3,
            'Value #success': 4,
            PodsCompletionBase: 5,
          },
          renameByName: {
            job_name: 'JOB',
            'Value #start': 'START',
            'Value #end_time': 'END',
            'Value #success': 'SUCCESS',
            PodsCompletionBase: 'PODS/COMPLETION',
          },
        },
      },
    ],
  });

  const runsTable = PanelBuilders.table()
    .setTitle('Runs')
    .setData(runsData)
    .setOverrides((b) =>
      b
        .matchFieldsWithName('JOB')
        .overrideCustomFieldConfig('align', 'left')
        .matchFieldsWithName('START')
        .overrideUnit('dateTimeFromNow')
        .matchFieldsWithName('END')
        .overrideUnit('dateTimeFromNow')
        .matchFieldsWithName('DURATION')
        .overrideUnit('dtdurationms')
        .overrideMappings(durationMappings)
        .matchFieldsWithName('PODS/COMPLETION')
        .overrideCustomFieldConfig('cellOptions', { type: TableCellDisplayMode.Custom, cellComponent: cronjobRunsPodsCompletionCell() } as any)
    )
    .build();

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Cronjob information" /> }),
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ width: '50%', ySizing: 'content', minWidth: 0, body: leftCard }),
            new SceneFlexItem({ width: '50%', ySizing: 'content', minWidth: 0, body: rightCard }),
          ],
        }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Cronjob optimization" /> }),
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ height: 300, body: cpuOptimizationPanel }),
            new SceneFlexItem({ height: 300, body: memoryOptimizationPanel }),
          ],
        }),
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SectionHeading title="Runs" /> }),
        }),
        new SceneFlexLayout({
          direction: 'row',
          ySizing: 'content',
          children: [
            new SceneFlexItem({ body: new SceneControlsSpacer() }),
            new SceneFlexItem({
              xSizing: 'content',
              ySizing: 'content',
              body: new SceneReactObject({ reactNode: <CronjobRunsStatusLegend /> }),
            }),
          ],
        }),
        new SceneFlexItem({ height: 400, body: runsTable }),
      ],
    }),
  });
}

// Same shape as every other drilldown's own placeholder scaffold (e.g.
// getNodePlaceholderScene in nodesPage.tsx) for the tabs not built out yet.
function getCronjobPlaceholderScene(title: string) {
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

interface CronjobTabDef {
  slug: string;
  title: string;
  getScene: () => EmbeddedScene;
}

function getCronjobDetailPage(routeMatch: SceneRouteMatch<{ cluster: string; namespace: string; cronjob: string }>, parent: SceneAppPageLike) {
  const cluster = decodeURIComponent(routeMatch.params.cluster);
  const namespace = decodeURIComponent(routeMatch.params.namespace);
  const cronjob = decodeURIComponent(routeMatch.params.cronjob);
  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clusterRegex = escapeRegex(cluster);
  const namespaceRegex = escapeRegex(namespace);
  const cronjobRegex = escapeRegex(cronjob);
  const baseUrl = `${JOBS_URL}/cronjob/${encodeURIComponent(cluster)}/${encodeURIComponent(namespace)}/${encodeURIComponent(cronjob)}`;

  const tabDefs: CronjobTabDef[] = [
    {
      slug: 'overview',
      title: 'Overview',
      getScene: () => getCronjobOverviewScene(cluster, namespace, cronjob, clusterRegex, namespaceRegex, cronjobRegex),
    },
    { slug: 'cpu', title: 'CPU', getScene: () => getCronjobCpuScene(cluster, namespace, clusterRegex, namespaceRegex) },
    { slug: 'memory', title: 'Memory', getScene: () => getCronjobMemoryScene(cluster, namespace, clusterRegex, namespaceRegex) },
    { slug: 'logs', title: 'Logs', getScene: () => getCronjobPlaceholderScene('Logs') },
    { slug: 'events', title: 'Events', getScene: () => getCronjobPlaceholderScene('Events') },
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
    title: cronjob,
    titleImg: KUBERNETES_ICON,
    renderTitle: (title) => <CronjobPageTitle title={title} cluster={cluster} />,
    url: baseUrl,
    routePath: baseUrl,
    getParentPage: () => parent,
    tabs,
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'browser' }),
    $variables: new SceneVariableSet({ variables: [createThanosDatasourceVariable()] }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new SceneControlsSpacer(),
      new SceneTimePicker({}),
      new SceneRefreshPicker({ refresh: '1m' }),
    ],
    preserveUrlKeys: ['from', 'to', 'timezone', 'refresh', `var-${THANOS_VARIABLE_NAME}`],
  });
}

export function getJobsPage() {
  const clusterRegex = `\${${CLUSTER_VARIABLE_NAME}:regex}`;
  const namespaceRegex = `\${${NAMESPACE_VARIABLE_NAME}:regex}`;

  return new SceneAppPage({
    title: 'All Jobs',
    titleImg: KUBERNETES_ICON,
    url: JOBS_URL,
    routePath: `/${ROUTES.Jobs}/*`,
    tabs: [
      new SceneAppPage({
        title: 'Cronjobs',
        url: `${JOBS_URL}/cronjobs`,
        routePath: 'cronjobs',
        getScene: () => getCronjobsScene(clusterRegex, namespaceRegex),
      }),
      new SceneAppPage({
        title: 'Jobs',
        url: `${JOBS_URL}/jobs`,
        routePath: 'jobs',
        getScene: () => getJobsScene(clusterRegex, namespaceRegex),
      }),
    ],
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'browser' }),
    $variables: new SceneVariableSet({
      variables: [createThanosDatasourceVariable(), createClusterFilterVariable(), createNamespaceFilterVariable()],
    }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new VariableValueControl({ variableName: CLUSTER_VARIABLE_NAME }),
      new VariableValueControl({ variableName: NAMESPACE_VARIABLE_NAME }),
      new SceneControlsSpacer(),
      new SceneTimePicker({}),
      new SceneRefreshPicker({ refresh: '1m' }),
    ],
    // Deliberately excludes the filter variables - see the same note in
    // namespacesPage.tsx/alertsPage.ts.
    preserveUrlKeys: ['from', 'to', 'timezone', 'refresh', `var-${THANOS_VARIABLE_NAME}`],
    // CronJob Drilldown - nested one level deeper than this page's own tabs
    // (reached from the Cronjobs tab's own CRONJOB column link above), not a
    // separate top-level nav entry. Tabs and drilldowns coexist fine on the
    // same SceneAppPage - see the Workload Detail page's own Pod Drilldown
    // (workloadsPage.tsx) for the precedent confirming this against
    // @grafana/scenes' compiled SceneAppPage.js.
    drilldowns: [
      {
        routePath: `/cronjob/:cluster/:namespace/:cronjob/*`,
        getPage: getCronjobDetailPage,
      },
    ],
  });
}
