import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, FileText, Upload } from "lucide-react";
import type { KnowledgeItem } from "@/types/database";

const KnowledgeBase = () => {
  const { selectedOrg } = useOrg();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: items = [] } = useQuery({
    queryKey: ["knowledge", selectedOrg],
    queryFn: async () => {
      const { data } = await supabase.from("knowledge_base").select("*").eq("organization_id", selectedOrg!).order("created_at", { ascending: false });
      return (data || []) as KnowledgeItem[];
    },
    enabled: !!selectedOrg,
  });

  const saveText = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("knowledge_base").insert({
        organization_id: selectedOrg!,
        title,
        content,
        file_type: "text",
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["knowledge"] }); setOpen(false); setTitle(""); setContent(""); toast.success("Conteúdo adicionado!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = `${selectedOrg}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("knowledge-files").upload(path, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from("knowledge-files").getPublicUrl(path);

      let textContent = "";
      if (file.type === "text/plain") {
        textContent = await file.text();
      }

      const { error } = await supabase.from("knowledge_base").insert({
        organization_id: selectedOrg!,
        title: file.name,
        file_url: publicUrl,
        file_type: file.type || file.name.split(".").pop() || "unknown",
        content: textContent,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      toast.success("Arquivo enviado!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar arquivo");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const del = useMutation({
    mutationFn: async (id: string) => { await supabase.from("knowledge_base").delete().eq("id", id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["knowledge"] }); toast.success("Removido!"); },
  });

  if (!selectedOrg) return <div className="p-8 text-center text-muted-foreground">Selecione uma organização.</div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold font-['Space_Grotesk']">Base de Conhecimento</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload className="w-4 h-4 mr-2" />{uploading ? "Enviando..." : "Upload"}
          </Button>
          <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-2" />Adicionar Texto</Button>
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={handleFileUpload} />
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="border rounded-xl p-4 bg-card flex items-start gap-3">
            <FileText className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm">{item.title}</h3>
              <span className="text-xs text-muted-foreground">{item.file_type}</span>
              {item.content && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.content}</p>}
            </div>
            <Button size="icon" variant="ghost" className="text-destructive h-8 w-8" onClick={() => del.mutate(item.id)}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        ))}
        {items.length === 0 && <p className="text-muted-foreground">Nenhum conteúdo cadastrado.</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar Conteúdo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea placeholder="Conteúdo de texto..." value={content} onChange={(e) => setContent(e.target.value)} rows={8} />
            <Button className="w-full" onClick={() => saveText.mutate()} disabled={!title.trim() || !content.trim() || saveText.isPending}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default KnowledgeBase;
