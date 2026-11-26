/*!
 * Agent API embed script. Opens a play link in an iframe modal and reports completion.
 *   <script src="/api/v1/agent/sdk/embed.js"></script>
 *   AgentRoleplay.open({ playUrl, sessionId?, onReady, onComplete, onClose }) -> { close() }
 * Only messages from the play URL's origin, from that iframe, with source "avatar-router"
 * and the expected sessionId are accepted.
 */
(function (global) {
  "use strict";
  function open(opts) {
    if (!opts || !opts.playUrl) throw new Error("playUrl is required");
    var origin = new URL(opts.playUrl, location.href).origin;
    var expectedSession = opts.sessionId || null;
    var closed = false;

    var overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483000;display:flex;align-items:center;justify-content:center";
    var box = document.createElement("div");
    box.style.cssText = "position:relative;width:min(480px,96vw);height:min(720px,92vh);background:#fff;border-radius:12px;overflow:hidden";
    var frame = document.createElement("iframe");
    frame.src = opts.playUrl;
    frame.allow = "microphone; autoplay";
    frame.style.cssText = "width:100%;height:100%;border:0";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "\u00d7";
    btn.setAttribute("aria-label", "Close");
    btn.style.cssText = "position:absolute;top:6px;right:8px;z-index:1;border:0;background:rgba(255,255,255,.9);border-radius:50%;width:28px;height:28px;font-size:18px;cursor:pointer";
    box.appendChild(frame); box.appendChild(btn); overlay.appendChild(box);
    document.body.appendChild(overlay);

    function onMessage(e) {
      if (e.origin !== origin || e.source !== frame.contentWindow) return;
      var d = e.data;
      if (!d || d.source !== "avatar-router") return;
      if (expectedSession && d.sessionId && d.sessionId !== expectedSession) return;
      if (d.type === "session.ready" && opts.onReady) opts.onReady(d);
      else if (d.type === "session.completed") { if (opts.onComplete) opts.onComplete(d); }
    }
    function close() {
      if (closed) return; closed = true;
      global.removeEventListener("message", onMessage);
      overlay.remove();
      if (opts.onClose) opts.onClose();
    }
    global.addEventListener("message", onMessage);
    btn.addEventListener("click", close);
    return { close: close };
  }
  global.AgentRoleplay = { open: open };
})(window);
