import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { streamAgentChat, getAgentInfo, submitGlpiTicket, type Msg } from "@/lib/agent-chat";
import { suggestCategory } from "@/lib/category-suggester";
import { getCategoryMessage } from "@/lib/category-messages";
import { titleForFirstMessage, smartConversationTitle, isPlaceholderTitle } from "@/lib/conversation-title";
import { Send, Loader2, Sun, Moon, ExternalLink, Globe, Lock, Monitor, Printer, Settings, LayoutGrid, Mail, ShieldCheck, FileText, MoreHorizontal, KeyRound, Download, ClipboardList, Ticket } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import logoIconBlue from "@/assets/logo-icon-blue.png";
import logoIconWhite from "@/assets/logo-icon-white.png";
import logoVerticalLight from "@/assets/logo-vertical-light.png";
import logoVerticalDark from "@/assets/logo-vertical-dark.png";
import plDigitalBlack from "@/assets/pl-digital-black.png";
import plDigitalWhite from "@/assets/pl-digital-white.png";
import { useAuth } from "@/contexts/AuthContext";
import { useConversations } from "@/hooks/useConversations";
import ConversationSidebar from "@/components/agent/ConversationSidebar";
import TicketDataForm, { type TicketFormData } from "@/components/agent/TicketDataForm";
import FeedbackForm from "@/components/agent/FeedbackForm";
import PrivacyNoticeDialog from "@/components/agent/PrivacyNoticeDialog";
import DuplicateTicketDialog, {
  type DuplicateCandidate,
  type CollectiveIncident,
} from "@/components/agent/DuplicateTicketDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trackEvent } from "@/lib/analytics-events";
import { supabase } from "@/integrations/supabase/client";

const GLPI_DIRECT_URL = "https://suporte.pedroleopoldo.mg.gov.br/";
const OPEN_TICKET_FORM_TOKEN = "<<OPEN_TICKET_FORM>>";
const RESOLUTION_ATTEMPT_TOKEN = "<<RESOLUTION_ATTEMPT>>";
const RESOLVIDO_REGEX = /(resolveu|resolvido|funcionou|deu certo|solucionado|ok agora|agora foi|já está funcionando)/i;
const NAO_RESOLVIDO_REGEX = /(nao resolveu|não resolveu|nao funcionou|não funcionou|continua|persiste|ainda com problema|ainda com erro|segue com problema)/i;

const markdownComponents = {
  a: ({ node, ...props }: any) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:opacity-80 break-words"
      style={{ color: "hsl(var(--bot-primary))" }}
    />
  ),
  ul: ({ node, ...props }: any) => (
    <ul {...props} className="list-disc pl-5 my-2 space-y-1 marker:text-current" />
  ),
  ol: ({ node, ...props }: any) => (
    <ol {...props} className="list-decimal pl-5 my-2 space-y-1 marker:text-current" />
  ),
  li: ({ node, ...props }: any) => (
    <li {...props} className="leading-relaxed" />
  ),
  p: ({ node, ...props }: any) => (
    <p {...props} className="my-2 first:mt-0 last:mb-0 leading-relaxed" />
  ),
  strong: ({ node, ...props }: any) => (
    <strong {...props} className="font-semibold" />
  ),
  h3: ({ node, ...props }: any) => (
    <h3 {...props} className="text-base font-semibold mt-3 mb-1" />
  ),
  details: ({ node, ...props }: any) => (
    <details
      {...props}
      className="my-2 rounded-lg border px-3 py-2 [&[open]>summary]:mb-2"
      style={{ borderColor: "hsl(var(--bot-border))", background: "hsl(var(--bot-card))" }}
    />
  ),
  summary: ({ node, ...props }: any) => (
    <summary
      {...props}
      className="cursor-pointer text-sm font-medium select-none list-none flex items-center gap-1.5 hover:opacity-80"
      style={{ color: "hsl(var(--bot-primary))" }}
    />
  ),
};

