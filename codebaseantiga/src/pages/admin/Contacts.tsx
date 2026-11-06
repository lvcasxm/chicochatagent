import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { SupportContact } from "@/types/database";

const Contacts = () => {
  const { selectedOrg } = useOrg();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SupportContact | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const { data: items = [] } = useQuery({
    queryKey: ["contacts", selectedOrg],
    queryFn: async () => {
      const { data } = await supabase.from("support_contacts").select("*").eq("organization_id", selectedOrg!).order("created_at");
      return (data || []) as SupportContact[];
    },
    enabled: !!selectedOrg,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        const { error } = await supabase.from("support_contacts").update({ name, email, phone }).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("support_contacts").insert({ name, email, phone, organization_id: selectedOrg! });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contacts"] }); setOpen(false); toast.success("Salvo!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { await supabase.from("support_contacts").delete().eq("id", id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contacts"] }); toast.success("Removido!"); },
  });

  const openNew = () => { setEditing(null); setName(""); setEmail(""); setPhone(""); setOpen(true); };
  const openEdit = (item: SupportContact) => { setEditing(item); setName(item.name); setEmail(item.email); setPhone(item.phone); setOpen(true); };

  if (!selectedOrg) return <div className="p-8 text-center text-muted-foreground">Selecione uma organização.</div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold font-['Space_Grotesk']">Contatos de Suporte</h1>
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />Novo Contato</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.id} className="border rounded-xl p-4 bg-card">
            <h3 className="font-semibold">{item.name}</h3>
            {item.email && <p className="text-sm text-muted-foreground">{item.email}</p>}
            {item.phone && <p className="text-sm text-muted-foreground">{item.phone}</p>}
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="ghost" onClick={() => openEdit(item)}><Pencil className="w-3 h-3" /></Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del.mutate(item.id)}><Trash2 className="w-3 h-3" /></Button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-muted-foreground col-span-full">Nenhum contato cadastrado.</p>}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} Contato</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input placeholder="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Button className="w-full" onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Contacts;
