import { cleanup } from './global-setup.js';

export default async function globalTeardown(): Promise<void> {
  await cleanup();
}
