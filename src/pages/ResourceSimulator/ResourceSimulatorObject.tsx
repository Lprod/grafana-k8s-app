import React from 'react';
import { css } from '@emotion/css';
import { DataFrame, Field, FieldType, LoadingState, PanelData } from '@grafana/data';
import {
  SceneComponentProps,
  SceneObjectBase,
  SceneObjectState,
  SceneObjectUrlSyncConfig,
  SceneObjectUrlValues,
  SceneQueryRunner,
} from '@grafana/scenes';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  ComboboxOption,
  IconButton,
  Input,
  LoadingPlaceholder,
  Stack,
  useStyles2,
} from '@grafana/ui';
import { prometheusDatasource } from '../../queries/datasources';
import {
  simulatorClusterAllocatableQuery,
  simulatorKafkaContainersQuery,
  simulatorKafkaCpuUsageQuery,
  simulatorKafkaLimitsQuery,
  simulatorKafkaMemoryUsageQuery,
  simulatorKafkaPodsQuery,
  simulatorKafkaPvcCountQuery,
  simulatorKafkaPvcStorageQuery,
  simulatorKafkaPvcUsedQuery,
  simulatorKafkaRequestsQuery,
  simulatorQuotaQuery,
  simulatorWorkloadContainersQuery,
  simulatorWorkloadCpuUsageQuery,
  simulatorWorkloadLimitsQuery,
  simulatorWorkloadMemoryUsageQuery,
  simulatorWorkloadPodsQuery,
  simulatorWorkloadPvcCountQuery,
  simulatorWorkloadPvcStorageQuery,
  simulatorWorkloadPvcUsedQuery,
  simulatorWorkloadReplicasQuery,
  simulatorWorkloadRequestsQuery,
} from '../../queries/resourceSimulator';
import {
  BYTES_PER_GIB,
  buildBaseline,
  calculateSimulatorResults,
  containerResourceTotals,
  DEFAULT_KAFKA_VALUES,
  DEFAULT_WORKLOAD_SCENARIO,
  DEFAULT_WORKLOAD_VALUES,
  KafkaEditableValues,
  KafkaPoolEditableValues,
  KafkaPoolSimulationRow,
  KafkaScenarioRow,
  KafkaSimulationRow,
  linkedPvcCountForReplicaChange,
  MetricSample,
  parseScenario,
  serializeScenario,
  SIMULATOR_QUOTA_RESOURCE_KEYS,
  SimulatorResultRow,
  SimulatorRowStatus,
  SimulatorRowUnit,
  WorkloadContainerValues,
  WorkloadEditableValues,
  WorkloadScenarioRow,
  WorkloadScenarioState,
  WorkloadSimulationRow,
  WorkloadType,
} from './resourceSimulatorModel';
import {
  formatCpuQuantity,
  formatGiBQuantity,
  parseByteQuantityToGiB,
  parseCpuQuantityToCores,
} from './resourceQuantities';

type ResourceSimulatorState = SceneObjectState & {
  scenario: string;
};

type UsageMeterStatus = 'no-request' | 'low' | 'ok' | 'warning' | 'over' | 'high';
type UsageMeterUnit = 'cores' | 'bytes';
type PvcMeterStatus = 'no-pvc' | 'ok' | 'warning' | 'risk';

const DEFAULT_SCENARIO_JSON = serializeScenario(DEFAULT_WORKLOAD_SCENARIO);
const WORKLOAD_TYPE_OPTIONS: Array<ComboboxOption<WorkloadType>> = [
  { label: 'Deployment', value: 'deployment' },
  { label: 'StatefulSet', value: 'statefulset' },
];

export class ResourceSimulatorObject extends SceneObjectBase<ResourceSimulatorState> {
  public static Component = ResourceSimulatorRenderer;

  protected _urlSync = new SceneObjectUrlSyncConfig(this, {
    keys: () => ['scenario'],
  });

  public constructor(state: Partial<ResourceSimulatorState> = {}) {
    super({
      scenario: DEFAULT_SCENARIO_JSON,
      $data: simulatorDataRunner(),
      ...state,
    });
  }

  public getUrlState(): SceneObjectUrlValues {
    return { scenario: this.state.scenario };
  }

  public updateFromUrl(values: SceneObjectUrlValues) {
    const value = firstUrlValue(values.scenario);

    if (value) {
      this.setState({ scenario: serializeScenario(parseScenario(value)) });
    }
  }

  public updateExistingRow = (row: WorkloadSimulationRow, patch: Partial<WorkloadEditableValues>) => {
    this.updateScenario((scenario) => ({
      ...scenario,
      overrides: {
        ...scenario.overrides,
        [row.id]: {
          ...editableValues(row),
          ...patch,
        },
      },
    }));
  };

  public updateTempRow = (row: WorkloadSimulationRow, patch: Partial<WorkloadScenarioRow>) => {
    this.updateScenario((scenario) => ({
      ...scenario,
      tempRows: scenario.tempRows.map((tempRow) => (tempRow.id === row.id ? { ...tempRow, ...patch } : tempRow)),
    }));
  };

  public addTempWorkload = () => {
    this.updateScenario((scenario) => {
      const nextNumber = scenario.tempRows.length + 1;
      const id = `temp-${Date.now().toString(36)}-${nextNumber}`;

      return {
        ...scenario,
        tempRows: [
          ...scenario.tempRows,
          {
            ...DEFAULT_WORKLOAD_VALUES,
            id,
            name: `temp-workload-${nextNumber}`,
            type: 'deployment',
          },
        ],
      };
    });
  };

  public updateExistingKafka = (row: KafkaSimulationRow, patch: KafkaEditableValues) => {
    this.updateScenario((scenario) => ({
      ...scenario,
      kafkaOverrides: {
        ...scenario.kafkaOverrides,
        [row.id]: patch,
      },
    }));
  };

  public updateTempKafka = (row: KafkaSimulationRow, patch: Partial<KafkaScenarioRow>) => {
    this.updateScenario((scenario) => ({
      ...scenario,
      tempKafkaRows: scenario.tempKafkaRows.map((tempRow) =>
        tempRow.id === row.id ? { ...tempRow, ...patch } : tempRow
      ),
    }));
  };

  public addTempKafka = () => {
    this.updateScenario((scenario) => {
      const nextNumber = scenario.tempKafkaRows.length + 1;
      const id = `temp-kafka-${Date.now().toString(36)}-${nextNumber}`;

      return {
        ...scenario,
        tempKafkaRows: [
          ...scenario.tempKafkaRows,
          {
            ...DEFAULT_KAFKA_VALUES,
            id,
            name: `temp-kafka-${nextNumber}`,
          },
        ],
      };
    });
  };

  public removeTempRow = (row: WorkloadSimulationRow) => {
    this.updateScenario((scenario) => ({
      ...scenario,
      tempRows: scenario.tempRows.filter((tempRow) => tempRow.id !== row.id),
    }));
  };

  public resetRow = (row: WorkloadSimulationRow) => {
    this.updateScenario((scenario) =>
      row.isTemporary
        ? {
            ...scenario,
            tempRows: scenario.tempRows.filter((tempRow) => tempRow.id !== row.id),
          }
        : {
            ...scenario,
            overrides: Object.fromEntries(Object.entries(scenario.overrides).filter(([id]) => id !== row.id)),
          }
    );
  };

  public resetKafka = (row: KafkaSimulationRow) => {
    this.updateScenario((scenario) =>
      row.isTemporary
        ? {
            ...scenario,
            tempKafkaRows: scenario.tempKafkaRows.filter((tempRow) => tempRow.id !== row.id),
          }
        : {
            ...scenario,
            kafkaOverrides: Object.fromEntries(Object.entries(scenario.kafkaOverrides).filter(([id]) => id !== row.id)),
          }
    );
  };

  public resetScenario = () => {
    this.setState({ scenario: DEFAULT_SCENARIO_JSON });
  };

  public updateQuotaOverride = (resource: string, hard: number) => {
    this.updateScenario((scenario) => ({
      ...scenario,
      quotaOverrides: {
        ...scenario.quotaOverrides,
        [resource]: hard,
      },
    }));
  };

  public updateQuotaOverrides = (overrides: Record<string, number>) => {
    this.updateScenario((scenario) => ({
      ...scenario,
      quotaOverrides: {
        ...scenario.quotaOverrides,
        ...overrides,
      },
    }));
  };

  public resetQuotaOverride = (resource: string) => {
    this.updateScenario((scenario) => ({
      ...scenario,
      quotaOverrides: Object.fromEntries(Object.entries(scenario.quotaOverrides).filter(([key]) => key !== resource)),
    }));
  };

