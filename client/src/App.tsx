import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Intro from "@/pages/intro";
import Home from "@/pages/home";
import AdminDashboard from "@/pages/admin-dashboard";
import AIGeneratorPage from "@/pages/ai-generator";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Intro} />
      <Route path="/home" component={Home} />
      <Route path="/admin" component={AdminDashboard} />
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
