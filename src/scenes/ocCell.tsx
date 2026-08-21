import React from 'react';
import { AppEvents, DataTransformContext, FieldType, GrafanaTheme2, IconName } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { Button, CustomCellRendererProps, Dropdown, Menu, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { CustomTransformOperator, FieldConfigOverridesBuilder } from '@grafana/scenes';
import { map } from 'rxjs/operators';

// The "oc" row action - a button in a table's Action column whose menu copies
// ready-to-paste OpenShift CLI commands for that row's own entity.
//
// `oc` rather than `kubectl` because this org runs OpenShift; the two share
// almost all of their surface, but the OpenShift-idiomatic spellings differ in
// a few places that matter here: `oc rsh` instead of `kubectl exec -it -- sh`,
// `oc adm cordon`/`oc adm drain` instead of the top-level kubectl verbs, and
// `oc get events --field-selector involvedObject.name=...` instead of the
// newer `kubectl events --for`, which older `oc` builds don't have.
//
// The `--context` flag is a best-effort convenience, not a guarantee: a
// cluster's Prometheus `cluster` label and the operator's own kubeconfig
// context name are independent strings. It is included deliberately - a wrong
// context makes the command fail loudly, whereas omitting it would silently
// run against whatever cluster you happen to be logged into, which is a much
// worse failure mode for something like `adm drain`.

export type OcScope = {
  cluster?: string;
  namespace?: string;
  pod?: string;
  container?: string;
  workload?: string;
  workloadType?: string;
  node?: string;
};

// kube-state-metrics' `workload_type` values are lowercase singulars
// ("deployment", "statefulset", ...) which is already exactly what oc wants as
// a resource type - except "staticpod", which is just a pod.
function ocResourceType(workloadType?: string) {
  if (!workloadType) {
    return undefined;
  }
  return workloadType === 'staticpod' ? 'pod' : workloadType;
}

function contextAndNamespace(scope: OcScope) {
  const parts: string[] = [];
  if (scope.cluster) {
    parts.push(`--context ${scope.cluster}`);
  }
  if (scope.namespace) {
    parts.push(`-n ${scope.namespace}`);
  }
  return parts.join(' ');
}

type OcCommand = { label: string; icon: IconName; command: string };

export function ocCommandsFor(scope: OcScope): OcCommand[] {
  const prefix = `oc ${contextAndNamespace(scope)}`.replace(/\s+/g, ' ').trim();
  const clusterOnly = `oc ${scope.cluster ? `--context ${scope.cluster} ` : ''}`.replace(/\s+/g, ' ').trim();

  if (scope.pod) {
    const containerFlag = scope.container ? ` -c ${scope.container}` : '';
    return [
      { label: 'Describe pod', icon: 'info-circle', command: `${prefix} describe pod ${scope.pod}` },
      { label: 'Tail logs', icon: 'file-alt', command: `${prefix} logs ${scope.pod}${containerFlag} --tail=200 -f` },
      { label: 'Get YAML', icon: 'code-branch', command: `${prefix} get pod ${scope.pod} -o yaml` },
      {
        label: 'Events',
        icon: 'list-ul',
        command: `${prefix} get events --field-selector involvedObject.name=${scope.pod} --sort-by=.lastTimestamp`,
      },
      { label: 'Open a shell', icon: 'play', command: `${prefix} rsh ${scope.pod}${containerFlag}` },
    ];
  }

  const resourceType = ocResourceType(scope.workloadType);
  if (scope.workload && resourceType) {
    return [
      { label: `Describe ${resourceType}`, icon: 'info-circle', command: `${prefix} describe ${resourceType} ${scope.workload}` },
      { label: 'Tail logs', icon: 'file-alt', command: `${prefix} logs ${resourceType}/${scope.workload} --tail=200 -f` },
      { label: 'Get YAML', icon: 'code-branch', command: `${prefix} get ${resourceType} ${scope.workload} -o yaml` },
      // A workload's pods can only be selected exactly via its own
      // spec.selector, which isn't available from metrics - so this greps the
      // namespace's pods by name rather than pretending to a `-l` selector
      // that would silently match the wrong set.
      { label: 'List pods', icon: 'info-circle', command: `${prefix} get pods -o wide | grep ${scope.workload}` },
      {
        label: 'Events',
        icon: 'list-ul',
        command: `${prefix} get events --field-selector involvedObject.name=${scope.workload} --sort-by=.lastTimestamp`,
      },
    ];
  }

  if (scope.node) {
    return [
      { label: 'Describe node', icon: 'info-circle', command: `${clusterOnly} describe node ${scope.node}` },
      {
        label: 'Pods on this node',
        icon: 'info-circle',
        command: `${clusterOnly} get pods -A -o wide --field-selector spec.nodeName=${scope.node}`,
      },
      { label: 'Cordon', icon: 'code-branch', command: `${clusterOnly} adm cordon ${scope.node}` },
      {
        label: 'Drain',
        icon: 'play',
        command: `${clusterOnly} adm drain ${scope.node} --ignore-daemonsets --delete-emptydir-data`,
      },
    ];
  }

  if (scope.namespace) {
    return [
      { label: 'Describe project', icon: 'info-circle', command: `${prefix} describe project ${scope.namespace}` },
      { label: 'All resources', icon: 'info-circle', command: `${prefix} get all` },
      { label: 'Resource quotas', icon: 'code-branch', command: `${prefix} describe resourcequota` },
      { label: 'Events', icon: 'list-ul', command: `${prefix} get events --sort-by=.lastTimestamp` },
    ];
  }

  return [];
}

function copy(command: string) {
  // `navigator.clipboard` is only defined in a secure context (https or
  // localhost). Grafana is normally served over one, but fall back to the
  // legacy execCommand path rather than silently doing nothing when it isn't.
  const succeeded = () => getAppEvents().publish({ type: AppEvents.alertSuccess.name, payload: ['Copied', command] });
  const failed = () => getAppEvents().publish({ type: AppEvents.alertError.name, payload: ['Could not copy to the clipboard'] });

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(command).then(succeeded, failed);
    return;
  }

  const area = document.createElement('textarea');
  area.value = command;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    // Deliberate legacy fallback: this branch only runs where
    // navigator.clipboard is undefined (non-secure context), and there is no
    // non-deprecated alternative there.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand('copy');
    succeeded();
  } catch {
    failed();
  } finally {
    document.body.removeChild(area);
  }
}

