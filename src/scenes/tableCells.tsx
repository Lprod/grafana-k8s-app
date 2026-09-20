import React from 'react';
import { DisplayValue, Field } from '@grafana/data';
import { Badge, BadgeColor, CustomCellRendererProps, useTheme2 } from '@grafana/ui';
import { ThresholdsMode } from '@grafana/schema';
import type { CustomTransformOperator } from '@grafana/scenes';
import { map } from 'rxjs/operators';

export type UsageTier = 'low' | 'med' | 'high' | 'unknown';

// How full the meter glyph reads per tier, as a fraction of its inner
// height - the same quarter/half/three-quarters progression the three
// usage-*.png bitmaps this replaced were drawn with.
const TIER_FILL: Record<Exclude<UsageTier, 'unknown'>, number> = {
  low: 0.33,
  med: 0.55,
  high: 0.78,
};

export const PERCENT_FIELD_NAMES = [
  'Value #cpu_usage_avg_percent',
  'Value #cpu_usage_max_percent',
  'Value #mem_usage_avg_percent',
  'Value #mem_usage_max_percent',
];

// Usage tiers reflect a cost/capacity-planning read, not a plain "more is
// worse" scale: under 60% is flagged orange (paying for idle capacity),
// 60-90% is the healthy "green" range, and over 90% is red (at risk of
// hitting the ceiling).
// Same 60%/90% split as usageTierFromFraction below, as a Grafana thresholds
// config instead of a plain function - for `.overrideThresholds(...)` on a
// field whose own cell coloring Grafana can drive natively (unlike the
// custom-rendered cells usageTierFromFraction/usageColorFromTier are for).
// Previously redeclared identically in every list page (Clusters, Nodes,
// Namespaces, Workloads) - keep both in sync if this ever changes.
export const usageThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'orange', value: -Infinity },
    { color: 'green', value: 0.6 },
    { color: 'red', value: 0.9 },
  ],
};

// The *inverse* direction of usageThresholds, for "coverage"-style ratios
// where a higher number is unambiguously better and 100% is the goal - e.g.
// "Containers with CPU/Memory requests set". usageThresholds is a
// *utilisation* scale (too low wastes capacity, too high risks the ceiling),
// so reusing it here paints a perfectly-configured 100% workload red. Same
// 60%/90% split, mirrored: under 60% red, 60-90% orange, 90%+ green.
export const coverageThresholds = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { color: 'red', value: -Infinity },
    { color: 'orange', value: 0.6 },
    { color: 'green', value: 0.9 },
  ],
};

export function usageTierFromFraction(fraction: number | null | undefined): UsageTier {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) {
    return 'unknown';
  }
  if (fraction >= 0.9) {
    return 'high';
  }
  if (fraction >= 0.6) {
    return 'med';
  }
  return 'low';
}

// Grafana's Table panel only supports coloring a cell from its own field's
// thresholds, but we want the absolute column (e.g. "CPU Avg") to match the
// color of its percentage sibling ("CPU Avg %") in the same row. A custom
// cell renderer is the only way to read another field's value for the same
// row, so we look up the percent field by name and color by its value
// instead of this field's own value.
export function usageColorFromTier(theme: ReturnType<typeof useTheme2>, tier: UsageTier) {
  switch (tier) {
    case 'high':
      return theme.visualization.getColorByName('red');
    case 'med':
      return theme.visualization.getColorByName('green');
    case 'low':
      return theme.visualization.getColorByName('orange');
    default:
      return theme.visualization.getColorByName('grey');
  }
}

// Same tiers as usageColorFromTier, mapped to @grafana/ui's fixed Badge
// palette instead of an arbitrary theme color - for cells that show the
// percent value inside a Badge "pill" (e.g. requestUsageCell below) rather
// than as plain colored text.
function badgeColorForTier(tier: UsageTier): BadgeColor {
  switch (tier) {
    case 'high':
      return 'red';
    case 'med':
      return 'green';
    case 'low':
      return 'orange';
    default:
      return 'darkgrey';
  }
}

// field.display() splits a formatted value into text + prefix/suffix (e.g.
// the "cores"/"GiB" unit lives in `suffix`, not `text`), so callers must
// stitch these back together themselves.
export function formatDisplay(display: DisplayValue | { text: string; prefix?: string; suffix?: string }) {
  return `${display.prefix ?? ''}${display.text}${display.suffix ?? ''}`;
}

