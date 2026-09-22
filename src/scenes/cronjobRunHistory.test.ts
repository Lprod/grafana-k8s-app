import { DataFrame, FieldType } from '@grafana/data';
import { RUN_HISTORY_FIELD, RUN_HISTORY_LIMIT, RUN_RATE_FIELD, foldRunHistoryFrames, runStatus, runSuccessRate } from './cronjobRunHistory';

type Row = Record<string, string | number>;

function frame(refId: string, rows: Row[]): DataFrame {
  const names = Object.keys(rows[0] ?? {});
  return {
    refId,
    length: rows.length,
    fields: names.map((name) => ({
      name,
      type: typeof rows[0][name] === 'number' ? FieldType.number : FieldType.string,
      config: {},
      values: rows.map((r) => r[name]),
    })),
  };
}

const job = (cluster: string, cronjob: string, suffix: number, extra: Row = {}): Row => ({
  cluster,
  namespace: 'ns',
  job_name: `${cronjob}-${suffix}`,
  ...extra,
});

function field(f: DataFrame, name: string) {
  return f.fields.find((x) => x.name === name)!.values;
}

describe('runStatus', () => {
  test('matches the Runs table: failed wins, then complete, else running', () => {
    expect(runStatus(1, 1, 1)).toBe('failed');
    expect(runStatus(1, 0, 1)).toBe('complete');
    expect(runStatus(2, undefined, 3)).toBe('running');
    expect(runStatus(undefined, undefined, undefined)).toBe('running');
  });
});

describe('runSuccessRate', () => {
  test('ignores running runs and is null when none finished', () => {
    expect(runSuccessRate([{ job: 'a', start: 1, status: 'running' }])).toBeNull();
    expect(
      runSuccessRate([
        { job: 'a', start: 1, status: 'complete' },
        { job: 'b', start: 2, status: 'failed' },
        { job: 'c', start: 3, status: 'running' },
      ])
    ).toBe(0.5);
  });
});

describe('foldRunHistoryFrames', () => {
  const table = frame('exists', [{ cluster: 'aws', namespace: 'ns', cronjob: 'backup', join_name: 'aws-ns-backup', 'Value #exists': 1 }]);

  test('leaves frames alone when there are no run queries', () => {
    expect(foldRunHistoryFrames([table])).toEqual([table]);
  });

  test('folds per-Job rows into one row per CronJob, keyed like the other frames', () => {
    const start = frame('run_start', [
      { ...job('aws', 'backup', 3), owner_name: 'backup', Value: 3000 },
      { ...job('aws', 'backup', 1), owner_name: 'backup', Value: 1000 },
      { ...job('aws', 'backup', 2), owner_name: 'backup', Value: 2000 },
      // Same CronJob name on another cluster stays a separate row.
      { ...job('gce', 'backup', 1), owner_name: 'backup', Value: 1000 },
    ]);
    const succeeded = frame('run_succeeded', [job('aws', 'backup', 1, { Value: 1 }), job('gce', 'backup', 1, { Value: 1 })]);
    const failed = frame('run_failed', [job('aws', 'backup', 2, { Value: 1 })]);
    const completions = frame('run_completions', [
      job('aws', 'backup', 1, { Value: 1 }),
      job('aws', 'backup', 2, { Value: 1 }),
      job('aws', 'backup', 3, { Value: 1 }),
      job('gce', 'backup', 1, { Value: 1 }),
    ]);

    const out = foldRunHistoryFrames([table, start, succeeded, failed, completions]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(table);

    const folded = out[1];
    expect(field(folded, 'cluster')).toEqual(['aws', 'gce']);
    expect(field(folded, 'join_name')).toEqual(['aws-ns-backup', 'gce-ns-backup']);
    expect(field(folded, RUN_RATE_FIELD)).toEqual([0.5, 1]);

    const awsRuns = JSON.parse(field(folded, RUN_HISTORY_FIELD)[0]);
    expect(awsRuns.map((r: { job: string; status: string }) => `${r.job}:${r.status}`)).toEqual([
      'backup-1:complete',
      'backup-2:failed',
      'backup-3:running',
    ]);
  });

  test(`keeps only the newest ${RUN_HISTORY_LIMIT} runs`, () => {
    const rows = Array.from({ length: RUN_HISTORY_LIMIT + 5 }, (_, i) => ({ ...job('aws', 'backup', i), owner_name: 'backup', Value: i }));
    const [folded] = foldRunHistoryFrames([frame('run_start', rows)]);
    const runs = JSON.parse(field(folded, RUN_HISTORY_FIELD)[0]);
    expect(runs).toHaveLength(RUN_HISTORY_LIMIT);
    expect(runs[0].job).toBe('backup-5');
  });
});
