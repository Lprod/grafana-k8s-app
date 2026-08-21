import React from 'react';
import { useTheme2 } from '@grafana/ui';

// The section heading used above every block of panels on the Cluster,
// Namespace, Workload, Pod and Node Drilldowns and on the Kubernetes home
// page ("Node information", "Pod optimization", "Container details", ...).
//
// Previously declared identically in six separate files, with the Kubernetes
// home page's two scenes importing it from `clustersApp.tsx` - which created
// a `kubernetesOverviewScene`/`kubernetesEfficiencyScene` -> `clustersApp` ->
// `kubernetesPage` import cycle purely for this one three-line component.
export function SectionHeading({ title }: { title: string }) {
  const theme = useTheme2();
  return <h3 style={{ ...theme.typography.h3, margin: 0 }}>{title}</h3>;
}