// Fill-level meter glyph, drawn in the row's own tier color.
//
// This used to be three imported PNGs (img/usage-{low,med,high}.png), which
// were pure-white bitmaps: fine on the dark theme's table background,
// completely invisible on the light theme's white one - in every CPU/Memory
// cell across Clusters/Nodes/Namespaces/Workloads and their drilldown
// tables, and in ResourceUsageLegend's own "low / med / high" key. Inline
// SVG fixes that and additionally lets the glyph carry the same tier color
// as the value beside it, instead of staying neutral.
//
// 'unknown' deliberately keeps a different *shape* (a plain dot, not a
// meter): "no data for this row" is not a fill level.
export function UsageIcon({ tier, size = 14 }: { tier: UsageTier; size?: number }) {
  const theme = useTheme2();
  const color = usageColorFromTier(theme, tier);

  if (tier === 'unknown') {
    return (
      <span
        role="img"
        aria-label="usage unknown"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: color,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
    );
  }

  const innerTop = 3;
  const innerBottom = 19.4;
  const fillHeight = (innerBottom - innerTop) * TIER_FILL[tier];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={`${tier} usage`}
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      {/* left wall, right wall, closed bottom - an open-topped meter */}
      <path d="M6 3h1.6v18H6zM16.4 3H18v18h-1.6zM6 19.4h12V21H6z" fill={color} />
      {/* the level itself, rising from the bottom */}
      <rect x="7.6" y={innerBottom - fillHeight} width="8.8" height={fillHeight} fill={color} />
    </svg>
  );
}

function findFraction(frame: CustomCellRendererProps['frame'], rowIndex: number, fieldName: string) {
  const field = frame.fields.find((f) => f.name === fieldName);
  return field ? (field.values[rowIndex] as number | null | undefined) : undefined;
}

// Shared rendering for "fill-level icon + tier-colored value" cells -
// linkedValueCell and usageTierCell only differ in where the coloring
// fraction comes from (a sibling frame field vs. a value stashed in this
// field's own config by attachPercentField).
function IconValueCell({
  tier,
  color,
  display,
}: {
  tier: UsageTier;
  color: string;
  display: DisplayValue | { text: string; prefix?: string; suffix?: string };
}) {
  const text = formatDisplay(display);
  // Native `title` so a value too wide for its column is still readable on
  // hover. Grafana adds one of these itself on panel titles and table column
  // headers, but not on a custom cell renderer's own output.
  return (
    <span
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      title={tier === 'unknown' ? text : `${text} (${tier} usage)`}
    >
      <UsageIcon tier={tier} />
      <span style={{ color }}>{text}</span>
    </span>
  );
}

export function linkedValueCell(percentFieldName: string) {
  return function LinkedValueCell({ field, rowIndex, frame, value }: CustomCellRendererProps) {
    const theme = useTheme2();
    const tier = usageTierFromFraction(findFraction(frame, rowIndex, percentFieldName));
    const color = usageColorFromTier(theme, tier);
    const display = field.display ? field.display(value) : { text: String(value ?? '') };

    return <IconValueCell tier={tier} color={color} display={display} />;
  };
}

// Copies a source field's values onto a sibling target field's own custom
// config, keyed by configKey, so a cell renderer for the target field can
// read both numbers off the one field it's actually rendering.
//
// The obvious alternative - keep the source as its own field, hide it from
// its own column via a `hideFrom: { viz: true }` override the way Grafana's
// own legend "hide series" feature does it (see seriesVisibilityConfigFactory
// in @grafana/scenes) - doesn't work for a Table panel: applying a
// `custom.*` override only takes effect if the active panel type has that
// property registered in its own field-config registry (see
// `setDynamicConfigValue` in @grafana/data - an override for an
// unregistered custom.* id is silently dropped, no error), and the Table
// panel doesn't register "hideFrom" even though its own rendering code
// checks for it. The override was reaching the field-config overrides array
// exactly as intended but never actually landing on the field - confirmed by
// temporarily swapping it for `overrideDisplayName` on the same field, which
// *did* take effect. Attaching the value here instead sidesteps field
// overrides entirely: the source field can then be fully removed from the
// frame via `organize`'s `excludeByName` rather than merely hidden.
export function attachFieldValues(targetFieldName: string, sourceFieldName: string, configKey: string): CustomTransformOperator {
  return () => (source) =>
    source.pipe(
      map((frames) =>
        frames.map((frame) => {
          const sourceField = frame.fields.find((f) => f.name === sourceFieldName);
          if (!sourceField) {
            return frame;
          }
          return {
            ...frame,
            fields: frame.fields.map((f) =>
              f.name === targetFieldName
                ? { ...f, config: { ...f.config, custom: { ...f.config.custom, [configKey]: sourceField.values } } }
                : f
            ),
          };
        })
      )
    );
}

