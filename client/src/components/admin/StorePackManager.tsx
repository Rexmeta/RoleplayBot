import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Plus, Pencil, Trash2, ShoppingBag, Users, BookOpen, CheckCircle, DollarSign } from "lucide-react";
import { format } from "date-fns";

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
  createdAt: string;
  updatedAt: string;
}

interface StoreEntitlement {
  id: string;
  orgId: string;
  packId: string;
  unlockedAt: string;
  unlockedBy: string | null;
  pack: StorePack | null;
}

interface Organization {
  id: string;
  name: string;
  code: string | null;
}

interface RevenueSummary {
  totalEntitlements: number;
  revenueUsd: number;
  byPack: { packId: string; packName: string; count: number; revenueUsd: number }[];
}

const PLAN_TIERS = ["starter", "pro", "enterprise"];

function PackFormDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: StorePack | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: editing?.name ?? "",
    description: editing?.description ?? "",
    priceUsd: editing?.priceUsd ?? 0,
    planTierMinimum: editing?.planTierMinimum ?? "",
    isActive: editing?.isActive ?? true,
  });

  // Sync form state whenever the dialog opens or editing target changes
  useEffect(() => {
    if (open) {
      setForm({
        name: editing?.name ?? "",
        description: editing?.description ?? "",
        priceUsd: editing?.priceUsd ?? 0,
        planTierMinimum: editing?.planTierMinimum ?? "",
        isActive: editing?.isActive ?? true,
      });
    }
  }, [open, editing?.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        description: form.description,
        priceUsd: form.priceUsd,
        planTierMinimum: form.planTierMinimum || null,
        isActive: form.isActive,
      };
      if (editing) {
        const res = await apiRequest("PUT", `/api/store/admin/packs/${editing.id}`, body);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/store/admin/packs", body);
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/store/admin/packs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/store/admin/revenue"] });
      toast({ title: editing ? "Pack updated" : "Pack created" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Pack" : "Create Pack"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Pack name" />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <AutoResizeTextarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe this pack" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Price (USD)</Label>
              <Input type="number" min="0" step="0.01" value={form.priceUsd} onChange={e => setForm(f => ({ ...f, priceUsd: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-1">
              <Label>Min Plan Tier</Label>
              <Select value={form.planTierMinimum || "none"} onValueChange={v => setForm(f => ({ ...f, planTierMinimum: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (pay per pack)</SelectItem>
                  {PLAN_TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} id="pack-active" />
            <Label htmlFor="pack-active">Active (visible in store)</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {editing ? "Save Changes" : "Create Pack"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GrantEntitlementDialog({
  open,
  onClose,
  packs,
}: {
  open: boolean;
  onClose: () => void;
  packs: StorePack[];
}) {
  const { toast } = useToast();
  const [orgId, setOrgId] = useState("");
  const [packId, setPackId] = useState("");

  const { data: orgs = [] } = useQuery<Organization[]>({
    queryKey: ["/api/admin/organizations"],
    enabled: open,
  });

  const grantMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/store/entitlements", { orgId, packId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/store/entitlements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/store/admin/revenue"] });
      toast({ title: "Entitlement granted" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Grant Entitlement</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Organization</Label>
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
              <SelectContent>
                {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}{o.code ? ` (${o.code})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Pack</Label>
            <Select value={packId} onValueChange={setPackId}>
              <SelectTrigger><SelectValue placeholder="Select pack" /></SelectTrigger>
              <SelectContent>
                {packs.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => grantMutation.mutate()} disabled={!orgId || !packId || grantMutation.isPending}>
            {grantMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Grant Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StorePackManager() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editingPack, setEditingPack] = useState<StorePack | null>(null);
  const [showGrantDialog, setShowGrantDialog] = useState(false);

  const { data: packs = [], isLoading: loadingPacks } = useQuery<StorePack[]>({
    queryKey: ["/api/store/admin/packs"],
  });

  const { data: entitlements = [], isLoading: loadingEntitlements } = useQuery<StoreEntitlement[]>({
    queryKey: ["/api/store/entitlements"],
  });

  const { data: revenue } = useQuery<RevenueSummary>({
    queryKey: ["/api/store/admin/revenue"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/store/admin/packs/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/store/admin/packs"] });
      toast({ title: "Pack deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async ({ orgId, packId }: { orgId: string; packId: string }) => {
      const res = await apiRequest("DELETE", "/api/store/entitlements", { orgId, packId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/store/entitlements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/store/admin/revenue"] });
      toast({ title: "Entitlement revoked" });
    },
  });

  return (
    <div className="space-y-6">
      {revenue && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1"><DollarSign className="h-4 w-4" /><span className="text-sm">Total Revenue</span></div>
              <div className="text-2xl font-bold">${revenue.revenueUsd.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1"><CheckCircle className="h-4 w-4" /><span className="text-sm">Entitlements</span></div>
              <div className="text-2xl font-bold">{revenue.totalEntitlements}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1"><ShoppingBag className="h-4 w-4" /><span className="text-sm">Active Packs</span></div>
              <div className="text-2xl font-bold">{packs.filter(p => p.isActive).length}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base flex items-center gap-2"><ShoppingBag className="h-4 w-4" /> Content Packs</CardTitle>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Pack
          </Button>
        </CardHeader>
        <CardContent>
          {loadingPacks ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : packs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No packs yet. Create one to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Min Tier</TableHead>
                  <TableHead>Content</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packs.map(pack => (
                  <TableRow key={pack.id}>
                    <TableCell className="font-medium">{pack.name}</TableCell>
                    <TableCell>{pack.priceUsd > 0 ? `$${pack.priceUsd.toFixed(2)}` : <Badge variant="secondary">Free</Badge>}</TableCell>
                    <TableCell>{pack.planTierMinimum ? <Badge variant="outline">{pack.planTierMinimum}+</Badge> : "—"}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 text-sm text-muted-foreground">
                        <BookOpen className="h-3 w-3" />{pack.scenarioCount}
                        <Users className="h-3 w-3 ml-1" />{pack.personaCount}
                      </span>
                    </TableCell>
                    <TableCell>
                      {pack.isActive ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground max-w-[120px] truncate">{pack.id}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditingPack(pack)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(pack.id)} className="text-destructive hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base flex items-center gap-2"><CheckCircle className="h-4 w-4" /> Entitlements</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowGrantDialog(true)}>
            <Plus className="h-4 w-4 mr-1" /> Grant Access
          </Button>
        </CardHeader>
        <CardContent>
          {loadingEntitlements ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : entitlements.length === 0 ? (
            <p className="text-center text-muted-foreground py-6">No entitlements yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pack</TableHead>
                  <TableHead>Org ID</TableHead>
                  <TableHead>Unlocked At</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entitlements.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.pack?.name ?? e.packId}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{e.orgId}</TableCell>
                    <TableCell className="text-sm">{format(new Date(e.unlockedAt), "PPP")}</TableCell>
                    <TableCell className="text-sm">{e.pack?.priceUsd ? `$${e.pack.priceUsd.toFixed(2)}` : "—"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => revokeMutation.mutate({ orgId: e.orgId, packId: e.packId })} className="text-destructive hover:text-destructive">
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {revenue && revenue.byPack.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><DollarSign className="h-4 w-4" /> Revenue by Pack</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pack</TableHead>
                  <TableHead>Units Sold</TableHead>
                  <TableHead>Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revenue.byPack.map(row => (
                  <TableRow key={row.packId}>
                    <TableCell className="font-medium">{row.packName}</TableCell>
                    <TableCell>{row.count}</TableCell>
                    <TableCell>${row.revenueUsd.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <PackFormDialog open={showCreate || !!editingPack} onClose={() => { setShowCreate(false); setEditingPack(null); }} editing={editingPack} />
      <GrantEntitlementDialog open={showGrantDialog} onClose={() => setShowGrantDialog(false)} packs={packs} />
    </div>
  );
}
