// Pure formatting helpers for the Resource Simulator's tables/inputs - split
// out of ResourceSimulatorObject.tsx (which was pushing 2400+ lines) since
// none of these touch React/JSX, scene state, or the CSS-in-JS styles object;
// they're plain value-in/string-out functions the tables call while rendering.
import { ComboboxOption } from '@grafana/ui';
import {
  BYTES_PER_GIB,
  calculateSimulatorResults,
  KafkaPoolSimulationRow,
  SimulatorResultRow,
  SimulatorRowUnit,
  WorkloadSimulationRow,
  WorkloadType,
} from './resourceSimulatorModel';

export type UsageMeterUnit = 'cores' | 'bytes';

// Lives here (rather than duplicated in ResourceSimulatorObject.tsx) so the
// workload-type Combobox and formatWorkloadType's lookup below always agree.
export const WORKLOAD_TYPE_OPTIONS: Array<ComboboxOption<WorkloadType>> = [
  { label: 'Deployment', value: 'deployment' },
  { label: 'StatefulSet', value: 'statefulset' },
];

export function formatQuantityNumber(value: number) {
  return Number(value.toFixed(3)).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function formatMillicores(cores: number) {
  if (!Number.isFinite(cores) || cores <= 0) {
    return '0m';
  }

  return `${formatQuantityNumber(cores * 1000)}m`;
}

export function formatCores(cores: number) {
  if (!Number.isFinite(cores) || cores <= 0) {
    return '0 cores';
  }

  return `${formatQuantityNumber(cores)} cores`;
}

export function formatMiB(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0Mi';
  }

  return `${formatQuantityNumber(bytes / 1024 ** 2)}Mi`;
}

export function formatGiB(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0Gi';
  }

  return `${formatQuantityNumber(bytes / BYTES_PER_GIB)}Gi`;
}

export function formatMeterPair(used: number, requested: number, unit: UsageMeterUnit) {
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

export function formatWorkloadType(type: WorkloadType) {
  return WORKLOAD_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

export function formatKafkaRole(role: KafkaPoolSimulationRow['role']) {
  return role === 'broker' ? 'Broker' : 'Controller';
}

export function formatValue(value: number, unit: SimulatorRowUnit) {
  if (unit === 'cores') {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  if (unit === 'bytes') {
    return `${(value / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB`;
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function formatContainerCount(row: WorkloadSimulationRow) {
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

export function formatPercentage(ratio: number) {
  return `${(ratio * 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}%`;
}

export function formatDelta(value: number, unit: SimulatorRowUnit) {
  if (Math.abs(value) < 0.000001) {
    return '+0';
  }

  return value > 0 ? `+${formatValue(value, unit)}` : formatValue(value, unit);
}

export function formatWorkloadDelta(delta?: ReturnType<typeof calculateSimulatorResults>['workloadDeltas'][string]) {
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

export function formatUsageSummary(row: SimulatorResultRow) {
  if (row.ratio !== undefined) {
    return `${formatPercentage(row.ratio)} of ${formatValue(row.hard ?? 0, row.unit)}`;
  }

  if (row.status === 'unlimited') {
    return 'Unlimited';
  }

  return row.source === 'capacity' ? 'No capacity data' : 'No limit data';
}

export function formatUsageValue(row: SimulatorResultRow) {
  return row.ratio === undefined ? '-' : formatPercentage(row.ratio);
}

export function formatLimitValue(row: SimulatorResultRow) {
  if (row.hard !== undefined) {
    return formatValue(row.hard, row.unit);
  }

  return row.status === 'unlimited' ? 'Unlimited' : 'Unknown';
}

export function formatLiveHardValue(row: SimulatorResultRow) {
  return row.liveHard === undefined ? 'Unlimited' : formatValue(row.liveHard, row.unit);
}

export function formatRemainingValue(row: SimulatorResultRow) {
  if (row.remaining !== undefined) {
    return row.remaining < 0
      ? `${formatValue(Math.abs(row.remaining), row.unit)} over`
      : formatValue(row.remaining, row.unit);
  }

  return row.status === 'unlimited' ? 'Unlimited' : '-';
}

export function formatRemainingSummary(row: SimulatorResultRow) {
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

export function formatInputValue(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}
