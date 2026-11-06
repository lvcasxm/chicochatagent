import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import logoVerticalDark from "@/assets/logo-vertical-dark.png";
import { toast } from "sonner";
import { lovable } from "@/integrations/lovable/index";
import { Loader2, User, Mail, Lock } from "lucide-react";

const INSTITUTIONAL_DOMAIN = "@pedroleopoldo.mg.gov.br";

const isInstitutionalEmail = (email: string) =>
  email.trim().toLowerCase().endsWith(INSTITUTIONAL_DOMAIN);

const Auth = () => {
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get("tab") || "login";
  const redirectTo = searchParams.get("redirect") || null;
  const navigate = useNavigate();
  const { signIn, signUp, user, loading: authLoading, role, roleLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !roleLoading && user && role !== null) {
      navigate(redirectTo || "/agent/chicobot");
    }
  }, [user, authLoading, roleLoading, role, navigate, redirectTo]);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = (fd.get("email") as string).trim();
    const password = fd.get("password") as string;

    if (!isInstitutionalEmail(email)) {
      toast.error(`Use seu e-mail institucional (${INSTITUTIONAL_DOMAIN})`);
      return;
    }

    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err: any) {
      toast.error(err.message || "Erro ao fazer login");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = (fd.get("email") as string).trim();
    const password = fd.get("password") as string;
    const fullName = (fd.get("fullName") as string).trim();

    if (!fullName) {
      toast.error("Informe seu nome completo");
      return;
    }
    if (!isInstitutionalEmail(email)) {
      toast.error(`Cadastro permitido apenas com e-mail institucional (${INSTITUTIONAL_DOMAIN})`);
      return;
    }

    setLoading(true);
    try {
      const msg = await signUp(email, password, fullName, undefined, undefined, true);
      toast.success(msg);
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar conta");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + (redirectTo || ""),
        extraParams: {
          prompt: "select_account",
          hd: "pedroleopoldo.mg.gov.br",
        },
      });
      if (error) throw error;
    } catch (err: any) {
      toast.error(err.message || "Erro ao entrar com Google");
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-lg border-none sm:border bg-card/50 backdrop-blur-sm">
        <CardHeader className="text-center pb-2">
          <img src={logoVerticalDark} alt="ChicoChat+" className="w-36 mx-auto mb-4" />
          <CardTitle className="font-montserrat text-xl font-semibold text-foreground">
            Acesso exclusivo para servidores da Prefeitura de Pedro Leopoldo
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            Use seu e-mail institucional <span className="font-medium">{INSTITUTIONAL_DOMAIN}</span>
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <Button
            variant="outline"
            className="w-full py-6 rounded-xl flex items-center justify-center gap-3 transition-all hover:bg-black/5 dark:hover:bg-white/5"
            onClick={handleGoogle}
            disabled={googleLoading || loading}
          >
            {googleLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
                <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
                <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
                <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
              </svg>
            )}
            Continuar com Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">ou entre com email</span>
            </div>
          </div>

          <Tabs defaultValue={defaultTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="register">Cadastre-se</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4 mt-4 text-left">
                <div className="space-y-2">
                  <Label htmlFor="login-email">E-mail institucional</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
                    <Input
                      id="login-email"
                      name="email"
                      type="email"
                      placeholder={`nome${INSTITUTIONAL_DOMAIN}`}
                      required
                      className="rounded-xl h-12 pl-10"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-pass">Senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
                    <Input
                      id="login-pass"
                      name="password"
                      type="password"
                      placeholder="Sua senha"
                      required
                      className="rounded-xl h-12 pl-10"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full h-12 rounded-xl text-md font-medium mt-2" disabled={loading || googleLoading}>
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Entrar"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="register">
              <div className="text-center mt-4 mb-3">
                <p className="text-sm font-medium text-foreground">
                  Cadastre-se com seu e-mail institucional
                </p>
              </div>
              <form onSubmit={handleRegister} className="space-y-4 text-left">
                <div className="space-y-2">
                  <Label htmlFor="reg-name">Nome completo</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
                    <Input id="reg-name" name="fullName" placeholder="Seu nome completo" required className="rounded-xl h-12 pl-10" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-email">E-mail institucional</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
                    <Input
                      id="reg-email"
                      name="email"
                      type="email"
                      placeholder={`nome${INSTITUTIONAL_DOMAIN}`}
                      required
                      className="rounded-xl h-12 pl-10"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-pass">Senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
                    <Input
                      id="reg-pass"
                      name="password"
                      type="password"
                      placeholder="Mínimo 6 caracteres"
                      required
                      minLength={6}
                      className="rounded-xl h-12 pl-10"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full h-12 rounded-xl text-md font-medium mt-2" disabled={loading || googleLoading}>
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Criar Conta"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
