import { Link } from "wouter";

export default function Header() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="container mx-auto px-4 py-3">
        <Link href="/" className="flex items-center space-x-3 hover:opacity-80 transition-opacity w-fit" data-testid="header-home-link">
          <div className="w-10 h-10 bg-corporate-600 rounded-lg flex items-center justify-center">
            <i className="fas fa-robot text-white text-lg"></i>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">AI 롤플레잉 훈련</h1>
            <p className="text-sm text-slate-600">신입사원 역량 개발 시스템</p>
          </div>
        </Link>
      </div>
    </header>
  );
}