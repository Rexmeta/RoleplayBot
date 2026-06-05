import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Upload, RotateCcw, Video } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import { toMediaUrl } from '@/lib/mediaUrl';

interface DefaultVideoInfo {
  hasCustomVideo: boolean;
  url: string;
  storagePath?: string;
}

export function DefaultIntroVideoManager() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: videoInfo, refetch } = useQuery<DefaultVideoInfo>({
    queryKey: ['/api/admin/default-intro-video'],
    queryFn: async () => {
      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/default-intro-video', { headers, credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch default video info');
      return res.json();
    },
  });

  const handleUpload = async (file: File) => {
    const validTypes = ['video/webm', 'video/mp4'];
    if (!validTypes.includes(file.type)) {
      toast({
        title: '지원하지 않는 형식',
        description: 'WebM 또는 MP4 형식의 비디오 파일만 업로드할 수 있습니다.',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    try {
      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = { 'Content-Type': file.type };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/admin/default-intro-video', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: file,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || '업로드 실패');
      }

      toast({
        title: '기본 비디오 업로드 완료',
        description: '기본 인트로 비디오가 성공적으로 교체되었습니다.',
      });
      refetch();
      queryClient.invalidateQueries({ queryKey: ['/api/media/default-intro-video'] });
    } catch (error: any) {
      toast({
        title: '업로드 실패',
        description: error.message || '기본 인트로 비디오 업로드 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleReset = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/admin/default-intro-video', {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('초기화 실패');

      toast({
        title: '기본 비디오 초기화 완료',
        description: '기본 인트로 비디오가 정적 파일로 되돌아갔습니다.',
      });
      refetch();
      queryClient.invalidateQueries({ queryKey: ['/api/media/default-intro-video'] });
    } catch (error: any) {
      toast({
        title: '초기화 실패',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const videoSrc = videoInfo?.hasCustomVideo
    ? toMediaUrl(videoInfo.url)
    : '/videos/intro_default.webm';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video className="h-5 w-5 text-blue-600" />
            <CardTitle>기본 인트로 비디오</CardTitle>
            {videoInfo?.hasCustomVideo ? (
              <Badge variant="outline" className="text-blue-600 border-blue-300 text-xs">커스텀</Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">기본값</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />업로드 중...</>
              ) : (
                <><Upload className="h-4 w-4 mr-1.5" />비디오 교체</>
              )}
            </Button>
            {videoInfo?.hasCustomVideo && (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={handleReset}
              >
                <RotateCcw className="h-4 w-4 mr-1.5" />
                초기화
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          인트로 비디오 모드가 "기본 비디오"로 설정된 모든 시나리오에 적용됩니다. WebM 또는 MP4 형식 지원.
        </p>
      </CardHeader>
      <CardContent>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/webm,video/mp4"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
        <div className="relative w-full bg-slate-900 rounded-lg overflow-hidden border">
          <video
            key={videoSrc}
            src={videoSrc}
            controls
            className="w-full max-h-64 object-contain"
            preload="metadata"
            data-testid="default-intro-video-preview"
          />
        </div>
      </CardContent>
    </Card>
  );
}
