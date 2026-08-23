import React from 'react';
import { DataFrame, getValueFormat, GrafanaTheme2 } from '@grafana/data';
import { SceneComponentProps, SceneObjectBase, SceneObjectState, sceneGraph } from '@grafana/scenes';
import { Alert, Icon, useStyles2, useTheme2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { formatDisplay } from './tableCells';

// Custom, non-panel building blocks for the cluster Overview tab, styled to
// match the "Cluster information" cards and health banner in Grafana's own
// Kubernetes Monitoring app rather than default table/stat panels.

export interface InfoCardRow {
  label: string;
  // Either fieldName or render should be given - fieldName looks the value
  // up in the card's own $data by name; render is for a row whose value is
  // already known outright (e.g. cluster/namespace, taken straight from a
  // drilldown's route params) or combines several fields (e.g. "ready /
  // desired" replicas), so it gets every frame directly instead.
  fieldName?: string;
  unit?: string;
  decimals?: number;
  render?: (frames: DataFrame[]) => string;
  // If set, the value is rendered as a link. Plain <a href> navigation gets
  // intercepted by Grafana's app shell for SPA routing, which can drop query
  // params when the destination page has its own same-named scene variable
  // (see ClusterOverviewLinks in clustersApp.tsx) - so this navigates via
  // window.location instead of href to force a real page load. A callback
  // form is for a row whose link target is itself part of the query result
  // (e.g. "controlled by" needs the owning CronJob's own name) rather than
  // known outright from route params - returning undefined falls back to a
  // plain (non-link) value, e.g. for a standalone Job with no owner.
  href?: string | ((frames: DataFrame[]) => string | undefined);
  // Optional per-row value color (e.g. status/severity tiering) - takes the
  // same frames render() gets plus the live theme (InfoCard isn't itself a
  // component per row, so this can't call useTheme2() on its own). Ignored
  // on href rows, which keep the standard link color.
  color?: (frames: DataFrame[], theme: GrafanaTheme2) => string | undefined;
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

// Searches every frame, not just the first - lets a card mix rows from
// several queries (e.g. the namespace info query plus a separate EgressIP
// query) without needing to join/merge them into one frame first.
export function findFieldAcrossFrames(frames: DataFrame[], fieldName: string) {
  return frames.map((frame) => frame.fields.find((f) => f.name === fieldName)).find(Boolean);
}

export class InfoCard extends SceneObjectBase<InfoCardState> {
  static Component = InfoCardRenderer;
}

function InfoCardRenderer({ model }: SceneComponentProps<InfoCard>) {
  const { rows } = model.useState();
  const { data } = sceneGraph.getData(model).useState();
  const styles = useStyles2(infoCardStyles);
  const theme = useTheme2();
  const frames = data?.series ?? [];

  return (
    <div className={styles.card}>
      {rows.map((row) => {
        const value = row.render
          ? row.render(frames)
          : formatRowValue(row, row.fieldName ? findFieldAcrossFrames(frames, row.fieldName)?.values[0] : undefined);
        const color = row.color?.(frames, theme);
        const href = typeof row.href === 'function' ? row.href(frames) : row.href;
        return (
          <div className={styles.row} key={row.label}>
            <div className={styles.label}>{row.label}</div>
            {href ? (
              <button className={styles.valueLink} onClick={() => window.location.assign(href)}>
                {value}
              </button>
            ) : (
              <div className={styles.value} style={color ? { color } : undefined}>
                {value}
              </div>
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

const SEVERITY_RANK = { success: 0, info: 1, warning: 2, error: 3 } as const;
type BannerSeverity = keyof typeof SEVERITY_RANK;

// Reads the Workload Drilldown's own 'ready'/'desired' refIds (see
// buildWorkloadReadyDesiredQueries) off this banner's $data, if present -
// Namespace/Pod usages never add those refIds, so this stays a no-op (null)
// for them, same as NodeHealthBanner's own refId-filtered lookup pattern.
// Not all pods ready is a warning; zero ready (including a genuine 0/0,
// scaled to zero) is treated the same as a critical alert - a fully-down
// workload shouldn't read as merely "warning".
function podReadinessSeverity(frames: DataFrame[]): BannerSeverity | null {
  const readyValue = frames.find((f) => f.refId === 'ready')?.fields.find((f) => f.type === 'number')?.values[0];
  const desiredValue = frames.find((f) => f.refId === 'desired')?.fields.find((f) => f.type === 'number')?.values[0];
  if (typeof readyValue !== 'number' || typeof desiredValue !== 'number') {
    return null;
  }
  if (readyValue === 0) {
    return 'error';
  }
  return readyValue < desiredValue ? 'warning' : null;
}

// Reads the Pod Drilldown's own 'phase' refId (see buildPodStatusQuery) off
// this banner's $data, if present - same idea as podReadinessSeverity above,
// just for a single pod, which has no ready/desired replica count of its
// own to compare. Mirrors podStatusColor's own phase tiers (podsPage.tsx):
// Running/Succeeded is healthy, Pending is a warning (the pod exists but
// isn't up yet), Failed/Unknown is critical (the pod isn't running at all).
function podPhaseSeverity(frames: DataFrame[]): BannerSeverity | null {
  const phase = frames.find((f) => f.refId === 'phase')?.fields.find((f) => f.name === 'phase')?.values[0] as string | undefined;
  switch (phase) {
    case 'Pending':
      return 'warning';
    case 'Failed':
    case 'Unknown':
      return 'error';
    default:
      return null;
  }
}

interface NamespaceHealthBannerState extends SceneObjectState {
  alertsUrl: string;
  // Lets the Workload Drilldown reuse this same banner (and its underlying
  // alerts-by-severity mechanism) with its own wording ("Workload is
  // healthy" etc.) instead of duplicating the whole component - defaults to
  // 'Namespace' for the existing namespace usage.
  subject?: string;
}

export class NamespaceHealthBanner extends SceneObjectBase<NamespaceHealthBannerState> {
  static Component = NamespaceHealthBannerRenderer;
}

function NamespaceHealthBannerRenderer({ model }: SceneComponentProps<NamespaceHealthBanner>) {
  const { alertsUrl, subject = 'Namespace' } = model.useState();
  const { data } = sceneGraph.getData(model).useState();
  const theme = useTheme2();
  const styles = useStyles2(healthBannerStyles);
  const frames = data?.series ?? [];
  // alertsSeverityCounts sums the first numeric field off every frame it's
  // given - correct when this banner's $data only ever held the 'alerts'
  // query, but the Workload/Pod Drilldown's own healthRunner now also
  // shares this $data with 'ready'/'desired' (or 'phase') refIds for
  // podReadinessSeverity/podPhaseSeverity below. Passing the unfiltered
  // frames here would add those pod-readiness numbers straight into the
  // alert count/severity - same refId-scoping NodeHealthBanner's own
  // alertFrames already does.
  const alertFrames = frames.filter((f) => f.refId === 'alerts');
  const { total, hasCritical, hasWarning } = alertsSeverityCounts(alertFrames);
  const alertSeverity: BannerSeverity = hasCritical ? 'error' : hasWarning ? 'warning' : total > 0 ? 'info' : 'success';
  // Workload usage sets 'ready'/'desired' refIds, Pod usage sets a 'phase'
  // one, Namespace usage sets neither - mutually exclusive per page, so
  // whichever one actually finds data wins (the other is always null).
  const podsSeverity = podReadinessSeverity(frames) ?? podPhaseSeverity(frames);
  const severity = podsSeverity && SEVERITY_RANK[podsSeverity] > SEVERITY_RANK[alertSeverity] ? podsSeverity : alertSeverity;

  // A workload with unready pods but zero real alerts still needs to read
  // as "not healthy" and show a non-zero count on the action button - same
  // combined severity driving both, so they can't disagree with each other.
  const effectiveTotal = Math.max(total, podsSeverity ? 1 : 0);
  const effectiveHasCritical = hasCritical || podsSeverity === 'error';
  const effectiveHasWarning = hasWarning || podsSeverity === 'warning';

  const message = severity === 'success' ? `${subject} is healthy` : `${subject} is not healthy`;
  const iconName =
    severity === 'error' ? 'exclamation-circle' : severity === 'warning' ? 'exclamation-triangle' : severity === 'info' ? 'info-circle' : 'check';
  const color = theme.colors[severity];

  return (
    <div className={styles.wrapper} style={{ background: color.transparent, borderColor: color.border }} role={severity === 'success' ? 'status' : 'alert'}>
      <Icon name={iconName} size="xl" style={{ color: color.text }} />
      <span className={styles.text}>{message}</span>
      <AlertsActionButton total={effectiveTotal} hasCritical={effectiveHasCritical} hasWarning={effectiveHasWarning} alertsUrl={alertsUrl} />
    </div>
  );
}

// Node Health banner: unlike every other health banner here (Cluster's
// synthetic-probe-based one, Namespace's alerts-severity-based one reused by
// Workload/Pod), this one's severity comes from kube_node_status_condition
// (Ready=false/unknown -> error, any *Pressure=true -> warning) - the alerts
// action button is still there, just fed by a *separate* alerts-by-severity
// query instead of driving the message too. Both queries share this one
// banner's own $data (two refIds, 'conditions' and 'alerts') rather than
// two separate SceneQueryRunners, since giving the same SceneQueryRunner
// instance as $data to two different scene objects would hit the same
// silent-reparenting gotcha as sharing any other non-$-prefixed scene object
// between siblings (see the SceneObjectBase._setParent gotcha elsewhere in
// this codebase) - one runner, filtered by frame.refId instead.
interface NodeHealthBannerState extends SceneObjectState {
  alertsUrl: string;
}

export class NodeHealthBanner extends SceneObjectBase<NodeHealthBannerState> {
  static Component = NodeHealthBannerRenderer;
}

function NodeHealthBannerRenderer({ model }: SceneComponentProps<NodeHealthBanner>) {
  const { alertsUrl } = model.useState();
  const { data } = sceneGraph.getData(model).useState();
  const theme = useTheme2();
  const styles = useStyles2(healthBannerStyles);
  const frames = data?.series ?? [];
  const conditionFrames = frames.filter((f) => f.refId === 'conditions');
  const alertFrames = frames.filter((f) => f.refId === 'alerts');
  const { total, hasCritical, hasWarning } = alertsSeverityCounts(alertFrames);

  // A zero-result instant query still comes back as one frame with an empty
  // fields array (confirmed via /api/ds/query), not zero frames - so this
  // has to check for a real condition label on that frame, not just "some
  // frame that isn't the Ready one" (which the empty placeholder frame would
  // satisfy too, since undefined !== 'Ready'). buildNodeConditionQuery
  // already selects only the "bad" status per condition (Ready=false/
  // unknown, any Pressure=true), so a frame's mere presence here - the
  // condition label alone, status doesn't need rechecking - means that
  // condition is currently bad.
  const conditionLabel = (f: (typeof conditionFrames)[number]) => f.fields.find((field) => field.type === 'number')?.labels?.condition;
  const notReady = conditionFrames.some((f) => conditionLabel(f) === 'Ready');
  const pressureCondition = conditionFrames
    .map(conditionLabel)
    .find((c): c is string => c === 'MemoryPressure' || c === 'DiskPressure' || c === 'PIDPressure');

  const severity: 'success' | 'warning' | 'error' = notReady ? 'error' : pressureCondition ? 'warning' : 'success';
  const message = notReady ? 'Node is not ready' : pressureCondition ? `Node has ${pressureCondition} pressure` : 'Node is healthy';
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
