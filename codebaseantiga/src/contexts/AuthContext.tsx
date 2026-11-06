import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Role = "admin" | "user" | null;

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: Role;
  roleLoading: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, cpf?: string, sector?: string, isCityHallWorker?: boolean) => Promise<string>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role>(null);
  const [roleLoading, setRoleLoading] = useState(false);

  const fetchRole = async (userId: string) => {
    setRoleLoading(true);
    try {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      setRole(data ? "admin" : "user");
    } finally {
      setRoleLoading(false);
    }
  };

  const recordSession = async (u: User) => {
    try {
      const key = `cc_session_recorded_${u.id}`;
      // Re-register at most once every 30 minutes per user/browser
      const last = Number(localStorage.getItem(key) || 0);
      if (Date.now() - last < 30 * 60 * 1000) return;
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      await supabase.from("user_sessions").insert({
        user_id: u.id,
        email: u.email ?? null,
        full_name: (meta.full_name as string) ?? (meta.name as string) ?? null,
        org_slug: (meta.org_slug as string) ?? null,
      });
      localStorage.setItem(key, String(Date.now()));
    } catch (e) {
      console.warn("[auth] failed to record session", e);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRole(session.user.id);
        if (event === "SIGNED_IN") {
          // Defer to avoid blocking auth callback
          setTimeout(() => recordSession(session.user), 0);
        }
      } else {
        setRole(null);
        setRoleLoading(false);
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRole(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data.user) await fetchRole(data.user.id);
  };

  const signUp = async (email: string, password: string, fullName: string, cpf?: string, sector?: string, isCityHallWorker?: boolean) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { 
          full_name: fullName,
          cpf: cpf,
          sector: sector,
          is_city_hall_worker: isCityHallWorker
        },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) throw error;
    return "Verifique seu email para confirmar o cadastro.";
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{
      user, session, loading,
      role, roleLoading,
      isAdmin: role === "admin",
      signIn, signUp, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
