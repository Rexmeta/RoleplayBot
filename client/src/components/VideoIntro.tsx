import { useRef, useEffect, useState } from "react";
import { X } from "lucide-react";

interface VideoIntroProps {
  videoSrc: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function VideoIntro({ videoSrc, onComplete, onSkip }: VideoIntroProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSkip, setShowSkip] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleCanPlay = () => {
      setIsLoading(false);
      video.play().catch(() => {
        setShowSkip(true);
      });
    };

    const handleEnded = () => {
      onComplete();
    };

    const handleError = () => {
      onSkip();
    };

    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);

    const skipTimer = setTimeout(() => {
      setShowSkip(true);
    }, 2000);

    return () => {
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      clearTimeout(skipTimer);
    };
  }, [onComplete, onSkip]);

  const webmSrc = videoSrc.replace(/\.mp4$/, ".webm");

  return (
    <div 
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      data-testid="video-intro-overlay"
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        playsInline
        preload="auto"
        autoPlay
        data-testid="video-intro-player"
      >
        <source src={webmSrc} type="video/webm" />
        <source src={videoSrc} type="video/mp4" />
      </video>

      {showSkip && (
        <button
          onClick={onSkip}
          className="absolute top-6 right-6 flex items-center gap-2 px-4 py-2 bg-black/60 hover:bg-black/80 text-white/80 hover:text-white rounded-full transition-all text-sm backdrop-blur-sm"
          data-testid="button-skip-video"
        >
          <X className="w-4 h-4" />
          건너뛰기
        </button>
      )}
    </div>
  );
}
