export const BYTES_PER_GIB = 1024 ** 3;

export type WorkloadType = 'deployment' | 'statefulset';
export type KafkaPoolRole = 'broker' | 'controller';

export type WorkloadContainerValues = {
  name: string;
  cpuRequestCores: number;
  cpuLimitCores: number;
  memoryRequestGiB: number;
  memoryLimitGiB: number;
};

export type WorkloadEditableValues = {
  simulatedReplicas: number;
  containers: WorkloadContainerValues[];
  pvcCount: number;
  pvcStorageGiB: number;
};

export type WorkloadScenarioRow = WorkloadEditableValues & {
  id: string;
  name: string;
  type: WorkloadType;
};

export type WorkloadScenarioState = {
  overrides: Record<string, WorkloadEditableValues>;
  tempRows: WorkloadScenarioRow[];
  kafkaOverrides: Record<string, KafkaEditableValues>;
  tempKafkaRows: KafkaScenarioRow[];
  quotaOverrides: Record<string, number>;
};

export const DEFAULT_WORKLOAD_SCENARIO: WorkloadScenarioState = {
  overrides: {},
  tempRows: [],
  kafkaOverrides: {},
  tempKafkaRows: [],
  quotaOverrides: {},
};

export const DEFAULT_WORKLOAD_CONTAINER_VALUES: WorkloadContainerValues = {
  name: 'app',
  cpuRequestCores: 0.5,
  cpuLimitCores: 1,
  memoryRequestGiB: 1,
  memoryLimitGiB: 2,
};

export const DEFAULT_WORKLOAD_VALUES: WorkloadEditableValues = {
  simulatedReplicas: 1,
  containers: [{ ...DEFAULT_WORKLOAD_CONTAINER_VALUES }],
  pvcCount: 0,
  pvcStorageGiB: 0,
};

export type KafkaPoolEditableValues = WorkloadEditableValues & {
  id: string;
  name: string;
  role: KafkaPoolRole;
};

export type KafkaEditableValues = {
  pools: KafkaPoolEditableValues[];
};

export type KafkaScenarioRow = KafkaEditableValues & {
  id: string;
  name: string;
};

export const DEFAULT_KAFKA_VALUES: KafkaEditableValues = {
  pools: [
    {
      id: 'broker',
      name: 'broker',
      role: 'broker',
      simulatedReplicas: 3,
      containers: [{ name: 'kafka', cpuRequestCores: 1, cpuLimitCores: 0, memoryRequestGiB: 10, memoryLimitGiB: 10 }],
      pvcCount: 3,
      pvcStorageGiB: 800,
    },
    {
      id: 'controller',
      name: 'controller',
      role: 'controller',
      simulatedReplicas: 3,
      containers: [{ name: 'kafka', cpuRequestCores: 0.2, cpuLimitCores: 0, memoryRequestGiB: 1, memoryLimitGiB: 1 }],
      pvcCount: 3,
      pvcStorageGiB: 5,
    },
  ],
};

export type MetricSample = {
  refId: string;
  labels: Record<string, string>;
  value: number;
};

export type ResourceQuotaPair = {
  used?: number;
  hard?: number;
};

export type WorkloadContainerBaseline = {
  name: string;
  currentInstances: number;
  currentCpuRequests: number;
  currentCpuLimits: number;
  currentMemoryRequests: number;
  currentMemoryLimits: number;
  currentCpuUsage: number;
  currentMemoryWorkingSet: number;
};

export type WorkloadBaseline = {
  id: string;
  name: string;
  type: WorkloadType;
  currentReplicas: number;
  currentPods: number;
  currentContainers: number;
  containerBaselines: WorkloadContainerBaseline[];
  currentCpuRequests: number;
  currentCpuLimits: number;
  currentMemoryRequests: number;
  currentMemoryLimits: number;
  currentCpuUsage: number;
  currentMemoryWorkingSet: number;
  currentPvcCount: number;
  currentPvcStorageBytes: number;
  currentPvcUsedBytes: number;
};

export type KafkaPoolBaseline = {
  id: string;
  name: string;
  role: KafkaPoolRole;
  currentReplicas: number;
  currentContainers: number;
  containerBaselines: WorkloadContainerBaseline[];
  currentCpuRequests: number;
  currentCpuLimits: number;
  currentMemoryRequests: number;
  currentMemoryLimits: number;
  currentCpuUsage: number;
  currentMemoryWorkingSet: number;
  currentPvcCount: number;
  currentPvcStorageBytes: number;
  currentPvcUsedBytes: number;
};

export type KafkaInstanceBaseline = {
  id: string;
  name: string;
  pools: KafkaPoolBaseline[];
};

export type SimulatorBaseline = {
  quotas: Record<string, ResourceQuotaPair>;
  workloads: WorkloadBaseline[];
  kafkaInstances: KafkaInstanceBaseline[];
  clusterAllocatable: Record<string, number>;
};

export type WorkloadSimulationRow = WorkloadBaseline &
  WorkloadEditableValues & {
    isTemporary: boolean;
    changed: boolean;
    isScaledToZero: boolean;
    missingResourceBaseline: boolean;
  };

export type KafkaPoolSimulationRow = KafkaPoolBaseline &
  WorkloadEditableValues & {
    changed: boolean;
    missingResourceBaseline: boolean;
  };

export type KafkaSimulationRow = {
  id: string;
  name: string;
  pools: KafkaPoolSimulationRow[];
  isTemporary: boolean;
  changed: boolean;
  currentReplicas: number;
  simulatedReplicas: number;
  currentCpuRequests: number;
  currentCpuLimits: number;
  currentMemoryRequests: number;
  currentMemoryLimits: number;
  currentCpuUsage: number;
  currentMemoryWorkingSet: number;
  currentPvcCount: number;
  currentPvcStorageBytes: number;
  currentPvcUsedBytes: number;
  simulatedCpuRequests: number;
  simulatedCpuLimits: number;
  simulatedMemoryRequests: number;
  simulatedMemoryLimits: number;
  simulatedPvcCount: number;
  simulatedPvcStorageBytes: number;
  missingResourceBaseline: boolean;
};

