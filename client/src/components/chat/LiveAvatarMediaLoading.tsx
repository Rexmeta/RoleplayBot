import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toMediaUrl } from "@/lib/mediaUrl";

export function LiveAvatarMediaLoading({ image, joining, testId = "live-avatar-video-loading" }: {
  image?: string | null;
  joining: boolean;
  testId?: string;
}) {
  const { t, i18n } = useTranslation();
  const ko = i18n.language?.startsWith("ko");
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#24383b] px-5" data-testid={testId}>
      {image && <img src={toMediaUrl(image)} alt="" className="absolute inset-0 h-full w-full object-cover object-top" />}
      <div className="absolute inset-0 bg-[#15262c]/55" />
      <div role="status" className="relative flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-white/15 bg-[#15262c]/90 px-6 py-5 text-center text-white shadow-lg">
        <LoaderCircle className="h-7 w-7 motion-safe:animate-spin" aria-hidden="true" />
        <p className="text-sm font-semibold">
          {joining
            ? t("chat.tavus.connectingAvatar", { defaultValue: ko ? "라이브 아바타에 연결하는 중입니다" : "Connecting to the live avatar" })
            : t("chat.tavus.waitingForVideo", { defaultValue: ko ? "아바타 영상을 불러오는 중입니다" : "Loading avatar video" })}
        </p>
        <p className="text-xs leading-relaxed text-white/80">
          {joining
            ? t("chat.tavus.allowMicrophone", { defaultValue: ko ? "브라우저가 요청하면 마이크 사용을 허용해 주세요." : "Allow microphone access if your browser asks." })
            : t("chat.tavus.videoAppearsAutomatically", { defaultValue: ko ? "영상이 준비되면 자동으로 표시됩니다." : "The video will appear automatically when it’s ready." })}
        </p>
      </div>
    </div>
  );
}
