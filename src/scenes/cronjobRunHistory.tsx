import React from 'react';
import { map } from 'rxjs/operators';
import { DataFrame, Field, FieldType, dateTimeFormat } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { CustomCellRendererProps, useTheme2 } from '@grafana/ui';
import { CustomTransformOperator } from '@grafana/scenes';

// "LAST RUNS" column of the All Jobs page's Cronjobs table (F-05): a strip
// of the newest Jobs each CronJob spawned plus the success rate over them.
// The per-Job rows come from the `run_*` queries in the table's own runner
// (cronjobRunHistoryQueries, jobsQueries.ts); foldRunHistoryFrames replaces
// them with a single frame shaped like the table's other frames (cluster,
// namespace, cronjob, join_name), so the table's `merge` lines it up with
// the right CronJob row by itself.

export const RUN_HISTORY_LIMIT = 10;
export const RUN_HISTORY_REF_PREFIX = 'run_';
export const RUN_RATE_FIELD = 'Value #runs';
export const RUN_HISTORY_FIELD = 'run_history';

export type RunStatus = 'complete' | 'running' | 'failed';

export interface RunEntry {
  job: string;
  start: number;
  status: RunStatus;
}

// Same rule as the Runs table's PODS/COMPLETION cell (runsPodsCompletionCell,
// jobsPage.tsx), so a bar and that table never disagree about one Job:
// any failed pod -> failed, all completions succeeded -> complete, else running.
export function runStatus(succeeded: number | undefined, failed: number | undefined, completions: number | undefined): RunStatus {
  if ((failed ?? 0) > 0) {
    return 'failed';
  }
  const required = completions ?? 0;
  if (required > 0 && (succeeded ?? 0) >= required) {
    return 'complete';
  }
  return 'running';
}

// Share of finished runs that completed; running ones are left out. null
// when nothing has finished yet (rendered as a dash, sorts last).
export function runSuccessRate(runs: RunEntry[]): number | null {
  const finished = runs.filter((r) => r.status !== 'running');
  if (finished.length === 0) {
    return null;
  }
  return finished.filter((r) => r.status === 'complete').length / finished.length;
}

function stringValue(frame: DataFrame, name: string, row: number): string | undefined {
  const value = frame.fields.find((f) => f.name === name)?.values[row];
  return value == null ? undefined : String(value);
}

function numberField(frame: DataFrame): Field | undefined {
  return frame.fields.find((f) => f.type === FieldType.number && f.name !== 'Time');
}

const key = (...parts: string[]) => parts.join('\u0000');

export function foldRunHistoryFrames(frames: DataFrame[]): DataFrame[] {
  const runFrames = frames.filter((f) => f.refId?.startsWith(RUN_HISTORY_REF_PREFIX));
  if (runFrames.length === 0) {
    return frames;
  }
  const rest = frames.filter((f) => !f.refId?.startsWith(RUN_HISTORY_REF_PREFIX));

  const perJob = (refId: string) => {
    const values = new Map<string, number>();
    runFrames
      .filter((f) => f.refId === refId)
      .forEach((frame) => {
        const valueField = numberField(frame);
        for (let row = 0; row < frame.length; row++) {
          const cluster = stringValue(frame, 'cluster', row);
          const namespace = stringValue(frame, 'namespace', row);
          const job = stringValue(frame, 'job_name', row);
          const value = valueField?.values[row];
          if (cluster && namespace && job && typeof value === 'number') {
            values.set(key(cluster, namespace, job), value);
          }
        }
      });
    return values;
  };
  const succeeded = perJob('run_succeeded');
  const failed = perJob('run_failed');
  const completions = perJob('run_completions');

  const byCronjob = new Map<string, { cluster: string; namespace: string; cronjob: string; runs: RunEntry[] }>();
  runFrames
    .filter((f) => f.refId === 'run_start')
    .forEach((frame) => {
      const startField = numberField(frame);
      for (let row = 0; row < frame.length; row++) {
        const cluster = stringValue(frame, 'cluster', row);
        const namespace = stringValue(frame, 'namespace', row);
        const cronjob = stringValue(frame, 'owner_name', row);
        const job = stringValue(frame, 'job_name', row);
        const start = startField?.values[row];
        if (!cluster || !namespace || !cronjob || !job || typeof start !== 'number') {
          continue;
        }
        const jobKey = key(cluster, namespace, job);
        const cronjobKey = key(cluster, namespace, cronjob);
        const entry = byCronjob.get(cronjobKey) ?? { cluster, namespace, cronjob, runs: [] };
        entry.runs.push({
          job,
          start,
          status: runStatus(succeeded.get(jobKey), failed.get(jobKey), completions.get(jobKey)),
        });
        byCronjob.set(cronjobKey, entry);
      }
    });

  const rows = Array.from(byCronjob.values()).map((entry) => {
    const runs = entry.runs.sort((a, b) => a.start - b.start).slice(-RUN_HISTORY_LIMIT);
    return { ...entry, runs, rate: runSuccessRate(runs) };
  });

  const stringField = (name: string, values: string[]): Field => ({ name, type: FieldType.string, config: {}, values });
  const folded: DataFrame = {
    refId: 'runs',
    length: rows.length,
    fields: [
      stringField('cluster', rows.map((r) => r.cluster)),
      stringField('namespace', rows.map((r) => r.namespace)),
      stringField('cronjob', rows.map((r) => r.cronjob)),
      // Same value label_join(..., "join_name", "-", "cluster", "namespace", "workload") gives the other frames.
      stringField('join_name', rows.map((r) => `${r.cluster}-${r.namespace}-${r.cronjob}`)),
      { name: RUN_RATE_FIELD, type: FieldType.number, config: {}, values: rows.map((r) => r.rate) },
      stringField(RUN_HISTORY_FIELD, rows.map((r) => JSON.stringify(r.runs))),
    ],
  };

  return [...rest, folded];
}

