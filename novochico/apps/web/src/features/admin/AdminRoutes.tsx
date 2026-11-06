import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from '../../app/auth/AuthContext';
import { AppShell } from '../../app/layouts/AppShell';
import { ButtonLink } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { CategoriesPage } from './CategoriesPage';
import { ConversationDetailPage, ConversationsPage } from './ConversationsPage';
import { InstructionsPage } from './InstructionsPage';
import { OverviewPage } from './OverviewPage';
import { AuditPage, PromptPage, UsersPage } from './SystemPages';

/**
 * Telas da administração, carregadas à parte: servidores comuns nunca baixam este código. A tela
 * só deixa de abrir para quem não é administrador, para não disparar chamadas que a API recusaria;
 * quem garante o acesso é a API, em cada rota.
 */
export function AdminRoutes() {
  const { state } = useAuth();
  if (state.status !== 'authenticated' || state.me.role !== 'admin') {
    return (
      <AppShell>
        <EmptyState
          title="Esta área é só para administradores"
          description="Se você precisa de acesso, fale com a equipe de TI."
          action={<ButtonLink href="/">Voltar ao chat</ButtonLink>}
        />
      </AppShell>
    );
  }
  return (
    <Routes>
      <Route index element={<OverviewPage />} />
      <Route path="conversas" element={<ConversationsPage />} />
      <Route path="conversas/:id" element={<ConversationDetailPage />} />
      <Route path="instrucoes" element={<InstructionsPage />} />
      <Route path="categorias" element={<CategoriesPage />} />
      <Route path="prompt" element={<PromptPage />} />
      <Route path="usuarios" element={<UsersPage />} />
      <Route path="auditoria" element={<AuditPage />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