export type SimulatorRowStatus = 'ok' | 'warning' | 'exceeded' | 'unlimited' | 'unknown';
export type SimulatorRowUnit = 'count' | 'cores' | 'bytes';
export type SimulatorRowSource = 'quota' | 'capacity';

export type SimulatorResultRow = {
  key: string;
  label: string;
  unit: SimulatorRowUnit;
  source: SimulatorRowSource;
  baseline: number;
  delta: number;
  projected: number;
  hard?: number;
  liveHard?: number;
  hardEdited: boolean;
  remaining?: number;
  ratio?: number;
  status: SimulatorRowStatus;
};

export type WorkloadDelta = {
  rowId: string;
  pods: number;
  cpuRequests: number;
  cpuLimits: number;
  memoryRequests: number;
  memoryLimits: number;
  pvcCount: number;
  pvcStorage: number;
  deploymentObjects: number;
  statefulSetObjects: number;
  configMapObjects: number;
  secretObjects: number;
  serviceObjects: number;
};

export type SimulatorResults = {
  rows: SimulatorResultRow[];
  workloadRows: WorkloadSimulationRow[];
  kafkaRows: KafkaSimulationRow[];
  workloadDeltas: Record<string, WorkloadDelta>;
  kafkaDeltas: Record<string, WorkloadDelta>;
  warnings: string[];
  deltas: Omit<WorkloadDelta, 'rowId'>;
};

export const SIMULATOR_QUOTA_RESOURCE_KEYS = [
  'requests.cpu',
  'requests.memory',
  'limits.cpu',
  'limits.memory',
  'requests.storage',
  'pods',
  'count/deployments.apps',
  'count/statefulsets.apps',
  'count/persistentvolumeclaims',
  'count/configmaps',
  'count/secrets',
  'count/services',
] as const;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function workloadId(type: WorkloadType, name: string) {
  return `${type}/${name}`;
}

function workloadTypeFromLabel(value?: string): WorkloadType | undefined {
  return value === 'deployment' || value === 'statefulset' ? value : undefined;
}

function kafkaPoolRoleFromLabel(value?: string): KafkaPoolRole | undefined {
  return value === 'broker' || value === 'controller' ? value : undefined;
}

function ensureWorkload(map: Map<string, WorkloadBaseline>, labels: Record<string, string>) {
  const name = labels.workload;
  const type = workloadTypeFromLabel(labels.workload_type);

  if (!name || !type) {
    return undefined;
  }

  const id = workloadId(type, name);
  let workload = map.get(id);

  if (!workload) {
    workload = {
      id,
      name,
      type,
      currentReplicas: 0,
      currentPods: 0,
      currentContainers: 0,
      containerBaselines: [],
      currentCpuRequests: 0,
      currentCpuLimits: 0,
      currentMemoryRequests: 0,
      currentMemoryLimits: 0,
      currentCpuUsage: 0,
      currentMemoryWorkingSet: 0,
      currentPvcCount: 0,
      currentPvcStorageBytes: 0,
      currentPvcUsedBytes: 0,
    };
    map.set(id, workload);
  }

  return workload;
}

function ensureKafkaPool(map: Map<string, KafkaInstanceBaseline>, labels: Record<string, string>) {
  const kafkaName = labels.kafka;
  const poolName = labels.pool;
  const role = kafkaPoolRoleFromLabel(labels.role);

  if (!kafkaName || !poolName || !role) {
    return undefined;
  }

  let instance = map.get(kafkaName);

  if (!instance) {
    instance = {
      id: kafkaName,
      name: kafkaName,
      pools: [],
    };
    map.set(kafkaName, instance);
  }

  const poolId = `${kafkaName}/${poolName}`;
  let pool = instance.pools.find((candidate) => candidate.id === poolId);

  if (!pool) {
    pool = {
      id: poolId,
      name: poolName,
      role,
      currentReplicas: 0,
      currentContainers: 0,
      containerBaselines: [],
      currentCpuRequests: 0,
      currentCpuLimits: 0,
      currentMemoryRequests: 0,
      currentMemoryLimits: 0,
      currentCpuUsage: 0,
      currentMemoryWorkingSet: 0,
      currentPvcCount: 0,
      currentPvcStorageBytes: 0,
      currentPvcUsedBytes: 0,
    };
    instance.pools.push(pool);
  }

  return pool;
}

function ensureContainer(workload: { containerBaselines: WorkloadContainerBaseline[] }, name: string) {
  const containerName = name.trim();

  if (!containerName) {
    return undefined;
  }

  let container = workload.containerBaselines.find((candidate) => candidate.name === containerName);

  if (!container) {
    container = {
      name: containerName,
      currentInstances: 0,
      currentCpuRequests: 0,
      currentCpuLimits: 0,
      currentMemoryRequests: 0,
      currentMemoryLimits: 0,
      currentCpuUsage: 0,
      currentMemoryWorkingSet: 0,
    };
    workload.containerBaselines.push(container);
  }

  return container;
}