  public resetQuotaOverrides = () => {
    this.updateScenario((scenario) => ({
      ...scenario,
      quotaOverrides: {},
    }));
  };

  private updateScenario(updater: (scenario: WorkloadScenarioState) => WorkloadScenarioState) {
    this.setState({ scenario: serializeScenario(updater(parseScenario(this.state.scenario))) });
  }
}

function simulatorDataRunner() {
  return new SceneQueryRunner({
    datasource: prometheusDatasource(),
    queries: [
      {
        refId: 'quota',
        expr: simulatorQuotaQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'workloadReplicas',
        expr: simulatorWorkloadReplicasQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'workloadPods',
        expr: simulatorWorkloadPodsQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'workloadContainers',
        expr: simulatorWorkloadContainersQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'workloadRequests',
        expr: simulatorWorkloadRequestsQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'workloadLimits',
        expr: simulatorWorkloadLimitsQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'workloadCpuUsage',
        expr: simulatorWorkloadCpuUsageQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'workloadMemoryUsage',
        expr: simulatorWorkloadMemoryUsageQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'workloadPvcCount',
        expr: simulatorWorkloadPvcCountQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'workloadPvcStorage',
        expr: simulatorWorkloadPvcStorageQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'workloadPvcUsed',
        expr: simulatorWorkloadPvcUsedQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'kafkaPods',
        expr: simulatorKafkaPodsQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'kafkaContainers',
        expr: simulatorKafkaContainersQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'kafkaRequests',
        expr: simulatorKafkaRequestsQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'kafkaLimits',
        expr: simulatorKafkaLimitsQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'kafkaCpuUsage',
        expr: simulatorKafkaCpuUsageQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'kafkaMemoryUsage',
        expr: simulatorKafkaMemoryUsageQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'kafkaPvcCount',
        expr: simulatorKafkaPvcCountQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'kafkaPvcStorage',
        expr: simulatorKafkaPvcStorageQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'kafkaPvcUsed',
        expr: simulatorKafkaPvcUsedQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
      {
        refId: 'allocatable',
        expr: simulatorClusterAllocatableQuery(),
        format: 'time_series',
        instant: true,
        range: false,
      },
    ],
    maxDataPoints: 1,
    minInterval: '30s',
  });
}

function ResourceSimulatorRenderer({ model }: SceneComponentProps<ResourceSimulatorObject>) {
  const state = model.useState();
  const dataState = state.$data?.useState();
  const styles = useStyles2(getStyles);
  const baseline = buildBaseline(samplesFromPanelData(dataState?.data));
  const scenario = parseScenario(state.scenario);
  const results = calculateSimulatorResults(baseline, scenario);
  const loading = dataState?.data?.state === LoadingState.Loading || dataState?.data?.state === LoadingState.Streaming;
  const showKafkaSection = results.kafkaRows.length > 0;

  return (
    <div className={styles.page}>
      <Stack direction="column" gap={2}>
        <div>
          <h2 className={styles.title}>Resource Simulator</h2>
          <p className={styles.subtitle}>
            Edit existing workloads or add temporary planned workloads to model quota impact.
          </p>
        </div>

        {loading && <LoadingPlaceholder text="Loading live workload baseline..." />}

        {dataState?.data?.errors?.map((error) => (
          <Alert key={error.message} title="Baseline query failed" severity="error">
            {error.message}
          </Alert>
        ))}

        {results.warnings.map((warning) => (
          <Alert key={warning} title="Simulator warning" severity="warning">
            {warning}
          </Alert>
        ))}

        <div className={styles.summaryGrid}>
          {summaryRows(results.rows).map((summary) => {
            const progressWidth =
              summary.ratio === undefined ? undefined : `${Math.min(100, Math.max(0, summary.ratio * 100))}%`;

            return (
              <div className={`${styles.summary} ${summaryStatusClass(styles, summary.status)}`} key={summary.key}>
                <div className={styles.summaryHeader}>
                  <span className={styles.summaryLabel}>{summary.label}</span>
                  <StatusBadge status={summary.status} />
                </div>
                <strong className={styles.summaryValue}>{formatValue(summary.projected, summary.unit)}</strong>
                <span className={styles.summaryMeta}>
                  {formatDelta(summary.delta, summary.unit)} · {formatUsageSummary(summary)}
                </span>
                {progressWidth !== undefined && (
                  <div className={styles.summaryProgress} aria-label={`${formatUsageValue(summary)} used`}>
                    <div
                      className={`${styles.summaryProgressFill} ${progressStatusClass(styles, summary.status)}`}
                      style={{ width: progressWidth }}
                    />
                  </div>
                )}
                <span className={styles.summaryHelp}>{formatRemainingSummary(summary)}</span>
              </div>
            );
          })}
        </div>

        <div className={styles.section}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} wrap="wrap">
            <div>
              <h3 className={styles.sectionTitle}>Workloads</h3>
              <p className={styles.sectionText}>
                Existing rows are seeded from live Deployment and StatefulSet metrics. Temporary rows are additive only.
              </p>
            </div>
            <Stack direction="row" gap={1} wrap="wrap">
              <Button variant="secondary" icon="plus" onClick={model.addTempWorkload}>
                Add workload
              </Button>
              {!showKafkaSection && (
                <Button variant="secondary" icon="plus" onClick={model.addTempKafka}>
                  Add Kafka
                </Button>
              )}
              <Button variant="secondary" icon="sync" onClick={model.resetScenario}>
                Reset all
              </Button>
            </Stack>
          </Stack>

          {results.workloadRows.length === 0 ? (
            <Alert title="No workload rows" severity="info">
              No live Deployment or StatefulSet metrics were returned for the current namespace. Add a temporary
              workload to model a planned change.
            </Alert>
          ) : (
            <WorkloadTable model={model} rows={results.workloadRows} deltas={results.workloadDeltas} />
          )}
        </div>

        {showKafkaSection && (
          <div className={styles.section}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} wrap="wrap">
              <div>
                <h3 className={styles.sectionTitle}>Kafka instances</h3>
                <p className={styles.sectionText}>
                  Rows are seeded from Strimzi broker and controller pools. Helper Deployments remain in the workload
                  table.
                </p>
              </div>
              <Button variant="secondary" icon="plus" onClick={model.addTempKafka}>
                Add Kafka
              </Button>
            </Stack>

            <KafkaTable model={model} rows={results.kafkaRows} deltas={results.kafkaDeltas} />
          </div>
        )}

        <div className={styles.section}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} wrap="wrap">
            <div>
              <h3 className={styles.sectionTitle}>Namespace quota scenario</h3>
              <p className={styles.sectionText}>
                Simulated ResourceQuota hard limits for the selected namespace.
              </p>
            </div>
            <Stack direction="row" gap={1} wrap="wrap">
              <Button variant="secondary" icon="check" onClick={() => fitAllQuotaRows(model, results.rows)}>
                Fit projected
              </Button>
              <Button variant="secondary" icon="sync" onClick={model.resetQuotaOverrides}>
                Use live hard limits
              </Button>
            </Stack>
          </Stack>
          <QuotaScenarioTable model={model} rows={results.rows} />
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Projected Quota And Capacity</h3>
          <ResultTable rows={results.rows} />
        </div>
      </Stack>
    </div>
  );
}

