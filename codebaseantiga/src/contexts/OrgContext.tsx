import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";
import type { Organization } from "@/types/database";

type OrgContextType = {
  selectedOrg: string | null;
  setSelectedOrg: (id: string | null) => void;
  organizations: Organization[];
  currentOrg: Organization | null;
  loading: boolean;
};

const OrgContext = createContext<OrgContextType>({} as OrgContextType);

export const useOrg = () => useContext(OrgContext);

export const OrgProvider = ({ children }: { children: ReactNode }) => {
  const { user, isAdmin, roleLoading } = useAuth();
  const [selectedOrg, setSelectedOrg] = useState<string | null>(
    localStorage.getItem("selectedOrg")
  );

  const { data: organizations = [], isLoading } = useQuery({
    queryKey: ["organizations", user?.id, isAdmin],
    queryFn: async () => {
      let query = supabase
        .from("organizations")
        .select("*")
        .order("created_at");

      if (!isAdmin) {
        query = query.eq("created_by", user!.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Organization[];
    },
    enabled: !!user && !roleLoading,
  });

  useEffect(() => {
    if (selectedOrg) localStorage.setItem("selectedOrg", selectedOrg);
  }, [selectedOrg]);

  useEffect(() => {
    if (organizations.length === 0) return;
    if (!selectedOrg || !organizations.find((o) => o.id === selectedOrg)) {
      setSelectedOrg(organizations[0].id);
    }
  }, [organizations, selectedOrg]);

  const currentOrg = organizations.find((o) => o.id === selectedOrg) ?? null;

  return (
    <OrgContext.Provider value={{ selectedOrg, setSelectedOrg, organizations, currentOrg, loading: isLoading }}>
      {children}
    </OrgContext.Provider>
  );
};
