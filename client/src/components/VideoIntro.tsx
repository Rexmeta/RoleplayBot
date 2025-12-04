import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Play, SkipForward, Volume2, VolumeX, Pause, Maximize, RotateCcw } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface VideoIntroProps {
  videoSrc: string;
  scenarioTitle: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function VideoIntro({ videoSrc, scenarioTitle, onComplete, onSkip }: VideoIntroProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isEnded, setIsEnded] = useState(false);
  const [showControls, setShowControls] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (video.duration) {
        setProgress((video.currentTime / video.duration) * 100);
        setCurrentTime(video.currentTime);
      }
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    const handleEnded = () => {
      setIsEnded(true);
      setIsPlaying(false);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
    };
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isEnded) {
      video.currentTime = 0;
      setIsEnded(false);
    }

    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(!isMuted);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickPosition = (e.clientX - rect.left) / rect.width;
    video.currentTime = clickPosition * video.duration;
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  };

  const restartVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setIsEnded(false);
    video.play();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl bg-slate-800/90 border-slate-700 shadow-2xl">
        <CardContent className="p-6">
          <div className="text-center mb-4">
            <h2 className="text-xl font-bold text-white mb-2">{scenarioTitle}</h2>
            <p className="text-slate-400 text-sm">대화를 시작하기 전에 상황 영상을 확인하세요</p>
          </div>

          <div
            ref={containerRef}
            className="relative rounded-lg overflow-hidden bg-black aspect-video"
            onMouseEnter={() => setShowControls(true)}
            onMouseLeave={() => isPlaying && setShowControls(false)}
          >
            <video
              ref={videoRef}
              src={videoSrc}
              className="w-full h-full object-contain"
              playsInline
              preload="auto"
              onClick={togglePlay}
              data-testid="video-intro-player"
            />

            {!isPlaying && !isEnded && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-black/40 cursor-pointer"
                onClick={togglePlay}
              >
                <div className="w-20 h-20 rounded-full bg-white/90 flex items-center justify-center hover:scale-110 transition-transform">
                  <Play className="w-10 h-10 text-slate-800 ml-1" />
                </div>
              </div>
            )}

            {isEnded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
                <p className="text-white text-lg mb-4">영상 시청이 완료되었습니다</p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={restartVideo}
                    className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                    data-testid="button-restart-video"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    다시 보기
                  </Button>
                  <Button
                    onClick={onComplete}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                    data-testid="button-start-conversation"
                  >
                    대화 시작하기
                  </Button>
                </div>
              </div>
            )}

            {showControls && !isEnded && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                <div
                  className="w-full h-1.5 bg-white/30 rounded-full cursor-pointer mb-3"
                  onClick={handleProgressClick}
                >
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={togglePlay}
                      className="text-white hover:bg-white/20"
                      data-testid="button-play-pause"
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={toggleMute}
                      className="text-white hover:bg-white/20"
                      data-testid="button-mute"
                    >
                      {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </Button>

                    <span className="text-white/80 text-sm">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleFullscreen}
                    className="text-white hover:bg-white/20"
                    data-testid="button-fullscreen"
                  >
                    <Maximize className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center mt-6">
            <p className="text-slate-400 text-sm">
              영상을 끝까지 시청하시면 대화를 시작할 수 있습니다
            </p>
            <Button
              variant="ghost"
              onClick={onSkip}
              className="text-slate-400 hover:text-white hover:bg-slate-700"
              data-testid="button-skip-video"
            >
              <SkipForward className="w-4 h-4 mr-2" />
              건너뛰기
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
