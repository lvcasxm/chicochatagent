export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_response_cache: {
        Row: {
          category: string | null
          created_at: string
          hits: number
          id: string
          last_hit_at: string
          org_id: string
          prompt_hash: string
          response: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          hits?: number
          id?: string
          last_hit_at?: string
          org_id: string
          prompt_hash: string
          response: string
        }
        Update: {
          category?: string | null
          created_at?: string
          hits?: number
          id?: string
          last_hit_at?: string
          org_id?: string
          prompt_hash?: string
          response?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          category: string | null
          conversa_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          org_slug: string | null
          session_id: string
          setor: string | null
          user_id: string | null
        }
        Insert: {
          category?: string | null
          conversa_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          org_slug?: string | null
          session_id: string
          setor?: string | null
          user_id?: string | null
        }
        Update: {
          category?: string | null
          conversa_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          org_slug?: string | null
          session_id?: string
          setor?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chico_reporting_attempts: {
        Row: {
          codigo_erro: string | null
          dt_tentativa: string
          id_chamado_glpi: string | null
          id_sessao: string
          id_tentativa: string
          mensagem_erro: string | null
          sucesso: boolean
          updated_at: string
        }
        Insert: {
          codigo_erro?: string | null
          dt_tentativa: string
          id_chamado_glpi?: string | null
          id_sessao: string
          id_tentativa: string
          mensagem_erro?: string | null
          sucesso: boolean
          updated_at?: string
        }
        Update: {
          codigo_erro?: string | null
          dt_tentativa?: string
          id_chamado_glpi?: string | null
          id_sessao?: string
          id_tentativa?: string
          mensagem_erro?: string | null
          sucesso?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      chico_reporting_sessions: {
        Row: {
          dt_fim: string | null
          dt_inicio: string
          elegivel: boolean
          escalonada: boolean
          historica: boolean
          id_sessao: string
          ids_chamados_glpi: Json
          intencao: string | null
          nota: number | null
          qtd_mensagens: number
          resolvida: boolean
          teste_interno: boolean
          ultima_mensagem: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          dt_fim?: string | null
          dt_inicio: string
          elegivel?: boolean
          escalonada?: boolean
          historica?: boolean
          id_sessao: string
          ids_chamados_glpi?: Json
          intencao?: string | null
          nota?: number | null
          qtd_mensagens?: number
          resolvida?: boolean
          teste_interno?: boolean
          ultima_mensagem: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          dt_fim?: string | null
          dt_inicio?: string
          elegivel?: boolean
          escalonada?: boolean
          historica?: boolean
          id_sessao?: string
          ids_chamados_glpi?: Json
          intencao?: string | null
          nota?: number | null
          qtd_mensagens?: number
          resolvida?: boolean
          teste_interno?: boolean
          ultima_mensagem?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      chico_webhook_outbox: {
        Row: {
          attempts: number
          available_at: string
          delivered_at: string | null
          event_key: string
          evento: string
          id: string
          last_error: string | null
          locked_until: string | null
          payload: Json
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          delivered_at?: string | null
          event_key: string
          evento: string
          id?: string
          last_error?: string | null
          locked_until?: string | null
          payload: Json
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          delivered_at?: string | null
          event_key?: string
          evento?: string
          id?: string
          last_error?: string | null
          locked_until?: string | null
          payload?: Json
          updated_at?: string
        }
        Relationships: []
      }
      conversas: {
        Row: {
          created_at: string
          id: string
          org_slug: string | null
          session_id: string | null
          setor: string | null
          titulo: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_slug?: string | null
          session_id?: string | null
          setor?: string | null
          titulo?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_slug?: string | null
          session_id?: string | null
          setor?: string | null
          titulo?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      feedbacks: {
        Row: {
          conversa_id: string | null
          created_at: string
          id: string
          org_slug: string | null
          rating: number
          sugestao: string | null
          ticket_id: string | null
          user_id: string
        }
        Insert: {
          conversa_id?: string | null
          created_at?: string
          id?: string
          org_slug?: string | null
          rating: number
          sugestao?: string | null
          ticket_id?: string | null
          user_id: string
        }
        Update: {
          conversa_id?: string | null
          created_at?: string
          id?: string
          org_slug?: string | null
          rating?: number
          sugestao?: string | null
          ticket_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      flow_steps: {
        Row: {
          action: string | null
          conditions: Json | null
          created_at: string | null
          description: string | null
          flow_id: string
          id: string
          next_step_id: string | null
          responsible: string | null
          step_order: number
          title: string
        }
        Insert: {
          action?: string | null
          conditions?: Json | null
          created_at?: string | null
          description?: string | null
          flow_id: string
          id?: string
          next_step_id?: string | null
          responsible?: string | null
          step_order?: number
          title: string
        }
        Update: {
          action?: string | null
          conditions?: Json | null
          created_at?: string | null
          description?: string | null
          flow_id?: string
          id?: string
          next_step_id?: string | null
          responsible?: string | null
          step_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_steps_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_steps_next_step_id_fkey"
            columns: ["next_step_id"]
            isOneToOne: false
            referencedRelation: "flow_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          category_id: string | null
          created_at: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          category_id?: string | null
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flows_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base: {
        Row: {
          content: string | null
          created_at: string | null
          file_type: string | null
          file_url: string | null
          id: string
          organization_id: string
          title: string
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          organization_id: string
          title: string
        }
        Update: {
          content?: string | null
          created_at?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          organization_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mensagens: {
        Row: {
          conteudo: string
          conversa_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          conteudo: string
          conversa_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          conteudo?: string
          conversa_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          content_version: number
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          content_version?: number
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          content_version?: number
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      support_contacts: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          name: string
          organization_id: string
          phone: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          organization_id: string
          phone?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          organization_id?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_transcripts: {
        Row: {
          conversa_id: string | null
          created_at: string
          email: string | null
          glpi_ticket_id: string | null
          id: string
          messages: Json
          nome: string | null
          resumo: string | null
          setor: string | null
          titulo: string | null
          token: string
          user_id: string | null
        }
        Insert: {
          conversa_id?: string | null
          created_at?: string
          email?: string | null
          glpi_ticket_id?: string | null
          id?: string
          messages?: Json
          nome?: string | null
          resumo?: string | null
          setor?: string | null
          titulo?: string | null
          token: string
          user_id?: string | null
        }
        Update: {
          conversa_id?: string | null
          created_at?: string
          email?: string | null
          glpi_ticket_id?: string | null
          id?: string
          messages?: Json
          nome?: string | null
          resumo?: string | null
          setor?: string | null
          titulo?: string | null
          token?: string
          user_id?: string | null
        }
        Relationships: []
      }
      tickets: {
        Row: {
          agent_slug: string | null
          categoria: string | null
          conversa_id: string | null
          created_at: string
          email: string | null
          error_message: string | null
          glpi_ticket_id: string | null
          id: string
          ip: string | null
          motivo: string | null
          nome: string | null
          setor: string | null
          status: string
          titulo: string | null
          user_id: string | null
        }
        Insert: {
          agent_slug?: string | null
          categoria?: string | null
          conversa_id?: string | null
          created_at?: string
          email?: string | null
          error_message?: string | null
          glpi_ticket_id?: string | null
          id?: string
          ip?: string | null
          motivo?: string | null
          nome?: string | null
          setor?: string | null
          status?: string
          titulo?: string | null
          user_id?: string | null
        }
        Update: {
          agent_slug?: string | null
          categoria?: string | null
          conversa_id?: string | null
          created_at?: string
          email?: string | null
          error_message?: string | null
          glpi_ticket_id?: string | null
          id?: string
          ip?: string | null
          motivo?: string | null
          nome?: string | null
          setor?: string | null
          status?: string
          titulo?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      topics: {
        Row: {
          category_id: string | null
          created_at: string | null
          description: string | null
          id: string
          level: string
          organization_id: string
          title: string
          type: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          level?: string
          organization_id: string
          title: string
          type?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          level?: string
          organization_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          org_slug: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          org_slug?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          org_slug?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      chico_claim_webhooks: {
        Args: never
        Returns: {
          attempts: number
          available_at: string
          delivered_at: string | null
          event_key: string
          evento: string
          id: string
          last_error: string | null
          locked_until: string | null
          payload: Json
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "chico_webhook_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      chico_close_idle_sessions: { Args: never; Returns: undefined }
      chico_queue_event: {
        Args: { e: string; k: string; p: Json }
        Returns: undefined
      }
      chico_queue_session: { Args: { sid: string }; Returns: undefined }
      chico_real_it_message: { Args: { t: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
