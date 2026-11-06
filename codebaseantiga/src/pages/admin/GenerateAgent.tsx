import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Copy, ExternalLink, Rocket, Eye, EyeOff } from "lucide-react";

const GenerateAgent = () => {
  const { currentOrg, selectedOrg } = useOrg();
  const [showPrompt, setShowPrompt] = useState(false);

  const { data } = useQuery({
    queryKey: ["agent-preview", selectedOrg],
    queryFn: async () => {
      const [cats, topics, flows, steps, kb, contacts] = await Promise.all([
        supabase.from("categories").select("*").eq("organization_id", selectedOrg!),
        supabase.from("topics").select("*").eq("organization_id", selectedOrg!),
        supabase.from("flows").select("*").eq("organization_id", selectedOrg!),
        supabase.from("flow_steps").select("*"),
        supabase.from("knowledge_base").select("*").eq("organization_id", selectedOrg!),
        supabase.from("support_contacts").select("*").eq("organization_id", selectedOrg!),
      ]);
      // Filter steps by flow IDs
      const flowIds = (flows.data || []).map((f: any) => f.id);
      const filteredSteps = (steps.data || []).filter((s: any) => flowIds.includes(s.flow_id));
      return {
        cats: cats.data || [],
        topics: topics.data || [],
        flows: flows.data || [],
        steps: filteredSteps,
        knowledge: kb.data || [],
        contacts: contacts.data || [],
      };
    },
    enabled: !!selectedOrg,
  });

  const agentUrl = currentOrg ? `${window.location.origin}/agent/${currentOrg.slug}` : "";

  const copyUrl = () => {
    navigator.clipboard.writeText(agentUrl);
    toast.success("Link copiado!");
  };

  const buildPromptPreview = () => {
    if (!currentOrg || !data) return "";
    return `Assistente de IA: "${currentOrg.name}"
${currentOrg.description}

Categorias (${data.cats.length}):
${data.cats.map((c: any) => `- ${c.name}: ${c.description}`).join("\n")}

Tópicos (${data.topics.length}):
${data.topics.map((t: any) => `- [${t.type}/${t.level}] ${t.title}: ${t.description}`).join("\n")}

Fluxos (${data.flows.length}):
${data.flows.map((f: any) => {
  const fSteps = data.steps.filter((s: any) => s.flow_id === f.id).sort((a: any, b: any) => a.step_order - b.step_order);
  return `### ${f.name}\n${fSteps.map((s: any, i: number) => `  ${i + 1}. ${s.title}: ${s.description} ${s.action ? `(Ação: ${s.action})` : ""}`).join("\n")}`;
}).join("\n\n")}

Base de Conhecimento (${data.knowledge.length}):
${data.knowledge.map((k: any) => `- ${k.title}`).join("\n")}

Contatos de Suporte (${data.contacts.length}):
${data.contacts.map((c: any) => `- ${c.name} | ${c.email} | ${c.phone}`).join("\n")}`;
  };

  if (!selectedOrg || !currentOrg) {
    return <div className="p-8 text-center text-muted-foreground">Selecione uma organização.</div>;
  }

  const stats = data ? [
    { label: "Categorias", count: data.cats.length },
    { label: "Tópicos", count: data.topics.length },
    { label: "Fluxos", count: data.flows.length },
    { label: "Conhecimento", count: data.knowledge.length },
    { label: "Contatos", count: data.contacts.length },
  ] : [];

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold font-['Space_Grotesk'] mb-6 flex items-center gap-2">
        <Rocket className="w-6 h-6 text-primary" /> Gerar Agente
      </h1>

      <div className="border rounded-xl p-6 bg-card mb-6">
        <h2 className="font-semibold mb-2">Link do Agente</h2>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm bg-muted px-3 py-2 rounded-lg break-all">{agentUrl}</code>
          <Button size="icon" variant="outline" onClick={copyUrl}><Copy className="w-4 h-4" /></Button>
          <a href={agentUrl} target="_blank" rel="noreferrer">
            <Button size="icon" variant="outline"><ExternalLink className="w-4 h-4" /></Button>
          </a>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Compartilhe este link com os usuários da sua organização.
        </p>
      </div>

      <div className="border rounded-xl p-6 bg-card mb-6">
        <h2 className="font-semibold mb-3">Dados do Agente</h2>
        <div className="grid grid-cols-5 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="text-center p-3 bg-muted rounded-lg">
              <p className="text-2xl font-bold">{s.count}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        <button
          className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
          onClick={() => setShowPrompt(!showPrompt)}
        >
          <h2 className="font-semibold">Preview do Prompt</h2>
          {showPrompt ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
        {showPrompt && (
          <pre className="p-4 border-t text-xs text-muted-foreground whitespace-pre-wrap max-h-96 overflow-y-auto">
            {buildPromptPreview()}
          </pre>
        )}
      </div>
    </div>
  );
};

export default GenerateAgent;
