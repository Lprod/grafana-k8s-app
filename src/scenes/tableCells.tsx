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

export function usageTierFromFraction(fraction: number | null | undefined): UsageTier {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) {
    return 'unknown';
  }
  if (fraction >= 0.8) {
    return 'high';
  }
  if (fraction >= 0.5) {
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
      return theme.visualization.getColorByName('yellow');
    case 'low':
      return theme.visualization.getColorByName('green');
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
