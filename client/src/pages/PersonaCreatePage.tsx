import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useUpload } from "@/hooks/use-upload";
import PersonaLayout from "@/components/PersonaLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, ArrowRight, Check, Camera, ImageIcon,
  Globe, Lock, User, Sparkles
} from "lucide-react";

const personaFormSchema = z.object({
  name: z.string().min(1, "이름을 입력해 주세요").max(50, "이름은 50자 이하로 입력해 주세요"),
  description: z.string().max(300, "소개는 300자 이하로 입력해 주세요").default(""),
  greeting: z.string().max(500, "첫 인사말은 500자 이하로 입력해 주세요").default(""),
  tags: z.string().max(200, "태그는 200자 이하로 입력해 주세요").default(""),
  isPublic: z.boolean().default(false),
  traits: z.string().max(200, "성격 특성은 200자 이하로 입력해 주세요").default(""),
  communicationStyle: z.string().max(200, "대화 방식은 200자 이하로 입력해 주세요").default(""),
  background: z.string().max(500, "배경 스토리는 500자 이하로 입력해 주세요").default(""),
  speechStyle: z.string().max(200, "말투 스타일은 200자 이하로 입력해 주세요").default(""),
});

type PersonaFormData = z.infer<typeof personaFormSchema>;

const STEPS = [
  { label: "기본 정보", icon: User },
  { label: "성격·배경", icon: Sparkles },
  { label: "아바타", icon: Camera },
];

