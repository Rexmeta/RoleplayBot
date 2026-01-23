#!/bin/bash

# 기존 Secret Manager 시크릿을 Cloud Run 서비스에 연결하는 스크립트
# 이미 다른 서비스에서 사용 중인 시크릿을 재사용합니다.

set -e

# 설정 변수
PROJECT_ID="${PROJECT_ID:-roleplay-469506}"
SERVICE_NAME="${SERVICE_NAME:-mothle}"
REGION="${REGION:-europe-west1}"

echo "🔍 기존 시크릿 확인 중..."
echo "📋 Project ID: $PROJECT_ID"
echo "🎯 Service Name: $SERVICE_NAME"
echo "🌍 Region: $REGION"
echo ""

# 1. 현재 프로젝트의 시크릿 목록 확인
echo "📦 Step 1: 프로젝트의 시크릿 목록"
echo "----------------------------------------"
gcloud secrets list --project=$PROJECT_ID --format="table(name,createTime)" || {
  echo "⚠️  gcloud 명령어 실행 실패. 수동으로 확인이 필요합니다."
  echo "   https://console.cloud.google.com/security/secret-manager?project=$PROJECT_ID"
}
echo ""

# 2. mothle 서비스의 현재 환경 변수 확인
echo "⚙️  Step 2: mothle 서비스의 현재 설정"
echo "----------------------------------------"
gcloud run services describe $SERVICE_NAME \
  --region=$REGION \
  --project=$PROJECT_ID \
  --format="value(spec.template.spec.containers[0].env)" 2>/dev/null || {
  echo "⚠️  서비스 정보를 가져올 수 없습니다."
}
echo ""

# 3. 일반적인 시크릿 이름 패턴 확인
echo "🔍 Step 3: 일반적인 시크릿 이름 확인"
echo "----------------------------------------"
SECRET_NAMES=("jwt-secret" "JWT_SECRET" "database-url" "DATABASE_URL" "google-api-key" "GOOGLE_API_KEY" "gemini-api-key" "GEMINI_API_KEY")

FOUND_SECRETS=""

for secret in "${SECRET_NAMES[@]}"; do
  if gcloud secrets describe "$secret" --project=$PROJECT_ID &>/dev/null; then
    echo "   ✅ $secret 존재"
    FOUND_SECRETS="$FOUND_SECRETS $secret"
  fi
done
echo ""

# 4. 시크릿 연결 명령어 생성
echo "🔗 Step 4: mothle 서비스에 시크릿 연결"
echo "----------------------------------------"

# 사용자에게 어떤 시크릿을 사용할지 확인
echo "다음 명령어를 실행하여 시크릿을 연결하세요:"
echo ""
echo "gcloud run services update $SERVICE_NAME \\"
echo "  --project=$PROJECT_ID \\"
echo "  --region=$REGION \\"
echo "  --set-env-vars NODE_ENV=production \\"

# 발견된 시크릿에 따라 명령어 구성
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
  echo "  --set-secrets $SECRET_MAPPINGS"
  echo ""
  echo "📝 자동 실행하시겠습니까? (y/N)"
  read -r response

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
    echo "✅ 시크릿 연결 완료!"
    echo ""
    echo "🔄 다음 배포 시 컨테이너가 정상적으로 시작됩니다."
  else
    echo ""
    echo "위 명령어를 복사하여 수동으로 실행하세요."
  fi
else
  echo "  ⚠️  필수 시크릿을 찾을 수 없습니다."
  echo ""
  echo "다음 시크릿들이 필요합니다:"
  echo "  - JWT_SECRET (또는 jwt-secret)"
  echo "  - DATABASE_URL (또는 database-url)"
  echo "  - GOOGLE_API_KEY (또는 google-api-key, gemini-api-key)"
  echo ""
  echo "기존 서비스의 시크릿 이름을 확인하려면:"
  echo "  gcloud run services describe YOUR_OTHER_SERVICE --region=YOUR_REGION --project=$PROJECT_ID"
fi

echo ""
echo "📊 Secret Manager 콘솔:"
echo "   https://console.cloud.google.com/security/secret-manager?project=$PROJECT_ID"
echo ""
echo "🔍 mothle 서비스 상태 확인:"
echo "   gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID"
