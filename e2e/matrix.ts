/**
 * What the end-to-end suite covers, and why each axis is in it.
 *
 * Every entry here becomes a REAL project: scaffolded by the CLI, installed from
 * the registry, built, served, and driven by a browser against the live
 * platform. That is expensive, so the matrix is chosen rather than exhaustive —
 * each entry has to answer a question no other entry answers.
 */
import type { Framework } from '../src/lib/scaffold.js';

export interface MatrixEntry {
  /** Directory name, Playwright project name, and the key everything is filed under. */
  readonly id: string;
  readonly framework: Framework;
  readonly palette: string;
  readonly appearance: 'light' | 'dark' | 'system';
  /** Why this entry exists. Printed when it fails, so a red run explains itself. */
  readonly covers: string;
}

/**
 * The store the suite runs against.
 *
 * Overridable because a store's capabilities and catalog change, and a suite
 * pinned to one store ID becomes a suite that tests whatever that store happens
 * to be today. `E2E_STORE_ID` lets CI point at a leased fixture instead.
 */
export const STORE_ID =
  process.env['E2E_STORE_ID'] ?? '01f5b02f-d7c0-42cd-b880-59f78ea70aa3';

export const BOOTSTRAP_URL = process.env['E2E_BOOTSTRAP_URL'] ?? 'https://api.1ecomm.com';

export const MATRIX: readonly MatrixEntry[] = [
  {
    id: 'react-indigo-light',
    framework: 'react',
    palette: 'indigo',
    appearance: 'light',
    covers: 'the default framework, the default palette, and the whole shopper journey',
  },
  {
    id: 'react-ember-dark',
    framework: 'react',
    palette: 'ember',
    appearance: 'dark',
    covers: 'a second palette and dark mode, proving theming is an attribute rather than a build',
  },
  {
    id: 'react-jade-light',
    framework: 'react',
    palette: 'jade',
    appearance: 'light',
    covers: 'the same palette as the Vue entry, isolating a contrast failure to the palette or the framework',
  },
  {
    id: 'vue-jade-system',
    framework: 'vue',
    palette: 'jade',
    appearance: 'system',
    covers: 'the same journey in a different framework, driven by the same spec through the same testids',
  },
];

/** Entries for one framework, so a spec can say "run this everywhere". */
export function entriesFor(framework: Framework): readonly MatrixEntry[] {
  return MATRIX.filter((entry) => entry.framework === framework);
}
