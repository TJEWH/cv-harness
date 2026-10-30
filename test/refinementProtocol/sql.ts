import { REFINEMENT_COMMANDS, type RefinementCommand } from '../../src/features/refinement/domain/refinementProtocolContract';

/** Parse one SELECT of a named helper with literal arguments.
 * Tokenize quoted strings to keep their contents separate from executable SQL. */
export function parseProtocolSql(sql: string): { command: RefinementCommand; values: string[] } {
  let rest = sql.trim();
  const take = (pattern: RegExp): string => {
    const match = pattern.exec(rest);
    if (!match) throw new Error(`SQL is outside the refinement contract near ${rest.slice(0, 60)}`);
    rest = rest.slice(match[0].length).trimStart(); return match[0];
  };
  take(/^select\s+/i);
  const name = take(/^private\.[a-z_]+/i).toLowerCase();
  const entry = Object.entries(REFINEMENT_COMMANDS).find(([, definition]) => definition.name === name);
  if (!entry) throw new Error(`Database exploration or unknown function: ${name}`);
  const [command, definition] = entry;
  take(/^\(/);
  const values: string[] = [];
  for (const [index, type] of definition.types.entries()) {
    if (index) take(/^,/);
    let value = '';
    const dollar = /^\$(?:[a-z_][a-z_0-9]*)?\$/i.exec(rest)?.[0];
    if (dollar) {
      rest = rest.slice(dollar.length);
      const end = rest.indexOf(dollar);
      if (end < 0) throw new Error('Unclosed SQL dollar string.');
      value = rest.slice(0, end); rest = rest.slice(end + dollar.length).trimStart();
    } else {
      const escaped = /^[eE]'/.test(rest);
      if (!escaped && !rest.startsWith("'")) throw new Error('Only SQL literal arguments are permitted.');
      rest = rest.slice(escaped ? 2 : 1);
      let closed = false;
      while (rest.length) {
        const char = rest[0]; rest = rest.slice(1);
        if (char === "'") {
          if (rest[0] === "'") { value += "'"; rest = rest.slice(1); continue; }
          closed = true; break;
        }
        if (char === '\\' && escaped) {
          const escapes: Record<string, string> = { '\\': '\\', "'": "'", n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
          if (!Object.hasOwn(escapes, rest[0])) throw new Error('Unsupported SQL escape; use the supplied query form.');
          value += escapes[rest[0]]; rest = rest.slice(1);
        } else value += char;
      }
      if (!closed) throw new Error('Unclosed SQL literal.');
      rest = rest.trimStart();
    }
    if (rest.startsWith('::')) {
      take(/^::/); const cast = take(/^[a-z]+/i).toLowerCase();
      if (cast !== type) throw new Error(`Unexpected SQL cast ${cast}; expected ${type}.`);
    } else if (type !== 'text') throw new Error(`Missing ${type} cast.`);
    values.push(value);
  }
  take(/^\)/);
  if (/^as\s+/i.test(rest)) { take(/^as\s+/i); take(/^[a-z_][a-z_0-9]*/i); }
  if (rest.startsWith(';')) take(/^;/);
  if (rest) throw new Error('Extra SQL statement or expression is forbidden.');
  return { command: command as RefinementCommand, values };
}
