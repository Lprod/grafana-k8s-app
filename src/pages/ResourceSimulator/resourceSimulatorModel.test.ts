import {
  buildBaseline,
  BYTES_PER_GIB,
  calculateSimulatorResults,
  containerResourceTotals,
  linkedPvcCountForReplicaChange,
  MetricSample,
  parseScenario,
  serializeScenario,
  WorkloadContainerValues,
  WorkloadEditableValues,
  WorkloadScenarioState,
} from './resourceSimulatorModel';

function sample(refId: string, labels: Record<string, string>, value: number): MetricSample {
  return { refId, labels, value };
}

const deploymentLabels = { workload: 'api', workload_type: 'deployment' };
const statefulSetLabels = { workload: 'db', workload_type: 'statefulset' };

function scenario(
  overrides: WorkloadScenarioState['overrides'] = {},
  tempRows: WorkloadScenarioState['tempRows'] = [],
  quotaOverrides: WorkloadScenarioState['quotaOverrides'] = {}
) {
  return JSON.parse(
    serializeScenario({ overrides, tempRows, kafkaOverrides: {}, tempKafkaRows: [], quotaOverrides })
  ) as WorkloadScenarioState;
}

function container(name: string, values: Partial<WorkloadContainerValues> = {}): WorkloadContainerValues {
  return {
    name,
    cpuRequestCores: 0,
    cpuLimitCores: 0,
    memoryRequestGiB: 0,
    memoryLimitGiB: 0,
    ...values,
  };
}

function workloadValues(values: Partial<WorkloadEditableValues> = {}): WorkloadEditableValues {
  return {
    simulatedReplicas: 1,
    containers: [container('app')],
    pvcCount: 0,
    pvcStorageGiB: 0,
    ...values,
  };
}