function fieldValue(frame: CustomCellRendererProps['frame'], rowIndex: number, fieldName: string): string | undefined {
  // Look up by the *raw* Prometheus label name - `organize`'s `renameByName`
  // only sets a display name, never `field.name`.
  const field = frame.fields.find((f) => f.name === fieldName);
  const value = field?.values[rowIndex];
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

// The purple-to-orange gradient border the Assistant's own "Investigate"
// button wears, reproduced here so the two read as one matched pair of row
// actions rather than a branded button next to a plain one.
//
// Ported from `@grafana/assistant`'s own compiled `getStyles` rather than
// eyeballed, so the two stay pixel-identical: a `::before` layer painting the
// gradient across the full radius, and a `::after` layer inset by the border
// width painting the button's own background back over the middle - which is
// what leaves only a 1px gradient ring visible. The `::after` background is
// layered over `background.canvas` because `secondary.main` is semi-
// transparent and would otherwise let the gradient bleed through the face of
// the button. `isolation: 'isolate'` keeps the two negative z-index layers
// behind the label but in front of whatever the button sits on.
const getOcButtonStyles = (theme: GrafanaTheme2) => {
  const baseBackground = theme.colors.secondary.main;
  const elevatedBackground = theme.colors.emphasize(baseBackground, 0.05);
  const underlyingColor = theme.colors.background.canvas;
  const borderWidth = 1;
  const outerRadius = theme.shape.radius.default;
  const innerRadius = `max(calc(${outerRadius} - ${borderWidth}px), 1px)`;

  const solidBackgroundLayer = (background: string) => ({
    content: '""',
    position: 'absolute' as const,
    inset: `${borderWidth}px`,
    borderRadius: innerRadius,
    background: `linear-gradient(${background}, ${background}), ${underlyingColor}`,
    zIndex: -1,
    transition: 'none',
    pointerEvents: 'none' as const,
  });

  return {
    button: css({
      label: 'oc-action-button',
      width: 'fit-content',
      position: 'relative',
      isolation: 'isolate',
      border: 'none',
      transition: 'none !important',
      '&::before': {
        content: '""',
        position: 'absolute',
        inset: 0,
        borderRadius: outerRadius,
        background: 'linear-gradient(90deg, rgb(168, 85, 247), rgb(249, 115, 22))',
        zIndex: -2,
        pointerEvents: 'none',
      },
      '&::after': solidBackgroundLayer(baseBackground),
      '&:hover': { transition: 'none !important' },
      '&:hover::after': {
        background: `linear-gradient(${elevatedBackground}, ${elevatedBackground}), ${underlyingColor}`,
      },
    }),
  };
};

/**
 * The button itself: same shape, size and gradient border as the Assistant's
 * own "Investigate" button (`Button`, `variant="secondary"`, `fill="solid"`,
 * `size="sm"`, icon + short label), so the two sit side by side in one Action
 * cell as a visually matched pair.
 */
export function OcActionButton({ scope }: { scope: OcScope }) {
  const styles = useStyles2(getOcButtonStyles);
  const commands = ocCommandsFor(scope);
  if (commands.length === 0) {
    return null;
  }

  const menu = (
    <Menu>
      {commands.map((c) => (
        <Menu.Item key={c.label} label={c.label} icon={c.icon} description={c.command} onClick={() => copy(c.command)} />
      ))}
    </Menu>
  );

  return (
    <Dropdown overlay={menu} placement="bottom-start">
      <Button
        icon="clipboard-alt"
        variant="secondary"
        fill="solid"
        size="sm"
        className={styles.button}
        title="Copy an oc command for this row"
      >
        oc
      </Button>
    </Dropdown>
  );
}

/** Reads whatever the page doesn't already know from the row's own columns. */
export function ocScopeForRow(frame: CustomCellRendererProps['frame'], rowIndex: number, fixed: OcScope = {}): OcScope {
  return {
    cluster: fixed.cluster ?? fieldValue(frame, rowIndex, 'cluster'),
    namespace: fixed.namespace ?? fieldValue(frame, rowIndex, 'namespace'),
    pod: fixed.pod ?? fieldValue(frame, rowIndex, 'pod'),
    container: fixed.container ?? fieldValue(frame, rowIndex, 'container'),
    workload: fixed.workload ?? fieldValue(frame, rowIndex, 'workload'),
    workloadType: fixed.workloadType ?? fieldValue(frame, rowIndex, 'workload_type'),
    node: fixed.node ?? fieldValue(frame, rowIndex, 'node'),
  };
}

/**
 * Builds the cell renderer for tables whose Action column holds only this
 * button. `fixed` supplies whatever the page already knows from its own route
 * params (a Workload Drilldown's table has no `cluster` column of its own).
 */
export function ocCell(fixed: OcScope = {}) {
  return function OcCell({ frame, rowIndex }: CustomCellRendererProps) {
    return <OcActionButton scope={ocScopeForRow(frame, rowIndex, fixed)} />;
  };
}

/**
 * Adds the synthetic `action` field the cell above renders against. Must run
 * after any `filterFieldsByName` (which would strip an unlisted field) and
 * before `organize` (so it can still be positioned/renamed).
 *
 * The Alerts page brings its own Action column via `addActionField` in
 * investigateActionCell.tsx - that one renders Investigate *and* this button
 * in the same cell, so it must not also add a second `action` field here.
 */
export const addActionField: CustomTransformOperator = (_context: DataTransformContext) => (source) =>
  source.pipe(
    map((frames) =>
      frames.map((frame) => ({
        ...frame,
        fields: [
          ...frame.fields,
          {
            name: 'action',
            type: FieldType.string,
            config: {},
            values: frame.fields[0]?.values.map(() => '') ?? [],
          },
        ],
      }))
    )
  );

/**
 * The Action column's own field config. Kept here so every table that adds it
 * looks identical without repeating the overrides.
 */
export function applyOcActionColumn(b: FieldConfigOverridesBuilder<any>, fixed: OcScope = {}) {
  return b
    .matchFieldsWithName('action')
    .overrideDisplayName('Action')
    .overrideCustomFieldConfig('cellOptions', { type: 'custom', cellComponent: ocCell(fixed) } as any)
    .overrideCustomFieldConfig('width', 84);
}
