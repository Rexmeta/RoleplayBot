import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, CreditCard, Users, Zap, DollarSign, RefreshCw, Pencil, CheckCircle, Building2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface Plan {
  id: string;
  name: string;
  tokenQuotaMonthly: number;
  priceUsdMonthly: number;
  features: Record<string, any>;
  isActive: boolean;
}

interface SubscriptionRow {
  id: string;
  user: { id: string; email: string; name: string; isOrg?: boolean };
  orgId: string | null;
  userId: string | null;
  isOrgSubscription: boolean;
  plan: { id: string; name: string; tokenQuotaMonthly: number; priceUsdMonthly: number } | null;
  cycleStart: string;
  status: string;
  usage: {
    used: number;
    quota: number;
    isUnlimited: boolean;
    percentUsed: number;
    estimatedCostUsd: number;
  };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function PlanCard({ plan, onEdit }: { plan: Plan; onEdit: (plan: Plan) => void }) {
  const isUnlimited = plan.tokenQuotaMonthly === -1;
  return (
    <Card className={`relative ${!plan.isActive ? 'opacity-60' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-blue-600" />
            {plan.name}
          </CardTitle>
          <div className="flex items-center gap-2">
            {!plan.isActive && <Badge variant="secondary">Inactive</Badge>}
            <Button variant="ghost" size="sm" onClick={() => onEdit(plan)}>
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-1">
          <span className="text-3xl font-bold">${plan.priceUsdMonthly}</span>
          <span className="text-sm text-muted-foreground mb-1">/month</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Zap className="h-4 w-4 text-yellow-500" />
          <span className="font-medium">
            {isUnlimited ? "Unlimited tokens" : `${formatTokens(plan.tokenQuotaMonthly)} tokens/mo`}
          </span>
        </div>
        {plan.features && Object.keys(plan.features).length > 0 && (
          <ul className="space-y-1">
            {Object.entries(plan.features).map(([key, val]) => (
              <li key={key} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                <span>{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}: {String(val === -1 ? 'Unlimited' : val)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function PlansBillingTab() {
  const { toast } = useToast();
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [editTokens, setEditTokens] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editHrAnalytics, setEditHrAnalytics] = useState(false);
  const [assignDialog, setAssignDialog] = useState<SubscriptionRow | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");

  const { data: plans = [], isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ["/api/subscriptions/plans"],
    queryFn: async () => {
      const res = await fetch("/api/subscriptions/plans", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load plans");
      return res.json();
    },
  });

  const { data: subscriptions = [], isLoading: subsLoading, refetch: refetchSubs } = useQuery<SubscriptionRow[]>({
    queryKey: ["/api/subscriptions"],
    queryFn: async () => {
      const res = await fetch("/api/subscriptions", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load subscriptions");
      return res.json();
    },
  });

  const updatePlanMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await apiRequest("PUT", `/api/system-admin/plans/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/plans"] });
      setEditingPlan(null);
      toast({ title: "Plan updated" });
    },
    onError: (err: Error) => toast({ title: "Failed to update plan", description: err.message, variant: "destructive" }),
  });

