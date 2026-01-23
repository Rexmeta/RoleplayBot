# AI 롤플레잉 훈련 시스템

AI 기반 신입사원 역량 개발을 위한 대화형 훈련 플랫폼입니다. 실제 업무 상황을 시뮬레이션한 다양한 시나리오를 통해 커뮤니케이션 스킬을 향상시킬 수 있습니다.

## 🌟 주요 기능

### 🎭 실감나는 AI 캐릭터 대화
- **다양한 시나리오**: 실제 업무 상황을 시뮬레이션한 맞춤형 시나리오
- **16가지 MBTI 페르소나**: 각 성격 유형별 고유한 대화 스타일과 반응 패턴
- **4단계 난이도 시스템**: 초보자부터 고급 사용자까지 맞춤형 훈련
- **실시간 감정 분석**: AI 캐릭터의 감정 상태를 이모지와 색상으로 시각화
- **3가지 대화 모드**: 텍스트, 음성 출력(TTS), 실시간 음성 대화

### 🎯 4단계 난이도 시스템

시나리오별로 설정 가능한 난이도로 점진적 학습을 지원합니다:

#### Level 1: 매우 쉬움 (튜토리얼) ⭐
- **대상**: 처음 시작하는 초보자
- **응답 길이**: 1-3문장, 상세한 설명
- **말투**: 매우 친절하고 격려적
- **압박감**: 없음 (긍정적 피드백 중심)
- **예시**: "좋은 생각이에요! 이렇게 해보시는 건 어떨까요?"

#### Level 2: 기본 난이도 ⭐⭐
- **대상**: 기본기를 다지는 사용자
- **응답 길이**: 1-2문장, 명확하고 현실적
- **말투**: 친절하지만 현실적인 반응
- **압박감**: 약한 갈등과 압박 존재
- **예시**: "그런데 ~는 고려하셨나요?"

#### Level 3: 도전형 ⭐⭐⭐
- **대상**: 실전 훈련을 원하는 중급자
- **응답 길이**: 1-2문장, 핵심만 간결하게
- **말투**: 현실적이고 비판적
- **압박감**: 중간 압박 (설득/협상 필요)
- **예시**: "그 근거가 뭔가요? 실현 가능성은?"

#### Level 4: 고난도 (실전형) ⭐⭐⭐⭐
- **대상**: 실전과 같은 압박 상황 훈련
- **응답 길이**: 1-2문장 (10-15단어 이내)
- **말투**: 바쁘고 직설적, 때로는 비판적
- **압박감**: 강한 압박 (시간제약, 갈등, 이해관계 충돌)
- **예시**: "출시일까지 며칠인데요? 대책이 뭡니까?"

**💡 핵심 원리**: 같은 MBTI 성격이라도 난이도에 따라 완전히 다른 대화 경험을 제공합니다.

### 🎤 고급 음성 시스템
- **텍스트 입력**: 기본 텍스트 기반 대화
- **TTS (Text-to-Speech)**: 텍스트 입력 + AI 음성 응답 (ElevenLabs)
- **실시간 음성**: 완전한 음성 대화 (Gemini Live API)
- **Web Speech API**: 한국어 음성 인식 지원
- **혼합 입력 지원**: 텍스트와 음성을 자유롭게 조합

### 📊 과학적 평가 시스템
- **ComOn Check 연구 기반** 5점 척도 평가
- **5가지 핵심 역량 분석**: 메시지 명확성, 상대방 배려, 감정적 반응성, 대화 구조화, 전문적 역량
- **실시간 점수 추적**: 0-100점 스케일의 동적 성과 측정
- **상세한 피드백 리포트**: 강점, 개선점, 향후 발전 계획 제시

### 📈 개인 맞춤 발전 계획
- **단기/중기/장기 목표** 설정
- **행동 가이드라인** 제공
- **추천 학습 리소스** 제안
- **멘토링 및 코칭** 방향 제시

## 🛠 기술 스택

### Frontend
- **React 18** with TypeScript
- **Vite** - 빠른 개발 환경
- **Tailwind CSS** - 현대적 스타일링
- **Radix UI + shadcn/ui** - 고품질 UI 컴포넌트
- **TanStack React Query** - 효율적 서버 상태 관리
- **Wouter** - 경량 라우팅
- **React Hook Form + Zod** - 폼 관리 및 유효성 검사

