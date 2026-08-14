import React from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { SceneComponentProps, SceneObjectBase, SceneObjectState, sceneGraph } from '@grafana/scenes';
import { Badge, useStyles2, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { formatCores, formatGiB, formatMeterPair, UsageMeterUnit } from '../pages/ResourceSimulator/resourceSimulatorFormatters';

// A read-only, single-namespace "quota" card modeled visually on the
// Resource Simulator's own summary cards (label + status Badge, big value,
// meta text, progress bar - see StatusBadge/summaryGrid in
// ResourceSimulatorObject.tsx) but backed directly by kube_resourcequota's
// used/hard values instead of that page's full baseline+scenario
// simulation model, which this doesn't need.
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

function quotaCardStyles(theme: GrafanaTheme2) {
  return {
    card: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.secondary,
      padding: theme.spacing(2),
      cursor: 'pointer',
      width: '100%',
      boxSizing: 'border-box',
    }),
    header: css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing(1) }),
    label: css({ fontSize: theme.typography.bodySmall.fontSize, color: theme.colors.text.secondary }),
    value: css({ fontSize: theme.typography.h3.fontSize, fontWeight: 500 }),
    meta: css({ fontSize: theme.typography.bodySmall.fontSize, color: theme.colors.text.secondary }),
    progress: css({
      height: 6,
      borderRadius: 3,
      background: theme.colors.background.primary,
      overflow: 'hidden',
    }),
    progressFill: css({ height: '100%', borderRadius: 3 }),
  };
}

function NamespaceQuotaCardRenderer({ model }: SceneComponentProps<NamespaceQuotaCard>) {
  const { title, resource, unit, simulatorUrl } = model.useState();
  const { data } = sceneGraph.getData(model).useState();
  const styles = useStyles2(quotaCardStyles);
  const theme = useTheme2();

  const used = extractQuotaValue(data?.series, resource, 'used') ?? 0;
  const hard = extractQuotaValue(data?.series, resource, 'hard');
  const ratio = hard !== undefined && hard > 0 ? used / hard : undefined;

  const status: 'unlimited' | 'exceeded' | 'warning' | 'ok' =
    hard === undefined ? 'unlimited' : ratio! >= 1 ? 'exceeded' : ratio! >= 0.8 ? 'warning' : 'ok';
  const badgeColor = status === 'exceeded' ? 'red' : status === 'warning' ? 'orange' : status === 'ok' ? 'green' : 'blue';
  const badgeText =
    status === 'exceeded' ? 'Exceeded' : status === 'warning' ? 'Near limit' : status === 'unlimited' ? 'Unlimited' : 'OK';

  const usedText = unit === 'cores' ? formatCores(used) : formatGiB(used);
  const hardText = hard !== undefined ? formatMeterPair(used, hard, unit).requested : undefined;

  return (
    <div
      className={styles.card}
      role="button"
      tabIndex={0}
      onClick={() => window.location.assign(simulatorUrl)}
      onKeyDown={(e) => e.key === 'Enter' && window.location.assign(simulatorUrl)}
    >
      <div className={styles.header}>
        <span className={styles.label}>{title}</span>
        <Badge color={badgeColor} text={badgeText} />
      </div>
      <strong className={styles.value}>{usedText}</strong>
      <span className={styles.meta}>{hardText !== undefined ? `of ${hardText} requested` : 'No quota set'}</span>
      {ratio !== undefined && (
        <div className={styles.progress} aria-label={`${usedText} used`}>
          <div
            className={styles.progressFill}
            style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, background: theme.visualization.getColorByName(badgeColor) }}
          />
        </div>
      )}
    </div>
  );
}
