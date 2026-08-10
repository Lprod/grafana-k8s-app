import {
  formatCpuQuantity,
  formatGiBQuantity,
  parseByteQuantityToGiB,
  parseCpuQuantityToCores,
} from './resourceQuantities';
import { BYTES_PER_GIB } from './resourceSimulatorModel';

describe('resource quantity parsing', () => {
  it('parses Kubernetes CPU quantities as cores', () => {
    expect(parseCpuQuantityToCores('500m')).toBe(0.5);
    expect(parseCpuQuantityToCores('2500m')).toBe(2.5);
    expect(parseCpuQuantityToCores('2')).toBe(2);
    expect(parseCpuQuantityToCores('0.25')).toBe(0.25);
    expect(parseCpuQuantityToCores('bad')).toBeUndefined();
  });

  it('parses Kubernetes memory and storage quantities as GiB', () => {
    expect(parseByteQuantityToGiB('2')).toBe(2 / BYTES_PER_GIB);
    expect(parseByteQuantityToGiB('2Gi')).toBe(2);
    expect(parseByteQuantityToGiB('2 Gi')).toBe(2);
    expect(parseByteQuantityToGiB('2048Mi')).toBe(2);
    expect(parseByteQuantityToGiB('1Ti')).toBe(1024);
    expect(parseByteQuantityToGiB('1GiB')).toBeUndefined();
    expect(parseByteQuantityToGiB('bad')).toBeUndefined();
  });

  it('formats simulator quantities with Kubernetes-friendly suffixes', () => {
    expect(formatCpuQuantity(0.5)).toBe('500m');
    expect(formatCpuQuantity(2)).toBe('2');
    expect(formatCpuQuantity(1.25)).toBe('1.25');
    expect(formatGiBQuantity(2)).toBe('2Gi');
    expect(formatGiBQuantity(1.5)).toBe('1.5Gi');
    expect(formatGiBQuantity(512 / BYTES_PER_GIB)).toBe('512');
    expect(formatGiBQuantity(512 / 1024)).toBe('512Mi');
  });
});
