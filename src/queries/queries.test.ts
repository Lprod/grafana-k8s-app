import * as fs from 'fs';
import * as path from 'path';

// Bracket-balance check over every query this app can send.
//
// These queries are long, hand-assembled template strings, and nothing
// compiles them: a misplaced bracket is still a perfectly valid TypeScript
// string and only fails once Prometheus parses it at runtime. That is how
// v3.0.1 shipped the Workload Drilldown's alerts query with its closing
// parenthesis *inside* a label matcher (`cluster="<name>)"`): every Workload
// Drilldown's health banner then silently read "healthy / No firing alerts",
// because the failed query simply contributed no alerts.
//
// Quoted strings are removed before counting - precisely so that a bracket
// which ended up inside quotes, as above, is seen as missing rather than
// being counted as if it were in the right place.

const QUERY_DIR = __dirname;

function stripNoise(query: string): string {
  return query
    .split('\n')
    .map((line) => line.replace(/^\s*#.*$/, ''))
    .join('\n')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function bracketProblem(query: string): string | undefined {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: string[] = [];
  for (const char of stripNoise(query)) {
    if (char === '(' || char === '[' || char === '{') {
      stack.push(char);
    } else if (char in pairs) {
      if (stack.pop() !== pairs[char]) {
        return `unexpected "${char}"`;
      }
    }
  }
  return stack.length > 0 ? `unclosed "${stack[stack.length - 1]}"` : undefined;
}

// Every string reachable from a module's exports: plain strings, maps and
// lists of them, `{ expr }`/`{ query }` targets, and whatever a builder
// function returns when called with placeholder arguments.
function collectStrings(value: unknown, into: string[], depth = 0): void {
  if (depth > 4 || value === null || value === undefined) {
    return;
  }
  if (typeof value === 'string') {
    into.push(value);
  } else if (typeof value === 'function') {
    try {
      collectStrings((value as (...args: string[]) => unknown)(...new Array(value.length).fill('x')), into, depth + 1);
    } catch {
      // A builder that needs real arguments - not something this test can call.
    }
  } else if (typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) {
      collectStrings(inner, into, depth + 1);
    }
  }
}

const queryFiles = fs
  .readdirSync(QUERY_DIR)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  .sort();

describe('query strings', () => {
  it('finds the query modules', () => {
    expect(queryFiles.length).toBeGreaterThan(20);
  });

  it.each(queryFiles)('%s has balanced brackets in every query', (file) => {
    const exported = require(path.join(QUERY_DIR, file)) as Record<string, unknown>;
    const strings: string[] = [];
    collectStrings(exported, strings);

    const problems = strings
      .filter((text) => /[({[]/.test(text))
      .map((text) => ({ problem: bracketProblem(text), text }))
      .filter((entry) => entry.problem !== undefined)
      .map((entry) => `${entry.problem} in: ${entry.text.replace(/\s+/g, ' ').slice(0, 160)}`);

    expect(problems).toEqual([]);
  });

  it('catches a bracket that ended up inside a quoted matcher', () => {
    expect(bracketProblem('count(group by (pod) (up{cluster="a)", namespace="b"})')).toBe('unclosed "("');
    expect(bracketProblem('count(group by (pod) (up{cluster="a", namespace="b"}))')).toBeUndefined();
  });
});
