import { GoogleGenAI } from '@google/genai';
import { LangCode } from './prompts/languageInstructions';
import { getModelForFeature } from '../aiServiceFactory';

function getEmotionConfig(lang: LangCode) {
  const emotionsByLang = {
    ko: {
      neutral: '중립', happy: '기쁨', sad: '슬픔', angry: '분노', surprised: '놀람',
      curious: '호기심', anxious: '불안', tired: '피로', disappointed: '실망', confused: '당혹'
    },
    en: {
      neutral: 'neutral', happy: 'happy', sad: 'sad', angry: 'angry', surprised: 'surprised',
      curious: 'curious', anxious: 'anxious', tired: 'tired', disappointed: 'disappointed', confused: 'confused'
    },
    zh: {
      neutral: '中立', happy: '喜悦', sad: '悲伤', angry: '愤怒', surprised: '惊讶',
      curious: '好奇', anxious: '焦虑', tired: '疲劳', disappointed: '失望', confused: '困惑'
    },
    ja: {
      neutral: '中立', happy: '喜び', sad: '悲しみ', angry: '怒り', surprised: '驚き',
      curious: '好奇心', anxious: '不安', tired: '疲労', disappointed: '失望', confused: '困惑'
    }
  };

  const emotionToImage: Record<string, string> = {
    '중립': 'neutral', '기쁨': 'happy', '슬픔': 'sad', '분노': 'angry', '놀람': 'surprised',
    '호기심': 'curious', '불안': 'anxious', '피로': 'tired', '실망': 'disappointed', '당혹': 'confused',
    'neutral': 'neutral', 'happy': 'happy', 'sad': 'sad', 'angry': 'angry', 'surprised': 'surprised',
    'curious': 'curious', 'anxious': 'anxious', 'tired': 'tired', 'disappointed': 'disappointed', 'confused': 'confused',
    '中立': 'neutral', '喜悦': 'happy', '悲伤': 'sad', '愤怒': 'angry', '惊讶': 'surprised',
    '好奇': 'curious', '焦虑': 'anxious', '疲劳': 'tired', '失望': 'disappointed', '困惑': 'confused',
    '喜び': 'happy', '悲しみ': 'sad', '怒り': 'angry', '驚き': 'surprised',
    '好奇心': 'curious', '不安': 'anxious'
  };

  const emotions = emotionsByLang[lang];
  const validEmotions = Object.values(emotions);

  const apiToLangMap: Record<string, string> = {
    'neutral': emotions.neutral, 'calm': emotions.neutral, 'normal': emotions.neutral,
    'happy': emotions.happy, 'joy': emotions.happy, 'excited': emotions.happy, 'pleased': emotions.happy,
    'sad': emotions.sad, 'sadness': emotions.sad, 'unhappy': emotions.sad,
    'angry': emotions.angry, 'anger': emotions.angry, 'frustrated': emotions.angry, 'irritated': emotions.angry, 'upset': emotions.angry,
    'surprised': emotions.surprised, 'surprise': emotions.surprised, 'shocked': emotions.surprised,
    'curious': emotions.curious, 'curiosity': emotions.curious, 'interested': emotions.curious,
    'anxious': emotions.anxious, 'anxiety': emotions.anxious, 'worried': emotions.anxious, 'nervous': emotions.anxious, 'concerned': emotions.anxious,
    'tired': emotions.tired, 'exhausted': emotions.tired, 'fatigue': emotions.tired,
    'disappointed': emotions.disappointed, 'disappointment': emotions.disappointed,
    'confused': emotions.confused, 'embarrassed': emotions.confused, 'awkward': emotions.confused, 'perplexed': emotions.confused
  };

  for (const key of validEmotions) {
    apiToLangMap[key.toLowerCase()] = key;
  }

  return { emotions, validEmotions, apiToLangMap, emotionToImage };
}

function getEmotionReasonText(lang: LangCode, type: 'complete' | 'disabled' | 'keyword' | 'pattern'): string {
  const texts: Record<LangCode, Record<string, string>> = {
    ko: {
      complete: '대화 완료',
      disabled: 'AI 서비스 비활성화',
      keyword: '키워드 분석',
      pattern: '패턴 분석'
    },
    en: {
      complete: 'Conversation complete',
      disabled: 'AI service disabled',
      keyword: 'Keyword analysis',
      pattern: 'Pattern analysis'
    },
    zh: {
      complete: '对话完成',
      disabled: 'AI服务未激活',
      keyword: '关键词分析',
      pattern: '模式分析'
    },
    ja: {
      complete: '会話完了',
      disabled: 'AIサービス無効',
      keyword: 'キーワード分析',
      pattern: 'パターン分析'
    }
  };
  return texts[lang][type];
}

