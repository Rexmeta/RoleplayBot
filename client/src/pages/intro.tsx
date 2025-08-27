import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronRight, Users, MessageCircle, Target, Award } from "lucide-react";
import introImage from "@assets/generated_images/Corporate_training_roleplay_scene_38ec84a7.png";

export default function Intro() {
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const steps = [
    {
      icon: <Users className="w-8 h-8" />,
      title: "AI 페르소나와 대화",
      description: "다양한 성격과 역할을 가진 AI 캐릭터들과 실제 업무 상황을 시뮬레이션합니다."
    },
    {
      icon: <MessageCircle className="w-8 h-8" />,
      title: "실시간 감정 분석",
      description: "대화 중 AI의 감정 변화를 실시간으로 확인하며 소통 스킬을 향상시킵니다."
    },
    {
      icon: <Target className="w-8 h-8" />,
      title: "맞춤형 시나리오",
      description: "협상, 프레젠테이션, 갈등 해결 등 실무에 필요한 다양한 상황을 연습합니다."
    },
    {
      icon: <Award className="w-8 h-8" />,
      title: "상세한 피드백",
      description: "대화 완료 후 AI가 분석한 상세한 평가와 개선점을 제공받습니다."
    }
  ];

  const handleStart = () => {
    setLocation("/home");
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleStart();
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${introImage})` }}
      >
        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/90 via-purple-900/80 to-indigo-900/90" />
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 text-white">
        {/* Main Title Animation */}
        <div className={`text-center mb-12 transition-all duration-1000 transform ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
          <h1 className="text-6xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-white via-blue-200 to-purple-200 bg-clip-text text-transparent">
            RolePlayX
          </h1>
          <p className="text-xl md:text-2xl text-blue-100 mb-8 max-w-2xl mx-auto leading-relaxed">
            AI와 함께하는 혁신적인 커뮤니케이션 스킬 훈련 시스템
          </p>
          <div className="w-24 h-1 bg-gradient-to-r from-blue-400 to-purple-400 mx-auto rounded-full" />
        </div>

        {/* Feature Steps */}
        <div className={`w-full max-w-4xl transition-all duration-1000 delay-300 transform ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20 shadow-2xl">
            {/* Progress Bar */}
            <div className="mb-8">
              <div className="flex justify-between items-center mb-4">
                {steps.map((_, index) => (
                  <div
                    key={index}
                    className={`w-4 h-4 rounded-full transition-all duration-300 ${
                      index <= currentStep ? 'bg-blue-400' : 'bg-white/30'
                    }`}
                  />
                ))}
              </div>
              <div className="w-full bg-white/20 rounded-full h-2">
                <div 
                  className="bg-gradient-to-r from-blue-400 to-purple-400 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
                />
              </div>
            </div>

            {/* Current Step Content */}
            <div className="text-center min-h-[200px] flex flex-col justify-center">
              <div className={`transition-all duration-500 transform ${currentStep >= 0 ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}>
                <div className="flex justify-center mb-6">
                  <div className="p-4 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-full border border-white/20">
                    {steps[currentStep]?.icon}
                  </div>
                </div>
                <h2 className="text-2xl md:text-3xl font-bold mb-4 text-white">
                  {steps[currentStep]?.title}
                </h2>
                <p className="text-lg text-blue-100 max-w-md mx-auto leading-relaxed">
                  {steps[currentStep]?.description}
                </p>
              </div>
            </div>

            {/* Navigation Buttons */}
            <div className="flex justify-center gap-4 mt-8">
              <Button
                onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                variant="outline"
                className="bg-white/10 border-white/30 text-white hover:bg-white/20 transition-all duration-300"
                disabled={currentStep === 0}
              >
                이전
              </Button>
              <Button
                onClick={handleNext}
                className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white px-8 py-3 rounded-lg font-semibold transition-all duration-300 transform hover:scale-105 shadow-lg"
                data-testid="button-next"
              >
                {currentStep === steps.length - 1 ? '시작하기' : '다음'}
                <ChevronRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          </div>
        </div>

        {/* Quick Start Button */}
        <div className={`mt-8 transition-all duration-1000 delay-500 transform ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
          <Button
            onClick={handleStart}
            variant="ghost"
            className="text-white/80 hover:text-white hover:bg-white/10 transition-all duration-300"
            data-testid="button-skip-intro"
          >
            인트로 건너뛰기
          </Button>
        </div>

        {/* Floating Animation Elements */}
        <div className="absolute top-20 left-20 w-3 h-3 bg-blue-400/50 rounded-full animate-pulse" />
        <div className="absolute top-40 right-32 w-2 h-2 bg-purple-400/50 rounded-full animate-pulse delay-1000" />
        <div className="absolute bottom-32 left-16 w-4 h-4 bg-indigo-400/50 rounded-full animate-pulse delay-500" />
        <div className="absolute bottom-20 right-20 w-2 h-2 bg-blue-300/50 rounded-full animate-pulse delay-1500" />
      </div>
    </div>
  );
}