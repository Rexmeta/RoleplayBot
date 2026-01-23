#!/bin/bash

# Cloud Run 환경 변수 설정 스크립트
# 이 스크립트는 Cloud Run 서비스에 필요한 환경 변수와 시크릿을 설정합니다.

set -e

# 설정 변수
PROJECT_ID="${PROJECT_ID:-roleplay-469506}"
SERVICE_NAME="${SERVICE_NAME:-mothle}"
REGION="${REGION:-europe-west1}"

echo "🚀 Cloud Run 환경 설정 시작..."
echo "📋 Project ID: $PROJECT_ID"
echo "🎯 Service Name: $SERVICE_NAME"
echo "🌍 Region: $REGION"
echo ""

# 1. Secret Manager에 시크릿 생성 (이미 존재하면 건너뜀)
echo "🔐 Step 1: Creating secrets in Secret Manager..."

# JWT_SECRET 생성
if ! gcloud secrets describe jwt-secret --project=$PROJECT_ID &>/dev/null; then
  echo "   Creating jwt-secret..."
  # 랜덤한 64자 시크릿 생성
  openssl rand -base64 48 | gcloud secrets create jwt-secret \
    --data-file=- \
    --project=$PROJECT_ID
  echo "   ✅ jwt-secret created"
else
  echo "   ⏭️  jwt-secret already exists"
fi

# DATABASE_URL 생성 (사용자가 직접 입력해야 함)
if ! gcloud secrets describe database-url --project=$PROJECT_ID &>/dev/null; then
  echo "   ⚠️  database-url not found"
  echo "   Please create it manually with your PostgreSQL connection string:"
  echo "   echo 'postgresql://user:password@host:5432/dbname' | gcloud secrets create database-url --data-file=- --project=$PROJECT_ID"
else
  echo "   ✅ database-url exists"
fi

# GOOGLE_API_KEY 생성 (사용자가 직접 입력해야 함)
if ! gcloud secrets describe google-api-key --project=$PROJECT_ID &>/dev/null; then
  echo "   ⚠️  google-api-key not found"
  echo "   Please create it manually with your Gemini API key:"
  echo "   echo 'your-gemini-api-key' | gcloud secrets create google-api-key --data-file=- --project=$PROJECT_ID"
else
  echo "   ✅ google-api-key exists"
fi

echo ""
echo "🔧 Step 2: Updating Cloud Run service with secrets..."

# 2. Cloud Run 서비스 업데이트
gcloud run services update $SERVICE_NAME \
  --project=$PROJECT_ID \
  --region=$REGION \
  --set-env-vars NODE_ENV=production \
  --set-secrets JWT_SECRET=jwt-secret:latest,DATABASE_URL=database-url:latest,GOOGLE_API_KEY=google-api-key:latest \
  --timeout 300 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --port 8080 \
  --allow-unauthenticated

echo ""
echo "✅ Cloud Run 환경 설정 완료!"
echo ""
echo "📝 다음 단계:"
echo "1. 아직 생성되지 않은 시크릿들을 수동으로 생성하세요"
echo "2. 애플리케이션을 재배포하세요"
echo ""
echo "🔍 서비스 상태 확인:"
echo "   gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID"