export function buildBaseline(samples: MetricSample[]): SimulatorBaseline {
  const quotas: Record<string, ResourceQuotaPair> = {};
  const workloads = new Map<string, WorkloadBaseline>();
  const kafkaInstances = new Map<string, KafkaInstanceBaseline>();
  const clusterAllocatable: Record<string, number> = {};

  for (const sample of samples) {
    if (!finite(sample.value)) {
      continue;
    }

    if (sample.refId === 'quota') {
      const resource = sample.labels.resource;
      const type = sample.labels.type;

      if (!resource || (type !== 'used' && type !== 'hard')) {
        continue;
      }

      quotas[resource] = {
        ...quotas[resource],
        [type]: (quotas[resource]?.[type] ?? 0) + sample.value,
      };
      continue;
    }

    if (sample.refId === 'allocatable') {
      const resource = sample.labels.resource;

      if (resource) {
        clusterAllocatable[resource] = (clusterAllocatable[resource] ?? 0) + sample.value;
      }
      continue;
    }

    if (sample.refId.startsWith('kafka')) {
      const pool = ensureKafkaPool(kafkaInstances, sample.labels);

      if (!pool) {
        continue;
      }

      const container = sample.labels.container ? ensureContainer(pool, sample.labels.container) : undefined;

      if (sample.refId === 'kafkaPods') {
        pool.currentReplicas += sample.value;
      } else if (sample.refId === 'kafkaContainers') {
        pool.currentContainers += sample.value;
        if (container) {
          container.currentInstances += sample.value;
        }
      } else if (sample.refId === 'kafkaRequests' && sample.labels.resource === 'cpu') {
        pool.currentCpuRequests += sample.value;
        if (container) {
          container.currentCpuRequests += sample.value;
        }
      } else if (sample.refId === 'kafkaRequests' && sample.labels.resource === 'memory') {
        pool.currentMemoryRequests += sample.value;
        if (container) {
          container.currentMemoryRequests += sample.value;
        }
      } else if (sample.refId === 'kafkaLimits' && sample.labels.resource === 'cpu') {
        pool.currentCpuLimits += sample.value;
        if (container) {
          container.currentCpuLimits += sample.value;
        }
      } else if (sample.refId === 'kafkaLimits' && sample.labels.resource === 'memory') {
        pool.currentMemoryLimits += sample.value;
        if (container) {
          container.currentMemoryLimits += sample.value;
        }
      } else if (sample.refId === 'kafkaCpuUsage') {
        pool.currentCpuUsage += sample.value;
        if (container) {
          container.currentCpuUsage += sample.value;
        }
      } else if (sample.refId === 'kafkaMemoryUsage') {
        pool.currentMemoryWorkingSet += sample.value;
        if (container) {
          container.currentMemoryWorkingSet += sample.value;
        }
      } else if (sample.refId === 'kafkaPvcCount') {
        pool.currentPvcCount += sample.value;
      } else if (sample.refId === 'kafkaPvcStorage') {
        pool.currentPvcStorageBytes += sample.value;
      } else if (sample.refId === 'kafkaPvcUsed') {
        pool.currentPvcUsedBytes += sample.value;
      }

      continue;
    }

    const workload = ensureWorkload(workloads, sample.labels);

    if (!workload) {
      continue;
    }

    const container = sample.labels.container ? ensureContainer(workload, sample.labels.container) : undefined;

    if (sample.refId === 'workloadReplicas') {
      workload.currentReplicas += sample.value;
    } else if (sample.refId === 'workloadPods') {
      workload.currentPods += sample.value;
    } else if (sample.refId === 'workloadContainers') {
      workload.currentContainers += sample.value;
      if (container) {
        container.currentInstances += sample.value;
      }
    } else if (sample.refId === 'workloadRequests' && sample.labels.resource === 'cpu') {
      workload.currentCpuRequests += sample.value;
      if (container) {
        container.currentCpuRequests += sample.value;
      }
    } else if (sample.refId === 'workloadRequests' && sample.labels.resource === 'memory') {
      workload.currentMemoryRequests += sample.value;
      if (container) {
        container.currentMemoryRequests += sample.value;
      }
    } else if (sample.refId === 'workloadLimits' && sample.labels.resource === 'cpu') {
      workload.currentCpuLimits += sample.value;
      if (container) {
        container.currentCpuLimits += sample.value;
      }
    } else if (sample.refId === 'workloadLimits' && sample.labels.resource === 'memory') {
      workload.currentMemoryLimits += sample.value;
      if (container) {
        container.currentMemoryLimits += sample.value;
      }
    } else if (sample.refId === 'workloadCpuUsage') {
      workload.currentCpuUsage += sample.value;
      if (container) {
        container.currentCpuUsage += sample.value;
      }
    } else if (sample.refId === 'workloadMemoryUsage') {
      workload.currentMemoryWorkingSet += sample.value;
      if (container) {
        container.currentMemoryWorkingSet += sample.value;
      }
    } else if (sample.refId === 'workloadPvcCount') {
      workload.currentPvcCount += sample.value;
    } else if (sample.refId === 'workloadPvcStorage') {
      workload.currentPvcStorageBytes += sample.value;
    } else if (sample.refId === 'workloadPvcUsed') {
      workload.currentPvcUsedBytes += sample.value;
    }
  }

  const workloadRows = Array.from(workloads.values()).sort(
    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
  );

  for (const workload of workloadRows) {
    workload.containerBaselines.sort((a, b) => a.name.localeCompare(b.name));
  }

  const kafkaRows = Array.from(kafkaInstances.values()).sort((a, b) => a.name.localeCompare(b.name));

  for (const kafka of kafkaRows) {
    kafka.pools.sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));

    for (const pool of kafka.pools) {
      pool.containerBaselines.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  return {
    quotas,
    workloads: workloadRows,
    kafkaInstances: kafkaRows,
    clusterAllocatable,
  };
}

export function parseScenario(value?: string): WorkloadScenarioState {
  if (!value) {
    return DEFAULT_WORKLOAD_SCENARIO;
  }

  try {
    const parsed = JSON.parse(value) as Partial<WorkloadScenarioState>;
    return normalizeScenario(parsed);
  } catch {
    return DEFAULT_WORKLOAD_SCENARIO;
  }
}

export function serializeScenario(scenario: WorkloadScenarioState) {
  return JSON.stringify(normalizeScenario(scenario));
}

export function normalizeScenario(scenario: Partial<WorkloadScenarioState> = {}): WorkloadScenarioState {
  const overrides: Record<string, WorkloadEditableValues> = {};
  const tempRows: WorkloadScenarioRow[] = [];
  const kafkaOverrides: Record<string, KafkaEditableValues> = {};
  const tempKafkaRows: KafkaScenarioRow[] = [];
  const quotaOverrides: Record<string, number> = {};

  for (const [id, values] of Object.entries(scenario.overrides ?? {})) {
    const normalized = normalizeEditableValues(values);

    if (normalized) {
      overrides[id] = normalized;
    }
  }

  for (const row of scenario.tempRows ?? []) {
    const normalized = normalizeEditableValues(row);
    const type = workloadTypeFromLabel(row.type);

    if (!normalized || !type || !row.id) {
      continue;
    }

    tempRows.push({
      ...normalized,
      id: String(row.id),
      name: String(row.name || row.id),
      type,
    });
  }

  for (const [id, values] of Object.entries(scenario.kafkaOverrides ?? {})) {
    const normalized = normalizeKafkaEditableValues(values);

    if (normalized) {
      kafkaOverrides[id] = normalized;
    }
  }

  for (const row of scenario.tempKafkaRows ?? []) {
    const normalized = normalizeKafkaEditableValues(row);

    if (!normalized || !row.id) {
      continue;
    }

    tempKafkaRows.push({
      ...normalized,
      id: String(row.id),
      name: String(row.name || row.id),
    });
  }

  for (const [resource, value] of Object.entries(scenario.quotaOverrides ?? {})) {
    if (!isSimulatorQuotaResource(resource) || !finite(value) || value < 0) {
      continue;
    }

    quotaOverrides[resource] = value;
  }

  return { overrides, tempRows, kafkaOverrides, tempKafkaRows, quotaOverrides };
}

