import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ExternalLink } from "lucide-react";
import type { Organization } from "@/types/database";

const slugify = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const Organizations = () => {
  const { user, isAdmin, roleLoading } = useAuth();
  const { setSelectedOrg } = useOrg();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Organization | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");

  const { data: items = [] } = useQuery({
    queryKey: ["organizations", user?.id, isAdmin],
    queryFn: async () => {
      let query = supabase.from("organizations").select("*").order("created_at");
      if (!isAdmin) {
        query = query.eq("created_by", user!.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as Organization[];
    },
    enabled: !!user && !roleLoading,
  });

  const save = useMutation({
    mutationFn: async () => {
      const s = slug || slugify(name);
      if (editing) {
        const { error } = await supabase.from("organizations").update({ name, description, slug: s }).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("organizations")
          .insert({ name, description, slug: s, created_by: user!.id }).select().single();
        if (error) throw error;
        setSelectedOrg(data.id);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["organizations"] }); setOpen(false); toast.success("Salvo!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("organizations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["organizations"] }); toast.success("Removido!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const openNew = () => { setEditing(null); setName(""); setDescription(""); setSlug(""); setOpen(true); };
  const openEdit = (item: Organization) => {
    setEditing(item); setName(item.name); setDescription(item.description); setSlug(item.slug); setOpen(true);
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold font-['Space_Grotesk']">Organizações</h1>
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />Nova Organização</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.id} className="border rounded-xl p-5 bg-card">
            <h3 className="font-semibold text-lg">{item.name}</h3>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
            <div className="flex items-center gap-1 mt-2">
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">/{item.slug}</span>
              <a href={`/agent/${item.slug}`} target="_blank" rel="noreferrer">
                <ExternalLink className="w-3 h-3 text-muted-foreground" />
              </a>
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="ghost" onClick={() => openEdit(item)}><Pencil className="w-3 h-3" /></Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del.mutate(item.id)}><Trash2 className="w-3 h-3" /></Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} Organização</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Nome da organização" value={name} onChange={(e) => { setName(e.target.value); if (!editing) setSlug(slugify(e.target.value)); }} />
            <Input placeholder="Slug (URL)" value={slug} onChange={(e) => setSlug(e.target.value)} />
            <Textarea placeholder="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} />
            <Button className="w-full" onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
              {save.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Organizations;
