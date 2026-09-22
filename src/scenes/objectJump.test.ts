import { datasourceFromSearch, isJumpShortcut, timeParams } from './objectJump';

const key = (k: string, target: EventTarget | null = document.body, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target,
  ...mods,
});

describe('isJumpShortcut', () => {
  test('"/" on the page opens the overlay', () => {
    expect(isJumpShortcut(key('/'))).toBe(true);
  });

  test('ignores "/" typed into a field, and modified or other keys', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    // e.g. a code editor that renders its own textbox role
    const editor = document.createElement('div');
    editor.setAttribute('role', 'textbox');
    const inner = document.createElement('span');
    editor.appendChild(inner);

    expect(isJumpShortcut(key('/', input))).toBe(false);
    expect(isJumpShortcut(key('/', textarea))).toBe(false);
    expect(isJumpShortcut(key('/', inner))).toBe(false);
    expect(isJumpShortcut(key('/', document.body, { ctrlKey: true }))).toBe(false);
    expect(isJumpShortcut(key('k'))).toBe(false);
  });
});

describe('datasourceFromSearch', () => {
  test('reads the Thanos datasource even under a Scenes-suffixed key', () => {
    expect(datasourceFromSearch('?var-datasource-6=thanos-prod&var-cluster=a')).toBe('thanos-prod');
    expect(datasourceFromSearch('?var-datasource=thanos-demo')).toBe('thanos-demo');
  });

  test('ignores other datasource variables and missing values', () => {
    expect(datasourceFromSearch('?var-logsDatasource=es&var-datasource=')).toBeUndefined();
    expect(datasourceFromSearch('')).toBeUndefined();
  });
});

describe('timeParams', () => {
  test('keeps only the time range', () => {
    expect(timeParams('?from=now-6h&to=now&timezone=browser&var-cluster=a&refresh=1m')).toBe('?from=now-6h&to=now&timezone=browser');
    expect(timeParams('?var-cluster=a')).toBe('');
  });
});
