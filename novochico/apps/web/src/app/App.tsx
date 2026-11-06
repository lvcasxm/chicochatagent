import { useEffect, useState } from 'react';
import type { HealthResponse } from '@chicochat/shared';
import { fetchHealth } from '../lib/api';

type State = { kind: 'loading' } | { kind: 'ready'; health: HealthResponse } | { kind: 'error' };

function describe(state: State): string {
  switch (state.kind) {
    case 'loading':
      return 'Verificando o sistema…';
    case 'error':
      return 'Não foi possível consultar o sistema.';
    case 'ready':
      return state.health.status === 'ok'
        ? 'Sistema em funcionamento.'
        : 'Banco de dados indisponível.';
  }
}

/** Página provisória da F0: confirma que web e API conversam. A interface real vem na F3/F4. */
export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal).then(
      (health) => setState({ kind: 'ready', health }),
      (error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ kind: 'error' });
      },
    );
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>ChicoChat+</h1>
      <p role="status">{describe(state)}</p>
    </main>
  );
}
