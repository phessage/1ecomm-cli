import { ref, watchEffect, type Ref } from 'vue';

export interface AsyncState<T> {
  status: Ref<'loading' | 'ready' | 'failed'>;
  value: Ref<T | null>;
  error: Ref<string>;
  reload: () => void;
}

/**
 * Run an async read and expose its three real states.
 *
 * Three, not two: "loading" and "failed" must be distinguishable from "loaded
 * and empty", because an empty grid and a failed request look identical on
 * screen and only one of them is worth retrying.
 */
export function useAsync<T>(work: () => Promise<T>): AsyncState<T> {
  const status = ref<'loading' | 'ready' | 'failed'>('loading');
  const value = ref<T | null>(null) as Ref<T | null>;
  const error = ref('');
  const nonce = ref(0);

  watchEffect(async (onCleanup) => {
    void nonce.value;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    status.value = 'loading';
    try {
      const result = await work();
      if (cancelled) return;
      value.value = result;
      status.value = 'ready';
    } catch (cause) {
      if (cancelled) return;
      error.value = cause instanceof Error ? cause.message : 'Something went wrong.';
      status.value = 'failed';
    }
  });

  return { status, value, error, reload: () => (nonce.value += 1) };
}