function isSimulatorQuotaResource(value: string): value is (typeof SIMULATOR_QUOTA_RESOURCE_KEYS)[number] {
  return (SIMULATOR_QUOTA_RESOURCE_KEYS as readonly string[]).includes(value);
}

function normalizeEditableValues(values?: Partial<WorkloadEditableValues>) {
  if (!values) {
    return undefined;
  }

  return {
    simulatedReplicas: Math.max(0, numberOrDefault(values.simulatedReplicas, 0)),
    containers: normalizeContainers(values.containers),
    pvcCount: Math.max(0, numberOrDefault(values.pvcCount, 0)),
    pvcStorageGiB: Math.max(0, numberOrDefault(values.pvcStorageGiB, 0)),
  };
}

function normalizeKafkaEditableValues(values?: Partial<KafkaEditableValues>) {
  if (!values || !Array.isArray(values.pools)) {
    return undefined;
  }

  const pools = values.pools.flatMap((pool, index) => {
    const normalized = normalizeEditableValues(pool);
    const role = kafkaPoolRoleFromLabel(pool?.role);

    if (!normalized || !role || !pool?.id) {
      return [];
    }

    return [
      {
        ...normalized,
        id: String(pool.id),
        name: String(pool.name || pool.id || `pool-${index + 1}`),
        role,
      },
    ];
  });

  return pools.length > 0 ? { pools } : undefined;
}

function normalizeContainers(containers: WorkloadEditableValues['containers'] | undefined) {
  if (!Array.isArray(containers)) {
    return defaultContainers();
  }

  const normalized = containers.flatMap((container, index) => {
    if (!container || typeof container !== 'object') {
      return [];
    }

    return [
      {
        name: normalizeContainerName(container.name, index),
        cpuRequestCores: Math.max(0, numberOrDefault(container.cpuRequestCores, 0)),
        cpuLimitCores: Math.max(0, numberOrDefault(container.cpuLimitCores, 0)),
        memoryRequestGiB: Math.max(0, numberOrDefault(container.memoryRequestGiB, 0)),
        memoryLimitGiB: Math.max(0, numberOrDefault(container.memoryLimitGiB, 0)),
      },
    ];
  });

  return normalized.length > 0 ? normalized : defaultContainers();
}

function normalizeContainerName(value: unknown, index: number) {
  const name = typeof value === 'string' ? value.trim() : '';
  return name || `container-${index + 1}`;
}

function numberOrDefault(value: unknown, fallback: number) {
  return finite(value) ? value : fallback;
}

function defaultContainers() {
  return [{ ...DEFAULT_WORKLOAD_CONTAINER_VALUES }];
}

export function linkedPvcCountForReplicaChange(
  values: {
    currentReplicas: number;
    currentPvcCount: number;
    simulatedReplicas: number;
    pvcCount: number;
  },
  nextReplicas: number
) {
  if (values.currentReplicas <= 0 || values.currentPvcCount <= 0) {
    return undefined;
  }

  const pvcPerReplica = values.currentPvcCount / values.currentReplicas;

  if (!Number.isInteger(pvcPerReplica)) {
    return undefined;
  }

  const linkedCurrentPvcCount = Math.max(values.currentPvcCount, values.simulatedReplicas * pvcPerReplica);

  if (values.pvcCount !== linkedCurrentPvcCount) {
    return undefined;
  }

  return Math.max(values.currentPvcCount, nextReplicas * pvcPerReplica);
}

function editableDefaults(workload: WorkloadBaseline): WorkloadEditableValues {
  const replicaBasis = workload.currentReplicas > 0 ? workload.currentReplicas : workload.currentPods;
  const containers =
    workload.containerBaselines.length > 0
      ? workload.containerBaselines.map((container) => ({
          name: container.name,
          cpuRequestCores: replicaBasis > 0 ? container.currentCpuRequests / replicaBasis : 0,
          cpuLimitCores: replicaBasis > 0 ? container.currentCpuLimits / replicaBasis : 0,
          memoryRequestGiB: replicaBasis > 0 ? container.currentMemoryRequests / replicaBasis / BYTES_PER_GIB : 0,
          memoryLimitGiB: replicaBasis > 0 ? container.currentMemoryLimits / replicaBasis / BYTES_PER_GIB : 0,
        }))
      : [
          {
            name: 'container',
            cpuRequestCores: replicaBasis > 0 ? workload.currentCpuRequests / replicaBasis : 0,
            cpuLimitCores: replicaBasis > 0 ? workload.currentCpuLimits / replicaBasis : 0,
            memoryRequestGiB: replicaBasis > 0 ? workload.currentMemoryRequests / replicaBasis / BYTES_PER_GIB : 0,
            memoryLimitGiB: replicaBasis > 0 ? workload.currentMemoryLimits / replicaBasis / BYTES_PER_GIB : 0,
          },
        ];

  return {
    simulatedReplicas: Math.max(0, workload.currentReplicas > 0 ? workload.currentReplicas : workload.currentPods),
    containers,
    pvcCount: workload.currentPvcCount,
    pvcStorageGiB:
      workload.currentPvcCount > 0 ? workload.currentPvcStorageBytes / workload.currentPvcCount / BYTES_PER_GIB : 0,
  };
}

