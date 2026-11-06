import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { FolderTree, BookOpen, GitBranch, Database, Phone } from "lucide-react";
import logoIconBlue from "@/assets/logo-icon-blue.png";

const Dashboard = () => {
  const { selectedOrg, currentOrg } = useOrg();

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats", selectedOrg],
    queryFn: async () => {
      const [cats, topics, flows, kb, contacts] = await Promise.all([
        supabase.from("categories").select("id", { count: "exact", head: true }).eq("organization_id", selectedOrg!),
        supabase.from("topics").select("id", { count: "exact", head: true }).eq("organization_id", selectedOrg!),
        supabase.from("flows").select("id", { count: "exact", head: true }).eq("organization_id", selectedOrg!),
        supabase.from("knowledge_base").select("id", { count: "exact", head: true }).eq("organization_id", selectedOrg!),
        supabase.from("support_contacts").select("id", { count: "exact", head: true }).eq("organization_id", selectedOrg!),
      ]);
      return {
        categories: cats.count || 0,
        topics: topics.count || 0,
        flows: flows.count || 0,
        knowledge: kb.count || 0,
        contacts: contacts.count || 0,
      };
    },
    enabled: !!selectedOrg,
  });

  const cards = [
    { label: "Categorias", value: stats?.categories, icon: FolderTree },
    { label: "Tópicos", value: stats?.topics, icon: BookOpen },
    { label: "Fluxos", value: stats?.flows, icon: GitBranch },
    { label: "Conhecimento", value: stats?.knowledge, icon: Database },
    { label: "Contatos", value: stats?.contacts, icon: Phone },
  ];

  if (!selectedOrg) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <img src={logoIconBlue} alt="ChicoChat+" className="w-20 h-20 opacity-20 mb-6" />
        <p className="text-lg text-muted-foreground">Crie uma organização para começar.</p>
        <p className="text-sm text-muted-foreground mt-2">Vá em "Organizações" no menu lateral.</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6 font-['Velocity']">
        {currentOrg?.name || "Dashboard"}
      </h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="border rounded-xl p-5 bg-card hover:shadow-md transition-shadow">
            <c.icon className="w-8 h-8 text-primary mb-3" />
            <p className="text-3xl font-bold font-['Velocity']">{stats ? c.value : "—"}</p>
            <p className="text-sm text-muted-foreground">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