export default function PersonaCreatePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading } = useUpload();

  const [step, setStep] = useState(0);
  const [avatarObjectPath, setAvatarObjectPath] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const form = useForm<PersonaFormData>({
    resolver: zodResolver(personaFormSchema),
    defaultValues: {
      name: "",
      description: "",
      greeting: "",
      tags: "",
      isPublic: false,
      traits: "",
      communicationStyle: "",
      background: "",
      speechStyle: "",
    },
  });

  const watchedName = form.watch("name");
  const watchedTags = form.watch("tags");
  const watchedIsPublic = form.watch("isPublic");
  const watchedDescription = form.watch("description");

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    const result = await uploadFile(file);
    if (result) {
      setAvatarObjectPath(result.objectPath);
    } else {
      toast({ title: "이미지 업로드 실패", variant: "destructive" });
    }
  };

  const saveMutation = useMutation({
    mutationFn: (data: PersonaFormData) =>
      apiRequest("POST", "/api/user-personas", {
        name: data.name.trim(),
        description: data.description.trim(),
        greeting: data.greeting.trim() || `안녕하세요! 저는 ${data.name.trim()}입니다.`,
        avatarUrl: avatarObjectPath,
        personality: {
          traits: data.traits.split(",").map(t => t.trim()).filter(Boolean),
          communicationStyle: data.communicationStyle.trim(),
          background: data.background.trim(),
          speechStyle: data.speechStyle.trim(),
        },
        tags: data.tags.split(",").map(t => t.trim()).filter(Boolean),
        isPublic: data.isPublic,
      }).then(r => r.json()),
    onSuccess: (created: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas/discover"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas/featured"] });
      toast({ title: "캐릭터가 만들어졌어요!" });
      navigate(`/persona/${created.id}`);
    },
    onError: () => toast({ title: "저장 실패", variant: "destructive" }),
  });

  const handleNextStep = async () => {
    if (step === 0) {
      const valid = await form.trigger(["name", "description", "greeting", "tags"]);
      if (!valid) return;
    } else if (step === 1) {
      const valid = await form.trigger(["traits", "communicationStyle", "background", "speechStyle"]);
      if (!valid) return;
    }
    setStep(s => s + 1);
  };

  const onSubmit = (data: PersonaFormData) => {
    saveMutation.mutate(data);
  };

  const initials = watchedName.slice(0, 2).toUpperCase() || "?";
  const tagsPreview = watchedTags.split(",").map(t => t.trim()).filter(Boolean);

  return (
    <PersonaLayout>
      <div className="max-w-xl mx-auto w-full px-6 py-6">

        <h1 className="text-2xl font-bold text-slate-800 mb-6">새 캐릭터 만들기</h1>

        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-colors ${
                  i < step ? "bg-emerald-500 text-white" :
                  i === step ? "bg-emerald-600 text-white ring-4 ring-emerald-100" :
                  "bg-slate-200 text-slate-400"
                }`}
              >
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-sm font-medium ${i === step ? "text-emerald-700" : "text-slate-400"}`}>{s.label}</span>
              {i < STEPS.length - 1 && (
                <div className={`h-0.5 w-8 ${i < step ? "bg-emerald-400" : "bg-slate-200"}`} />
              )}
            </div>
          ))}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>

            {step === 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>이름 <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="예: 친절한 멘토, 역사학자 김박사" autoFocus />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>소개</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="이 캐릭터는 어떤 AI인가요?" rows={3} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="greeting"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>첫 인사말</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="대화 시작 시 AI가 먼저 하는 말 (비워두면 자동 설정)"
                          rows={2}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="tags"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>태그</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="예: 멘토, 역사, 철학 (쉼표로 구분)" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="isPublic"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-3 pt-1">
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <Label className="cursor-pointer">
                          {field.value
                            ? <span className="text-emerald-600 flex items-center gap-1"><Globe className="w-3.5 h-3.5" />공개 — 누구나 대화 가능</span>
                            : <span className="text-slate-500 flex items-center gap-1"><Lock className="w-3.5 h-3.5" />비공개 — 나만 사용</span>
                          }
                        </Label>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            )}

            {step === 1 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                <FormField
                  control={form.control}
                  name="traits"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>성격 특성</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="예: 유머러스, 직설적, 공감 능력 뛰어남 (쉼표로 구분)" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="communicationStyle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>대화 방식</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="예: 따뜻하고 격려적인 말투로 소통" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="speechStyle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>말투 스타일</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder='예: "~네요", "~죠?" 같은 편안한 존댓말 사용' />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="background"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>배경 스토리</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="캐릭터의 직업, 경험, 세계관 등" rows={4} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {step === 2 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="flex flex-col items-center gap-4">
                  <div
                    className="relative group cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="avatar" className="w-32 h-32 rounded-full object-cover border-4 border-slate-200" />
                    ) : (
                      <div className="w-32 h-32 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-bold text-4xl border-4 border-slate-200">
                        {initials}
                      </div>
                    )}
                    <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      {isUploading
                        ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <Camera className="w-7 h-7 text-white" />
                      }
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="text-sm text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <ImageIcon className="w-4 h-4" />
                    {isUploading ? "업로드 중..." : avatarPreview ? "이미지 변경" : "이미지 추가"}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageSelect}
                  />
                  {!avatarPreview && (
                    <p className="text-sm text-slate-400 text-center">
                      이미지를 추가하지 않으면<br />이름 첫 두 글자로 자동 생성됩니다
                    </p>
                  )}
                </div>

                <div className="mt-6 p-4 bg-slate-50 rounded-xl">
                  <p className="text-xs text-slate-500 mb-2 font-medium">캐릭터 요약</p>
                  <p className="font-semibold text-slate-800">{watchedName}</p>
                  {watchedDescription && <p className="text-sm text-slate-500 mt-0.5">{watchedDescription}</p>}
                  {tagsPreview.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {tagsPreview.map(tag => (
                        <span key={tag} className="text-[11px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-500">
                    {watchedIsPublic ? <Globe className="w-3 h-3 text-emerald-500" /> : <Lock className="w-3 h-3" />}
                    {watchedIsPublic ? "공개" : "비공개"}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 mt-6">
              {step > 0 && (
                <Button type="button" variant="outline" onClick={() => setStep(s => s - 1)} className="flex-1 gap-2">
                  <ArrowLeft className="w-4 h-4" />이전
                </Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button type="button" onClick={handleNextStep} className="flex-1 bg-emerald-600 hover:bg-emerald-700 gap-2">
                  다음 <ArrowRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={saveMutation.isPending || isUploading}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 gap-2"
                >
                  {saveMutation.isPending ? "저장 중..." : <><Check className="w-4 h-4" />캐릭터 완성하기</>}
                </Button>
              )}
            </div>
          </form>
        </Form>
      </div>
    </PersonaLayout>
  );
}
