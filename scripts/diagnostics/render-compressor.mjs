import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import WebSocket from 'ws';
const signals = readFileSync('docs/diagnostics/results/pcm-agc.json', 'utf8');
const html = readFileSync('scripts/diagnostics/compressor-probe.html', 'utf8')
  .replace('__SYNTHETIC_PCM__', signals);
const path = 'docs/diagnostics/results/compressor-probe.html';
writeFileSync(path, html);
const child = spawn('chromium', [
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-background-networking',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/roleplay-offline-audio-probe',
  `file://${resolve(path)}`,
], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
const timeout = setTimeout(() => child.kill(), 60_000);
try {
  const port = await new Promise((resolvePort, reject) => {
    let text = '';
    child.on('error', reject);
    child.on('exit', () => reject(new Error('Chromium exited before diagnostics were ready')));
    child.stderr.on('data', chunk => {
      text += chunk.toString();
      const match = text.match(/DevTools listening on ws:\/\/127.0.0.1:(\d+)/);
      if (match) resolvePort(Number(match[1]));
    });
  });
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find(p => p.type === 'page' && p.url.startsWith('file:'));
  if (!page) throw new Error('Offline probe page not found');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
  const reply = new Promise((done, reject) => {
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.id === 1) {
        if (message.error || message.result?.exceptionDetails) reject(new Error('WebAudio evaluation failed'));
        else done(message.result.result.value);
      }
    });
    socket.once('close', () => reject(new Error('Diagnostic browser disconnected')));
  });
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
    awaitPromise: true, returnByValue: true,
    expression: `(async () => {
      const deadline=Date.now()+30000;
      while (!document.body.dataset.complete && Date.now()<deadline) await new Promise(r=>setTimeout(r,50));
      if(document.body.dataset.complete!=='true') throw new Error('WebAudio incomplete');
      return document.getElementById('result').textContent;
    })()`,
  } }));
  const output = JSON.parse(await reply);
  writeFileSync('docs/diagnostics/results/pcm-compressor.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
} finally {
  clearTimeout(timeout);
  socket?.close();
  child.kill();
}