### Backend
- **Node.js + Express** - 서버 프레임워크
- **TypeScript** - 타입 안전성
- **Google Gemini API** - AI 대화 생성 및 피드백 분석 (Gemini 2.5 Flash/Pro)
- **Gemini Live API** - 실시간 음성 대화 (GPT-4o Realtime)
- **ElevenLabs API** - 텍스트 음성 변환 (TTS)
- **PostgreSQL + Drizzle ORM** - 데이터베이스 관리 (Neon serverless)
- **WebSocket** - 실시간 음성 스트리밍
- **JWT Authentication** - 사용자 인증 및 권한 관리

### 개발 도구
- **ESBuild** - 고속 번들링
- **Drizzle Kit** - 데이터베이스 마이그레이션
- **Hot Module Replacement** - 실시간 개발

## 🚀 설치 및 실행

### 필수 요구사항
- Node.js 18+
- npm 또는 yarn
- PostgreSQL 데이터베이스
- Google Gemini API 키

### 1. 프로젝트 클론
```bash
git clone <repository-url>
cd ai-roleplay-training
```

### 2. 의존성 설치
```bash
npm install
```

### 3. 환경 변수 설정
`.env` 파일을 프로젝트 루트에 생성하고 다음 변수들을 설정하세요:

```env
# Google Gemini AI API
GEMINI_API_KEY=your_gemini_api_key_here
GOOGLE_API_KEY=your_google_api_key_here  # Gemini Live API용

# OpenAI API (선택사항)
OPENAI_API_KEY=your_openai_api_key_here

# ElevenLabs API (TTS 음성용, 선택사항)
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here

# 데이터베이스
DATABASE_URL=postgresql://username:password@localhost:5432/database_name

# 세션 보안
SESSION_SECRET=your_secure_session_secret_here

# AI 서비스 설정 (선택사항)
AI_PROVIDER=gemini  # gemini | openai | claude | custom
```

### 4. 개발 서버 실행
```bash
npm run dev
```

서버가 `http://localhost:5000`에서 실행됩니다.

## 🎯 사용법

### 기본 훈련 과정
1. **홈페이지**에서 훈련 시나리오 선택
2. **AI 캐릭터**와 10턴의 대화 진행
3. **음성 또는 텍스트**로 자유롭게 응답
4. **실시간 감정 피드백** 확인
5. **종합 평가 리포트** 검토
6. **개인 발전 계획** 수립

### MBTI 페르소나 시스템
- **16가지 MBTI 유형**: ISTJ, ISFJ, INFJ, INTJ, ISTP, ISFP, INFP, INTP, ESTP, ESFP, ENFP, ENTP, ESTJ, ESFJ, ENFJ, ENTJ
- **고유한 성격 특성**: 각 MBTI별 대화 스타일, 의사소통 패턴, 동기, 우려사항
- **성별 설정**: 남성/여성 음성 지원
- **시나리오 통합**: 각 시나리오에 적합한 MBTI 페르소나 자동 배정

### 시나리오 구성
- **컨텍스트**: 상황, 타임라인, 이해관계
- **목표**: 학습 목표 및 성공 기준
- **난이도**: 1-4단계 설정 가능 (기본값: 4)
- **페르소나**: 각 시나리오별 1-3명의 AI 캐릭터
- **AI 생성**: Gemini API를 활용한 자동 시나리오 생성

## 📊 평가 시스템

### 5가지 핵심 역량
1. **메시지 명확성** (25%) - 정확하고 이해하기 쉬운 의사소통
2. **상대방 배려** (20%) - 청자의 입장과 상황 고려
3. **감정적 반응성** (25%) - 상대방 감정에 대한 적절한 대응
4. **대화 구조화** (15%) - 논리적이고 체계적인 대화 진행
5. **전문적 역량** (15%) - 업무 상황에 맞는 전문성 발휘

### 점수 체계
- **0-20점**: 미흡 (빨간색)
- **21-40점**: 개선 필요 (주황색)
- **41-70점**: 보통 (노란색)
- **71-100점**: 우수 (초록색)

## 🏗 프로젝트 구조

