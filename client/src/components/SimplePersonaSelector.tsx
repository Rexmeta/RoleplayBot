import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CheckCircle2, Users, Target, Clock, AlertCircle, ArrowLeft, Loader2, Play, BookOpen, Award } from "lucide-react";
import { type ScenarioPersona, type ComplexScenario } from "@/lib/scenario-system";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { toMediaUrl } from "@/lib/mediaUrl";
import { PersonaPortrait } from "@/components/PersonaPortrait";

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
  const { t } = useTranslation();
  const currentLang = i18n.language || 'ko';
  const [activeTab, setActiveTab] = useState("overview");
  const normalizedCompletedIds = completedPersonaIds.map(id => id.toLowerCase());
  const availablePersonas = personas.filter(p => !normalizedCompletedIds.includes(p.id.toLowerCase()));
  const completedCount = completedPersonaIds.length;
  const totalCount = personas.length;
  const progressPercentage = Math.round((completedCount / totalCount) * 100);

  // 시나리오 번역 가져오기
  const { data: scenarioTranslation } = useQuery({
    queryKey: ['/api/scenarios', scenario?.id, 'translations', currentLang],
    queryFn: async () => {
      if (!scenario?.id || currentLang === 'ko') return null;
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/scenarios/${encodeURIComponent(scenario.id)}/translations/${currentLang}`, {
        credentials: 'include',
        headers
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!scenario?.id && currentLang !== 'ko',
    staleTime: 1000 * 60 * 10,
  });

  // 번역된 skills 가져오기
  const getTranslatedSkills = (originalSkills: string[]): string[] => {
    if (currentLang === 'ko' || !scenarioTranslation?.skills?.length) {
      return originalSkills;
    }
    return scenarioTranslation.skills;
  };
  
  const difficultyLabels: Record<number, { name: string; color: string; bgColor: string; description: string }> = {
    1: { name: t('scenario.difficulty1'), color: "text-green-700", bgColor: "bg-green-500", description: t('scenario.difficulty1Desc') },
    2: { name: t('scenario.difficulty2'), color: "text-blue-700", bgColor: "bg-blue-500", description: t('scenario.difficulty2Desc') },
    3: { name: t('scenario.difficulty3'), color: "text-orange-700", bgColor: "bg-orange-500", description: t('scenario.difficulty3Desc') },
    4: { name: t('scenario.difficulty4'), color: "text-red-700", bgColor: "bg-red-500", description: t('scenario.difficulty4Desc') },
  };

  // Resolve each portrait URL once per persona list, not on every render
  const personaImages = useMemo(() => {
    const map: Record<string, string> = {};
    for (const persona of personas) {
      const genderFolder = persona.gender || 'male';
      const mbtiId = persona.mbti?.toLowerCase() || 'default';
      map[persona.id] = toMediaUrl(`personas/${mbtiId}/${genderFolder}/neutral.webp`);
    }
    return map;
  }, [personas]);

  const heroImage = toMediaUrl((scenario as any)?.thumbnail || (scenario as any)?.image);

  const difficultyLocked = completedPersonaIds.length > 0;
  const sections = [
    { value: "overview", label: t('scenario.tabOverview') },
    { value: "situation", label: t('scenario.tabSituation') },
    { value: "objectives", label: t('scenario.tabObjectives') },
    { value: "criteria", label: t('scenario.tabCriteria') },
  ];
  const sectionCard = "rounded-2xl border border-slate-200/80 bg-white p-[clamp(1.25rem,3vw,2rem)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
  const sectionTitle = "text-[0.95rem] font-semibold tracking-tight text-slate-900";
  const bodyText = "text-sm leading-7 text-slate-600 whitespace-pre-wrap";
  const eyebrow = "text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400";

  const meta = [
    { icon: Clock, label: scenario?.estimatedTime || t('scenario.defaultTime') },
    { icon: Users, label: t('scenario.conversationPartners', { count: totalCount }) },
    { icon: Target, label: t('scenario.competenciesCount', { count: scenario?.skills?.length || 0 }) },
  ];

  const difficultyPicker = (
    <section aria-labelledby="difficulty-heading" data-testid="difficulty-panel">
      <h2 id="difficulty-heading" className={cn(eyebrow, "mb-3 flex items-center gap-1.5")}>
        <Award className="h-3.5 w-3.5" aria-hidden />
        {t('scenario.selectDifficulty')}
      </h2>
      <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-slate-100/80 p-1" role="radiogroup" aria-labelledby="difficulty-heading">
        {[1, 2, 3, 4].map((level) => {
          const active = selectedDifficulty === level;
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={active}
              title={difficultyLabels[level].name}
              onClick={() => completedPersonaIds.length === 0 && onDifficultyChange(level)}
              disabled={difficultyLocked}
              className={cn(
                "min-h-11 rounded-lg px-1 py-1.5 text-center transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1",
                active ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800",
                difficultyLocked && !active && "cursor-not-allowed opacity-50",
              )}
              data-testid={`difficulty-${level}`}
            >
              <span className="block text-base font-semibold tabular-nums">{level}</span>
              <span className="block truncate text-[10px] font-medium leading-tight">{difficultyLabels[level].name}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 text-xs leading-5 text-slate-500">
        {difficultyLocked ? t('scenario.difficultyLocked') : difficultyLabels[selectedDifficulty].description}
      </p>
    </section>
  );

  const personaGrid = (
    <section aria-labelledby="partner-heading" className="space-y-5" data-testid="persona-picker">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={eyebrow}>{t('scenario.conversationPartners', { count: totalCount })}</p>
          <h2 id="partner-heading" className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            {completedCount === 0 ? t('scenario.selectPartner') : t('scenario.nextPartner')}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{t('scenario.selectPartnerHint')}</p>
        </div>
        {completedCount > 0 && (
          <div className="min-w-[10rem] text-right">
            <p className="text-xs font-medium text-slate-600">{t('scenario.completed', { completed: completedCount, total: totalCount })}</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={progressPercentage} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full origin-left rounded-full bg-indigo-600 transition-transform duration-500 motion-reduce:transition-none" style={{ transform: `scaleX(${progressPercentage / 100})` }} />
            </div>
            <p className="mt-1 text-[11px] text-slate-400">{t('scenario.remaining', { count: availablePersonas.length })}</p>
          </div>
        )}
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,13.5rem),1fr))]">
        {personas.map((persona) => {
          const isCompleted = normalizedCompletedIds.includes(persona.id.toLowerCase());
          const isCurrentlyLoading = loadingPersonaId === persona.id;
          const isAvailable = !isCompleted && !isLoading;

          return (
            <Card
              key={persona.id}
              className={cn(
                "group relative flex flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[transform,box-shadow,border-color,opacity] duration-200 motion-reduce:transition-none cursor-pointer",
                isCompleted
                  ? "border-slate-200 opacity-75"
                  : isCurrentlyLoading
                  ? "border-indigo-400 ring-2 ring-indigo-500/30"
                  : "border-slate-200/80 hover:border-indigo-300 hover:shadow-md motion-safe:hover:-translate-y-0.5 focus-within:ring-2 focus-within:ring-indigo-500/50",
                isLoading && !isCurrentlyLoading && "opacity-50 pointer-events-none",
              )}
              onClick={() => isAvailable && !isCurrentlyLoading && onPersonaSelect(persona, selectedDifficulty)}
              data-testid={`persona-card-${persona.id}`}
            >
              <CardContent className="flex flex-1 flex-col p-0">
                <PersonaPortrait
                  src={personaImages[persona.id]}
                  name={persona.name}
                  alt={t('scenario.personaPortraitAlt', { defaultValue: '{{name}}, {{role}}', name: persona.name, role: persona.role || '' })}
                  aspect="4 / 5"
                  imgClassName="motion-safe:group-hover:scale-[1.02] transition-transform duration-500"
                >
                  {isCompleted && (
                    <div className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 shadow-sm" aria-label={t('scenario.completedLabel')}>
                      <CheckCircle2 className="h-4 w-4 text-white" aria-hidden />
                    </div>
                  )}
                  {persona.mbti && (
                    <Badge className="absolute top-3 left-3 border-0 bg-white/90 font-mono text-[10px] tracking-wider text-slate-700 shadow-sm backdrop-blur hover:bg-white">
                      {persona.mbti}
                    </Badge>
                  )}
                </PersonaPortrait>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div>
                    <h3 className="text-[0.95rem] font-semibold tracking-tight text-slate-900">{persona.name}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {persona.role}
                      {persona.department && <span className="text-slate-400"> · {persona.department}</span>}
                    </p>
                  </div>
                  {persona.stance && (
                    <p className="line-clamp-3 text-xs leading-5 text-slate-600">{persona.stance}</p>
                  )}
                  <div className="mt-auto pt-1">
                    {isCompleted ? (
                      <div className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-emerald-50 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        {t('scenario.completedLabel')}
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        className="min-h-11 w-full rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 active:bg-indigo-800 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
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
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                            {t('scenario.preparing')}
                          </>
                        ) : (
                          <>
                            <Play className="mr-1.5 h-4 w-4" aria-hidden />
                            {t('scenario.startConversation')}
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );

  const criteria = scenario ? [
    { label: t('scenario.optimal'), text: scenario.successCriteria?.optimal, bar: "bg-emerald-500" },
    { label: t('scenario.good'), text: scenario.successCriteria?.good, bar: "bg-indigo-500" },
    { label: t('scenario.acceptable'), text: scenario.successCriteria?.acceptable, bar: "bg-amber-500" },
  ] : [];

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      {/* Compact hero */}
      <header className="relative overflow-hidden border-b border-slate-200 bg-slate-900">
        {heroImage && (
          <img src={heroImage} alt="" aria-hidden decoding="async" className="absolute inset-0 h-full w-full object-cover object-center opacity-30" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-900/80 to-indigo-950/60" />
        <div className="relative mx-auto max-w-7xl px-4 py-[clamp(1.25rem,3vw,2.25rem)] sm:px-6">
          {onBack && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="-ml-2 mb-3 min-h-11 gap-1.5 px-2.5 text-white/75 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
              data-testid="back-to-scenarios"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {t('scenario.scenarioList')}
            </Button>
          )}
          {(scenario as any)?.categoryName && (
            <Badge className="mb-2.5 border-white/15 bg-white/10 text-[11px] font-medium text-indigo-100 hover:bg-white/15">
              <BookOpen className="mr-1 h-3 w-3" aria-hidden />
              {(scenario as any).categoryName}
            </Badge>
          )}
          <h1 className="max-w-[40ch] break-words text-[clamp(1.375rem,1rem+1.5vw,2.125rem)] font-semibold leading-tight tracking-tight text-white">
            {scenarioTitle}
          </h1>
          {/* Meta (mobile/tablet only; desktop shows it in the rail) */}
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-white/70 lg:hidden">
            {meta.map(({ icon: Icon, label }, i) => (
              <li key={i} className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" aria-hidden />{label}</li>
            ))}
          </ul>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="mx-auto max-w-7xl px-4 py-[clamp(1.25rem,3vw,2.5rem)] sm:px-6">
        <div className="grid gap-[clamp(1.25rem,3vw,2.5rem)] lg:grid-cols-[minmax(14rem,17rem)_minmax(0,1fr)]">
          {/* Left rail */}
          <aside className="lg:sticky lg:top-6 lg:self-start" data-testid="scenario-detail-rail" aria-label={t('scenario.overview')}>
            <div className="space-y-6 lg:rounded-2xl lg:border lg:border-slate-200/80 lg:bg-white lg:p-5 lg:shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              {scenario && (
                <nav aria-label={t('scenario.overview')}>
                  <p className={cn(eyebrow, "mb-2 hidden lg:block")}>{t('scenario.overview')}</p>
                  <TabsList
                    className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-slate-200/80 [scrollbar-width:none] lg:flex-col lg:items-stretch lg:overflow-visible lg:bg-transparent lg:p-0 lg:ring-0"
                    data-testid="scenario-section-nav"
                  >
                    {sections.map((s) => (
                      <TabsTrigger
                        key={s.value}
                        value={s.value}
                        data-testid={`section-nav-${s.value}`}
                        className="relative min-h-10 shrink-0 justify-start rounded-lg px-3.5 text-sm font-medium text-slate-500 transition-colors motion-reduce:transition-none hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-indigo-500 data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 data-[state=active]:shadow-none lg:w-full lg:before:absolute lg:before:left-0 lg:before:top-2 lg:before:bottom-2 lg:before:w-0.5 lg:before:rounded-full lg:data-[state=active]:before:bg-indigo-600"
                      >
                        {s.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </nav>
              )}

              <ul className="hidden space-y-2.5 border-t border-slate-100 pt-5 text-sm text-slate-600 lg:block" data-testid="scenario-detail-meta">
                {meta.map(({ icon: Icon, label }, i) => (
                  <li key={i} className="flex items-center gap-2.5"><Icon className="h-4 w-4 text-slate-400" aria-hidden />{label}</li>
                ))}
              </ul>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 lg:rounded-none lg:border-0 lg:border-t lg:border-slate-100 lg:p-0 lg:pt-5">
                {difficultyPicker}
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="min-w-0 space-y-[clamp(2rem,4vw,3rem)]">
            {scenario && (
              <div>
                <TabsContent value="overview" className="mt-0 focus-visible:outline-none">
                  <div className={cn(sectionCard, "space-y-6")}>
                    {scenario.description && (
                      <div>
                        <h3 className={sectionTitle}>{t('scenario.scenarioOverview')}</h3>
                        <p className={cn(bodyText, "mt-2")}>{scenario.description}</p>
                      </div>
                    )}
                    <div className="border-t border-slate-100 pt-6">
                      <h3 className={sectionTitle}>{t('scenario.yourRole')}</h3>
                      {scenario.context?.playerRoleText ? (
                        <p className={cn(bodyText, "mt-2")}>{scenario.context.playerRoleText}</p>
                      ) : (
                        <>
                          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                            {[
                              [t('scenario.position'), scenario.context?.playerRole?.position],
                              [t('scenario.department'), scenario.context?.playerRole?.department],
                              [t('scenario.experience'), scenario.context?.playerRole?.experience],
                            ].map(([k, v], i) => (
                              <div key={i} className="rounded-xl bg-slate-50 px-3.5 py-2.5">
                                <dt className="text-[11px] text-slate-500">{k}</dt>
                                <dd className="mt-0.5 font-medium text-slate-900">{v}</dd>
                              </div>
                            ))}
                          </dl>
                          {scenario.context?.playerRole?.responsibility && (
                            <p className={cn(bodyText, "mt-3")}>{scenario.context.playerRole.responsibility}</p>
                          )}
                        </>
                      )}
                    </div>
                    {scenario.skills && scenario.skills.length > 0 && (
                      <div className="border-t border-slate-100 pt-6">
                        <h3 className={sectionTitle}>{t('scenario.keyCompetencies')}</h3>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {getTranslatedSkills(scenario.skills).map((skill, index) => (
                            <Badge key={index} variant="secondary" className={cn("rounded-md border font-medium", index < 2 ? "border-indigo-100 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600")}>
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="situation" className="mt-0 focus-visible:outline-none">
                  <div className={cn(sectionCard, "space-y-6")}>
                    <div>
                      <h3 className={sectionTitle}>{t('scenario.currentSituation')}</h3>
                      <p className={cn(bodyText, "mt-2")}>{scenario.context.situation}</p>
                    </div>
                    <div className="grid gap-4 border-t border-slate-100 pt-6 sm:grid-cols-2">
                      <div>
                        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Clock className="h-3.5 w-3.5" aria-hidden />{t('scenario.timeline')}</p>
                        <p className="mt-1.5 text-sm leading-6 text-slate-700">{scenario.context.timeline}</p>
                      </div>
                      <div>
                        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><AlertCircle className="h-3.5 w-3.5" aria-hidden />{t('scenario.coreIssues')}</p>
                        <p className="mt-1.5 text-sm leading-6 text-slate-700">{scenario.context.stakes}</p>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="objectives" className="mt-0 focus-visible:outline-none">
                  <div className={sectionCard}>
                    <h3 className={sectionTitle}>{t('scenario.objectivesToAchieve')}</h3>
                    <ol className="mt-4 divide-y divide-slate-100">
                      {scenario.objectives.map((obj, index) => (
                        <li key={index} className="flex items-start gap-3.5 py-3 first:pt-0 last:pb-0">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold tabular-nums text-indigo-700">{index + 1}</span>
                          <span className="text-sm leading-6 text-slate-700">{obj}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </TabsContent>

                <TabsContent value="criteria" className="mt-0 focus-visible:outline-none">
                  <div className={sectionCard}>
                    <h3 className={sectionTitle}>{t('scenario.successCriteria')}</h3>
                    <div className="mt-4 space-y-4">
                      {criteria.map((c, i) => (
                        <div key={i} className="flex gap-3.5">
                          <span className={cn("w-1 shrink-0 rounded-full", c.bar)} aria-hidden />
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{c.label}</p>
                            <p className="mt-0.5 text-sm leading-6 text-slate-600">{c.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </TabsContent>
              </div>
            )}

            {personaGrid}
          </main>
        </div>
      </Tabs>
    </div>
  );
}
