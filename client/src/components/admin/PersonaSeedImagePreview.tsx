import { useState } from "react";
import { Button } from "@/components/ui/button";

export function PersonaSeedImagePreview({ url, registered, version }: {
  url: string; registered: boolean; version?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <figure className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="preview-seed-image">
    <figcaption className="mb-2 text-xs font-semibold text-slate-800">
      {registered ? `라우터에 전달한 시드 이미지 · v${version}` : "등록 전 기본 이미지"}
    </figcaption>
    {failed ? <div className="space-y-2 text-xs text-red-700">
      <p role="alert">시드 이미지를 불러오지 못했습니다. 다른 이미지로 대체 표시하지 않습니다.</p>
      <Button type="button" size="sm" variant="outline" onClick={() => { setFailed(false); setAttempt(n => n + 1); }}>이미지 다시 불러오기</Button>
    </div> : <img
      src={attempt ? `${url}${url.includes("?") ? "&" : "?"}previewRefresh=${attempt}` : url}
      alt={registered ? "아바타 라우터에 전달한 시드 이미지" : "등록할 페르소나 기본 이미지"}
      className="max-h-64 max-w-full rounded border border-slate-200 bg-white object-contain"
      onError={() => setFailed(true)}
    />}
    <p className="mt-2 text-xs text-slate-600">{registered
      ? "라우터에 등록된 해당 버전의 원본 이미지입니다. 학습용 보정 결과와는 다를 수 있습니다."
      : "아직 라우터에 등록하지 않은 기본 이미지입니다."}</p>
  </figure>;
}
