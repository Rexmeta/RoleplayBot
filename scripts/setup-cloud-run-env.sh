#!/bin/bash

# Cloud Run 환경 변수 설정 스크립트
# 새 프로젝트를 처음 배포할 때 사용합니다.
# 
# 사용법:
#   ./scripts/setup-cloud-run-env.sh
#   또는 환경변수 지정:
#   PROJECT_ID=my-project SERVICE_NAME=my-service REGION=asia-northeast3 ./scripts/setup-cloud-run-env.sh

set -e

echo "=============================================="
echo "🚀 Google Cloud Run 환경 설정 스크립트"
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

# gcloud 인증 확인
echo "🔐 gcloud 인증 확인 중..."
if ! gcloud auth print-identity-token &>/dev/null; then
  echo "⚠️  gcloud 인증이 필요합니다. 다음 명령어를 실행하세요:"
  echo "   gcloud auth login"
  exit 1
fi
echo "✅ gcloud 인증 완료"
echo ""

# 1. Secret Manager에 시크릿 생성
echo "=============================================="
echo "🔐 Step 1: Secret Manager 시크릿 설정"
echo "=============================================="

# JWT_SECRET 생성
if ! gcloud secrets describe jwt-secret --project=$PROJECT_ID &>/dev/null 2>&1; then
  echo "📝 jwt-secret 생성 중..."
  openssl rand -base64 48 | gcloud secrets create jwt-secret \
    --data-file=- \
    --project=$PROJECT_ID
  echo "✅ jwt-secret 생성 완료"
else
  echo "⏭️  jwt-secret 이미 존재"
fi

# DATABASE_URL 확인/생성
if ! gcloud secrets describe database-url --project=$PROJECT_ID &>/dev/null 2>&1; then
  echo ""
  echo "⚠️  database-url 시크릿이 없습니다."
  echo "   PostgreSQL 연결 문자열을 입력하세요 (예: postgresql://user:pass@host:5432/dbname)"
  read -p "   DATABASE_URL: " DB_URL
  
  if [ -n "$DB_URL" ]; then
    echo "$DB_URL" | gcloud secrets create database-url \
      --data-file=- \
      --project=$PROJECT_ID
    echo "✅ database-url 생성 완료"
  else
    echo "⚠️  database-url을 나중에 수동으로 생성해야 합니다."
  fi
else
  echo "✅ database-url 이미 존재"
fi

# GOOGLE_API_KEY 확인/생성
if ! gcloud secrets describe google-api-key --project=$PROJECT_ID &>/dev/null 2>&1; then
  echo ""
  echo "⚠️  google-api-key 시크릿이 없습니다."
  echo "   Gemini API 키를 입력하세요:"
  read -p "   GOOGLE_API_KEY: " API_KEY
  
  if [ -n "$API_KEY" ]; then
    echo "$API_KEY" | gcloud secrets create google-api-key \
      --data-file=- \
      --project=$PROJECT_ID
    echo "✅ google-api-key 생성 완료"
  else
    echo "⚠️  google-api-key를 나중에 수동으로 생성해야 합니다."
  fi
else
  echo "✅ google-api-key 이미 존재"
fi

echo ""
echo "=============================================="
echo "🔧 Step 2: Cloud Run 서비스 설정"
echo "=============================================="

# Cloud Run 서비스에 시크릿 연결
echo "Cloud Run 서비스에 시크릿 연결 중..."

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
echo "=============================================="
echo "✅ 설정 완료!"
echo "=============================================="
echo ""
echo "📝 서비스 URL 확인:"
echo "   gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format='value(status.url)'"
echo ""
echo "🔍 서비스 상태 확인:"
echo "   gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID"
echo ""
echo "📊 Secret Manager 콘솔:"
echo "   https://console.cloud.google.com/security/secret-manager?project=$PROJECT_ID"
