import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Loader2, Tag, RotateCcw, Eye, User, Calendar } from 'lucide-react';
import { format } from 'date-fns';

interface ScenarioVersion {
  id: string;
  scenarioId: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  contentSnapshot: Record<string, unknown>;
  evaluationHarnessSnapshot: Record<string, unknown> | null;
  publishedAt: string;
  publishedBy: string | null;
}

interface ScenarioVersionHistoryProps {
  scenarioId: string;
  scenarioTitle: string;
  open: boolean;
  onClose: () => void;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'published') return <Badge className="bg-green-600 text-white">발행됨</Badge>;
  if (status === 'archived') return <Badge variant="outline" className="text-slate-500 border-slate-300">보관됨</Badge>;
  return <Badge variant="outline" className="text-yellow-600 border-yellow-300">초안</Badge>;
}

function VersionPreviewDialog({ version, open, onClose }: { version: ScenarioVersion; open: boolean; onClose: () => void }) {
  const snap = version.contentSnapshot as any;
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            버전 v{version.version} 미리보기
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <span className="font-medium text-slate-700">제목:</span>{' '}
            <span className="text-slate-900">{snap?.title || '(없음)'}</span>
          </div>
          <div>
            <span className="font-medium text-slate-700">설명:</span>{' '}
            <span className="text-slate-600">{snap?.description || '(없음)'}</span>
          </div>
          <div>
            <span className="font-medium text-slate-700">난이도:</span>{' '}
            <span className="text-slate-600">{snap?.difficulty ?? '(없음)'}</span>
          </div>
          {snap?.context?.situation && (
            <div>
              <span className="font-medium text-slate-700">상황:</span>{' '}
              <span className="text-slate-600">{snap.context.situation}</span>
            </div>
          )}
          {snap?.objectives?.length > 0 && (
            <div>
              <span className="font-medium text-slate-700">목표:</span>
              <ul className="mt-1 list-disc list-inside text-slate-600 space-y-1">
                {snap.objectives.map((obj: string, i: number) => (
                  <li key={i}>{obj}</li>
                ))}
              </ul>
            </div>
          )}
          {snap?.personas?.length > 0 && (
            <div>
              <span className="font-medium text-slate-700">페르소나 ({snap.personas.length}명):</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {snap.personas.map((p: any, i: number) => (
                  <Badge key={i} variant="outline" className="text-xs">{p.name} — {p.position}</Badge>
                ))}
              </div>
            </div>
          )}
          {version.evaluationHarnessSnapshot && (
            <div>
              <span className="font-medium text-slate-700">평가 기준:</span>
              <pre className="mt-1 text-xs bg-slate-50 p-2 rounded overflow-x-auto border border-slate-200">
                {JSON.stringify(version.evaluationHarnessSnapshot, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ScenarioVersionHistory({ scenarioId, scenarioTitle, open, onClose }: ScenarioVersionHistoryProps) {
  const { toast } = useToast();
  const [previewVersion, setPreviewVersion] = useState<ScenarioVersion | null>(null);

  const { data: versions = [], isLoading } = useQuery<ScenarioVersion[]>({
    queryKey: ['/api/admin/scenarios', scenarioId, 'versions'],
    queryFn: async () => {
      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/admin/scenarios/${scenarioId}/versions`, { headers, credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load versions');
      return res.json();
    },
    enabled: open && !!scenarioId,
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/admin/scenarios/${scenarioId}/publish`, {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios', scenarioId, 'versions'] });
      toast({ title: `v${data.version} 버전 발행 완료`, description: '현재 시나리오 내용이 새 버전으로 저장되었습니다.' });
    },
    onError: () => {
      toast({ title: '발행 실패', description: '버전 스냅샷을 생성하지 못했습니다.', variant: 'destructive' });
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: async (versionId: string) => {
      const res = await apiRequest('POST', `/api/admin/scenarios/${scenarioId}/versions/${versionId}/rollback`, {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios', scenarioId, 'versions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
      toast({ title: `v${data.version} 롤백 완료`, description: '선택한 버전으로 시나리오가 복원되었습니다.' });
    },
    onError: () => {
      toast({ title: '롤백 실패', description: '버전 롤백에 실패했습니다.', variant: 'destructive' });
    },
  });

  return (
    <>
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5 text-indigo-600" />
              버전 이력 — {scenarioTitle}
            </DialogTitle>
          </DialogHeader>

          <div className="flex justify-end mb-2">
            <Button
              size="sm"
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {publishMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Tag className="w-4 h-4 mr-1" />}
              현재 버전 발행
            </Button>
          </div>

          <div className="overflow-y-auto flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
              </div>
            ) : versions.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Tag className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">아직 발행된 버전이 없습니다.</p>
                <p className="text-xs mt-1">위의 "현재 버전 발행" 버튼을 눌러 첫 번째 스냅샷을 저장하세요.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {versions.map((ver, idx) => (
                  <div
                    key={ver.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${idx === 0 ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200'}`}
                  >
                    <div className="flex items-center justify-center w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm shrink-0">
                      v{ver.version}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={ver.status} />
                        {idx === 0 && <Badge className="bg-indigo-600 text-white text-[10px] px-1.5 py-0">최신</Badge>}
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(ver.publishedAt), 'yyyy-MM-dd HH:mm')}
                        </span>
                        {ver.publishedBy && (
                          <span className="text-xs text-slate-400 flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {ver.publishedBy}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-slate-600 hover:text-indigo-700"
                        onClick={() => setPreviewVersion(ver)}
                        title="이 버전 미리보기"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {idx !== 0 && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-slate-600 hover:text-amber-700"
                              title="이 버전으로 롤백"
                              disabled={rollbackMutation.isPending}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>v{ver.version}으로 롤백</AlertDialogTitle>
                              <AlertDialogDescription>
                                이 버전의 내용으로 시나리오가 복원되고, 새 버전(v{versions[0].version + 1})으로 저장됩니다.
                                현재 작업 중인 내용은 덮어씌워집니다.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>취소</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => rollbackMutation.mutate(ver.id)}
                                className="bg-amber-600 hover:bg-amber-700"
                              >
                                롤백 실행
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {previewVersion && (
        <VersionPreviewDialog
          version={previewVersion}
          open={!!previewVersion}
          onClose={() => setPreviewVersion(null)}
        />
      )}
    </>
  );
}
