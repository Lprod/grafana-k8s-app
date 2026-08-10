import React from 'react';
import { getValueFormat, GrafanaTheme2 } from '@grafana/data';
import { SceneComponentProps, SceneObjectBase, SceneObjectState, sceneGraph } from '@grafana/scenes';
import { Alert, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { formatDisplay } from './tableCells';

// Custom, non-panel building blocks for the cluster Overview tab, styled to
// match the "Cluster information" cards and health banner in Grafana's own
// Kubernetes Monitoring app rather than default table/stat panels.

export interface InfoCardRow {
  label: string;
  fieldName: string;
  unit?: string;
  decimals?: number;
}

interface InfoCardState extends SceneObjectState {
  rows: InfoCardRow[];
}

function infoCardStyles(theme: GrafanaTheme2) {
  return {
    card: css({
      display: 'flex',
      flexDirection: 'column',
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      background: theme.colors.background.secondary,
      width: '100%',
      boxSizing: 'border-box',
    }),
    row: css({
      padding: theme.spacing(1, 2),
    }),
    label: css({
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: 300,
      color: theme.colors.text.secondary,
    }),
    value: css({
      fontSize: theme.typography.body.fontSize,
      color: theme.colors.text.primary,
      marginTop: theme.spacing(0.25),
    }),
  };
}

function formatRowValue(row: InfoCardRow, raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') {
    return '–';
  }
  if (row.unit) {
    return formatDisplay(getValueFormat(row.unit)(Number(raw), row.decimals ?? 0));
  }
  return String(raw);
}

export class InfoCard extends SceneObjectBase<InfoCardState> {
  static Component = InfoCardRenderer;
}

function InfoCardRenderer({ model }: SceneComponentProps<InfoCard>) {
  const { rows } = model.useState();
  const { data } = sceneGraph.getData(model).useState();
  const styles = useStyles2(infoCardStyles);
  const frame = data?.series?.[0];

  return (
    <div className={styles.card}>
      {rows.map((row) => {
        const field = frame?.fields.find((f) => f.name === row.fieldName);
        const value = formatRowValue(row, field?.values[0]);
        return (
          <div className={styles.row} key={row.label}>
            <div className={styles.label}>{row.label}</div>
            <div className={styles.value}>{value}</div>
          </div>
        );
      })}
    </div>
  );
}

// Cluster Health banner: 0 = healthy, 1 = degraded (no user impact),
// 2 = degraded (user impact). Rendered as a full-width Alert banner (like
// Grafana's own "Kubernetes Monitoring is not functioning fully" notice)
// instead of a stat panel.
interface ClusterHealthBannerState extends SceneObjectState {}

export class ClusterHealthBanner extends SceneObjectBase<ClusterHealthBannerState> {
  static Component = ClusterHealthBannerRenderer;
}

function ClusterHealthBannerRenderer({ model }: SceneComponentProps<ClusterHealthBanner>) {
  const { data } = sceneGraph.getData(model).useState();
  const value = data?.series?.[0]?.fields.find((f) => f.type === 'number')?.values[0];

  if (value === undefined || value === null) {
    return (
      <Alert severity="info" title="Cluster health unknown">
        No health check data available for this cluster yet.
      </Alert>
    );
  }
  if (value === 0) {
    return <Alert severity="success" title="Cluster is healthy" />;
  }
  if (value === 1) {
    return <Alert severity="warning" title="Cluster is degraded (no user impact)" />;
  }
  return <Alert severity="error" title="Cluster is degraded (user impact)" />;
}
