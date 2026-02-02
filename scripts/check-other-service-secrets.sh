#!/bin/bash

# 다른 Cloud Run 서비스의 시크릿 설정을 확인하는 스크립트
# 기존 서비스의 시크릿 이름을 파악하여 새 서비스에 적용합니다.
#
# 사용법:
#   ./scripts/check-other-service-secrets.sh
#   또는 환경변수 지정:
#   PROJECT_ID=my-project ./scripts/check-other-service-secrets.sh

set -e

echo "=============================================="
echo "🔍 Cloud Run 서비스 시크릿 확인 스크립트"
echo "=============================================="
echo ""

# 환경 변수 설정 (미지정시 사용자 입력 요청)
if [ -z "$PROJECT_ID" ]; then
  read -p "📋 Google Cloud Project ID: " PROJECT_ID
fi

if [ -z "$PROJECT_ID" ]; then
  echo "❌ Project ID를 입력해야 합니다."
  exit 1
fi

echo ""
echo "📋 Project ID: $PROJECT_ID"
echo ""

# 모든 리전의 Cloud Run 서비스 나열
echo "=============================================="
echo "📋 Cloud Run 서비스 목록"
echo "=============================================="
gcloud run services list --project=$PROJECT_ID --format="table(SERVICE,REGION,URL)" 2>/dev/null || {
  echo "⚠️  gcloud 명령어 실행 실패"
  echo "1. gcloud auth login 으로 인증하세요"
  echo "2. 웹 콘솔에서 확인: https://console.cloud.google.com/run?project=$PROJECT_ID"
  exit 1
}
echo ""

# 사용자에게 서비스 이름과 리전 입력받기
echo "확인할 서비스 정보를 입력하세요:"
read -p "서비스 이름: " OTHER_SERVICE
read -p "리전 (예: asia-northeast3): " OTHER_REGION

if [ -z "$OTHER_SERVICE" ] || [ -z "$OTHER_REGION" ]; then
  echo "❌ 서비스 이름과 리전을 모두 입력해야 합니다."
  exit 1
fi

echo ""
echo "=============================================="
echo "🔍 $OTHER_SERVICE ($OTHER_REGION) 서비스 설정"
echo "=============================================="
echo ""

# 환경 변수 확인
echo "📦 환경 변수:"
gcloud run services describe "$OTHER_SERVICE" \
  --region="$OTHER_REGION" \
  --project=$PROJECT_ID \
  --format="json" 2>/dev/null | jq -r '.spec.template.spec.containers[0].env[]? | "   \(.name)=\(.value // "[secret]")"' || {
  echo "   (환경 변수 없음 또는 조회 실패)"
}
echo ""

# 시크릿 매핑 확인
echo "🔐 시크릿 매핑:"
SECRETS=$(gcloud run services describe "$OTHER_SERVICE" \
  --region="$OTHER_REGION" \
  --project=$PROJECT_ID \
  --format="json" 2>/dev/null | jq -r '.spec.template.spec.containers[0].env[]? | select(.valueFrom.secretKeyRef) | "   \(.name)=\(.valueFrom.secretKeyRef.name):\(.valueFrom.secretKeyRef.key)"')

if [ -z "$SECRETS" ]; then
  echo "   시크릿 매핑이 없습니다."
  echo ""
  echo "이 서비스는 환경 변수를 직접 설정했을 수 있습니다."
else
  echo "$SECRETS"
  echo ""
  echo "=============================================="
  echo "📝 새 서비스에 적용할 명령어 템플릿"
  echo "=============================================="
  echo ""

  # 시크릿 매핑 문자열 생성
  SECRET_MAPPING=$(echo "$SECRETS" | sed 's/^   //' | paste -sd ',' -)

  echo "gcloud run services update YOUR_NEW_SERVICE \\"
  echo "  --region=YOUR_REGION \\"
  echo "  --project=$PROJECT_ID \\"
  echo "  --set-env-vars NODE_ENV=production \\"
  echo "  --set-secrets '$SECRET_MAPPING' \\"
  echo "  --timeout 300 \\"
  echo "  --memory 1Gi \\"
  echo "  --cpu 1 \\"
  echo "  --port 8080"
fi

echo ""
echo "🌐 웹 콘솔에서 확인:"
echo "   https://console.cloud.google.com/run/detail/$OTHER_REGION/$OTHER_SERVICE?project=$PROJECT_ID"
