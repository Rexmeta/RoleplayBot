#!/bin/bash

# 다른 Cloud Run 서비스의 시크릿 설정을 확인하는 스크립트
# 기존 서비스의 시크릿 이름을 파악하여 mothle에 적용합니다.

set -e

PROJECT_ID="${PROJECT_ID:-roleplay-469506}"

echo "🔍 프로젝트의 모든 Cloud Run 서비스 확인"
echo "========================================"
echo ""

# 모든 리전의 Cloud Run 서비스 나열
echo "📋 서비스 목록:"
gcloud run services list --project=$PROJECT_ID --format="table(SERVICE,REGION,URL)" 2>/dev/null || {
  echo "⚠️  gcloud 명령어 실행 실패"
  echo "웹 콘솔에서 확인하세요: https://console.cloud.google.com/run?project=$PROJECT_ID"
  exit 1
}
echo ""

# 사용자에게 서비스 이름과 리전 입력받기
echo "기존 배포된 서비스의 이름과 리전을 입력하세요:"
read -p "서비스 이름: " OTHER_SERVICE
read -p "리전 (예: asia-northeast3): " OTHER_REGION

if [ -z "$OTHER_SERVICE" ] || [ -z "$OTHER_REGION" ]; then
  echo "⚠️  서비스 이름과 리전을 모두 입력해야 합니다."
  exit 1
fi

echo ""
echo "🔍 $OTHER_SERVICE ($OTHER_REGION) 서비스의 설정 확인 중..."
echo "========================================"
echo ""

# 환경 변수 확인
echo "📦 환경 변수 (env):"
gcloud run services describe "$OTHER_SERVICE" \
  --region="$OTHER_REGION" \
  --project=$PROJECT_ID \
  --format="json" | jq -r '.spec.template.spec.containers[0].env[]? | "   \(.name)=\(.value // "[secret]")"' 2>/dev/null || {
  echo "   (환경 변수 없음)"
}
echo ""

# 시크릿 매핑 확인
echo "🔐 시크릿 매핑:"
SECRETS=$(gcloud run services describe "$OTHER_SERVICE" \
  --region="$OTHER_REGION" \
  --project=$PROJECT_ID \
  --format="json" | jq -r '.spec.template.spec.containers[0].env[]? | select(.valueFrom.secretKeyRef) | "   \(.name)=\(.valueFrom.secretKeyRef.name):\(.valueFrom.secretKeyRef.key)"' 2>/dev/null)

if [ -z "$SECRETS" ]; then
  echo "   ⚠️  시크릿 매핑이 없습니다."
  echo ""
  echo "이 서비스는 환경 변수를 직접 설정했을 수 있습니다."
  echo "Secret Manager를 사용하지 않는 경우, mothle 서비스에도 동일한 환경 변수를 설정하세요:"
  echo ""
  echo "gcloud run services update mothle \\"
  echo "  --region=europe-west1 \\"
  echo "  --project=$PROJECT_ID \\"
  echo "  --set-env-vars JWT_SECRET=value1,DATABASE_URL=value2,GOOGLE_API_KEY=value3"
else
  echo "$SECRETS"
  echo ""
  echo "✅ mothle 서비스에 적용할 명령어:"
  echo "========================================"
  echo ""

  # 시크릿 매핑 문자열 생성
  SECRET_MAPPING=$(echo "$SECRETS" | sed 's/^   //' | paste -sd ',' -)

  echo "gcloud run services update mothle \\"
  echo "  --region=europe-west1 \\"
  echo "  --project=$PROJECT_ID \\"
  echo "  --set-env-vars NODE_ENV=production \\"
  echo "  --set-secrets '$SECRET_MAPPING' \\"
  echo "  --timeout 300 \\"
  echo "  --memory 1Gi \\"
  echo "  --cpu 1 \\"
  echo "  --port 8080"
  echo ""

  read -p "이 명령어를 지금 실행하시겠습니까? (y/N): " response

  if [[ "$response" =~ ^[Yy]$ ]]; then
    echo ""
    echo "🚀 mothle 서비스 업데이트 중..."
    gcloud run services update mothle \
      --region=europe-west1 \
      --project=$PROJECT_ID \
      --set-env-vars NODE_ENV=production \
      --set-secrets "$SECRET_MAPPING" \
      --timeout 300 \
      --memory 1Gi \
      --cpu 1 \
      --port 8080 \
      --allow-unauthenticated

    echo ""
    echo "✅ 완료! 다음 배포 시 컨테이너가 정상적으로 시작됩니다."
  fi
fi

echo ""
echo "🌐 웹 콘솔에서 확인:"
echo "   https://console.cloud.google.com/run/detail/$OTHER_REGION/$OTHER_SERVICE?project=$PROJECT_ID"
