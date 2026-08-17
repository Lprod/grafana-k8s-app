import React from 'react';
import { MappingType, ValueMapping } from '@grafana/data';
import { TableCellDisplayMode } from '@grafana/schema';
import { CustomCellRendererProps, useTheme2 } from '@grafana/ui';
import {
  EmbeddedScene,
  PanelBuilders,
  SceneAppPage,
  SceneControlsSpacer,
  SceneDataTransformer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneQueryRunner,
  SceneReactObject,
  SceneRefreshPicker,
  SceneTimePicker,
  SceneTimeRange,
  SceneVariableSet,
  VariableValueControl,
} from '@grafana/scenes';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { CronjobTableQueryKey, cronjobTableQueries, jobTableQueries, substituteJobsClusterNamespace } from '../../queries/jobsQueries';
import { attachFieldValues } from '../../scenes/tableCells';
import {
  CLUSTER_VARIABLE_NAME,
  NAMESPACE_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createClusterFilterVariable,
  createNamespaceFilterVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';

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
  });
}
