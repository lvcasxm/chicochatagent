import { ArrowRight } from 'lucide-react';
import { Navigate, useSearchParams } from 'react-router';
import { isLoginErrorCode } from '@chicochat/shared';
import { googleLoginUrl } from '../../lib/api';
import { useAuth } from '../../app/auth/AuthContext';
import { AppShell } from '../../app/layouts/AppShell';
import { ButtonLink } from '../../components/Button';
import { Notice } from '../../components/Notice';
import { LOGIN_ERROR_MESSAGES } from './login-messages';

/**
 * Tela de login. O motivo de uma falha chega em `?error=<código>`; códigos desconhecidos são
 * ignorados, e nenhum texto da URL é exibido, só mensagens fixas.
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
    <AppShell>
      <div className="flex max-w-reading flex-col items-start gap-8">
        <div className="flex flex-col gap-4">
          <h1 className="type-title-1">Atendimento de TI</h1>
          <p className="type-lead text-fg-muted">
            Para servidores da Prefeitura Municipal de Pedro Leopoldo. Entre com a sua conta
            institucional do Google.
          </p>
        </div>

        {message && <Notice tone="danger">{message}</Notice>}

        <ButtonLink
          href={googleLoginUrl(redirectTo)}
          iconEnd={<ArrowRight className="size-5" />}
          className="w-full sm:w-auto"
        >
          Entrar com a conta Google institucional
        </ButtonLink>
      </div>
    </AppShell>
  );
}
