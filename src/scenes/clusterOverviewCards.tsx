import React from 'react';
import { getValueFormat, GrafanaTheme2 } from '@grafana/data';
import { SceneComponentProps, SceneObjectBase, SceneObjectState, sceneGraph } from '@grafana/scenes';
import { Alert, Icon, useStyles2, useTheme2 } from '@grafana/ui';
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
  // If set, the value is rendered as a link. Plain <a href> navigation gets
  // intercepted by Grafana's app shell for SPA routing, which can drop query
  // params when the destination page has its own same-named scene variable
  // (see ClusterOverviewLinks in clustersApp.tsx) - so this navigates via
  // window.location instead of href to force a real page load.
  href?: string;
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
      wordBreak: 'break-word',
    }),
    valueLink: css({
      fontSize: theme.typography.body.fontSize,
      color: theme.colors.text.link,
      marginTop: theme.spacing(0.25),
      cursor: 'pointer',
      background: 'none',
      border: 'none',
      padding: 0,
      textAlign: 'left',
      wordBreak: 'break-word',
      '&:hover': {
        textDecoration: 'underline',
      },
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
            {row.href ? (
              <button className={styles.valueLink} onClick={() => window.location.assign(row.href!)}>
                {value}
              </button>
            ) : (
              <div className={styles.value}>{value}</div>
            )}
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

// Namespace Health banner: namespaces have no synthetic probe CronJobs like
// clusters do, so health is derived from the same alerts-by-severity frame
// ClusterAlertsBadge consumes (see buildNamespaceAlertsSeverityQuery) rather
// than a dedicated health metric.
interface NamespaceHealthBannerState extends SceneObjectState {}

export class NamespaceHealthBanner extends SceneObjectBase<NamespaceHealthBannerState> {
  static Component = NamespaceHealthBannerRenderer;
}

function NamespaceHealthBannerRenderer({ model }: SceneComponentProps<NamespaceHealthBanner>) {
  const { data } = sceneGraph.getData(model).useState();

  let total = 0;
  let hasCritical = false;
  let hasWarning = false;
  for (const frame of data?.series ?? []) {
    const valueField = frame.fields.find((f) => f.type === 'number');
    const count = valueField?.values[0];
    if (typeof count !== 'number' || Number.isNaN(count)) {
      continue;
    }
    total += count;
    const severity = valueField?.labels?.severity;
    if (severity === 'critical') {
      hasCritical = true;
    } else if (severity === 'warning') {
      hasWarning = true;
    }
  }

  if (total === 0) {
    return <Alert severity="success" title="Namespace is healthy" />;
  }
  if (hasCritical) {
    return <Alert severity="error" title="Namespace has critical alerts firing" />;
  }
  if (hasWarning) {
    return <Alert severity="warning" title="Namespace has warning alerts firing" />;
  }
  return <Alert severity="warning" title="Namespace has alerts firing" />;
}

// Compact, clickable pill that sits next to the Cluster Health banner - it
// needs the same "impossible to miss when something's wrong" coloring, but
// a second full-width Alert banner underneath the health one would be too
// much, so this stays a fixed-width badge instead.
function alertsBadgeStyles(theme: GrafanaTheme2) {
  return {
    badge: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(1),
      height: '100%',
      minHeight: 40,
      padding: theme.spacing(0, 2),
      borderRadius: theme.shape.radius.default,
      border: `1px solid transparent`,
      fontSize: theme.typography.body.fontSize,
      fontWeight: 500,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }),
  };
}

interface ClusterAlertsBadgeState extends SceneObjectState {
  alertsUrl: string;
}

export class ClusterAlertsBadge extends SceneObjectBase<ClusterAlertsBadgeState> {
  static Component = ClusterAlertsBadgeRenderer;
}

function ClusterAlertsBadgeRenderer({ model }: SceneComponentProps<ClusterAlertsBadge>) {
  const { alertsUrl } = model.useState();
  const { data } = sceneGraph.getData(model).useState();
  const styles = useStyles2(alertsBadgeStyles);
  const theme = useTheme2();

  let total = 0;
  let hasCritical = false;
  let hasWarning = false;
  for (const frame of data?.series ?? []) {
    const valueField = frame.fields.find((f) => f.type === 'number');
    const count = valueField?.values[0];
    if (typeof count !== 'number' || Number.isNaN(count)) {
      continue;
    }
    total += count;
    const severity = valueField?.labels?.severity;
    if (severity === 'critical') {
      hasCritical = true;
    } else if (severity === 'warning') {
      hasWarning = true;
    }
  }

  const colorName = total === 0 ? 'green' : hasCritical ? 'red' : hasWarning ? 'orange' : 'blue';
  const color = theme.visualization.getColorByName(colorName);
  const label = total === 0 ? 'No firing alerts' : `${total} firing alert${total === 1 ? '' : 's'}`;

  return (
    <button
      className={styles.badge}
      style={{ color, borderColor: color, background: `${color}1A` }}
      onClick={() => window.location.assign(alertsUrl)}
    >
      <Icon name={total === 0 ? 'check-circle' : 'exclamation-triangle'} />
      {label}
    </button>
  );
}