function editableDefaultsFromPool(pool: KafkaPoolBaseline): KafkaPoolEditableValues {
  return {
    ...editableDefaults({
      ...pool,
      type: 'statefulset',
      currentPods: pool.currentReplicas,
    }),
    id: pool.id,
    name: pool.name,
    role: pool.role,
  };
}

export function buildWorkloadRows(
  baseline: SimulatorBaseline,
  scenario: WorkloadScenarioState
): WorkloadSimulationRow[] {
  const rows = baseline.workloads.map((workload) => {
    const defaults = editableDefaults(workload);
    const override = scenario.overrides[workload.id];
    const values = override ?? defaults;
    const isScaledToZero =
      workload.currentReplicas === 0 && workload.currentPods === 0 && workload.currentContainers === 0;
    const hasResourceBaseline =
      workload.currentCpuRequests > 0 ||
      workload.currentMemoryRequests > 0 ||
      workload.currentCpuLimits > 0 ||
      workload.currentMemoryLimits > 0;

    return {
      ...workload,
      ...values,
      isTemporary: false,
      changed: Boolean(override),
      isScaledToZero,
      missingResourceBaseline: !isScaledToZero && (workload.currentContainers === 0 || !hasResourceBaseline),
    };
  });

  for (const temp of scenario.tempRows) {
    rows.push({
      ...temp,
      currentReplicas: 0,
      currentPods: 0,
      currentContainers: 0,
      containerBaselines: [],
      currentCpuRequests: 0,
      currentCpuLimits: 0,
      currentMemoryRequests: 0,
      currentMemoryLimits: 0,
      currentCpuUsage: 0,
      currentMemoryWorkingSet: 0,
      currentPvcCount: 0,
      currentPvcStorageBytes: 0,
      currentPvcUsedBytes: 0,
      isTemporary: true,
      changed: true,
      isScaledToZero: false,
      missingResourceBaseline: false,
    });
  }

  return rows;
}

export function buildKafkaRows(baseline: SimulatorBaseline, scenario: WorkloadScenarioState): KafkaSimulationRow[] {
  const rows = baseline.kafkaInstances.map((instance) => {
    const override = scenario.kafkaOverrides[instance.id];
    const pools = instance.pools.map((pool) => {
      const defaults = editableDefaultsFromPool(pool);
      const values = override?.pools.find((candidate) => candidate.id === pool.id) ?? defaults;
      const hasResourceBaseline =
        pool.currentCpuRequests > 0 ||
        pool.currentMemoryRequests > 0 ||
        pool.currentCpuLimits > 0 ||
        pool.currentMemoryLimits > 0;

      return {
        ...pool,
        ...values,
        changed: Boolean(override),
        missingResourceBaseline: pool.currentReplicas > 0 && (pool.currentContainers === 0 || !hasResourceBaseline),
      };
    });

    return kafkaSimulationRow(instance.id, instance.name, pools, false);
  });

  for (const temp of scenario.tempKafkaRows) {
    rows.push(
      kafkaSimulationRow(
        temp.id,
        temp.name,
        temp.pools.map((pool) => ({
          ...pool,
          currentReplicas: 0,
          currentContainers: 0,
          containerBaselines: [],
          currentCpuRequests: 0,
          currentCpuLimits: 0,
          currentMemoryRequests: 0,
          currentMemoryLimits: 0,
          currentCpuUsage: 0,
          currentMemoryWorkingSet: 0,
          currentPvcCount: 0,
          currentPvcStorageBytes: 0,
          currentPvcUsedBytes: 0,
          changed: true,
          missingResourceBaseline: false,
        })),
        true
      )
    );
  }

  return rows;
}

function kafkaSimulationRow(
  id: string,
  name: string,
  pools: KafkaPoolSimulationRow[],
  isTemporary: boolean
): KafkaSimulationRow {
  const totals = pools.reduce(
    (acc, pool) => {
      const podTotals = containerResourceTotals(pool.containers);

      return {
        currentReplicas: acc.currentReplicas + pool.currentReplicas,
        simulatedReplicas: acc.simulatedReplicas + pool.simulatedReplicas,
        currentCpuRequests: acc.currentCpuRequests + pool.currentCpuRequests,
        currentCpuLimits: acc.currentCpuLimits + pool.currentCpuLimits,
        currentMemoryRequests: acc.currentMemoryRequests + pool.currentMemoryRequests,
        currentMemoryLimits: acc.currentMemoryLimits + pool.currentMemoryLimits,
        currentCpuUsage: acc.currentCpuUsage + pool.currentCpuUsage,
        currentMemoryWorkingSet: acc.currentMemoryWorkingSet + pool.currentMemoryWorkingSet,
        currentPvcCount: acc.currentPvcCount + pool.currentPvcCount,
        currentPvcStorageBytes: acc.currentPvcStorageBytes + pool.currentPvcStorageBytes,
        currentPvcUsedBytes: acc.currentPvcUsedBytes + pool.currentPvcUsedBytes,
        simulatedCpuRequests: acc.simulatedCpuRequests + pool.simulatedReplicas * podTotals.cpuRequests,
        simulatedCpuLimits: acc.simulatedCpuLimits + pool.simulatedReplicas * podTotals.cpuLimits,
        simulatedMemoryRequests:
          acc.simulatedMemoryRequests + pool.simulatedReplicas * podTotals.memoryRequests * BYTES_PER_GIB,
        simulatedMemoryLimits:
          acc.simulatedMemoryLimits + pool.simulatedReplicas * podTotals.memoryLimits * BYTES_PER_GIB,
        simulatedPvcCount: acc.simulatedPvcCount + pool.pvcCount,
        simulatedPvcStorageBytes:
          acc.simulatedPvcStorageBytes +
          Math.max(pool.currentPvcStorageBytes, pool.pvcCount * pool.pvcStorageGiB * BYTES_PER_GIB),
      };
    },
    {
      currentReplicas: 0,
      simulatedReplicas: 0,
      currentCpuRequests: 0,
      currentCpuLimits: 0,
      currentMemoryRequests: 0,
      currentMemoryLimits: 0,
      currentCpuUsage: 0,
      currentMemoryWorkingSet: 0,
      currentPvcCount: 0,
      currentPvcStorageBytes: 0,
      currentPvcUsedBytes: 0,
      simulatedCpuRequests: 0,
      simulatedCpuLimits: 0,
      simulatedMemoryRequests: 0,
      simulatedMemoryLimits: 0,
      simulatedPvcCount: 0,
      simulatedPvcStorageBytes: 0,
    }
  );

  return {
    id,
    name,
    pools,
    isTemporary,
    changed: isTemporary || pools.some((pool) => pool.changed),
    missingResourceBaseline: pools.some((pool) => pool.missingResourceBaseline),
    ...totals,
  };
}

