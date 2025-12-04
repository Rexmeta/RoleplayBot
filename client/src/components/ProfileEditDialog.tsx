import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Eye, EyeOff, Camera, User } from "lucide-react";

const profileFormSchema = z.object({
  name: z.string().min(1, "이름을 입력해주세요").max(50, "이름은 50자 이내로 입력해주세요"),
  currentPassword: z.string().optional(),
  newPassword: z.string().optional(),
  confirmPassword: z.string().optional(),
}).refine((data) => {
  if (data.newPassword && !data.currentPassword) {
    return false;
  }
  return true;
}, {
  message: "새 비밀번호를 설정하려면 현재 비밀번호를 입력해주세요",
  path: ["currentPassword"],
}).refine((data) => {
  if (data.newPassword && data.newPassword.length < 6) {
    return false;
  }
  return true;
}, {
  message: "새 비밀번호는 6자 이상이어야 합니다",
  path: ["newPassword"],
}).refine((data) => {
  if (data.newPassword && data.newPassword !== data.confirmPassword) {
    return false;
  }
  return true;
}, {
  message: "새 비밀번호가 일치하지 않습니다",
  path: ["confirmPassword"],
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

const tierConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  bronze: { label: "브론즈", color: "text-amber-700", bgColor: "bg-amber-100 border-amber-300" },
  silver: { label: "실버", color: "text-slate-600", bgColor: "bg-slate-100 border-slate-300" },
  gold: { label: "골드", color: "text-yellow-600", bgColor: "bg-yellow-100 border-yellow-300" },
  platinum: { label: "플래티넘", color: "text-cyan-600", bgColor: "bg-cyan-100 border-cyan-300" },
  diamond: { label: "다이아몬드", color: "text-purple-600", bgColor: "bg-purple-100 border-purple-300" },
};

interface ProfileEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: {
    id: string;
    email: string;
    name: string;
    role?: string;
    profileImage?: string | null;
    tier?: string;
  };
}

export function ProfileEditDialog({ open, onOpenChange, currentUser }: ProfileEditDialogProps) {
  const { toast } = useToast();
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(currentUser.profileImage || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tier = currentUser.tier || "bronze";
  const tierInfo = tierConfig[tier] || tierConfig.bronze;

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      name: currentUser.name || "",
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const uploadImageMutation = useMutation({
    mutationFn: async (imageData: string) => {
      return await apiRequest("POST", "/api/user/profile-image", { imageData });
    },
    onSuccess: () => {
      toast({
        title: "프로필 사진 업로드 완료",
        description: "프로필 사진이 성공적으로 변경되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: any) => {
      toast({
        title: "오류",
        description: error.message || "프로필 사진 업로드에 실패했습니다",
        variant: "destructive",
      });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (data: ProfileFormValues) => {
      const payload: any = {};
      
      if (data.name !== currentUser.name) {
        payload.name = data.name;
      }
      
      if (data.newPassword) {
        payload.currentPassword = data.currentPassword;
        payload.newPassword = data.newPassword;
      }

      if (Object.keys(payload).length === 0) {
        throw new Error("변경할 내용이 없습니다");
      }

      return await apiRequest("PATCH", "/api/user/profile", payload);
    },
    onSuccess: () => {
      toast({
        title: "프로필 수정 완료",
        description: "회원정보가 성공적으로 수정되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      onOpenChange(false);
      form.reset({
        name: form.getValues("name"),
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    },
    onError: (error: any) => {
      const message = error.message || "프로필 수정에 실패했습니다";
      toast({
        title: "오류",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "파일 크기 초과",
        description: "이미지 크기는 5MB 이하여야 합니다.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setPreviewImage(base64);
      uploadImageMutation.mutate(base64);
    };
    reader.readAsDataURL(file);
  };

  const onSubmit = (data: ProfileFormValues) => {
    updateProfileMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]" data-testid="profile-edit-dialog">
        <DialogHeader>
          <DialogTitle>회원정보 수정</DialogTitle>
          <DialogDescription>
            프로필 사진, 이름, 비밀번호를 수정할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div 
                className="w-24 h-24 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center overflow-hidden cursor-pointer hover:border-blue-400 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                data-testid="profile-image-container"
              >
                {previewImage ? (
                  <img 
                    src={previewImage} 
                    alt="프로필" 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-12 h-12 text-slate-400" />
                )}
                {uploadImageMutation.isPending && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-full">
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors shadow-md"
                data-testid="button-change-photo"
              >
                <Camera className="w-4 h-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
                data-testid="input-profile-image"
              />
            </div>
            <p className="text-xs text-slate-500">클릭하여 프로필 사진 변경 (최대 5MB)</p>
            
            <Badge className={`${tierInfo.bgColor} ${tierInfo.color} border`} data-testid="user-tier-badge">
              {tierInfo.label} 등급
            </Badge>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-500">이메일</label>
                <Input 
                  value={currentUser.email} 
                  disabled 
                  className="bg-slate-100"
                  data-testid="input-email-display"
                />
                <p className="text-xs text-slate-500">이메일은 변경할 수 없습니다</p>
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>이름</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="이름을 입력하세요"
                        data-testid="input-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="border-t pt-4 mt-4">
                <p className="text-sm font-medium mb-3">비밀번호 변경 (선택)</p>
                
                <FormField
                  control={form.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem className="mb-3">
                      <FormLabel>현재 비밀번호</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input 
                            {...field} 
                            type={showCurrentPassword ? "text" : "password"}
                            placeholder="현재 비밀번호"
                            data-testid="input-current-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            data-testid="toggle-current-password"
                          >
                            {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem className="mb-3">
                      <FormLabel>새 비밀번호</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input 
                            {...field} 
                            type={showNewPassword ? "text" : "password"}
                            placeholder="새 비밀번호 (6자 이상)"
                            data-testid="input-new-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            data-testid="toggle-new-password"
                          >
                            {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>새 비밀번호 확인</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input 
                            {...field} 
                            type={showConfirmPassword ? "text" : "password"}
                            placeholder="새 비밀번호 확인"
                            data-testid="input-confirm-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            data-testid="toggle-confirm-password"
                          >
                            {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  data-testid="button-cancel"
                >
                  취소
                </Button>
                <Button
                  type="submit"
                  disabled={updateProfileMutation.isPending}
                  data-testid="button-save"
                >
                  {updateProfileMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      저장 중...
                    </>
                  ) : (
                    "저장"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