function getEmotionPromptConfig(lang: LangCode, emotions: Record<string, string>) {
  const emotionList = Object.values(emotions).join(', ');

  const configs = {
    ko: {
      instruction: 'AI 캐릭터의 응답에서 감정을 분석하세요.',
      chooseFrom: `다음 감정 중 하나를 선택하세요: ${emotionList}`,
      replyFormat: '다음 형식으로만 답변하세요 (다른 텍스트 없이):\n{"emotion": "선택한_감정", "reason": "간단한 이유"}'
    },
    en: {
      instruction: 'Analyze the emotion in this AI character\'s response.',
      chooseFrom: `Choose ONE emotion from: ${emotionList}`,
      replyFormat: 'Reply with ONLY this JSON format (no other text):\n{"emotion": "chosen_emotion", "reason": "brief reason"}'
    },
    zh: {
      instruction: '分析AI角色回复中的情感。',
      chooseFrom: `从以下情感中选择一个: ${emotionList}`,
      replyFormat: '仅以此JSON格式回复（无其他文本）:\n{"emotion": "选择的情感", "reason": "简短理由"}'
    },
    ja: {
      instruction: 'AIキャラクターの応答の感情を分析してください。',
      chooseFrom: `次の感情から1つ選んでください: ${emotionList}`,
      replyFormat: '以下のJSON形式のみで回答してください（他のテキストなし）:\n{"emotion": "選択した感情", "reason": "簡単な理由"}'
    }
  };
  return configs[lang];
}