export function containerResourceTotals(containers: WorkloadContainerValues[]) {
  return containers.reduce(
    (totals, container) => ({
      cpuRequests: totals.cpuRequests + Math.max(0, numberOrDefault(container.cpuRequestCores, 0)),
      cpuLimits: totals.cpuLimits + Math.max(0, numberOrDefault(container.cpuLimitCores, 0)),
      memoryRequests: totals.memoryRequests + Math.max(0, numberOrDefault(container.memoryRequestGiB, 0)),
      memoryLimits: totals.memoryLimits + Math.max(0, numberOrDefault(container.memoryLimitGiB, 0)),
    }),
    {
      cpuRequests: 0,
      cpuLimits: 0,
      memoryRequests: 0,
      memoryLimits: 0,
    }
  );
}

function workloadDelta(row: WorkloadSimulationRow): WorkloadDelta {
  const podTotals = containerResourceTotals(row.containers);
  const currentReplicaBasis = row.currentReplicas > 0 ? row.currentReplicas : row.currentPods;
  const simulatedCpuRequests = row.simulatedReplicas * podTotals.cpuRequests;
  const simulatedCpuLimits = row.simulatedReplicas * podTotals.cpuLimits;
  const simulatedMemoryRequests = row.simulatedReplicas * podTotals.memoryRequests * BYTES_PER_GIB;
  const simulatedMemoryLimits = row.simulatedReplicas * podTotals.memoryLimits * BYTES_PER_GIB;
  const simulatedPvcStorage = Math.max(row.currentPvcStorageBytes, row.pvcCount * row.pvcStorageGiB * BYTES_PER_GIB);

  return {
    rowId: row.id,
    pods: row.simulatedReplicas - currentReplicaBasis,
    cpuRequests: simulatedCpuRequests - row.currentCpuRequests,
    cpuLimits: simulatedCpuLimits - row.currentCpuLimits,
    memoryRequests: simulatedMemoryRequests - row.currentMemoryRequests,
    memoryLimits: simulatedMemoryLimits - row.currentMemoryLimits,
    pvcCount: row.pvcCount - row.currentPvcCount,
    pvcStorage: simulatedPvcStorage - row.currentPvcStorageBytes,
    deploymentObjects: row.isTemporary && row.type === 'deployment' ? 1 : 0,
    statefulSetObjects: row.isTemporary && row.type === 'statefulset' ? 1 : 0,
    configMapObjects: 0,
    secretObjects: 0,
    serviceObjects: 0,
  };
}

function fallbackTotals(workloads: WorkloadBaseline[]) {
  return workloads.reduce(
    (totals, workload) => ({
      pods: totals.pods + workload.currentReplicas,
      cpuRequests: totals.cpuRequests + workload.currentCpuRequests,
      cpuLimits: totals.cpuLimits + workload.currentCpuLimits,
      memoryRequests: totals.memoryRequests + workload.currentMemoryRequests,
      memoryLimits: totals.memoryLimits + workload.currentMemoryLimits,
      pvcCount: totals.pvcCount + workload.currentPvcCount,
      pvcStorage: totals.pvcStorage + workload.currentPvcStorageBytes,
      deploymentObjects: totals.deploymentObjects + (workload.type === 'deployment' ? 1 : 0),
      statefulSetObjects: totals.statefulSetObjects + (workload.type === 'statefulset' ? 1 : 0),
      configMapObjects: totals.configMapObjects,
      secretObjects: totals.secretObjects,
      serviceObjects: totals.serviceObjects,
    }),
    {
      pods: 0,
      cpuRequests: 0,
      cpuLimits: 0,
      memoryRequests: 0,
      memoryLimits: 0,
      pvcCount: 0,
      pvcStorage: 0,
      deploymentObjects: 0,
      statefulSetObjects: 0,
      configMapObjects: 0,
      secretObjects: 0,
      serviceObjects: 0,
    }
  );
}

function kafkaFallbackTotals(kafkaInstances: KafkaInstanceBaseline[]) {
  return kafkaInstances
    .flatMap((instance) => instance.pools)
    .reduce(
      (totals, pool) => ({
        pods: totals.pods + pool.currentReplicas,
        cpuRequests: totals.cpuRequests + pool.currentCpuRequests,
        cpuLimits: totals.cpuLimits + pool.currentCpuLimits,
        memoryRequests: totals.memoryRequests + pool.currentMemoryRequests,
        memoryLimits: totals.memoryLimits + pool.currentMemoryLimits,
        pvcCount: totals.pvcCount + pool.currentPvcCount,
        pvcStorage: totals.pvcStorage + pool.currentPvcStorageBytes,
        deploymentObjects: totals.deploymentObjects,
        statefulSetObjects: totals.statefulSetObjects,
        configMapObjects: totals.configMapObjects,
        secretObjects: totals.secretObjects,
        serviceObjects: totals.serviceObjects,
      }),
      {
        pods: 0,
        cpuRequests: 0,
        cpuLimits: 0,
        memoryRequests: 0,
        memoryLimits: 0,
        pvcCount: 0,
        pvcStorage: 0,
        deploymentObjects: 0,
        statefulSetObjects: 0,
        configMapObjects: 0,
        secretObjects: 0,
        serviceObjects: 0,
      }
    );
}

