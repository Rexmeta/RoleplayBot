import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, MessageSquare, Mic, Volume2, Brain, Target, BarChart3, Globe, Shield, Users, Award, Zap, TrendingUp, ClipboardList, Layers, ChevronRight, BookOpen, PlayCircle, LineChart, UserCircle, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ViewMode = "user" | "operator";

export default function AboutPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("user");

  const features = [
    {
      icon: <MessageSquare className="h-6 w-6 text-blue-600" />,
      title: "3가지 대화 모드",
      description: "텍스트 입력, AI 음성 응답(TTS), 실시간 양방향 음성 대화까지 다양한 방식으로 훈련할 수 있습니다.",
      badge: "핵심"
    },
    {
      icon: <Brain className="h-6 w-6 text-purple-600" />,
      title: "MBTI 기반 AI 페르소나",
      description: "16가지 MBTI 성격 유형을 반영한 AI 캐릭터와 대화하며 다양한 유형의 동료·상사·고객을 경험합니다.",
      badge: "핵심"
    },
    {
      icon: <Layers className="h-6 w-6 text-indigo-600" />,
      title: "10턴 구조화 대화",
      description: "총 10회 대화 턴으로 구성된 체계적인 훈련 구조로 집중력 있는 롤플레이를 진행합니다.",
      badge: null
    },
    {
      icon: <Target className="h-6 w-6 text-orange-600" />,
      title: "4단계 난이도 시스템",
      description: "초급부터 고급까지 4단계 난이도로 학습자 수준에 맞는 맞춤형 훈련을 제공합니다.",
      badge: null
    },
    {
      icon: <Zap className="h-6 w-6 text-yellow-600" />,
      title: "실시간 감정 분석",
      description: "대화 중 AI 캐릭터의 감정 상태를 시각적으로 표시하여 상대방 감정 파악 능력을 훈련합니다.",
      badge: null
    },
    {
      icon: <ClipboardList className="h-6 w-6 text-green-600" />,
      title: "ComOn Check 평가 시스템",
      description: "커뮤니케이션 연구 기반 5점 척도로 경청, 공감, 명료성 등 항목별 세부 점수를 산출합니다.",
      badge: "핵심"
    },
    {
      icon: <BarChart3 className="h-6 w-6 text-teal-600" />,
      title: "상세 피드백 & 성장 리포트",
      description: "대화 완료 후 강점·개선점·행동 가이드·발전 계획을 포함한 개인 성장 보고서를 제공합니다.",
      badge: null
    },
    {
      icon: <Globe className="h-6 w-6 text-cyan-600" />,
      title: "다국어 지원",
      description: "한국어, 영어, 일본어, 중국어 4개 언어를 지원하여 글로벌 환경의 커뮤니케이션도 훈련합니다.",
      badge: null
    },
    {
      icon: <Shield className="h-6 w-6 text-slate-600" />,
      title: "역할 기반 접근 제어",
      description: "시스템관리자·운영자·일반사용자 3단계 권한 체계로 안전하고 체계적인 콘텐츠 관리가 가능합니다.",
      badge: null
    }
  ];

  const conversationModes = [
    {
      icon: <MessageSquare className="h-8 w-8 text-blue-600" />,
      title: "텍스트 모드",
      color: "border-blue-200 bg-blue-50",
      iconBg: "bg-blue-100",
      features: [
        "키보드로 자유롭게 입력",
        "AI가 텍스트로 응답",
        "차분하게 생각하며 대화 가능",
        "입력한 내용 수정 후 전송 가능"
      ]
    },
    {
      icon: <Volume2 className="h-8 w-8 text-purple-600" />,
      title: "TTS 모드",
      color: "border-purple-200 bg-purple-50",
      iconBg: "bg-purple-100",
      features: [
        "텍스트 입력 후 AI 음성 응답",
        "MBTI 유형별 맞춤 목소리",
        "ElevenLabs 고품질 음성 합성",
        "청각적 몰입감 강화"
      ]
    },
    {
      icon: <Mic className="h-8 w-8 text-green-600" />,
      title: "실시간 음성 모드",
      color: "border-green-200 bg-green-50",
      iconBg: "bg-green-100",
      features: [
        "말하면 AI가 실시간으로 응답",
        "자연스러운 끊김 없는 대화",
        "말 끊기(Barge-in) 지원",
        "Gemini Live API 기반"
      ]
    }
  ];

  const evaluationItems = [
    { label: "경청 및 공감", description: "상대방의 말에 집중하고 감정을 이해하는 능력" },
    { label: "명료한 표현", description: "자신의 의견을 논리적이고 명확하게 전달하는 능력" },
    { label: "문제 해결", description: "갈등 상황에서 창의적이고 실용적인 해결책 제안" },
    { label: "관계 형성", description: "신뢰 기반의 긍정적 관계를 구축하는 커뮤니케이션" },
    { label: "감정 조절", description: "압박 상황에서 감정을 적절히 표현하고 조절하는 능력" }
  ];

  const operatorFeatures = [
    {
      icon: <Users className="h-6 w-6 text-blue-600" />,
      title: "사용자 관리",
      description: "사용자 초대, 권한 부여, 그룹 구성 등 체계적인 사용자 관리 기능을 제공합니다.",
      badge: "핵심"
    },
    {
      icon: <BookOpen className="h-6 w-6 text-purple-600" />,
      title: "시나리오 관리",
      description: "훈련 시나리오 등록, 수정, 카테고리 분류 및 난이도 설정을 손쉽게 관리합니다.",
      badge: "핵심"
    },
    {
      icon: <Brain className="h-6 w-6 text-indigo-600" />,
      title: "페르소나 설정",
      description: "MBTI 기반 AI 캐릭터의 성격, 말투, 반응 패턴 등을 시나리오에 맞게 설정합니다.",
      badge: null
    },
    {
      icon: <Target className="h-6 w-6 text-orange-600" />,
      title: "평가기준 설정",
      description: "시나리오별 평가 항목과 가중치를 커스터마이징하여 맞춤형 평가 체계를 운영합니다.",
      badge: null
    },
    {
      icon: <BarChart3 className="h-6 w-6 text-teal-600" />,
      title: "대시보드 & 분석",
      description: "참여율, 평균 점수, 역량 분포 등 핵심 지표를 실시간 대시보드로 모니터링합니다.",
      badge: "핵심"
    },
    {
      icon: <TrendingUp className="h-6 w-6 text-green-600" />,
      title: "성과 리포트",
      description: "사용자별·시나리오별 성과 분석 결과를 CSV 등 다양한 형식으로 내보내기할 수 있습니다.",
      badge: null
    },
    {
      icon: <Shield className="h-6 w-6 text-slate-600" />,
      title: "역할 기반 접근 제어",
      description: "시스템관리자·운영자·일반사용자 3단계 권한 체계로 안전하게 콘텐츠를 관리합니다.",
      badge: null
    },
    {
      icon: <Globe className="h-6 w-6 text-cyan-600" />,
      title: "다국어 콘텐츠 관리",
      description: "한국어, 영어, 일본어, 중국어 4개 언어의 시나리오를 통합 관리합니다.",
      badge: null
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/home">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold text-slate-800">시스템 소개</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12 space-y-16">

        {/* 히어로 섹션 */}
        <section className="text-center space-y-6">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 shadow-lg mx-auto">
            <Users className="h-10 w-10 text-white" />
          </div>
          <div>
            <h2 className="text-4xl font-bold text-slate-900 mb-4">AI 롤플레잉 훈련 시스템</h2>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
              AI와의 실전 같은 대화 훈련으로 직장 내 커뮤니케이션 역량을 빠르고 효과적으로 향상시킵니다.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Badge variant="secondary" className="text-sm px-4 py-1.5">Gemini AI</Badge>
            <Badge variant="secondary" className="text-sm px-4 py-1.5">실시간 음성 대화</Badge>
            <Badge variant="secondary" className="text-sm px-4 py-1.5">MBTI 페르소나</Badge>
            <Badge variant="secondary" className="text-sm px-4 py-1.5">다국어 지원</Badge>
          </div>
        </section>

        {/* 뷰 모드 토글 */}
        <section className="flex justify-center">
          <div className="inline-flex bg-white rounded-xl shadow-md p-1.5 gap-1">
            <button
              onClick={() => setViewMode("user")}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-all ${
                viewMode === "user"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              <UserCircle className="h-4 w-4" />
              사용자 가이드
            </button>
            <button
              onClick={() => setViewMode("operator")}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-all ${
                viewMode === "operator"
                  ? "bg-purple-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Settings className="h-4 w-4" />
              운영자 가이드
            </button>
          </div>
        </section>

        {/* 시스템 개요 */}
        <section>
          <h3 className="text-2xl font-bold text-slate-800 mb-8 text-center">
            {viewMode === "user" ? "왜 AI 롤플레잉 훈련인가?" : "왜 이 시스템을 도입해야 하는가?"}
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            {viewMode === "user" ? (
              <>
                <Card className="border-0 shadow-md text-center">
                  <CardContent className="pt-8 pb-6">
                    <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
                      <Target className="h-7 w-7 text-blue-600" />
                    </div>
                    <h4 className="font-bold text-slate-800 mb-2 text-lg">실전 시나리오</h4>
                    <p className="text-slate-600 text-sm leading-relaxed">
                      실제 업무 현장에서 발생하는 다양한 상황을 시나리오로 구성하여 현실감 있는 훈련을 제공합니다.
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-md text-center">
                  <CardContent className="pt-8 pb-6">
                    <div className="w-14 h-14 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-4">
                      <Award className="h-7 w-7 text-purple-600" />
                    </div>
                    <h4 className="font-bold text-slate-800 mb-2 text-lg">즉각적 피드백</h4>
                    <p className="text-slate-600 text-sm leading-relaxed">
                      대화 종료 즉시 AI가 항목별 점수와 구체적인 개선 방향, 행동 가이드를 제공합니다.
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-md text-center">
                  <CardContent className="pt-8 pb-6">
                    <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                      <TrendingUp className="h-7 w-7 text-green-600" />
                    </div>
                    <h4 className="font-bold text-slate-800 mb-2 text-lg">성장 추적</h4>
                    <p className="text-slate-600 text-sm leading-relaxed">
                      반복 훈련을 통한 점수 변화와 역량별 성장 곡선을 데이터로 확인하고 분석할 수 있습니다.
                    </p>
                  </CardContent>
                </Card>
              </>
            ) : (
              <>
                <Card className="border-0 shadow-md text-center">
                  <CardContent className="pt-8 pb-6">
                    <div className="w-14 h-14 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-4">
                      <Zap className="h-7 w-7 text-purple-600" />
                    </div>
                    <h4 className="font-bold text-slate-800 mb-2 text-lg">효율적 운영</h4>
                    <p className="text-slate-600 text-sm leading-relaxed">
                      시나리오 등록부터 결과 분석까지 하나의 플랫폼에서 훈련 전 과정을 관리할 수 있습니다.
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-md text-center">
                  <CardContent className="pt-8 pb-6">
                    <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
                      <BarChart3 className="h-7 w-7 text-blue-600" />
                    </div>
                    <h4 className="font-bold text-slate-800 mb-2 text-lg">데이터 기반 의사결정</h4>
                    <p className="text-slate-600 text-sm leading-relaxed">
                      참여율, 성과 지표, 역량 분포 등 정량적 데이터로 훈련 효과를 객관적으로 측정합니다.
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-0 shadow-md text-center">
                  <CardContent className="pt-8 pb-6">
                    <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                      <Users className="h-7 w-7 text-green-600" />
                    </div>
                    <h4 className="font-bold text-slate-800 mb-2 text-lg">조직 역량 강화</h4>
                    <p className="text-slate-600 text-sm leading-relaxed">
                      체계적인 훈련 배정과 모니터링으로 조직 전체의 커뮤니케이션 수준을 향상시킵니다.
                    </p>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </section>

        {viewMode === "user" && (
          <>
            {/* 대화 모드 소개 */}
            <section>
              <h3 className="text-2xl font-bold text-slate-800 mb-2 text-center">대화 모드</h3>
              <p className="text-slate-600 text-center mb-8">학습 목적과 환경에 따라 3가지 대화 방식을 선택할 수 있습니다.</p>
              <div className="grid md:grid-cols-3 gap-6">
                {conversationModes.map((mode) => (
                  <Card key={mode.title} className={`border-2 ${mode.color}`}>
                    <CardHeader>
                      <div className={`w-14 h-14 rounded-xl ${mode.iconBg} flex items-center justify-center mb-2`}>
                        {mode.icon}
                      </div>
                      <CardTitle className="text-lg">{mode.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {mode.features.map((feat, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                            <ChevronRight className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                            {feat}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            {/* 핵심 기능 */}
            <section>
              <h3 className="text-2xl font-bold text-slate-800 mb-2 text-center">핵심 기능</h3>
              <p className="text-slate-600 text-center mb-8">커뮤니케이션 역량 향상을 위한 다양한 기능을 제공합니다.</p>
              <div className="grid md:grid-cols-3 gap-5">
                {features.map((feature) => (
                  <Card key={feature.title} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-4">
                        <div className="w-11 h-11 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          {feature.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold text-slate-800 text-sm">{feature.title}</h4>
                            {feature.badge && (
                              <Badge className="text-xs px-1.5 py-0 bg-blue-100 text-blue-700 hover:bg-blue-100">{feature.badge}</Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed">{feature.description}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            {/* 평가 시스템 */}
            <section>
              <h3 className="text-2xl font-bold text-slate-800 mb-2 text-center">ComOn Check 평가 시스템</h3>
              <p className="text-slate-600 text-center mb-8">커뮤니케이션 연구 기반의 체계적인 5점 척도 평가로 객관적인 역량을 측정합니다.</p>
              <Card className="border-0 shadow-md overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white">
                  <div className="flex items-center gap-3 mb-2">
                    <ClipboardList className="h-6 w-6" />
                    <span className="font-bold text-lg">평가 항목 및 채점 방식</span>
                  </div>
                  <p className="text-blue-100 text-sm">각 항목은 1~5점으로 측정되며, 항목별 가중치를 반영한 종합 점수(0~100점)가 산출됩니다.</p>
                </div>
                <CardContent className="p-0">
                  {evaluationItems.map((item, i) => (
                    <div key={i} className={`flex items-center gap-4 p-4 ${i < evaluationItems.length - 1 ? 'border-b border-slate-100' : ''}`}>
                      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-slate-800 text-sm">{item.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {[1, 2, 3, 4, 5].map((dot) => (
                          <div key={dot} className={`w-2.5 h-2.5 rounded-full ${dot <= 3 ? 'bg-blue-400' : 'bg-slate-200'}`} />
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                <div className="bg-white rounded-xl p-4 shadow-sm">
                  <p className="text-2xl font-bold text-slate-800">90~100</p>
                  <p className="text-sm text-slate-500 mt-1">S등급 (최우수)</p>
                </div>
                <div className="bg-white rounded-xl p-4 shadow-sm">
                  <p className="text-2xl font-bold text-slate-800">70~89</p>
                  <p className="text-sm text-slate-500 mt-1">A/B등급 (우수)</p>
                </div>
                <div className="bg-white rounded-xl p-4 shadow-sm">
                  <p className="text-2xl font-bold text-slate-800">0~69</p>
                  <p className="text-sm text-slate-500 mt-1">C/D등급 (개선 필요)</p>
                </div>
              </div>
            </section>
          </>
        )}

        {viewMode === "operator" && (
          <>
            {/* 운영자 핵심 기능 */}
            <section>
              <h3 className="text-2xl font-bold text-slate-800 mb-2 text-center">운영자 핵심 기능</h3>
              <p className="text-slate-600 text-center mb-8">훈련 콘텐츠 관리부터 성과 분석까지 운영에 필요한 기능을 제공합니다.</p>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
                {operatorFeatures.map((feature) => (
                  <Card key={feature.title} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-4">
                        <div className="w-11 h-11 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          {feature.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold text-slate-800 text-sm">{feature.title}</h4>
                            {feature.badge && (
                              <Badge className="text-xs px-1.5 py-0 bg-purple-100 text-purple-700 hover:bg-purple-100">{feature.badge}</Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed">{feature.description}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            {/* 운영자 사용 시나리오 */}
            <section>
              <h3 className="text-2xl font-bold text-slate-800 mb-2 text-center">운영 흐름</h3>
              <p className="text-slate-600 text-center mb-8">시스템 도입 담당자와 운영자가 활용하는 3가지 주요 업무 흐름입니다.</p>
              <div className="grid md:grid-cols-3 gap-6">
                <Card className="border-0 shadow-md overflow-hidden">
                  <div className="bg-gradient-to-br from-blue-500 to-blue-700 p-5 text-white">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                        <BookOpen className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="text-xs text-blue-200 font-medium uppercase tracking-wide">Step 1</p>
                        <h4 className="font-bold text-base">콘텐츠 준비</h4>
                      </div>
                    </div>
                  </div>
                  <CardContent className="pt-5 pb-5">
                    <ol className="space-y-3">
                      {[
                        "조직 / 카테고리 구성",
                        "시나리오 등록",
                        "페르소나 설정",
                        "난이도 및 평가기준 설정"
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                          <span className="text-sm text-slate-700">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-md overflow-hidden">
                  <div className="bg-gradient-to-br from-purple-500 to-purple-700 p-5 text-white">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                        <PlayCircle className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="text-xs text-purple-200 font-medium uppercase tracking-wide">Step 2</p>
                        <h4 className="font-bold text-base">훈련 운영</h4>
                      </div>
                    </div>
                  </div>
                  <CardContent className="pt-5 pb-5">
                    <ol className="space-y-3">
                      {[
                        "사용자 초대 및 권한 부여",
                        "훈련 배정",
                        "진행 현황 모니터링"
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                          <span className="text-sm text-slate-700">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>

                <Card className="border-0 shadow-md overflow-hidden">
                  <div className="bg-gradient-to-br from-teal-500 to-teal-700 p-5 text-white">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                        <LineChart className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="text-xs text-teal-200 font-medium uppercase tracking-wide">Step 3</p>
                        <h4 className="font-bold text-base">결과 분석</h4>
                      </div>
                    </div>
                  </div>
                  <CardContent className="pt-5 pb-5">
                    <ol className="space-y-3">
                      {[
                        "참여율·평균 점수·역량 분포 확인",
                        "시나리오별 / 사용자별 성과 분석",
                        "피드백 내보내기 (CSV 등)",
                        "다음 훈련 계획 수립"
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                          <span className="text-sm text-slate-700">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              </div>
            </section>
          </>
        )}

        {/* 기술 스택 */}
        <section>
          <h3 className="text-2xl font-bold text-slate-800 mb-8 text-center">사용 기술</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: "Google Gemini", desc: "AI 대화 & 피드백" },
              { name: "Gemini Live API", desc: "실시간 음성 대화" },
              { name: "ElevenLabs", desc: "고품질 TTS" },
              { name: "React + TypeScript", desc: "프론트엔드" },
              { name: "Node.js + Express", desc: "백엔드 서버" },
              { name: "PostgreSQL", desc: "데이터베이스" },
              { name: "Google Cloud", desc: "클라우드 인프라" },
              { name: "Drizzle ORM", desc: "데이터 관리" }
            ].map((tech) => (
              <div key={tech.name} className="bg-white rounded-xl p-4 shadow-sm text-center">
                <p className="font-semibold text-slate-800 text-sm">{tech.name}</p>
                <p className="text-xs text-slate-500 mt-1">{tech.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="text-center py-8">
          <div className={`rounded-2xl p-10 text-white ${viewMode === "user" ? "bg-gradient-to-r from-blue-600 to-purple-600" : "bg-gradient-to-r from-purple-600 to-indigo-600"}`}>
            <h3 className="text-2xl font-bold mb-3">
              {viewMode === "user" ? "지금 바로 훈련을 시작하세요" : "지금 바로 시스템을 도입하세요"}
            </h3>
            <p className={`mb-6 ${viewMode === "user" ? "text-blue-100" : "text-purple-100"}`}>
              {viewMode === "user"
                ? "AI 페르소나와의 실전 대화로 커뮤니케이션 역량을 키워보세요."
                : "체계적인 훈련 관리와 데이터 기반 분석으로 조직의 커뮤니케이션 역량을 향상시키세요."}
            </p>
            <Link href="/home">
              <Button size="lg" className={`font-semibold px-8 ${viewMode === "user" ? "bg-white text-blue-700 hover:bg-blue-50" : "bg-white text-purple-700 hover:bg-purple-50"}`}>
                {viewMode === "user" ? "훈련 시작하기" : "관리 시작하기"}
                <ChevronRight className="h-5 w-5 ml-1" />
              </Button>
            </Link>
          </div>
        </section>

      </main>
    </div>
  );
}
