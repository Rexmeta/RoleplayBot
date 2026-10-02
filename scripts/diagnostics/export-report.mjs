// Minimal escaped Markdown-to-HTML exporter for the incident's text/tables.
// No charts, external resources, network, login, or live data query.
import { readFileSync, writeFileSync } from 'node:fs';
const path = 'docs/diagnostics/concurrent-roleplay-incident.ko';
const source = readFileSync(`${path}.md`, 'utf8');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = text => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
let body = '', code = false, table = false, list = false;
function closeBlocks() {
  if (table) { body += '</tbody></table></div>'; table = false; }
  if (list) { body += '</ul>'; list = false; }
}
for (const line of source.split('\n')) {
  if (line.startsWith('```')) {
    closeBlocks();
    body += code ? '</code></pre>' : '<pre><code>';
    code = !code;
  } else if (code) body += `${escape(line)}\n`;
  else if (/^\|/.test(line)) {
    if (/^\|[\s:|-]+\|$/.test(line)) continue;
    const cells = line.slice(1, -1).split('|').map(c => inline(c.trim()));
    if (!table) {
      if (list) { body += '</ul>'; list = false; }
      body += `<div class="table"><table><thead><tr>${cells.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
      table = true;
    } else body += `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
  } else {
    if (table) { body += '</tbody></table></div>'; table = false; }
    const heading = line.match(/^(#{1,4}) (.+)$/);
    if (heading) {
      closeBlocks();
      const n = heading[1].length;
      body += `<h${n}>${inline(heading[2])}</h${n}>`;
    } else if (/^(- |\d+\. )/.test(line)) {
      if (!list) { body += '<ul>'; list = true; }
      body += `<li>${inline(line.replace(/^(- |\d+\. )/, ''))}</li>`;
    } else {
      if (list) { body += '</ul>'; list = false; }
      if (line.trim()) body += `<p>${inline(line)}</p>`;
    }
  }
}
closeBlocks();
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>동시 롤플레이 장애 원인 검증</title>
<style>
:root{color-scheme:light}body{font:15px/1.8 system-ui,"Noto Sans KR",sans-serif;color:#162438;background:#f4f6fa;margin:0}
main{max-width:1140px;margin:auto;background:white;padding:40px 48px}h1{font-size:30px;line-height:1.4;margin-top:0}
h2{font-size:23px;border-top:2px solid #dce5f2;padding-top:22px;margin-top:40px}h3{font-size:18px;color:#245581}
p,li{overflow-wrap:anywhere}strong{color:#173e69}code{font-size:12px;background:#f1f4f8;padding:2px 4px;border-radius:3px}
pre{background:#f1f4f8;padding:18px;overflow-x:auto;white-space:pre-wrap}pre code{background:none;padding:0}
.table{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px;margin:18px 0}
th,td{border:1px solid #dae2ed;padding:10px;vertical-align:top;text-align:left;min-width:105px}th{background:#edf3fa}
header{font-size:12px;color:#516077;margin-bottom:20px}
@media(max-width:640px){main{padding:24px 16px}h1{font-size:24px}}@media print{body{background:white}main{padding:0;max-width:none}h2{break-after:avoid}tr{break-inside:avoid}table{font-size:10px}}
</style></head><body><main><header>비운영 분석 보고서 · 2026-10-02 · 운영 변경 없음 · 실 공급자 수용량/실기기 체감 음량 미검증</header>${body}</main></body></html>`;
if (Buffer.byteLength(html, 'utf8') > 5_242_880) throw new Error('Report exceeds asset size budget');
writeFileSync(`${path}.html`, html);
console.log(`${path}.html: ${Buffer.byteLength(html, 'utf8')} bytes`);