function addTotals(left: Omit<WorkloadDelta, 'rowId'>, right: Omit<WorkloadDelta, 'rowId'>) {
  return {
    pods: left.pods + right.pods,
    cpuRequests: left.cpuRequests + right.cpuRequests,
    cpuLimits: left.cpuLimits + right.cpuLimits,
    memoryRequests: left.memoryRequests + right.memoryRequests,
    memoryLimits: left.memoryLimits + right.memoryLimits,
    pvcCount: left.pvcCount + right.pvcCount,
    pvcStorage: left.pvcStorage + right.pvcStorage,
    deploymentObjects: left.deploymentObjects + right.deploymentObjects,
    statefulSetObjects: left.statefulSetObjects + right.statefulSetObjects,
    configMapObjects: left.configMapObjects + right.configMapObjects,
    secretObjects: left.secretObjects + right.secretObjects,
    serviceObjects: left.serviceObjects + right.serviceObjects,
  };
}

function kafkaDelta(row: KafkaSimulationRow): WorkloadDelta {
  return {
    rowId: row.id,
    pods: row.simulatedReplicas - row.currentReplicas,
    cpuRequests: row.simulatedCpuRequests - row.currentCpuRequests,
    cpuLimits: row.simulatedCpuLimits - row.currentCpuLimits,
    memoryRequests: row.simulatedMemoryRequests - row.currentMemoryRequests,
    memoryLimits: row.simulatedMemoryLimits - row.currentMemoryLimits,
    pvcCount: row.simulatedPvcCount - row.currentPvcCount,
    pvcStorage: row.simulatedPvcStorageBytes - row.currentPvcStorageBytes,
    deploymentObjects: row.isTemporary ? 2 : 0,
    statefulSetObjects: 0,
    configMapObjects: row.isTemporary ? 2 : 0,
    secretObjects: row.isTemporary ? 6 : 0,
    serviceObjects: row.isTemporary ? 4 : 0,
  };
}

function quotaValue(baseline: SimulatorBaseline, resource: string, type: keyof ResourceQuotaPair) {
  const value = baseline.quotas[resource]?.[type];
  return finite(value) ? value : undefined;
}

function quotaBaseline(baseline: SimulatorBaseline, resource: string, fallback: number, secondaryResource?: string) {
  return (
    quotaValue(baseline, resource, 'used') ??
    (secondaryResource ? quotaValue(baseline, secondaryResource, 'used') : undefined) ??
    fallback
  );
}

function hardValue(baseline: SimulatorBaseline, ...resources: string[]) {
  for (const resource of resources) {
    const hard = quotaValue(baseline, resource, 'hard');

    if (hard !== undefined) {
      return hard;
    }
  }

  return undefined;
}

function quotaHardValue(
  baseline: SimulatorBaseline,
  scenario: WorkloadScenarioState,
  key: string,
  ...resources: string[]
) {
  const liveHard = hardValue(baseline, ...resources);
  const override = scenario.quotaOverrides[key];

  return {
    hard: finite(override) ? override : liveHard,
    liveHard,
    hardEdited: finite(override),
  };
}

function statusFor(projected: number, hard: number | undefined, source: SimulatorRowSource): SimulatorRowStatus {
  if (!finite(hard)) {
    return source === 'quota' ? 'unlimited' : 'unknown';
  }

  if (projected > hard) {
    return 'exceeded';
  }

  if (hard > 0 && projected / hard >= 0.8) {
    return 'warning';
  }

  return 'ok';
}

function resultRow(
  key: string,
  label: string,
  unit: SimulatorRowUnit,
  source: SimulatorRowSource,
  baseline: number,
  delta: number,
  hard?: number,
  liveHard = hard,
  hardEdited = false
): SimulatorResultRow {
  const projected = Math.max(0, baseline + delta);
  const remaining = finite(hard) ? hard - projected : undefined;
  const ratio = finite(hard) && hard > 0 ? projected / hard : undefined;

  return {
    key,
    label,
    unit,
    source,
    baseline,
    delta,
    projected,
    hard,
    liveHard,
    hardEdited,
    remaining,
    ratio,
    status: statusFor(projected, hard, source),
  };
}

function quotaResultRow(
  baseline: SimulatorBaseline,
  scenario: WorkloadScenarioState,
  key: string,
  label: string,
  unit: SimulatorRowUnit,
  used: number,
  delta: number,
  ...hardResources: string[]
) {
  const { hard, liveHard, hardEdited } = quotaHardValue(baseline, scenario, key, ...hardResources);

  return resultRow(key, label, unit, 'quota', used, delta, hard, liveHard, hardEdited);
}

