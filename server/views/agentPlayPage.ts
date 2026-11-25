/** Server-rendered hosted play screen for the Agent API (no framework, no external assets). */

const STRINGS = {
  ko: { title: "롤플레이", send: "보내기", end: "대화 종료", placeholder: "메시지를 입력하세요", loading: "연결 중...", ended: "대화가 종료되었습니다. 결과를 정리하는 중입니다.", you: "나", failed: "처리하지 못했습니다. 다시 시도해 주세요.", invalid: "이 링크는 만료되었거나 이미 사용되었습니다." },
  en: { title: "Role-play", send: "Send", end: "End conversation", placeholder: "Type your message", loading: "Connecting...", ended: "The conversation has ended. Preparing your results.", you: "You", failed: "Something went wrong. Please try again.", invalid: "This link has expired or was already used." },
} as const;

export function renderPlayErrorPage(nonce: string, language = "ko"): string {
  const t = STRINGS[language as keyof typeof STRINGS] ?? STRINGS.en;
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.title}</title>
<style nonce="${nonce}">body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#444}</style></head>
<body><p>${t.invalid}</p></body></html>`;
}

export function renderPlayPage(nonce: string, language = "ko"): string {
  const t = STRINGS[language as keyof typeof STRINGS] ?? STRINGS.en;
  const strings = JSON.stringify(t).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.title}</title>
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;color:#1c1f24;height:100vh;display:flex;flex-direction:column}
header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#fff;border-bottom:1px solid #e3e6ea}
#who{font-weight:600}#log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px}
.m{max-width:80%;padding:8px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word;line-height:1.45}
.ai{background:#fff;border:1px solid #e3e6ea;align-self:flex-start}.user{background:#2f6fed;color:#fff;align-self:flex-end}.sys{align-self:center;color:#666;font-size:.9em}
form{display:flex;gap:8px;padding:10px;background:#fff;border-top:1px solid #e3e6ea}textarea{flex:1;resize:none;border:1px solid #cfd4da;border-radius:8px;padding:8px;font:inherit}
button{border:0;border-radius:8px;padding:8px 14px;font:inherit;cursor:pointer;background:#2f6fed;color:#fff}button.sec{background:#e9ecf0;color:#1c1f24}button:disabled{opacity:.5;cursor:default}
</style></head>
<body>
<header><span id="who"></span><button id="end" class="sec" type="button" disabled>${t.end}</button></header>
<div id="log"><div class="m sys" id="status">${t.loading}</div></div>
<form id="form"><textarea id="input" rows="2" maxlength="4000" placeholder="${t.placeholder}" disabled></textarea><button id="send" type="submit" disabled>${t.send}</button></form>
<script nonce="${nonce}">
(function(){
var S=${strings};
var API="/api/v1/agent/play";
var token=decodeURIComponent(location.pathname.split("/").filter(Boolean).pop()||"");
var log=document.getElementById("log"),input=document.getElementById("input"),send=document.getElementById("send"),endBtn=document.getElementById("end"),who=document.getElementById("who"),statusEl=document.getElementById("status");
var access=null,info=null,busy=false,done=false;
function add(cls,text){var d=document.createElement("div");d.className="m "+cls;d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight;return d}
function setBusy(b){busy=b;var off=b||done;input.disabled=off;send.disabled=off;endBtn.disabled=off||!access}
function parentOrigin(){
  var allowed=(info&&info.allowedOrigins)||[];var cand=null;
  try{if(location.ancestorOrigins&&location.ancestorOrigins.length)cand=location.ancestorOrigins[0]}catch(e){}
  if(!cand&&document.referrer){try{cand=new URL(document.referrer).origin}catch(e){}}
  if(cand&&allowed.indexOf(cand)>=0)return cand;
  if(allowed.length===1)return allowed[0];
  return null;
}
function notifyParent(type,extra){
  if(window.parent===window)return;
  var o=parentOrigin();if(!o)return;
  var msg={source:"avatar-router",type:type,sessionId:info&&info.sessionId,externalSessionId:(info&&info.externalSessionId)||null};
  for(var k in extra)msg[k]=extra[k];
  window.parent.postMessage(msg,o);
}
function call(path,body){
  return fetch(API+path,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+(access||"")},body:JSON.stringify(body||{})})
    .then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j})});
}
fetch(API+"/redeem",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:token})})
 .then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j})})
 .then(function(j){access=j.accessToken;info=j;who.textContent=j.personaName||"";statusEl.remove();setBusy(false);input.focus();notifyParent("session.ready",{})})
 .catch(function(){statusEl.textContent=S.invalid});
document.getElementById("form").addEventListener("submit",function(e){
  e.preventDefault();var text=input.value.trim();if(!text||busy||done)return;
  input.value="";add("user",text);setBusy(true);
  call("/messages",{message:text}).then(function(j){add("ai",j.reply&&j.reply.text||"")})
   .catch(function(){add("sys",S.failed)}).then(function(){setBusy(false);input.focus()});
});
endBtn.addEventListener("click",function(){
  if(busy||done)return;setBusy(true);
  call("/end",{}).then(function(j){done=true;add("sys",S.ended);setBusy(true);
    notifyParent("session.completed",{feedbackStatus:j.feedbackStatus||null,endedAt:j.endedAt||null})})
   .catch(function(){add("sys",S.failed);setBusy(false)});
});
})();
</script></body></html>`;
}
