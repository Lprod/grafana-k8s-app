import React from 'react';
import { DisplayValue } from '@grafana/data';
import { CustomCellRendererProps, useTheme2 } from '@grafana/ui';
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

export function linkedValueCell(percentFieldName: string) {
  return function LinkedValueCell({ field, rowIndex, frame, value }: CustomCellRendererProps) {
    const theme = useTheme2();
    const tier = usageTierFromFraction(findFraction(frame, rowIndex, percentFieldName));
    const color = usageColorFromTier(theme, tier);
    const display = field.display ? field.display(value) : { text: String(value ?? '') };

    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <UsageIcon tier={tier} />
        <span style={{ color }}>{formatDisplay(display)}</span>
      </span>
    );
  };
}

// Combines a "ready" field with a sibling "desired" field into a single
// "ready / desired" cell with a proportional colored bar underneath -
// matching Grafana Play's Workloads "Pods" column. The desired field stays
// present in the data frame (for this lookup) but is hidden from its own
// column via `hideFrom: { viz: true }` on that field's override, so it
// doesn't also render as a separate "Desired Pods" column.
//
// Unlike the usage-tier coloring elsewhere in this codebase (low is orange/
// underused, high is red/near-capacity), readiness is the opposite sense:
// ready caught up to (or past, e.g. mid-rollout) desired is healthy/green,
// short of desired is red. Plain colors rather than usageTierFromFraction,
// which encodes the other scale.
export function readyDesiredPodsCell(desiredFieldName: string) {
  return function ReadyDesiredPodsCell({ rowIndex, frame, value }: CustomCellRendererProps) {
    const theme = useTheme2();
    const ready = typeof value === 'number' ? value : Number(value ?? 0);
    const desired = findFraction(frame, rowIndex, desiredFieldName) ?? 0;
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
