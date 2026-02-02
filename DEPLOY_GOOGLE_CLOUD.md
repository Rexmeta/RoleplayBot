# Google Cloud Run 배포 가이드

이 문서는 프로젝트를 Google Cloud Run에 처음 배포하는 방법을 설명합니다.

---

## 목차
1. [사전 준비](#사전-준비)
2. [1단계: Google Cloud 프로젝트 설정](#1단계-google-cloud-프로젝트-설정)
3. [2단계: 필수 API 활성화](#2단계-필수-api-활성화)
4. [3단계: Artifact Registry 저장소 생성](#3단계-artifact-registry-저장소-생성)
5. [4단계: Secret Manager 시크릿 생성](#4단계-secret-manager-시크릿-생성)
6. [5단계: 배포](#5단계-배포)
7. [6단계: 배포 확인](#6단계-배포-확인)
8. [문제 해결](#문제-해결)

---

## 사전 준비

### 필수 도구 설치
```bash
# Google Cloud SDK 설치 확인
gcloud --version

# 설치 안 되어있으면: https://cloud.google.com/sdk/docs/install
```

### 필수 정보 준비
- Google Cloud Project ID
- PostgreSQL 데이터베이스 연결 문자열 (Neon, Supabase 등)
- Gemini API Key (https://aistudio.google.com/app/apikey)

---

## 1단계: Google Cloud 프로젝트 설정

```bash
# Google Cloud 로그인
gcloud auth login

# 프로젝트 설정 (YOUR_PROJECT_ID를 실제 프로젝트 ID로 변경)
export PROJECT_ID="your-project-id"
gcloud config set project $PROJECT_ID

# 결제 계정 연결 확인 (필수)
gcloud billing projects describe $PROJECT_ID
```

---

## 2단계: 필수 API 활성화

```bash
# 필요한 API 활성화
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

---

## 3단계: Artifact Registry 저장소 생성

```bash
# 리전 설정 (서울: asia-northeast3, 도쿄: asia-northeast1)
export REGION="asia-northeast3"

# Docker 이미지 저장소 생성
gcloud artifacts repositories create cloud-run-source-deploy \
  --repository-format=docker \
  --location=$REGION \
  --description="Cloud Run 배포용 Docker 이미지"
```

---

## 4단계: Secret Manager 시크릿 생성

### 4.1 JWT_SECRET 생성 (자동 생성)
```bash
openssl rand -base64 48 | gcloud secrets create jwt-secret --data-file=-
```

### 4.2 DATABASE_URL 생성
```bash
# Neon Database URL 예시
echo "postgresql://user:password@host.neon.tech/dbname?sslmode=require" | \
  gcloud secrets create database-url --data-file=-
```

### 4.3 GOOGLE_API_KEY 생성 (Gemini API)
```bash
echo "your-gemini-api-key" | gcloud secrets create google-api-key --data-file=-
```

### 4.4 Cloud Build 서비스 계정에 시크릿 접근 권한 부여
```bash
# 프로젝트 번호 확인
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')

# Cloud Build 서비스 계정에 Secret Manager 접근 권한 부여
gcloud secrets add-iam-policy-binding jwt-secret \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding database-url \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding google-api-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## 5단계: 배포

### 5.1 cloudbuild.yaml 수정
`cloudbuild.yaml` 파일의 `substitutions` 섹션을 수정하세요:

```yaml
substitutions:
  _SERVICE_NAME: 'your-service-name'    # 서비스 이름
  _REGION: 'asia-northeast3'            # 배포 리전
```

### 5.2 Cloud Build로 배포
```bash
# 프로젝트 루트에서 실행
gcloud builds submit --config=cloudbuild.yaml .
```

---

## 6단계: 배포 확인

```bash
# 서비스 상태 확인
gcloud run services describe your-service-name --region=$REGION

# 서비스 URL 확인
gcloud run services describe your-service-name --region=$REGION --format='value(status.url)'

# 로그 확인
gcloud run services logs read your-service-name --region=$REGION --limit=50
```

---

## 문제 해결

### 빌드 실패: "denied: Permission denied"
Artifact Registry 권한 문제입니다:
```bash
gcloud artifacts repositories add-iam-policy-binding cloud-run-source-deploy \
  --location=$REGION \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"
```

### 배포 실패: "Secret not found"
시크릿이 생성되지 않았습니다. 4단계를 다시 확인하세요:
```bash
gcloud secrets list
```

### 배포 후 앱 오류: "Database connection failed"
DATABASE_URL 시크릿 값을 확인하세요:
```bash
gcloud secrets versions access latest --secret=database-url
```

### 헬스체크 실패
서버가 `/api/health` 엔드포인트에 200을 반환하는지 확인하세요.

---

## 환경별 배포

### 개발 환경
```bash
gcloud builds submit --config=cloudbuild.yaml \
  --substitutions=_SERVICE_NAME=my-app-dev,_MIN_INSTANCES=0
```

### 프로덕션 환경
```bash
gcloud builds submit --config=cloudbuild.yaml \
  --substitutions=_SERVICE_NAME=my-app-prod,_MIN_INSTANCES=1
```

---

## 자동 배포 설정 (GitHub 연동)

### Cloud Build 트리거 생성
```bash
gcloud builds triggers create github \
  --name="deploy-on-push" \
  --repo-name="your-repo" \
  --repo-owner="your-github-username" \
  --branch-pattern="^main$" \
  --build-config="cloudbuild.yaml"
```

이제 `main` 브랜치에 푸시하면 자동으로 배포됩니다.
