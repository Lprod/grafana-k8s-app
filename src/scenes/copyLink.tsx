import React from 'react';
import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { SceneReactObject } from '@grafana/scenes';
import { ToolbarButton } from '@grafana/ui';

// Shared clipboard write. Extracted from ocCell.tsx (which still uses it for
// its per-row `oc` commands) when the page-level "copy link" control below
// needed the exact same secure-context handling and success/error toasts.
//
// `navigator.clipboard` is only defined in a secure context (https or
// localhost). Grafana is normally served over one, but fall back to the
// legacy execCommand path rather than silently doing nothing when it isn't.
export function copyToClipboard(text: string, successTitle = 'Copied') {
  const succeeded = () => getAppEvents().publish({ type: AppEvents.alertSuccess.name, payload: [successTitle, text] });
  const failed = () =>
    getAppEvents().publish({ type: AppEvents.alertError.name, payload: ['Could not copy to the clipboard'] });

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(succeeded, failed);
    return;
  }

  const area = document.createElement('textarea');
  area.value = text;
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

// Every page in this app already keeps its full state - selected clusters,
// namespaces, workload/pod filters, datasource, time range - in the URL, so
// the current address *is* the shareable view. Nothing surfaced that until
// now: sharing a filtered view meant knowing to copy the browser's address
// bar. Reads `window.location.href` at click time rather than from a scene
// variable so it picks up whatever the URL sync has most recently written.
function CopyPageLink() {
  return (
    <ToolbarButton
      icon="link"
      tooltip="Copy a link to this view, including filters and time range"
      aria-label="Copy link to this view"
      onClick={() => copyToClipboard(window.location.href, 'Link copied')}
    />
  );
}

// Factory rather than an exported element so the `.ts` pages (alertsPage.ts)
// can add the control too without needing JSX of their own.
export function copyLinkControl() {
  return new SceneReactObject({ reactNode: <CopyPageLink /> });
}
