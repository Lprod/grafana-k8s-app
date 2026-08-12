import React from 'react';
import { DataTransformContext, FieldType } from '@grafana/data';
import { createAssistantContextItem, OpenAssistantButton } from '@grafana/assistant';
import { CustomCellRendererProps } from '@grafana/ui';
import { CustomTransformOperator } from '@grafana/scenes';
import { map } from 'rxjs/operators';

// The alerts query only returns label columns - there's no natural field to
// host an "Investigate" button, so this adds a synthetic one every row can
// render a cell against. Must run after filterFieldsByName (which would
// otherwise strip an unlisted field) and before organize (so the new field
// still picks up a position/rename).
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

  const prompt = `Perform a root cause analysis for the firing Kubernetes alert "${alertname}" (severity: ${severity}) in namespace "${namespace}" on cluster "${cluster}"${
    pod ? `, pod "${pod}"` : ''
  }${container ? `, container "${container}"` : ''}. Explain the likely cause and suggest next steps.`;

  return (
    <OpenAssistantButton
      title="Investigate"
      size="sm"
      origin="debeka-k8s-app/alerts-table"
      prompt={prompt}
      context={[
        createAssistantContextItem('structured', {
          title: `Alert: ${alertname}`,
          data: { cluster, severity, alertname, namespace, pod, container },
        }),
      ]}
    />
  );
}
