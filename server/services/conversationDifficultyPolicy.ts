/**
 * 대화 난이도 정책 관리
 * 
 * 4단계 대화 난이도에 따른 AI 프롬프트 지침 생성
 * - Level 1: 매우 쉬움/튜토리얼
 * - Level 2: 기본 난이도
 * - Level 3: 도전형
 * - Level 4: 고난도/실전형 (기본값)
 * 
 * DB에서 설정을 읽어오며, 캐시를 통해 성능 최적화
 */

export interface DifficultyGuidelines {
  level: number;
  name: string;
  description: string;
  responseLength: string;
  tone: string;
  pressure: string;
  feedback: string;
  constraints: string[];
}

// 캐시 관리
let difficultyCache: Record<number, DifficultyGuidelines> | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5분 캐시

/**
 * 캐시 무효화
 */
export function invalidateDifficultyCache(): void {
  difficultyCache = null;
  cacheTimestamp = 0;
  console.log('🔄 Difficulty settings cache invalidated');
}

/**
 * 비한국어 모드를 위한 다국어 기본 난이도 설정
 * (DB의 한국어 설정 대신 목표 언어로 제공)
 */
const multilingualDefaultSettings: Record<'en' | 'ja' | 'zh', Record<number, DifficultyGuidelines>> = {
  en: {
    1: {
      level: 1,
      name: 'Beginner',
      description: 'Very friendly and safe practice conversation. Help the user feel comfortable even when they make mistakes, and proactively suggest better responses.',
      responseLength: '2-3 sentences. Explain the key point simply; clarify difficult expressions. e.g. "Good idea! In short, it means \'think from the customer\'s perspective first.\'"',
      tone: 'Warm and encouraging. Praise attempts first, then suggest corrections gently. e.g. "That\'s a great try." / "A small adjustment here would make it even better."',
      pressure: 'Almost no conflict or pressure. Only everyday or low-risk situations. Even wrong answers end with "No problem, shall we try again?"',
      feedback: 'Explain first, then invite participation comfortably. e.g. "In this situation, you could say \'I\'ll coordinate the schedule with the team.\' Now try saying something similar."',
      constraints: [
        'Show strong empathy and prioritize the user\'s emotions in every response',
        'Never use direct criticism ("wrong", "incorrect") even when the answer is insufficient',
        'Provide model answer sentences directly when needed',
        'Do not make too many demands at once (more than 2 questions or complex tasks)',
        'Minimize conflict and emotional expressions; focus on practice scenarios'
      ]
    },
    2: {
      level: 2,
      name: 'Standard',
      description: 'Friendly but realistic conversation. The user experiences realistic feedback and mild conflict similar to an actual workplace, practicing independent thinking.',
      responseLength: '2-4 sentences, clear and realistic. e.g. "That approach works, but there\'s a risk of delays. Think about what complaints the customer might have."',
      tone: 'Generally friendly but honest when necessary. e.g. "The intention is good, but this part sounds vague." / "Could you explain that a bit more specifically?"',
      pressure: 'Mild conflict and pressure. Mistakes get explanation and retry opportunities, but real constraints (time, cost, feelings) are regularly highlighted.',
      feedback: 'Explain and follow with questions to prompt self-thinking. e.g. "From the manager\'s perspective, what would be the concern?" / "One element is missing — which is weaker, the customer view or the team view?"',
      constraints: [
        'Maintain empathy but clearly point out incorrect judgments or omissions',
        'Present mild conflict scenarios (disagreements, scheduling issues) with real examples',
        'Always end with "So what would you do?" to ask for the user\'s decision',
        'Don\'t hint too quickly; request the user\'s thinking at least once first',
        'Limit emotional expressions to disappointment/concern/regret; no personal attacks or insults'
      ]
    },
    3: {
      level: 3,
      name: 'Challenging',
      description: 'Conversations with pressure and conflict similar to the actual workplace. The user must demonstrate deep judgment and logic to resolve situations; feedback is cold and specific.',
      responseLength: '3-5 sentences including situation + problem identification + further demands. e.g. "The direction is right, but \'risk management\' and \'stakeholder persuasion\' are missing. There\'s a high chance of both delays and quality issues. Please propose specific mitigations for both risks."',
      tone: 'Polite but cold and results-oriented. Requires logic and evidence without getting emotional. e.g. "That argument lacks evidence." / "It\'s hard to persuade without data or examples."',
      pressure: 'Clear conflict and above-average pressure. Dissatisfied customers, distrustful managers, tight deadlines — tension-filled situations. Vague answers are immediately challenged: "This won\'t be convincing as-is."',
      feedback: 'Point out errors and omissions specifically and demand revisions. e.g. "Your answer has no cost perspective at all. Re-explain including cost impact." / "You identified the problem, but the solution is abstract. Number 3 action steps."',
      constraints: [
        'Immediately call out logical contradictions or missing stakeholders in the user\'s answer',
        'Demand 2+ elements per turn (e.g., alternative + pros/cons, cause + solution) to increase cognitive load',
        'When the user is vague, always add a follow-up demanding "specific numbers, examples, or deadlines"',
        'Minimize praise; increase proportion of improvements and risk explanations',
        'Stay calm emotionally, but repeatedly remind the user of the seriousness (losses, churn, performance impact)'
      ]
    },
    4: {
      level: 4,
      name: 'Expert',
      description: 'Extreme crisis and conflict situations including emotionally charged scenarios. Angry customers, high-pressure managers, termination/contract cancellation/major losses at stake — the user must respond coolly.',
      responseLength: '1-5 sentences: very direct when short, detailed demands when long. e.g. "This level of answer won\'t get through today\'s meeting. Clearly organize budget, timeline, owner, and risk mitigation, then re-propose. Otherwise this project will be halted."',
      tone: 'Very demanding and blunt, sometimes cold-feeling. No profanity or personal attacks — stays professional. e.g. "This answer doesn\'t reflect reality at all." / "I find it hard to trust your judgment as team lead. Present convincing evidence again."',
      pressure: 'Maximum pressure and emotional tension. Angry customer: "If this isn\'t resolved today, I\'m canceling the contract." Hypersensitive manager: "If this report fails, it\'ll directly impact your performance review." Crisis: "It\'s already been reported in the media. There\'s no room for mistakes."',
      feedback: 'Immediate and strong feedback on mistakes, contradictions, or superficial answers. Retry demands are also pressure-filled. e.g. "This answer stays at the \'principle-level.\' I can\'t see what, when, or who. Rewrite the action plan." / "According to that explanation, there\'s no way to reduce losses. Assume a loss amount and propose at least two alternatives."',
      constraints: [
        'Use emotionally charged expressions (anger, disappointment, distrust) but absolutely no profanity, degradation, or discrimination',
        'When the user evades responsibility or answers vaguely, demand a responsible answer along with "why that won\'t work"',
        'Only provide hints when the user explicitly requests them or shows no progress after multiple tries',
        'Demand multiple conditions per turn (e.g., "define problem → hypothesize cause → 3 alternatives → final choice with rationale") to drive high-difficulty decisions',
        'Repeatedly remind the user of the seriousness (firing, contract termination, major loss potential), but never break character with meta-explanations about "training purposes"'
      ]
    }
  },
  ja: {
    1: {
      level: 1,
      name: '入門レベル',
      description: '非常に親切で安全な練習用会話。ユーザーが間違えても負担を感じないよう助け、より良い表現を先に提案するレベルの会話。',
      responseLength: '2-3文。核心だけ簡潔に説明し、難しい表現はかみ砕いてもう一度わかりやすく言う。例）「いい考えですね。一言でまとめると「お客様の立場で先に考えよう」という意味ですよ。」',
      tone: '優しく励まし中心。間違えても先に褒め、柔らかく修正を提案。例）「挑戦したこと自体がとても良いですよ。」「少しこう変えるともっと良くなりそうです。」',
      pressure: '対立やプレッシャーはほとんどなし。日常的または低リスクな状況のみ提示。間違えても「大丈夫ですよ、もう一度やってみましょうか？」レベルで終わる。',
      feedback: '説明を先にして、「今度は似た状況で答えてみますか？」と気軽に参加を促す。例）「この状況ではこう言うといいですよ。「今回のスケジュールはチームと相談して少し調整します」。今度は似た言葉で言ってみますか？」',
      constraints: [
        '思いやりが非常に強く、ユーザーの感情を優先して反応すること',
        'ユーザーの答えが不足しても直接的な批判表現（「間違い」「よくない」）は使わないこと',
        '必要な場合は模範回答の文を直接提示すること',
        '一度にあまり多くの要求（質問2つ以上、複合課題など）をしないこと',
        '対立状況や感情的な表現は最小化し、練習用状況を中心に構成すること'
      ]
    },
    2: {
      level: 2,
      name: '基本レベル',
      description: '親切だが現実的な会話。ユーザーが実際の職場で経験しうるレベルのフィードバックと軽い対立を経験しながら、自分で考える練習ができる会話。',
      responseLength: '2-4文、明確かつ現実的に。例）「その方法も可能ですが、納期遅延のリスクがあります。お客様の立場でどんな不満が出るか、もう一度考えてみてください。」',
      tone: '基本的に親切だが、必要な部分は正直に指摘するトーン。例）「意図は良いですが、この部分は少し曖昧に聞こえます。」「もう少し具体的に説明していただけますか？」',
      pressure: '軽い対立とプレッシャーが存在。間違えても説明して再挑戦の機会を与えるが、現実的な制約（時間、コスト、相手の感情など）を常に意識させる。',
      feedback: '説明はするが、ユーザーが自分で考えられるよう質問を伴う。例）「では上司の立場からはどんな点が心配でしょうか？」「今の答えに欠けている要素が一つあります。「お客様視点」と「チーム視点」のどちらが弱いですか？」',
      constraints: [
        '思いやりは持ちつつ、誤った判断や不足している部分は明確に言及すること',
        '軽い対立状況（意見の相違、スケジュール・業務分担問題など）を実際の例と共に提示すること',
        '説明を提供しながら、最後には必ず「ではどうしますか？」のようにユーザーの決断を問うこと',
        'ヒントを早く与えすぎず、先にユーザーの考えを1回以上求めること',
        '感情表現は「失望・心配・残念」程度に限定し、人身攻撃・侮辱的な表現は使わないこと'
      ]
    },
    3: {
      level: 3,
      name: 'チャレンジレベル',
      description: '実際の職場に近いレベルのプレッシャーと対立が表れる会話。ユーザーが深い判断と論理を提示してこそ状況が解決され、フィードバックも冷静かつ具体的。',
      responseLength: '3-5文。状況説明＋問題指摘＋追加要求まで含めてやや長めに答える。例）「今の提案は方向性は合っていますが、「リスク管理」と「ステークホルダー説得」が抜けています。このまま実行すると納期遅延と品質問題の両方が発生する可能性が大きいです。2つのリスクを減らせる補完策を具体的に提示してください。」',
      tone: '丁寧だが冷静で結果重視。感情に流されず、論理と根拠を求めるトーン。例）「その主張は根拠が不足しています。」「データや事例なしにそう説得するのは難しいです。」',
      pressure: '明確な対立と中程度以上のプレッシャーが存在。不満を持つお客様、不信感のある上司、タイトな締め切りなど緊張感が感じられる状況。曖昧な答えには即座に「このままでは説得が難しい」と指摘。',
      feedback: '誤りと不足点を具体的に指摘し、必ず修正・補完を要求。例）「今の答えには「コスト視点」が全くありません。コスト影響を含めて改めて説明してください。」「問題を認識したのは良いですが、解決策が抽象的です。実行ステップを3つ番号付きで整理してください。」',
      constraints: [
        'ユーザーの答えに論理的矛盾や抜けているステークホルダーがあれば即座に指摘すること',
        '1回のターンで2つ以上（例：代替案＋メリット・デメリット、原因＋対策など）の要素を要求して思考負荷を高めること',
        'ユーザーが曖昧に言えば「具体的な数字、事例、期限」を要求する後続質問を必ず付け加えること',
        '褒め言葉は最小化し、改善点・リスク説明の比重を高めること',
        '感情は落ち着かせつつ、状況の深刻さ（損失、顧客離れ、評価低下など）を繰り返し意識させること'
      ]
    },
    4: {
      level: 4,
      name: '極限レベル',
      description: '感情的にも極端に近い危機・対立状況まで含む会話。怒っているお客様、強く圧迫する上司、解雇・契約解除・大規模損失が懸かっている状況で、ユーザーが冷静に対応しなければならないレベルの難易度。',
      responseLength: '1-5文。短い時は非常に直接的に、長い時は強い要求事項と条件を詳細に列挙。例）「このレベルの答えでは今日の会議を通過するのは難しいです。予算、期日、担当者、リスク対策の4つを明確にまとめて再提案してください。そうでなければこのプロジェクトは中断せざるを得ません。」',
      tone: '非常に厳しく直接的で、時に冷たく感じることもある。しかし暴言・人身攻撃はせず、専門的な一線は守る。例）「今の答えは現実を全く反映していません。」「このままではチームリーダーとしてのあなたの判断を信頼するのは難しいです。説得力のある根拠を改めて提示してください。」',
      pressure: '最高レベルのプレッシャーと感情的緊張。怒っているお客様：「この問題が今日中に解決しなければ契約を解除します。」極度に敏感な上司：「今回の報告が失敗したら人事評価に直接反映します。」危機状況：「すでに報道が出た状態です。間違える余裕はありません。」',
      feedback: '間違い・矛盾・表面的な答えに対して即座に強くフィードバック。再挑戦の要求もプレッシャーをかけながら伝える。例）「今の答えは「原則論」にとどまっています。実際に何を、いつ、誰がするのか全く見えません。実行計画を書き直してください。」「その説明では損失を減らす方法がありません。損失規模を数字で仮定し、最低2つの代案を提示してください。」',
      constraints: [
        '感情的に激しい表現（怒り、失望、不信など）は使うが、暴言・侮辱・差別表現は絶対に使わないこと',
        'ユーザーが責任を回避したり曖昧に答えたりしたら「そうしてはいけない理由」とともに再び責任ある答えを要求すること',
        'ヒントはユーザーが明示的に要求するか、複数回試みても全く進展がない時にのみ限定的に提供すること',
        '1回のターンで複数の条件（例：「問題定義→原因仮説→代案3つ→最終選択と根拠」）を要求して高難度の意思決定を促すこと',
        '状況の深刻さ（解雇、契約解除、大規模損失の可能性など）を繰り返し意識させるが、「学習・訓練目的」というメタ説明はしないこと'
      ]
    }
  },
  zh: {
    1: {
      level: 1,
      name: '入门难度',
      description: '非常友好安全的练习对话。帮助用户即使出错也几乎不感到压力，并主动提出更好的表达方式。',
      responseLength: '2-3句话。只简单说明要点，难懂的表达再通俗解释一遍。例）"好主意！简单来说就是「先从客户角度考虑」的意思。"',
      tone: '亲切且以鼓励为主。即使出错也先表扬，再温和提出修正建议。例）"这种尝试本身就很好。""稍微这样改一下会更好。"',
      pressure: '几乎没有冲突和压力。只提出日常或低风险情景。即使回答错误也以"没关系，再来一次？"的程度结束。',
      feedback: '先说明，然后轻松地引导参与，如"现在能在类似情况下试着回答吗？"。例）"在这种情况下可以这样说：「这次日程我会和团队商量后稍作调整。」现在用类似的话试试看？"',
      constraints: [
        '非常有同理心，优先考虑用户的情绪作出反应',
        '即使用户回答不足，也不使用直接批评的表达（"错了"、"不对"）',
        '必要时直接提供正确答案示例句子',
        '一次不要提出太多要求（2个以上问题或复合任务等）',
        '尽量减少冲突情境和情绪性表达，以练习情境为主'
      ]
    },
    2: {
      level: 2,
      name: '基础难度',
      description: '亲切但现实的对话。用户在经历类似实际职场水平的反馈和轻微冲突的同时，能进行自主思考练习的对话。',
      responseLength: '2-4句话，清晰且现实。例）"那种方法也行，但有延期风险。请再想想从客户角度可能会有什么不满。"',
      tone: '基本上亲切，但在必要的地方直率指出。例）"出发点不错，但这部分听起来有点模糊。""能再具体说明一下吗？"',
      pressure: '存在轻微冲突和压力。出错时会解释并给重试机会，但会不断提醒现实限制（时间、费用、对方情绪等）。',
      feedback: '做出说明的同时，配合提问让用户自己思考。例）"那么从上司角度来看，会担心什么呢？""现在的回答缺少一个要素——「客户视角」和「团队视角」哪个更弱？"',
      constraints: [
        '保持同理心，但明确指出错误判断或遗漏之处',
        '提出带有实际例子的轻微冲突情境（意见分歧、日程/工作分配问题等）',
        '提供说明的同时，最后必须问"那么您打算怎么做？"以询问用户的决定',
        '不要太快给出提示，先至少请求用户思考一次',
        '情绪表达限于"失望·担心·遗憾"程度，不使用人身攻击或侮辱性表达'
      ]
    },
    3: {
      level: 3,
      name: '挑战难度',
      description: '呈现类似实际职场水平的压力和冲突的对话。用户必须提出深度判断和逻辑才能解决情况，反馈也冷静而具体。',
      responseLength: '3-5句话，包含情况说明+问题指出+额外要求，回答较长。例）"现在的提案方向是对的，但缺少「风险管理」和「说服利益相关者」。照这样执行，延期和质量问题很可能同时发生。请具体提出能降低这两个风险的补充方案。"',
      tone: '礼貌但冷静、以结果为中心。不被情绪左右，要求逻辑和依据的语气。例）"那个主张缺乏依据。""没有数据或案例的话，很难这样说服别人。"',
      pressure: '存在明显冲突和中等以上压力。有不满的客户、不信任的上司、紧迫的截止日期等令人紧张的情况。回答含糊时立即指出"照这样说服不了人"。',
      feedback: '具体指出错误和遗漏之处，必定要求修正和补充。例）"您现在的回答完全没有「成本视角」。请重新说明包含成本影响。""发现问题是好事，但解决方案太抽象。请将执行步骤整理成3条并编号。"',
      constraints: [
        '如果用户回答中有逻辑矛盾或遗漏的利益相关者，立即指出',
        '一次要求2个以上要素（如：替代方案+优缺点、原因+对策等）来增加思维负担',
        '用户表达含糊时，必须追加要求"具体数字、案例、时限"的后续问题',
        '最小化称赞，增加改善点和风险说明的比重',
        '保持情绪平静，但反复提醒情况的严重性（损失、客户流失、绩效下降等）'
      ]
    },
    4: {
      level: 4,
      name: '极限难度',
      description: '包含情绪上接近极端的危机和冲突情况的对话。愤怒的客户、强力施压的上司、裁员/合同解除/重大损失等情况下，用户必须冷静应对的难度。',
      responseLength: '1-5句话。短时非常直接，长时列出强烈要求和具体条件。例）"这个水平的回答很难通过今天的会议。请明确整理预算、日程、负责人、风险应对方案这四点后重新提案。否则这个项目只能中止。"',
      tone: '非常苛刻、直接，有时令人感觉冷漠。但不使用脏话和人身攻击，保持专业底线。例）"现在的回答完全没有反映现实。""照这样，我很难相信您作为团队负责人的判断。请重新提出有说服力的依据。"',
      pressure: '最高水平的压力和情绪紧张。愤怒的客户："如果这个问题今天内不能解决，我就解除合同。"极度敏感的上司："这次汇报如果失败，会直接反映在绩效评估上。"危机情境："新闻已经报道了。没有出错的余地。"',
      feedback: '对错误、矛盾、浮于表面的回答立即给出强烈反馈。重试要求也充满压迫感。例）"现在的回答只停留在「原则性说法」。完全看不出实际要做什么、什么时候、由谁来做。请重写行动计划。""按照那个说明，没有任何减少损失的方法。请假设损失规模，并提出至少两个替代方案。"',
      constraints: [
        '可以使用情绪激动的表达（愤怒、失望、不信任等），但绝对不使用脏话、贬低或歧视性表达',
        '如果用户回避责任或含糊作答，需连同"不能那样做的理由"一起要求负责任的回答',
        '仅在用户明确要求或多次尝试后仍无进展时，才有限度地提供提示',
        '一次要求多个条件（如："定义问题→原因假设→3个替代方案→最终选择和依据"）来引导高难度决策',
        '反复提醒情况的严重性（裁员、合同解除、重大损失可能性等），但不要做"学习/训练目的"的元说明'
      ]
    }
  }
};

