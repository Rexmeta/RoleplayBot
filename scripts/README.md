# 배포 스크립트 가이드

이 폴더에는 Google Cloud Run 배포를 위한 스크립트들이 포함되어 있습니다.

## 스크립트 목록

### 1. `deploy-build.sh` - 배포 빌드 스크립트
Replit 배포 시 자동으로 실행되는 빌드 스크립트입니다.

**기능:**
- 데이터베이스 스키마 마이그레이션 (drizzle-kit push)
- 애플리케이션 빌드 (npm run build)

**Replit 배포 설정:**
Build Command를 다음으로 설정하세요:
```
sh scripts/deploy-build.sh
```

---

### 2. `setup-cloud-run-env.sh` - 초기 환경 설정 스크립트
새 프로젝트를 처음 배포할 때 사용합니다.

**기능:**
- Secret Manager에 필수 시크릿 생성 (JWT_SECRET, DATABASE_URL, GOOGLE_API_KEY)
- Cloud Run 서비스에 시크릿 연결

**사용법:**
```bash
# 대화형 실행
./scripts/setup-cloud-run-env.sh

# 또는 환경변수 지정
PROJECT_ID=my-project SERVICE_NAME=my-service REGION=asia-northeast3 ./scripts/setup-cloud-run-env.sh
```

---

### 3. `connect-existing-secrets.sh` - 기존 시크릿 연결 스크립트
이미 Secret Manager에 시크릿이 있을 때 Cloud Run 서비스에 연결합니다.

**사용법:**
```bash
./scripts/connect-existing-secrets.sh
```

---

### 4. `check-other-service-secrets.sh` - 다른 서비스 시크릿 확인 스크립트
기존 Cloud Run 서비스의 시크릿 설정을 확인합니다.

**사용법:**
```bash
./scripts/check-other-service-secrets.sh
```

---

## 필수 시크릿 목록

| 환경변수 | Secret Manager 이름 | 설명 |
|---------|-------------------|------|
| JWT_SECRET | jwt-secret | JWT 토큰 서명 키 |
| DATABASE_URL | database-url | PostgreSQL 연결 문자열 |
| GOOGLE_API_KEY | google-api-key | Gemini API 키 |

---

## 첫 배포 순서

1. **gcloud 인증**
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

2. **시크릿 설정**
   ```bash
   ./scripts/setup-cloud-run-env.sh
   ```

3. **Replit에서 배포**
   - Build Command: `sh scripts/deploy-build.sh`
   - Run Command: `npm run start`

4. **배포 확인**
   ```bash
   gcloud run services describe YOUR_SERVICE --region=YOUR_REGION
   ```