// Reorders a table frame's rows by a caller-supplied rank over one field,
// highest rank first. Grafana's own `sortBy` panel option can only sort a
// string column alphabetically, which is the wrong order for a severity
// ("critical" < "info" < "warning" alphabetically puts info above warning),
// and a hidden numeric rank column to sort by instead isn't an option either
// - `excludeByName` genuinely removes a field and `custom.hideFrom` is a
// no-op on the Table panel (see attachFieldValues above). Sorting the rows in
// the data pipeline avoids both: the table renders what it is handed, worst
// first, and clicking any header still re-sorts as before.
//
// Rows whose value has no rank (rank returns undefined) keep their relative
// order and sort last, so the common "nothing is wrong" case is left in
// whatever order the join or merge produced rather than shuffled.
//
// Crucially this also reorders the per-row arrays attachFieldValues stashed
// into `config.custom` (percentValues, desiredPodsValues). Those are indexed
// by row, so reordering only `field.values` would silently pair every row
// with another row's percentage or desired-pod count - which is exactly what
// happened the first time this ran against the Workloads table.
export function sortRowsByRank(
  fieldName: string,
  rank: (value: unknown, rowIndex: number, field: Field) => number | undefined
): CustomTransformOperator {
  return () => (source) =>
    source.pipe(
      map((frames) =>
        frames.map((frame) => {
          const field = frame.fields.find((f) => f.name === fieldName);
          if (!field || frame.length === 0) {
            return frame;
          }
          const order = field.values
            .map((value, index) => ({ index, rank: rank(value, index, field) }))
            .sort((a, b) => {
              const ra = a.rank ?? -Infinity;
              const rb = b.rank ?? -Infinity;
              return rb === ra ? a.index - b.index : rb - ra;
            })
            .map((entry) => entry.index);

          const reorder = <T,>(values: T[]) => order.map((i) => values[i]);

          return {
            ...frame,
            fields: frame.fields.map((f) => {
              const custom = f.config.custom as Record<string, unknown> | undefined;
              const reorderedCustom = custom
                ? Object.fromEntries(
                    Object.entries(custom).map(([key, value]) => [
                      key,
                      Array.isArray(value) && value.length === frame.length ? reorder(value) : value,
                    ])
                  )
                : custom;

              return {
                ...f,
                values: reorder(f.values),
                config: custom ? { ...f.config, custom: reorderedCustom } : f.config,
              };
            }),
          };
        })
      )
    );
}

export const DESIRED_PODS_KEY = 'desiredPodsValues';

export function attachDesiredPodsField(readyFieldName: string, desiredFieldName: string): CustomTransformOperator {
  return attachFieldValues(readyFieldName, desiredFieldName, DESIRED_PODS_KEY);
}

