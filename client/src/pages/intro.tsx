import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft, Users, MessageCircle, Target, Award, Zap, Brain, BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import scenarioImg from "@assets/intro-card-scenario.webp";
import personaImg from "@assets/intro-card-persona.webp";
import emotionImg from "@assets/intro-card-emotion.webp";
import feedbackImg from "@assets/intro-card-feedback.webp";

export default function Intro() {
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [animating, setAnimating] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    setIsVisible(true);
  }, []);

  useEffect(() => {
    [scenarioImg, personaImg, emotionImg, feedbackImg].forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  const features = [
    {
      icon: <Target className="w-6 h-6 text-white" />,
      iconBg: "from-indigo-500 to-blue-500",
      title: t('intro.step1Title'),
      description: t('intro.step1Desc'),
      borderColor: "border-indigo-100",
      image: scenarioImg,
    },
    {
      icon: <Users className="w-6 h-6 text-white" />,
      iconBg: "from-violet-500 to-purple-500",
      title: t('intro.step2Title'),
      description: t('intro.step2Desc'),
      borderColor: "border-violet-100",
      image: personaImg,
    },
    {
      icon: <MessageCircle className="w-6 h-6 text-white" />,
      iconBg: "from-cyan-500 to-teal-500",
      title: t('intro.step3Title'),
      description: t('intro.step3Desc'),
      borderColor: "border-cyan-100",
      image: emotionImg,
    },
    {
      icon: <Award className="w-6 h-6 text-white" />,
      iconBg: "from-pink-500 to-rose-500",
      title: t('intro.step4Title'),
      description: t('intro.step4Desc'),
      borderColor: "border-pink-100",
      image: feedbackImg,
    },
  ];

  const badges = [
    { icon: <Zap className="w-3.5 h-3.5" />, text: t('intro.bubble1'), color: "text-indigo-600 bg-indigo-50 border-indigo-200" },
    { icon: <Users className="w-3.5 h-3.5" />, text: t('intro.bubble2'), color: "text-violet-600 bg-violet-50 border-violet-200" },
    { icon: <Brain className="w-3.5 h-3.5" />, text: t('intro.bubble3'), color: "text-cyan-600 bg-cyan-50 border-cyan-200" },
    { icon: <BarChart3 className="w-3.5 h-3.5" />, text: t('intro.bubble4'), color: "text-pink-600 bg-pink-50 border-pink-200" },
    { icon: <Award className="w-3.5 h-3.5" />, text: t('intro.bubble5'), color: "text-teal-600 bg-teal-50 border-teal-200" },
  ];

  const handleStart = () => {
    setLocation("/home");
  };

  const goToStep = (nextStep: number, dir: "next" | "prev") => {
    if (animating) return;
    setDirection(dir);
    setAnimating(true);
    setTimeout(() => {
      setCurrentStep(nextStep);
      setAnimating(false);
    }, 300);
  };

  const handleNext = () => {
    if (currentStep < features.length - 1) {
      goToStep(currentStep + 1, "next");
    } else {
      handleStart();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      goToStep(currentStep - 1, "prev");
    }
  };

  const feature = features[currentStep];

  const slideClass = animating
    ? direction === "next"
      ? "opacity-0 translate-x-8"
      : "opacity-0 -translate-x-8"
    : "opacity-100 translate-x-0";

  return (
    <div className="min-h-screen relative overflow-hidden bg-white">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="aurora-blob-1 absolute w-[600px] h-[600px] rounded-full opacity-30 blur-3xl" style={{ top: '-10%', left: '-10%' }} />
        <div className="aurora-blob-2 absolute w-[500px] h-[500px] rounded-full opacity-25 blur-3xl" style={{ top: '20%', right: '-5%' }} />
        <div className="aurora-blob-3 absolute w-[400px] h-[400px] rounded-full opacity-20 blur-3xl" style={{ bottom: '-5%', left: '30%' }} />
      </div>

      <div className="absolute inset-0 pointer-events-none overflow-hidden hidden sm:block">
        <div className="absolute animate-float-badge-1" style={{ top: '18%', left: '6%' }}>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium shadow-sm ${badges[0].color}`}>
            {badges[0].icon}
            <span>{badges[0].text}</span>
          </div>
        </div>
        <div className="absolute animate-float-badge-2" style={{ top: '28%', right: '7%' }}>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium shadow-sm ${badges[1].color}`}>
            {badges[1].icon}
            <span>{badges[1].text}</span>
          </div>
        </div>
        <div className="absolute animate-float-badge-3" style={{ top: '55%', left: '4%' }}>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium shadow-sm ${badges[2].color}`}>
            {badges[2].icon}
            <span>{badges[2].text}</span>
          </div>
        </div>
        <div className="absolute animate-float-badge-4" style={{ bottom: '28%', right: '5%' }}>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium shadow-sm ${badges[3].color}`}>
            {badges[3].icon}
            <span>{badges[3].text}</span>
          </div>
        </div>
        <div className="absolute animate-float-badge-5" style={{ bottom: '18%', left: '8%' }}>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium shadow-sm ${badges[4].color}`}>
            {badges[4].icon}
            <span>{badges[4].text}</span>
          </div>
        </div>
      </div>

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-8 sm:py-12 md:py-16">
        <div className={`text-center mb-6 sm:mb-8 transition-all duration-1000 transform ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
          <h1 className="text-3xl sm:text-4xl md:text-6xl font-bold mb-3 sm:mb-4 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 bg-clip-text text-transparent leading-tight">
            {t('intro.title')}
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-slate-500 mb-5 sm:mb-6 max-w-2xl mx-auto leading-relaxed">
            {t('intro.subtitle')}
          </p>
          <div className="w-16 h-1 bg-gradient-to-r from-indigo-500 to-violet-500 mx-auto rounded-full" />
        </div>

        <div className={`w-full max-w-sm transition-all duration-1000 delay-300 transform ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
          <div className={`bg-white rounded-2xl border shadow-md overflow-hidden transition-all duration-300 ease-out ${feature.borderColor} ${slideClass}`}>
            <div className="w-full h-36 sm:h-44 md:h-52 overflow-hidden bg-slate-50">
              <img
                key={currentStep}
                src={feature.image}
                alt={feature.title}
                loading="eager"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${feature.iconBg} flex items-center justify-center shadow-sm flex-shrink-0`}>
                  {feature.icon}
                </div>
                <h3 className="text-base font-semibold text-slate-800">
                  {feature.title}
                </h3>
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">
                {feature.description}
              </p>
            </div>
          </div>

          <div className="flex justify-center gap-2 my-5">
            {features.map((_, index) => (
              <div
                key={index}
                className={`transition-all duration-300 rounded-full ${
                  index === currentStep
                    ? 'w-6 h-2 bg-gradient-to-r from-indigo-500 to-violet-500'
                    : index < currentStep
                    ? 'w-2 h-2 bg-indigo-300'
                    : 'w-2 h-2 bg-slate-200'
                }`}
              />
            ))}
          </div>

          <div className="flex justify-center gap-3">
            <Button
              onClick={handlePrev}
              variant="outline"
              className="min-w-[48px] min-h-[48px] px-5 py-3 border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl transition-all duration-200"
              disabled={currentStep === 0}
            >
              <ChevronLeft className="w-5 h-5" />
              {t('common.previous')}
            </Button>
            <Button
              onClick={handleNext}
              className="min-w-[48px] min-h-[48px] px-8 py-3 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white font-semibold rounded-xl transition-all duration-300 hover:scale-105 shadow-lg shadow-indigo-200 hover:shadow-indigo-300 hover:shadow-xl"
              data-testid="button-next"
            >
              {currentStep === features.length - 1 ? t('common.start') : t('common.next')}
              <ChevronRight className="w-5 h-5 ml-1" />
            </Button>
          </div>
        </div>

        <div className={`mt-6 transition-all duration-1000 delay-500 transform ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
          <Button
            onClick={handleStart}
            variant="ghost"
            className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all duration-300 text-sm"
            data-testid="button-skip-intro"
          >
            {t('common.skipIntro')}
          </Button>
        </div>
      </div>
    </div>
  );
}
