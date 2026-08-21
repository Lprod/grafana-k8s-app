import React from 'react';
import { createAssistantContextItem, OpenAssistantButton } from '@grafana/assistant';
import { CustomCellRendererProps } from '@grafana/ui';
import { OcActionButton, ocScopeForRow } from '../../scenes/ocCell';

// The synthetic `action` field both buttons below render into is added by the
// shared helper in ocCell.tsx - this page just renders a richer cell into it.
export { addActionField } from '../../scenes/ocCell';

function fieldValue(frame: CustomCellRendererProps['frame'], rowIndex: number, fieldName: string): string {
  const field = frame.fields.find((f) => f.name === fieldName);
  return field ? String(field.values[rowIndex] ?? '') : '';
}

// The alerts table's `organize` transform renames these fields to
// ALL-CAPS for display via `renameByName`, but that only sets
// `field.config.displayName` - the underlying `field.name` stays the
// original lowercase Prometheus label name. Look up by that original name.
export function InvestigateActionCell({ frame, rowIndex }: CustomCellRendererProps) {
  const cluster = fieldValue(frame, rowIndex, 'cluster');
  const severity = fieldValue(frame, rowIndex, 'severity');
  const alertname = fieldValue(frame, rowIndex, 'alertname');
  const namespace = fieldValue(frame, rowIndex, 'namespace');
  const pod = fieldValue(frame, rowIndex, 'pod');
  const container = fieldValue(frame, rowIndex, 'container');
  // node/workload are only present on some rows (node-scoped alerts carry a
  // node, pod-scoped ones a workload attribution) - both are appended to the
  // prompt only when non-empty, same as pod/container already were.
  const node = fieldValue(frame, rowIndex, 'node');
  const workload = fieldValue(frame, rowIndex, 'workload');
  const workloadType = fieldValue(frame, rowIndex, 'workload_type');

  const prompt = `Perform a root cause analysis for the firing Kubernetes alert "${alertname}" (severity: ${severity}) in namespace "${namespace}" on cluster "${cluster}"${
    node ? `, node "${node}"` : ''
  }${workload ? `, ${workloadType || 'workload'} "${workload}"` : ''}${pod ? `, pod "${pod}"` : ''}${
    container ? `, container "${container}"` : ''
  }. Explain the likely cause and suggest next steps.`;

  // Both row actions live in the one Action column, side by side: ask the
  // Assistant about this alert, or copy an oc command for whatever entity it
  // is about. The oc scope is read from the same row rather than re-derived
  // here, so it stays in step with every other table's own Action column.
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <OpenAssistantButton
        title="Investigate"
        size="sm"
        origin="debeka-k8s-app/alerts-table"
        prompt={prompt}
        context={[
          createAssistantContextItem('structured', {
            title: `Alert: ${alertname}`,
            data: { cluster, severity, alertname, node, namespace, workload, workloadType, pod, container },
          }),
        ]}
      />
      <OcActionButton scope={ocScopeForRow(frame, rowIndex)} />
    </div>
  );
}