// Combines a "ready" field (this cell's own value) with the "desired" values
// attachDesiredPodsField stashed in its config into a single "ready /
// desired" cell with a proportional colored bar underneath - matching
// Grafana Play's Workloads "Pods" column.
//
// Three states, not two: every pod ready (ready >= desired, including a
// mid-rollout surge past it) is green and full; some but not all ready is
// yellow, filled to the actual ready/desired fraction; none ready at all -
// including a genuine 0/0 (scaled to zero) - is red and *fully* filled
// rather than empty, so a completely down workload reads as maximally
// alarming instead of looking like an empty/neutral bar.
export function readyDesiredPodsCell() {
  return function ReadyDesiredPodsCell({ rowIndex, field, value }: CustomCellRendererProps) {
    const theme = useTheme2();
    const ready = typeof value === 'number' ? value : Number(value ?? 0);
    const desiredValues = field.config?.custom?.[DESIRED_PODS_KEY] as Array<number | null | undefined> | undefined;
    const desired = (desiredValues?.[rowIndex] as number | undefined) ?? 0;
    const fraction = ready === 0 ? 1 : desired > 0 ? Math.min(ready / desired, 1) : 1;
    const color =
      ready === 0
        ? theme.visualization.getColorByName('red')
        : ready >= desired
          ? theme.visualization.getColorByName('green')
          : theme.visualization.getColorByName('yellow');

    return (
      <div
        title={`${ready} of ${desired} pod${desired === 1 ? '' : 's'} ready`}
        style={{
          position: 'relative',
          height: 20,
          minWidth: 60,
          width: '100%',
          borderRadius: 2,
          overflow: 'hidden',
          backgroundColor: theme.colors.background.secondary,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${fraction * 100}%`,
            backgroundColor: color,
            opacity: 0.35,
          }}
        />
        <span
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            fontSize: 12,
          }}
        >
          {ready} / {desired}
        </span>
      </div>
    );
  };
}

const PERCENT_VALUES_KEY = 'percentValues';

export function attachPercentField(valueFieldName: string, percentFieldName: string): CustomTransformOperator {
  return attachFieldValues(valueFieldName, percentFieldName, PERCENT_VALUES_KEY);
}

// Value + percent (in a Badge "pill", matching the Resource Simulator's own
// quota-card badges - see PanelTimeRangeCompare for the same styling choice)
// on one line, with a proportional usage-tier-colored bar underneath -
// replacing two separate "X" / "X %" columns with one, visually modeled on
// the Resource Simulator's used/requested meter cells (UsageRequestMeter in
// ResourceSimulatorObject.tsx), but colored with this page's usual
// usageTierFromFraction scale (orange<60%/green 60-90%/red>90%) instead of
// the Simulator's separate 20/80/100/150% planning-ratio scale, to stay
// consistent with every other usage-colored cell in these tables.
export function requestUsageCell() {
  return function RequestUsageCell({ field, rowIndex, value }: CustomCellRendererProps) {
    const theme = useTheme2();
    const percentValues = field.config?.custom?.[PERCENT_VALUES_KEY] as Array<number | null | undefined> | undefined;
    const fraction = percentValues?.[rowIndex] ?? undefined;
    const tier = usageTierFromFraction(fraction);
    const color = usageColorFromTier(theme, tier);
    const display = field.display ? field.display(value) : { text: String(value ?? '') };
    const percentText =
      fraction === null || fraction === undefined || Number.isNaN(fraction) ? '-' : `${Math.round(fraction * 100)}%`;
    const barWidth =
      fraction === null || fraction === undefined || Number.isNaN(fraction) ? 0 : Math.min(100, Math.max(2, fraction * 100));

    const text = formatDisplay(display);

    return (
      <div style={{ width: '100%', minWidth: 90 }} title={`${text} - ${percentText} used`}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span>{text}</span>
          <Badge color={badgeColorForTier(tier)} text={percentText} />
        </div>
        <div
          style={{
            position: 'relative',
            height: 4,
            borderRadius: 2,
            marginTop: 4,
            overflow: 'hidden',
            backgroundColor: theme.colors.background.secondary,
          }}
        >
          <div style={{ position: 'absolute', inset: 0, width: `${barWidth}%`, backgroundColor: color }} />
        </div>
      </div>
    );
  };
}

// Fill-level icon + tier-colored value for a field whose coloring percent
// was stashed via attachPercentField onto *this* field's own config, rather
// than a sibling frame field the way linkedValueCell reads it - for a column
// (e.g. Namespaces' CPU Usage) that wants the same coloring as a merged
// value+percent+bar cell elsewhere in the same row, once that percent field
// has been excluded from the frame as its own column.
export function usageTierCell() {
  return function UsageTierCell({ field, rowIndex, value }: CustomCellRendererProps) {
    const theme = useTheme2();
    const percentValues = field.config?.custom?.[PERCENT_VALUES_KEY] as Array<number | null | undefined> | undefined;
    const tier = usageTierFromFraction(percentValues?.[rowIndex] ?? undefined);
    const color = usageColorFromTier(theme, tier);
    const display = field.display ? field.display(value) : { text: String(value ?? '') };

    return <IconValueCell tier={tier} color={color} display={display} />;
  };
}
