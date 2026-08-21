import React from 'react';
import { AppEvents, DataTransformContext, FieldType, IconName } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { CustomCellRendererProps, Dropdown, IconButton, Menu } from '@grafana/ui';
import { CustomTransformOperator, FieldConfigOverridesBuilder } from '@grafana/scenes';
import { map } from 'rxjs/operators';

// "Copy as kubectl" - a narrow, header-less table column whose cell opens a
// small menu of ready-to-paste kubectl commands for that row's own entity.
//
// Deliberately a separate synthetic column rather than an icon tucked into
// the POD/WORKLOAD cell: those cells carry Grafana's own native data links
// (Drilldown navigation), and replacing them with a custom renderer would
// mean losing middle-click/open-in-new-tab along with them.
//
// The context flag is a best-effort convenience, not a guarantee: a cluster's
// Prometheus `cluster` label and the operator's own kubeconfig context name
// are independent strings that only happen to agree in most setups. It is
// included because deleting a wrong `--context` is faster than remembering to
// add a missing one, but that is the reason it is the first thing in the
// command rather than buried mid-line.

export type KubectlScope = {
  cluster?: string;
  namespace?: string;
  pod?: string;
  container?: string;
  workload?: string;
  workloadType?: string;
  node?: string;
};

// kube-state-metrics' `workload_type` values are lowercase singulars
// ("deployment", "statefulset", ...) which is already exactly what kubectl
// wants as a resource type - except "staticpod"/"pod", both of which are just
// pods, and "replicaset", which kubectl spells the same way.
function kubectlResourceType(workloadType?: string) {
  if (!workloadType) {
    return undefined;
  }
  return workloadType === 'staticpod' ? 'pod' : workloadType;
}

function contextAndNamespace(scope: KubectlScope) {
  const parts: string[] = [];
  if (scope.cluster) {
    parts.push(`--context ${scope.cluster}`);
  }
  if (scope.namespace) {
    parts.push(`-n ${scope.namespace}`);
  }
  return parts.join(' ');
}

type KubectlCommand = { label: string; icon: IconName; command: string };

export function kubectlCommandsFor(scope: KubectlScope): KubectlCommand[] {
  const prefix = `kubectl ${contextAndNamespace(scope)}`.replace(/\s+/g, ' ').trim();
  const commands: KubectlCommand[] = [];

  if (scope.pod) {
    const containerFlag = scope.container ? ` -c ${scope.container}` : '';
    commands.push(
      { label: 'Describe pod', icon: 'info-circle', command: `${prefix} describe pod ${scope.pod}` },
      { label: 'Tail logs', icon: 'file-alt', command: `${prefix} logs ${scope.pod}${containerFlag} --tail=200 -f` },
      { label: 'Get YAML', icon: 'code-branch', command: `${prefix} get pod ${scope.pod} -o yaml` },
      { label: 'Events', icon: 'list-ul', command: `${prefix} events --for pod/${scope.pod}` },
      { label: 'Open a shell', icon: 'play', command: `${prefix} exec -it ${scope.pod}${containerFlag} -- sh` }
    );
    return commands;
  }

  const resourceType = kubectlResourceType(scope.workloadType);
  if (scope.workload && resourceType) {
    commands.push(
      { label: `Describe ${resourceType}`, icon: 'info-circle', command: `${prefix} describe ${resourceType} ${scope.workload}` },
      { label: 'Tail logs', icon: 'file-alt', command: `${prefix} logs ${resourceType}/${scope.workload} --tail=200 -f` },
      { label: 'Get YAML', icon: 'code-branch', command: `${prefix} get ${resourceType} ${scope.workload} -o yaml` },
      // A workload's pods can only be selected exactly via its own
      // spec.selector, which isn't available from metrics - so this greps the
      // namespace's pods by name rather than pretending to a `-l` selector
      // that would silently match the wrong set.
      { label: 'List pods', icon: 'info-circle', command: `${prefix} get pods -o wide | grep ${scope.workload}` },
      { label: 'Events', icon: 'list-ul', command: `${prefix} events --for ${resourceType}/${scope.workload}` }
    );
    return commands;
  }

  if (scope.node) {
    const nodeContext = scope.cluster ? `--context ${scope.cluster} ` : '';
    commands.push(
      { label: 'Describe node', icon: 'info-circle', command: `kubectl ${nodeContext}describe node ${scope.node}` },
      { label: 'Pods on this node', icon: 'info-circle', command: `kubectl ${nodeContext}get pods -A -o wide --field-selector spec.nodeName=${scope.node}` },
      { label: 'Cordon', icon: 'code-branch', command: `kubectl ${nodeContext}cordon ${scope.node}` },
      { label: 'Drain', icon: 'play', command: `kubectl ${nodeContext}drain ${scope.node} --ignore-daemonsets --delete-emptydir-data` }
    );
    return commands;
  }

  if (scope.namespace) {
    commands.push(
      { label: 'Describe namespace', icon: 'info-circle', command: `${prefix} describe namespace ${scope.namespace}` },
      { label: 'All resources', icon: 'info-circle', command: `${prefix} get all` },
      { label: 'Resource quotas', icon: 'code-branch', command: `${prefix} describe resourcequota` },
      { label: 'Events', icon: 'list-ul', command: `${prefix} get events --sort-by=.lastTimestamp` }
    );
  }
  return commands;
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

export function KubectlMenu({ scope }: { scope: KubectlScope }) {
  const commands = kubectlCommandsFor(scope);
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
    <Dropdown overlay={menu} placement="bottom-end">
      <IconButton name="clipboard-alt" tooltip="Copy as kubectl" variant="secondary" />
    </Dropdown>
  );
}