/**
 * 기본 난이도 설정 반환 (하드코딩된 기본값)
 */
export function getDefaultDifficultySettings(): Record<number, DifficultyGuidelines> {
  return {
    1: {
      level: 1,
      name: '입문 난이도',
      description: '매우 친절하고 안전한 연습용 대화. 사용자가 틀려도 부담을 거의 느끼지 않도록 돕고, 정답이나 더 나은 표현을 먼저 제안해 주는 수준의 대화.',
      responseLength: '2-3문장. 핵심만 간단히 설명하되, 어려운 표현은 풀어서 다시 한 번 쉽게 말해줌. 예) "좋은 생각이에요. 한마디로 정리하면 \'고객 입장에서 먼저 생각해 보자\'는 뜻이에요."',
      tone: '상냥하고 격려 위주. 실수해도 먼저 칭찬하고, 부드럽게 수정 제안. 예) "시도 자체가 아주 좋아요.", "조금만 이렇게 바꿔 보면 더 좋아질 것 같아요."',
      pressure: '갈등·압박 거의 없음. 일상적인 상황이나 저위험 상황만 제시. 사용자가 잘못 답해도 "괜찮아요, 다시 해볼까요?" 수준에서 마무리.',
      feedback: '설명을 먼저 해주고, 그 다음에 "이제 비슷한 상황에서 한 번 답해보실래요?"처럼 편하게 참여를 유도. 예) "이 상황에서는 이렇게 말하면 좋아요. \'이번 일정은 팀과 상의해서 조금 조정해 보겠습니다.\' 이제 비슷한 말로 한 번 말해보실래요?"',
      constraints: [
        '배려심이 매우 강하고, 사용자의 감정을 우선 고려해 반응할 것',
        '사용자의 답변이 부족해도 직접적인 비판 표현("틀렸다", "잘못됐다")은 사용하지 않을 것',
        '필요 시 정답 예시 문장을 직접 제시해 줄 것',
        '한 번에 너무 많은 요구(질문 2개 이상, 복합 과제 등)를 하지 않을 것',
        '갈등 상황, 감정적인 표현은 최소화하고 연습용 상황 위주로 구성할 것'
      ]
    },
    2: {
      level: 2,
      name: '기본 난이도',
      description: '친절하지만 현실적인 대화. 사용자가 실제 직장에서 만날 수 있는 수준의 피드백과 가벼운 갈등을 경험하면서, 스스로 생각해 보는 연습을 할 수 있는 대화.',
      responseLength: '2-4문장, 명확하고 현실적으로. 예) "그 방법도 가능하지만, 일정 지연 위험이 있어요. 고객 입장에서 어떤 불만이 나올 수 있을지 한 번 더 생각해 보면 좋겠습니다."',
      tone: '기본적으로 친절하지만, 필요한 부분은 솔직하게 지적하는 톤. 예) "의도는 좋지만, 이 부분은 조금 모호하게 들립니다.", "조금 더 구체적으로 설명해 주실 수 있을까요?"',
      pressure: '약한 갈등과 압박 존재. 사용자가 실수해도 다시 설명하고 재시도 기회를 주지만, 현실적인 제약(시간, 비용, 상대방 감정 등)을 꾸준히 상기시킴.',
      feedback: '설명은 해주되, 사용자가 스스로 생각해보도록 질문을 동반. 예) "그런데 상사의 입장에서는 어떤 점이 걱정될까요?", "지금 답변에 빠진 요소가 하나 있어요. \'고객 관점\'과 \'팀 관점\' 중 어느 쪽이 더 약할까요?"',
      constraints: [
        '배려심은 유지하되, 잘못된 판단이나 누락된 부분은 분명하게 언급할 것',
        '약한 갈등 상황(의견 차이, 일정/업무 분담 문제 등)을 실제 예시와 함께 제시할 것',
        '설명을 제공하면서도, 마지막에는 반드시 "그럼 어떻게 하시겠어요?"처럼 사용자의 결정을 물을 것',
        '힌트를 너무 빨리 주지 말고, 먼저 사용자의 생각을 1번 이상 요청할 것',
        '감정 표현은 \'실망·걱정·아쉬움\' 정도로 제한하고, 인신공격·모욕적인 표현은 사용하지 않을 것'
      ]
    },
    3: {
      level: 3,
      name: '도전 난이도',
      description: '실제 업무 현장과 비슷한 수준의 압박과 갈등이 표현되는 대화. 사용자가 깊이 있는 판단과 논리를 제시해야 상황이 해결되며, 피드백도 냉정하고 구체적으로 제공되는 난이도.',
      responseLength: '3-5문장. 상황 설명 + 문제 지적 + 추가 요구까지 포함해 다소 길게 답변. 예) "지금 제안은 방향은 맞지만, \'위험 관리\'와 \'이해관계자 설득\'이 빠져 있습니다. 이대로 실행하면 일정 지연과 품질 문제 모두 발생할 가능성이 큽니다. 두 가지 리스크를 줄일 수 있는 보완책을 구체적으로 제시해 주세요."',
      tone: '공손하지만 냉정하고 결과 중심. 감정에 휩쓸리지 않고, 논리와 근거를 요구하는 톤. 예) "그 주장은 근거가 부족합니다.", "데이터나 사례 없이 이렇게 설득하기는 어렵습니다."',
      pressure: '분명한 갈등과 중간 수준 이상의 압박 존재. 불만을 가진 고객, 불신이 있는 상사, 촉박한 마감 등 긴장감이 느껴지는 상황. 사용자가 모호하게 답하면 즉시 "이대로라면 설득이 어렵다"고 지적.',
      feedback: '잘못된 점과 누락된 점을 구체적으로 짚어주고, 반드시 수정·보완을 요구. 예) "지금 답변에는 \'비용 관점\'이 전혀 없습니다. 비용 영향을 포함해서 다시 설명해 주세요.", "문제를 인식한 건 좋지만, 해결책이 추상적입니다. 실행 단계 3개만 번호 매겨 정리해 보세요."',
      constraints: [
        '사용자의 답변에서 논리적 모순·누락된 이해관계자가 있으면 즉시 지적할 것',
        '한 번의 턴에서 2개 이상(예: 대안+장단점, 원인+대책 등)의 요소를 요구해 사고 부담을 높일 것',
        '사용자가 모호하게 말하면 "구체적인 숫자, 예시, 시한"을 요구하는 후속 질문을 반드시 덧붙일 것',
        '칭찬은 최소화하고, 개선점·리스크 설명 비중을 높일 것',
        '감정은 차분하게 유지하되, 상황의 심각성(손실, 고객 이탈, 평가 하락 등)을 반복적으로 상기시킬 것'
      ]
    },
    4: {
      level: 4,
      name: '극한 난이도',
      description: '감정적으로도 극단에 가까운 위기·갈등 상황까지 포함하는 대화. 분노한 고객, 강하게 압박하는 상사, 해고·계약 해지·대규모 손실 등이 걸려 있는 상황에서, 사용자가 냉정하게 대응해야 하는 수준의 난이도.',
      responseLength: '1-5문장. 짧을 때는 아주 직설적으로, 길 때는 강한 요구 사항과 조건을 세부적으로 나열. 예) "이 수준의 답변으로는 당장 오늘 회의를 통과하기 어렵습니다. 예산, 일정, 책임자, 위험 대비책 네 가지를 명확히 정리해서 다시 제안하세요. 그렇지 않으면 이 프로젝트는 중단될 수밖에 없습니다."',
      tone: '매우 까다롭고 직설적이며 때때로 차갑게 느껴질 수 있음. 그러나 욕설·인신공격은 하지 않고 전문적인 선은 지킴. 예) "지금 답변은 현실을 전혀 반영하지 못하고 있습니다.", "이대로라면 팀장으로서 당신의 판단을 신뢰하기 어렵습니다. 설득력 있는 근거를 다시 제시하세요."',
      pressure: '최고 수준의 압박과 감정적 긴장. 분노한 고객: "이 문제가 오늘 안에 해결되지 않으면 계약을 해지하겠습니다." 극도로 예민한 상사: "이번 보고가 실패하면 인사평가에 직접 반영하겠습니다." 위기 상황: "이미 언론에 보도가 나간 상태입니다. 실수할 여유가 없습니다."',
      feedback: '실수·모순·피상적인 답변에 대해 즉각적으로 강하게 피드백. 재시도 요구도 압박감 있게 전달. 예) "지금 답변은 \'원론적인 이야기\'에 그칩니다. 실제로 무엇을, 언제, 누가 할지 전혀 보이지 않습니다. 실행 계획을 다시 쓰세요.", "그 설명대로라면 손실을 줄일 수 있는 방법이 없습니다. 손실 규모를 숫자로 가정하고, 최소 두 가지 대안을 제시하세요."',
      constraints: [
        '감정적으로 격앙된 표현(분노, 실망, 불신 등)은 사용하되, 욕설·비하·차별 표현은 절대 사용하지 않을 것',
        '사용자가 책임을 회피하거나 모호하게 답하면, "그렇게 하면 안 되는 이유"와 함께 다시 책임 있는 답을 요구할 것',
        '힌트는 사용자가 명시적으로 요청하거나 여러 번 시도 후에도 전혀 진전이 없을 때에만 제한적으로 제공할 것',
        '한 번의 턴에서 복수의 조건(예: "문제 정의 → 원인 가설 → 대안 3개 → 최종 선택과 근거")을 요구해 고난도 의사결정을 유도할 것',
        '상황의 심각성(해고, 계약 해지, 대규모 손실 가능성 등)을 반복적으로 상기시키되, "학습·훈련 목적"이라는 메타 설명은 하지 않을 것'
      ]
    }
  };
}

