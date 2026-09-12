import { useCallback, useEffect, useState } from 'react';

export type Async<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'failed'; error: string };

/**
 * Run an async read and expose its three real states.
 *
 * Three, not two: "loading" and "failed" must be distinguishable from "loaded
 * and empty", because an empty grid and a failed request look identical on
 * screen and only one of them is worth retrying.
 */
export function useAsync<T>(work: () => Promise<T>, deps: unknown[]): Async<T> & { reload: () => void } {
  const [state, setState] = useState<Async<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(work, deps);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    run().then(
      (value) => !cancelled && setState({ status: 'ready', value }),
      (error: unknown) =>
        !cancelled &&
        setState({
          status: 'failed',
          error: error instanceof Error ? error.message : 'Something went wrong.',
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [run, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
