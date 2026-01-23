# 웹 콘솔을 통한 Cloud Run 환경 변수 설정

gcloud CLI 없이 Google Cloud 콘솔에서 직접 설정하는 방법입니다.

## 1단계: 기존 서비스의 시크릿 확인

### 1-1. 기존 서비스 찾기

1. [Cloud Run 콘솔](https://console.cloud.google.com/run?project=roleplay-469506) 접속
2. 이미 배포된 서비스(정상 작동 중인 서비스) 클릭
3. 상단의 **"편집 및 새 버전 배포"** 또는 **"YAML"** 탭 클릭

### 1-2. 환경 변수 확인

**컨테이너 탭**에서 아래로 스크롤하여 다음 섹션 확인:
- **환경 변수**: 직접 설정된 값들
- **참조된 시크릿**: Secret Manager의 시크릿들

다음 항목들을 메모장에 복사하세요:
```
JWT_SECRET -> 시크릿: jwt-secret (또는 직접 값)
DATABASE_URL -> 시크릿: database-url (또는 직접 값)
GOOGLE_API_KEY -> 시크릿: google-api-key (또는 직접 값)
```

## 2단계: mothle 서비스에 시크릿 연결

### 2-1. mothle 서비스 열기

1. [Cloud Run 콘솔](https://console.cloud.google.com/run?project=roleplay-469506) 접속
2. **리전 필터**에서 `europe-west1` 선택
3. **mothle** 서비스 클릭
4. 상단의 **"편집 및 새 버전 배포"** 버튼 클릭

### 2-2. 환경 변수 설정

**컨테이너** 탭에서:

#### A. 직접 환경 변수로 설정하는 경우

"환경 변수" 섹션에서 **+ 변수 추가** 버튼 클릭하여 추가:

| 이름 | 값 |
|------|-----|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | (기존 서비스에서 복사한 값) |
| `DATABASE_URL` | (기존 서비스에서 복사한 값) |
| `GOOGLE_API_KEY` | (기존 서비스에서 복사한 값) |

⚠️ **주의**: 민감한 정보가 콘솔과 로그에 노출될 수 있으므로 프로덕션에서는 권장하지 않습니다.

#### B. Secret Manager 시크릿 사용하는 경우 (권장)

"참조된 시크릿" 섹션에서 **+ 시크릿 참조** 버튼 클릭:

1. **JWT_SECRET** 추가:
   - 환경 변수로 노출: `JWT_SECRET`
   - 시크릿 참조: 1단계에서 확인한 시크릿 이름 선택 (예: `jwt-secret`)
   - 버전: `latest`

2. **DATABASE_URL** 추가:
   - 환경 변수로 노출: `DATABASE_URL`
   - 시크릿 참조: 1단계에서 확인한 시크릿 이름 선택 (예: `database-url`)
   - 버전: `latest`

3. **GOOGLE_API_KEY** 추가:
   - 환경 변수로 노출: `GOOGLE_API_KEY`
   - 시크릿 참조: 1단계에서 확인한 시크릿 이름 선택 (예: `google-api-key`)
   - 버전: `latest`

4. **NODE_ENV** 추가 (일반 환경 변수):
   - "환경 변수" 섹션에서 **+ 변수 추가**
   - 이름: `NODE_ENV`
   - 값: `production`

### 2-3. 기타 설정 확인

같은 페이지에서 다음 설정들도 확인하세요:

**리소스:**
- 메모리: `1 GiB`
- CPU: `1`

**컨테이너 포트:**
- `8080`

**요청 시간 제한:**
- `300초` (5분)

**자동 확장:**
- 최소 인스턴스: `0`
- 최대 인스턴스: `10`

### 2-4. 배포

하단의 **"배포"** 버튼 클릭

배포가 완료되면 새 버전이 시작되고 환경 변수가 적용됩니다.

## 3단계: 배포 확인

### 3-1. 서비스 상태 확인

1. mothle 서비스 페이지에서 **"로그"** 탭 클릭
2. 다음과 같은 로그가 보이면 성공:
   ```
   🚀 Starting server initialization...
   📋 Environment: production
   🔌 PORT: 8080
   🗄️ Running database migrations...
   ✅ Server started successfully!
   ```

3. 에러가 보이면:
   ```
   ⛔ CRITICAL: JWT_SECRET environment variable is required.
   ```
   → 환경 변수 설정이 제대로 안 된 것. 2단계 다시 확인

### 3-2. 서비스 테스트

서비스 URL (mothle 페이지 상단에 표시됨)에 접속:
```
https://mothle-xxxxxxxxxx-ew.a.run.app/api/health
```

정상 응답:
```json
{
  "status": "healthy",
  "timestamp": "2026-01-23T...",
  "uptime": 123.45,
  "memory": { ... }
}
```

## Secret Manager에서 직접 시크릿 확인하기

시크릿 이름을 모르는 경우:

1. [Secret Manager 콘솔](https://console.cloud.google.com/security/secret-manager?project=roleplay-469506) 접속
2. 프로젝트의 모든 시크릿 목록 확인
3. 일반적인 시크릿 이름:
   - `jwt-secret`, `JWT_SECRET`
   - `database-url`, `DATABASE_URL`, `db-url`
   - `google-api-key`, `GOOGLE_API_KEY`, `gemini-api-key`, `GEMINI_API_KEY`

## 권한 문제 해결

"권한이 없습니다" 오류가 발생하면:

1. [IAM 콘솔](https://console.cloud.google.com/iam-admin/iam?project=roleplay-469506) 접속
2. Cloud Run 서비스 계정 찾기 (보통 `*-compute@developer.gserviceaccount.com`)
3. **역할 편집** 클릭
4. **Secret Manager 비밀 접근자** 역할 추가

또는 시크릿별로 권한 설정:
1. Secret Manager에서 시크릿 클릭
2. **권한** 탭
3. **주 구성원 추가**
4. Cloud Run 서비스 계정 입력
5. 역할: **Secret Manager 비밀 접근자**

## 문제가 계속되면

1. **로그 확인**: [Cloud Run 로그](https://console.cloud.google.com/run/detail/europe-west1/mothle?project=roleplay-469506) → "로그" 탭
2. **시크릿 값 확인**: Secret Manager에서 시크릿이 비어있지 않은지 확인
3. **서비스 계정 권한**: IAM에서 Cloud Run 서비스 계정에 Secret Manager 접근 권한이 있는지 확인

## CLI 스크립트 사용하기 (선택사항)

gcloud CLI가 설치되어 있다면:

```bash
# 다른 서비스의 시크릿 확인 후 mothle에 적용
chmod +x scripts/check-other-service-secrets.sh
./scripts/check-other-service-secrets.sh
```

또는

```bash
# 기존 시크릿 자동 감지 및 연결
chmod +x scripts/connect-existing-secrets.sh
./scripts/connect-existing-secrets.sh
```
