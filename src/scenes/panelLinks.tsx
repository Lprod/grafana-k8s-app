import React from 'react';
import { Icon, Tooltip } from '@grafana/ui';

// A small icon in a panel's title bar linking elsewhere - Grafana's classic
// "panel link" affordance, distinct from a field/data link (which is only
// clickable over a value/cell, not the whole panel). Pass to a VizPanel via
// `.setState({ titleItems: <PanelLinkTitleItem .../> })` after `.build()`
// (VizPanelBuilder has no `setTitleItems`, only the built VizPanel's own
// `titleItems` state field).
export function PanelLinkTitleItem({ title, url }: { title: string; url: string }) {
  return (
    <Tooltip content={title}>
      <a href={url} style={{ display: 'flex', alignItems: 'center', color: 'inherit' }}>
        <Icon name="external-link-alt" size="sm" />
      </a>
    </Tooltip>
  );
}
