import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { Category } from "@/types/database";

const Categories = () => {
  const { selectedOrg } = useOrg();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: items = [] } = useQuery({
    queryKey: ["categories", selectedOrg],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("*").eq("organization_id", selectedOrg!).order("created_at");
      return (data || []) as Category[];
    },
    enabled: !!selectedOrg,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        const { error } = await supabase.from("categories").update({ name, description }).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("categories").insert({ name, description, organization_id: selectedOrg! });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); setOpen(false); toast.success("Salvo!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { await supabase.from("categories").delete().eq("id", id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); toast.success("Removido!"); },
  });

  const openNew = () => { setEditing(null); setName(""); setDescription(""); setOpen(true); };
  const openEdit = (item: Category) => { setEditing(item); setName(item.name); setDescription(item.description); setOpen(true); };

  if (!selectedOrg) return <div className="p-8 text-center text-muted-foreground">Selecione uma organização.</div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold font-['Space_Grotesk']">Categorias</h1>
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />Nova Categoria</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.id} className="border rounded-xl p-4 bg-card">
            <h3 className="font-semibold">{item.name}</h3>
            <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="ghost" onClick={() => openEdit(item)}><Pencil className="w-3 h-3" /></Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del.mutate(item.id)}><Trash2 className="w-3 h-3" /></Button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-muted-foreground col-span-full">Nenhuma categoria cadastrada.</p>}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} Categoria</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
            <Textarea placeholder="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} />
            <Button className="w-full" onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Categories;