function analyzeEmotionFromText(text: string, userLanguage: LangCode = 'ko'): { emotion: string; emotionReason: string } | null {
  if (!text || text.length < 5) return null;

  const { emotions } = getEmotionConfig(userLanguage);
  const lowerText = text.toLowerCase();

  const emotionPatterns: Array<{ emotionKey: keyof typeof emotions; patterns: RegExp[]; keywords: string[] }> = [
    {
      emotionKey: 'angry',
      patterns: [
        /왜.*안|어떻게.*이런|도대체|짜증|화나|열받|불쾌/i,
        /지나치십니다|무책임|정신.*차|그러지.*마|말도.*안|황당/i,
        /어이.*없|기가.*막|뭘.*하자는|용납.*안|참을.*수/i,
        /비합리적|무작정|밀어붙이|그만하십시오|그만.*해/i,
        /책임.*져|무리하|납득.*안|이해.*안.*되|받아들일.*수.*없/i,
        /감정적.*대응|논리적.*생각|얼마나.*큰.*손해/i,
        /unacceptable|ridiculous|absurd|outrageous|irresponsible/i,
        /can'?t\s+accept|won'?t\s+tolerate|this\s+is\s+wrong/i,
        /how\s+dare|stop\s+this|enough\s+is\s+enough/i,
        /makes?\s+no\s+sense|completely\s+wrong|totally\s+unacceptable/i,
        /不可接受|荒谬|愤怒|生气|发火|不能容忍/i,
        /許せない|怒り|腹が立つ|ありえない|理不尽/i
      ],
      keywords: ['frustrated', 'angry', 'annoyed', 'irritated', 'upset', 'furious', 'outraged', 'unacceptable', 'ridiculous', 'absurd', '화가', '짜증', '답답', '큰일', '무책임', '황당', '어이없', '비합리', '무리', '납득', '愤怒', '生气', '怒り', '腹立']
    },
    {
      emotionKey: 'anxious',
      patterns: [
        /걱정|우려|불안|초조|조급|어쩌|큰일/i,
        /심각|위험|문제.*생|잘못.*되|어떡/i,
        /심각성|파악.*안.*되|회의.*전|시간.*없/i,
        /worried\s+about|concerns?\s+about|i'?m\s+concerned/i,
        /serious\s+issue|serious\s+problem|major\s+problem/i,
        /we\s+need\s+to\s+address|running\s+out\s+of\s+time/i,
        /deadline|urgent|critical\s+issue|risk|at\s+stake/i,
        /can'?t\s+afford|pressure|tight\s+timeline/i,
        /担心|焦虑|紧张|忧虑|严重|危险/i,
        /心配|不安|焦り|緊張|深刻|危険/i
      ],
      keywords: ['worried', 'anxious', 'nervous', 'concerned', 'uneasy', 'concerns', 'serious', 'urgent', 'critical', 'deadline', 'pressure', 'risk', 'timeline', 'constraints', '걱정', '우려', '불안', '급하', '심각', '위험', '심각성', '担心', '焦虑', '心配', '不安']
    },
    {
      emotionKey: 'disappointed',
      patterns: [
        /실망|아쉽|유감|안타깝/i,
        /기대.*못|생각.*달|믿었는데/i,
        /i'?m\s+disappointed|this\s+is\s+disappointing|let\s+me\s+down/i,
        /expected\s+better|not\s+what\s+i\s+expected|fell\s+short/i,
        /unfortunately|regrettably|sadly/i,
        /失望|遗憾|可惜/i,
        /失望|残念|がっかり/i
      ],
      keywords: ['disappointed', 'let down', 'disappointing', 'expected better', 'unfortunately', 'regret', '실망', '아쉽', '유감', '안타깝', '失望', '遗憾', '残念']
    },
    {
      emotionKey: 'surprised',
      patterns: [
        /정말요\?|뭐라고|어떻게.*그런|갑자기|충격/i,
        /믿기.*어렵|예상.*못|처음.*듣/i,
        /are\s+you\s+serious|i\s+can'?t\s+believe|that'?s\s+shocking/i,
        /wait,?\s+what|how\s+is\s+that\s+possible|unexpected/i,
        /never\s+expected|out\s+of\s+nowhere|suddenly/i,
        /惊讶|震惊|意外|突然/i,
        /驚き|びっくり|意外|突然/i
      ],
      keywords: ['surprised', 'shocked', 'what?', 'unexpected', 'unbelievable', 'suddenly', 'amazing', '놀라', '충격', '갑자기', '믿기 어렵', '惊讶', '震惊', '驚き', 'びっくり']
    },
    {
      emotionKey: 'curious',
      patterns: [
        /궁금|왜.*그런|어떻게.*되|알고\s*싶/i,
        /무슨.*뜻|설명.*해|자세히/i,
        /i'?m\s+curious|can\s+you\s+explain|tell\s+me\s+more/i,
        /how\s+does\s+that\s+work|what\s+do\s+you\s+mean|interesting/i,
        /i'?d\s+like\s+to\s+know|wondering\s+about/i,
        /好奇|想知道|有趣/i,
        /興味|気になる|知りたい/i
      ],
      keywords: ['curious', 'interested', 'wondering', 'intriguing', 'fascinating', 'explain', '궁금', '흥미', '자세히', '好奇', '興味']
    },
    {
      emotionKey: 'happy',
      patterns: [
        /좋아|잘됐|다행|기쁘|감사|고마워/i,
        /훌륭|대단|멋지|성공|축하/i,
        /that'?s\s+great|wonderful|excellent|fantastic|amazing/i,
        /i'?m\s+happy|so\s+glad|thank\s+you|appreciate/i,
        /well\s+done|good\s+job|congratulations|success/i,
        /高兴|喜悦|开心|太好了|感谢/i,
        /嬉しい|喜び|素晴らしい|ありがとう/i
      ],
      keywords: ['happy', 'glad', 'pleased', 'great', 'thank', 'wonderful', 'excellent', 'fantastic', 'appreciate', '좋', '다행', '감사', '훌륭', '대단', '高兴', '喜悦', '嬉しい', '喜び']
    },
    {
      emotionKey: 'confused',
      patterns: [
        /뭐지|이상하|어색|곤란|난처/i,
        /당황|어떻게.*해야|뭐라고.*해야/i,
        /i'?m\s+confused|don'?t\s+understand|makes\s+no\s+sense/i,
        /not\s+sure\s+what\s+to|awkward\s+situation|uncomfortable/i,
        /put\s+me\s+in\s+a\s+difficult|hard\s+to\s+say/i,
        /困惑|迷惑|不明白|尴尬/i,
        /困惑|戸惑い|分からない|困った/i
      ],
      keywords: ['confused', 'awkward', 'embarrassed', 'uncomfortable', 'puzzled', 'perplexed', '당황', '곤란', '난처', '어색', '困惑', '尴尬', '戸惑い']
    },
    {
      emotionKey: 'sad',
      patterns: [
        /슬프|우울|힘들|서글|눈물/i,
        /i'?m\s+sad|feeling\s+down|heartbroken|unfortunate/i,
        /it'?s\s+hard|difficult\s+time|struggling/i,
        /悲伤|难过|伤心|沮丧/i,
        /悲しい|悲しみ|辛い|落ち込/i
      ],
      keywords: ['sad', 'unhappy', 'heartbroken', 'depressed', 'down', '슬프', '우울', '힘들', '悲伤', '难过', '悲しい', '辛い']
    },
    {
      emotionKey: 'tired',
      patterns: [
        /지치|피곤|힘들|녹초|기진맥진/i,
        /i'?m\s+tired|exhausted|worn\s+out|burned\s+out/i,
        /need\s+a\s+break|overwhelmed|too\s+much/i,
        /疲劳|累了|精疲力尽/i,
        /疲れ|疲労|くたくた/i
      ],
      keywords: ['tired', 'exhausted', 'worn out', 'burned out', 'overwhelmed', '피곤', '지치', '疲劳', '累', '疲れ']
    }
  ];

  for (const { emotionKey, patterns, keywords } of emotionPatterns) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return { emotion: emotions[emotionKey], emotionReason: getEmotionReasonText(userLanguage, 'pattern') };
      }
    }
    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return { emotion: emotions[emotionKey], emotionReason: getEmotionReasonText(userLanguage, 'keyword') };
      }
    }
  }

  return null;
}