describe('resource simulator model', () => {
  it('builds workload baselines and derives editable per-container resources', () => {
    const baseline = buildBaseline([
      sample('quota', { resource: 'pods', type: 'used' }, 22),
      sample('quota', { resource: 'pods', type: 'hard' }, 50),
      sample('workloadReplicas', deploymentLabels, 3),
      sample('workloadPods', deploymentLabels, 3),
      sample('workloadContainers', { ...deploymentLabels, container: 'app' }, 3),
      sample('workloadContainers', { ...deploymentLabels, container: 'sidecar' }, 3),
      sample('workloadRequests', { ...deploymentLabels, container: 'app', resource: 'cpu' }, 1.5),
      sample('workloadRequests', { ...deploymentLabels, container: 'sidecar', resource: 'cpu' }, 1.5),
      sample('workloadRequests', { ...deploymentLabels, container: 'app', resource: 'memory' }, 3 * BYTES_PER_GIB),
      sample('workloadRequests', { ...deploymentLabels, container: 'sidecar', resource: 'memory' }, 3 * BYTES_PER_GIB),
      sample('workloadCpuUsage', { ...deploymentLabels, container: 'app' }, 0.25),
      sample('workloadCpuUsage', { ...deploymentLabels, container: 'sidecar' }, 0.05),
      sample('workloadMemoryUsage', { ...deploymentLabels, container: 'app' }, 2 * BYTES_PER_GIB),
      sample('workloadMemoryUsage', { ...deploymentLabels, container: 'sidecar' }, 0.5 * BYTES_PER_GIB),
      sample('workloadPvcUsed', deploymentLabels, 4 * BYTES_PER_GIB),
    ]);
    const results = calculateSimulatorResults(baseline, scenario());
    const workload = results.workloadRows.find((row) => row.id === 'deployment/api');
    const pods = results.rows.find((row) => row.key === 'pods');
    const podTotals = workload ? containerResourceTotals(workload.containers) : undefined;

    expect(workload?.simulatedReplicas).toBe(3);
    expect(workload?.currentContainers).toBe(6);
    expect(workload?.containerBaselines.map((container) => container.name)).toEqual(['app', 'sidecar']);
    expect(workload?.currentCpuUsage).toBeCloseTo(0.3);
    expect(workload?.currentMemoryWorkingSet).toBe(2.5 * BYTES_PER_GIB);
    expect(workload?.currentPvcUsedBytes).toBe(4 * BYTES_PER_GIB);
    expect(workload?.containerBaselines.find((container) => container.name === 'app')).toMatchObject({
      currentCpuUsage: 0.25,
      currentMemoryWorkingSet: 2 * BYTES_PER_GIB,
    });
    expect(workload?.containers).toEqual([
      container('app', { cpuRequestCores: 0.5, memoryRequestGiB: 1 }),
      container('sidecar', { cpuRequestCores: 0.5, memoryRequestGiB: 1 }),
    ]);
    expect(podTotals?.cpuRequests).toBe(1);
    expect(podTotals?.memoryRequests).toBe(2);
    expect(pods?.baseline).toBe(22);
    expect(pods?.hard).toBe(50);
  });

  it('treats zero-replica workloads as scaled-to-zero instead of missing baselines', () => {
    const baseline = buildBaseline([sample('workloadReplicas', deploymentLabels, 0)]);
    const results = calculateSimulatorResults(baseline, scenario());
    const workload = results.workloadRows.find((row) => row.id === 'deployment/api');

    expect(workload).toMatchObject({
      currentReplicas: 0,
      currentPods: 0,
      currentContainers: 0,
      simulatedReplicas: 0,
      isScaledToZero: true,
      missingResourceBaseline: false,
    });
    expect(results.warnings).not.toContain('1 workload row has missing resource baselines.');
  });

  it('still marks non-zero workloads without resource metrics as missing baselines', () => {
    const baseline = buildBaseline([
      sample('workloadReplicas', deploymentLabels, 2),
      sample('workloadPods', deploymentLabels, 2),
    ]);
    const results = calculateSimulatorResults(baseline, scenario());
    const workload = results.workloadRows.find((row) => row.id === 'deployment/api');

    expect(workload).toMatchObject({
      isScaledToZero: false,
      missingResourceBaseline: true,
    });
    expect(results.warnings).toContain('1 workload row has missing resource baselines.');
  });

  it('models scaling existing Deployments and StatefulSets up and down', () => {
    const baseline = buildBaseline([
      sample('quota', { resource: 'pods', type: 'used' }, 10),
      sample('quota', { resource: 'pods', type: 'hard' }, 20),
      sample('workloadReplicas', deploymentLabels, 4),
      sample('workloadPods', deploymentLabels, 4),
      sample('workloadContainers', { ...deploymentLabels, container: 'app' }, 4),
      sample('workloadRequests', { ...deploymentLabels, container: 'app', resource: 'cpu' }, 2),
      sample('workloadReplicas', statefulSetLabels, 3),
      sample('workloadPods', statefulSetLabels, 3),
      sample('workloadContainers', { ...statefulSetLabels, container: 'app' }, 3),
      sample('workloadRequests', { ...statefulSetLabels, container: 'app', resource: 'cpu' }, 3),
    ]);
    const results = calculateSimulatorResults(
      baseline,
      scenario({
        'deployment/api': workloadValues({
          simulatedReplicas: 6,
          containers: [container('app', { cpuRequestCores: 0.5 })],
        }),
        'statefulset/db': workloadValues({
          simulatedReplicas: 1,
          containers: [container('app', { cpuRequestCores: 1 })],
        }),
      })
    );

    expect(results.deltas.pods).toBe(0);
    expect(results.deltas.cpuRequests).toBe(-1);
    expect(results.rows.find((row) => row.key === 'pods')?.projected).toBe(10);
  });

  it('sums edited per-container resources into pod totals', () => {
    const baseline = buildBaseline([
      sample('workloadReplicas', deploymentLabels, 2),
      sample('workloadPods', deploymentLabels, 2),
      sample('workloadContainers', { ...deploymentLabels, container: 'app' }, 2),
      sample('workloadRequests', { ...deploymentLabels, container: 'app', resource: 'cpu' }, 1),
      sample('workloadRequests', { ...deploymentLabels, container: 'app', resource: 'memory' }, 2 * BYTES_PER_GIB),
    ]);
    const results = calculateSimulatorResults(
      baseline,
      scenario({
        'deployment/api': workloadValues({
          simulatedReplicas: 3,
          containers: [
            container('app', { cpuRequestCores: 0.5, memoryRequestGiB: 1 }),
            container('sidecar', { cpuRequestCores: 0.25, memoryRequestGiB: 0.5 }),
          ],
        }),
      })
    );

    expect(results.deltas.pods).toBe(1);
    expect(results.deltas.cpuRequests).toBe(1.25);
    expect(results.deltas.memoryRequests).toBe(2.5 * BYTES_PER_GIB);
  });

  it('models per-PVC size expansion on existing workloads', () => {
    const baseline = buildBaseline([
      sample('quota', { resource: 'requests.storage', type: 'used' }, 100 * BYTES_PER_GIB),
      sample('quota', { resource: 'requests.storage', type: 'hard' }, 200 * BYTES_PER_GIB),
      sample('workloadReplicas', statefulSetLabels, 1),
      sample('workloadPvcCount', statefulSetLabels, 2),
      sample('workloadPvcStorage', statefulSetLabels, 80 * BYTES_PER_GIB),
    ]);
    const results = calculateSimulatorResults(
      baseline,
      scenario({
        'statefulset/db': workloadValues({
          simulatedReplicas: 1,
          pvcCount: 2,
          pvcStorageGiB: 60,
        }),
      })
    );

    expect(results.deltas.pvcCount).toBe(0);
    expect(results.deltas.pvcStorage).toBe(40 * BYTES_PER_GIB);
    expect(results.rows.find((row) => row.key === 'requests.storage')?.projected).toBe(140 * BYTES_PER_GIB);
  });

  it('derives linked StatefulSet PVC count changes', () => {
    const values = {
      currentReplicas: 2,
      currentPvcCount: 4,
      simulatedReplicas: 2,
      pvcCount: 4,
    };

    const nextPvcCount = linkedPvcCountForReplicaChange(values, 3);

    expect(nextPvcCount).toBe(6);
    expect(linkedPvcCountForReplicaChange({ ...values, pvcCount: 5 }, 3)).toBeUndefined();
  });

  it('keeps PVC size stable and derives total storage from PVC count', () => {
    const baseline = buildBaseline([
      sample('quota', { resource: 'requests.storage', type: 'used' }, 100 * BYTES_PER_GIB),
      sample('workloadReplicas', statefulSetLabels, 2),
      sample('workloadPvcCount', statefulSetLabels, 2),
      sample('workloadPvcStorage', statefulSetLabels, 80 * BYTES_PER_GIB),
    ]);
    const results = calculateSimulatorResults(
      baseline,
      scenario({
        'statefulset/db': workloadValues({
          simulatedReplicas: 3,
          pvcCount: 3,
          pvcStorageGiB: 40,
        }),
      })
    );

    expect(results.deltas.pvcCount).toBe(1);
    expect(results.deltas.pvcStorage).toBe(40 * BYTES_PER_GIB);
  });

  it('models temporary workload rows as additive objects', () => {
    const baseline = buildBaseline([
      sample('quota', { resource: 'count/statefulsets.apps', type: 'used' }, 1),
      sample('quota', { resource: 'count/statefulsets.apps', type: 'hard' }, 5),
    ]);
    const results = calculateSimulatorResults(
      baseline,
      scenario({}, [
        {
          ...workloadValues({
            simulatedReplicas: 3,
            containers: [container('app', { cpuRequestCores: 1, memoryRequestGiB: 2 })],
            pvcCount: 3,
            pvcStorageGiB: 10,
          }),
          id: 'temp-1',
          name: 'load-test',
          type: 'statefulset',
        },
      ])
    );

    expect(results.deltas.statefulSetObjects).toBe(1);
    expect(results.deltas.pods).toBe(3);
    expect(results.deltas.cpuRequests).toBe(3);
    expect(results.deltas.memoryRequests).toBe(6 * BYTES_PER_GIB);
    expect(results.deltas.pvcCount).toBe(3);
    expect(results.deltas.pvcStorage).toBe(30 * BYTES_PER_GIB);
    expect(results.rows.find((row) => row.key === 'count/statefulsets.apps')?.projected).toBe(2);
  });

  it('surfaces ConfigMap and Secret object quota counts as measured rows', () => {
    const baseline = buildBaseline([
      sample('quota', { resource: 'count/configmaps', type: 'used' }, 28),
      sample('quota', { resource: 'count/configmaps', type: 'hard' }, 100),
      sample('quota', { resource: 'count/secrets', type: 'used' }, 93),
      sample('quota', { resource: 'count/secrets', type: 'hard' }, 150),
    ]);
    const results = calculateSimulatorResults(baseline, scenario());

    expect(results.rows.find((row) => row.key === 'count/configmaps')).toMatchObject({
      baseline: 28,
      delta: 0,
      projected: 28,
      hard: 100,
      status: 'ok',
    });
    expect(results.rows.find((row) => row.key === 'count/secrets')).toMatchObject({
      baseline: 93,
      delta: 0,
      projected: 93,
      hard: 150,
      status: 'ok',
    });
  });

  it('models existing Strimzi Kafka broker and controller pools', () => {
    const baseline = buildBaseline([
      sample('quota', { resource: 'pods', type: 'used' }, 20),
      sample('quota', { resource: 'pods', type: 'hard' }, 40),
      sample('kafkaPods', { kafka: 'metrics', pool: 'metrics-broker', role: 'broker' }, 3),
      sample('kafkaPods', { kafka: 'metrics', pool: 'metrics-controller', role: 'controller' }, 3),
      sample('kafkaContainers', { kafka: 'metrics', pool: 'metrics-broker', role: 'broker', container: 'kafka' }, 3),
      sample(
        'kafkaContainers',
        { kafka: 'metrics', pool: 'metrics-controller', role: 'controller', container: 'kafka' },
        3
      ),
      sample(
        'kafkaRequests',
        { kafka: 'metrics', pool: 'metrics-broker', role: 'broker', container: 'kafka', resource: 'cpu' },
        3
      ),
      sample(
        'kafkaRequests',
        { kafka: 'metrics', pool: 'metrics-controller', role: 'controller', container: 'kafka', resource: 'cpu' },
        0.6
      ),
      sample(
        'kafkaRequests',
        { kafka: 'metrics', pool: 'metrics-broker', role: 'broker', container: 'kafka', resource: 'memory' },
        30 * BYTES_PER_GIB
      ),
      sample(
        'kafkaRequests',
        { kafka: 'metrics', pool: 'metrics-controller', role: 'controller', container: 'kafka', resource: 'memory' },
        3 * BYTES_PER_GIB
      ),
      sample('kafkaPvcCount', { kafka: 'metrics', pool: 'metrics-broker', role: 'broker' }, 3),
      sample('kafkaPvcStorage', { kafka: 'metrics', pool: 'metrics-broker', role: 'broker' }, 2400 * BYTES_PER_GIB),
      sample('kafkaCpuUsage', { kafka: 'metrics', pool: 'metrics-broker', role: 'broker', container: 'kafka' }, 1.2),
      sample(
        'kafkaMemoryUsage',
        { kafka: 'metrics', pool: 'metrics-broker', role: 'broker', container: 'kafka' },
        18 * BYTES_PER_GIB
      ),
      sample('kafkaPvcUsed', { kafka: 'metrics', pool: 'metrics-broker', role: 'broker' }, 1200 * BYTES_PER_GIB),
    ]);
    const results = calculateSimulatorResults(baseline, {
      ...scenario(),
      kafkaOverrides: {
        metrics: {
          pools: [
            {
              id: 'metrics/metrics-broker',
              name: 'metrics-broker',
              role: 'broker',
              simulatedReplicas: 4,
              containers: [container('kafka', { cpuRequestCores: 1, memoryRequestGiB: 10 })],
              pvcCount: 4,
              pvcStorageGiB: 800,
            },
            {
              id: 'metrics/metrics-controller',
              name: 'metrics-controller',
              role: 'controller',
              simulatedReplicas: 3,
              containers: [container('kafka', { cpuRequestCores: 0.2, memoryRequestGiB: 1 })],
              pvcCount: 0,
              pvcStorageGiB: 0,
            },
          ],
        },
      },
    });

    expect(results.kafkaRows).toHaveLength(1);
    expect(results.kafkaRows[0]).toMatchObject({
      id: 'metrics',
      currentReplicas: 6,
      currentCpuUsage: 1.2,
      currentMemoryWorkingSet: 18 * BYTES_PER_GIB,
      currentPvcUsedBytes: 1200 * BYTES_PER_GIB,
      simulatedReplicas: 7,
      simulatedPvcCount: 4,
    });
    expect(results.deltas.pods).toBe(1);
    expect(results.deltas.cpuRequests).toBeCloseTo(1);
    expect(results.deltas.memoryRequests).toBe(10 * BYTES_PER_GIB);
    expect(results.deltas.pvcCount).toBe(1);
    expect(results.deltas.pvcStorage).toBe(800 * BYTES_PER_GIB);
    expect(results.rows.find((row) => row.key === 'pods')?.projected).toBe(21);
  });

  it('marks exceeded hard limits and treats missing quota hard limits as unlimited', () => {
    const baseline = buildBaseline([
      sample('quota', { resource: 'requests.cpu', type: 'used' }, 9),
      sample('quota', { resource: 'requests.cpu', type: 'hard' }, 10),
    ]);
    const results = calculateSimulatorResults(
      baseline,
      scenario({}, [
        {
          ...workloadValues({
            simulatedReplicas: 4,
            containers: [container('app', { cpuRequestCores: 1 })],
          }),
          id: 'temp-1',
          name: 'load-test',
          type: 'deployment',
        },
      ])
    );

    expect(results.rows.find((row) => row.key === 'requests.cpu')?.status).toBe('exceeded');
    expect(results.rows.find((row) => row.key === 'requests.memory')).toMatchObject({
      hard: undefined,
      remaining: undefined,
      status: 'unlimited',
    });
    expect(results.warnings).not.toContain(
      'Some quota hard limits are missing; those rows are shown as unknown rather than failed.'
    );
  });

  it('uses simulated namespace quota hard limits when provided', () => {
    const baseline = buildBaseline([
      sample('quota', { resource: 'requests.cpu', type: 'used' }, 4),
      sample('quota', { resource: 'requests.cpu', type: 'hard' }, 10),
      sample('quota', { resource: 'count/pods', type: 'used' }, 3),
      sample('quota', { resource: 'count/pods', type: 'hard' }, 8),
    ]);
    const results = calculateSimulatorResults(
      baseline,
      scenario(
        {},
        [
          {
            ...workloadValues({
              simulatedReplicas: 2,
              containers: [container('app', { cpuRequestCores: 1 })],
            }),
            id: 'temp-1',
            name: 'load-test',
            type: 'deployment',
          },
        ],
        {
          'requests.cpu': 5,
          pods: 4,
        }
      )
    );

    expect(results.rows.find((row) => row.key === 'requests.cpu')).toMatchObject({
      baseline: 4,
      delta: 2,
      projected: 6,
      liveHard: 10,
      hard: 5,
      hardEdited: true,
      status: 'exceeded',
    });
    expect(results.rows.find((row) => row.key === 'pods')).toMatchObject({
      liveHard: 8,
      hard: 4,
      hardEdited: true,
      status: 'exceeded',
    });
  });

  it('normalizes simulated quota hard limits from URL state', () => {
    const parsed = parseScenario(
      JSON.stringify({
        quotaOverrides: {
          'requests.cpu': 8,
          pods: 30,
          unknown: 4,
          'requests.memory': -1,
          'limits.cpu': 'large',
        },
      })
    );

    expect(parsed.quotaOverrides).toEqual({
      'requests.cpu': 8,
      pods: 30,
    });
  });

  it('keeps missing capacity hard values unknown', () => {
    const results = calculateSimulatorResults(buildBaseline([]), scenario());

    expect(results.rows.find((row) => row.key === 'cluster.requests.cpu')).toMatchObject({
      source: 'capacity',
      hard: undefined,
      status: 'unknown',
    });
  });

  it('normalizes malformed URL scenario state', () => {
    expect(parseScenario('not json')).toEqual({
      overrides: {},
      tempRows: [],
      kafkaOverrides: {},
      tempKafkaRows: [],
      quotaOverrides: {},
    });

    const parsed = parseScenario(
      JSON.stringify({
        overrides: {
          'deployment/api': {
            simulatedReplicas: 2,
            containers: [
              {
                name: ' app ',
                cpuRequestCores: -1,
                cpuLimitCores: 2,
                memoryRequestGiB: 1,
                memoryLimitGiB: 3,
              },
            ],
            pvcCount: -2,
            pvcStorageGiB: 10,
          },
        },
        tempRows: [
          {
            id: 'temp-1',
            name: '',
            type: 'deployment',
            simulatedReplicas: 1,
            containers: [
              {
                name: 'worker',
                cpuRequestCores: 0.25,
                cpuLimitCores: 0.5,
                memoryRequestGiB: 1,
                memoryLimitGiB: 2,
              },
            ],
            pvcCount: 0,
            pvcStorageGiB: 0,
          },
          {
            id: 'temp-2',
            type: 'job',
            simulatedReplicas: 1,
          },
        ],
      })
    );

    expect(parsed.overrides['deployment/api']).toMatchObject({
      containers: [container('app', { cpuRequestCores: 0, cpuLimitCores: 2, memoryRequestGiB: 1, memoryLimitGiB: 3 })],
      pvcCount: 0,
    });
    expect(parsed.tempRows).toHaveLength(1);
    expect(parsed.tempRows[0]).toMatchObject({
      id: 'temp-1',
      name: 'temp-1',
      type: 'deployment',
      containers: [
        container('worker', { cpuRequestCores: 0.25, cpuLimitCores: 0.5, memoryRequestGiB: 1, memoryLimitGiB: 2 }),
      ],
    });
  });
});
