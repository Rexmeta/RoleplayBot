import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Loader2, Zap, TrendingUp, Calendar, CreditCard } from "lucide-react";
import { format } from "date-fns";

interface UsageData {
  subscription: {
    id: string;
    planId: string;
    cycleStart: string;
    tokensUsedThisCycle: number;
    status: string;
  };
  plan: {
    id: string;
    name: string;
    tokenQuotaMonthly: number;
    priceUsdMonthly: number;
    features: Record<string, any>;
  };
  usage: {
    used: number;
    quota: number;
    isUnlimited: boolean;
    percentUsed: number;
    estimatedCostUsd: number;
    cycleStart: string;
  };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const PLAN_COLORS: Record<string, string> = {
  Starter: "bg-slate-100 text-slate-700 border-slate-200",
  Pro: "bg-blue-100 text-blue-700 border-blue-200",
  Enterprise: "bg-purple-100 text-purple-700 border-purple-200",
};

export function MyUsageWidget({ className }: { className?: string }) {
  const { data, isLoading, isError } = useQuery<UsageData>({
    queryKey: ["/api/subscriptions/my"],
    queryFn: async () => {
      const res = await fetch("/api/subscriptions/my", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load usage");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return null;
  }

  const { plan, usage } = data;
  const planColor = PLAN_COLORS[plan.name] ?? "bg-slate-100 text-slate-700";
  const barColor = usage.percentUsed >= 90
    ? "[&>div]:bg-red-500"
    : usage.percentUsed >= 70
    ? "[&>div]:bg-yellow-500"
    : "";

  const cycleResetDate = new Date(usage.cycleStart);
  cycleResetDate.setDate(cycleResetDate.getDate() + 30);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-blue-500" />
            My Usage
          </span>
          <Badge variant="outline" className={planColor}>
            {plan.name}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {usage.isUnlimited ? (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800">
            <Zap className="h-5 w-5 text-purple-600 flex-shrink-0" />
            <div>
              <div className="text-sm font-medium text-purple-700 dark:text-purple-300">Unlimited tokens</div>
              <div className="text-xs text-purple-500">{formatTokens(usage.used)} used this cycle</div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <Zap className="h-4 w-4 text-yellow-500" />
                Token Usage
              </span>
              <span className="text-muted-foreground">
                {formatTokens(usage.used)} / {formatTokens(usage.quota)}
              </span>
            </div>
            <Progress value={usage.percentUsed} className={`h-2.5 ${barColor}`} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{usage.percentUsed}% used</span>
              <span>{formatTokens(usage.quota - usage.used)} remaining</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/50">
            <TrendingUp className="h-4 w-4 text-green-500 mt-0.5" />
            <div>
              <div className="text-xs text-muted-foreground">Est. Cost</div>
              <div className="text-sm font-semibold">${usage.estimatedCostUsd.toFixed(4)}</div>
            </div>
          </div>
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/50">
            <Calendar className="h-4 w-4 text-blue-500 mt-0.5" />
            <div>
              <div className="text-xs text-muted-foreground">Resets</div>
              <div className="text-sm font-semibold">{format(cycleResetDate, "MMM d")}</div>
            </div>
          </div>
        </div>

        {!usage.isUnlimited && usage.percentUsed >= 80 && (
          <div className={`text-xs p-2 rounded-md ${usage.percentUsed >= 90 ? 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400' : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400'}`}>
            {usage.percentUsed >= 90
              ? "⚠️ You're close to your monthly limit. Contact your admin to upgrade."
              : "📊 You've used most of your monthly token quota."}
          </div>
        )}

        {plan.priceUsdMonthly === 0 && (
          <p className="text-xs text-muted-foreground text-center pt-1">
            On the free Starter plan. Contact your admin for an upgrade.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