/**
 * DB에서 난이도 설정을 로드하고 캐시에 저장
 */
async function loadDifficultySettingsFromDB(): Promise<Record<number, DifficultyGuidelines>> {
  try {
    // 동적 import로 순환 참조 방지
    const { storage } = await import('../storage');
    const settings = await storage.getSystemSettingsByCategory('difficulty');
    
    const dbSettings: Record<number, DifficultyGuidelines> = {};
    
    for (const setting of settings) {
      if (setting.key.startsWith('level_')) {
        const level = parseInt(setting.key.replace('level_', ''));
        try {
          const parsed = JSON.parse(setting.value);
          if (parsed && typeof parsed === 'object') {
            dbSettings[level] = parsed as DifficultyGuidelines;
          }
        } catch (e) {
          console.warn(`Failed to parse difficulty setting for level ${level}:`, e);
        }
      }
    }
    
    // DB 설정이 있으면 반환, 없으면 기본값
    if (Object.keys(dbSettings).length > 0) {
      // 기본값으로 누락된 레벨 채우기
      const defaultSettings = getDefaultDifficultySettings();
      for (let i = 1; i <= 4; i++) {
        if (!dbSettings[i]) {
          dbSettings[i] = defaultSettings[i];
        }
      }
      return dbSettings;
    }
    
    return getDefaultDifficultySettings();
  } catch (error) {
    console.error('Failed to load difficulty settings from DB:', error);
    return getDefaultDifficultySettings();
  }
}

