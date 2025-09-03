import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Loader2 } from 'lucide-react';

interface AIGeneratorProps {
  onGenerated: (data: any) => void;
}

export function AIScenarioGenerator({ onGenerated }: AIGeneratorProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    theme: '',
    industry: '',
    difficulty: 3,
    personaCount: 3
  });

  const generateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest('POST', '/api/admin/generate-scenario', data);
      return response.json();
    },
    onSuccess: (result) => {
      setIsOpen(false);
      onGenerated(result);
      toast({
        title: "성공",
        description: "AI가 시나리오를 생성했습니다.",
        variant: "default"
      });
    },
    onError: () => {
      toast({
        title: "오류", 
        description: "AI 시나리오 생성에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  const handleGenerate = () => {
    if (!formData.theme.trim()) {
      toast({
        title: "오류",
        description: "주제를 입력해주세요.",
        variant: "destructive"
      });
      return;
    }
    generateMutation.mutate(formData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          className="border-purple-600 text-purple-600 hover:bg-purple-50"
          data-testid="button-ai-generate"
        >
          <i className="fas fa-magic mr-2"></i>
          AI로 생성
        </Button>
      </DialogTrigger>
      
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>AI 시나리오 생성</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="theme">주제 *</Label>
            <Input
              id="theme"
              value={formData.theme}
              onChange={(e) => setFormData(prev => ({ ...prev, theme: e.target.value }))}
              placeholder="예: 프로젝트 지연, 갈등 해결, 협상"
              data-testid="input-ai-theme"
            />
          </div>
          
          <div>
            <Label htmlFor="industry">업종 (선택사항)</Label>
            <Input
              id="industry"
              value={formData.industry}
              onChange={(e) => setFormData(prev => ({ ...prev, industry: e.target.value }))}
              placeholder="예: IT, 제조업, 서비스업"
              data-testid="input-ai-industry"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>난이도</Label>
              <Select 
                value={formData.difficulty.toString()} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, difficulty: Number(value) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 - 쉬움</SelectItem>
                  <SelectItem value="2">2 - 보통</SelectItem>
                  <SelectItem value="3">3 - 중간</SelectItem>
                  <SelectItem value="4">4 - 어려움</SelectItem>
                  <SelectItem value="5">5 - 매우 어려움</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>페르소나 수</Label>
              <Select 
                value={formData.personaCount.toString()} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, personaCount: Number(value) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2명</SelectItem>
                  <SelectItem value="3">3명</SelectItem>
                  <SelectItem value="4">4명</SelectItem>
                  <SelectItem value="5">5명</SelectItem>
                  <SelectItem value="6">6명</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="flex gap-2 pt-4">
            <Button 
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              className="flex-1 bg-purple-600 hover:bg-purple-700"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  생성 중...
                </>
              ) : (
                <>
                  <i className="fas fa-magic mr-2"></i>
                  생성하기
                </>
              )}
            </Button>
            <Button 
              type="button" 
              variant="outline"
              onClick={() => setIsOpen(false)}
            >
              취소
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}