// Must run before the table's `merge`, which would otherwise try to line the
// per-Job rows up with the per-CronJob ones.
export function foldRunHistory(): CustomTransformOperator {
  return () => (source) => source.pipe(map(foldRunHistoryFrames));
}

const STATUS_COLOR: Record<RunStatus, string> = { complete: 'green', running: 'yellow', failed: 'red' };

function parseRuns(raw: unknown): RunEntry[] {
  if (typeof raw !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// The value is the success rate; the runs themselves ride along in
// `config.custom.runHistory` (attachFieldValues, same as PODS/COMPLETION).
// Each bar links to that Job's Drilldown, keeping the current time range
// and filters like the table's own `${__url.params}` links do.
export function runHistoryCell(jobsUrl: string) {
  return function RunHistoryCell({ rowIndex, field, frame, value }: CustomCellRendererProps) {
    const theme = useTheme2();
    const history = field.config?.custom?.runHistory as unknown[] | undefined;
    const runs = parseRuns(history?.[rowIndex]);
    // organize's renameByName only sets the display name - `name` is still the label.
    const cluster = frame.fields.find((f) => f.name === 'cluster')?.values[rowIndex];
    const namespace = frame.fields.find((f) => f.name === 'namespace')?.values[rowIndex];

    if (runs.length === 0) {
      return <span style={{ opacity: 0.6 }}>–</span>;
    }

    const rate = typeof value === 'number' && !Number.isNaN(value) ? value : null;
    const search = locationService.getLocation().search;
    const complete = runs.filter((r) => r.status === 'complete').length;
    const failed = runs.filter((r) => r.status === 'failed').length;
    const title = `Last ${runs.length} runs: ${complete} complete, ${failed} failed, ${runs.length - complete - failed} running`;

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={title}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 18 }}>
          {runs.map((run) => (
            <a
              key={run.job}
              href={`${jobsUrl}/job/${encodeURIComponent(String(cluster))}/${encodeURIComponent(String(namespace))}/${encodeURIComponent(run.job)}${search}`}
              title={`${run.job} · ${run.status} · started ${dateTimeFormat(run.start)}`}
              aria-label={`${run.job}: ${run.status}`}
              style={{
                display: 'block',
                width: 7,
                height: run.status === 'running' ? 11 : 18,
                borderRadius: 1,
                background: theme.visualization.getColorByName(STATUS_COLOR[run.status]),
              }}
            />
          ))}
        </div>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: theme.colors.text.secondary }}>
          {rate === null ? '–' : `${Math.round(rate * 100)} %`}
        </span>
      </div>
    );
  };
}