const AgentChat = () => {
  const { slug: slugParam } = useParams<{ slug: string }>();
  const slug = slugParam ?? "chicobot";
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [streamingMessage, setStreamingMessage] = useState<string | null>(null);

  // Guard: Bloqueio total se não estiver logado
  useEffect(() => {
    if (!authLoading && !user) {
      navigate(`/auth?redirect=/agent/${slug}`);
    }
  }, [user, authLoading, slug, navigate]);

  // Privacy notice gating: must accept before using the chat
  const PRIVACY_KEY_PREFIX = "chicochat-privacy-ack:";
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    try {
      const ack = localStorage.getItem(PRIVACY_KEY_PREFIX + user.id);
      setPrivacyAccepted(!!ack);
    } catch {
      setPrivacyAccepted(false);
    }
  }, [user?.id]);
  const handleAcceptPrivacy = () => {
    if (user?.id) {
      try {
        localStorage.setItem(PRIVACY_KEY_PREFIX + user.id, new Date().toISOString());
      } catch { /* ignore */ }
    }
    setPrivacyAccepted(true);
  };

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("chicochat-theme");
      if (saved) return saved === "dark";
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });

  const {
    conversas,
    activeConversaId,
    mensagens,
    loadMessages,
    createConversa,
    updateConversaTitulo,
    addMensagem,
    deleteConversa,
    newConversa,
  } = useConversations(slug);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("chicochat-theme", isDark ? "dark" : "light");
  }, [isDark]);

  const logo = isDark ? logoIconWhite : logoIconBlue;
  const verticalLogo = isDark ? logoVerticalLight : logoVerticalDark;
  const plLogo = isDark ? plDigitalWhite : plDigitalBlack;

  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);
  const [lastTicketId, setLastTicketId] = useState<string | number | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [ticketFormOpen, setTicketFormOpen] = useState(false);
  const [resolutionAttempts, setResolutionAttempts] = useState(0);
  const [issuePersists, setIssuePersists] = useState<boolean | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [serviceMode, setServiceMode] = useState<"normal" | "fallback" | "queue-timeout" | "down" | string>("normal");
  const resolutionAttemptsRef = useRef(0);
  const issuePersistsRef = useRef<boolean | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  // Feedback state
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackContext, setFeedbackContext] = useState<{ conversaId: string | null; ticketId: string | number | null }>({ conversaId: null, ticketId: null });
  const feedbackShownConvosRef = useRef<Set<string>>(new Set());

  // Duplicate-check state
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidate[]>([]);
  const [collectiveIncident, setCollectiveIncident] = useState<CollectiveIncident | null>(null);
  const pendingTicketRef = useRef<TicketFormData | null>(null);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);

  useEffect(() => { resolutionAttemptsRef.current = resolutionAttempts; }, [resolutionAttempts]);
  useEffect(() => { issuePersistsRef.current = issuePersists; }, [issuePersists]);

  const { data: agentInfo, isLoading: infoLoading, isFetching: infoFetching, refetch: refetchAgentInfo } = useQuery({
    queryKey: ["agent-info", slug],
    queryFn: () => getAgentInfo(slug!),
    enabled: !!slug,
    // Se falhar (servidor acordando), tenta de novo sozinho a cada 10s.
    refetchInterval: (query) => (query.state.data?.org ? false : 10000),
  });

  const greetingMsg: Msg = {
    role: "assistant",
    content: `Olá! Sou o **ChicoChat+**. 😊\n\n${agentInfo?.org?.description ? agentInfo.org.description + "\n\n" : ""}Como posso te ajudar?`,
  };

  // Derive all messages to display
  const displayMessages = [
    greetingMsg,
    ...mensagens.map((m) => ({ role: m.role as "user" | "assistant", content: m.conteudo })),
    ...(streamingMessage ? [{ role: "assistant" as const, content: streamingMessage }] : []),
  ];

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [displayMessages, scrollToBottom]);

  // Auto-focus input after bot finishes responding
  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus();
    }
  }, [isLoading]);

  const handleSelectConversa = (id: string) => {
    if (activeConversaId && activeConversaId !== id) {
      trackEvent({ event_type: "conversation_finished", user_id: user?.id, conversa_id: activeConversaId, org_slug: slug });
    }
    loadMessages(id);
    setTicketFormOpen(false);
    setLastTicketId(null);
    setResolutionAttempts(0);
    setIssuePersists(null);
    setSidebarOpen(false);
  };

  const handleNewConversa = () => {
    if (activeConversaId) {
      trackEvent({ event_type: "conversation_finished", user_id: user?.id, conversa_id: activeConversaId, org_slug: slug, metadata: { reason: "new_conversation" } });
    }
    newConversa();
    setStreamingMessage(null);
    setTicketFormOpen(false);
    setLastTicketId(null);
    setResolutionAttempts(0);
    setIssuePersists(null);
    setSelectedCategory(null);
    setSidebarOpen(false);
  };

  const handleConsultarChamados = async () => {
    if (isLoading) return;
    if (!user?.email) { toast.error("E-mail do usuário não disponível."); return; }
    if (!privacyAccepted) { toast.error("Você precisa aceitar o aviso de privacidade para continuar."); return; }

    const userMsg = "Consultar meus chamados no GLPI";
    setIsLoading(true);
    setSelectedCategory("Consultar Chamados");

    let conversaId = activeConversaId;
    const wasNew = !conversaId;
    if (user && !conversaId) {
      conversaId = await createConversa(userMsg, "Consulta de chamados");
      if (conversaId) {
        trackEvent({ event_type: "conversation_started", user_id: user.id, conversa_id: conversaId, org_slug: slug, category: "Consultar Chamados" });
      }
    }
    if (user && conversaId) {
      await addMensagem(conversaId, "user", userMsg);
    }

    try {
      const { data, error } = await supabase.functions.invoke("glpi-tickets", {
        body: { email: user.email },
      });

      let assistantMsg = "";
      if (error || !data) {
        assistantMsg = "⚠️ Não consegui acessar o sistema de chamados no momento. A conexão com o GLPI parece estar indisponível. Tente novamente em instantes.";
      } else if (!data.success) {
        if (data.code === "USER_NOT_FOUND") {
          assistantMsg = `❌ Não localizei um cadastro vinculado ao seu e-mail institucional (**${user.email}**) na base do GLPI.\n\nPor favor, entre em contato com o suporte de TI para verificar seu cadastro.`;
        } else {
          assistantMsg = "⚠️ Não consegui acessar o sistema de chamados no momento. Tente novamente em instantes.";
        }
      } else {
        assistantMsg = data.markdown || "Você não possui chamados registrados no momento. Quer abrir um agora?";
      }

      if (user && conversaId) {
        await addMensagem(conversaId, "assistant", assistantMsg);
      }
    } catch (e) {
      console.error("[consultar-chamados] erro:", e);
      if (user && conversaId) {
        await addMensagem(conversaId, "assistant", "⚠️ Não consegui acessar o sistema de chamados no momento. Tente novamente em instantes.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading || !slug) return;
    if (inflightRef.current) return; // dedupe: ignora clique duplo
    if (!privacyAccepted) {
      toast.error("Você precisa aceitar o aviso de privacidade para continuar.");
      return;
    }
    const normalizedInput = text.trim();

    // Atalho admin: "sou admin, chamado de teste" abre formulário direto em modo teste
    const TEST_SHORTCUT_REGEX = /^sou\s+admin[,.\s]+chamado\s+de\s+teste/i;
    if (isAdmin && TEST_SHORTCUT_REGEX.test(normalizedInput)) {
      setInput("");
      let conversaId = activeConversaId;
      if (user && !conversaId) {
        conversaId = await createConversa(normalizedInput, "Chamado de teste");
      }
      if (user && conversaId) {
        await addMensagem(conversaId, "user", normalizedInput);
        await addMensagem(
          conversaId,
          "assistant",
          "🧪 **Modo de teste detectado.** Abrindo formulário para registrar um chamado de teste no GLPI."
        );
      }
      setSelectedCategory("Teste");
      setTestMode(true);
      setTicketFormOpen(true);
      setLastTicketId(null);
      return;
    }

    if (NAO_RESOLVIDO_REGEX.test(normalizedInput)) {
      setIssuePersists(true);
    } else if (RESOLVIDO_REGEX.test(normalizedInput)) {
      setIssuePersists(false);
      setTicketFormOpen(false);
      // Trigger feedback once per conversation when user signals resolution
      const convKey = activeConversaId || "anon";
      if (!feedbackShownConvosRef.current.has(convKey)) {
        feedbackShownConvosRef.current.add(convKey);
        setFeedbackContext({ conversaId: activeConversaId ?? null, ticketId: null });
        setFeedbackOpen(true);
      }
      trackEvent({
        event_type: "resolved_without_ticket",
        user_id: user?.id,
        conversa_id: activeConversaId,
        org_slug: slug,
        category: selectedCategory,
      });
    }

    setInput("");
    setIsLoading(true);
    setStreamingMessage(null);

    let conversaId = activeConversaId;
    const wasNewConversa = !conversaId;

    if (user && !conversaId) {
      const initialTitle = titleForFirstMessage(normalizedInput, selectedCategory);
      conversaId = await createConversa(normalizedInput, initialTitle);
      if (conversaId) {
        trackEvent({
          event_type: "conversation_started",
          user_id: user.id,
          conversa_id: conversaId,
          org_slug: slug,
          category: selectedCategory,
        });
        if (selectedCategory) {
          trackEvent({
            event_type: "category_detected",
            user_id: user.id,
            conversa_id: conversaId,
            org_slug: slug,
            category: selectedCategory,
            metadata: { source: "user_pick" },
          });
        }
      }
    } else if (user && conversaId) {
      // Refina título placeholder (rótulo de categoria) quando o usuário descreve o problema real
      const current = conversas.find((c) => c.id === conversaId);
      if (current && isPlaceholderTitle(current.titulo) && !isPlaceholderTitle(normalizedInput)) {
        const smart = smartConversationTitle(normalizedInput);
        if (smart && smart !== current.titulo) {
          updateConversaTitulo(conversaId, smart);
        }
      }
    }

    // Capture current history for AI context BEFORE the new message is fully integrated by the re-render
    const history = mensagens.map((m) => ({ role: m.role as "user" | "assistant", content: m.conteudo }));

    if (user && conversaId) {
      // addMensagem updates hook state, but we already captured history for the AI turn
      await addMensagem(conversaId, "user", normalizedInput);
    }

    let assistantSoFar = "";
    const aiUserMsg: Msg = { role: "user", content: normalizedInput };

    // Context is history + current clean user message
    const contextMessages = [...history, aiUserMsg].slice(-20);

    const stripInternalTokens = (text: string) =>
      text
        .replace(/`?<<?\s*OPEN_TICKET_FORM\s*>?>?`?/gi, "")
        .replace(/`?<<?\s*RESOLUTION_ATTEMPT\s*>?>?`?/gi, "")
        .replace(/^[ \t>*_-]*RESOLUTION_ATTEMPT[ \t>*_-]*$/gim, "")
        .replace(/^[ \t>*_-]*OPEN_TICKET_FORM[ \t>*_-]*$/gim, "")
        .replace(/\bRESOLUTION_ATTEMPT\b/gi, "")
        .replace(/\bOPEN_TICKET_FORM\b/gi, "");

    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setStreamingMessage(stripInternalTokens(assistantSoFar));
    };

    const ctrl = new AbortController();
    inflightRef.current = ctrl;

    try {
      await streamAgentChat({
        slug,
        messages: contextMessages,
        signal: ctrl.signal,
        onMode: (mode) => setServiceMode(mode),
        onDelta: upsertAssistant,
        onDone: async () => {
          setIsLoading(false);
          const hasEscalationToken = /OPEN_TICKET_FORM/i.test(assistantSoFar);
          const hasAttemptToken = /RESOLUTION_ATTEMPT/i.test(assistantSoFar);
          const cleanAssistantMessage = stripInternalTokens(assistantSoFar)
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          const nextAttempts = resolutionAttemptsRef.current + (hasAttemptToken ? 1 : 0);
          if (hasAttemptToken) setResolutionAttempts(nextAttempts);

          // Fallback: detecta frase de escalação caso o modelo esqueça o token
          const escalationPhraseRegex = /(vou abrir (um )?chamado|abrir (um )?chamado para o suporte|encaminhar para o suporte t[eé]cnico|abrir uma solicita[cç][aã]o)/i;
          const hasEscalationPhrase = escalationPhraseRegex.test(cleanAssistantMessage);

          // Abre o formulário sempre que o bot sinalizar escalação (token ou frase),
          // independente de contagem de tentativas — o prompt do sistema já controla quando escalar.
          const shouldOpenTicketForm = hasEscalationToken || hasEscalationPhrase;

          if (shouldOpenTicketForm) {
            setTicketFormOpen(true);
            setLastTicketId(null);
          }

          setStreamingMessage(null);
          if (user && conversaId && cleanAssistantMessage) {
            await addMensagem(conversaId, "assistant", cleanAssistantMessage);
          }
        },
        onError: (err, meta) => {
          const status = meta?.status;
          const retryAfterMs = meta?.retryAfterMs;
          const isRateLimit = status === 429 || /muitas solicitações|créditos esgotados/i.test(err);
          const isOverload = status === 503;

          if (isOverload) {
            const seconds = Math.max(1, Math.round((retryAfterMs ?? 5000) / 1000));
            toast.warning(
              <div className="space-y-1">
                <p className="font-medium">Alta demanda no momento.</p>
                <p className="text-sm opacity-90">
                  Aguarde cerca de {seconds}s e tente novamente — você não perdeu a conversa.
                </p>
              </div>
            );
          } else if (isRateLimit) {
            toast.error(
              <div className="space-y-2">
                <p className="font-medium">Serviço temporariamente indisponível.</p>
                <p className="text-sm opacity-90">
                  Você pode registrar seu chamado diretamente no{" "}
                  <a
                    href="https://suporte.pedroleopoldo.mg.gov.br"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 font-semibold"
                  >
                    portal GLPI
                  </a>
                  .
                </p>
              </div>
            );
            if (user && conversaId) {
              addMensagem(
                conversaId,
                "assistant",
                `⚠️ O serviço de IA atingiu o limite de uso no momento.\n\nVocê pode registrar seu chamado diretamente no portal de suporte: [Abrir chamado no GLPI](https://suporte.pedroleopoldo.mg.gov.br)`
              );
            }
          } else {
            toast.error(err);
          }
          setIsLoading(false);
          setStreamingMessage(null);
        },
      });
    } catch {
      toast.error("Erro ao conectar com o assistente.");
      setIsLoading(false);
      setStreamingMessage(null);
    } finally {
      if (inflightRef.current === ctrl) inflightRef.current = null;
    }
  };

  // Aborta stream pendente ao desmontar ou trocar de conversa.
  useEffect(() => {
    return () => {
      inflightRef.current?.abort();
      inflightRef.current = null;
    };
  }, []);

  useEffect(() => {
    inflightRef.current?.abort();
    inflightRef.current = null;
  }, [activeConversaId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const performTicketSubmission = async (data: TicketFormData) => {
    setIsSubmittingTicket(true);
    setLastTicketId(null);
    try {
      // Envia o histórico completo da conversa para o backend gerar título + resumo via IA
      const conversationMessages: Msg[] = mensagens.map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.conteudo,
      }));

      const payload = {
        nome: data.nome,
        email: data.email,
        setor: data.setor,
        ip: data.ip,
        ip_indisponivel: data.ip_indisponivel,
        on_behalf: data.on_behalf,
        beneficiary: data.beneficiary,
        messages: conversationMessages,
        selected_category: selectedCategory,
        user_id: user?.id ?? null,
        agent_slug: slug ?? null,
        conversa_id: activeConversaId ?? null,
        test_mode: testMode,
      };

      const result = await submitGlpiTicket(payload);

      if (result.success && result.ticket_id) {
        toast.success("Chamado aberto com sucesso!");
        setTicketFormOpen(false);
        setLastTicketId(result.ticket_id);
        setIssuePersists(false);
        // Persist setor on conversa for analytics by-sector grouping
        if (activeConversaId && data.setor) {
          await supabase.from("conversas").update({ setor: data.setor } as any).eq("id", activeConversaId);
        }
        trackEvent({
          event_type: "ticket_created",
          user_id: user?.id,
          conversa_id: activeConversaId,
          org_slug: slug,
          category: selectedCategory,
          setor: data.setor,
          metadata: { ticket_id: String(result.ticket_id), test_mode: !!testMode },
        });
        if (activeConversaId) {
          await addMensagem(
            activeConversaId,
            "assistant",
            `✅ Chamado **#${result.ticket_id}** aberto com sucesso! A equipe de TI será notificada e entrará em contato.`
          );
        }
        // Trigger feedback once per conversation after a successful ticket
        const convKey = activeConversaId || "anon";
        if (!feedbackShownConvosRef.current.has(convKey)) {
          feedbackShownConvosRef.current.add(convKey);
          setFeedbackContext({ conversaId: activeConversaId ?? null, ticketId: result.ticket_id });
          setTimeout(() => setFeedbackOpen(true), 600);
        }
      } else {
        const reason = result.error || "Erro ao abrir chamado. Tente novamente.";
        toast.error(reason);
        if (activeConversaId) {
          await addMensagem(
            activeConversaId,
            "assistant",
            `⚠️ Não consegui abrir o chamado automaticamente.\n\n**Motivo:** ${reason}\n\nVocê pode abrir o chamado diretamente no portal de suporte: [Abrir chamado no GLPI](${GLPI_DIRECT_URL})`
          );
        }
      }
    } catch (e) {
      console.error("Ticket submission error:", e);
      const reason = e instanceof Error ? e.message : "Erro ao abrir chamado. Tente novamente.";
      toast.error(reason);
      if (activeConversaId) {
        await addMensagem(
          activeConversaId,
          "assistant",
          `⚠️ Não consegui abrir o chamado automaticamente.\n\n**Motivo:** ${reason}\n\nVocê pode abrir o chamado diretamente no portal de suporte: [Abrir chamado no GLPI](${GLPI_DIRECT_URL})`
        );
      }
    } finally {
      setIsSubmittingTicket(false);
      setTestMode(false);
      pendingTicketRef.current = null;
    }
  };

  const handleTicketFormSubmit = async (data: TicketFormData) => {
    // Modo de teste pula a checagem de duplicidade.
    if (testMode) {
      await performTicketSubmission(data);
      return;
    }

    // Monta um texto representativo do problema para análise de similaridade.
    const conversationText = mensagens
      .filter(m => m.role === "user")
      .map(m => m.conteudo)
      .join(" \n ")
      .slice(0, 4000);

    setIsCheckingDuplicates(true);
    try {
      const { data: checkResult, error } = await supabase.functions.invoke("ticket-duplicate-check", {
        body: {
          user_id: user?.id ?? null,
          email: data.email,
          setor: data.setor,
          selected_category: selectedCategory,
          text: conversationText || selectedCategory || data.setor,
        },
      });

      if (!error && checkResult && (checkResult.duplicates?.length > 0 || checkResult.collective_incident)) {
        pendingTicketRef.current = data;
        setDuplicateCandidates(checkResult.duplicates ?? []);
        setCollectiveIncident(checkResult.collective_incident ?? null);
        setDuplicateDialogOpen(true);
        trackEvent({
          event_type: "ticket_duplicate_warning_shown",
          user_id: user?.id,
          conversa_id: activeConversaId,
          org_slug: slug,
          category: selectedCategory,
          setor: data.setor,
          metadata: {
            duplicates: (checkResult.duplicates ?? []).length,
            collective: !!checkResult.collective_incident,
          },
        });
        return;
      }
    } catch (e) {
      // Falha na checagem nunca bloqueia — apenas registra.
      console.warn("[duplicate-check] falhou, prosseguindo:", e);
    } finally {
      setIsCheckingDuplicates(false);
    }

    await performTicketSubmission(data);
  };

  const handleConfirmDuplicateProceed = async () => {
    const pending = pendingTicketRef.current;
    setDuplicateDialogOpen(false);
    trackEvent({
      event_type: "ticket_duplicate_overridden",
      user_id: user?.id,
      conversa_id: activeConversaId,
      org_slug: slug,
      category: selectedCategory,
    });
    if (pending) {
      await performTicketSubmission(pending);
    }
  };

  const handleCancelTicket = async () => {
    setTicketFormOpen(false);
    setLastTicketId(null);
    setTestMode(false);
  };

  const isNewChat = !activeConversaId && mensagens.length === 0 && !streamingMessage && !isLoading;

  const renderComposer = (initial: boolean) => (
    <div className={`w-full relative ${initial ? "max-w-[720px]" : "max-w-3xl"}`}>
      {(() => {
        const suggestion = suggestCategory(input);
        if (!suggestion || isLoading) return null;
        return (
          <div className="mb-2 flex justify-center animate-in fade-in slide-in-from-bottom-1">
            <button
              type="button"
              onClick={() => {
                setSelectedCategory(suggestion);
                sendMessage(`Olá! Estou com um problema relacionado a ${suggestion.toLowerCase()}. Pode me ajudar?`);
              }}
              className="text-xs px-3 py-1.5 rounded-full border shadow-sm hover:border-primary active:translate-y-px transition-all duration-200 flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              style={{
                background: 'hsl(var(--bot-card))',
                borderColor: 'hsl(var(--bot-primary) / 0.4)',
                color: 'hsl(var(--bot-fg))',
              }}
              title="Sugestão automática com base no que você digitou"
            >
              <span className="opacity-70">Parece sobre:</span>
              <span className="font-semibold" style={{ color: 'hsl(var(--bot-primary))' }}>
                {suggestion}
              </span>
            </button>
          </div>
        );
      })()}
      <div
        className={`relative flex items-end overflow-hidden border transition-all duration-200 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/20 ${initial ? "min-h-[62px] rounded-2xl shadow-sm" : "rounded-3xl shadow-sm"}`}
        style={{ background: 'hsl(var(--bot-card))', borderColor: 'hsl(var(--bot-border))' }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pergunte o que quiser..."
          rows={1}
          aria-label="Pergunte ao ChicoChat+"
          className={`flex-1 resize-none bg-transparent text-[15px] focus:outline-none max-h-[150px] overflow-y-auto placeholder:opacity-80 ${initial ? "px-5 sm:px-6 py-[19px]" : "px-6 py-4"}`}
          style={{ color: 'hsl(var(--bot-fg))' }}
          disabled={isLoading || isSubmittingTicket}
        />
        <div className={initial ? "p-2.5" : "p-2 sm:p-3"}>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            aria-label="Enviar mensagem"
            className={`${initial ? "w-11 h-11 rounded-xl" : "w-10 h-10 rounded-full"} flex items-center justify-center transition-all duration-200 disabled:opacity-30 hover:brightness-95 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
            style={{ background: 'hsl(var(--bot-primary))', color: 'hsl(var(--bot-primary-fg))' }}
          >
            <Send className="w-4 h-4 ml-0.5" />
          </button>
        </div>
      </div>
      <p className="text-center mt-2 text-[11px] sm:text-xs" style={{ color: 'hsl(var(--bot-muted-fg))' }}>
        O ChicoChat+ pode cometer erros. Verifique informações importantes.
      </p>
    </div>
  );

  if (infoLoading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'hsl(var(--bot-bg))' }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'hsl(var(--bot-primary))' }} />
      </div>
    );
  }

  if (!agentInfo?.org) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-screen px-6 text-center" style={{ background: 'hsl(var(--bot-bg))' }}>
        <p style={{ color: 'hsl(var(--bot-muted-fg))' }}>Não foi possível carregar o ChicoChat+ agora.</p>
        <button
          type="button"
          onClick={() => refetchAgentInfo()}
          disabled={infoFetching}
          className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ background: 'hsl(var(--bot-primary))', color: 'hsl(var(--bot-primary-fg, 0 0% 100%))' }}
        >
          {infoFetching ? "Tentando..." : "Tentar novamente"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen" style={{ background: 'hsl(var(--bot-bg))', color: 'hsl(var(--bot-fg))' }}>
      {/* Sidebar - always visible, auth inside */}
      <ConversationSidebar
        conversas={conversas}
        activeId={activeConversaId}
        onSelect={handleSelectConversa}
        onNew={handleNewConversa}
        onDelete={deleteConversa}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        isDark={isDark}
      />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 z-10 sticky top-0" style={{ background: 'transparent' }}>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="w-12 h-12 rounded-xl flex items-center justify-center transition-all hover:bg-black/5 dark:hover:bg-white/5 active:scale-95"
            style={{ background: 'transparent', color: 'hsl(var(--bot-muted-fg))' }}
            aria-label="Histórico de conversas"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /></svg>
          </button>
          <div className="flex-1 flex items-center justify-center">
          </div>
          <div className="flex items-center gap-2">
            <img src={plLogo} alt="PL+Digital" className="h-8 sm:h-10 w-auto object-contain" />
            <button
              onClick={() => setIsDark((prev) => !prev)}
              className="flex-shrink-0 w-12 h-12 flex items-center justify-center transition-all hover:bg-black/5 dark:hover:bg-white/5 rounded-xl active:scale-95"
              style={{ background: 'transparent', color: 'hsl(var(--bot-muted-fg))' }}
              aria-label={isDark ? "Modo claro" : "Modo escuro"}
            >
              {isDark ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
            </button>
          </div>
        </header>

        {/* Banner discreto quando rodando em modo de contingência (fallback Gemini) */}
        {serviceMode === "fallback" && (
          <div className="px-4 sm:px-6 py-2 text-xs text-center border-b border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300">
            Operando em modo de contingência. As respostas podem ser um pouco mais lentas que o normal.
          </div>
        )}

        {/* Messages / Hero */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto w-full scroll-smooth">
          {isNewChat ? (
          <div className="min-h-full flex flex-col items-center justify-center px-4 sm:px-6 py-5 sm:py-8 text-center max-w-[760px] mx-auto w-full">
              <div className="flex flex-col items-center">
                <img
                  src={verticalLogo}
                  alt="ChicoChat+"
                  className="w-[132px] sm:w-[168px] h-auto object-contain animate-fade-in drop-shadow-sm"
                />
                <div className="mt-2 space-y-1.5">
                  <h2
                    className="text-xl sm:text-2xl font-semibold"
                    style={{ color: "hsl(var(--bot-fg))" }}
                  >
                    Como posso te ajudar hoje?
                  </h2>
                  <p
                    className="text-sm max-w-xl mx-auto leading-relaxed"
                    style={{ color: "hsl(var(--bot-muted-fg))" }}
                  >
                    Sou o assistente de IA da Prefeitura Municipal de Pedro Leopoldo, especializado em TI. Descreva seu problema ou escolha um dos atalhos abaixo.
                  </p>
                </div>
              </div>

              <div className="w-full mt-5 sm:mt-6">
                {renderComposer(true)}
              </div>

              {agentInfo?.categories?.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 w-full mt-5 sm:mt-6">
                  {agentInfo.categories
                    .filter((c: any) => c.name !== "Eixo de requisição de acesso")
                    .sort((a: any, b: any) => {
                      const order = ["Eixo de dúvidas referentes ao SEI", "Eixo de chamados de outros tipos"];
                      const ai = order.indexOf(a.name);
                      const bi = order.indexOf(b.name);
                      if (ai === -1 && bi === -1) return 0;
                      if (ai === -1) return -1;
                      if (bi === -1) return 1;
                      return ai - bi;
                    })
                    .map((cat: any) => {
                      let displayTitle = cat.name;
                      let displayDesc = cat.description;
                      let customAction: (() => void) | null = null;
                      let Icon: any = LayoutGrid;

                      if (cat.name === "Eixo de manutenção/hardware") {
                        displayTitle = "Computador e Equipamentos";
                        displayDesc = "Não liga? Está lento? Apresenta erro ou defeito?";
                        Icon = Monitor;
                      } else if (cat.name === "Eixo de redes e problemas de internet") {
                        displayTitle = "Rede e internet";
                        displayDesc = "Conexão lenta ou está sem conexão?";
                        Icon = Globe;
                      } else if (cat.name === "Eixo de e-mail e comunicação" || cat.name === "E-mail e comunicação") {
                        displayTitle = "E-mail e comunicação";
                        displayDesc = "Problemas para enviar/receber ou configurar e-mail";
                        Icon = Mail;
                      } else if (cat.name === "Eixo de segurança da informação" || cat.name === "Segurança da informação") {
                        displayTitle = "Segurança da informação";
                        displayDesc = "Suspeita de vírus, bloqueios ou acessos indevidos";
                        Icon = ShieldCheck;
                      } else if (cat.name === "Eixo de instalação de sistemas" || cat.name === "Instalação de sistemas") {
                        displayTitle = "Instalação de Programas";
                        displayDesc = "Instalação, atualização ou manutenção de algum sistema usado internamente";
                        Icon = Download;
                      } else if (cat.name === "Eixo do GRP") {
                        displayTitle = "Sistemas GRP Sonner";
                        displayDesc = "Clique aqui para o guia PDF. [Ouvidoria aqui](https://drive.google.com/file/d/1JXErPh31xZJFVxGglTixj6lHWrN98OUB/view?usp=drive_link)";
                        Icon = Settings;
                        customAction = () => {
                          window.open("https://drive.google.com/file/d/1f6eROGNl47zhA5zuP925U-1iJGFtUBcA/view?usp=drive_link", "_blank");
                        };
                      } else if (cat.name === "Eixo de dúvidas referentes ao SEI") {
                        displayTitle = "Dúvidas referentes ao SEI";
                        displayDesc = "Atendimento com o Joseias, IA especializada em SEI";
                        Icon = FileText;
                        customAction = () => {
                          window.open("https://joseias.pl.mg.gov.br", "_blank");
                        };
                      } else if (cat.name === "Eixo da Repros") {
                        displayTitle = "Manutenção de Impressora";
                        displayDesc = "Problemas para imprimir ou falha de conexão";
                        Icon = Printer;
                      } else if (cat.name === "Eixo de redefinição de senhas") {
                        displayTitle = "Acessos e Senhas";
                        displayDesc = "Precisa redefinir senha ou está sem acesso?";
                        Icon = KeyRound;
                      } else if (cat.name === "Eixo de chamados de outros tipos") {
                        displayTitle = "Outra coisa?";
                        displayDesc = "Clique aqui caso queira tratar de algo não listado";
                        Icon = MoreHorizontal;
                      }

                      return (
                        <button
                          key={cat.name}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).tagName === "A") return;
                            if (customAction) {
                              customAction();
                            } else {
                              setSelectedCategory(displayTitle);
                              sendMessage(getCategoryMessage(cat.name, displayTitle));
                            }
                          }}
                          className="min-h-[68px] text-left px-3.5 py-2.5 rounded-lg transition-all duration-200 hover:-translate-y-px hover:border-primary hover:shadow-sm active:translate-y-0 flex items-center gap-3 group border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          style={{
                            borderColor: "hsl(var(--bot-border))",
                            background: "hsl(var(--bot-card))",
                            color: "hsl(var(--bot-fg))",
                          }}
                        >
                          <span
                            className="flex-shrink-0 w-9 h-9 rounded-md flex items-center justify-center transition-colors duration-200 group-hover:bg-primary/15"
                            style={{
                              background: "hsl(var(--bot-primary) / 0.10)",
                              color: "hsl(var(--bot-primary))",
                            }}
                          >
                            <Icon className="w-5 h-5" strokeWidth={2} />
                          </span>
                          <span className="flex flex-col gap-0 min-w-0 text-left">
                            <span className="font-semibold text-sm leading-tight">
                              {displayTitle}
                            </span>
                            {displayDesc && (
                              <span
                                className="text-xs leading-snug mt-1"
                                style={{ color: "hsl(var(--bot-muted-fg))" }}
                              >
                                {displayDesc.includes("](") ? (
                                  <span
                                    dangerouslySetInnerHTML={{
                                      __html: displayDesc.replace(
                                        /\[(.*?)\]\((.*?)\)/g,
                                        '<a href="$2" target="_blank" class="underline hover:text-blue-500">$1</a>'
                                      ),
                                    }}
                                  />
                                ) : (
                                  displayDesc
                                )}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                </div>
              )}

              <div className="grid grid-cols-1 gap-2.5 w-full mt-3 md:hidden">
                <button
                  onClick={handleConsultarChamados}
                  disabled={isLoading}
                  className="min-h-14 px-3.5 py-2.5 rounded-lg border flex items-center gap-3 text-left transition-all duration-200 hover:border-primary active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ borderColor: 'hsl(var(--bot-border))', background: 'hsl(var(--bot-card))', color: 'hsl(var(--bot-fg))' }}
                >
                  <ClipboardList className="w-5 h-5 flex-shrink-0" style={{ color: 'hsl(var(--bot-primary))' }} />
                  <span><span className="block text-sm font-semibold">Meus chamados</span><span className="block text-xs mt-0.5" style={{ color: 'hsl(var(--bot-muted-fg))' }}>Consultar chamados já abertos</span></span>
                </button>
                <a
                  href={GLPI_DIRECT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-14 px-3.5 py-2.5 rounded-lg border flex items-center gap-3 text-left transition-all duration-200 hover:border-primary active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ borderColor: 'hsl(var(--bot-border))', background: 'hsl(var(--bot-card))', color: 'hsl(var(--bot-fg))' }}
                >
                  <Ticket className="w-5 h-5 flex-shrink-0" style={{ color: 'hsl(var(--bot-primary))' }} />
                  <span className="flex-1"><span className="block text-sm font-semibold">Sou usuário avançado</span><span className="block text-xs mt-0.5" style={{ color: 'hsl(var(--bot-muted-fg))' }}>Abrir chamado no GLPI</span></span>
                  <ExternalLink className="w-3.5 h-3.5" style={{ color: 'hsl(var(--bot-muted-fg))' }} />
                </a>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 pb-32 space-y-6 sm:space-y-8">
              {displayMessages.map((msg, i) => {
                if (isNewChat && msg.content === greetingMsg.content) return null;
                if (!isNewChat && msg.content === greetingMsg.content && i === 0) return null;
                return (
                  <div key={i} className={`flex gap-4 sm:gap-6 ${msg.role === "user" ? "justify-end" : "justify-start"} w-full`}>
                    {msg.role === "assistant" && (
                      <div className="w-8 h-8 rounded-full border shadow-sm flex items-center justify-center flex-shrink-0 mt-1 bg-white dark:bg-transparent" style={{ borderColor: 'hsl(var(--bot-border))' }}>
                        <img src={logo} alt="ChicoChat+" className="w-5 h-5 object-contain" />
                      </div>
                    )}
                    <div className={`max-w-[85%] sm:max-w-[80%] px-5 py-3.5 relative overflow-visible ${msg.role === "user" ? "rounded-3xl rounded-tr-sm" : "rounded-3xl rounded-tl-sm"
                      }`} style={{
                        background: msg.role === "user" ? 'hsl(var(--bot-primary))' : 'hsl(var(--bot-muted))',
                        color: msg.role === "user" ? 'hsl(var(--bot-primary-fg))' : 'hsl(var(--bot-fg))',
                      }}>
                      <div className="prose prose-sm max-w-none dark:prose-invert font-normal text-[15px] leading-relaxed overflow-visible">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>
                          {msg.content
                            .replace('{}', '')}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                );
              })}

              {isLoading && displayMessages[displayMessages.length - 1]?.role === "user" && (
                <div className="flex gap-4 sm:gap-6 justify-start w-full">
                  <div className="w-8 h-8 rounded-full border shadow-sm flex items-center justify-center flex-shrink-0 mt-1 bg-white dark:bg-transparent" style={{ borderColor: 'hsl(var(--bot-border))' }}>
                    <img src={logo} alt="ChicoChat+" className="w-5 h-5 object-contain" />
                  </div>
                  <div className="rounded-3xl rounded-tl-sm px-5 py-4" style={{ background: 'hsl(var(--bot-muted))' }}>
                    <div className="flex items-center gap-1.5 h-4">
                      <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'hsl(var(--bot-primary))' }} />
                      <span className="w-2 h-2 rounded-full animate-bounce [animation-delay:150ms]" style={{ background: 'hsl(var(--bot-primary))' }} />
                      <span className="w-2 h-2 rounded-full animate-bounce [animation-delay:300ms]" style={{ background: 'hsl(var(--bot-primary))' }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input inferior somente durante uma conversa ativa */}
        {!isNewChat && (
          <div className="w-full px-4 sm:px-6 pb-6 pt-2 bg-gradient-to-t from-[hsl(var(--bot-bg))] via-[hsl(var(--bot-bg))] to-transparent absolute bottom-0 z-10 pointer-events-none">
            <div className="mx-auto w-full max-w-3xl flex justify-center pointer-events-auto">{renderComposer(false)}</div>
          </div>
        )}

        {/* Botão fixo "Meus chamados" — sempre visível no canto inferior esquerdo */}
        <button
          onClick={handleConsultarChamados}
          disabled={isLoading}
          className={`${sidebarOpen ? "hidden" : "hidden md:flex"} fixed bottom-4 left-4 z-40 text-left px-3 py-2.5 rounded-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] items-center gap-2.5 group border disabled:opacity-60 shadow-sm max-w-[240px]`}
          style={{
            borderColor: "hsl(var(--bot-border))",
            background: "hsl(var(--bot-card))",
            color: "hsl(var(--bot-fg))",
          }}
          aria-label="Consultar meus chamados no GLPI"
        >
          <span
            className="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-200 group-hover:scale-105"
            style={{
              background: "hsl(var(--bot-primary) / 0.10)",
              color: "hsl(var(--bot-primary))",
            }}
          >
            <ClipboardList className="w-[18px] h-[18px]" strokeWidth={2} />
          </span>
          <span className="flex flex-col gap-0 min-w-0 text-left">
            <span className="font-semibold text-[14px] leading-tight">
              Meus chamados
            </span>
            <span
              className="text-[11px] leading-snug mt-0.5"
              style={{ color: "hsl(var(--bot-muted-fg))" }}
            >
              Consultar chamados já abertos
            </span>
          </span>
        </button>
      </div>

      <Dialog open={ticketFormOpen} onOpenChange={setTicketFormOpen}>
        <DialogContent className="sm:max-w-xl border max-h-[90vh] overflow-y-auto overscroll-contain" style={{ background: 'hsl(var(--bot-card))', borderColor: 'hsl(var(--bot-border))' }}>
          <DialogHeader>
            <DialogTitle className="sr-only">Abertura de chamado</DialogTitle>
            <DialogDescription className="sr-only">
              Confira seus dados e confirme para abrir o chamado.
            </DialogDescription>
          </DialogHeader>
          <TicketDataForm
            onSubmit={handleTicketFormSubmit}
            onCancel={handleCancelTicket}
            ticketId={lastTicketId}
            isSubmitting={isSubmittingTicket || isCheckingDuplicates}
            initialNome={(user?.user_metadata?.full_name as string) || ""}
            initialSetor={(user?.user_metadata?.sector as string) || ""}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent className="sm:max-w-md border" style={{ background: 'hsl(var(--bot-card))', borderColor: 'hsl(var(--bot-border))' }}>
          <DialogHeader>
            <DialogTitle className="sr-only">Avaliação do atendimento</DialogTitle>
            <DialogDescription className="sr-only">
              Avalie sua experiência com o ChicoChat+ e deixe uma sugestão opcional.
            </DialogDescription>
          </DialogHeader>
          {user && (
            <FeedbackForm
              userId={user.id}
              orgSlug={slug ?? null}
              conversaId={feedbackContext.conversaId}
              ticketId={feedbackContext.ticketId}
              onClose={() => setFeedbackOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <DuplicateTicketDialog
        open={duplicateDialogOpen}
        onOpenChange={setDuplicateDialogOpen}
        duplicates={duplicateCandidates}
        collectiveIncident={collectiveIncident}
        onProceed={handleConfirmDuplicateProceed}
        isSubmitting={isSubmittingTicket}
      />

      <PrivacyNoticeDialog open={!!user && !privacyAccepted} onAccept={handleAcceptPrivacy} />

      {isNewChat && (
        <a
          href={GLPI_DIRECT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden md:flex fixed bottom-4 right-4 z-40 text-left px-3 py-2.5 rounded-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] items-center gap-2.5 group border shadow-sm max-w-[260px]"
          style={{
            borderColor: "hsl(var(--bot-border))",
            background: "hsl(var(--bot-card))",
            color: "hsl(var(--bot-fg))",
          }}
          aria-label="Sou usuário avançado — abrir chamado diretamente no GLPI"
        >
          <span
            className="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-200 group-hover:scale-105"
            style={{
              background: "hsl(var(--bot-primary) / 0.10)",
              color: "hsl(var(--bot-primary))",
            }}
          >
            <Ticket className="w-[18px] h-[18px]" strokeWidth={2} />
          </span>
          <span className="flex flex-col gap-0 min-w-0 text-left">
            <span className="font-semibold text-[14px] leading-tight flex items-center gap-1.5">
              Sou usuário avançado
            </span>
            <span
              className="text-[11px] leading-snug mt-0.5"
              style={{ color: "hsl(var(--bot-muted-fg))" }}
            >
              Abrir chamado no GLPI
            </span>
          </span>
          <ExternalLink
            className="w-3.5 h-3.5 flex-shrink-0 ml-1"
            style={{ color: "hsl(var(--bot-muted-fg))" }}
          />
        </a>
      )}

    </div>
  );
};

export default AgentChat;
