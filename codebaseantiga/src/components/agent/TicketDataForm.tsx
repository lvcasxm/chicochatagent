import { useState } from "react";
import { User, Send, Loader2, CheckCircle2, AlertCircle, Mail, Globe2, Info, MapPin, UserPlus, IdCard, Building2, Users } from "lucide-react";

import { formatIP, isValidIPv4 } from "@/lib/ip-utils";

export type TicketBeneficiary = {
  nome: string;
  matricula?: string;
  setor: string;
};

export type TicketFormData = {
  nome: string;
  email: string;
  setor: string;
  ip?: string;
  ip_indisponivel?: boolean;
  on_behalf?: boolean;
  beneficiary?: TicketBeneficiary;
};

type Props = {
  onSubmit: (data: TicketFormData) => void;
  onCancel?: () => void;
  ticketId?: string | number | null;
  isSubmitting?: boolean;
  initialNome?: string;
  initialSetor?: string;
};

export default function TicketDataForm({ onSubmit, onCancel, ticketId, isSubmitting, initialNome, initialSetor }: Props) {
  const [nome, setNome] = useState(initialNome ?? "");
  const [email, setEmail] = useState("");
  const [setor, setSetor] = useState(initialSetor ?? "");
  const [ip, setIp] = useState("");
  const [noIpAccess, setNoIpAccess] = useState(false);
  const [onBehalf, setOnBehalf] = useState(false);
  const [bNome, setBNome] = useState("");
  const [bMatricula, setBMatricula] = useState("");
  const [bSetor, setBSetor] = useState("");
  const [touched, setTouched] = useState({ nome: false, email: false, sector: false, ip: false, bNome: false, bSetor: false });

  const nomeTrimmed = nome.trim();
  const emailTrimmed = email.trim();
  const ipTrimmed = ip.trim();
  const bNomeTrimmed = bNome.trim();
  const bSetorTrimmed = bSetor.trim();
  const bMatriculaTrimmed = bMatricula.trim();
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed);
  const isSectorValid = setor.trim().length >= 2;
  const isIpValid = noIpAccess || isValidIPv4(ipTrimmed);
  const isBeneficiaryValid = !onBehalf || (bNomeTrimmed.length > 0 && bSetorTrimmed.length >= 2);
  const isFormValid = nomeTrimmed.length > 0 && isEmailValid && isSectorValid && isIpValid && isBeneficiaryValid;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) {
      setTouched({ nome: true, email: true, sector: true, ip: true, bNome: true, bSetor: true });
      return;
    }
    onSubmit({
      nome: nomeTrimmed,
      email: emailTrimmed,
      setor,
      ip: noIpAccess ? undefined : ipTrimmed,
      ip_indisponivel: noIpAccess,
      on_behalf: onBehalf,
      beneficiary: onBehalf
        ? {
            nome: bNomeTrimmed,
            matricula: bMatriculaTrimmed || undefined,
            setor: bSetorTrimmed,
          }
        : undefined,
    });
  };

  if (ticketId) {
    return (
      <div className="w-full flex flex-col items-center text-center space-y-4 py-4 animate-in fade-in zoom-in duration-300">
        <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <div>
          <h3 className="text-xl font-bold">Chamado Aberto!</h3>
          <p className="opacity-70">O time de TI já foi notificado.</p>
        </div>
        <div className="bg-black/5 dark:bg-white/5 w-full max-w-[240px] py-4 rounded-2xl border border-black/5 dark:border-white/5 shadow-inner">
          <span className="text-[11px] uppercase tracking-wider opacity-50 block mb-1">Protocolo</span>
          <span className="text-2xl font-mono font-bold tracking-tight">#{ticketId}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full relative z-20">
      <div className="mb-6">
        <h3 className="text-xl font-bold mb-1 leading-tight">Abertura de chamado</h3>
        <p className="text-sm opacity-70">
          Preencha os dados abaixo para enviar sua solicitação ao suporte técnico.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Seção: Dados do solicitante */}
        <div className="flex items-center gap-2 px-1 -mb-1">
          <User className="w-3.5 h-3.5 opacity-60" />
          <span className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
            Dados do solicitante
          </span>
        </div>

        {/* Nome completo */}
        <div className="space-y-1.5 overflow-visible">
          <label className="text-xs font-semibold uppercase tracking-wider opacity-60 ml-1">Nome completo</label>
          <div className="relative">
            <User className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${nomeTrimmed ? 'text-green-500' : 'opacity-40'}`} />
            <input
              type="text"
              placeholder="Digite seu nome completo"
              value={nome}
              onBlur={() => setTouched(prev => ({ ...prev, nome: true }))}
              onChange={(e) => setNome(e.target.value)}
              required
              className="w-full pl-9 pr-3 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 transition-all"
              style={{
                background: 'hsl(var(--bot-bg))',
                border: `1px solid ${touched.nome && !nomeTrimmed ? '#ef4444' : 'hsl(var(--bot-border))'}`,
                '--tw-ring-color': 'hsl(var(--bot-primary))'
              } as any}
            />
          </div>
        </div>

        {/* E-mail */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider opacity-60 ml-1">E-mail institucional</label>
          <div className="relative">
            <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${emailTrimmed && isEmailValid ? 'text-green-500' : touched.email && !isEmailValid ? 'text-red-500' : 'opacity-40'}`} />
            <input
              type="email"
              placeholder="seu.nome@pedroleopoldo.mg.gov.br"
              value={email}
              onBlur={() => setTouched(prev => ({ ...prev, email: true }))}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full pl-9 pr-3 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 transition-all"
              style={{
                background: 'hsl(var(--bot-bg))',
                border: `1px solid ${touched.email && !isEmailValid ? '#ef4444' : 'hsl(var(--bot-border))'}`,
                '--tw-ring-color': 'hsl(var(--bot-primary))'
              } as any}
            />
          </div>
          {touched.email && !isEmailValid && (
            <p className="text-[10px] text-red-500 flex items-center gap-1 px-1 mt-1 font-medium">
              <AlertCircle className="w-3 h-3" /> Informe um e-mail válido
            </p>
          )}
        </div>

        {/* Local / Setor */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider opacity-60 ml-1">Local / Setor</label>
          <div className="relative">
            <MapPin className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${isSectorValid ? 'text-green-500' : touched.sector && !isSectorValid ? 'text-red-500' : 'opacity-40'}`} />
            <input
              type="text"
              placeholder="Ex: Secretaria de Educação - Sala 12"
              value={setor}
              onBlur={() => setTouched(prev => ({ ...prev, sector: true }))}
              onChange={(e) => setSetor(e.target.value)}
              required
              className="w-full pl-9 pr-3 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 transition-all"
              style={{
                background: 'hsl(var(--bot-bg))',
                border: `1px solid ${touched.sector && !isSectorValid ? '#ef4444' : 'hsl(var(--bot-border))'}`,
                '--tw-ring-color': 'hsl(var(--bot-primary))'
              } as any}
            />
          </div>
          {touched.sector && !isSectorValid && (
            <p className="text-[10px] text-red-500 flex items-center gap-1 px-1 mt-1 font-medium">
              <AlertCircle className="w-3 h-3" /> Informe seu local/setor
            </p>
          )}
        </div>

        {/* IP da máquina */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider opacity-60 ml-1">IP da máquina</label>
          <div className="relative">
            <Globe2 className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${!noIpAccess && ipTrimmed && isIpValid ? 'text-green-500' : touched.ip && !isIpValid ? 'text-red-500' : 'opacity-40'}`} />
            <input
              type="text"
              inputMode="decimal"
              placeholder="Ex: 10.1.6.57 ou 10.1.6.215"
              value={ip}
              onBlur={() => setTouched(prev => ({ ...prev, ip: true }))}
              onChange={(e) => setIp(formatIP(e.target.value))}
              disabled={noIpAccess}
              required={!noIpAccess}
              className="w-full pl-9 pr-3 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'hsl(var(--bot-bg))',
                border: `1px solid ${touched.ip && !isIpValid ? '#ef4444' : 'hsl(var(--bot-border))'}`,
                '--tw-ring-color': 'hsl(var(--bot-primary))'
              } as any}
            />
          </div>
          {touched.ip && !isIpValid && (
            <p className="text-[10px] text-red-500 flex items-center gap-1 px-1 mt-1 font-medium">
              <AlertCircle className="w-3 h-3" /> Informe um IP no formato XX.X.X.XX ou XX.X.X.XXX
            </p>
          )}
          {!noIpAccess && (
            <p className="text-[10px] normal-case tracking-normal opacity-60 flex items-center gap-1.5 px-1 mt-2 leading-snug">
              <Info className="w-3 h-3 shrink-0" /> Para descobrir o IP, na área de trabalho, clique duas vezes no arquivo MostrarIP.bat.
            </p>
          )}
          <label className="flex items-start gap-2 px-1 mt-2 text-[10px] normal-case tracking-normal opacity-70 cursor-pointer select-none leading-snug">
            <input
              type="checkbox"
              checked={noIpAccess}
              onChange={(e) => {
                const checked = e.target.checked;
                setNoIpAccess(checked);
                if (checked) setIp("");
                setTouched(prev => ({ ...prev, ip: checked ? false : prev.ip }));
              }}
              className="mt-0.5 h-3.5 w-3.5 rounded border focus:ring-2"
              style={{ accentColor: 'hsl(var(--bot-primary))' }}
            />
            <span>Não tenho acesso ao IP (computador não liga / sem acesso à máquina)</span>
          </label>
        </div>

        {/* Abrindo em nome de outra pessoa */}
        <label className="flex items-start gap-2 px-1 text-[10px] normal-case tracking-normal opacity-70 cursor-pointer select-none leading-snug">
          <input
            type="checkbox"
            checked={onBehalf}
            onChange={(e) => setOnBehalf(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border focus:ring-2"
            style={{ accentColor: 'hsl(var(--bot-primary))' }}
          />
          <span>Estou abrindo um chamado em nome de outra pessoa</span>
        </label>

        {/* Seção expansível: Dados da pessoa atendida */}
        <div
          className={`grid transition-all duration-300 ease-out ${
            onBehalf ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div
              className="rounded-2xl p-4 space-y-3 mt-1"
              style={{
                background: 'hsl(var(--bot-bg))',
                border: '1px dashed hsl(var(--bot-border))',
              }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: 'hsl(var(--bot-primary) / 0.12)', color: 'hsl(var(--bot-primary))' }}
                >
                  <Users className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
                    Dados da pessoa atendida
                  </span>
                  <span className="text-[10px] opacity-60 leading-snug">
                    Informações complementares — você continua como solicitante.
                  </span>
                </div>
              </div>

              {/* Nome do beneficiário */}
              <div className="space-y-1.5">
                <label htmlFor="b-nome" className="text-[10px] font-semibold uppercase tracking-wider opacity-60 ml-1">
                  Nome da pessoa atendida
                </label>
                <div className="relative">
                  <UserPlus className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${bNomeTrimmed ? 'text-green-500' : touched.bNome && !bNomeTrimmed ? 'text-red-500' : 'opacity-40'}`} />
                  <input
                    id="b-nome"
                    type="text"
                    placeholder="Nome completo do beneficiário"
                    value={bNome}
                    onBlur={() => setTouched(prev => ({ ...prev, bNome: true }))}
                    onChange={(e) => setBNome(e.target.value)}
                    required={onBehalf}
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 transition-all"
                    style={{
                      background: 'hsl(var(--background))',
                      border: `1px solid ${touched.bNome && onBehalf && !bNomeTrimmed ? '#ef4444' : 'hsl(var(--bot-border))'}`,
                      '--tw-ring-color': 'hsl(var(--bot-primary))'
                    } as any}
                  />
                </div>
                {touched.bNome && onBehalf && !bNomeTrimmed && (
                  <p className="text-[10px] text-red-500 flex items-center gap-1 px-1 font-medium">
                    <AlertCircle className="w-3 h-3" /> Informe o nome da pessoa atendida
                  </p>
                )}
              </div>

              {/* Matrícula */}
              <div className="space-y-1.5">
                <label htmlFor="b-matricula" className="text-[10px] font-semibold uppercase tracking-wider opacity-60 ml-1">
                  Matrícula <span className="opacity-60 normal-case font-normal">(opcional)</span>
                </label>
                <div className="relative">
                  <IdCard className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${bMatriculaTrimmed ? 'text-green-500' : 'opacity-40'}`} />
                  <input
                    id="b-matricula"
                    type="text"
                    inputMode="numeric"
                    placeholder="Ex: 45872"
                    value={bMatricula}
                    onChange={(e) => setBMatricula(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 transition-all"
                    style={{
                      background: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--bot-border))',
                      '--tw-ring-color': 'hsl(var(--bot-primary))'
                    } as any}
                  />
                </div>
              </div>

              {/* Unidade / Setor */}
              <div className="space-y-1.5">
                <label htmlFor="b-setor" className="text-[10px] font-semibold uppercase tracking-wider opacity-60 ml-1">
                  Unidade / Setor da pessoa
                </label>
                <div className="relative">
                  <Building2 className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${bSetorTrimmed.length >= 2 ? 'text-green-500' : touched.bSetor && onBehalf && bSetorTrimmed.length < 2 ? 'text-red-500' : 'opacity-40'}`} />
                  <input
                    id="b-setor"
                    type="text"
                    placeholder="Ex: UBS Central"
                    value={bSetor}
                    onBlur={() => setTouched(prev => ({ ...prev, bSetor: true }))}
                    onChange={(e) => setBSetor(e.target.value)}
                    required={onBehalf}
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 transition-all"
                    style={{
                      background: 'hsl(var(--background))',
                      border: `1px solid ${touched.bSetor && onBehalf && bSetorTrimmed.length < 2 ? '#ef4444' : 'hsl(var(--bot-border))'}`,
                      '--tw-ring-color': 'hsl(var(--bot-primary))'
                    } as any}
                  />
                </div>
                {touched.bSetor && onBehalf && bSetorTrimmed.length < 2 && (
                  <p className="text-[10px] text-red-500 flex items-center gap-1 px-1 font-medium">
                    <AlertCircle className="w-3 h-3" /> Informe a unidade/setor
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3.5 rounded-xl text-sm font-semibold transition-all active:scale-95 border"
            style={{
              background: 'transparent',
              borderColor: 'hsl(var(--bot-border))',
              color: 'hsl(var(--bot-fg))'
            }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !isFormValid}
            className={`flex-[2] py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg ${isFormValid ? 'opacity-100 hover:brightness-110' : 'opacity-40 grayscale cursor-not-allowed'
              }`}
            style={{
              background: 'hsl(var(--bot-primary))',
              color: 'hsl(var(--bot-primary-fg))'
            }}
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4" />
                Abrir chamado
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
