# ===========================================
# Google Cloud Run용 Docker 이미지
# Node.js 20 + Alpine Linux (경량 이미지)
# ===========================================

# ----- 빌드 스테이지 -----
FROM node:20-alpine AS builder

WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm ci

# 소스 코드 복사
COPY . .

# 애플리케이션 빌드 (Vite 프론트엔드 + TypeScript 백엔드)
RUN npm run build

# ----- 프로덕션 스테이지 -----
FROM node:20-alpine AS production

WORKDIR /app

# 보안: 비-root 사용자 생성
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 패키지 파일 복사 및 프로덕션 의존성만 설치
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# 빌드된 애플리케이션 복사
COPY --from=builder /app/dist ./dist

# 정적 파일 및 데이터 복사 (존재하는 경우만)
COPY --from=builder /app/public ./public

# personas 폴더 복사 (존재하는 경우)
COPY --from=builder /app/personas ./personas

# scenarios 폴더 복사 (존재하는 경우)
COPY --from=builder /app/scenarios ./scenarios

# 페르소나 표정 이미지 복사 (존재하는 경우)
COPY --from=builder /app/attached_assets ./attached_assets

# 파일 소유권 변경
RUN chown -R nodejs:nodejs /app

# 비-root 사용자로 전환
USER nodejs

# 환경 변수 설정
ENV NODE_ENV=production
ENV PORT=8080

# 포트 노출
EXPOSE 8080

# 헬스체크 (Cloud Run 기본 헬스체크 사용)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/health || exit 1

# 애플리케이션 시작
CMD ["node", "dist/index.js"]