/**
 * Builds the cell renderer. `fixed` supplies whatever the page already knows
 * from its own route params (a Workload Drilldown's table has no `cluster`
 * column of its own to read); anything not fixed is read per-row from the
 * frame's raw label columns.
 */
export function kubectlCell(fixed: KubectlScope = {}) {
  return function KubectlCell({ frame, rowIndex }: CustomCellRendererProps) {
    const scope: KubectlScope = {
      cluster: fixed.cluster ?? fieldValue(frame, rowIndex, 'cluster'),
      namespace: fixed.namespace ?? fieldValue(frame, rowIndex, 'namespace'),
      pod: fixed.pod ?? fieldValue(frame, rowIndex, 'pod'),
      container: fixed.container ?? fieldValue(frame, rowIndex, 'container'),
      workload: fixed.workload ?? fieldValue(frame, rowIndex, 'workload'),
      workloadType: fixed.workloadType ?? fieldValue(frame, rowIndex, 'workload_type'),
      node: fixed.node ?? fieldValue(frame, rowIndex, 'node'),
    };
    return <KubectlMenu scope={scope} />;
  };
}

/**
 * The column's own field config: icon-only, blank header, minimum width. Kept
 * here so every table that adds the column looks identical without repeating
 * the overrides.
 *
 * The header is blanked with `overrideDisplayName(' ')` rather than
 * `hideHeader: true`: `hideHeader` exists on TableFieldOptions, but the Table
 * panel doesn't register it as an editable custom option, and an override for
 * an unregistered custom id is silently dropped before it ever reaches
 * `field.config` - the same trap `custom.hideFrom` falls into on this panel
 * type (see the `attachFieldValues` comments in tableCells.tsx). Confirmed
 * live: the column rendered a truncated "kube..." header until this changed.
 */
export function applyKubectlColumn(b: FieldConfigOverridesBuilder<any>, fixed: KubectlScope = {}) {
  return b
    .matchFieldsWithName('kubectl')
    .overrideDisplayName(' ')
    .overrideCustomFieldConfig('cellOptions', { type: 'custom', cellComponent: kubectlCell(fixed) } as any)
    .overrideCustomFieldConfig('width', 44);
}

/**
 * Adds the synthetic `kubectl` field the cell above renders against. Must run
 * after any `filterFieldsByName` (which would strip an unlisted field) and
 * before `organize` (so it can still be positioned/renamed) - same ordering
 * constraint as the Alerts page's own `addActionField`.
 */
export const addKubectlField: CustomTransformOperator = (_context: DataTransformContext) => (source) =>
  source.pipe(
    map((frames) =>
      frames.map((frame) => ({
        ...frame,
        fields: [
          ...frame.fields,
          {
            name: 'kubectl',
            type: FieldType.string,
            config: {},
            values: frame.fields[0]?.values.map(() => '') ?? [],
          },
        ],
      }))
    )
  );
