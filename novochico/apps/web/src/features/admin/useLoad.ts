import { useEffect, useRef, useState } from 'react';

export type LoadState<T> =
  { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T };

/**
 * Carrega dados ao abrir a tela e quando `key` muda. `reload` busca de novo sem trocar a chave.
 * O resultado de uma chave antiga nunca aparece: enquanto a nova carrega, o estado é `loading`.
 */
export function useLoad<T>(loader: () => Promise<T>, key: string) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ id: string; value: LoadState<T> } | null>(null);
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  const id = `${key}#${attempt}`;
  useEffect(() => {
    let cancelled = false;
    loaderRef
      .current()
      .then((data) => {
        if (!cancelled) setResult({ id, value: { status: 'ready', data } });
      })
      .catch((error: unknown) => {
        if (!cancelled) setResult({ id, value: { status: 'error', error } });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const state: LoadState<T> = result?.id === id ? result.value : { status: 'loading' };
  return { state, reload: () => setAttempt((value) => value + 1) };
}
