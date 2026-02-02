#!/bin/bash

# 기존 Secret Manager 시크릿을 Cloud Run 서비스에 연결하는 스크립트
# 이미 다른 서비스에서 사용 중인 시크릿을 재사용합니다.
#
# 사용법:
#   ./scripts/connect-existing-secrets.sh
#   또는 환경변수 지정:
#   PROJECT_ID=my-project SERVICE_NAME=my-service REGION=asia-northeast3 ./scripts/connect-existing-secrets.sh

set -e

echo "=============================================="
echo "🔗 기존 시크릿 연결 스크립트"
echo "=============================================="
echo ""

# 환경 변수 설정 (미지정시 사용자 입력 요청)
if [ -z "$PROJECT_ID" ]; then
  read -p "📋 Google Cloud Project ID: " PROJECT_ID
fi

if [ -z "$SERVICE_NAME" ]; then
  read -p "🎯 Cloud Run 서비스 이름: " SERVICE_NAME
fi

if [ -z "$REGION" ]; then
  echo "🌍 사용 가능한 리전 예시: asia-northeast3 (서울), us-central1, europe-west1"
  read -p "🌍 배포 리전: " REGION
fi

if [ -z "$PROJECT_ID" ] || [ -z "$SERVICE_NAME" ] || [ -z "$REGION" ]; then
  echo "❌ 모든 값을 입력해야 합니다."
  exit 1
fi

echo ""
echo "📋 설정 확인:"
echo "   Project ID: $PROJECT_ID"
echo "   Service Name: $SERVICE_NAME"
echo "   Region: $REGION"
echo ""

# 1. 현재 프로젝트의 시크릿 목록 확인
echo "=============================================="
echo "📦 Step 1: 프로젝트의 시크릿 목록"
echo "=============================================="
gcloud secrets list --project=$PROJECT_ID --format="table(name,createTime)" 2>/dev/null || {
  echo "⚠️  gcloud 명령어 실행 실패. 인증을 확인하세요:"
  echo "   gcloud auth login"
  exit 1
}
echo ""

# 2. 필요한 시크릿 확인
echo "=============================================="
echo "🔍 Step 2: 필수 시크릿 확인"
echo "=============================================="

# 일반적인 시크릿 이름 패턴 확인
SECRET_NAMES=("jwt-secret" "JWT_SECRET" "database-url" "DATABASE_URL" "google-api-key" "GOOGLE_API_KEY" "gemini-api-key" "GEMINI_API_KEY")

echo "필수 시크릿 확인 중..."
for secret in "${SECRET_NAMES[@]}"; do
  if gcloud secrets describe "$secret" --project=$PROJECT_ID &>/dev/null; then
    echo "   ✅ $secret 존재"
  fi
done
echo ""

# 3. 시크릿 매핑 구성
echo "=============================================="
echo "🔗 Step 3: 시크릿 연결 설정"
echo "=============================================="

SECRET_MAPPINGS=""

# JWT_SECRET
if gcloud secrets describe "jwt-secret" --project=$PROJECT_ID &>/dev/null; then
  SECRET_MAPPINGS="${SECRET_MAPPINGS}JWT_SECRET=jwt-secret:latest"
elif gcloud secrets describe "JWT_SECRET" --project=$PROJECT_ID &>/dev/null; then
  SECRET_MAPPINGS="${SECRET_MAPPINGS}JWT_SECRET=JWT_SECRET:latest"
fi

# DATABASE_URL
if gcloud secrets describe "database-url" --project=$PROJECT_ID &>/dev/null; then
  if [ -n "$SECRET_MAPPINGS" ]; then SECRET_MAPPINGS="${SECRET_MAPPINGS},"; fi
  SECRET_MAPPINGS="${SECRET_MAPPINGS}DATABASE_URL=database-url:latest"
