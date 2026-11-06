import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2 } from "lucide-react";
import { ChatMessage } from "@/components/ChatMessage";
import { CategoryChips } from "@/components/CategoryChips";
import { streamChat, type Msg } from "@/lib/chat";
import { toast } from "sonner";

const WELCOME_MESSAGE: Msg = {
  role: "assistant",
  content: `Olá! Sou o assistente de **TI da Prefeitura de Pedro Leopoldo**. 😊

Estou aqui para te ajudar com problemas técnicos, solicitações de acesso, internet, equipamentos e muito mais.

Me conta: **o que está acontecendo?**`,
};

const Index = () => {
  const [messages, setMessages] = useState<Msg[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Msg = { role: "user", content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    let assistantSoFar = "";
    const allMessages = [...messages.filter((m) => m !== WELCOME_MESSAGE), userMsg];

    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last !== WELCOME_MESSAGE) {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      await streamChat({
        messages: allMessages,
        onDelta: upsertAssistant,
        onDone: () => setIsLoading(false),
        onError: (err) => {
          const isRateLimit = /muitas solicitações|créditos esgotados/i.test(err);
          if (isRateLimit) {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `⚠️ O serviço de IA atingiu o limite de uso no momento.\n\nVocê pode registrar seu chamado diretamente no portal de suporte: [Abrir chamado no GLPI](https://suporte.pedroleopoldo.mg.gov.br)`,
              },
            ]);
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
          } else {
            toast.error(err);
          }
          setIsLoading(false);
        },
      });
    } catch {
      toast.error("Erro ao conectar com o assistente. Tente novamente.");
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const showCategories = messages.length <= 1;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-4 bg-primary text-primary-foreground shadow-md">
        <div className="w-10 h-10 rounded-full bg-primary-foreground/20 flex items-center justify-center text-lg font-bold">
          TI
        </div>
        <div>
          <h1 className="text-lg font-semibold">TI Pedro Leopoldo</h1>
          <p className="text-xs text-primary-foreground/70">Suporte Técnico • Prefeitura Municipal</p>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} />
        ))}
        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <Loader2 className="w-4 h-4 text-primary-foreground animate-spin" />
            </div>
            <div className="bg-chat-assistant rounded-2xl rounded-bl-md px-4 py-3">
              <span className="text-sm text-muted-foreground">Digitando...</span>
            </div>
          </div>
        )}
      </div>

      {/* Categories */}
      {showCategories && (
        <div className="px-4 pb-3">
          <p className="text-center text-sm text-muted-foreground mb-3">Selecione uma categoria ou digite sua dúvida:</p>
          <CategoryChips onSelect={sendMessage} />
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border px-4 py-3 bg-card">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua mensagem..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            disabled={isLoading}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="flex-shrink-0 w-11 h-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Index;
