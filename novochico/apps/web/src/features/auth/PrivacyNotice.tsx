import { useState } from 'react';
import { useAuth } from '../../app/auth/AuthContext';

/**
 * Aviso de privacidade, bloqueante: enquanto não for aceito, o resto do sistema não aparece.
 * O aceite é gravado no servidor, que também recusa o chat sem ele. O texto vem do sistema
 * anterior. Estrutura provisória da F2: o diálogo acessível definitivo vem com o design system.
 */
export function PrivacyNotice() {
  const { acceptPrivacyNotice } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function accept() {
    setBusy(true);
    setFailed(false);
    try {
      await acceptPrivacyNotice();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="privacy-title">
      <h1 id="privacy-title">Aviso de Privacidade e Segurança</h1>
      <p>Ao utilizar este assistente, você concorda que:</p>
      <p>
        <strong>Não digite dados sensíveis.</strong> É estritamente proibido informar senhas, dados
        de cidadãos, números de processos sigilosos ou outras informações sensíveis no chat. Forneça
        apenas as informações solicitadas.
      </p>

      {failed && <p role="alert">Não foi possível registrar o aceite. Tente novamente.</p>}

      <button type="button" onClick={() => void accept()} disabled={busy} autoFocus>
        Li e concordo
      </button>
    </div>
  );
}
