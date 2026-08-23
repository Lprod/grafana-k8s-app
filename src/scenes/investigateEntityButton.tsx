import React from 'react';
import { createAssistantContextItem, OpenAssistantButton } from '@grafana/assistant';

// "Investigate" for a whole Drilldown page, rendered next to the page title's
// own entity badge.
//
// The Alerts table's per-row Investigate button (investigateActionCell.tsx)
// was the only place this app exposed the Assistant, which meant the moment
// you clicked through from an alert into the entity itself - exactly when
// you have the most context and the most to ask - the affordance disappeared.
// This is the same `OpenAssistantButton`, just scoped to the page's own
// entity instead of one alert row.
//
// Kept as a plain React component (no scene object): every page title here is
// already a plain component passed to `SceneAppPage.renderTitle`, so there is
// nothing to hang scene state off and nothing that needs it.

export type InvestigateEntityKind = 'cluster' | 'node' | 'namespace' | 'workload' | 'pod' | 'cronjob';

export type InvestigateEntityProps = {
  kind: InvestigateEntityKind;
  /** The entity's own name - the cluster/node/namespace/workload/pod. */
  name: string;
  cluster?: string;
  namespace?: string;
  node?: string;
  /** For `kind: 'workload'` - deployment/statefulset/daemonset/job/... */
  workloadType?: string;
};

function describeScope({ kind, name, cluster, namespace, node, workloadType }: InvestigateEntityProps) {
  const noun = kind === 'workload' && workloadType ? workloadType : kind;
  const parts = [`the Kubernetes ${noun} "${name}"`];
  if (namespace && kind !== 'namespace') {
    parts.push(`in namespace "${namespace}"`);
  }
  if (node && kind !== 'node') {
    parts.push(`on node "${node}"`);
  }
  if (cluster && kind !== 'cluster') {
    parts.push(`on cluster "${cluster}"`);
  }
  return parts.join(' ');
}

export function InvestigateEntityButton(props: InvestigateEntityProps) {
  const { kind, name, cluster, namespace, node, workloadType } = props;
  const scope = describeScope(props);
  const prompt =
    `Assess the current health of ${scope}. Look at its resource usage against its requests and limits, ` +
    `any firing alerts, recent restarts or rollouts, and its logs and events. Summarise what looks wrong ` +
    `(or confirm it looks healthy) and suggest concrete next steps.`;

  return (
    <OpenAssistantButton
      title="Investigate"
      size="sm"
      origin={`debeka-k8s-app/${kind}-drilldown`}
      prompt={prompt}
      context={[
        createAssistantContextItem('structured', {
          title: `${kind}: ${name}`,
          data: { kind, name, cluster, namespace, node, workloadType },
        }),
      ]}
    />
  );
}