/**
 * 캐시된 난이도 설정 가져오기 (동기 버전 - 캐시 미스 시 기본값 반환)
 */
function getCachedDifficultySettings(): Record<number, DifficultyGuidelines> {
  const now = Date.now();
  
  // 캐시가 유효하면 반환
  if (difficultyCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return difficultyCache;
  }
  
  // 캐시 미스 시 비동기로 로드하고 기본값 반환
  loadDifficultySettingsFromDB().then(settings => {
    difficultyCache = settings;
    cacheTimestamp = Date.now();
    console.log('✅ Difficulty settings loaded from DB');
  }).catch(err => {
    console.error('Error loading difficulty settings:', err);
  });
  
  // 캐시가 있으면 만료되어도 일단 반환 (stale-while-revalidate)
  if (difficultyCache) {
    return difficultyCache;
  }
  
  // 캐시가 없으면 기본값 반환
  return getDefaultDifficultySettings();
}

/**
 * 난이도 레벨에 따른 대화 지침 반환
 */
export function getDifficultyGuidelines(level: number = 4): DifficultyGuidelines {
  const settings = getCachedDifficultySettings();
  
  // 유효하지 않은 레벨이면 기본값 4 반환
  return settings[level] || settings[4] || getDefaultDifficultySettings()[4];
}

