import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import Auth from "./pages/Auth";
import AdminLayout from "./pages/admin/AdminLayout";
import Dashboard from "./pages/admin/Dashboard";
import Analytics from "./pages/admin/Analytics";
import Conversas from "./pages/admin/Conversas";
import Organizations from "./pages/admin/Organizations";
import Categories from "./pages/admin/Categories";
import Topics from "./pages/admin/Topics";
import Flows from "./pages/admin/Flows";
import KnowledgeBase from "./pages/admin/KnowledgeBase";
import Contacts from "./pages/admin/Contacts";
import GenerateAgent from "./pages/admin/GenerateAgent";
import AgentChat from "./pages/agent/AgentChat";
import ConversationTranscript from "./pages/ConversationTranscript";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<AgentChat />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="conversas" element={<Conversas />} />
              <Route path="organizations" element={<Organizations />} />
              <Route path="categories" element={<Categories />} />
              <Route path="topics" element={<Topics />} />
              <Route path="flows" element={<Flows />} />
              <Route path="knowledge" element={<KnowledgeBase />} />
              <Route path="contacts" element={<Contacts />} />
              <Route path="generate" element={<GenerateAgent />} />
            </Route>
            <Route path="/agent/:slug" element={<AgentChat />} />
            <Route path="/conversa/:token" element={<ConversationTranscript />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
