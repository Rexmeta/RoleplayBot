import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, DollarSign, Package, ShoppingCart, CreditCard } from "lucide-react";
import { authFetch } from "@/lib/authFetch";

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

export function StoreRevenueTab() {
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

  const isLoading = revenueLoading || entitlementsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stripeEntitlements = entitlements.filter(e => e.stripeChargeId || e.stripeSessionId);
  const manualEntitlements = entitlements.filter(e => !e.stripeChargeId && !e.stripeSessionId);

  return (
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
          <CardTitle className="text-base">All Entitlements</CardTitle>
        </CardHeader>
        <CardContent>
          {entitlements.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No entitlements yet.</p>
          ) : (
            <div className="space-y-2">
              {entitlements.map(e => (
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
                  <div className="text-right flex-shrink-0">
                    <span className="text-sm font-semibold text-green-700">
                      ${(e.pack?.priceUsd ?? 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
