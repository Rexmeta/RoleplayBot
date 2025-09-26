import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Intro from "@/pages/intro";
import Home from "@/pages/home";
import MyPage from "@/pages/MyPage";
import AdminDashboard from "@/pages/admin-dashboard";
import AdminManagement from "@/pages/admin-management";
import AIGeneratorPage from "@/pages/ai-generator";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Intro} />
      <Route path="/home" component={Home} />
      <Route path="/mypage" component={MyPage} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin-dashboard" component={AdminDashboard} />
      <Route path="/admin-management" component={AdminManagement} />
      <Route path="/ai-generator" component={AIGeneratorPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