```
├── client/                 # React 프론트엔드
│   ├── src/
│   │   ├── components/     # UI 컴포넌트
│   │   ├── pages/          # 페이지 컴포넌트
│   │   ├── lib/            # 유틸리티 및 설정
│   │   └── hooks/          # 커스텀 React 훅
├── server/                 # Express 백엔드
│   ├── services/           # 비즈니스 로직
│   ├── routes.ts           # API 라우트
│   └── storage.ts          # 데이터 저장소
├── shared/                 # 공유 타입 및 스키마
└── README.md              # 프로젝트 문서
```

## 🔧 개발 명령어

```bash
# 개발 서버 실행 (프론트엔드 + 백엔드)
npm run dev

# 프로덕션 빌드
npm run build

# 타입 체크
npm run type-check

# 데이터베이스 마이그레이션 (PostgreSQL 사용 시)
npx drizzle-kit migrate

# 의존성 설치
npm install <package-name>
```

## 🌐 배포

### Google Cloud Run 배포 (프로덕션)

Docker 기반 Cloud Run 배포를 지원합니다.

#### 배포 가이드
- **CLI 사용**: [DEPLOYMENT.md](./DEPLOYMENT.md) 참고
- **웹 콘솔 사용**: [DEPLOYMENT-WEB-CONSOLE.md](./DEPLOYMENT-WEB-CONSOLE.md) 참고

#### 빠른 시작 (기존 시크릿이 있는 경우)
```bash
# 다른 서비스의 시크릿 확인 후 mothle에 적용
./scripts/check-other-service-secrets.sh

# 또는 기존 시크릿 자동 감지 및 연결
./scripts/connect-existing-secrets.sh
```

**필수 환경 변수:**
- `JWT_SECRET` - JWT 인증 비밀 키
- `DATABASE_URL` - PostgreSQL 연결 문자열
- `GOOGLE_API_KEY` - Gemini API 키

### Replit 배포
1. Replit에서 프로젝트 import
2. 환경 변수 설정 (Secrets 탭)
3. Deploy 버튼 클릭

### 일반 서버 배포
```bash
# 프로덕션 빌드
npm run build

# 서버 실행
npm start
```

## 🤝 기여하기

1. Fork 생성
2. Feature 브랜치 생성 (`git checkout -b feature/amazing-feature`)
3. 변경사항 커밋 (`git commit -m 'Add amazing feature'`)
4. 브랜치에 Push (`git push origin feature/amazing-feature`)
5. Pull Request 생성

## 📄 라이선스

이 프로젝트는 **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)** 라이선스 하에 배포됩니다.

### 허용사항
- ✅ **개인적 사용** - 학습, 연구, 개인 프로젝트
- ✅ **교육 목적** - 교육 기관에서의 활용
- ✅ **수정 및 배포** - 소스코드 수정 및 재배포
- ✅ **비영리 목적** - 수익 창출을 목적으로 하지 않는 모든 사용

### 제한사항
- ❌ **상업적 이용 금지** - 수익 창출을 목적으로 하는 사용 불가
- ❌ **판매 금지** - 프로젝트 자체 또는 파생 제품의 판매 불가
- ❌ **영리 서비스 금지** - 유료 서비스나 상업적 플랫폼에서의 사용 불가

### 의무사항
- 📝 **저작자 표시** - 원저작자 및 라이선스 명시 필수
- 🔗 **라이선스 링크** - [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) 라이선스 전문 제공

**상업적 사용을 원하시는 경우, 별도 라이선스 협의가 필요합니다.**

## 🆘 문제 해결

### 일반적인 문제들

**Q: 음성 입력이 중복되어 입력됩니다**
A: 브라우저의 마이크 권한을 확인하고 페이지를 새로고침해보세요.

**Q: AI 응답이 생성되지 않습니다**
A: GEMINI_API_KEY가 올바르게 설정되었는지 확인하세요.

**Q: 프로필 이미지가 로드되지 않습니다**
A: 인터넷 연결을 확인하거나 브라우저 캐시를 삭제해보세요.

## 📞 지원

문제가 발생하면 GitHub Issues에 등록하거나 프로젝트 담당자에게 연락하세요.

---

**AI 롤플레잉 훈련 시스템**으로 더 나은 커뮤니케이션 스킬을 개발하세요! 🚀