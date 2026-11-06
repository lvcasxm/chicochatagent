import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { Topic, Category } from "@/types/database";

const TYPES = ["processo", "dúvida", "instrução", "política"];
const LEVELS = ["básico", "intermediário", "avançado"];

const Topics = () => {
  const { selectedOrg } = useOrg();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [type, setType] = useState("processo");
  const [level, setLevel] = useState("básico");

  const { data: items = [] } = useQuery({
    queryKey: ["topics", selectedOrg],
    queryFn: async () => {
      const { data } = await supabase.from("topics").select("*").eq("organization_id", selectedOrg!).order("created_at");
      return (data || []) as Topic[];
    },
    enabled: !!selectedOrg,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories", selectedOrg],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("*").eq("organization_id", selectedOrg!);
      return (data || []) as Category[];
    },
    enabled: !!selectedOrg,
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = { title, description, category_id: categoryId || null, type, level, organization_id: selectedOrg! };
      if (editing) {
        const { error } = await supabase.from("topics").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("topics").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["topics"] }); setOpen(false); toast.success("Salvo!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { await supabase.from("topics").delete().eq("id", id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["topics"] }); toast.success("Removido!"); },
  });

  const openNew = () => { setEditing(null); setTitle(""); setDescription(""); setCategoryId(""); setType("processo"); setLevel("básico"); setOpen(true); };
  const openEdit = (item: Topic) => {
    setEditing(item); setTitle(item.title); setDescription(item.description);
    setCategoryId(item.category_id || ""); setType(item.type); setLevel(item.level); setOpen(true);
  };

  if (!selectedOrg) return <div className="p-8 text-center text-muted-foreground">Selecione uma organização.</div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold font-['Space_Grotesk']">Tópicos</h1>
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />Novo Tópico</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.id} className="border rounded-xl p-4 bg-card">
            <div className="flex gap-2 mb-2">
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">{item.type}</span>
              <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded">{item.level}</span>
            </div>
            <h3 className="font-semibold">{item.title}</h3>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="ghost" onClick={() => openEdit(item)}><Pencil className="w-3 h-3" /></Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del.mutate(item.id)}><Trash2 className="w-3 h-3" /></Button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-muted-foreground col-span-full">Nenhum tópico cadastrado.</p>}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} Tópico</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea placeholder="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} />
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Categoria (opcional)" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-4">
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={() => save.mutate()} disabled={!title.trim() || save.isPending}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Topics;
