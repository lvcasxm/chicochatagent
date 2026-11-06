import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { lovable } from "@/integrations/lovable/index";
import { LogIn, UserPlus, Mail, Lock, User, Loader2 } from "lucide-react";
import { toast } from "sonner";
import logoIconBlue from "@/assets/logo-icon-blue.png";
import logoIconWhite from "@/assets/logo-icon-white.png";

type Props = {
  isDark: boolean;
  onClose?: () => void;
};

const INSTITUTIONAL_DOMAIN = "@pedroleopoldo.mg.gov.br";
const isInstitutionalEmail = (email: string) =>
  email.trim().toLowerCase().endsWith(INSTITUTIONAL_DOMAIN);

export default function AgentAuthPanel({ isDark, onClose }: Props) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const logo = isDark ? logoIconWhite : logoIconBlue;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = (fd.get("email") as string).trim();
    const password = fd.get("password") as string;
    const fullName = ((fd.get("fullName") as string) || "").trim();

    if (!isInstitutionalEmail(email)) {
      toast.error(`Use seu e-mail institucional (${INSTITUTIONAL_DOMAIN})`);
      return;
    }
    if (mode === "register" && !fullName) {
      toast.error("Informe seu nome completo");
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        await signIn(email, password);
        toast.success("Login realizado!");
        onClose?.();
      } else {
        const msg = await signUp(email, password, fullName, undefined, undefined, true);
        toast.success(msg);
      }
    } catch (err: any) {
      toast.error(err.message || "Erro na autenticação");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.href,
        extraParams: {
          prompt: "select_account",
          hd: "pedroleopoldo.mg.gov.br",
        },
      });
      if (result.error) {
        toast.error("Erro ao entrar com Google");
      }
      if (result.redirected) return;
      toast.success("Login realizado!");
      onClose?.();
    } catch {
      toast.error("Erro ao entrar com Google");
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 max-w-sm mx-auto w-full">
      <img src={logo} alt="ChicoChat+" className="w-20 h-20 mb-4" />
      <h2 className="text-xl font-semibold font-['Velocity'] mb-2" style={{ color: 'hsl(var(--bot-fg))' }}>
        ChicoChat+
      </h2>
      <p className="text-sm mb-1 text-center" style={{ color: 'hsl(var(--bot-muted-fg))' }}>
        {mode === "login"
          ? "Entre com seu e-mail institucional"
          : "Cadastre-se com seu e-mail institucional"}
      </p>
      <p className="text-xs mb-5 text-center" style={{ color: 'hsl(var(--bot-muted-fg))' }}>
        Acesso exclusivo para servidores ({INSTITUTIONAL_DOMAIN})
      </p>

      <button
        onClick={handleGoogle}
        disabled={googleLoading}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors hover:opacity-90 mb-4"
        style={{
          border: '1px solid hsl(var(--bot-border))',
          background: 'hsl(var(--bot-card))',
          color: 'hsl(var(--bot-fg))',
        }}
      >
        {googleLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
            <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
          </svg>
        )}
        Continuar com Google
      </button>

      <div className="w-full flex items-center gap-3 mb-4">
        <div className="flex-1 h-px" style={{ background: 'hsl(var(--bot-border))' }} />
        <span className="text-xs" style={{ color: 'hsl(var(--bot-muted-fg))' }}>ou</span>
        <div className="flex-1 h-px" style={{ background: 'hsl(var(--bot-border))' }} />
      </div>

      <form onSubmit={handleSubmit} className="w-full space-y-3">
        {mode === "register" && (
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'hsl(var(--bot-muted-fg))' }} />
            <input
              name="fullName"
              placeholder="Nome completo"
              required
              className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2"
              style={{
                border: '1px solid hsl(var(--bot-border))',
                background: 'hsl(var(--bot-bg))',
                color: 'hsl(var(--bot-fg))',
                '--tw-ring-color': 'hsl(var(--bot-primary))',
              } as React.CSSProperties}
            />
          </div>
        )}
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'hsl(var(--bot-muted-fg))' }} />
          <input
            name="email"
            type="email"
            placeholder={`nome${INSTITUTIONAL_DOMAIN}`}
            required
            className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2"
            style={{
              border: '1px solid hsl(var(--bot-border))',
              background: 'hsl(var(--bot-bg))',
              color: 'hsl(var(--bot-fg))',
              '--tw-ring-color': 'hsl(var(--bot-primary))',
            } as React.CSSProperties}
          />
        </div>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'hsl(var(--bot-muted-fg))' }} />
          <input
            name="password"
            type="password"
            placeholder="Senha"
            required
            minLength={6}
            className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2"
            style={{
              border: '1px solid hsl(var(--bot-border))',
              background: 'hsl(var(--bot-bg))',
              color: 'hsl(var(--bot-fg))',
              '--tw-ring-color': 'hsl(var(--bot-primary))',
            } as React.CSSProperties}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: 'hsl(var(--bot-primary))', color: 'hsl(var(--bot-primary-fg))' }}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === "login" ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
          {mode === "login" ? "Entrar" : "Criar Conta"}
        </button>
      </form>

      <p className="text-xs mt-4" style={{ color: 'hsl(var(--bot-muted-fg))' }}>
        {mode === "login" ? "Não tem conta? " : "Já tem conta? "}
        <button
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="underline font-medium"
          style={{ color: 'hsl(var(--bot-primary))' }}
        >
          {mode === "login" ? "Cadastre-se" : "Entrar"}
        </button>
      </p>
    </div>
  );
}
