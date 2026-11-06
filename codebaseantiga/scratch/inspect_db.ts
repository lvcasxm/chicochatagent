import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
  const slug = "chicobot";
  
  const { data: org } = await supabase.from("organizations").select("*").eq("slug", slug).single();
  console.log("--- ORGANIZATION DESCRIPTION ---");
  console.log(org?.description);

  const { data: kb } = await supabase.from("knowledge_base").select("*").eq("organization_id", org?.id);
  console.log("\n--- KNOWLEDGE BASE ---");
  kb?.forEach(k => console.log(`- ${k.title}: ${k.content}`));

  const { data: topics } = await supabase.from("topics").select("*").eq("organization_id", org?.id);
  console.log("\n--- TOPICS ---");
  topics?.forEach(t => console.log(`- [${t.type}] ${t.title}: ${t.description}`));

  const { data: flows } = await supabase.from("flows").select("*").eq("organization_id", org?.id);
  console.log("\n--- FLOWS ---");
  flows?.forEach(f => console.log(`- ${f.name}`));
}

inspect();
