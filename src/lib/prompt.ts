/**
 * A small interactive prompt layer, written rather than depended on.
 *
 * `npm create` downloads this package before it does anything else, so every
 * dependency here is weight and supply-chain surface in front of a developer's
 * first impression. Text, select, multi-select and confirm are a few hundred
 * lines; that is cheaper than the alternative.
 *
 * Everything degrades: without a TTY (CI, a pipe) the prompts refuse rather than
 * hang, and the caller is expected to have supplied flags.
 */
import readline from 'node:readline';
import { stdin, stdout } from 'node:process';

const ESC = '';

const isTTY = (): boolean => Boolean(stdin.isTTY && stdout.isTTY);

// Colour is opt-out via NO_COLOR, and off when piped, so logs stay readable.
const useColor = (): boolean => Boolean(stdout.isTTY) && !process.env['NO_COLOR'];
const wrap = (open: number, close: number) => (s: string) =>
  useColor() ? `${ESC}[${open}m${s}${ESC}[${close}m` : s;

export const c = {
  dim: wrap(2, 22),
  bold: wrap(1, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  cyan: wrap(36, 39),
  grey: wrap(90, 39),
};

/** True-colour swatch, so a palette choice is rendered as itself. */
export function swatch(hex: string, width = 2): string {
  if (!useColor()) return '';
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return ' '.repeat(width);
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `${ESC}[48;2;${r};${g};${b}m${' '.repeat(width)}${ESC}[49m`;
}

export class PromptCancelled extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'PromptCancelled';
  }
}

export class NotInteractive extends Error {
  constructor(what: string) {
    super(
      `Cannot ask for ${what}: this is not an interactive terminal.\n` +
        'Pass it as a flag instead, or run `1ecomm init --help` to see them all.',
    );
    this.name = 'NotInteractive';
  }
}

export const symbol = {
  step: c.cyan('*'),
  bar: c.grey('|'),
  ok: c.green('OK'),
};

export function intro(title: string): void {
  stdout.write(`\n${c.bold(title)}\n`);
}

export function note(line: string): void {
  stdout.write(`${symbol.bar}  ${c.grey(line)}\n`);
}

export function success(line: string): void {
  stdout.write(`${symbol.bar}  ${c.green('OK')} ${line}\n`);
}

export function warn(line: string): void {
  stdout.write(`${symbol.bar}  ${c.yellow('!')} ${line}\n`);
}

/** Free-text question, with optional validation that may run async. */
export async function text(opts: {
  message: string;
  placeholder?: string;
  initial?: string;
  validate?: (value: string) => string | undefined | Promise<string | undefined>;
}): Promise<string> {
  if (!isTTY()) throw new NotInteractive(opts.message);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      const hint = opts.placeholder ? c.grey(` (${opts.placeholder})`) : '';
      const answer = (
        await new Promise<string>((resolve, reject) => {
          rl.question(`${symbol.step}  ${c.bold(opts.message)}${hint}\n${symbol.bar}  `, resolve);
          rl.once('SIGINT', () => reject(new PromptCancelled()));
        })
      ).trim();

      const value = answer === '' && opts.initial !== undefined ? opts.initial : answer;
      const problem = await opts.validate?.(value);
      if (problem === undefined) return value;
      stdout.write(`${symbol.bar}  ${c.red(problem)}\n`);
    }
  } finally {
    rl.close();
  }
}

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
  /** Rendered as a true-colour block before the label. */
  color?: string;
  /** Present means unselectable; the text explains why. */
  disabled?: string;
}

function renderList<T>(
  message: string,
  choices: Choice<T>[],
  cursor: number,
  selected: Set<number> | undefined,
  firstDraw: boolean,
): void {
  if (!firstDraw) readline.moveCursor(stdout, 0, -(choices.length + 1));
  readline.cursorTo(stdout, 0);
  readline.clearScreenDown(stdout);
  stdout.write(`${symbol.step}  ${c.bold(message)}\n`);
  choices.forEach((choice, i) => {
    const active = i === cursor;
    const mark = selected
      ? selected.has(i)
        ? c.green('[x]')
        : c.grey('[ ]')
      : active
        ? c.cyan('>')
        : ' ';
    const block = choice.color ? `${swatch(choice.color)} ` : '';
    let label = choice.disabled ? c.grey(choice.label) : active ? c.cyan(choice.label) : choice.label;
    const hint = choice.disabled ?? choice.hint;
    if (hint) label += ` ${c.grey(hint)}`;
    stdout.write(`${symbol.bar}  ${mark} ${block}${label}\n`);
  });
}

