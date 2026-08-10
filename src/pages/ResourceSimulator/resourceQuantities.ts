import { BYTES_PER_GIB } from './resourceSimulatorModel';

const QUANTITY_PATTERN = /^\s*([+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?)\s*([a-zA-Z]*)\s*$/;

const CPU_MULTIPLIERS: Record<string, number> = {
  '': 1,
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

const BYTE_MULTIPLIERS: Record<string, number> = {
  '': 1,
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: BYTES_PER_GIB,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
};

export function parseCpuQuantityToCores(value: string) {
  return parseQuantity(value, CPU_MULTIPLIERS);
}

export function parseByteQuantityToGiB(value: string) {
  const bytes = parseQuantity(value, BYTE_MULTIPLIERS);
  return bytes === undefined ? undefined : bytes / BYTES_PER_GIB;
}

export function formatCpuQuantity(cores: number) {
  if (!Number.isFinite(cores) || cores <= 0) {
    return '0';
  }

  const millicores = cores * 1000;

  if (cores < 1 && nearlyInteger(millicores)) {
    return `${Math.round(millicores)}m`;
  }

  return formatQuantityNumber(cores);
}

export function formatGiBQuantity(gib: number) {
  if (!Number.isFinite(gib) || gib <= 0) {
    return '0';
  }

  const bytes = gib * BYTES_PER_GIB;

  if (bytes < 1024) {
    return formatQuantityNumber(bytes);
  }

  if (bytes < 1024 ** 2) {
    return `${formatQuantityNumber(bytes / 1024)}Ki`;
  }

  if (bytes < BYTES_PER_GIB) {
    return `${formatQuantityNumber(bytes / 1024 ** 2)}Mi`;
  }

  return `${formatQuantityNumber(gib)}Gi`;
}

function parseQuantity(value: string, multipliers: Record<string, number>) {
  const match = QUANTITY_PATTERN.exec(value);

  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  const multiplier = multipliers[match[2]];

  if (!Number.isFinite(amount) || amount < 0 || multiplier === undefined) {
    return undefined;
  }

  return amount * multiplier;
}

function nearlyInteger(value: number) {
  return Math.abs(value - Math.round(value)) < 0.000001;
}

function formatQuantityNumber(value: number) {
  return String(Number(value.toFixed(3)));
}