function QuotaScenarioTable({ model, rows }: { model: ResourceSimulatorObject; rows: SimulatorResultRow[] }) {
  const styles = useStyles2(getStyles);
  const quotaRows = quotaScenarioRows(rows);

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Resource</th>
            <th>Live used</th>
            <th>Live hard</th>
            <th>Sim hard</th>
            <th>Projected</th>
            <th>Remaining</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {quotaRows.map((row) => (
            <tr key={row.key}>
              <td>
                <Stack direction="column" gap={0}>
                  <Stack direction="row" alignItems="center" gap={1} wrap="wrap">
                    <strong>{row.label}</strong>
                    {row.hardEdited && <Badge color="blue" text="Edited" />}
                  </Stack>
                  <span className={styles.rowMeta}>{quotaResourceGroup(row.key)}</span>
                </Stack>
              </td>
              <td>{formatValue(row.baseline, row.unit)}</td>
              <td>{formatLiveHardValue(row)}</td>
              <td>
                <QuotaHardInput
                  row={row}
                  onChange={(value) => model.updateQuotaOverride(row.key, value)}
                />
              </td>
              <td>{formatValue(row.projected, row.unit)}</td>
              <td>{formatRemainingValue(row)}</td>
              <td>
                <StatusBadge status={row.status} />
              </td>
              <td>
                <Stack direction="row" gap={1} wrap="wrap">
                  <Button variant="secondary" size="sm" onClick={() => model.updateQuotaOverride(row.key, fitQuotaHard(row))}>
                    Fit
                  </Button>
                  <Button variant="secondary" size="sm" disabled={!row.hardEdited} onClick={() => model.resetQuotaOverride(row.key)}>
                    Reset
                  </Button>
                </Stack>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuotaHardInput({ row, onChange }: { row: SimulatorResultRow; onChange: (value: number) => void }) {
  const value = row.hard ?? row.liveHard ?? 0;

  if (row.unit === 'count') {
    return (
      <NumberInput
        label={`Simulated hard limit for ${row.label}`}
        value={Math.round(value)}
        min={0}
        step={1}
        width={9}
        onChange={onChange}
      />
    );
  }

  if (row.unit === 'bytes') {
    return (
      <QuantityInput
        label={`Simulated hard limit for ${row.label}`}
        value={value}
        formatter={(bytes) => formatGiBQuantity(bytes / BYTES_PER_GIB)}
        parser={parseByteQuantityToBytes}
        onChange={onChange}
      />
    );
  }

  return (
    <QuantityInput
      label={`Simulated hard limit for ${row.label}`}
      value={value}
      formatter={formatCpuQuantity}
      parser={parseCpuQuantityToCores}
      onChange={onChange}
    />
  );
}

function UsageRequestMeter({
  used,
  requested,
  unit,
}: {
  used: number;
  requested: number;
  unit: UsageMeterUnit;
}) {
  const styles = useStyles2(getStyles);
  const ratio = requested > 0 ? used / requested : undefined;
  const status = usageMeterStatus(ratio, used, requested);
  const fillWidth = ratio === undefined ? 0 : Math.min(100, Math.max(2, ratio * 100));
  const label = usageMeterLabel(status, ratio);
  const { used: formattedUsed, requested: formattedRequested } = formatMeterPair(used, requested, unit);

  return (
    <div
      className={styles.usageMeter}
      aria-label={`${formattedUsed} used of ${formattedRequested} requested, ${label}`}
      title={`${formattedUsed} used / ${formattedRequested} requested (${label})`}
    >
      <div className={styles.usageMeterText}>
        <strong>{formattedUsed}</strong>
        <span className={styles.usageMeterMeta}>/ {formattedRequested}</span>
      </div>
      <div className={styles.usageMeterTrack}>
        <div
          className={`${styles.usageMeterFill} ${usageMeterFillClass(styles, status)}`}
          style={{ width: `${fillWidth}%` }}
        />
      </div>
      <span className={`${styles.usageMeterBadge} ${usageMeterBadgeClass(styles, status)}`}>{label}</span>
    </div>
  );
}

function PvcUsageMeter({ used, size }: { used: number; size: number }) {
  const styles = useStyles2(getStyles);
  const ratio = size > 0 ? used / size : undefined;
  const status = pvcMeterStatus(ratio, used, size);
  const fillWidth = ratio === undefined ? 0 : Math.min(100, Math.max(2, ratio * 100));
  const label = pvcMeterLabel(status, ratio);
  const { used: formattedUsed, requested: formattedSize } = formatMeterPair(used, size, 'bytes');

  return (
    <div
      className={styles.usageMeter}
      aria-label={`${formattedUsed} used of ${formattedSize} PVC size, ${label}`}
      title={`${formattedUsed} used / ${formattedSize} PVC size (${label})`}
    >
      <div className={styles.usageMeterText}>
        <strong>{formattedUsed}</strong>
        <span className={styles.usageMeterMeta}>/ {formattedSize}</span>
      </div>
      <div className={styles.usageMeterTrack}>
        <div
          className={`${styles.usageMeterFill} ${pvcMeterFillClass(styles, status)}`}
          style={{ width: `${fillWidth}%` }}
        />
      </div>
      <span className={`${styles.usageMeterBadge} ${pvcMeterBadgeClass(styles, status)}`}>{label}</span>
    </div>
  );
}

function KafkaTable({
  model,
  rows,
  deltas,
}: {
  model: ResourceSimulatorObject;
  rows: KafkaSimulationRow[];
  deltas: Record<string, ReturnType<typeof calculateSimulatorResults>['kafkaDeltas'][string]>;
}) {
  const styles = useStyles2(getStyles);
  const [expandedRows, setExpandedRows] = React.useState<Record<string, boolean>>({});

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Kafka</th>
            <th>Current pods</th>
            <th>Sim pods</th>
            <th>CPU used / req</th>
            <th>CPU req</th>
            <th>CPU limit</th>
            <th>Mem used / req</th>
            <th>Mem req</th>
            <th>Mem limit</th>
            <th>PVCs</th>
            <th>PVC used / size</th>
            <th>PVC storage</th>
            <th>Delta</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const delta = deltas[row.id];
            const expanded = Boolean(expandedRows[row.id]);
            const togglePools = () => setExpandedRows((current) => ({ ...current, [row.id]: !current[row.id] }));

            return (
              <React.Fragment key={row.id}>
                <tr>
                  <td className={styles.workloadCell}>
                    <div className={styles.workloadInline}>
                      <IconButton
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Collapse pools for' : 'Expand pools for'} ${row.name}`}
                        className={styles.collapseButton}
                        name={expanded ? 'angle-down' : 'angle-right'}
                        size="sm"
                        onClick={togglePools}
                      />
                      {row.isTemporary ? (
                        <Input
                          aria-label="Temporary Kafka name"
                          value={row.name}
                          width={24}
                          onChange={(event) => model.updateTempKafka(row, { name: event.currentTarget.value })}
                        />
                      ) : (
                        <strong>{row.name}</strong>
                      )}
                    </div>
                  </td>
                  <td>{row.currentReplicas}</td>
                  <td>{row.simulatedReplicas}</td>
                  <td>
                    <UsageRequestMeter used={row.currentCpuUsage} requested={row.simulatedCpuRequests} unit="cores" />
                  </td>
                  <td>{formatCpuQuantity(row.simulatedCpuRequests)}</td>
                  <td>{formatCpuQuantity(row.simulatedCpuLimits)}</td>
                  <td>
                    <UsageRequestMeter
                      used={row.currentMemoryWorkingSet}
                      requested={row.simulatedMemoryRequests}
                      unit="bytes"
                    />
                  </td>
                  <td>{formatValue(row.simulatedMemoryRequests, 'bytes')}</td>
                  <td>{formatValue(row.simulatedMemoryLimits, 'bytes')}</td>
                  <td>{row.simulatedPvcCount}</td>
                  <td>
                    <PvcUsageMeter used={row.currentPvcUsedBytes} size={row.simulatedPvcStorageBytes} />
                  </td>
                  <td>{formatValue(row.simulatedPvcStorageBytes, 'bytes')}</td>
                  <td className={styles.deltaCell}>{formatWorkloadDelta(delta)}</td>
                  <td>
                    {row.missingResourceBaseline ? (
                      <Badge color="orange" text="Missing baseline" />
                    ) : row.changed ? (
                      <Badge color="blue" text="Edited" />
                    ) : (
                      <Badge color="green" text="Live" />
                    )}
                  </td>
                  <td>
                    <Button variant="secondary" size="sm" onClick={() => model.resetKafka(row)}>
                      {row.isTemporary ? 'Remove' : 'Reset'}
                    </Button>
                  </td>
                </tr>
                {expanded && (
                  <tr className={styles.detailRow}>
                    <td colSpan={15}>
                      <KafkaPoolEditor
                        row={row}
                        onChange={(pools) =>
                          row.isTemporary
                            ? model.updateTempKafka(row, { pools })
                            : model.updateExistingKafka(row, { pools })
                        }
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function KafkaPoolEditor({
  row,
  onChange,
}: {
  row: KafkaSimulationRow;
  onChange: (pools: KafkaPoolEditableValues[]) => void;
}) {
  const styles = useStyles2(getStyles);
  const updatePool = (pool: KafkaPoolSimulationRow, patch: Partial<WorkloadEditableValues>) => {
    onChange(
      row.pools.map((candidate) =>
        candidate.id === pool.id ? kafkaPoolValues({ ...candidate, ...patch }) : kafkaPoolValues(candidate)
      )
    );
  };

  return (
    <div className={styles.containerEditor}>
      <strong>Pools</strong>
      <table className={styles.nestedTable}>
        <thead>
          <tr>
            <th>Pool</th>
            <th>Role</th>
            <th>Current pods</th>
            <th>Sim pods</th>
            <th>CPU used / req</th>
            <th>Pod CPU req</th>
            <th>Pod CPU limit</th>
            <th>Mem used / req</th>
            <th>Pod mem req</th>
            <th>Pod mem limit</th>
            <th>PVCs</th>
            <th>PVC used / size</th>
            <th>PVC size</th>
          </tr>
        </thead>
        <tbody>
          {row.pools.map((pool) => {
            const podTotals = containerResourceTotals(pool.containers);
            const simulatedCpuRequests = pool.simulatedReplicas * podTotals.cpuRequests;
            const simulatedMemoryRequests = pool.simulatedReplicas * podTotals.memoryRequests * BYTES_PER_GIB;

            return (
              <tr key={pool.id}>
                <td>{pool.name}</td>
                <td>{formatKafkaRole(pool.role)}</td>
                <td>{pool.currentReplicas}</td>
                <td>
                  <CountStepper
                    decreaseLabel={`Decrease ${pool.name} replicas in ${row.name}`}
                    increaseLabel={`Increase ${pool.name} replicas in ${row.name}`}
                    label={`Simulated ${pool.name} replicas in ${row.name}`}
                    value={pool.simulatedReplicas}
                    min={0}
                    step={1}
                    onChange={(value) => updatePool(pool, { simulatedReplicas: value })}
                  />
                </td>
                <td>
                  <UsageRequestMeter used={pool.currentCpuUsage} requested={simulatedCpuRequests} unit="cores" />
                </td>
                <td>
                  <QuantityInput
                    label={`CPU request for ${pool.name} in ${row.name}`}
                    value={podTotals.cpuRequests}
                    formatter={formatCpuQuantity}
                    parser={parseCpuQuantityToCores}
                    onChange={(value) =>
                      updatePool(pool, {
                        containers: updateSingleContainer(pool.containers, { cpuRequestCores: value }),
                      })
                    }
                  />
                </td>
                <td>
                  <QuantityInput
                    label={`CPU limit for ${pool.name} in ${row.name}`}
                    value={podTotals.cpuLimits}
                    formatter={formatCpuQuantity}
                    parser={parseCpuQuantityToCores}
                    onChange={(value) =>
                      updatePool(pool, { containers: updateSingleContainer(pool.containers, { cpuLimitCores: value }) })
                    }
                  />
                </td>
                <td>
                  <UsageRequestMeter
                    used={pool.currentMemoryWorkingSet}
                    requested={simulatedMemoryRequests}
                    unit="bytes"
                  />
                </td>
                <td>
                  <QuantityInput
                    label={`Memory request for ${pool.name} in ${row.name}`}
                    value={podTotals.memoryRequests}
                    formatter={formatGiBQuantity}
                    parser={parseByteQuantityToGiB}
                    onChange={(value) =>
                      updatePool(pool, {
                        containers: updateSingleContainer(pool.containers, { memoryRequestGiB: value }),
                      })
                    }
                  />
                </td>
                <td>
                  <QuantityInput
                    label={`Memory limit for ${pool.name} in ${row.name}`}
                    value={podTotals.memoryLimits}
                    formatter={formatGiBQuantity}
                    parser={parseByteQuantityToGiB}
                    onChange={(value) =>
                      updatePool(pool, {
                        containers: updateSingleContainer(pool.containers, { memoryLimitGiB: value }),
                      })
                    }
                  />
                </td>
                <td>
                  <CountStepper
                    decreaseLabel={`Decrease ${pool.name} PVCs in ${row.name}`}
                    increaseLabel={`Increase ${pool.name} PVCs in ${row.name}`}
                    label={`PVC count for ${pool.name} in ${row.name}`}
                    value={pool.pvcCount}
                    min={0}
                    step={1}
                    onChange={(value) => updatePool(pool, { pvcCount: value })}
                  />
                </td>
                <td>
                  <PvcUsageMeter
                    used={pool.currentPvcUsedBytes}
                    size={Math.max(pool.currentPvcStorageBytes, pool.pvcCount * pool.pvcStorageGiB * BYTES_PER_GIB)}
                  />
                </td>
                <td>
                  <QuantityInput
                    label={`PVC size for ${pool.name} in ${row.name}`}
                    value={pool.pvcStorageGiB}
                    formatter={formatGiBQuantity}
                    parser={parseByteQuantityToGiB}
                    onChange={(value) => updatePool(pool, { pvcStorageGiB: value })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WorkloadTable({
  model,
  rows,
  deltas,
}: {
  model: ResourceSimulatorObject;
  rows: WorkloadSimulationRow[];
  deltas: Record<string, ReturnType<typeof calculateSimulatorResults>['workloadDeltas'][string]>;
}) {
  const styles = useStyles2(getStyles);
  const [expandedRows, setExpandedRows] = React.useState<Record<string, boolean>>({});

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Workload</th>
            <th>Type</th>
            <th>Current replicas</th>
            <th>Sim replicas</th>
            <th>Containers</th>
            <th>CPU used / req</th>
            <th>Pod CPU req</th>
            <th>Pod CPU limit</th>
            <th>Mem used / req</th>
            <th>Pod mem req</th>
            <th>Pod mem limit</th>
            <th>PVCs</th>
            <th>PVC used / size</th>
            <th>PVC size</th>
            <th>Delta</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const delta = deltas[row.id];
            const expanded = Boolean(expandedRows[row.id]);
            const podTotals = containerResourceTotals(row.containers);
            const simulatedCpuRequests = row.simulatedReplicas * podTotals.cpuRequests;
            const simulatedMemoryRequests = row.simulatedReplicas * podTotals.memoryRequests * BYTES_PER_GIB;
            const onValueChange = (patch: Partial<WorkloadEditableValues>) =>
              row.isTemporary ? model.updateTempRow(row, patch) : model.updateExistingRow(row, patch);
            const updateReplicas = (simulatedReplicas: number) =>
              onValueChange({
                simulatedReplicas,
                ...linkedStatefulSetPvcPatch(row, linkedPvcCountForReplicaChange(row, simulatedReplicas)),
              });
            const updatePvcCount = (pvcCount: number) =>
              onValueChange({
                pvcCount,
                ...linkedStatefulSetPvcPatch(row, pvcCount),
              });
            const updateContainers = (containers: WorkloadContainerValues[]) => onValueChange({ containers });
            const toggleContainers = () => setExpandedRows((current) => ({ ...current, [row.id]: !current[row.id] }));

            return (
              <React.Fragment key={row.id}>
                <tr>
                  <td className={styles.workloadCell}>
                    <div className={styles.workloadInline}>
                      <IconButton
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Collapse containers for' : 'Expand containers for'} ${row.name}`}
                        className={styles.collapseButton}
                        name={expanded ? 'angle-down' : 'angle-right'}
                        size="sm"
                        onClick={toggleContainers}
                      />
                      {row.isTemporary ? (
                        <Input
                          aria-label="Temporary workload name"
                          value={row.name}
                          width={24}
                          onChange={(event) => model.updateTempRow(row, { name: event.currentTarget.value })}
                        />
                      ) : (
                        <strong>{row.name}</strong>
                      )}
                    </div>
                  </td>
                  <td className={styles.typeCell}>
                    {row.isTemporary ? (
                      <>
                        <span id={`workload-kind-${row.id}`} className={styles.srOnly}>
                          Workload kind for {row.name}
                        </span>
                        <Combobox<WorkloadType>
                          aria-labelledby={`workload-kind-${row.id}`}
                          options={WORKLOAD_TYPE_OPTIONS}
                          value={row.type}
                          width={16}
                          onChange={(option) => model.updateTempRow(row, { type: option.value })}
                        />
                      </>
                    ) : (
                      formatWorkloadType(row.type)
                    )}
                  </td>
                  <td>{row.currentReplicas}</td>
                  <td>
                    <CountStepper
                      decreaseLabel={`Decrease replicas in ${row.name}`}
                      increaseLabel={`Increase replicas in ${row.name}`}
                      label={`Simulated replicas for ${row.name}`}
                      value={row.simulatedReplicas}
                      min={0}
                      step={1}
                      onChange={updateReplicas}
                    />
                  </td>
                  <td>{formatContainerCount(row)}</td>
                  <td>
                    <UsageRequestMeter used={row.currentCpuUsage} requested={simulatedCpuRequests} unit="cores" />
                  </td>
                  <td>{formatCpuQuantity(podTotals.cpuRequests)}</td>
                  <td>{formatCpuQuantity(podTotals.cpuLimits)}</td>
                  <td>
                    <UsageRequestMeter
                      used={row.currentMemoryWorkingSet}
                      requested={simulatedMemoryRequests}
                      unit="bytes"
                    />
                  </td>
                  <td>{formatGiBQuantity(podTotals.memoryRequests)}</td>
                  <td>{formatGiBQuantity(podTotals.memoryLimits)}</td>
                  <td>
                    <CountStepper
                      decreaseLabel={`Decrease PVCs in ${row.name}`}
                      increaseLabel={`Increase PVCs in ${row.name}`}
                      label={`PVC count for ${row.name}`}
                      value={row.pvcCount}
                      min={0}
                      step={1}
                      onChange={updatePvcCount}
                    />
                  </td>
                  <td>
                    <PvcUsageMeter
                      used={row.currentPvcUsedBytes}
                      size={Math.max(row.currentPvcStorageBytes, row.pvcCount * row.pvcStorageGiB * BYTES_PER_GIB)}
                    />
                  </td>
                  <td>
                    <QuantityInput
                      label={`PVC size for ${row.name}`}
                      value={row.pvcStorageGiB}
                      formatter={formatGiBQuantity}
                      parser={parseByteQuantityToGiB}
                      onChange={(value) => onValueChange({ pvcStorageGiB: value })}
                    />
                  </td>
                  <td className={styles.deltaCell}>{formatWorkloadDelta(delta)}</td>
                  <td>
                    {row.missingResourceBaseline ? (
                      <Badge color="orange" text="Missing baseline" />
                    ) : row.changed ? (
                      <Badge color="blue" text="Edited" />
                    ) : row.isScaledToZero ? (
                      <Badge color="blue" text="Scaled to zero" />
                    ) : (
                      <Badge color="green" text="Live" />
                    )}
                  </td>
                  <td>
                    <Button variant="secondary" size="sm" onClick={() => model.resetRow(row)}>
                      {row.isTemporary ? 'Remove' : 'Reset'}
                    </Button>
                  </td>
                </tr>
                {expanded && (
                  <tr className={styles.detailRow}>
                    <td colSpan={17}>
                      <ContainerEditor row={row} containers={row.containers} onChange={updateContainers} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ContainerEditor({
  row,
  containers,
  onChange,
}: {
  row: WorkloadSimulationRow;
  containers: WorkloadContainerValues[];
  onChange: (containers: WorkloadContainerValues[]) => void;
}) {
  const styles = useStyles2(getStyles);
  const updateContainer = (index: number, patch: Partial<WorkloadContainerValues>) => {
    onChange(
      containers.map((container, containerIndex) => (containerIndex === index ? { ...container, ...patch } : container))
    );
  };
  const addContainer = () => onChange([...containers, emptyContainer(containers)]);
  const removeContainer = (index: number) =>
    onChange(containers.filter((_, containerIndex) => containerIndex !== index));

  return (
    <div className={styles.containerEditor}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} wrap="wrap">
        <strong>Containers</strong>
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          aria-label={`Add container for ${row.name}`}
          onClick={addContainer}
        >
          Add container
        </Button>
      </Stack>
      <table className={styles.nestedTable}>
        <thead>
          <tr>
            <th>Container</th>
            <th>CPU used / req</th>
            <th>CPU req</th>
            <th>CPU limit</th>
            <th>Mem used / req</th>
            <th>Mem req</th>
            <th>Mem limit</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {containers.map((container, index) => {
            const containerName = container.name || `container-${index + 1}`;
            const liveContainer = row.containerBaselines.find((baseline) => baseline.name === container.name);
            const simulatedCpuRequest = row.simulatedReplicas * Math.max(0, container.cpuRequestCores);
            const simulatedMemoryRequest =
              row.simulatedReplicas * Math.max(0, container.memoryRequestGiB) * BYTES_PER_GIB;

            return (
              <tr key={`${row.id}-${index}`}>
                <td>
                  <Input
                    aria-label={`Container name for container ${index + 1} in ${row.name}`}
                    value={container.name}
                    width={18}
                    onChange={(event) => updateContainer(index, { name: event.currentTarget.value })}
                  />
                </td>
                <td>
                  <UsageRequestMeter
                    used={liveContainer?.currentCpuUsage ?? 0}
                    requested={simulatedCpuRequest}
                    unit="cores"
                  />
                </td>
                <td>
                  <QuantityInput
                    label={`CPU request for container ${containerName} in ${row.name}`}
                    value={container.cpuRequestCores}
                    formatter={formatCpuQuantity}
                    parser={parseCpuQuantityToCores}
                    onChange={(value) => updateContainer(index, { cpuRequestCores: value })}
                  />
                </td>
                <td>
                  <QuantityInput
                    label={`CPU limit for container ${containerName} in ${row.name}`}
                    value={container.cpuLimitCores}
                    formatter={formatCpuQuantity}
                    parser={parseCpuQuantityToCores}
                    onChange={(value) => updateContainer(index, { cpuLimitCores: value })}
                  />
                </td>
                <td>
                  <UsageRequestMeter
                    used={liveContainer?.currentMemoryWorkingSet ?? 0}
                    requested={simulatedMemoryRequest}
                    unit="bytes"
                  />
                </td>
                <td>
                  <QuantityInput
                    label={`Memory request for container ${containerName} in ${row.name}`}
                    value={container.memoryRequestGiB}
                    formatter={formatGiBQuantity}
                    parser={parseByteQuantityToGiB}
                    onChange={(value) => updateContainer(index, { memoryRequestGiB: value })}
                  />
                </td>
                <td>
                  <QuantityInput
                    label={`Memory limit for container ${containerName} in ${row.name}`}
                    value={container.memoryLimitGiB}
                    formatter={formatGiBQuantity}
                    parser={parseByteQuantityToGiB}
                    onChange={(value) => updateContainer(index, { memoryLimitGiB: value })}
                  />
                </td>
                <td>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={containers.length <= 1}
                    onClick={() => removeContainer(index)}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function emptyContainer(containers: WorkloadContainerValues[]): WorkloadContainerValues {
  const existingNames = new Set(containers.map((container) => container.name));
  let index = containers.length + 1;
  let name = `container-${index}`;

  while (existingNames.has(name)) {
    index += 1;
    name = `container-${index}`;
  }

  return {
    name,
    cpuRequestCores: 0,
    cpuLimitCores: 0,
    memoryRequestGiB: 0,
    memoryLimitGiB: 0,
  };
}

function ResultTable({ rows }: { rows: SimulatorResultRow[] }) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Resource</th>
            <th>Baseline</th>
            <th>Delta</th>
            <th>Projected</th>
            <th>Used</th>
            <th>Hard limit</th>
            <th>Remaining</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((resultRow) => (
            <tr key={resultRow.key}>
              <td>
                <Stack direction="column" gap={0}>
                  <strong>{resultRow.label}</strong>
                  <span className={styles.rowMeta}>{resultRow.source}</span>
                </Stack>
              </td>
              <td>{formatValue(resultRow.baseline, resultRow.unit)}</td>
              <td>{formatDelta(resultRow.delta, resultRow.unit)}</td>
              <td>{formatValue(resultRow.projected, resultRow.unit)}</td>
              <td>{formatUsageValue(resultRow)}</td>
              <td>{formatLimitValue(resultRow)}</td>
              <td>{formatRemainingValue(resultRow)}</td>
              <td>
                <StatusBadge status={resultRow.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountStepper({
  label,
  decreaseLabel,
  increaseLabel,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  decreaseLabel: string;
  increaseLabel: string;
  value: number;
  min: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const styles = useStyles2(getStyles);
  const setCount = (next: number) => onChange(Math.max(min, Math.round(next)));

  return (
    <div className={styles.countStepper}>
      <IconButton
        aria-label={decreaseLabel}
        className={styles.stepperButton}
        disabled={value <= min}
        name="minus"
        size="sm"
        onClick={() => setCount(value - step)}
      />
      <NumberInput label={label} value={value} min={min} step={step} width={7} onChange={setCount} />
      <IconButton
        aria-label={increaseLabel}
        className={styles.stepperButton}
        name="plus"
        size="sm"
        onClick={() => setCount(value + step)}
      />
    </div>
  );
}

function NumberInput({
  label,
  value,
  min,
  step,
  width = 9,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step: number;
  width?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Input
      aria-label={label}
      type="number"
      min={min}
      step={step}
      value={formatInputValue(value)}
      width={width}
      onChange={(event) => onChange(clampNumber(event.currentTarget.valueAsNumber, min))}
    />
  );
}

function QuantityInput({
  label,
  value,
  min = 0,
  formatter,
  parser,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  formatter: (value: number) => string;
  parser: (value: string) => number | undefined;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = React.useState<string | undefined>();
  const displayValue = draft ?? formatter(value);
  const parsedDraft = displayValue.trim() === '' ? undefined : parser(displayValue);
  const invalid = displayValue.trim() !== '' && parsedDraft === undefined;

  return (
    <Input
      aria-label={label}
      invalid={invalid}
      type="text"
      value={displayValue}
      width={10}
      onFocus={() => setDraft(formatter(value))}
      onBlur={() => {
        const parsed = parser(displayValue);

        if (parsed === undefined) {
          setDraft(undefined);
          return;
        }

        const next = Math.max(min, parsed);
        onChange(next);
        setDraft(undefined);
      }}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        const parsed = parser(nextDraft);

        setDraft(nextDraft);

        if (parsed !== undefined && parsed >= min) {
          onChange(parsed);
        }
      }}
    />
  );
}

function StatusBadge({ status }: { status: SimulatorRowStatus }) {
  const color = status === 'exceeded' ? 'red' : status === 'warning' ? 'orange' : status === 'ok' ? 'green' : 'blue';
  const text =
    status === 'exceeded'
      ? 'Exceeded'
      : status === 'warning'
        ? 'Near limit'
        : status === 'unlimited'
          ? 'Unlimited'
          : status === 'ok'
            ? 'OK'
            : 'Unknown';

  return <Badge color={color} text={text} />;
}

function editableValues(row: WorkloadSimulationRow): WorkloadEditableValues {
  return {
    simulatedReplicas: row.simulatedReplicas,
    containers: row.containers.map((container) => ({ ...container })),
    pvcCount: row.pvcCount,
    pvcStorageGiB: row.pvcStorageGiB,
  };
}

function kafkaPoolValues(pool: KafkaPoolSimulationRow): KafkaPoolEditableValues {
  return {
    id: pool.id,
    name: pool.name,
    role: pool.role,
    simulatedReplicas: pool.simulatedReplicas,
    containers: pool.containers.map((container) => ({ ...container })),
    pvcCount: pool.pvcCount,
    pvcStorageGiB: pool.pvcStorageGiB,
  };
}

function updateSingleContainer(containers: WorkloadContainerValues[], patch: Partial<WorkloadContainerValues>) {
  const [first, ...rest] = containers.length > 0 ? containers : [{ ...DEFAULT_WORKLOAD_VALUES.containers[0] }];
  return [{ ...first, ...patch }, ...rest];
}

function linkedStatefulSetPvcPatch(
  row: WorkloadSimulationRow,
  nextPvcCount: number | undefined
): Partial<WorkloadEditableValues> {
  if (row.type !== 'statefulset' || nextPvcCount === undefined) {
    return {};
  }

  return { pvcCount: nextPvcCount };
}

function firstUrlValue(value: SceneObjectUrlValues[string]) {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

function clampNumber(value: number, min: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, value);
}

function samplesFromPanelData(data?: PanelData): MetricSample[] {
  return data?.series.flatMap(samplesFromFrame) ?? [];
}

function samplesFromFrame(frame: DataFrame): MetricSample[] {
  const refId = frame.refId ?? '';
  const valueFields = frame.fields.filter((field) => field.type === FieldType.number && field.name !== 'Time');

  if (valueFields.length === 0) {
    return [];
  }

  return valueFields.flatMap((valueField) => {
    if (valueField.labels && Object.keys(valueField.labels).length > 0) {
      const value = numberAt(valueField, 0);
      return value === undefined ? [] : [{ refId, labels: stringLabels(valueField.labels), value }];
    }

    return samplesFromTableFrame(frame, valueField, refId);
  });
}

function samplesFromTableFrame(frame: DataFrame, valueField: Field, refId: string): MetricSample[] {
  const samples: MetricSample[] = [];
  const length = valueField.values.length;

  for (let index = 0; index < length; index++) {
    const value = numberAt(valueField, index);

    if (value === undefined) {
      continue;
    }

    const labels: Record<string, string> = {};

    for (const field of frame.fields) {
      if (field === valueField || field.name === 'Time' || field.name === 'Value') {
        continue;
      }

      const fieldValue = valueAt(field, index);

      if (fieldValue !== undefined && fieldValue !== null) {
        labels[field.name] = String(fieldValue);
      }
    }

    samples.push({ refId, labels, value });
  }

  return samples;
}

function stringLabels(labels: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(labels).map(([key, value]) => [key, String(value)]));
}

function numberAt(field: Field, index: number) {
  const value = valueAt(field, index);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function valueAt(field: Field, index: number) {
  const values = field.values as unknown;

  if (Array.isArray(values)) {
    return values[index];
  }

  if (values && typeof (values as { get?: unknown }).get === 'function') {
    return (values as { get: (index: number) => unknown }).get(index);
  }

  return (values as Record<number, unknown>)[index];
}

function summaryRows(rows: SimulatorResultRow[]) {
  const keys = [
    'requests.cpu',
    'requests.memory',
    'requests.storage',
    'pods',
    'count/deployments.apps',
    'count/statefulsets.apps',
    'count/persistentvolumeclaims',
    'count/configmaps',
    'count/secrets',
    'count/services',
  ];
  return keys
    .map((key) => rows.find((resultRow) => resultRow.key === key))
    .filter((row): row is SimulatorResultRow => Boolean(row));
}

function quotaScenarioRows(rows: SimulatorResultRow[]) {
  return SIMULATOR_QUOTA_RESOURCE_KEYS.map((key) => rows.find((resultRow) => resultRow.key === key)).filter(
    (row): row is SimulatorResultRow => Boolean(row)
  );
}

function quotaResourceGroup(resource: string) {
  if (resource.includes('cpu') || resource.includes('memory')) {
    return 'Compute';
  }

  if (resource.includes('storage') || resource.includes('persistentvolumeclaims')) {
    return 'Storage';
  }

  return 'Objects';
}

function fitAllQuotaRows(model: ResourceSimulatorObject, rows: SimulatorResultRow[]) {
  model.updateQuotaOverrides(
    Object.fromEntries(quotaScenarioRows(rows).map((row) => [row.key, fitQuotaHard(row)]))
  );
}

function fitQuotaHard(row: SimulatorResultRow) {
  if (row.unit === 'cores') {
    return Math.ceil(row.projected * 10) / 10;
  }

  if (row.unit === 'bytes') {
    return Math.ceil(row.projected / BYTES_PER_GIB) * BYTES_PER_GIB;
  }

  return Math.ceil(row.projected);
}

function parseByteQuantityToBytes(value: string) {
  const gib = parseByteQuantityToGiB(value);
  return gib === undefined ? undefined : gib * BYTES_PER_GIB;
}

function usageMeterStatus(ratio: number | undefined, used: number, requested: number): UsageMeterStatus {
  if (requested <= 0) {
    return used > 0 ? 'no-request' : 'no-request';
  }

  if (ratio === undefined) {
    return 'no-request';
  }

  if (ratio >= 1.5) {
    return 'high';
  }

  if (ratio >= 1) {
    return 'over';
  }

  if (ratio >= 0.8) {
    return 'warning';
  }

  if (ratio < 0.2) {
    return 'low';
  }

  return 'ok';
}

function usageMeterLabel(status: UsageMeterStatus, ratio: number | undefined) {
  if (status === 'no-request') {
    return 'No req';
  }

  const formattedRatio = ratio === undefined ? '-' : formatPercentage(ratio);

  if (status === 'high') {
    return `${formattedRatio} high`;
  }

  if (status === 'over') {
    return `${formattedRatio} over`;
  }

  if (status === 'warning') {
    return `${formattedRatio} near`;
  }

  if (status === 'low') {
    return `${formattedRatio} low`;
  }

  return `${formattedRatio} req`;
}

function usageMeterFillClass(styles: ReturnType<typeof getStyles>, status: UsageMeterStatus) {
  if (status === 'high') {
    return styles.usageMeterFillHigh;
  }

  if (status === 'over') {
    return styles.usageMeterFillOver;
  }

  if (status === 'warning') {
    return styles.usageMeterFillWarning;
  }

  if (status === 'low') {
    return styles.usageMeterFillLow;
  }

  if (status === 'no-request') {
    return styles.usageMeterFillNoRequest;
  }

  return styles.usageMeterFillOk;
}

function usageMeterBadgeClass(styles: ReturnType<typeof getStyles>, status: UsageMeterStatus) {
  if (status === 'high') {
    return styles.usageMeterBadgeHigh;
  }

  if (status === 'over') {
    return styles.usageMeterBadgeOver;
  }

  if (status === 'warning') {
    return styles.usageMeterBadgeWarning;
  }

  if (status === 'low') {
    return styles.usageMeterBadgeLow;
  }

  if (status === 'no-request') {
    return styles.usageMeterBadgeNoRequest;
  }

  return styles.usageMeterBadgeOk;
}

function pvcMeterStatus(ratio: number | undefined, used: number, size: number): PvcMeterStatus {
  if (size <= 0 || (used <= 0 && ratio === undefined)) {
    return 'no-pvc';
  }

  if (ratio === undefined) {
    return 'no-pvc';
  }

  if (ratio >= 0.9) {
    return 'risk';
  }

  if (ratio >= 0.8) {
    return 'warning';
  }

  return 'ok';
}

function pvcMeterLabel(status: PvcMeterStatus, ratio: number | undefined) {
  if (status === 'no-pvc') {
    return 'No PVC';
  }

  const formattedRatio = ratio === undefined ? '-' : formatPercentage(ratio);

  if (status === 'risk') {
    return `${formattedRatio} full risk`;
  }

  if (status === 'warning') {
    return `${formattedRatio} near full`;
  }

  return `${formattedRatio} used`;
}

function pvcMeterFillClass(styles: ReturnType<typeof getStyles>, status: PvcMeterStatus) {
  if (status === 'risk') {
    return styles.usageMeterFillHigh;
  }

  if (status === 'warning') {
    return styles.usageMeterFillWarning;
  }

  if (status === 'no-pvc') {
    return styles.usageMeterFillNoRequest;
  }

  return styles.usageMeterFillOk;
}

function pvcMeterBadgeClass(styles: ReturnType<typeof getStyles>, status: PvcMeterStatus) {
  if (status === 'risk') {
    return styles.usageMeterBadgeHigh;
  }

  if (status === 'warning') {
    return styles.usageMeterBadgeWarning;
  }

  if (status === 'no-pvc') {
    return styles.usageMeterBadgeNoRequest;
  }

  return styles.usageMeterBadgeOk;
}

function formatMeterPair(used: number, requested: number, unit: UsageMeterUnit) {
  if (unit === 'cores') {
    const useMillicores = requested < 1 || (used < 1 && requested < 1);

    return {
      used: useMillicores ? formatMillicores(used) : formatCores(used),
      requested: useMillicores ? formatMillicores(requested) : formatCores(requested),
    };
  }

  const useMiB = requested < BYTES_PER_GIB;

  return {
    used: useMiB ? formatMiB(used) : formatGiB(used),
    requested: useMiB ? formatMiB(requested) : formatGiB(requested),
  };
}

function formatMillicores(cores: number) {
  if (!Number.isFinite(cores) || cores <= 0) {
    return '0m';
  }

  return `${formatQuantityNumber(cores * 1000)}m`;
}

function formatCores(cores: number) {
  if (!Number.isFinite(cores) || cores <= 0) {
    return '0 cores';
  }

  return `${formatQuantityNumber(cores)} cores`;
}

function formatMiB(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0Mi';
  }

  return `${formatQuantityNumber(bytes / 1024 ** 2)}Mi`;
}

function formatGiB(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0Gi';
  }

  return `${formatQuantityNumber(bytes / BYTES_PER_GIB)}Gi`;
}

function formatQuantityNumber(value: number) {
  return Number(value.toFixed(3)).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatWorkloadType(type: WorkloadType) {
  return WORKLOAD_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function formatKafkaRole(role: KafkaPoolSimulationRow['role']) {
  return role === 'broker' ? 'Broker' : 'Controller';
}

function formatContainerCount(row: WorkloadSimulationRow) {
  const plannedCount = `${formatValue(row.containers.length, 'count')} per Pod`;

  if (row.currentContainers <= 0) {
    return plannedCount;
  }

  if (row.currentPods <= 0) {
    return `${plannedCount} / ${row.currentContainers.toLocaleString(undefined, { maximumFractionDigits: 0 })} live`;
  }

  const liveContainersPerPod = row.currentContainers / row.currentPods;
  return `${plannedCount} / ${formatValue(row.currentContainers, 'count')} live, ${liveContainersPerPod.toLocaleString(
    undefined,
    {
      maximumFractionDigits: 2,
    }
  )} per Pod`;
}

function formatWorkloadDelta(delta?: ReturnType<typeof calculateSimulatorResults>['workloadDeltas'][string]) {
  if (!delta) {
    return '-';
  }

  return [
    `${formatDelta(delta.pods, 'count')} pods`,
    `${formatDelta(delta.cpuRequests, 'cores')} CPU`,
    `${formatDelta(delta.memoryRequests, 'bytes')} mem`,
    `${formatDelta(delta.pvcStorage, 'bytes')} PVC`,
  ].join(' / ');
}

function summaryStatusClass(styles: ReturnType<typeof getStyles>, status: SimulatorRowStatus) {
  if (status === 'exceeded') {
    return styles.summaryExceeded;
  }

  if (status === 'warning') {
    return styles.summaryWarning;
  }

  if (status === 'unlimited') {
    return styles.summaryUnlimited;
  }

  if (status === 'unknown') {
    return styles.summaryUnknown;
  }

  return styles.summaryOk;
}

function progressStatusClass(styles: ReturnType<typeof getStyles>, status: SimulatorRowStatus) {
  if (status === 'exceeded') {
    return styles.summaryProgressExceeded;
  }

  if (status === 'warning') {
    return styles.summaryProgressWarning;
  }

  if (status === 'unknown') {
    return styles.summaryProgressUnknown;
  }

  return styles.summaryProgressOk;
}

function formatUsageSummary(row: SimulatorResultRow) {
  if (row.ratio !== undefined) {
    return `${formatPercentage(row.ratio)} of ${formatValue(row.hard ?? 0, row.unit)}`;
  }

  if (row.status === 'unlimited') {
    return 'Unlimited';
  }

  return row.source === 'capacity' ? 'No capacity data' : 'No limit data';
}

function formatUsageValue(row: SimulatorResultRow) {
  return row.ratio === undefined ? '-' : formatPercentage(row.ratio);
}

function formatLimitValue(row: SimulatorResultRow) {
  if (row.hard !== undefined) {
    return formatValue(row.hard, row.unit);
  }

  return row.status === 'unlimited' ? 'Unlimited' : 'Unknown';
}

function formatLiveHardValue(row: SimulatorResultRow) {
  return row.liveHard === undefined ? 'Unlimited' : formatValue(row.liveHard, row.unit);
}

function formatRemainingValue(row: SimulatorResultRow) {
  if (row.remaining !== undefined) {
    return row.remaining < 0
      ? `${formatValue(Math.abs(row.remaining), row.unit)} over`
      : formatValue(row.remaining, row.unit);
  }

  return row.status === 'unlimited' ? 'Unlimited' : '-';
}

function formatRemainingSummary(row: SimulatorResultRow) {
  if (row.remaining !== undefined) {
    return row.remaining < 0
      ? `${formatValue(Math.abs(row.remaining), row.unit)} over`
      : `${formatValue(row.remaining, row.unit)} remaining`;
  }

  if (row.status === 'unlimited') {
    return 'No configured hard limit';
  }

  return row.source === 'capacity' ? 'Capacity data missing' : 'Limit data missing';
}

function formatDelta(value: number, unit: SimulatorRowUnit) {
  if (Math.abs(value) < 0.000001) {
    return '+0';
  }

  return value > 0 ? `+${formatValue(value, unit)}` : formatValue(value, unit);
}

function formatValue(value: number, unit: SimulatorRowUnit) {
  if (unit === 'cores') {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  if (unit === 'bytes') {
    return `${(value / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB`;
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPercentage(ratio: number) {
  return `${(ratio * 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}%`;
}

function formatInputValue(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function getStyles() {
  return {
    page: css({
      minHeight: 760,
      padding: '16px 0 24px',
    }),
    title: css({
      fontSize: 22,
      lineHeight: '28px',
      margin: 0,
    }),
    subtitle: css({
      margin: '4px 0 0',
      opacity: 0.75,
    }),
    summaryGrid: css({
      display: 'grid',
      gap: 12,
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    }),
    summary: css({
      border: '1px solid var(--border-weak)',
      borderRadius: 4,
      padding: 12,
      minHeight: 132,
      position: 'relative',
    }),
    summaryOk: css({
      background: 'linear-gradient(90deg, rgba(46, 125, 50, 0.12), transparent 58%)',
      borderColor: 'rgba(46, 125, 50, 0.55)',
      boxShadow: 'inset 4px 0 0 rgba(46, 125, 50, 0.9)',
    }),
    summaryWarning: css({
      background: 'linear-gradient(90deg, rgba(245, 124, 0, 0.14), transparent 58%)',
      borderColor: 'rgba(245, 124, 0, 0.65)',
      boxShadow: 'inset 4px 0 0 rgba(245, 124, 0, 0.95)',
    }),
    summaryExceeded: css({
      background: 'linear-gradient(90deg, rgba(211, 47, 47, 0.14), transparent 58%)',
      borderColor: 'rgba(211, 47, 47, 0.7)',
      boxShadow: 'inset 4px 0 0 rgba(211, 47, 47, 0.95)',
    }),
    summaryUnlimited: css({
      background: 'linear-gradient(90deg, rgba(2, 119, 189, 0.12), transparent 58%)',
      borderColor: 'rgba(2, 119, 189, 0.55)',
      boxShadow: 'inset 4px 0 0 rgba(2, 119, 189, 0.85)',
    }),
    summaryUnknown: css({
      background: 'linear-gradient(90deg, rgba(96, 125, 139, 0.13), transparent 58%)',
      borderColor: 'rgba(96, 125, 139, 0.6)',
      boxShadow: 'inset 4px 0 0 rgba(96, 125, 139, 0.9)',
    }),
    summaryHeader: css({
      alignItems: 'flex-start',
      display: 'flex',
      gap: 8,
      justifyContent: 'space-between',
    }),
    summaryLabel: css({
      display: 'block',
      fontSize: 12,
      opacity: 0.75,
      paddingRight: 6,
    }),
    summaryValue: css({
      display: 'block',
      fontSize: 22,
      lineHeight: '28px',
      marginTop: 4,
    }),
    summaryMeta: css({
      display: 'block',
      fontSize: 12,
      marginTop: 4,
      opacity: 0.75,
    }),
    summaryProgress: css({
      background: 'rgba(128, 128, 128, 0.22)',
      borderRadius: 3,
      height: 6,
      marginTop: 10,
      overflow: 'hidden',
      width: '100%',
    }),
    summaryProgressFill: css({
      borderRadius: 3,
      height: '100%',
      minWidth: 2,
    }),
    summaryProgressOk: css({
      background: 'rgba(46, 125, 50, 0.95)',
    }),
    summaryProgressWarning: css({
      background: 'rgba(245, 124, 0, 0.95)',
    }),
    summaryProgressExceeded: css({
      background: 'rgba(211, 47, 47, 0.95)',
    }),
    summaryProgressUnknown: css({
      background: 'rgba(96, 125, 139, 0.9)',
    }),
    summaryHelp: css({
      display: 'block',
      fontSize: 12,
      marginTop: 8,
      opacity: 0.82,
    }),
    section: css({
      border: '1px solid var(--border-weak)',
      borderRadius: 4,
      padding: 16,
    }),
    sectionTitle: css({
      fontSize: 16,
      lineHeight: '22px',
      margin: 0,
    }),
    sectionText: css({
      margin: '4px 0 16px',
      opacity: 0.75,
    }),
    tableWrap: css({
      overflowX: 'auto',
    }),
    table: css({
      borderCollapse: 'collapse',
      minWidth: 1640,
      width: '100%',

      'th, td': {
        borderBottom: '1px solid var(--border-weak)',
        padding: '8px 10px',
        textAlign: 'left',
        verticalAlign: 'middle',
      },

      th: {
        fontSize: 12,
        opacity: 0.75,
      },
    }),
    workloadCell: css({
      minWidth: 220,
    }),
    workloadInline: css({
      alignItems: 'center',
      display: 'flex',
      gap: 8,
      whiteSpace: 'nowrap',
    }),
    collapseButton: css({
      alignItems: 'center',
      display: 'inline-flex',
      height: 24,
      justifyContent: 'center',
      minWidth: 24,
      padding: 0,
      width: 24,
    }),
    countStepper: css({
      alignItems: 'center',
      display: 'flex',
      gap: 4,
      whiteSpace: 'nowrap',
    }),
    stepperButton: css({
      alignItems: 'center',
      display: 'inline-flex',
      height: 24,
      justifyContent: 'center',
      minWidth: 24,
      padding: 0,
      width: 24,
    }),
    typeCell: css({
      minWidth: 150,
    }),
    detailRow: css({
      td: {
        background: 'var(--background-secondary)',
      },
    }),
    containerEditor: css({
      padding: '8px 0',
    }),
    nestedTable: css({
      borderCollapse: 'collapse',
      marginTop: 8,
      minWidth: 1080,
      width: '100%',

      'th, td': {
        borderBottom: '1px solid var(--border-weak)',
        padding: '6px 8px',
        textAlign: 'left',
        verticalAlign: 'middle',
      },

      th: {
        fontSize: 12,
        opacity: 0.75,
      },
    }),
    deltaCell: css({
      minWidth: 220,
      fontSize: 12,
      whiteSpace: 'nowrap',
    }),
    rowMeta: css({
      display: 'block',
      fontSize: 12,
      opacity: 0.65,
    }),
    usageMeter: css({
      minWidth: 142,
      width: 150,
    }),
    usageMeterText: css({
      alignItems: 'baseline',
      display: 'flex',
      gap: 4,
      whiteSpace: 'nowrap',
    }),
    usageMeterMeta: css({
      fontSize: 11,
      opacity: 0.68,
    }),
    usageMeterTrack: css({
      background: 'rgba(128, 128, 128, 0.22)',
      borderRadius: 3,
      height: 6,
      marginTop: 4,
      overflow: 'hidden',
      width: '100%',
    }),
    usageMeterFill: css({
      borderRadius: 3,
      height: '100%',
      minWidth: 0,
    }),
    usageMeterFillNoRequest: css({
      background: 'rgba(128, 128, 128, 0.65)',
    }),
    usageMeterFillLow: css({
      background: 'rgba(2, 119, 189, 0.9)',
    }),
    usageMeterFillOk: css({
      background: 'rgba(46, 125, 50, 0.95)',
    }),
    usageMeterFillWarning: css({
      background: 'linear-gradient(90deg, rgba(46, 125, 50, 0.95), rgba(245, 124, 0, 0.95))',
    }),
    usageMeterFillOver: css({
      background: 'rgba(230, 81, 0, 0.95)',
    }),
    usageMeterFillHigh: css({
      background: 'rgba(211, 47, 47, 0.95)',
    }),
    usageMeterBadge: css({
      border: '1px solid transparent',
      borderRadius: 3,
      display: 'inline-block',
      fontSize: 11,
      lineHeight: '16px',
      marginTop: 4,
      padding: '0 5px',
      whiteSpace: 'nowrap',
    }),
    usageMeterBadgeNoRequest: css({
      background: 'rgba(128, 128, 128, 0.14)',
      borderColor: 'rgba(128, 128, 128, 0.42)',
    }),
    usageMeterBadgeLow: css({
      background: 'rgba(2, 119, 189, 0.12)',
      borderColor: 'rgba(2, 119, 189, 0.45)',
    }),
    usageMeterBadgeOk: css({
      background: 'rgba(46, 125, 50, 0.12)',
      borderColor: 'rgba(46, 125, 50, 0.42)',
    }),
    usageMeterBadgeWarning: css({
      background: 'rgba(245, 124, 0, 0.13)',
      borderColor: 'rgba(245, 124, 0, 0.5)',
    }),
    usageMeterBadgeOver: css({
      background: 'rgba(230, 81, 0, 0.14)',
      borderColor: 'rgba(230, 81, 0, 0.55)',
    }),
    usageMeterBadgeHigh: css({
      background: 'rgba(211, 47, 47, 0.14)',
      borderColor: 'rgba(211, 47, 47, 0.58)',
    }),
    srOnly: css({
      border: 0,
      clip: 'rect(0 0 0 0)',
      height: 1,
      margin: -1,
      overflow: 'hidden',
      padding: 0,
      position: 'absolute',
      whiteSpace: 'nowrap',
      width: 1,
    }),
  };
}
