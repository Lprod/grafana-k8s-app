import React from 'react';
import { DisplayValue } from '@grafana/data';
import { Badge, BadgeColor, CustomCellRendererProps, useTheme2 } from '@grafana/ui';
import { ThresholdsMode } from '@grafana/schema';
import type { CustomTransformOperator } from '@grafana/scenes';
import { map } from 'rxjs/operators';
import usageLowIcon from '../img/usage-low.png';
import usageMedIcon from '../img/usage-med.png';
import usageHighIcon from '../img/usage-high.png';

export type UsageTier = 'low' | 'med' | 'high' | 'unknown';

const TIER_ICON: Record<Exclude<UsageTier, 'unknown'>, string> = {
  low: usageLowIcon,
  med: usageMedIcon,
  high: usageHighIcon,
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

// Plain (untinted) icon - the PNG's own colors are used as-is.
export function UsageIcon({ tier, size = 14 }: { tier: UsageTier; size?: number }) {
  if (tier === 'unknown') {
    return (
      <span
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: '#8E8E8E',
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <img
      src={TIER_ICON[tier]}
      alt={`${tier} usage`}
      width={size}
      height={size}
      style={{ display: 'inline-block', flexShrink: 0 }}
    />
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
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <UsageIcon tier={tier} />
      <span style={{ color }}>{formatDisplay(display)}</span>
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
function attachFieldValues(targetFieldName: string, sourceFieldName: string, configKey: string): CustomTransformOperator {
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

const DESIRED_PODS_KEY = 'desiredPodsValues';

export function attachDesiredPodsField(readyFieldName: string, desiredFieldName: string): CustomTransformOperator {
  return attachFieldValues(readyFieldName, desiredFieldName, DESIRED_PODS_KEY);
}

// Combines a "ready" field (this cell's own value) with the "desired" values
// attachDesiredPodsField stashed in its config into a single "ready /
// desired" cell with a proportional colored bar underneath - matching
// Grafana Play's Workloads "Pods" column.
//
// Unlike the usage-tier coloring elsewhere in this codebase (low is orange/
// underused, high is red/near-capacity), readiness is the opposite sense:
// ready caught up to (or past, e.g. mid-rollout) desired is healthy/green,
// short of desired is red. Plain colors rather than usageTierFromFraction,
// which encodes the other scale.
export function readyDesiredPodsCell() {
  return function ReadyDesiredPodsCell({ rowIndex, field, value }: CustomCellRendererProps) {
    const theme = useTheme2();
    const ready = typeof value === 'number' ? value : Number(value ?? 0);
    const desiredValues = field.config?.custom?.[DESIRED_PODS_KEY] as Array<number | null | undefined> | undefined;
    const desired = (desiredValues?.[rowIndex] as number | undefined) ?? 0;
    const fraction = desired > 0 ? Math.min(ready / desired, 1) : ready > 0 ? 1 : 0;
    const color =
      desired === 0 && ready === 0
        ? theme.visualization.getColorByName('grey')
        : ready >= desired
          ? theme.visualization.getColorByName('green')
          : theme.visualization.getColorByName('red');

    return (
      <div
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

    return (
      <div style={{ width: '100%', minWidth: 90 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span>{formatDisplay(display)}</span>
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
