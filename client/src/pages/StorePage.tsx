import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Search, ShoppingBag, Library, Lock, CheckCircle, Star, Users, BookOpen, DollarSign, CreditCard } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toMediaUrl } from "@/lib/mediaUrl";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface StorePack {
  id: string;
  name: string;
  description: string;
  coverImageKey: string | null;
  priceUsd: number;
  planTierMinimum: string | null;
  isActive: boolean;
  scenarioCount: number;
  personaCount: number;
  isEntitled: boolean;
  unlockedAt?: string | null;
}

interface PackDetail extends StorePack {
  scenarios: { id: string; title: string; description: string; difficulty: number; image: string | null; estimatedTime: string | null }[];
  personas: { id: string; mbti: string; gender: string; communicationStyle: string | null }[];
}

const TIER_ORDER = ["bronze", "silver", "gold", "platinum", "diamond"];
const TIER_LABELS: Record<string, string> = {
  bronze: "Bronze+", silver: "Silver+", gold: "Gold+", platinum: "Platinum+", diamond: "Diamond",
};
const DIFFICULTY_LABELS: Record<number, string> = {
  1: "Beginner", 2: "Easy", 3: "Intermediate", 4: "Advanced",
};

function DifficultyBadge({ level }: { level: number }) {
  const colors: Record<number, string> = {
    1: "bg-green-100 text-green-700", 2: "bg-blue-100 text-blue-700",
    3: "bg-yellow-100 text-yellow-700", 4: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[level] ?? "bg-gray-100 text-gray-600"}`}>
      {DIFFICULTY_LABELS[level] ?? `Level ${level}`}
    </span>
  );
}

function PackCard({ pack, onClick }: { pack: StorePack; onClick: () => void }) {
  const coverUrl = pack.coverImageKey ? toMediaUrl(pack.coverImageKey) : null;

  return (
    <Card
      className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow border"
      onClick={onClick}
    >
      <div className="relative h-40 bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        {coverUrl ? (
          <img src={coverUrl} alt={pack.name} className="w-full h-full object-cover" />
        ) : (
          <ShoppingBag className="h-12 w-12 text-indigo-300" />
        )}
        {pack.isEntitled && (
          <div className="absolute top-2 right-2 bg-green-500 text-white text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />
            Unlocked
          </div>
        )}
      </div>
      <CardContent className="pt-4 space-y-3">
        <div>
          <h3 className="font-semibold text-base leading-tight line-clamp-1">{pack.name}</h3>
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{pack.description}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><BookOpen className="h-3 w-3" />{pack.scenarioCount} scenarios</span>
          <span>·</span>
          <span className="flex items-center gap-1"><Users className="h-3 w-3" />{pack.personaCount} personas</span>
        </div>
        <div className="flex items-center justify-between">
          {pack.planTierMinimum ? (
            <Badge variant="outline" className="text-xs border-purple-300 text-purple-700">
              {TIER_LABELS[pack.planTierMinimum] ?? pack.planTierMinimum} plan
            </Badge>
          ) : pack.priceUsd > 0 ? (
            <span className="text-sm font-semibold text-green-700">${pack.priceUsd.toFixed(2)}</span>
          ) : (
            <Badge variant="secondary" className="text-xs">Free</Badge>
          )}
          {pack.isEntitled ? (
            <span className="text-xs text-green-600 font-medium">In your library</span>
          ) : pack.priceUsd > 0 && !pack.planTierMinimum ? (
            <span className="text-xs text-blue-600 font-medium flex items-center gap-1"><CreditCard className="h-3 w-3" /> Buy Now</span>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs">View Pack</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function BuyNowButton({ packId, packName }: { packId: string; packName: string }) {
  const { toast } = useToast();
  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const resp = await apiRequest("POST", `/api/store/packs/${packId}/checkout`);
      return resp.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (err: any) => {
      toast({
        title: "Checkout failed",
        description: err?.message ?? "Could not start checkout. Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <Button
      onClick={() => checkoutMutation.mutate()}
      disabled={checkoutMutation.isPending}
      className="bg-green-600 hover:bg-green-700 text-white"
    >
      {checkoutMutation.isPending ? (
        <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Processing...</>
      ) : (
        <><CreditCard className="h-4 w-4 mr-2" /> Buy Now</>
      )}
    </Button>
  );
}

function PackDetailDrawer({ packId, open, onClose }: { packId: string; open: boolean; onClose: () => void }) {
  const { data: pack, isLoading } = useQuery<PackDetail>({
    queryKey: ["/api/store/packs", packId],
    enabled: open && !!packId,
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : pack ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">{pack.name}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">{pack.description}</p>
            </DialogHeader>

            <div className="space-y-6 mt-4">
              <div className="flex items-center gap-4 flex-wrap">
                {pack.planTierMinimum ? (
                  <Badge variant="outline" className="border-purple-300 text-purple-700">
                    {TIER_LABELS[pack.planTierMinimum] ?? pack.planTierMinimum} plan required
                  </Badge>
                ) : pack.priceUsd > 0 ? (
                  <span className="text-lg font-bold text-green-700">${pack.priceUsd.toFixed(2)}</span>
                ) : (
                  <Badge variant="secondary">Free</Badge>
                )}
                {pack.isEntitled ? (
                  <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                    <CheckCircle className="h-3 w-3 mr-1" /> Unlocked
                  </Badge>
                ) : pack.priceUsd > 0 && !pack.planTierMinimum ? (
                  <BuyNowButton packId={pack.id} packName={pack.name} />
                ) : (
                  <Badge variant="outline" className="border-orange-300 text-orange-700">
                    <Lock className="h-3 w-3 mr-1" /> Contact admin to unlock
                  </Badge>
                )}
              </div>

              {pack.scenarios.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <BookOpen className="h-4 w-4" /> Included Scenarios ({pack.scenarios.length})
                  </h4>
                  <div className="space-y-2">
                    {pack.scenarios.map(s => (
                      <div key={s.id} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                        {s.image && (
                          <img src={toMediaUrl(s.image)} alt={s.title} className="w-12 h-12 object-cover rounded flex-shrink-0" onError={e => (e.currentTarget.style.display = "none")} />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{s.title}</span>
                            <DifficultyBadge level={s.difficulty} />
                            {s.estimatedTime && <span className="text-xs text-muted-foreground">{s.estimatedTime}</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pack.personas.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <Users className="h-4 w-4" /> Included Personas ({pack.personas.length})
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {pack.personas.map(p => (
                      <div key={p.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-muted/30 text-sm">
                        <Badge variant="outline" className="text-xs font-mono">{p.mbti}</Badge>
                        <span className="capitalize text-muted-foreground">{p.gender}</span>
                        {p.communicationStyle && (
                          <span className="text-xs text-muted-foreground line-clamp-1 max-w-[120px]">{p.communicationStyle}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!pack.isEntitled && (
                pack.priceUsd > 0 && !pack.planTierMinimum ? (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                    <p className="font-medium">Purchase this pack</p>
                    <p className="mt-1 text-green-700">Click <strong>Buy Now</strong> above to purchase this pack for your organization via Stripe. Access is granted instantly after payment.</p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
                    <p className="font-medium">Want access to this pack?</p>
                    <p className="mt-1 text-orange-700">Contact your system administrator to unlock this content pack for your organization.</p>
                  </div>
                )
              )}
            </div>
          </>
        ) : (
          <p className="text-center text-muted-foreground py-8">Pack not found</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LibraryTab() {
  const { data: library = [], isLoading } = useQuery<(StorePack & { unlockedAt: string | null })[]>({
    queryKey: ["/api/store/my-library"],
  });

  const unlocked = library.filter(p => p.isEntitled);
  const available = library.filter(p => !p.isEntitled);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {unlocked.length > 0 && (
        <div>
          <h3 className="font-semibold mb-4 flex items-center gap-2 text-green-700">
            <CheckCircle className="h-5 w-5" /> Unlocked Packs ({unlocked.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {unlocked.map(pack => (
              <Card key={pack.id} className="border-green-200 bg-green-50/30">
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-medium text-sm">{pack.name}</h4>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{pack.description}</p>
                    </div>
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                  </div>
                  <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                    <span>{pack.scenarioCount} scenarios</span>
                    <span>·</span>
                    <span>{pack.personaCount} personas</span>
                  </div>
                  {pack.unlockedAt && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Unlocked {new Date(pack.unlockedAt).toLocaleDateString()}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {available.length > 0 && (
        <div>
          <h3 className="font-semibold mb-4 flex items-center gap-2 text-muted-foreground">
            <Lock className="h-5 w-5" /> Available to Unlock ({available.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {available.map(pack => (
              <Card key={pack.id} className="opacity-60 border-dashed">
                <CardContent className="pt-4">
                  <h4 className="font-medium text-sm">{pack.name}</h4>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{pack.description}</p>
                  <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                    <span>{pack.scenarioCount} scenarios</span>
                    <span>·</span>
                    <span>{pack.personaCount} personas</span>
                  </div>
                  <p className="text-xs text-orange-600 mt-2">Contact admin to unlock</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {unlocked.length === 0 && available.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Library className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No content packs available yet.</p>
        </div>
      )}
    </div>
  );
}

export default function StorePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [location] = useLocation();
  const [search, setSearch] = useState("");
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);

  const { data: packs = [], isLoading } = useQuery<StorePack[]>({
    queryKey: ["/api/store/packs"],
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    if (payment === "success") {
      toast({ title: "Payment successful!", description: "Your pack is now unlocked. It may take a moment to appear in your library." });
      queryClient.invalidateQueries({ queryKey: ["/api/store/packs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/store/my-library"] });
      window.history.replaceState({}, "", "/store");
    } else if (payment === "cancelled") {
      toast({ title: "Payment cancelled", description: "Your purchase was not completed.", variant: "destructive" });
      window.history.replaceState({}, "", "/store");
    }
  }, []);

  const filtered = packs.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <ShoppingBag className="h-8 w-8 text-primary" />
            Content Store
          </h1>
          <p className="text-muted-foreground mt-2">Browse and unlock scenario and persona packs for your organization</p>
        </div>

        <Tabs defaultValue="catalog">
          <TabsList className="mb-6">
            <TabsTrigger value="catalog" className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" /> Catalog
            </TabsTrigger>
            <TabsTrigger value="library" className="flex items-center gap-2">
              <Library className="h-4 w-4" /> My Library
            </TabsTrigger>
          </TabsList>

          <TabsContent value="catalog" className="space-y-6">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search packs..."
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <ShoppingBag className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No packs found</p>
                <p className="text-sm mt-1">{search ? "Try a different search term." : "No content packs are available yet."}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {filtered.map(pack => (
                  <PackCard key={pack.id} pack={pack} onClick={() => setSelectedPackId(pack.id)} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="library">
            <LibraryTab />
          </TabsContent>
        </Tabs>
      </div>

      <PackDetailDrawer
        packId={selectedPackId ?? ""}
        open={!!selectedPackId}
        onClose={() => setSelectedPackId(null)}
      />
    </div>
  );
}