export function calculateSimulatorResults(
  baseline: SimulatorBaseline,
  scenario: WorkloadScenarioState
): SimulatorResults {
  const workloadRows = buildWorkloadRows(baseline, scenario);
  const kafkaRows = buildKafkaRows(baseline, scenario);
  const workloadDeltas = Object.fromEntries(workloadRows.map((row) => [row.id, workloadDelta(row)]));
  const kafkaDeltas = Object.fromEntries(kafkaRows.map((row) => [row.id, kafkaDelta(row)]));
  const fallback = addTotals(fallbackTotals(baseline.workloads), kafkaFallbackTotals(baseline.kafkaInstances));
  const deltas = [...Object.values(workloadDeltas), ...Object.values(kafkaDeltas)].reduce(
    (totals, delta) => ({
      pods: totals.pods + delta.pods,
      cpuRequests: totals.cpuRequests + delta.cpuRequests,
      cpuLimits: totals.cpuLimits + delta.cpuLimits,
      memoryRequests: totals.memoryRequests + delta.memoryRequests,
      memoryLimits: totals.memoryLimits + delta.memoryLimits,
      pvcCount: totals.pvcCount + delta.pvcCount,
      pvcStorage: totals.pvcStorage + delta.pvcStorage,
      deploymentObjects: totals.deploymentObjects + delta.deploymentObjects,
      statefulSetObjects: totals.statefulSetObjects + delta.statefulSetObjects,
      configMapObjects: totals.configMapObjects + delta.configMapObjects,
      secretObjects: totals.secretObjects + delta.secretObjects,
      serviceObjects: totals.serviceObjects + delta.serviceObjects,
    }),
    {
      pods: 0,
      cpuRequests: 0,
      cpuLimits: 0,
      memoryRequests: 0,
      memoryLimits: 0,
      pvcCount: 0,
      pvcStorage: 0,
      deploymentObjects: 0,
      statefulSetObjects: 0,
      configMapObjects: 0,
      secretObjects: 0,
      serviceObjects: 0,
    }
  );

  const rows: SimulatorResultRow[] = [
    quotaResultRow(
      baseline,
      scenario,
      'requests.cpu',
      'CPU requests quota',
      'cores',
      quotaBaseline(baseline, 'requests.cpu', fallback.cpuRequests),
      deltas.cpuRequests,
      'requests.cpu'
    ),
    quotaResultRow(
      baseline,
      scenario,
      'requests.memory',
      'Memory requests quota',
      'bytes',
      quotaBaseline(baseline, 'requests.memory', fallback.memoryRequests),
      deltas.memoryRequests,
      'requests.memory'
    ),
    quotaResultRow(
      baseline,
      scenario,
      'limits.cpu',
      'CPU limits quota',
      'cores',
      quotaBaseline(baseline, 'limits.cpu', fallback.cpuLimits),
      deltas.cpuLimits,
      'limits.cpu'
    ),
    quotaResultRow(
      baseline,
      scenario,
      'limits.memory',
      'Memory limits quota',
      'bytes',
      quotaBaseline(baseline, 'limits.memory', fallback.memoryLimits),
      deltas.memoryLimits,
      'limits.memory'
    ),
    quotaResultRow(
      baseline,
      scenario,
      'requests.storage',
      'Storage requests quota',
      'bytes',
      quotaBaseline(baseline, 'requests.storage', fallback.pvcStorage),
      deltas.pvcStorage,
      'requests.storage'
    ),
    quotaResultRow(
      baseline,
      scenario,
      'pods',
      'Pods quota',
      'count',
      quotaBaseline(baseline, 'pods', fallback.pods, 'count/pods'),
      deltas.pods,
      'pods',
      'count/pods'
    ),
    quotaResultRow(
      baseline,
      scenario,
      'count/deployments.apps',
      'Deployment objects',
      'count',
      quotaBaseline(baseline, 'count/deployments.apps', fallback.deploymentObjects),
      deltas.deploymentObjects,
      'count/deployments.apps'
    ),
    quotaResultRow(
      baseline,
      scenario,
      'count/statefulsets.apps',
      'StatefulSet objects',
      'count',
      quotaBaseline(baseline, 'count/statefulsets.apps', fallback.statefulSetObjects),
      deltas.statefulSetObjects,
      'count/statefulsets.apps'
    ),
    quotaResultRow(
      baseline,
      scenario,
      'count/persistentvolumeclaims',
      'PersistentVolumeClaims',
      'count',
      quotaBaseline(baseline, 'count/persistentvolumeclaims', fallback.pvcCount, 'persistentvolumeclaims'),
      deltas.pvcCount,
      'count/persistentvolumeclaims',
      'persistentvolumeclaims'
    ),
    quotaResultRow(
      baseline,
      scenario,
      'count/configmaps',
      'ConfigMap objects',
      'count',
      quotaBaseline(baseline, 'count/configmaps', 0),
      deltas.configMapObjects,
      'count/configmaps'
    ),
    quotaResultRow(
      baseline,
      scenario,
      'count/secrets',
      'Secret objects',
      'count',
      quotaBaseline(baseline, 'count/secrets', 0),
      deltas.secretObjects,
      'count/secrets'
    ),
    quotaResultRow(
      baseline,
      scenario,
      'count/services',
      'Service objects',
      'count',
      quotaBaseline(baseline, 'count/services', 0),
      deltas.serviceObjects,
      'count/services'
    ),
    resultRow(
      'cluster.requests.cpu',
      'CPU request cluster share',
      'cores',
      'capacity',
      quotaBaseline(baseline, 'requests.cpu', fallback.cpuRequests),
      deltas.cpuRequests,
      baseline.clusterAllocatable.cpu
    ),
    resultRow(
      'cluster.requests.memory',
      'Memory request cluster share',
      'bytes',
      'capacity',
      quotaBaseline(baseline, 'requests.memory', fallback.memoryRequests),
      deltas.memoryRequests,
      baseline.clusterAllocatable.memory
    ),
    resultRow(
      'cluster.pods',
      'Pod cluster share',
      'count',
      'capacity',
      quotaBaseline(baseline, 'pods', fallback.pods, 'count/pods'),
      deltas.pods,
      baseline.clusterAllocatable.pods
    ),
  ];

  return {
    rows,
    workloadRows,
    kafkaRows,
    workloadDeltas,
    kafkaDeltas,
    warnings: buildWarnings(rows, workloadRows, kafkaRows, baseline),
    deltas,
  };
}

function buildWarnings(
  rows: SimulatorResultRow[],
  workloadRows: WorkloadSimulationRow[],
  kafkaRows: KafkaSimulationRow[],
  baseline: SimulatorBaseline
) {
  const warnings: string[] = [];
  const exceeded = rows.filter((row) => row.status === 'exceeded');
  const missingBaselineRows = workloadRows.filter((row) => !row.isTemporary && row.missingResourceBaseline);
  const missingKafkaBaselineRows = kafkaRows.filter((row) => !row.isTemporary && row.missingResourceBaseline);

  if (exceeded.length > 0) {
    warnings.push(
      `${exceeded.length} projected resource ${exceeded.length === 1 ? 'limit is' : 'limits are'} exceeded.`
    );
  }

  if (
    baseline.quotas.pods?.used === undefined &&
    baseline.quotas['count/pods']?.used === undefined &&
    baseline.workloads.length > 0
  ) {
    warnings.push('Pod baseline is using workload replica metrics because pod quota usage is not available.');
  }

  if (missingBaselineRows.length > 0) {
    warnings.push(
      `${missingBaselineRows.length} workload ${missingBaselineRows.length === 1 ? 'row has' : 'rows have'} missing resource baselines.`
    );
  }

  if (missingKafkaBaselineRows.length > 0) {
    warnings.push(
      `${missingKafkaBaselineRows.length} Kafka ${missingKafkaBaselineRows.length === 1 ? 'row has' : 'rows have'} missing resource baselines.`
    );
  }

  return warnings;
}
