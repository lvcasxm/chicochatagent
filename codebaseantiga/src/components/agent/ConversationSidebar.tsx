import { useState } from "react";
import { Plus, Trash2, MessageSquare, X, Menu, LogOut } from "lucide-react";
import type { Conversa } from "@/hooks/useConversations";
import { useAuth } from "@/contexts/AuthContext";
import AgentAuthPanel from "./AgentAuthPanel";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days}d`;
  return new Date(dateStr).toLocaleDateString("pt-BR");
}

type Props = {
  conversas: Conversa[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  isDark: boolean;
};

export default function ConversationSidebar({ conversas, activeId, onSelect, onNew, onDelete, isOpen, onToggle, isDark }: Props) {
  const { user, signOut, isAdmin } = useAuth();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  return (
    <>
      {/* Mobile toggle button */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="fixed top-3 left-3 z-50 w-9 h-9 rounded-lg flex items-center justify-center sm:hidden transition-colors"
          style={{ background: 'hsl(var(--bot-card))', border: '1px solid hsl(var(--bot-border))', color: 'hsl(var(--bot-fg))' }}
          aria-label="Abrir histórico"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Overlay for mobile */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 sm:hidden" onClick={onToggle} />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed sm:relative z-50 sm:z-auto top-0 left-0 h-full
          w-72 flex flex-col transition-transform duration-200
          ${isOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0 sm:w-0 sm:overflow-hidden"}
        `}
        style={{ background: 'hsl(var(--bot-card))', borderRight: '1px solid hsl(var(--bot-border))' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-3 border-b" style={{ borderColor: 'hsl(var(--bot-border))' }}>
          <span className="text-sm font-semibold" style={{ color: 'hsl(var(--bot-fg))' }}>Conversas</span>
          <div className="flex items-center gap-1">
            <button
              onClick={onNew}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
              style={{ background: 'hsl(var(--bot-primary))', color: 'hsl(var(--bot-primary-fg))' }}
              title="Nova conversa"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={onToggle}
              className="w-8 h-8 rounded-lg flex items-center justify-center sm:hidden"
              style={{ color: 'hsl(var(--bot-muted-fg))' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        {user ? (
          <>
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              {conversas.length === 0 && (
                <p className="text-xs text-center py-6" style={{ color: 'hsl(var(--bot-muted-fg))' }}>
                  Nenhuma conversa ainda.
                </p>
              )}
              {conversas.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                    activeId === c.id ? "" : "hover:opacity-80"
                  }`}
                  style={{
                    background: activeId === c.id ? 'hsl(var(--bot-muted))' : 'transparent',
                    color: 'hsl(var(--bot-fg))',
                  }}
                  onClick={() => onSelect(c.id)}
                >
                  <MessageSquare className="w-4 h-4 flex-shrink-0" style={{ color: 'hsl(var(--bot-muted-fg))' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{c.titulo || "Nova conversa"}</p>
                    <p className="text-[11px]" style={{ color: 'hsl(var(--bot-muted-fg))' }}>{timeAgo(c.updated_at)}</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(c.id); }}
                    className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-80"
                    style={{ color: 'hsl(0 72% 51%)' }}
                    title="Excluir"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* User info + logout */}
            <div className="px-3 py-3 border-t" style={{ borderColor: 'hsl(var(--bot-border))' }}>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate" style={{ color: 'hsl(var(--bot-fg))' }}>
                    {user.user_metadata?.full_name || user.email}
                  </p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => window.location.href = "/admin"}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
                    style={{ color: 'hsl(var(--bot-muted-fg))' }}
                    title="Painel de Parametrização"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  </button>
                )}
                <button
                  onClick={() => signOut()}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
                  style={{ color: 'hsl(var(--bot-muted-fg))' }}
                  title="Sair"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto flex flex-col">
            {/* New chat for guests */}
            <div className="px-2 pt-2">
              <button
                onClick={() => { onNew(); onToggle(); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
                style={{ background: 'hsl(var(--bot-muted))', color: 'hsl(var(--bot-fg))' }}
              >
                <Plus className="w-4 h-4 flex-shrink-0" />
                Nova conversa
              </button>
            </div>

            {showAuth ? (
              <AgentAuthPanel isDark={isDark} onClose={() => setShowAuth(false)} />
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 px-4">
                <p className="text-sm text-center mb-4" style={{ color: 'hsl(var(--bot-muted-fg))' }}>
                  Faça login para salvar suas conversas e acessar o histórico.
                </p>
                <button
                  onClick={() => setShowAuth(true)}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-90"
                  style={{ background: 'hsl(var(--bot-primary))', color: 'hsl(var(--bot-primary-fg))' }}
                >
                  Entrar / Criar conta
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Delete confirmation dialog */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setConfirmDeleteId(null)}>
          <div
            className="rounded-xl p-5 w-80 shadow-xl"
            style={{ background: 'hsl(var(--bot-card))', color: 'hsl(var(--bot-fg))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium mb-1">Excluir conversa?</p>
            <p className="text-xs mb-4" style={{ color: 'hsl(var(--bot-muted-fg))' }}>Esta ação não pode ser desfeita.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm rounded-lg"
                style={{ border: '1px solid hsl(var(--bot-border))' }}
              >
                Cancelar
              </button>
              <button
                onClick={() => { onDelete(confirmDeleteId); setConfirmDeleteId(null); }}
                className="px-4 py-2 text-sm rounded-lg text-white"
                style={{ background: 'hsl(0 72% 51%)' }}
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
