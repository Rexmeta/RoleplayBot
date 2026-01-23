# 배포 가이드 (Cloud Run Deployment Guide)

이 문서는 Google Cloud Run에 애플리케이션을 배포하는 방법을 설명합니다.

## 사전 요구사항

- Google Cloud Project 생성
- gcloud CLI 설치 및 인증
- PostgreSQL 데이터베이스 (Neon, Cloud SQL 등)
- Google Gemini API 키

## 배포 에러 해결: 컨테이너 시작 실패

### 문제 증상

```
ERROR: (gcloud.run.services.update) The user-provided container failed to start and listen on the port defined provided by the PORT=8080 environment variable
```

### 원인

애플리케이션이 시작하려면 다음 환경 변수들이 필수적으로 설정되어야 합니다:

1. **JWT_SECRET** (필수) - JWT 인증에 사용되는 비밀 키
2. **DATABASE_URL** (필수) - PostgreSQL 데이터베이스 연결 문자열
3. **GOOGLE_API_KEY** 또는 **GEMINI_API_KEY** - Gemini AI 서비스 API 키

이 환경 변수들이 설정되지 않으면 서버가 시작되지 않습니다.

## 해결 방법

### 방법 1: Secret Manager 사용 (권장)

#### 1단계: Secret Manager에 시크릿 생성

```bash
# 프로젝트 ID 설정
PROJECT_ID="roleplay-469506"

# JWT_SECRET 생성 (랜덤 64자)
openssl rand -base64 48 | gcloud secrets create jwt-secret \
  --data-file=- \
  --project=$PROJECT_ID

# DATABASE_URL 생성
echo 'postgresql://username:password@host:5432/database_name' | \
  gcloud secrets create database-url \
  --data-file=- \
  --project=$PROJECT_ID

# GOOGLE_API_KEY 생성
echo 'your-gemini-api-key-here' | \
  gcloud secrets create google-api-key \
  --data-file=- \
  --project=$PROJECT_ID
```

#### 2단계: Cloud Run 서비스에 시크릿 연결

```bash
SERVICE_NAME="mothle"
REGION="europe-west1"

gcloud run services update $SERVICE_NAME \
  --project=$PROJECT_ID \
  --region=$REGION \
  --set-env-vars NODE_ENV=production \
  --set-secrets JWT_SECRET=jwt-secret:latest,DATABASE_URL=database-url:latest,GOOGLE_API_KEY=google-api-key:latest
```

#### 3단계: 애플리케이션 재배포

재배포하면 새로운 환경 변수들이 적용되어 컨테이너가 정상적으로 시작됩니다.

### 방법 2: 직접 환경 변수 설정 (간단하지만 덜 안전)

```bash
SERVICE_NAME="mothle"
REGION="europe-west1"
PROJECT_ID="roleplay-469506"

gcloud run services update $SERVICE_NAME \
  --project=$PROJECT_ID \
  --region=$REGION \
  --set-env-vars \
    NODE_ENV=production,\
    JWT_SECRET="your-secure-random-string-at-least-32-chars",\
    DATABASE_URL="postgresql://user:pass@host:5432/db",\
    GOOGLE_API_KEY="your-gemini-api-key"
```

⚠️ **주의**: 이 방법은 시크릿이 콘솔과 로그에 노출될 수 있으므로 프로덕션 환경에서는 Secret Manager 사용을 권장합니다.

### 방법 3: 자동화 스크립트 사용

제공된 스크립트를 실행하면 자동으로 설정됩니다:

```bash
chmod +x scripts/setup-cloud-run-env.sh
./scripts/setup-cloud-run-env.sh
```

## 환경 변수 설명

| 변수명 | 필수 여부 | 설명 | 예시 |
|--------|-----------|------|------|
| `JWT_SECRET` | ✅ 필수 | JWT 토큰 서명에 사용되는 비밀 키. 최소 32자 이상의 랜덤 문자열 | `openssl rand -base64 48` 로 생성 |
| `DATABASE_URL` | ✅ 필수 | PostgreSQL 데이터베이스 연결 문자열 | `postgresql://user:pass@host:5432/dbname` |
| `GOOGLE_API_KEY` | ⚠️ 권장 | Google Gemini API 키 (AI 기능 사용) | `AIzaSy...` |
| `GEMINI_API_KEY` | ⚠️ 권장 | GOOGLE_API_KEY 대신 사용 가능 | `AIzaSy...` |
| `NODE_ENV` | 자동 설정 | 실행 환경 (`production` 또는 `development`) | `production` |
| `PORT` | 자동 설정 | Cloud Run이 자동으로 8080 설정 | `8080` |

## 배포 확인

환경 변수 설정 후 서비스 상태를 확인하세요:

```bash
gcloud run services describe mothle \
  --region=europe-west1 \
  --project=roleplay-469506
```

서비스 로그 확인:

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=mothle" \
  --limit 50 \
  --format json \
  --project=roleplay-469506
```

## 로컬 개발 환경 설정

1. `.env.example`을 `.env`로 복사:
   ```bash
   cp .env.example .env
   ```

2. `.env` 파일을 편집하여 필요한 값들을 설정:
   ```env
   JWT_SECRET=your-local-development-secret-key
   DATABASE_URL=postgresql://localhost:5432/roleplaybot
   GEMINI_API_KEY=your-gemini-api-key
   ```

3. 로컬 서버 실행:
   ```bash
   npm run dev
   ```

## 문제 해결

### 컨테이너가 여전히 시작되지 않는 경우

1. 환경 변수가 올바르게 설정되었는지 확인:
   ```bash
   gcloud run services describe mothle --region=europe-west1 --format=json | jq '.spec.template.spec.containers[0].env'
   ```

2. Secret Manager 권한 확인:
   ```bash
   # Cloud Run 서비스 계정에 Secret Accessor 역할 부여
   gcloud projects add-iam-policy-binding roleplay-469506 \
     --member=serviceAccount:SERVICE_ACCOUNT_EMAIL \
     --role=roles/secretmanager.secretAccessor
   ```

3. 데이터베이스 연결 확인:
   - DATABASE_URL이 올바른지 확인
   - 데이터베이스가 Cloud Run에서 접근 가능한지 확인 (IP 화이트리스트, VPC 등)

4. API 키 확인:
   - Gemini API 키가 유효한지 확인
   - API가 활성화되어 있는지 확인

## 추가 리소스

- [Cloud Run 문서](https://cloud.google.com/run/docs)
- [Secret Manager 가이드](https://cloud.google.com/secret-manager/docs)
- [환경 변수 설정](https://cloud.google.com/run/docs/configuring/environment-variables)
