import { DataFrame, FieldType, MappingType, applyFieldOverrides, createTheme } from '@grafana/data';
import { csvFileName, framesToCsv } from './tableExport';

function withDisplay(frame: DataFrame): DataFrame[] {
  return applyFieldOverrides({
    data: [frame],
    fieldConfig: { defaults: {}, overrides: [] },
    replaceVariables: (v) => v,
    theme: createTheme(),
  });
}

describe('framesToCsv', () => {
  test('writes display names, mapped values and units; quotes where needed', () => {
    const frame: DataFrame = {
      length: 2,
      fields: [
        { name: 'cronjob', type: FieldType.string, config: { displayName: 'CRONJOB' }, values: ['backup', 'a;b "c"'] },
        {
          name: 'Value #status',
          type: FieldType.number,
          config: {
            displayName: 'STATUS',
            mappings: [{ type: MappingType.ValueToText, options: { '0': { text: 'Active' }, '1': { text: 'Suspended' } } }],
          },
          values: [0, 1],
        },
        { name: 'mem', type: FieldType.number, config: { displayName: 'MEM', unit: 'bytes' }, values: [1073741824, null] },
      ],
    };
    expect(framesToCsv(withDisplay(frame)).split('\r\n')).toEqual([
      'CRONJOB;STATUS;MEM',
      'backup;Active;1 GiB',
      '"a;b ""c""";Suspended;',
    ]);
  });

  test('writes dateTime units as absolute timestamps and skips hidden fields', () => {
    const frame: DataFrame = {
      length: 1,
      fields: [
        { name: 'last', type: FieldType.number, config: { displayName: 'LAST', unit: 'dateTimeFromNow' }, values: [0] },
        { name: 'secret', type: FieldType.string, config: { custom: { hidden: true } }, values: ['x'] },
      ],
    };
    const [header, row] = framesToCsv(withDisplay(frame)).split('\r\n');
    expect(header).toBe('LAST');
    expect(row).toMatch(/^19(69|70)-\d\d-\d\d \d\d:\d\d:\d\d$/);
  });

  test('drops the button column and writes ready/desired cells as "x / y"', () => {
    const frame: DataFrame = {
      length: 2,
      fields: [
        { name: 'Value #ready', type: FieldType.number, config: { displayName: 'Pods', custom: { desiredPodsValues: [2, 1] } }, values: [1, NaN] },
        { name: 'action', type: FieldType.string, config: { displayName: 'Action' }, values: ['', ''] },
      ],
    };
    expect(framesToCsv(withDisplay(frame)).split('\r\n')).toEqual(['Pods', '1 / 2', '0 / 1']);
  });
});

describe('csvFileName', () => {
  test('slugs the panel title and stamps the time', () => {
    expect(csvFileName('Cronjobs / Prod (all)', new Date(2026, 8, 22, 9, 5))).toBe('cronjobs-prod-all-20260922-0905.csv');
    expect(csvFileName('  ', new Date(2026, 0, 1, 0, 0))).toBe('table-20260101-0000.csv');
  });
});
