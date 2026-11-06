import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getSessionId } from "@/lib/session";

export type Conversa = {
  id: string;
  titulo: string | null;
  org_slug: string | null;
  created_at: string;
  updated_at: string;
};

export type Mensagem = {
  id: string;
  conversa_id: string;
  role: "user" | "assistant";
  conteudo: string;
  created_at: string;
};

export function useConversations(slug: string | undefined) {
  const { user } = useAuth();
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [activeConversaId, setActiveConversaId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch conversations list
  const fetchConversas = useCallback(async () => {
    if (!user || !slug) return;
    const { data } = await supabase
      .from("conversas")
      .select("*")
      .eq("user_id", user.id)
      .eq("org_slug", slug)
      .order("updated_at", { ascending: false });
    if (data) setConversas(data as Conversa[]);
  }, [user, slug]);

  useEffect(() => {
    fetchConversas();
  }, [fetchConversas]);

  // Realtime subscription for conversas
  useEffect(() => {
    if (!user || !slug) return;
    const channel = supabase
      .channel(`conversas-${slug}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversas" },
        () => fetchConversas()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, slug, fetchConversas]);

  // Load messages when active conversa changes
  const loadMessages = useCallback(async (conversaId: string) => {
    setActiveConversaId(conversaId);
    setLoading(true);
    const { data } = await supabase
      .from("mensagens")
      .select("*")
      .eq("conversa_id", conversaId)
      .order("created_at", { ascending: true });
    if (data) setMensagens(data as Mensagem[]);
    setLoading(false);
  }, []);

  // Create new conversation
  const createConversa = useCallback(async (firstMessage: string, customTitle?: string): Promise<string | null> => {
    if (!user || !slug) return null;
    const titulo = (customTitle ?? firstMessage).slice(0, 80);
    const session_id = getSessionId();
    const { data, error } = await supabase
      .from("conversas")
      .insert({ titulo, user_id: user.id, org_slug: slug, session_id } as any)
      .select("id")
      .single();
    if (error || !data) return null;
    const id = (data as any).id as string;
    setActiveConversaId(id);
    setConversas((prev) => [{ id, titulo, org_slug: slug, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...prev]);
    return id;
  }, [user, slug]);

  // Update conversation title (used to refine placeholder titles into smart summaries)
  const updateConversaTitulo = useCallback(async (conversaId: string, titulo: string) => {
    const clean = titulo.slice(0, 80);
    setConversas((prev) => prev.map((c) => (c.id === conversaId ? { ...c, titulo: clean } : c)));
    await supabase.from("conversas").update({ titulo: clean }).eq("id", conversaId);
  }, []);

  // Add message to conversation
  const addMensagem = useCallback(async (conversaId: string, role: "user" | "assistant", conteudo: string) => {
    const { data } = await supabase
      .from("mensagens")
      .insert({ conversa_id: conversaId, role, conteudo })
      .select()
      .single();
    if (data) {
      setMensagens((prev) => [...prev, data as Mensagem]);
    }
    // Touch updated_at
    await supabase
      .from("conversas")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversaId);
  }, []);

  // Delete conversation
  const deleteConversa = useCallback(async (conversaId: string) => {
    await supabase.from("conversas").delete().eq("id", conversaId);
    setConversas((prev) => prev.filter((c) => c.id !== conversaId));
    if (activeConversaId === conversaId) {
      setActiveConversaId(null);
      setMensagens([]);
    }
  }, [activeConversaId]);

  // Start new conversation (clear active)
  const newConversa = useCallback(() => {
    setActiveConversaId(null);
    setMensagens([]);
  }, []);

  return {
    conversas,
    activeConversaId,
    mensagens,
    loading,
    loadMessages,
    createConversa,
    updateConversaTitulo,
    addMensagem,
    deleteConversa,
    newConversa,
    setMensagens,
  };
}