elif gcloud secrets describe "DATABASE_URL" --project=$PROJECT_ID &>/dev/null; then
  if [ -n "$SECRET_MAPPINGS" ]; then SECRET_MAPPINGS="${SECRET_MAPPINGS},"; fi
  SECRET_MAPPINGS="${SECRET_MAPPINGS}DATABASE_URL=DATABASE_URL:latest"
fi

# GOOGLE_API_KEY
if gcloud secrets describe "google-api-key" --project=$PROJECT_ID &>/dev/null; then
  if [ -n "$SECRET_MAPPINGS" ]; then SECRET_MAPPINGS="${SECRET_MAPPINGS},"; fi
  SECRET_MAPPINGS="${SECRET_MAPPINGS}GOOGLE_API_KEY=google-api-key:latest"
elif gcloud secrets describe "GOOGLE_API_KEY" --project=$PROJECT_ID &>/dev/null; then
  if [ -n "$SECRET_MAPPINGS" ]; then SECRET_MAPPINGS="${SECRET_MAPPINGS},"; fi
  SECRET_MAPPINGS="${SECRET_MAPPINGS}GOOGLE_API_KEY=GOOGLE_API_KEY:latest"
elif gcloud secrets describe "gemini-api-key" --project=$PROJECT_ID &>/dev/null; then
  if [ -n "$SECRET_MAPPINGS" ]; then SECRET_MAPPINGS="${SECRET_MAPPINGS},"; fi
  SECRET_MAPPINGS="${SECRET_MAPPINGS}GOOGLE_API_KEY=gemini-api-key:latest"
elif gcloud secrets describe "GEMINI_API_KEY" --project=$PROJECT_ID &>/dev/null; then
  if [ -n "$SECRET_MAPPINGS" ]; then SECRET_MAPPINGS="${SECRET_MAPPINGS},"; fi
  SECRET_MAPPINGS="${SECRET_MAPPINGS}GOOGLE_API_KEY=GEMINI_API_KEY:latest"
fi

if [ -n "$SECRET_MAPPINGS" ]; then
  echo "발견된 시크릿 매핑: $SECRET_MAPPINGS"
  echo ""
  echo "실행할 명령어:"
  echo "gcloud run services update $SERVICE_NAME \\"
  echo "  --project=$PROJECT_ID \\"
  echo "  --region=$REGION \\"
  echo "  --set-env-vars NODE_ENV=production \\"
  echo "  --set-secrets $SECRET_MAPPINGS"
  echo ""
  
  read -p "이 명령어를 실행하시겠습니까? (y/N): " response

  if [[ "$response" =~ ^[Yy]$ ]]; then
    echo ""
    echo "🚀 시크릿 연결 중..."
    gcloud run services update $SERVICE_NAME \
      --project=$PROJECT_ID \
      --region=$REGION \
      --set-env-vars NODE_ENV=production \
      --set-secrets "$SECRET_MAPPINGS" \
      --timeout 300 \
      --memory 1Gi \
      --cpu 1 \
      --min-instances 0 \
      --max-instances 10 \
      --port 8080 \
      --allow-unauthenticated

    echo ""
    echo "=============================================="
    echo "✅ 시크릿 연결 완료!"
    echo "=============================================="
  else
    echo "취소되었습니다. 위 명령어를 복사하여 수동으로 실행하세요."
  fi
else
  echo "❌ 필수 시크릿을 찾을 수 없습니다."
  echo ""
  echo "다음 시크릿 중 하나 이상이 필요합니다:"
  echo "  - jwt-secret 또는 JWT_SECRET"
  echo "  - database-url 또는 DATABASE_URL"
  echo "  - google-api-key 또는 GOOGLE_API_KEY"
  echo ""
  echo "시크릿을 먼저 생성하려면 ./scripts/setup-cloud-run-env.sh 를 실행하세요."
fi

echo ""
echo "📊 Secret Manager 콘솔:"
echo "   https://console.cloud.google.com/security/secret-manager?project=$PROJECT_ID"