function withRawKeys<T>(
  handler: (key: readline.Key, done: (value: T) => void, fail: (e: Error) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    readline.emitKeypressEvents(stdin);
    const wasRaw = stdin.isRaw ?? false;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    const cleanup = () => {
      stdin.off('keypress', onKey);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
    };
    const done = (value: T) => {
      cleanup();
      resolve(value);
    };
    const fail = (e: Error) => {
      cleanup();
      reject(e);
    };
    const onKey = (_s: string, key: readline.Key) => {
      if (key.ctrl && key.name === 'c') return fail(new PromptCancelled());
      handler(key, done, fail);
    };
    stdin.on('keypress', onKey);
  });
}

/** Single choice, arrow keys plus Enter. Disabled rows are skipped, not selectable. */
export async function select<T>(opts: {
  message: string;
  choices: Choice<T>[];
  initial?: number;
}): Promise<T> {
  if (!isTTY()) throw new NotInteractive(opts.message);
  const { choices } = opts;
  const selectable = choices.map((ch, i) => (ch.disabled ? -1 : i)).filter((i) => i >= 0);
  if (selectable.length === 0) throw new Error(`No selectable option for "${opts.message}".`);

  let cursor =
    opts.initial !== undefined && !choices[opts.initial]?.disabled ? opts.initial : selectable[0]!;
  renderList(opts.message, choices, cursor, undefined, true);

  const move = (delta: number) => {
    const at = selectable.indexOf(cursor);
    cursor = selectable[(at + delta + selectable.length) % selectable.length]!;
  };

  return withRawKeys<T>((key, done) => {
    if (key.name === 'up' || key.name === 'k') move(-1);
    else if (key.name === 'down' || key.name === 'j') move(1);
    else if (key.name === 'return') {
      stdout.write('\n');
      return done(choices[cursor]!.value);
    } else return;
    renderList(opts.message, choices, cursor, undefined, false);
  });
}

/** Multiple choice. Space toggles, Enter accepts, `a` toggles all. */
export async function multiselect<T>(opts: {
  message: string;
  choices: Choice<T>[];
  initial?: T[];
  /** Allow accepting an empty set. Off by default: an empty answer is usually a slip. */
  allowEmpty?: boolean;
}): Promise<T[]> {
  if (!isTTY()) throw new NotInteractive(opts.message);
  const { choices } = opts;
  const selectable = choices.map((ch, i) => (ch.disabled ? -1 : i)).filter((i) => i >= 0);
  const selected = new Set<number>(
    choices
      .map((ch, i) => (!ch.disabled && opts.initial?.includes(ch.value) ? i : -1))
      .filter((i) => i >= 0),
  );
  let cursor = selectable[0] ?? 0;
  renderList(opts.message, choices, cursor, selected, true);

  const move = (delta: number) => {
    const at = selectable.indexOf(cursor);
    cursor = selectable[(at + delta + selectable.length) % selectable.length]!;
  };

  return withRawKeys<T[]>((key, done) => {
    if (key.name === 'up' || key.name === 'k') move(-1);
    else if (key.name === 'down' || key.name === 'j') move(1);
    else if (key.name === 'space') {
      if (selected.has(cursor)) selected.delete(cursor);
      else selected.add(cursor);
    } else if (key.name === 'a') {
      if (selected.size === selectable.length) selected.clear();
      else selectable.forEach((i) => selected.add(i));
    } else if (key.name === 'return') {
      if (selected.size === 0 && !opts.allowEmpty) {
        renderList(opts.message, choices, cursor, selected, false);
        stdout.write(`${symbol.bar}  ${c.red('Choose at least one, or press a to select all.')}\n`);
        readline.moveCursor(stdout, 0, -1);
        return;
      }
      stdout.write('\n');
      return done(
        [...selected]
          .sort((a, b) => a - b)
          .map((i) => choices[i]!.value),
      );
    } else return;
    renderList(opts.message, choices, cursor, selected, false);
  });
}

export async function confirm(opts: { message: string; initial?: boolean }): Promise<boolean> {
  const yes = opts.initial ?? true;
  return select<boolean>({
    message: opts.message,
    choices: [
      { value: true, label: 'Yes' },
      { value: false, label: 'No' },
    ],
    initial: yes ? 0 : 1,
  });
}

/** Run work behind a spinner that collapses to nothing when it finishes. */
export async function spin<T>(message: string, work: () => Promise<T>): Promise<T> {
  if (!stdout.isTTY) {
    stdout.write(`${symbol.bar}  ${message}\n`);
    return work();
  }
  const frames = ['-', '\\', '|', '/'];
  let i = 0;
  stdout.write(`${symbol.bar}  ${frames[0]} ${message}`);
  const timer = setInterval(() => {
    readline.cursorTo(stdout, 0);
    readline.clearLine(stdout, 0);
    stdout.write(`${symbol.bar}  ${c.cyan(frames[++i % frames.length]!)} ${message}`);
  }, 90);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    readline.cursorTo(stdout, 0);
    readline.clearLine(stdout, 0);
  }
}
