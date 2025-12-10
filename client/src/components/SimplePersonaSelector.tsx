import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Users, MessageCircle, Target, Clock, Lightbulb, AlertCircle, TrendingUp, ArrowLeft, Loader2, Play, BookOpen, Award, Briefcase } from "lucide-react";
import { type ScenarioPersona, type ComplexScenario } from "@/lib/scenario-system";

interface SimplePersonaSelectorProps {
  personas: ScenarioPersona[];
  completedPersonaIds: string[];
  onPersonaSelect: (persona: ScenarioPersona, selectedDifficulty: number) => void;
  scenarioTitle: string;
  scenarioSituation?: string;
  scenario?: ComplexScenario;
  onBack?: () => void;
  isLoading?: boolean;
  loadingPersonaId?: string | null;
  selectedDifficulty: number;
  onDifficultyChange: (difficulty: number) => void;
}

export function SimplePersonaSelector({
  personas,
  completedPersonaIds,
  onPersonaSelect,
  scenarioTitle,
  scenarioSituation,
  scenario,
  onBack,
  isLoading = false,
  loadingPersonaId = null,
  selectedDifficulty,
  onDifficultyChange
}: SimplePersonaSelectorProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const availablePersonas = personas.filter(p => !completedPersonaIds.includes(p.id));
  const completedCount = completedPersonaIds.length;
  const totalCount = personas.length;
  const progressPercentage = Math.round((completedCount / totalCount) * 100);
  
  const difficultyLabels: Record<number, { name: string; color: string; bgColor: string; description: string }> = {
    1: { name: "매우 쉬움", color: "text-green-700", bgColor: "bg-green-500", description: "초보자를 위한 친절하고 교육적인 대화" },
    2: { name: "기본", color: "text-blue-700", bgColor: "bg-blue-500", description: "친절하지만 현실적인 대화" },
    3: { name: "도전형", color: "text-orange-700", bgColor: "bg-orange-500", description: "논리적 근거를 요구하는 도전적 대화" },
    4: { name: "고난도", color: "text-red-700", bgColor: "bg-red-500", description: "실전과 같은 압박감 있는 대화" },
  };

  const getPersonaImage = (persona: ScenarioPersona) => {
    const genderFolder = persona.gender || 'male';
    const mbtiId = persona.mbti?.toLowerCase() || 'default';
    return `/personas/${mbtiId}/${genderFolder}/neutral.webp`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* 히어로 헤더 */}
      <div className="relative overflow-hidden">
        {/* 배경 이미지 */}
        <div 
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${(scenario as any)?.thumbnail || (scenario as any)?.image || 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1200&h=400&fit=crop&auto=format'})`,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900/95 via-slate-900/85 to-slate-900/70" />
        
        {/* 히어로 콘텐츠 */}
        <div className="relative z-10 max-w-7xl mx-auto px-6 py-12">
          {/* 네비게이션 */}
          {onBack && (
            <Button
              variant="ghost"
              onClick={onBack}
              className="mb-6 text-white/80 hover:text-white hover:bg-white/10 gap-2"
              data-testid="back-to-scenarios"
            >
              <ArrowLeft className="w-4 h-4" />
              시나리오 목록
            </Button>
          )}
          
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div className="flex-1">
              {/* 카테고리 배지 */}
              {(scenario as any)?.categoryName && (
                <Badge className="mb-4 bg-blue-500/20 text-blue-300 border-blue-400/30 backdrop-blur-sm">
                  <BookOpen className="w-3 h-3 mr-1" />
                  {(scenario as any).categoryName}
                </Badge>
              )}
              
              <h1 className="text-3xl lg:text-4xl font-bold text-white mb-4 leading-tight">
                {scenarioTitle}
              </h1>
              
              {/* 핵심 지표 */}
              <div className="flex flex-wrap items-center gap-4 text-white/80">
                <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2">
                  <Clock className="w-4 h-4" />
                  <span className="text-sm font-medium">{scenario?.estimatedTime || '15-20분'}</span>
                </div>
                <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2">
                  <Users className="w-4 h-4" />
                  <span className="text-sm font-medium">{totalCount}명의 대화 상대</span>
                </div>
                <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2">
                  <Target className="w-4 h-4" />
                  <span className="text-sm font-medium">{scenario?.skills?.length || 0}개 역량</span>
                </div>
              </div>
            </div>
            
            {/* 진행률 표시 */}
            {completedCount > 0 && (
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
                    <span className="text-xl font-bold text-white">{progressPercentage}%</span>
                  </div>
                  <div>
                    <p className="text-white font-semibold">{completedCount}/{totalCount} 완료</p>
                    <p className="text-white/70 text-sm">{availablePersonas.length}명 남음</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 메인 콘텐츠 */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* 왼쪽: 탭 콘텐츠 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 난이도 선택 */}
            <Card className="border-0 shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-6 py-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Award className="w-5 h-5" />
                  대화 난이도 선택
                </h3>
              </div>
              <CardContent className="p-6">
                {completedPersonaIds.length > 0 ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-blue-800 font-medium">
                      🔒 난이도가 고정되었습니다. 첫 대화에서 선택한 난이도가 모든 대화에 적용됩니다.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600 mb-4">{difficultyLabels[selectedDifficulty].description}</p>
                )}
                <div className="grid grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map((level) => (
                    <button
                      key={level}
                      onClick={() => completedPersonaIds.length === 0 && onDifficultyChange(level)}
                      disabled={completedPersonaIds.length > 0}
                      className={`relative p-4 rounded-xl border-2 transition-all duration-300 ${
                        selectedDifficulty === level
                          ? `${difficultyLabels[level].bgColor} border-transparent text-white shadow-lg scale-105`
                          : completedPersonaIds.length > 0
                          ? "bg-slate-100 border-slate-200 cursor-not-allowed opacity-60"
                          : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-md cursor-pointer"
                      }`}
                      data-testid={`difficulty-${level}`}
                    >
                      <div className="text-center">
                        <div className={`text-2xl font-bold mb-1 ${selectedDifficulty === level ? 'text-white' : 'text-slate-700'}`}>
                          {level}
                        </div>
                        <div className={`text-xs font-medium ${selectedDifficulty === level ? 'text-white/90' : 'text-slate-600'}`}>
                          {difficultyLabels[level].name}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 탭 콘텐츠 */}
            {scenario && (
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="w-full grid grid-cols-4 bg-slate-100 p-1 rounded-xl">
                  <TabsTrigger value="overview" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    개요
                  </TabsTrigger>
                  <TabsTrigger value="situation" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    상황
                  </TabsTrigger>
                  <TabsTrigger value="objectives" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    목표
                  </TabsTrigger>
                  <TabsTrigger value="criteria" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    평가 기준
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-6">
                  <Card className="border-0 shadow-md">
                    <CardContent className="p-6 space-y-6">
                      {/* 나의 역할 */}
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <Briefcase className="w-6 h-6 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold text-slate-900 mb-2">나의 역할</h4>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <span className="text-slate-500">직책:</span>
                              <span className="ml-2 font-medium text-slate-900">{scenario.context.playerRole.position}</span>
                            </div>
                            <div>
                              <span className="text-slate-500">부서:</span>
                              <span className="ml-2 font-medium text-slate-900">{scenario.context.playerRole.department}</span>
                            </div>
                            <div>
                              <span className="text-slate-500">경력:</span>
                              <span className="ml-2 font-medium text-slate-900">{scenario.context.playerRole.experience}</span>
                            </div>
                          </div>
                          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                            {scenario.context.playerRole.responsibility}
                          </p>
                        </div>
                      </div>

                      {/* 주요 역량 */}
                      {scenario.skills && scenario.skills.length > 0 && (
                        <div className="pt-4 border-t border-slate-100">
                          <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                            <Lightbulb className="w-4 h-4 text-amber-500" />
                            주요 역량
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {scenario.skills.map((skill, index) => (
                              <Badge 
                                key={index} 
                                variant="secondary"
                                className={`${index < 2 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}
                              >
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="situation" className="mt-6">
                  <Card className="border-0 shadow-md">
                    <CardContent className="p-6 space-y-6">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                          <AlertCircle className="w-6 h-6 text-orange-600" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold text-slate-900 mb-2">현재 상황</h4>
                          <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">
                            {scenario.context.situation}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                        <div className="bg-slate-50 rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Clock className="w-4 h-4 text-slate-500" />
                            <span className="font-medium text-slate-700">타임라인</span>
                          </div>
                          <p className="text-sm text-slate-600">{scenario.context.timeline}</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-4 h-4 text-slate-500" />
                            <span className="font-medium text-slate-700">핵심 이슈</span>
                          </div>
                          <p className="text-sm text-slate-600">{scenario.context.stakes}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="objectives" className="mt-6">
                  <Card className="border-0 shadow-md">
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                          <Target className="w-6 h-6 text-green-600" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold text-slate-900 mb-4">달성해야 할 목표</h4>
                          <ul className="space-y-3">
                            {scenario.objectives.map((obj, index) => (
                              <li key={index} className="flex items-start gap-3 bg-green-50 rounded-lg p-3">
                                <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-sm font-medium flex-shrink-0">
                                  {index + 1}
                                </span>
                                <span className="text-slate-700">{obj}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="criteria" className="mt-6">
                  <Card className="border-0 shadow-md">
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
                          <Award className="w-6 h-6 text-purple-600" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold text-slate-900 mb-4">성공 기준</h4>
                          <div className="space-y-3">
                            <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-lg">🏆</span>
                                <span className="font-semibold text-green-800">최적</span>
                              </div>
                              <p className="text-sm text-green-700">{scenario.successCriteria.optimal}</p>
                            </div>
                            <div className="bg-gradient-to-r from-blue-50 to-sky-50 rounded-xl p-4 border border-blue-200">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-lg">👍</span>
                                <span className="font-semibold text-blue-800">양호</span>
                              </div>
                              <p className="text-sm text-blue-700">{scenario.successCriteria.good}</p>
                            </div>
                            <div className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-xl p-4 border border-amber-200">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-lg">⚠️</span>
                                <span className="font-semibold text-amber-800">수용 가능</span>
                              </div>
                              <p className="text-sm text-amber-700">{scenario.successCriteria.acceptable}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            )}
          </div>

          {/* 오른쪽: 페르소나 선택 */}
          <div className="space-y-6">
            {/* 안내 메시지 */}
            <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-600 to-blue-700">
              <CardContent className="p-5">
                <div className="flex items-start gap-3 text-white">
                  <MessageCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold mb-1">
                      {completedCount === 0 ? '대화 상대 선택' : '다음 대화 상대'}
                    </h3>
                    <p className="text-sm text-blue-100">
                      아래 인물 중 대화할 상대를 선택하세요
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 페르소나 목록 */}
            <div className="space-y-4">
              {personas.map((persona) => {
                const isCompleted = completedPersonaIds.includes(persona.id);
                const isCurrentlyLoading = loadingPersonaId === persona.id;
                const isAvailable = !isCompleted && !isLoading;

                return (
                  <Card 
                    key={persona.id}
                    className={`relative transition-all duration-300 cursor-pointer overflow-hidden ${
                      isCompleted 
                        ? 'border-green-300 bg-green-50/50 opacity-70' 
                        : isCurrentlyLoading
                        ? 'border-blue-400 bg-blue-50 shadow-xl ring-2 ring-blue-400/50'
                        : 'border-slate-200 hover:border-blue-400 hover:shadow-xl hover:-translate-y-1'
                    } ${isLoading && !isCurrentlyLoading ? 'opacity-50 pointer-events-none' : ''}`}
                    onClick={() => isAvailable && !isCurrentlyLoading && onPersonaSelect(persona, selectedDifficulty)}
                    data-testid={`persona-card-${persona.id}`}
                  >
                    <CardContent className="p-0">
                      {/* 페르소나 이미지 배경 - 얼굴이 보이도록 세로 영역 확장 */}
                      <div className="relative h-44 bg-gradient-to-br from-slate-100 to-slate-200 overflow-hidden">
                        <img 
                          src={getPersonaImage(persona)}
                          alt={persona.name}
                          className="absolute inset-0 w-full h-full object-cover object-top opacity-90"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-white via-white/20 to-transparent" />
                        
                        {isCompleted && (
                          <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-green-500 flex items-center justify-center shadow-lg">
                            <CheckCircle2 className="w-5 h-5 text-white" />
                          </div>
                        )}

                        {/* MBTI 배지 - 이미지 위에 표시 */}
                        {persona.mbti && (
                          <Badge className="absolute top-3 left-3 bg-white/90 text-slate-700 text-xs shadow-sm">
                            {persona.mbti}
                          </Badge>
                        )}
                      </div>

                      {/* 페르소나 정보 - 이름, 직급, 소속을 가로 배열 */}
                      <div className="p-4">
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-3">
                          <h3 className="font-bold text-lg text-slate-900">{persona.name}</h3>
                          <span className="text-slate-400">·</span>
                          <span className="text-sm text-slate-600">{persona.role}</span>
                          {persona.department && (
                            <>
                              <span className="text-slate-400">·</span>
                              <span className="text-sm text-slate-500">{persona.department}</span>
                            </>
                          )}
                        </div>

                        {/* 입장/목표 미리보기 */}
                        {persona.stance && (
                          <p className="text-xs text-slate-500 line-clamp-2 mb-3">
                            {persona.stance}
                          </p>
                        )}

                        {/* 액션 버튼 */}
                        {isCompleted ? (
                          <div className="flex items-center justify-center gap-2 py-2 bg-green-100 rounded-lg text-green-700 text-sm font-medium">
                            <CheckCircle2 className="w-4 h-4" />
                            대화 완료
                          </div>
                        ) : (
                          <Button 
                            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-md"
                            disabled={isLoading}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isAvailable && !isCurrentlyLoading) {
                                onPersonaSelect(persona, selectedDifficulty);
                              }
                            }}
                            data-testid={`select-persona-${persona.id}`}
                          >
                            {isCurrentlyLoading ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                준비 중...
                              </>
                            ) : (
                              <>
                                <Play className="w-4 h-4 mr-2" />
                                대화 시작
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
