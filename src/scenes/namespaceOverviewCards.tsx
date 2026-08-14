import React from 'react';
import { SceneComponentProps, SceneObjectBase, SceneObjectState, sceneGraph } from '@grafana/scenes';
import { Badge, useStyles2 } from '@grafana/ui';
import { formatCores, formatGiB, formatMeterPair, UsageMeterUnit } from '../pages/ResourceSimulator/resourceSimulatorFormatters';
import { getStyles as getResourceSimulatorStyles } from '../pages/ResourceSimulator/ResourceSimulatorObject';

// A read-only, single-namespace "quota" card reusing the Resource
// Simulator's own summary-card CSS verbatim (getStyles' summary*/
// summaryProgress* classes - imported, not recreated, so the two stay in
// visual lockstep) but backed directly by kube_resourcequota's used/hard
// values instead of that page's full baseline+scenario simulation model,
// which this doesn't need.
type QuotaStatus = 'ok' | 'warning' | 'exceeded' | 'unlimited';

interface NamespaceQuotaCardState extends SceneObjectState {
  title: string;
  resource: 'requests.cpu' | 'requests.memory';
  unit: UsageMeterUnit;
  simulatorUrl: string;
}

export class NamespaceQuotaCard extends SceneObjectBase<NamespaceQuotaCardState> {
  static Component = NamespaceQuotaCardRenderer;
}

function extractQuotaValue(series: Array<{ fields: any[] }> | undefined, resource: string, type: 'used' | 'hard'): number | undefined {
  for (const frame of series ?? []) {
    const valueField = frame.fields.find((f) => f.type === 'number');
    if (valueField?.labels?.resource === resource && valueField?.labels?.type === type) {
      return valueField.values[0];
    }
  }
  return undefined;
}

// Same color/text mapping as ResourceSimulatorObject.tsx's own (unexported)
// StatusBadge.
function QuotaStatusBadge({ status }: { status: QuotaStatus }) {
  const color = status === 'exceeded' ? 'red' : status === 'warning' ? 'orange' : status === 'ok' ? 'green' : 'blue';
  const text = status === 'exceeded' ? 'Exceeded' : status === 'warning' ? 'Near limit' : status === 'unlimited' ? 'Unlimited' : 'OK';
  return <Badge color={color} text={text} />;
}

function summaryStatusClass(styles: ReturnType<typeof getResourceSimulatorStyles>, status: QuotaStatus) {
  if (status === 'exceeded') {
    return styles.summaryExceeded;
  }
  if (status === 'warning') {
    return styles.summaryWarning;
  }
  if (status === 'unlimited') {
    return styles.summaryUnlimited;
  }
  return styles.summaryOk;
}

function progressStatusClass(styles: ReturnType<typeof getResourceSimulatorStyles>, status: QuotaStatus) {
  if (status === 'exceeded') {
    return styles.summaryProgressExceeded;
  }
  if (status === 'warning') {
    return styles.summaryProgressWarning;
  }
  return styles.summaryProgressOk;
}

function formatByUnit(value: number, unit: UsageMeterUnit): string {
  return unit === 'cores' ? formatCores(value) : formatGiB(value);
}

function NamespaceQuotaCardRenderer({ model }: SceneComponentProps<NamespaceQuotaCard>) {
  const { title, resource, unit, simulatorUrl } = model.useState();
  const { data } = sceneGraph.getData(model).useState();
  const styles = useStyles2(getResourceSimulatorStyles);

  const used = extractQuotaValue(data?.series, resource, 'used') ?? 0;
  const hard = extractQuotaValue(data?.series, resource, 'hard');
  const ratio = hard !== undefined && hard > 0 ? used / hard : undefined;

  const status: QuotaStatus = hard === undefined ? 'unlimited' : ratio! >= 1 ? 'exceeded' : ratio! >= 0.8 ? 'warning' : 'ok';
  const usedText = formatByUnit(used, unit);
  const hardText = hard !== undefined ? formatMeterPair(used, hard, unit).requested : undefined;
  const progressWidth = ratio === undefined ? undefined : `${Math.min(100, Math.max(0, ratio * 100))}%`;

  const helpText =
    hard === undefined
      ? 'No quota configured for this namespace.'
      : status === 'exceeded'
        ? `Over quota by ${formatByUnit(used - hard, unit)}`
        : `${formatByUnit(Math.max(0, hard - used), unit)} remaining`;

  return (
    <div
      className={`${styles.summary} ${summaryStatusClass(styles, status)}`}
      role="button"
      tabIndex={0}
      onClick={() => window.location.assign(simulatorUrl)}
      onKeyDown={(e) => e.key === 'Enter' && window.location.assign(simulatorUrl)}
      style={{ cursor: 'pointer' }}
    >
      <div className={styles.summaryHeader}>
        <span className={styles.summaryLabel}>{title}</span>
        <QuotaStatusBadge status={status} />
      </div>
      <strong className={styles.summaryValue}>{usedText}</strong>
      <span className={styles.summaryMeta}>{hardText !== undefined ? `of ${hardText} requested` : ''}</span>
      {progressWidth !== undefined && (
        <div className={styles.summaryProgress} aria-label={`${usedText} used`}>
          <div className={`${styles.summaryProgressFill} ${progressStatusClass(styles, status)}`} style={{ width: progressWidth }} />
        </div>
      )}
      <span className={styles.summaryHelp}>{helpText}</span>
    </div>
  );
}
