import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { generateAIResponse } from "../services/geminiService";
import { 
  insertConversationSchema, 
  insertPersonaSelectionSchema, 
  insertStrategyChoiceSchema, 
  insertSequenceAnalysisSchema 
} from "@shared/schema";
import { 
  verifyConversationOwnership, 
  verifyPersonaRunOwnership, 
  checkAndCompleteScenario, 
  buildFreeChatPersona, 
  buildFreeChatScenario,
  generateAndSaveFeedback
} from "./routerHelpers";

export default function createConversationsRouter(isAuthenticated: any) {
  const router = Router();

  // Create new conversation (scenario_run + persona_run 구조)
  router.post("/", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      
      // 게스트 계정 1회 체험 제한 체크
      const user = await storage.getUser(userId);
      if (user && user.email === 'guest@mothle.com') {
        const existingRuns = await storage.getUserScenarioRuns(userId);
        const hasCompletedDemo = existingRuns.some((run: any) => run.status === 'completed');
        if (hasCompletedDemo) {
          return res.status(403).json({ 
            error: "게스트 계정은 1회만 체험할 수 있습니다. 회원가입 후 계속 이용해주세요.",
            errorCode: "GUEST_DEMO_LIMIT_REACHED"
          });
        }
      }
      
      const validatedData = insertConversationSchema.parse(req.body);
      
      // ✨ forceNewRun 플래그 확인 - true이면 항상 새 scenario_run 생성
      const forceNewRun = req.body.forceNewRun === true;
      
      // ✨ 기존 active scenarioRun 찾기 또는 새로 생성
      let scenarioRun;
      
      if (forceNewRun) {
        console.log(`🆕 forceNewRun=true, 새 Scenario Run 강제 생성`);
        scenarioRun = null;
      } else {
        scenarioRun = await storage.findActiveScenarioRun(userId, validatedData.scenarioId);
      }
      
      if (scenarioRun) {
        console.log(`♻️ 기존 Scenario Run 재사용: ${scenarioRun.id} (attempt #${scenarioRun.attemptNumber})`);
      } else {
        // 시도 번호 계산 (같은 사용자가 같은 시나리오를 몇 번째로 실행하는지)
        const existingRuns = await storage.getUserScenarioRuns(userId);
        const sameScenarioRuns = existingRuns.filter(r => r.scenarioId === validatedData.scenarioId);
        const attemptNumber = sameScenarioRuns.length + 1;
        
        scenarioRun = await storage.createScenarioRun({
          userId,
          scenarioId: validatedData.scenarioId,
          scenarioName: validatedData.scenarioName,
          attemptNumber,
          mode: validatedData.mode,
          difficulty: validatedData.difficulty,
          status: 'active'
        });
        
        console.log(`📋 새로운 Scenario Run 생성: ${scenarioRun.id} (attempt #${attemptNumber})`);
      }
      
      // ✨ 새로운 구조: persona_run 생성
      const personaId = validatedData.personaId || validatedData.scenarioId;
      
      // 시나리오에서 페르소나 정보 가져오기
      const scenarioFromDb = await storage.getScenario(validatedData.scenarioId);
      if (!scenarioFromDb) {
        return res.status(404).json({ error: "시나리오를 찾을 수 없습니다.", errorCode: "SCENARIO_NOT_FOUND" });
      }
      if (scenarioFromDb.isDeleted) {
        return res.status(410).json({ error: "이 시나리오는 삭제되어 더 이상 이용할 수 없습니다.", errorCode: "SCENARIO_DELETED" });
      }
      
      const scenarios = await fileManager.getAllScenarios();
      const scenarioObj = scenarios.find(s => s.id === validatedData.scenarioId);
      if (!scenarioObj) {
        throw new Error(`Scenario not found: ${validatedData.scenarioId}`);
      }
      
      const scenarioPersona = scenarioObj.personas.find((p: any) => p.id === personaId) as any;
      if (!scenarioPersona) {
        throw new Error(`Persona not found in scenario: ${personaId}`);
      }
      
      const mbtiType = (scenarioPersona as any).mbti || (scenarioPersona as any).personaRef?.replace('.json', '');
      const mbtiPersona = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;
      
      // ✨ phase 자동 계산: 같은 scenario_run 내의 persona_run 개수 + 1
      const existingPersonaRuns = await storage.getPersonaRunsByScenarioRun(scenarioRun.id);
      const phase = existingPersonaRuns.length + 1;
      
      const personaRun = await storage.createPersonaRun({
        scenarioRunId: scenarioRun.id,
        personaId,
        personaName: (scenarioPersona as any).name,
        personaSnapshot: validatedData.personaSnapshot || {},
        mbtiType: mbtiType || null,
        phase,
        mode: validatedData.mode,
        difficulty: validatedData.difficulty || 2,
        status: 'active'
      });
      
      console.log(`👤 Persona Run 생성: ${personaRun.id}, mode=${validatedData.mode}`);
      
      // 실시간 음성 모드는 WebSocket을 통해 초기 메시지를 받으므로 건너뛰기
      if (validatedData.mode === 'realtime_voice') {
        console.log('🎙️ 실시간 음성 모드 - Gemini 호출 건너뛰기');
        return res.json({
          id: personaRun.id,
          scenarioRunId: scenarioRun.id,
          scenarioId: validatedData.scenarioId,
          scenarioName: validatedData.scenarioName,
          personaId,
          personaSnapshot: validatedData.personaSnapshot,
          messages: [],
          turnCount: 0,
          status: 'active',
          mode: validatedData.mode,
          difficulty: validatedData.difficulty || 2,
          userId,
          createdAt: scenarioRun.startedAt,
          updatedAt: scenarioRun.startedAt
        });
      }
      
      console.log('💬 텍스트/TTS 모드 - Gemini로 초기 메시지 생성');
      
      try {
        const scenarioPersonaAny = scenarioPersona as any;
        const mbtiPersonaAny = mbtiPersona as any;
        const persona = {
          id: scenarioPersonaAny.id,
          name: scenarioPersonaAny.name,
          role: scenarioPersonaAny.position,
          department: scenarioPersonaAny.department,
          personality: mbtiPersonaAny?.communication_style || mbtiPersonaAny?.communicationStyle || '균형 잡힌 의사소통',
          responseStyle: mbtiPersonaAny?.communication_patterns?.opening_style || mbtiPersonaAny?.communicationPatterns?.opening_style || '상황에 맞는 방식으로 대화 시작',
          goals: mbtiPersonaAny?.communication_patterns?.win_conditions || mbtiPersonaAny?.communicationPatterns?.win_conditions || ['목표 달성'],
          background: mbtiPersonaAny?.background?.personal_values?.join(', ') || mbtiPersonaAny?.background?.personalValues?.join(', ') || '전문성'
        };

        // 사용자가 선택한 난이도를 시나리오 객체에 적용
        const scenarioWithUserDifficulty = {
          ...scenarioObj,
          difficulty: validatedData.difficulty || 2 // 사용자가 선택한 난이도 사용
        };

        // 사용자 언어 설정 가져오기
        const user = await storage.getUser(userId);
        const userLanguage = (user?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';
        
        const AI_TIMEOUT_MS = 25000;
        const aiResult = await Promise.race([
          generateAIResponse(
            scenarioWithUserDifficulty as any,
            [],
            persona,
            undefined,
            userLanguage
          ),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('AI 응답 시간 초과 (25초). 다시 시도해 주세요.')), AI_TIMEOUT_MS)
          )
        ]);

        // ✨ 새로운 구조: chat_messages에 첫 AI 메시지 저장
        await storage.createChatMessage({
          personaRunId: personaRun.id,
          sender: "ai",
          message: aiResult.content,
          turnIndex: 0,
          emotion: aiResult.emotion || null,
          emotionReason: aiResult.emotionReason || null
        });
        
        // ✨ actualStartedAt 업데이트 (첫 AI 응답 생성 시점)
        await storage.updatePersonaRun(personaRun.id, {
          actualStartedAt: new Date()
        });
        
        console.log(`💬 첫 AI 메시지 생성 완료`);

        // 레거시 호환성을 위해 conversations 구조로 반환
        res.json({
          id: personaRun.id,
          scenarioRunId: scenarioRun.id,
          scenarioId: validatedData.scenarioId,
          scenarioName: validatedData.scenarioName,
          personaId,
          personaSnapshot: validatedData.personaSnapshot,
          messages: [{
            sender: "ai",
            message: aiResult.content,
            timestamp: new Date().toISOString(),
            emotion: aiResult.emotion,
            emotionReason: aiResult.emotionReason
          }],
          turnCount: 0,
          status: 'active',
          mode: validatedData.mode,
          difficulty: validatedData.difficulty,
          userId,
          createdAt: scenarioRun.startedAt,
          updatedAt: scenarioRun.startedAt
        });
      } catch (aiError) {
        console.error("AI 초기 메시지 생성 실패:", aiError);
        // AI 메시지 생성 실패해도 대화는 생성되도록 함
        res.json({
          id: personaRun.id,
          scenarioRunId: scenarioRun.id,
          scenarioId: validatedData.scenarioId,
          scenarioName: validatedData.scenarioName,
          personaId,
          personaSnapshot: validatedData.personaSnapshot,
          messages: [],
          turnCount: 0,
          status: 'active',
          mode: validatedData.mode,
          difficulty: validatedData.difficulty,
          userId,
          createdAt: scenarioRun.startedAt,
          updatedAt: scenarioRun.startedAt
        });
      }
    } catch (error) {
      console.error("대화 생성 오류:", error);
      res.status(400).json({ error: "Invalid conversation data" });
    }
  });

  // Get all conversations for the current user
  router.get("/", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      
      const conversations = await storage.getUserConversations(userId);
      res.json(conversations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Get conversation by ID (persona_run 구조)
  router.get("/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const personaRunId = req.params.id;

      // ✨ 새로운 구조: persona_run 조회
      const personaRun = await storage.getPersonaRun(personaRunId);
      if (!personaRun) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // ✨ scenario_run 조회하여 권한 확인 (관리자/운영자는 모든 대화 열람 가능)
      const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
      const requestUser = req.user as any;
      const isAdminOrOperator = requestUser?.role === 'admin' || requestUser?.role === 'operator';
      if (!scenarioRun || (!isAdminOrOperator && scenarioRun.userId !== userId)) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      // ✨ chat_messages 조회
      const chatMessages = await storage.getChatMessagesByPersonaRun(personaRunId);

      // 레거시 conversations 구조로 변환하여 반환 (GET /api/conversations/:id)
      const messages = chatMessages.map(msg => ({
        sender: msg.sender as "user" | "ai",
        message: msg.message,
        timestamp: msg.createdAt.toISOString(),
        emotion: msg.emotion || undefined,
        emotionReason: msg.emotionReason || undefined
      }));

      res.json({
        id: personaRun.id,
        scenarioRunId: scenarioRun.id, // scenarioRunId 추가
        scenarioId: scenarioRun.scenarioId,
        scenarioName: scenarioRun.scenarioName,
        personaId: personaRun.personaId,
        personaSnapshot: personaRun.personaSnapshot,
        messages,
        turnCount: personaRun.turnCount,
        status: personaRun.status,
        mode: personaRun.mode || scenarioRun.mode, // personaRun에서 먼저 가져오기
        difficulty: personaRun.difficulty || scenarioRun.difficulty, // personaRun에서 먼저 가져오기
        userId: scenarioRun.userId,
        createdAt: personaRun.startedAt,
        updatedAt: personaRun.completedAt || personaRun.startedAt
      });
    } catch (error) {
      console.error("대화 조회 오류:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Delete conversation by ID (시나리오 세션 단위 삭제)
  router.delete("/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const result = await verifyConversationOwnership(req.params.id, userId);
      
      if ('error' in result) {
        return res.status(result.status!).json({ error: result.error });
      }
      
      const sessionConversation = result.conversation!;
      const conversationOrder = sessionConversation.conversationOrder || [];
      
      // conversationOrder가 있는 경우, 연관된 모든 페르소나 대화도 삭제
      if (conversationOrder.length > 0) {
        console.log(`시나리오 세션 삭제: ${req.params.id}, 연관 페르소나: ${conversationOrder.length}개`);
        
        const sessionTime = new Date(sessionConversation.createdAt).getTime();
        const TIME_WINDOW = 24 * 60 * 60 * 1000; // 24시간
        const allConversations = await storage.getUserConversations(userId);
        
        // conversationOrder에 있는 personaId와 매칭되는 페르소나 대화 찾기
        // 안전성을 위해 여러 조건 확인:
        // 1. 같은 scenarioId
        // 2. personaId가 conversationOrder에 있음
        // 3. status가 'completed'
        // 4. 세션 대화 이전에 생성됨 (페르소나 대화가 먼저 완료되고 세션이 생성됨)
        // 5. 세션과 시간이 너무 멀지 않음 (24시간 이내)
        // 6. 세션 자체가 아님 (중복 삭제 방지)
        const personaConversationsToDelete = allConversations.filter(c => {
          if (c.id === req.params.id) return false; // 세션 자체 제외
          
          const convTime = new Date(c.createdAt).getTime();
          const isWithinTimeWindow = Math.abs(sessionTime - convTime) < TIME_WINDOW;
          const isBeforeSession = convTime <= sessionTime;
          
          return c.scenarioId === sessionConversation.scenarioId &&
            conversationOrder.includes(c.personaId!) &&
            c.status === 'completed' &&
            isBeforeSession &&
            isWithinTimeWindow;
        });
        
        // 중복 제거 (같은 personaId가 여러 번 있을 수 있으므로 최신 것만 선택)
        const personaConversationsByPersona = new Map<string, any>();
        for (const conv of personaConversationsToDelete) {
          const existing = personaConversationsByPersona.get(conv.personaId!);
          if (!existing || new Date(conv.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
            personaConversationsByPersona.set(conv.personaId!, conv);
          }
        }
        
        // 식별된 페르소나 대화들 삭제
        for (const personaConversation of Array.from(personaConversationsByPersona.values())) {
          console.log(`  - 페르소나 대화 삭제: ${personaConversation.id} (${personaConversation.personaId})`);
          try {
            await storage.deleteConversation(personaConversation.id);
          } catch (err) {
            console.error(`    페르소나 대화 삭제 실패: ${personaConversation.id}`, err);
            // 계속 진행 (다른 대화들도 삭제 시도)
          }
        }
        
        console.log(`  총 ${personaConversationsByPersona.size}개의 페르소나 대화 삭제 완료`);
      } else {
        console.log(`단일 대화 삭제: ${req.params.id}`);
      }
      
      // 세션 대화 자체 삭제
      await storage.deleteConversation(req.params.id);
      
      res.json({ success: true, message: "대화가 삭제되었습니다." });
    } catch (error) {
      console.error("대화 삭제 오류:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // Send message and get AI response (새 구조: persona_runs + chat_messages)
  router.post("/:id/messages", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const personaRunId = req.params.id;
      
      // ✨ 새 구조: persona_run 권한 확인
      const ownershipResult = await verifyPersonaRunOwnership(personaRunId, userId);
      
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status!).json({ error: ownershipResult.error });
      }

      const { personaRun, scenarioRun } = ownershipResult;

      const { message } = req.body;
      if (typeof message !== "string") {
        return res.status(400).json({ error: "Message must be a string" });
      }
      
      // 빈 메시지는 건너뛰기 기능으로 허용
      const isSkipTurn = message.trim() === "";

      if (personaRun!.status === "completed") {
        return res.status(400).json({ error: "Conversation already completed" });
      }

      // ✨ 새 구조: chat_messages에서 기존 메시지 조회
      const existingMessages = await storage.getChatMessagesByPersonaRun(personaRunId);
      const currentTurnIndex = Math.floor(existingMessages.length / 2); // user + ai = 1 turn

      // ✨ 대화 재개 감지: 마지막 메시지 이후 5분 이상 지났으면 actualStartedAt 업데이트
      if (existingMessages.length > 0) {
        const lastMessage = existingMessages[existingMessages.length - 1];
        const timeSinceLastMessage = Date.now() - new Date(lastMessage.createdAt).getTime();
        const RESUME_THRESHOLD_MS = 5 * 60 * 1000; // 5분
        
        if (timeSinceLastMessage > RESUME_THRESHOLD_MS) {
          console.log(`🔄 대화 재개 감지: ${Math.floor(timeSinceLastMessage / 1000 / 60)}분 경과, actualStartedAt 업데이트`);
          await storage.updatePersonaRun(personaRunId, {
            actualStartedAt: new Date()
          });
        }
      }

      // 건너뛰기가 아닌 경우에만 사용자 메시지 추가
      if (!isSkipTurn) {
        await storage.createChatMessage({
          personaRunId,
          sender: "user",
          message,
          turnIndex: currentTurnIndex
        });
      }

      const newTurnCount = personaRun!.turnCount + 1;

      // Generate AI response
      const personaId = personaRun!.personaId;

      // ── 자유 대화 vs 시나리오 대화 분기 ────────────────────────────────────
      let persona: any;
      let scenarioWithUserDifficulty: any;

      if (scenarioRun!.scenarioId === "__free_chat__") {
        // 자유 대화: personaRun.personaSnapshot에서 페르소나 구성
        const snapshot = personaRun!.personaSnapshot as any || {};
        persona = buildFreeChatPersona(snapshot);
        scenarioWithUserDifficulty = buildFreeChatScenario(snapshot, personaRun!.difficulty || scenarioRun!.difficulty || 2);
      } else if (scenarioRun!.scenarioId?.startsWith("__user_persona__:")) {
        // 사용자 제작 페르소나 대화
        const userPersonaId = scenarioRun!.scenarioId.split(":")[1];
        const userPersonaData = await storage.getUserPersonaById(userPersonaId);
        if (!userPersonaData) throw new Error(`UserPersona not found: ${userPersonaId}`);
        const p = userPersonaData.personality as any || {};
        persona = {
          id: userPersonaData.id,
          name: userPersonaData.name,
          role: "대화 상대",
          department: "",
          mbti: "",
          gender: "neutral",
          image: userPersonaData.avatarUrl || undefined,
          personality: {
            traits: p.traits || [],
            communicationStyle: p.communicationStyle || "",
            motivation: p.background || "",
            fears: [],
          },
          rawPersonality: p,
          description: userPersonaData.description,
          greeting: userPersonaData.greeting,
        };
        scenarioWithUserDifficulty = {
          id: `__user_persona__:${userPersonaData.id}`,
          title: `${userPersonaData.name}와의 대화`,
          description: userPersonaData.description,
          context: {
            situation: userPersonaData.description || "자유로운 대화 상황",
            timeline: "현재",
            stakes: "자유 대화",
            playerRole: { position: "대화 참여자", department: "", experience: "", responsibility: "편하게 대화하기" },
          },
          objectives: ["자유롭게 대화하기"],
          personas: [],
          difficulty: personaRun!.difficulty || scenarioRun!.difficulty || 2,
          successCriteria: { optimal: "자연스러운 대화", good: "적극적인 소통", acceptable: "기본 대화 유지", failure: "대화 거부" },
          _userPersonaMode: true,
          _userPersonaSystemPrompt: `당신은 "${userPersonaData.name}"라는 AI 캐릭터입니다.

${userPersonaData.description ? `캐릭터 설명: ${userPersonaData.description}` : ""}
${p.background ? `배경: ${p.background}` : ""}
${p.traits?.length ? `성격 특성: ${p.traits.join(", ")}` : ""}
${p.communicationStyle ? `대화 방식: ${p.communicationStyle}` : ""}
${p.speechStyle ? `말투: ${p.speechStyle}` : ""}

위 캐릭터로서 자연스럽게 대화하세요. 캐릭터의 성격, 말투, 배경을 일관되게 유지하세요.
사용자와 자유롭게 대화하고, 사용자가 묻는 것에 캐릭터에 맞게 답변하세요.`,
        };
      } else {
        // 시나리오 기반 대화: 기존 로직
        const scenarios = await fileManager.getAllScenarios();
        const scenarioObj = scenarios.find(s => s.id === scenarioRun!.scenarioId);
        if (!scenarioObj) throw new Error(`Scenario not found: ${scenarioRun!.scenarioId}`);

        const scenarioPersona: any = scenarioObj.personas.find((p: any) => p.id === personaId);
        if (!scenarioPersona) throw new Error(`Persona not found in scenario: ${personaId}`);

        const mbtiType = scenarioPersona.personaRef?.replace('.json', '');
        const mbtiPersonaData: any = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;

        persona = {
          id: scenarioPersona.id,
          name: scenarioPersona.name,
          role: scenarioPersona.position,
          department: scenarioPersona.department,
          personality: mbtiPersonaData?.communication_style || (mbtiPersonaData as any)?.communicationStyle || '균형 잡힌 의사소통',
          responseStyle: mbtiPersonaData?.communication_patterns?.opening_style || (mbtiPersonaData as any)?.communicationPatterns?.opening_style || '상황에 맞는 방식으로 대화 시작',
          goals: mbtiPersonaData?.communication_patterns?.win_conditions || (mbtiPersonaData as any)?.communicationPatterns?.win_conditions || ['목표 달성'],
          background: mbtiPersonaData?.background?.personal_values?.join(', ') || (mbtiPersonaData as any)?.background?.personalValues?.join(', ') || '전문성'
        };

        scenarioWithUserDifficulty = {
          ...scenarioObj,
          difficulty: personaRun!.difficulty || scenarioRun!.difficulty
        };
      }
      // ────────────────────────────────────────────────────────────────────────

      // ✨ 메시지를 ConversationMessage 형식으로 변환
      const messagesForAI = (isSkipTurn ? existingMessages : [...existingMessages, {
        id: "temp",
        createdAt: new Date(),
        personaRunId,
        sender: "user" as const,
        message,
        turnIndex: currentTurnIndex,
        emotion: null,
        emotionReason: null
      }]).map(msg => ({
        sender: msg.sender as "user" | "ai",
        message: msg.message,
        timestamp: msg.createdAt.toISOString(),
        emotion: msg.emotion || undefined,
        emotionReason: msg.emotionReason || undefined
      }));

      // 사용자 언어 설정 가져오기
      const user = await storage.getUser(userId);
      const userLanguage = (user?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';

      const aiResult = await generateAIResponse(
        scenarioWithUserDifficulty as any,
        messagesForAI,
        persona,
        undefined,
        userLanguage
      );

      // ✨ 새 구조: chat_messages에 AI 응답 저장
      await storage.createChatMessage({
        personaRunId,
        sender: "ai",
        message: aiResult.content,
        turnIndex: currentTurnIndex,
        emotion: aiResult.emotion || null,
        emotionReason: aiResult.emotionReason || null
      });

      // Update persona run turn count and status
      const isCompleted = (aiResult as any).isCompleted || false;
      const updatedPersonaRun = await storage.updatePersonaRun(personaRunId, {
        turnCount: newTurnCount,
        status: isCompleted ? "completed" : "active",
        completedAt: isCompleted ? new Date() : null
      });

      // 만약 완료되었다면 시나리오 전체 완료 여부 체크
      if (isCompleted) {
        await checkAndCompleteScenario(personaRun!.scenarioRunId);
      }

      res.json({
        message: aiResult.content,
        emotion: aiResult.emotion,
        emotionReason: aiResult.emotionReason,
        isCompleted,
        turnCount: newTurnCount,
        personaRun: updatedPersonaRun,
        messages: [{
          sender: "ai",
          message: aiResult.content,
          timestamp: new Date().toISOString(),
          emotion: aiResult.emotion,
          emotionReason: aiResult.emotionReason
        }]
      });
    } catch (error) {
      console.error("Message error:", error);
      res.status(500).json({ error: "Failed to process message" });
    }
  });

  // Batch save messages from realtime voice session
  router.post("/:id/realtime-messages", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const personaRunId = req.params.id;
      
      const ownershipResult = await verifyPersonaRunOwnership(personaRunId, userId);
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status!).json({ error: ownershipResult.error });
      }

      const { personaRun } = ownershipResult;
      const { messages } = req.body;

      if (!Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages must be an array" });
      }

      console.log(`🎙️ 실시간 음성 대화 메시지 일괄 저장: ${personaRunId}, ${messages.length}개 메시지`);

      // 1. 기존 메시지 삭제 (있다면)
      await storage.deleteChatMessagesByPersonaRun(personaRunId);

      // 2. 새 메시지들 저장
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        await storage.createChatMessage({
          personaRunId,
          sender: msg.sender,
          message: msg.message,
          turnIndex: Math.floor(i / 2),
          emotion: msg.emotion || null,
          emotionReason: msg.emotionReason || null,
          createdAt: msg.timestamp ? new Date(msg.timestamp) : new Date()
        });
      }

      // 3. 상태를 'completed'로 업데이트
      const turnCount = Math.floor(messages.length / 2);
      await storage.updatePersonaRun(personaRunId, {
        status: 'completed',
        completedAt: new Date(),
        turnCount
      });

      // 4. 시나리오 전체 완료 여부 체크
      await checkAndCompleteScenario(personaRun!.scenarioRunId);

      res.json({ success: true, turnCount });
    } catch (error) {
      console.error("Error saving realtime messages:", error);
      res.status(500).json({ error: "Failed to save realtime messages" });
    }
  });

  // Reset conversation (delete all messages and reset status)
  router.delete("/:id/messages", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const personaRunId = req.params.id;
      
      const ownershipResult = await verifyPersonaRunOwnership(personaRunId, userId);
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status!).json({ error: ownershipResult.error });
      }

      // 1. 해당 personaRun의 모든 메시지 삭제
      await storage.deleteChatMessagesByPersonaRun(personaRunId);

      // 2. personaRun 상태 초기화
      const updatedPersonaRun = await storage.updatePersonaRun(personaRunId, {
        status: "active",
        turnCount: 0,
        completedAt: null,
        score: null
      });
      
      // 3. 연관된 피드백 삭제
      const feedback = await storage.getFeedbackByConversationId(personaRunId);
      if (feedback) {
        await storage.deleteFeedback(feedback.id);
      }

      res.json({ success: true, personaRun: updatedPersonaRun });
    } catch (error) {
      console.error("Error resetting conversation:", error);
      res.status(500).json({ error: "Failed to reset conversation" });
    }
  });

  // Save persona selection for a conversation (persona_run 구조)
  router.post("/:id/persona-selections", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const conversationId = req.params.id;

      const ownershipResult = await verifyPersonaRunOwnership(conversationId, userId);
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status!).json({ error: ownershipResult.error });
      }
      
      const validationResult = insertPersonaSelectionSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Invalid selection data", 
          details: validationResult.error.issues 
        });
      }

      const conversation = await storage.addPersonaSelection(conversationId, validationResult.data);
      res.json({ success: true, conversation });
    } catch (error) {
      res.status(400).json({ error: "Invalid selection data" });
    }
  });

  // Get persona selections for a conversation
  router.get("/:id/persona-selections", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const ownershipResult = await verifyPersonaRunOwnership(req.params.id, userId);
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status!).json({ error: ownershipResult.error });
      }
      const selections = await storage.getPersonaSelections(req.params.id);
      res.json(selections);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch selections" });
    }
  });

  // Save sequence plan (multiple persona selections at once)
  router.post("/:id/sequence-plan", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const conversationId = req.params.id;

      const ownershipResult = await verifyPersonaRunOwnership(conversationId, userId);
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status!).json({ error: ownershipResult.error });
      }

      const { sequencePlan, conversationType } = req.body;

      if (!Array.isArray(sequencePlan)) {
        return res.status(400).json({ error: "sequencePlan must be an array" });
      }

      for (const selection of sequencePlan) {
        const validationResult = insertPersonaSelectionSchema.safeParse(selection);
        if (!validationResult.success) {
          return res.status(400).json({ 
            error: "Invalid selection in sequence plan", 
            details: validationResult.error.issues 
          });
        }
      }
      
      const conversation = await storage.updateConversation(conversationId, {
        personaSelections: sequencePlan,
        conversationType: conversationType || 'sequential',
        totalPhases: sequencePlan.length
      });

      res.json({ success: true, conversation });
    } catch (error) {
      res.status(400).json({ error: "Invalid sequence plan data" });
    }
  });

  // Save strategy choice
  router.post("/:id/strategy-choices", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const ownershipResult = await verifyPersonaRunOwnership(req.params.id, userId);
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status!).json({ error: ownershipResult.error });
      }

      const validationResult = insertStrategyChoiceSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Invalid strategy choice data", 
          details: validationResult.error.issues 
        });
      }

      const conversation = await storage.addStrategyChoice(req.params.id, validationResult.data);
      res.json({ success: true, conversation });
    } catch (error) {
      res.status(400).json({ error: "Invalid strategy choice data" });
    }
  });

  // Get strategy choices
  router.get("/:id/strategy-choices", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const ownershipResult = await verifyPersonaRunOwnership(req.params.id, userId);
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status!).json({ error: ownershipResult.error });
      }
      const choices = await storage.getStrategyChoices(req.params.id);
      res.json(choices);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategy choices" });
    }
  });

  // Save sequence analysis
  router.post("/:id/sequence-analysis", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const ownershipResult = await verifyPersonaRunOwnership(req.params.id, userId);
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status!).json({ error: ownershipResult.error });
      }

      const validationResult = insertSequenceAnalysisSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Invalid sequence analysis data", 
          details: validationResult.error.issues 
        });
      }

      const conversation = await storage.saveSequenceAnalysis(req.params.id, validationResult.data);
      res.json({ success: true, conversation });
    } catch (error) {
      res.status(400).json({ error: "Invalid sequence analysis data" });
    }
  });

  // Get sequence analysis
  router.get("/:id/sequence-analysis", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const ownershipResult = await verifyPersonaRunOwnership(req.params.id, userId);
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status!).json({ error: ownershipResult.error });
      }
      const analysis = await storage.getSequenceAnalysis(req.params.id);
      if (!analysis) {
        return res.status(404).json({ error: "Sequence analysis not found" });
      }
      res.json(analysis);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sequence analysis" });
    }
  });

  // Save strategy reflection (사용자 직접 입력)
  router.post("/:id/strategy-reflection", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const ownershipResult = await verifyPersonaRunOwnership(req.params.id, userId);
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status!).json({ error: ownershipResult.error });
      }

      const { strategyReflection, conversationOrder } = req.body;
      if (typeof strategyReflection !== 'string') {
        return res.status(400).json({ error: "Strategy reflection text is required" });
      }
      if (!Array.isArray(conversationOrder)) {
        return res.status(400).json({ error: "Conversation order must be an array" });
      }

      const conversation = await storage.saveStrategyReflection(
        req.params.id,
        strategyReflection,
        conversationOrder
      );

      res.json({ success: true, conversation });
    } catch (error) {
      res.status(500).json({ error: "Failed to save strategy reflection" });
    }
  });

  // POST /api/conversations/:id/feedback — generate or regenerate feedback
  router.post("/:id/feedback", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const personaRunId = req.params.id;
      const { force } = req.body;

      const personaRun = await storage.getPersonaRun(personaRunId);
      if (!personaRun) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
      const requestUser = req.user as any;
      const isAdminOrOperator = requestUser?.role === 'admin' || requestUser?.role === 'operator';
      if (!scenarioRun || (!isAdminOrOperator && scenarioRun.userId !== userId)) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      if (force) {
        const existingFeedback = await storage.getFeedbackByConversationId(personaRunId);
        if (existingFeedback) {
          await storage.deleteFeedback(existingFeedback.id);
          console.log(`피드백 삭제 (재생성): ${personaRunId}`);
        }
      }

      // Build conversation object from chat_messages (new data model)
      const chatMessages = await storage.getChatMessagesByPersonaRun(personaRunId);
      const conversation = {
        id: personaRunId,
        messages: chatMessages.map((msg: any) => ({
          sender: msg.sender,
          message: msg.message,
          timestamp: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : msg.createdAt,
          emotion: msg.emotion || undefined,
          emotionReason: msg.emotionReason || undefined
        })),
        status: personaRun.status,
        createdAt: personaRun.startedAt,
        completedAt: personaRun.completedAt
      };

      const scenarios = await fileManager.getAllScenarios();
      const scenarioObj = scenarios.find((s: any) => s.id === scenarioRun!.scenarioId);
      if (!scenarioObj) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      const personas = scenarioObj.personas || [];
      const persona = personas.find((p: any) => p.id === personaRun.personaId) || personas[0];

      const user = await storage.getUser(userId);
      const userLanguage = (user?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';

      const feedback = await generateAndSaveFeedback(personaRunId, conversation, scenarioObj, persona, userLanguage);
      res.json(feedback);
    } catch (error: any) {
      console.error("피드백 생성 오류:", error);
      res.status(500).json({ error: error.message || "Failed to generate feedback" });
    }
  });

  // GET /api/conversations/:id/feedback
  router.get("/:id/feedback", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const personaRunId = req.params.id;

      const feedback = await storage.getFeedbackByConversationId(personaRunId);
      if (!feedback) {
        return res.status(404).json({ error: "Feedback not found" });
      }

      // 권한 확인: feedback의 personaRun -> scenarioRun -> userId
      const personaRun = await storage.getPersonaRun(personaRunId);
      if (!personaRun) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
      
      const requestUser = req.user as any;
      const isAdminOrOperator = requestUser?.role === 'admin' || requestUser?.role === 'operator';
      
      if (!scenarioRun || (!isAdminOrOperator && scenarioRun.userId !== userId)) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      res.json(feedback);
    } catch (error) {
      console.error("피드백 조회 오류:", error);
      res.status(500).json({ error: "Failed to fetch feedback" });
    }
  });

  return router;
}
