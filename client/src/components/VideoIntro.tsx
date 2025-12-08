import { useRef, useEffect, useState, useCallback } from "react";
import { X } from "lucide-react";

interface VideoIntroProps {
  videoSrc: string;
  onComplete: () => void;
  onSkip: () => void;
  preloadImageUrl?: string;
}

export function VideoIntro({ videoSrc, onComplete, onSkip, preloadImageUrl }: VideoIntroProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSkip, setShowSkip] = useState(false);
  const [isFadingIn, setIsFadingIn] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [imagePreloaded, setImagePreloaded] = useState(!preloadImageUrl);

  const tryComplete = useCallback(() => {
    if (videoEnded && imagePreloaded) {
      setIsFadingOut(true);
      setTimeout(() => {
        onComplete();
      }, 500);
    }
  }, [videoEnded, imagePreloaded, onComplete]);

  useEffect(() => {
    if (!preloadImageUrl) {
      setImagePreloaded(true);
      return;
    }

    const img = new Image();
    img.onload = () => {
      console.log('✅ VideoIntro: 페르소나 이미지 프리로드 완료');
      setImagePreloaded(true);
    };
    img.onerror = () => {
      console.log('⚠️ VideoIntro: 페르소나 이미지 프리로드 실패, 계속 진행');
      setImagePreloaded(true);
    };
    img.src = preloadImageUrl;
  }, [preloadImageUrl]);

  useEffect(() => {
    tryComplete();
  }, [tryComplete]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleCanPlay = () => {
      setIsLoading(false);
      video.play().catch(() => {
        setShowSkip(true);
      });
      setTimeout(() => {
        setIsFadingIn(false);
      }, 50);
    };

    const handleEnded = () => {
      setVideoEnded(true);
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
  }, [onSkip]);

  const handleSkip = () => {
    setIsFadingOut(true);
    setTimeout(() => {
      onSkip();
    }, 500);
  };

  const webmSrc = videoSrc.replace(/\.mp4$/, ".webm");

  return (
    <div 
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      data-testid="video-intro-overlay"
    >
      {(isLoading || (videoEnded && !imagePreloaded)) && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      <video
        ref={videoRef}
        className={`w-full h-full object-cover transition-opacity duration-500 ${
          isFadingIn ? 'opacity-0' : isFadingOut ? 'opacity-0' : 'opacity-100'
        }`}
        playsInline
        preload="auto"
        autoPlay
        data-testid="video-intro-player"
      >
        <source src={webmSrc} type="video/webm" />
        <source src={videoSrc} type="video/mp4" />
      </video>

      {showSkip && !isFadingOut && (
        <button
          onClick={handleSkip}
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
