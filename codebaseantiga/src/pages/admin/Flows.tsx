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
import { Plus, Pencil, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import type { Flow, FlowStep, Category } from "@/types/database";

const Flows = () => {
  const { selectedOrg } = useOrg();
  const qc = useQueryClient();
  const [flowOpen, setFlowOpen] = useState(false);
  const [stepOpen, setStepOpen] = useState(false);
  const [editingFlow, setEditingFlow] = useState<Flow | null>(null);
  const [editingStep, setEditingStep] = useState<FlowStep | null>(null);
  const [expandedFlow, setExpandedFlow] = useState<string | null>(null);
  const [flowName, setFlowName] = useState("");
  const [flowCategoryId, setFlowCategoryId] = useState("");
  const [stepTitle, setStepTitle] = useState("");
  const [stepDesc, setStepDesc] = useState("");
  const [stepAction, setStepAction] = useState("");
  const [stepResponsible, setStepResponsible] = useState("");
  const [activeFlowId, setActiveFlowId] = useState("");

  const { data: flows = [] } = useQuery({
    queryKey: ["flows", selectedOrg],
    queryFn: async () => {
      const { data } = await supabase.from("flows").select("*").eq("organization_id", selectedOrg!).order("created_at");
      return (data || []) as Flow[];
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

  const { data: steps = [] } = useQuery({
    queryKey: ["flow-steps", expandedFlow],
    queryFn: async () => {
      const { data } = await supabase.from("flow_steps").select("*").eq("flow_id", expandedFlow!).order("step_order");
      return (data || []) as FlowStep[];
    },
    enabled: !!expandedFlow,
  });

  const saveFlow = useMutation({
    mutationFn: async () => {
      const payload = { name: flowName, category_id: flowCategoryId || null, organization_id: selectedOrg! };
      if (editingFlow) {
        await supabase.from("flows").update(payload).eq("id", editingFlow.id);
      } else {
        await supabase.from("flows").insert(payload);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["flows"] }); setFlowOpen(false); toast.success("Salvo!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const delFlow = useMutation({
    mutationFn: async (id: string) => { await supabase.from("flows").delete().eq("id", id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["flows"] }); toast.success("Removido!"); },
  });

  const saveStep = useMutation({
    mutationFn: async () => {
      const nextOrder = steps.length;
      const payload = { flow_id: activeFlowId, title: stepTitle, description: stepDesc, action: stepAction, responsible: stepResponsible, step_order: editingStep?.step_order ?? nextOrder };
      if (editingStep) {
        await supabase.from("flow_steps").update(payload).eq("id", editingStep.id);
      } else {
        await supabase.from("flow_steps").insert(payload);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["flow-steps"] }); setStepOpen(false); toast.success("Etapa salva!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const delStep = useMutation({
    mutationFn: async (id: string) => { await supabase.from("flow_steps").delete().eq("id", id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["flow-steps"] }); toast.success("Etapa removida!"); },
  });

  const openNewFlow = () => { setEditingFlow(null); setFlowName(""); setFlowCategoryId(""); setFlowOpen(true); };
  const openEditFlow = (f: Flow) => { setEditingFlow(f); setFlowName(f.name); setFlowCategoryId(f.category_id || ""); setFlowOpen(true); };
  const openNewStep = (flowId: string) => { setActiveFlowId(flowId); setEditingStep(null); setStepTitle(""); setStepDesc(""); setStepAction(""); setStepResponsible(""); setStepOpen(true); };
  const openEditStep = (s: FlowStep) => { setActiveFlowId(s.flow_id); setEditingStep(s); setStepTitle(s.title); setStepDesc(s.description); setStepAction(s.action); setStepResponsible(s.responsible); setStepOpen(true); };

  if (!selectedOrg) return <div className="p-8 text-center text-muted-foreground">Selecione uma organização.</div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold font-['Space_Grotesk']">Fluxos</h1>
        <Button onClick={openNewFlow}><Plus className="w-4 h-4 mr-2" />Novo Fluxo</Button>
      </div>
      <div className="space-y-4">
        {flows.map((flow) => (
          <div key={flow.id} className="border rounded-xl bg-card overflow-hidden">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => setExpandedFlow(expandedFlow === flow.id ? null : flow.id)}>
                {expandedFlow === flow.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                <h3 className="font-semibold">{flow.name}</h3>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEditFlow(flow)}><Pencil className="w-3 h-3" /></Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => delFlow.mutate(flow.id)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            </div>
            {expandedFlow === flow.id && (
              <div className="border-t px-4 py-3 bg-muted/30">
                <div className="space-y-2 mb-3">
                  {steps.map((s, i) => (
                    <div key={s.id} className="flex items-start gap-3 p-3 bg-background rounded-lg border">
                      <span className="text-xs font-bold bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{s.title}</p>
                        {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                        {s.action && <p className="text-xs text-accent mt-1">Ação: {s.action}</p>}
                        {s.responsible && <p className="text-xs text-muted-foreground">Responsável: {s.responsible}</p>}
                      </div>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openEditStep(s)}><Pencil className="w-3 h-3" /></Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => delStep.mutate(s.id)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  ))}
                  {steps.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma etapa cadastrada.</p>}
                </div>
                <Button size="sm" variant="outline" onClick={() => openNewStep(flow.id)}><Plus className="w-3 h-3 mr-1" />Adicionar Etapa</Button>
              </div>
            )}
          </div>
        ))}
        {flows.length === 0 && <p className="text-muted-foreground">Nenhum fluxo cadastrado.</p>}
      </div>

      <Dialog open={flowOpen} onOpenChange={setFlowOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingFlow ? "Editar" : "Novo"} Fluxo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Nome do fluxo" value={flowName} onChange={(e) => setFlowName(e.target.value)} />
            <Select value={flowCategoryId} onValueChange={setFlowCategoryId}>
              <SelectTrigger><SelectValue placeholder="Categoria (opcional)" /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button className="w-full" onClick={() => saveFlow.mutate()} disabled={!flowName.trim() || saveFlow.isPending}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={stepOpen} onOpenChange={setStepOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingStep ? "Editar" : "Nova"} Etapa</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Título da etapa" value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} />
            <Textarea placeholder="Descrição" value={stepDesc} onChange={(e) => setStepDesc(e.target.value)} />
            <Input placeholder="Ação esperada" value={stepAction} onChange={(e) => setStepAction(e.target.value)} />
            <Input placeholder="Responsável (opcional)" value={stepResponsible} onChange={(e) => setStepResponsible(e.target.value)} />
            <Button className="w-full" onClick={() => saveStep.mutate()} disabled={!stepTitle.trim() || saveStep.isPending}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Flows;
