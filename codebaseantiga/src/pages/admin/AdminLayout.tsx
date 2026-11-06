import { useEffect } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { OrgProvider, useOrg } from "@/contexts/OrgContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Building2, FolderTree, BookOpen,
  GitBranch, Database, Phone, Rocket, LogOut, BarChart3, MessageSquare,
} from "lucide-react";
import logoIconBlue from "@/assets/logo-icon-blue.png";

const navItems = [
  { to: "/admin", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/admin/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/admin/conversas", icon: MessageSquare, label: "Conversas" },
  { to: "/admin/organizations", icon: Building2, label: "Organizações" },
  { to: "/admin/categories", icon: FolderTree, label: "Categorias" },
  { to: "/admin/topics", icon: BookOpen, label: "Tópicos" },
  { to: "/admin/flows", icon: GitBranch, label: "Fluxos" },
  { to: "/admin/knowledge", icon: Database, label: "Conhecimento" },
  { to: "/admin/contacts", icon: Phone, label: "Contatos" },
  { to: "/admin/generate", icon: Rocket, label: "Gerar Agente" },
];

const AdminContent = () => {
  const { user, loading: authLoading, roleLoading, isAdmin, role, signOut } = useAuth();
  const { organizations, selectedOrg, setSelectedOrg } = useOrg();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (authLoading || roleLoading) return;
    if (!user) {
      navigate("/auth?redirect=/admin", { replace: true });
    } else if (!isAdmin) {
      // Usuário autenticado mas sem permissão de admin
      navigate("/agent/chicobot", { replace: true });
    }
  }, [user, authLoading, roleLoading, isAdmin, navigate]);

  if (authLoading || (user && role === null)) return <div className="flex items-center justify-center h-screen text-muted-foreground">Carregando...</div>;
  if (!user || !isAdmin) return null;

  return (
    <div className="flex h-screen">
      <aside className="w-64 flex-shrink-0 bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="p-4 flex items-center gap-3 border-b border-sidebar-border">
          <img src={logoIconBlue} alt="ChicoChat+" className="w-8 h-8 object-contain" />
          <span className="font-bold font-['Velocity'] text-sm tracking-wide">ChicoChat+</span>
        </div>

        {organizations.length > 0 && (
          <div className="p-3 border-b border-sidebar-border">
            <Select value={selectedOrg || ""} onValueChange={setSelectedOrg}>
              <SelectTrigger className="bg-sidebar-accent/30 border-sidebar-border text-sidebar-foreground text-xs">
                <SelectValue placeholder="Selecionar organização" />
              </SelectTrigger>
              <SelectContent>
                {organizations.map((org) => (
                  <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-sidebar-primary/15 text-sidebar-primary font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/30 hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/20"
            onClick={() => signOut()}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sair
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-background">
        <Outlet />
      </main>
    </div>
  );
};

const AdminLayout = () => (
  <OrgProvider>
    <AdminContent />
  </OrgProvider>
);

export default AdminLayout;
