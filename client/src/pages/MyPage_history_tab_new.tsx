// 새로운 history 탭 코드 - MyPage.tsx의 340-645줄을 교체할 내용

<TabsContent value="history" className="space-y-4">
  {conversations.length === 0 ? (
    <Card>
      <CardContent className="py-12">
        <div className="text-center">
          <div className="text-slate-600">아직 대화 기록이 없습니다.</div>
          <Button 
            onClick={() => window.location.href = '/home'}
            className="mt-4"
            data-testid="start-conversation-button"
          >
            첫 대화 시작하기
          </Button>
        </div>
      </CardContent>
    </Card>
  ) : (
    scenarioAttempts.map((attempt) => {
      const scenario = scenariosMap.get(attempt.scenarioId);
      const personas = attempt.conversations
        .filter((c) => c.status === 'completed')
        .map((conversation) => {
          const persona = (conversation as any).personaSnapshot 
            || scenario?.personas?.find((p: any) => p.id === conversation.personaId);
          const feedback = feedbacksMap.get(conversation.id);
          return { conversation, persona, feedback };
        });

      return (
        <Card key={`${attempt.scenarioId}-${attempt.dateKey}`} data-testid={`card-attempt-${attempt.scenarioId}-${attempt.dateKey}`}>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col">
              <span className="text-sm text-slate-500" data-testid="text-attempt-date">
                {format(new Date(attempt.createdAt), "yyyy년 MM월 dd일 HH:mm")}
              </span>
              <CardTitle className="flex items-center gap-2 flex-wrap" data-testid="text-scenario-title">
                {scenario?.title ?? attempt.scenarioId}
                <Badge variant="outline">#{attempt.attemptNumber}회 시도</Badge>
                {attempt.isCompleted && <Badge className="bg-green-600">완료</Badge>}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {attempt.strategyReflection && (
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-blue-600" data-testid="button-strategy-toggle">
                  <ChevronDown className="h-4 w-4" /> 전략 회고 보기
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-700" data-testid="text-strategy-reflection">
                  {attempt.strategyReflection}
                </CollapsibleContent>
              </Collapsible>
            )}

            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-3" data-testid="text-persona-section">대화한 페르소나들</h4>
              <div className="space-y-2">
                {personas.map(({ conversation, persona, feedback }) => (
                  <div key={conversation.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-persona-${conversation.id}`}>
                    <div className="flex items-center gap-2 text-sm flex-wrap">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <span data-testid={`text-persona-name-${conversation.id}`} className="font-medium">
                        {persona?.department && <span className="text-slate-600 font-normal">{persona.department} </span>}
                        {persona?.name ?? '미상'}
                        {(persona?.position || persona?.role) && <span className="text-slate-600 font-normal"> {persona?.position || persona?.role}</span>}
                      </span>
                      {persona?.mbti && (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          {persona.mbti}
                        </Badge>
                      )}
                      {feedback && (
                        <>
                          <Badge variant="secondary" data-testid={`badge-score-${conversation.id}`}>
                            {feedback.overallScore}점
                          </Badge>
                          <Badge variant="outline">
                            {getScoreBadge(feedback.overallScore)}
                          </Badge>
                        </>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => window.location.href = `/chat/${conversation.id}`} data-testid={`button-view-conversation-${conversation.id}`}>
                        대화 보기
                      </Button>
                      {feedback && (
                        <Button size="sm" onClick={() => window.location.href = `/feedback/${conversation.id}`} data-testid={`button-view-feedback-${conversation.id}`}>
                          피드백 보기
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleDeleteClick(conversation.id)} data-testid={`button-delete-${conversation.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      );
    })
  )}
</TabsContent>