  const assignPlanMutation = useMutation({
    mutationFn: async ({ subscriptionId, planId }: { subscriptionId: string; planId: string }) => {
      const res = await apiRequest("PATCH", `/api/subscriptions/${subscriptionId}/plan`, { planId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      setAssignDialog(null);
      toast({ title: "Plan reassigned successfully" });
    },
    onError: (err: Error) => toast({ title: "Failed to reassign plan", description: err.message, variant: "destructive" }),
  });

  const handleEditSave = () => {
    if (!editingPlan) return;
    const updates: any = {};
    const tokenVal = parseInt(editTokens);
    const priceVal = parseFloat(editPrice);
    if (!isNaN(tokenVal)) updates.tokenQuotaMonthly = tokenVal;
    if (!isNaN(priceVal)) updates.priceUsdMonthly = priceVal;
    const existingFeatures = editingPlan.features || {};
    updates.features = { ...existingFeatures, hr_analytics: editHrAnalytics };
    updatePlanMutation.mutate({ id: editingPlan.id, updates });
  };

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setEditTokens(plan.tokenQuotaMonthly === -1 ? "-1" : String(plan.tokenQuotaMonthly));
    setEditPrice(String(plan.priceUsdMonthly));
    setEditHrAnalytics(!!(plan.features as Record<string, any>)?.hr_analytics);
  };

  const totalRevenue = subscriptions.reduce((acc, s) => acc + (s.plan?.priceUsdMonthly ?? 0), 0);
  const totalTokensUsed = subscriptions.reduce((acc, s) => acc + s.usage.used, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{subscriptions.length}</div>
                <div className="text-sm text-muted-foreground">Active Subscriptions</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-green-500" />
              <div>
                <div className="text-2xl font-bold">${totalRevenue.toFixed(0)}</div>
                <div className="text-sm text-muted-foreground">MRR (estimated)</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Zap className="h-8 w-8 text-yellow-500" />
              <div>
                <div className="text-2xl font-bold">{formatTokens(totalTokensUsed)}</div>
                <div className="text-sm text-muted-foreground">Tokens used this cycle</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Plan Catalog
        </h3>
        {plansLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {plans.map(plan => (
              <PlanCard key={plan.id} plan={plan} onEdit={openEdit} />
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Active Subscriptions
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => refetchSubs()} disabled={subsLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${subsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {subsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : subscriptions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No subscriptions yet</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subscriber</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Cycle Start</TableHead>
                  <TableHead>Token Usage</TableHead>
                  <TableHead className="text-right">Est. Cost</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map(sub => (
                  <TableRow key={sub.id}>
                    <TableCell>
                      <div className="font-medium text-sm flex items-center gap-1">
                        {sub.isOrgSubscription
                          ? <Building2 className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" />
                          : <Users className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />}
                        {sub.user.name}
                      </div>
                      {!sub.isOrgSubscription && sub.user.email && (
                        <div className="text-xs text-muted-foreground pl-5">{sub.user.email}</div>
                      )}
                      {sub.isOrgSubscription && sub.orgId && (
                        <div className="text-xs text-muted-foreground pl-5">org: {sub.orgId.substring(0, 8)}…</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={sub.isOrgSubscription
                        ? "text-purple-600 border-purple-200 bg-purple-50"
                        : "text-blue-600 border-blue-200 bg-blue-50"}>
                        {sub.isOrgSubscription ? "Organization" : "User"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50">
                        {sub.plan?.name ?? "No Plan"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {sub.cycleStart ? format(new Date(sub.cycleStart), "MMM d, yyyy") : "—"}
                    </TableCell>
                    <TableCell className="min-w-[180px]">
                      {sub.usage.isUnlimited ? (
                        <span className="text-sm text-muted-foreground">Unlimited</span>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{formatTokens(sub.usage.used)}</span>
                            <span>{sub.usage.percentUsed}%</span>
                          </div>
                          <Progress value={sub.usage.percentUsed} className={`h-2 ${sub.usage.percentUsed >= 90 ? '[&>div]:bg-red-500' : sub.usage.percentUsed >= 70 ? '[&>div]:bg-yellow-500' : ''}`} />
                          <div className="text-xs text-muted-foreground">{formatTokens(sub.usage.quota)} quota</div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      ${sub.usage.estimatedCostUsd.toFixed(4)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={sub.status === "active" ? "default" : "secondary"} className={sub.status === "active" ? "bg-green-100 text-green-700 border-green-200" : ""}>
                        {sub.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => { setAssignDialog(sub); setSelectedPlanId(sub.plan?.id ?? ""); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingPlan} onOpenChange={open => !open && setEditingPlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Plan: {editingPlan?.name}</DialogTitle>
            <DialogDescription>Update the token quota, price, and feature flags for this plan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Monthly Token Quota (-1 for unlimited)</label>
              <Input value={editTokens} onChange={e => setEditTokens(e.target.value)} placeholder="-1 for unlimited" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Price (USD/month)</label>
              <Input value={editPrice} onChange={e => setEditPrice(e.target.value)} type="number" min="0" step="0.01" />
            </div>
            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Feature Flags</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">HR Team Analytics</p>
                  <p className="text-xs text-muted-foreground">Enables /analytics/hr dashboard for orgs on this plan</p>
                </div>
                <Switch checked={editHrAnalytics} onCheckedChange={setEditHrAnalytics} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPlan(null)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={updatePlanMutation.isPending}>
              {updatePlanMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignDialog} onOpenChange={open => !open && setAssignDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign Plan</DialogTitle>
            <DialogDescription>
              Change the plan for {assignDialog?.user.name} ({assignDialog?.user.email}).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
              <SelectTrigger><SelectValue placeholder="Select a plan" /></SelectTrigger>
              <SelectContent>
                {plans.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {p.tokenQuotaMonthly === -1 ? "Unlimited" : formatTokens(p.tokenQuotaMonthly)} tokens / ${p.priceUsdMonthly}/mo
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialog(null)}>Cancel</Button>
            <Button
              onClick={() => assignDialog && selectedPlanId && assignPlanMutation.mutate({ subscriptionId: assignDialog.id, planId: selectedPlanId })}
              disabled={assignPlanMutation.isPending || !selectedPlanId}
            >
              {assignPlanMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reassign Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
