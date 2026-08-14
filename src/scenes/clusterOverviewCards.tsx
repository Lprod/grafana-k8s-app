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
  const frames = data?.series ?? [];

  return (
    <div className={styles.card}>
      {rows.map((row) => {
        // Searches every frame, not just the first - lets a card mix rows
        // from several queries (e.g. the namespace info query plus a
        // separate EgressIP query) without needing to join/merge them into
        // one frame first.
        const field = frames.map((frame) => frame.fields.find((f) => f.name === row.fieldName)).find(Boolean);
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

// Compact, clickable pill used as an alerts action button - shared by
// ClusterAlertsBadge (its own fixed-width slot next to the Cluster Health
// banner) and NamespaceHealthBanner (rendered inline as the banner's own
// `action`, see Alert's `action` prop - "Custom action element rendered in
// the alert's button area").
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

function alertsSeverityCounts(frames: Array<{ fields: any[] }>) {
  let total = 0;
  let hasCritical = false;
  let hasWarning = false;
  for (const frame of frames) {
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
  return { total, hasCritical, hasWarning };
}

function AlertsActionButton({
  total,
  hasCritical,
  hasWarning,
  alertsUrl,
}: {
  total: number;
  hasCritical: boolean;
  hasWarning: boolean;
  alertsUrl: string;
}) {
  const styles = useStyles2(alertsBadgeStyles);
  const theme = useTheme2();
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

// Namespace Health banner: namespaces have no synthetic probe CronJobs like
// clusters do, so health is derived from the same alerts-by-severity frame
// as the alerts action button (see buildNamespaceAlertsSeverityQuery) -
// both share this one banner's $data instead of running the query twice.
//
// Not built on <Alert>: Alert's `action` slot sits in a sibling Stack next
// to a title Box that's `flex: 1, minWidth: '50%'`, which pushes the action
// button to the far right of the banner with a big gap - there's no prop to
// change that. This reimplements Alert's visual language (severity-tinted
// background/border/icon, via the same `theme.colors[severity]` tokens
// Alert itself uses) as one flex row instead, so the button can sit
// immediately after the message text.
function healthBannerStyles(theme: GrafanaTheme2) {
  return {
    wrapper: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      padding: theme.spacing(1, 2),
      borderRadius: theme.shape.radius.default,
      border: '1px solid',
      flexWrap: 'wrap',
    }),
    text: css({
      color: theme.colors.text.primary,
      fontWeight: 500,
    }),
  };
}

interface NamespaceHealthBannerState extends SceneObjectState {
  alertsUrl: string;
}

export class NamespaceHealthBanner extends SceneObjectBase<NamespaceHealthBannerState> {
  static Component = NamespaceHealthBannerRenderer;
}

function NamespaceHealthBannerRenderer({ model }: SceneComponentProps<NamespaceHealthBanner>) {
  const { alertsUrl } = model.useState();
  const { data } = sceneGraph.getData(model).useState();
  const theme = useTheme2();
  const styles = useStyles2(healthBannerStyles);
  const { total, hasCritical, hasWarning } = alertsSeverityCounts(data?.series ?? []);

  const severity: 'success' | 'warning' | 'error' = total === 0 ? 'success' : hasCritical ? 'error' : 'warning';
  const message =
    total === 0
      ? 'Namespace is healthy'
      : hasCritical
        ? 'Namespace has critical alerts firing'
        : hasWarning
          ? 'Namespace has warning alerts firing'
          : 'Namespace has alerts firing';
  const iconName = severity === 'error' ? 'exclamation-circle' : severity === 'warning' ? 'exclamation-triangle' : 'check';
  const color = theme.colors[severity];

  return (
    <div className={styles.wrapper} style={{ background: color.transparent, borderColor: color.border }} role={severity === 'success' ? 'status' : 'alert'}>
      <Icon name={iconName} size="xl" style={{ color: color.text }} />
      <span className={styles.text}>{message}</span>
      <AlertsActionButton total={total} hasCritical={hasCritical} hasWarning={hasWarning} alertsUrl={alertsUrl} />
    </div>
  );
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
  const { total, hasCritical, hasWarning } = alertsSeverityCounts(data?.series ?? []);

  return <AlertsActionButton total={total} hasCritical={hasCritical} hasWarning={hasWarning} alertsUrl={alertsUrl} />;
}