export async function analyzeEmotion(
  aiResponse: string,
  personaName: string,
  userLanguage: LangCode = 'ko',
  genAI: GoogleGenAI | null
): Promise<{ emotion: string; emotionReason: string }> {
  const { emotions, validEmotions, apiToLangMap } = getEmotionConfig(userLanguage);

  if (!genAI) {
    return { emotion: emotions.neutral, emotionReason: getEmotionReasonText(userLanguage, 'disabled') };
  }

  const promptConfig = getEmotionPromptConfig(userLanguage, emotions);

  try {
    const prompt = `${promptConfig.instruction}

Character: ${personaName}
Response: "${aiResponse.substring(0, 400)}"

${promptConfig.chooseFrom}

${promptConfig.replyFormat}`;

    const emotionModel = await getModelForFeature('emotion');
    const result = await genAI.models.generateContent({
      model: emotionModel,
      contents: prompt,
      config: {
        maxOutputTokens: 150,
        temperature: 0.1
      }
    });

    let responseText = (result.text || '').trim();
    console.log('📊 Emotion response:', responseText.substring(0, 150));

    responseText = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    if (!responseText || responseText.length < 5) {
      console.log('📊 Empty API response, falling back to text analysis');
      const directAnalysis = analyzeEmotionFromText(aiResponse, userLanguage);
      if (directAnalysis) return directAnalysis;
      return { emotion: emotions.neutral, emotionReason: getEmotionReasonText(userLanguage, 'complete') };
    }

    const parseAndMapEmotion = (jsonStr: string): { emotion: string; emotionReason: string } | null => {
      try {
        const data = JSON.parse(jsonStr);
        const rawEmotion = (data.emotion || '').toLowerCase().trim();
        const mappedEmotion = apiToLangMap[rawEmotion];
        if (mappedEmotion && validEmotions.includes(mappedEmotion)) {
          return {
            emotion: mappedEmotion,
            emotionReason: data.reason || data.emotionReason || getEmotionReasonText(userLanguage, 'complete')
          };
        }
      } catch (e) {}
      return null;
    };

    let parsed = parseAndMapEmotion(responseText);
    if (parsed) return parsed;

    const jsonMatch = responseText.match(/\{[^{}]*\}/);
    if (jsonMatch) {
      parsed = parseAndMapEmotion(jsonMatch[0]);
      if (parsed) return parsed;
    }

    const lowerResponse = responseText.toLowerCase();
    for (const [keyword, langEmotion] of Object.entries(apiToLangMap)) {
      if (keyword !== 'neutral' && keyword !== emotions.neutral.toLowerCase() && lowerResponse.includes(keyword)) {
        return { emotion: langEmotion, emotionReason: getEmotionReasonText(userLanguage, 'keyword') };
      }
    }

    const directAnalysis = analyzeEmotionFromText(aiResponse, userLanguage);
    if (directAnalysis) {
      console.log('📊 Direct text analysis:', directAnalysis.emotion);
      return directAnalysis;
    }

    return { emotion: emotions.neutral, emotionReason: getEmotionReasonText(userLanguage, 'complete') };
  } catch (error: any) {
    console.error('❌ Emotion analysis error:', error?.message || error);
    const fallbackAnalysis = analyzeEmotionFromText(aiResponse, userLanguage);
    if (fallbackAnalysis) return fallbackAnalysis;
    return { emotion: emotions.neutral, emotionReason: getEmotionReasonText(userLanguage, 'complete') };
  }
}
