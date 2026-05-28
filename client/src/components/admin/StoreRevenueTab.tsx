import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, DollarSign, Package, ShoppingCart, CreditCard, Trash2, Search, X, History, RefreshCw } from "lucide-react";
import { authFetch, authFetchRaw } from "@/lib/authFetch";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface RevenueSummary {
  totalEntitlements: number;
  revenueUsd: number;
  byPack: { packId: string; packName: string; count: number; revenueUsd: number }[];
}

interface Entitlement {
  id: string;
  orgId: string;
  packId: string;
  unlockedAt: string;
  unlockedBy: string | null;
  stripeChargeId: string | null;
  stripeSessionId: string | null;
  pack: { name: string; priceUsd: number } | null;
}

interface AuditEntry {
  id: string;
  entitlementId: string;
  orgId: string;
  packId: string;
  packName: string;
  action: string;
  revokedBy: string | null;
  stripeRefundId: string | null;
  reason: string | null;
  revokedAt: string;
}

export function StoreRevenueTab() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [revokeTarget, setRevokeTarget] = useState<Entitlement | null>(null);
  const [issueRefund, setIssueRefund] = useState(false);

  const searchParams = new URLSearchParams(window.location.search);
  const searchQuery = searchParams.get("q") ?? "";

  function setSearchQuery(value: string) {
    const params = new URLSearchParams(window.location.search);
    if (value) {
      params.set("q", value);
    } else {
      params.delete("q");
    }
    const qs = params.toString();
    setLocation(window.location.pathname + (qs ? `?${qs}` : ""), { replace: true });
  }

  const { data: revenue, isLoading: revenueLoading } = useQuery<RevenueSummary>({
    queryKey: ["/api/store/admin/revenue"],
    queryFn: () => authFetch("/api/store/admin/revenue"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: entitlements = [], isLoading: entitlementsLoading } = useQuery<Entitlement[]>({
    queryKey: ["/api/store/entitlements"],
    queryFn: () => authFetch("/api/store/entitlements"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: auditLog = [], isLoading: auditLoading, refetch: refetchAudit } = useQuery<AuditEntry[]>({
    queryKey: ["/api/store/admin/entitlements/audit-log"],
    queryFn: () => authFetch("/api/store/admin/entitlements/audit-log"),
    staleTime: 0,
  });

  const revokeMutation = useMutation({
    mutationFn: async ({ id, refund }: { id: string; refund: boolean }) => {
      const res = await authFetchRaw(`/api/store/admin/entitlements/${id}?refund=${refund}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any)?.message ?? `Request failed (${res.status})`);
      }
      return res.json() as Promise<{ success: boolean; stripeRefundId: string | null }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/store/entitlements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/store/admin/revenue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/store/admin/entitlements/audit-log"] });
      const refundMsg = data?.stripeRefundId ? ` Stripe refund issued (${data.stripeRefundId}).` : "";
      toast({ title: "Entitlement revoked", description: `Access has been removed.${refundMsg}` });
      setRevokeTarget(null);
    },
    onError: (err: any) => {
      toast({ title: "Revoke failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const isLoading = revenueLoading || entitlementsLoading || auditLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stripeEntitlements = entitlements.filter(e => e.stripeChargeId || e.stripeSessionId);
  const manualEntitlements = entitlements.filter(e => !e.stripeChargeId && !e.stripeSessionId);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredEntitlements = normalizedQuery
    ? entitlements.filter(e =>
        e.orgId.toLowerCase().includes(normalizedQuery) ||
        (e.pack?.name ?? e.packId).toLowerCase().includes(normalizedQuery)
      )
    : entitlements;

  return (
    <>
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <DollarSign className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Revenue</p>
                  <p className="text-2xl font-bold text-green-700">${(revenue?.revenueUsd ?? 0).toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <ShoppingCart className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Stripe Purchases</p>
                  <p className="text-2xl font-bold">{stripeEntitlements.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Package className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Manual Grants</p>
                  <p className="text-2xl font-bold">{manualEntitlements.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {revenue && revenue.byPack.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue by Pack</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {revenue.byPack.map(pack => (
                  <div key={pack.packId} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                    <div>
                      <p className="font-medium text-sm">{pack.packName}</p>
                      <p className="text-xs text-muted-foreground">{pack.count} entitlement{pack.count !== 1 ? 's' : ''}</p>
                    </div>
                    <span className="font-semibold text-green-700">${pack.revenueUsd.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="text-base">All Entitlements</CardTitle>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search by org or pack…"
                  className="pl-8 pr-8 h-8 text-sm"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {entitlements.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No entitlements yet.</p>
            ) : filteredEntitlements.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No entitlements match <span className="font-mono">"{searchQuery}"</span>.
              </p>
            ) : (
              <div className="space-y-2">
                {filteredEntitlements.map(e => (
                  <div key={e.id} className="flex items-start justify-between p-3 rounded-lg border bg-muted/20 gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{e.pack?.name ?? e.packId}</span>
                        {e.stripeChargeId || e.stripeSessionId ? (
                          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-xs flex items-center gap-1">
                            <CreditCard className="h-3 w-3" /> Stripe
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Manual</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Org: {e.orgId} · {new Date(e.unlockedAt).toLocaleDateString()}
                      </p>
                      {e.stripeChargeId && (
                        <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                          Charge: {e.stripeChargeId}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-sm font-semibold text-green-700">
                        ${(e.pack?.priceUsd ?? 0).toFixed(2)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2"
                        onClick={() => {
                          setIssueRefund(false);
                          setRevokeTarget(e);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Revoke
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              Revocation History
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => refetchAudit()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {auditLog.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No revocations recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {auditLog.map(entry => (
                  <div key={entry.id} className="p-3 rounded-lg border bg-red-50/40 dark:bg-red-950/10 space-y-1">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{entry.packName}</span>
                          {entry.stripeRefundId && (
                            <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-xs flex items-center gap-1">
                              <CreditCard className="h-3 w-3" /> Refunded
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Org: <span className="font-mono">{entry.orgId}</span>
                        </p>
                        {entry.revokedBy && (
                          <p className="text-xs text-muted-foreground">
                            Revoked by: <span className="font-mono">{entry.revokedBy}</span>
                          </p>
                        )}
                        {entry.stripeRefundId && (
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            Refund ID: {entry.stripeRefundId}
                          </p>
                        )}
                        {entry.reason && (
                          <p className="text-xs text-muted-foreground italic">Reason: {entry.reason}</p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {new Date(entry.revokedAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!revokeTarget} onOpenChange={open => { if (!open) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke entitlement?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove access to{" "}
              <span className="font-semibold">{revokeTarget?.pack?.name ?? revokeTarget?.packId}</span>{" "}
              for org <span className="font-mono text-xs">{revokeTarget?.orgId}</span>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {revokeTarget?.stripeChargeId && (
            <div className="flex items-center gap-2 px-1 py-2">
              <Checkbox
                id="refund-check"
                checked={issueRefund}
                onCheckedChange={v => setIssueRefund(!!v)}
              />
              <Label htmlFor="refund-check" className="text-sm cursor-pointer">
                Also issue a Stripe refund for charge{" "}
                <span className="font-mono text-xs">{revokeTarget.stripeChargeId}</span>
              </Label>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revokeMutation.isPending}
              onClick={() => {
                if (!revokeTarget) return;
                revokeMutation.mutate({ id: revokeTarget.id, refund: issueRefund });
              }}
            >
              {revokeMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Revoking…</>
              ) : (
                issueRefund ? "Revoke & Refund" : "Revoke"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
