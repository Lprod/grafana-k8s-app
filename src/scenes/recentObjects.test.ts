import { loadRecentObjects, parseRecentObject, recordRecentObject } from './recentObjects';

const BASE = '/a/debeka-k8s-app';

describe('parseRecentObject', () => {
  test('maps each drilldown to its object, ignoring the tab slug', () => {
    expect(parseRecentObject(`${BASE}/clusters/demo-cluster-aws/cpu`)).toEqual({
      kind: 'cluster',
      name: 'demo-cluster-aws',
      cluster: 'demo-cluster-aws',
      path: `${BASE}/clusters/demo-cluster-aws`,
    });
    // A node whose tab happens to be "cpu" is still the node, not a node called "cpu".
    expect(parseRecentObject(`${BASE}/nodes/demo-cluster-aws/node-1/cpu`)).toMatchObject({
      kind: 'node',
      name: 'node-1',
      cluster: 'demo-cluster-aws',
      path: `${BASE}/nodes/demo-cluster-aws/node-1`,
    });
    expect(parseRecentObject(`${BASE}/namespaces/demo-cluster-gce/default/logs`)).toMatchObject({
      kind: 'namespace',
      name: 'default',
      cluster: 'demo-cluster-gce',
    });
  });

  test('tells a workload apart from a pod nested under it', () => {
    expect(parseRecentObject(`${BASE}/workloads/c1/default/deployment/app/memory`)).toEqual({
      kind: 'workload',
      name: 'app',
      cluster: 'c1',
      namespace: 'default',
      path: `${BASE}/workloads/c1/default/deployment/app`,
    });
    expect(parseRecentObject(`${BASE}/workloads/c1/default/deployment/app/pods/app-aws/cpu`)).toEqual({
      kind: 'pod',
      name: 'app-aws',
      cluster: 'c1',
      namespace: 'default',
      path: `${BASE}/workloads/c1/default/deployment/app/pods/app-aws`,
    });
  });

  test('distinguishes CronJob/Job drilldowns from the All Jobs list tabs', () => {
    expect(parseRecentObject(`${BASE}/jobs/cronjob/c1/cluster-tests/infra-check`)).toMatchObject({
      kind: 'cronjob',
      name: 'infra-check',
    });
    expect(parseRecentObject(`${BASE}/jobs/job/c1/cluster-tests/infra-check-29791301/cpu`)).toMatchObject({
      kind: 'job',
      name: 'infra-check-29791301',
      path: `${BASE}/jobs/job/c1/cluster-tests/infra-check-29791301`,
    });
    expect(parseRecentObject(`${BASE}/jobs/cronjobs`)).toBeUndefined();
    expect(parseRecentObject(`${BASE}/jobs/jobs`)).toBeUndefined();
  });

  test('ignores list pages and other routes', () => {
    for (const path of [`${BASE}/clusters`, `${BASE}/nodes`, `${BASE}/workloads`, `${BASE}/search`, `${BASE}`, '/d/abc']) {
      expect(parseRecentObject(path)).toBeUndefined();
    }
    // A partial drilldown path isn't an object yet.
    expect(parseRecentObject(`${BASE}/nodes/demo-cluster-aws`)).toBeUndefined();
  });

  test('round-trips URL-encoded names', () => {
    expect(parseRecentObject(`${BASE}/namespaces/c1/${encodeURIComponent('team a')}`)).toMatchObject({
      name: 'team a',
      path: `${BASE}/namespaces/c1/team%20a`,
    });
  });
});

describe('recordRecentObject', () => {
  beforeEach(() => window.localStorage.clear());

  test('keeps the most recent first and moves a revisit to the top instead of duplicating it', () => {
    const a = parseRecentObject(`${BASE}/clusters/a`)!;
    const b = parseRecentObject(`${BASE}/clusters/b`)!;
    recordRecentObject(a);
    recordRecentObject(b);
    recordRecentObject(a);
    expect(loadRecentObjects().map((o) => o.name)).toEqual(['a', 'b']);
  });

  test('caps the list', () => {
    for (let i = 0; i < 20; i++) {
      recordRecentObject(parseRecentObject(`${BASE}/clusters/c${i}`)!);
    }
    const names = loadRecentObjects().map((o) => o.name);
    expect(names).toHaveLength(8);
    expect(names[0]).toBe('c19');
  });

  test('survives corrupt storage', () => {
    window.localStorage.setItem('debeka-k8s-app.recentObjects', '{not json');
    expect(loadRecentObjects()).toEqual([]);
  });
});