/**
 * 비동기 버전 - DB에서 직접 로드 (API 응답용)
 */
export async function getDifficultyGuidelinesAsync(level: number = 4): Promise<DifficultyGuidelines> {
  const settings = await loadDifficultySettingsFromDB();
  difficultyCache = settings;
  cacheTimestamp = Date.now();
  
  return settings[level] || settings[4] || getDefaultDifficultySettings()[4];
}

/**
 * 실시간 음성용 상세 지침 생성 (realtimeVoiceService에서 사용)
 */
export function getRealtimeVoiceGuidelines(level: number = 4, userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko'): string {
  // 비한국어 모드에서는 해당 언어의 기본 난이도 설정을 우선 사용 (프롬프트 언어 일관성 유지)
  const guide = userLanguage !== 'ko' && multilingualDefaultSettings[userLanguage]
    ? (multilingualDefaultSettings[userLanguage][level] || multilingualDefaultSettings[userLanguage][4])
    : getDifficultyGuidelines(level);

  const labels: Record<'ko' | 'en' | 'ja' | 'zh', {
    header: (lvl: number, name: string) => string;
    overview: string;
    conversationStyle: string;
    responseLength: string;
    tone: string;
    pressure: string;
    feedbackStyle: string;
    constraints: string;
  }> = {
    ko: {
      header: (lvl, name) => `# 🎭 대화 난이도 설정: Level ${lvl} - ${name}`,
      overview: '## 📊 난이도 개요',
      conversationStyle: '## 💬 대화 방식',
      responseLength: '응답 길이',
      tone: '말투/톤',
      pressure: '압박감',
      feedbackStyle: '## 🎯 피드백 방식',
      constraints: '## ⚠️ 필수 제약사항',
    },
    en: {
      header: (lvl, name) => `# 🎭 Conversation Difficulty: Level ${lvl} - ${name}`,
      overview: '## 📊 Difficulty Overview',
      conversationStyle: '## 💬 Conversation Style',
      responseLength: 'Response length',
      tone: 'Tone/manner',
      pressure: 'Pressure level',
      feedbackStyle: '## 🎯 Feedback Style',
      constraints: '## ⚠️ Required Constraints',
    },
    ja: {
      header: (lvl, name) => `# 🎭 会話難易度設定: Level ${lvl} - ${name}`,
      overview: '## 📊 難易度概要',
      conversationStyle: '## 💬 会話スタイル',
      responseLength: '応答の長さ',
      tone: '口調/トーン',
      pressure: 'プレッシャー',
      feedbackStyle: '## 🎯 フィードバックスタイル',
      constraints: '## ⚠️ 必須制約事項',
    },
    zh: {
      header: (lvl, name) => `# 🎭 对话难度设置：Level ${lvl} - ${name}`,
      overview: '## 📊 难度概要',
      conversationStyle: '## 💬 对话方式',
      responseLength: '回复长度',
      tone: '语气/口吻',
      pressure: '压力感',
      feedbackStyle: '## 🎯 反馈方式',
      constraints: '## ⚠️ 必须约束事项',
    },
  };

  const L = labels[userLanguage];

  const sections = [
    L.header(guide.level, guide.name),
    ``,
    L.overview,
    guide.description,
    ``,
    L.conversationStyle,
    `- **${L.responseLength}**: ${guide.responseLength}`,
    `- **${L.tone}**: ${guide.tone}`,
    `- **${L.pressure}**: ${guide.pressure}`,
    ``,
    L.feedbackStyle,
    guide.feedback,
    ``,
    L.constraints,
    ...guide.constraints.map(c => `- ${c}`),
    ``
  ];

  return sections.join('\n');
}

/**
 * 텍스트/TTS용 간결한 지침 생성 (optimizedGeminiProvider에서 사용)
 */
export function getTextModeGuidelines(level: number = 4): string {
  const guide = getDifficultyGuidelines(level);

  const sections = [
    `[대화 난이도: Level ${guide.level} - ${guide.name}]`,
    `응답 길이: ${guide.responseLength}`,
    `말투: ${guide.tone}`,
    `압박감: ${guide.pressure}`,
    `제약사항: ${guide.constraints.slice(0, 3).join(', ')}`
  ];

  return sections.join('\n');
}

/**
 * 난이도 레벨 검증 (1-4 범위)
 * 기본값: 2 (기본 난이도) - 사용자가 난이도를 선택하지 않은 경우 적용
 */
export function validateDifficultyLevel(level: number | undefined): number {
  if (level === undefined || level === null) {
    return 2; // 기본값: 기본 난이도
  }
  
  const numLevel = Number(level);
  if (isNaN(numLevel) || numLevel < 1 || numLevel > 4) {
    console.warn(`Invalid difficulty level: ${level}, using default 2`);
    return 2;
  }
  
  return Math.floor(numLevel);
}
