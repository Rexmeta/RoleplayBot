import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function PrivacyPolicy() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Button
          variant="ghost"
          className="text-white/80 hover:text-white mb-6"
          onClick={() => setLocation("/home")}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          돌아가기
        </Button>

        <ScrollArea className="h-[calc(100vh-120px)]">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 text-white/90">
            <h1 className="text-3xl font-bold mb-8 text-center">개인정보처리방침</h1>
            
            <p className="mb-6 text-white/70">
              본 개인정보처리방침은 AI 역할극 커뮤니케이션 훈련 시스템(이하 "서비스")의 개인정보 수집, 이용, 관리 및 보호에 관한 사항을 규정합니다.
            </p>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-purple-300">제1조 (수집하는 개인정보 항목)</h2>
              <p className="mb-3">서비스는 다음과 같은 개인정보를 수집합니다:</p>
              <ul className="list-disc list-inside space-y-2 text-white/80 ml-4">
                <li><strong>필수 수집 항목:</strong> 이름, 이메일 주소, 비밀번호(암호화 저장)</li>
                <li><strong>선택 수집 항목:</strong> 프로필 이미지</li>
                <li><strong>서비스 이용 과정에서 생성되는 정보:</strong>
                  <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                    <li>AI 캐릭터와의 대화 내용 및 음성 데이터</li>
                    <li>훈련 점수 및 AI 피드백 결과</li>
                    <li>서비스 이용 기록, 접속 로그</li>
                  </ul>
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-purple-300">제2조 (개인정보의 수집 및 이용 목적)</h2>
              <p className="mb-3">수집한 개인정보는 다음 목적으로 이용됩니다:</p>
              <ul className="list-disc list-inside space-y-2 text-white/80 ml-4">
                <li>회원 가입 및 관리, 본인 확인</li>
                <li>AI 기반 역할극 훈련 서비스 제공</li>
                <li>개인화된 AI 피드백 및 성과 분석 제공</li>
                <li>서비스 개선 및 신규 기능 개발</li>
                <li>고객 문의 대응 및 공지사항 전달</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-purple-300">제3조 (개인정보의 보유 및 이용 기간)</h2>
              <ul className="list-disc list-inside space-y-2 text-white/80 ml-4">
                <li><strong>회원 정보:</strong> 회원 탈퇴 시까지 (탈퇴 후 즉시 파기)</li>
                <li><strong>대화 기록 및 훈련 데이터:</strong> 서비스 이용 종료 후 1년간 보관 후 파기</li>
                <li><strong>접속 로그:</strong> 3개월간 보관 후 파기</li>
              </ul>
              <p className="mt-3 text-white/70">
                단, 관계 법령에 따라 보존할 필요가 있는 경우 해당 기간 동안 보관합니다.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-purple-300">제4조 (개인정보의 제3자 제공)</h2>
              <p className="mb-3">서비스는 원칙적으로 이용자의 동의 없이 개인정보를 제3자에게 제공하지 않습니다. 다만, 다음의 경우 예외로 합니다:</p>
              <ul className="list-disc list-inside space-y-2 text-white/80 ml-4">
                <li>이용자가 사전에 동의한 경우</li>
                <li>법령의 규정에 따르거나 수사 목적으로 법령에 정해진 절차에 따라 요청이 있는 경우</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-purple-300">제5조 (개인정보 처리 위탁)</h2>
              <p className="mb-3">서비스는 AI 기능 제공을 위해 다음과 같이 개인정보 처리를 위탁합니다:</p>
              <div className="bg-white/5 rounded-lg p-4 mt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/20">
                      <th className="text-left py-2 text-purple-300">수탁업체</th>
                      <th className="text-left py-2 text-purple-300">위탁 업무</th>
                    </tr>
                  </thead>
                  <tbody className="text-white/80">
                    <tr className="border-b border-white/10">
                      <td className="py-2">Google LLC (Gemini API)</td>
                      <td className="py-2">AI 대화 생성, 피드백 분석, 실시간 음성 처리</td>
                    </tr>
                    <tr className="border-b border-white/10">
                      <td className="py-2">ElevenLabs Inc.</td>
                      <td className="py-2">텍스트-음성 변환 (TTS) 서비스</td>
                    </tr>
                    <tr>
                      <td className="py-2">Neon Inc.</td>
                      <td className="py-2">데이터베이스 호스팅</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-purple-300">제6조 (이용자의 권리와 행사 방법)</h2>
              <p className="mb-3">이용자는 다음과 같은 권리를 행사할 수 있습니다:</p>
              <ul className="list-disc list-inside space-y-2 text-white/80 ml-4">
                <li>개인정보 열람, 정정, 삭제 요청</li>
                <li>개인정보 처리 정지 요청</li>
                <li>회원 탈퇴 및 개인정보 파기 요청</li>
              </ul>
              <p className="mt-3 text-white/70">
                위 권리는 서비스 내 설정 메뉴 또는 개인정보 보호책임자에게 연락하여 행사할 수 있습니다.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-purple-300">제7조 (개인정보의 안전성 확보 조치)</h2>
              <p className="mb-3">서비스는 개인정보 보호를 위해 다음과 같은 조치를 취하고 있습니다:</p>
              <ul className="list-disc list-inside space-y-2 text-white/80 ml-4">
                <li>비밀번호 암호화 저장 (bcrypt 해시)</li>
                <li>SSL/TLS 암호화 통신</li>
                <li>접근 권한 관리 및 제한</li>
                <li>정기적인 보안 점검</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-purple-300">제8조 (개인정보 보호책임자)</h2>
              <div className="bg-white/5 rounded-lg p-4">
                <p className="text-white/80">
                  개인정보 관련 문의사항은 아래 연락처로 문의해 주시기 바랍니다.
                </p>
                <ul className="mt-3 space-y-1 text-white/70">
                  <li>담당부서: 개인정보보호팀</li>
                  <li>이메일: privacy@mothle.com</li>
                </ul>
              </div>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4 text-purple-300">제9조 (개인정보처리방침의 변경)</h2>
              <p className="text-white/80">
                본 개인정보처리방침은 법령, 정책 또는 서비스 변경에 따라 변경될 수 있으며, 
                변경 시 서비스 내 공지사항을 통해 고지합니다.
              </p>
            </section>

            <div className="border-t border-white/20 pt-6 mt-8">
              <p className="text-white/60 text-sm text-center">
                본 개인정보처리방침은 2024년 1월 1일부터 시행됩니다.
              </p>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
