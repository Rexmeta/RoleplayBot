import { useRef, useEffect, useState, useCallback } from "react";
import { X, AlertCircle } from "lucide-react";

interface VideoIntroProps {
  videoSrc: string;
  onComplete: () => void;
  onSkip: () => void;
  preloadImageUrl?: string;
}

export function VideoIntro({ videoSrc, onComplete, onSkip, preloadImageUrl }: VideoIntroProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSkip, setShowSkip] = useState(false);
  const [isFadingIn, setIsFadingIn] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [imagePreloaded, setImagePreloaded] = useState(!preloadImageUrl);
  const [hasError, setHasError] = useState(false);

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
      setIsLoading(false);
      setHasError(true);
      errorTimerRef.current = setTimeout(() => {
        onSkip();
      }, 3000);
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
      if (errorTimerRef.current !== null) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
    };
  }, [onSkip]);

  const handleSkip = () => {
    setIsFadingOut(true);
    setTimeout(() => {
      onSkip();
    }, 500);
  };

  const isWebmSource = /\.webm$/i.test(videoSrc);
  const webmSrc = isWebmSource ? videoSrc : videoSrc.replace(/\.mp4$/i, ".webm");
  const hasSeparateMp4 = !isWebmSource && webmSrc !== videoSrc;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      data-testid="video-intro-overlay"
    >
      {(isLoading || (videoEnded && !imagePreloaded)) && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/70 backdrop-blur-sm" data-testid="video-error-overlay">
          <AlertCircle className="w-12 h-12 text-white/60 mb-4" />
          <p className="text-white text-lg font-medium mb-6">영상을 불러올 수 없습니다</p>
          <button
            onClick={() => {
              if (errorTimerRef.current !== null) {
                clearTimeout(errorTimerRef.current);
                errorTimerRef.current = null;
              }
              onSkip();
            }}
            className="flex items-center gap-2 px-5 py-2.5 bg-white/20 hover:bg-white/30 text-white rounded-full transition-all text-sm backdrop-blur-sm"
            data-testid="button-error-skip-video"
          >
            <X className="w-4 h-4" />
            건너뛰기
          </button>
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
        {hasSeparateMp4 && <source src={videoSrc} type="video/mp4" />}
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
