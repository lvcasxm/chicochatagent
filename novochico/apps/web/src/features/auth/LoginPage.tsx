import { Navigate, useSearchParams } from 'react-router';
import { isLoginErrorCode } from '@chicochat/shared';
import { googleLoginUrl } from '../../lib/api';
import { useAuth } from '../../app/auth/AuthContext';
import { LOGIN_ERROR_MESSAGES } from './login-messages';

/**
 * Tela de login. Estrutura provisória da F2: o visual definitivo vem com o design system (F3).
 * O motivo de uma falha chega em `?error=<código>`; códigos desconhecidos são ignorados, e
 * nenhum texto da URL é exibido, só mensagens fixas.
 */
export function LoginPage() {
  const { state } = useAuth();
  const [params] = useSearchParams();

  if (state.status === 'authenticated') return <Navigate to="/" replace />;

  const errorCode = params.get('error');
  const message = isLoginErrorCode(errorCode) ? LOGIN_ERROR_MESSAGES[errorCode] : null;
  // O destino é só uma sugestão: o servidor revalida e ignora o que não for um caminho interno.
  const redirectTo = params.get('redirect') ?? '/';

  return (
    <main>
      <h1>ChicoChat+</h1>
      <p>Atendimento de TI da Prefeitura Municipal de Pedro Leopoldo.</p>

      {message && <p role="alert">{message}</p>}

      <a href={googleLoginUrl(redirectTo)}>Entrar com a conta Google institucional</a>
    </main>
  );
}
