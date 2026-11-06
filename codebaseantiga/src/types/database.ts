export type Organization = {
  id: string;
  name: string;
  description: string;
  slug: string;
  created_by: string | null;
  created_at: string;
};

export type Category = {
  id: string;
  name: string;
  description: string;
  organization_id: string;
  created_at: string;
};

export type Topic = {
  id: string;
  title: string;
  description: string;
  category_id: string | null;
  type: string;
  level: string;
  organization_id: string;
  created_at: string;
};

export type Flow = {
  id: string;
  name: string;
  category_id: string | null;
  organization_id: string;
  created_at: string;
};

export type FlowStep = {
  id: string;
  flow_id: string;
  title: string;
  description: string;
  action: string;
  responsible: string;
  step_order: number;
  next_step_id: string | null;
  conditions: any;
  created_at: string;
};

export type KnowledgeItem = {
  id: string;
  organization_id: string;
  title: string;
  file_url: string | null;
  file_type: string | null;
  content: string;
  created_at: string;
};

export type SupportContact = {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  phone: string;
  created_at: string;
};
