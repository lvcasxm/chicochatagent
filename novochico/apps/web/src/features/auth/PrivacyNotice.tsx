import { useState } from 'react';
import { useAuth } from '../../app/auth/AuthContext';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Notice } from '../../components/Notice';

/**
 * Aviso de privacidade, bloqueante: enquanto não for aceito, o resto do sistema não aparece.
 * O aceite é gravado no servidor, que também recusa o chat sem ele. O texto vem do sistema
 * anterior. O diálogo não fecha por Esc nem por clique fora: só pelo aceite.
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
    <Dialog
      open
      dismissible={false}
      title="Aviso de Privacidade e Segurança"
      description={
        <>
          <p>Ao utilizar este assistente, você concorda que:</p>
          <p>
            <strong>Não digite dados sensíveis.</strong> É estritamente proibido informar senhas,
            dados de cidadãos, números de processos sigilosos ou outras informações sensíveis no
            chat. Forneça apenas as informações solicitadas.
          </p>
        </>
      }
      footer={
        <Button onClick={() => void accept()} disabled={busy}>
          Li e concordo
        </Button>
      }
    >
      {failed && (
        <Notice tone="danger">Não foi possível registrar o aceite. Tente novamente.</Notice>
      )}
    </Dialog>
  );
}
