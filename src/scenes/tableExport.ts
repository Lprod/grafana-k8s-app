import { DataFrame, Field, dateTimeFormat, formattedValueToString, getFieldDisplayName } from '@grafana/data';
import { VizPanel, sceneGraph } from '@grafana/scenes';
import { DESIRED_PODS_KEY } from './tableCells';

// "Export CSV" in every table panel's menu (F-11, added by attachExploreMenus
// in panelExplore.tsx). Exports what the table shows rather than what the
// query returned: the organize-renamed column headers, value mappings
// ("Active"/"Suspended") and units ("1.5 GiB") - so it runs on the frames
// *after* the panel's own field config is applied (VizPanel.applyFieldConfig).
// Two deliberate departures from the on-screen text:
// - dateTime* units ("5 minutes ago" on screen) are written as absolute
//   timestamps; a relative time is meaningless once the file is opened later.
// - every row is exported, not just the current pagination page.
// - the button column ("action": oc / Investigate) is left out, and the two
//   "ready / desired" style cells (Pods, PODS/COMPLETION), whose second number
//   rides along in config.custom, are written as "x / y" like on screen.
// Semicolon-separated with a UTF-8 BOM, so a German-locale Excel opens it
// straight into columns (a comma-separated file lands in a single column
// there).

const DELIMITER = ';';

function escapeCell(text: string): string {
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const DENOMINATOR_KEYS = [DESIRED_PODS_KEY, 'completionValues'];

function isExported(field: Field): boolean {
  return field.name !== 'action' && !field.config.custom?.hidden && !field.config.custom?.hideFrom?.viz;
}

export function formatCell(field: Field, value: unknown, row = -1): string {
  const denominatorKey = DENOMINATOR_KEYS.find((k) => Array.isArray(field.config.custom?.[k]));
  if (denominatorKey && row >= 0) {
    const denominator = field.config.custom[denominatorKey][row];
    const numerator = typeof value === 'number' && !Number.isNaN(value) ? value : 0;
    return `${numerator} / ${denominator ?? 0}`;
  }
  if (value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value))) {
    return '';
  }
  const unit = field.config.unit ?? '';
  if (unit.startsWith('dateTime') && typeof value === 'number') {
    return dateTimeFormat(value, { format: 'YYYY-MM-DD HH:mm:ss' });
  }
  if (field.display) {
    return formattedValueToString(field.display(value));
  }
  return String(value);
}

export function framesToCsv(frames: DataFrame[]): string {
  const blocks = frames
    .filter((frame) => frame.fields.length > 0)
    .map((frame) => {
      const fields = frame.fields.filter(isExported);
      const header = fields.map((f) => escapeCell(getFieldDisplayName(f, frame, frames)));
      const lines = [header.join(DELIMITER)];
      for (let row = 0; row < frame.length; row++) {
        lines.push(fields.map((f) => escapeCell(formatCell(f, f.values[row], row))).join(DELIMITER));
      }
      return lines.join('\r\n');
    });
  return blocks.join('\r\n\r\n');
}

export function csvFileName(title: string, now = new Date()): string {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'table';
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${base}-${stamp}.csv`;
}

export function exportPanelCsv(panel: VizPanel) {
  const data = sceneGraph.getData(panel).state.data;
  if (!data || data.series.length === 0) {
    return;
  }
  const csv = framesToCsv(panel.applyFieldConfig(data).series);
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = csvFileName(sceneGraph.interpolate(panel, panel.state.title));
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously cancels the download in Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
