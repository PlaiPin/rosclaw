import type { RosClawConfig } from "../config.js";

/**
 * Returns the teleop web page HTML (Phase 3).
 * Includes: camera <img>, source selector when multiple streams, twist buttons, speed slider.
 */
export function getTeleopPageHtml(config: RosClawConfig): string {
  const teleop = config.teleop ?? {};
  const speedDefault = teleop.speedDefault ?? 0.3;
  const cameraPollMs = teleop.cameraPollMs ?? 150;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RosClaw Teleop</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 12px; background: #1a1a1a; color: #e0e0e0; }
    h1 { font-size: 1.25rem; margin: 0 0 12px 0; }
    .camera-wrap { position: relative; max-width: 100%; margin-bottom: 12px; }
    .camera-wrap img { width: 100%; max-height: 60vh; object-fit: contain; background: #000; border-radius: 8px; }
    .camera-wrap .no-feed { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #333; border-radius: 8px; color: #888; }
    .controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }
    .source-select { min-width: 200px; padding: 6px 10px; border-radius: 6px; background: #333; color: #e0e0e0; border: 1px solid #555; }
    .speed-wrap { display: flex; align-items: center; gap: 8px; }
    .speed-wrap label { font-size: 0.9rem; }
    .speed-wrap input[type="range"] { width: 100px; }
    .btn-wrap { display: flex; flex-direction: column; gap: 4px; align-items: center; }
    .btn-row { display: flex; gap: 8px; justify-content: center; }
    button { padding: 12px 20px; font-size: 1rem; border-radius: 8px; border: none; cursor: pointer; color: #fff; }
    button:not(.stop) { background: #086; }
    button:not(.stop):active, button:not(.stop).active { background: #0c9; }
    button.stop { background: #822; }
    button.stop:active { background: #c33; }
    .status { font-size: 0.85rem; color: #888; margin-top: 8px; }
    a { color: #0c9; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>RosClaw Teleop</h1>
  <p><a href="/rosclaw/">Back to RosClaw</a></p>
  <div class="camera-wrap">
    <img id="camera" src="" alt="Camera" style="display:none" />
    <div id="no-feed" class="no-feed">Select a camera source (or waiting for feed)</div>
  </div>
  <div class="controls">
    <div class="speed-wrap">
      <label for="speed">Speed:</label>
      <input type="range" id="speed" min="0.1" max="1" step="0.1" value="${speedDefault}" />
      <span id="speed-val">${speedDefault}</span>
    </div>
    <select id="source" class="source-select" style="display:none">
      <option value="">—</option>
    </select>
  </div>
  <div class="btn-wrap">
    <div class="btn-row"><button type="button" id="btn-fwd" data-linear-x="1">Fwd</button></div>
    <div class="btn-row">
      <button type="button" id="btn-left" data-angular-z="1">Left</button>
      <button type="button" id="btn-stop" class="stop">Stop</button>
      <button type="button" id="btn-right" data-angular-z="-1">Right</button>
    </div>
    <div class="btn-row"><button type="button" id="btn-back" data-linear-x="-1">Back</button></div>
  </div>
  <div id="status" class="status"></div>

  <script>
(function() {
  const POLL_MS = ${cameraPollMs};
  const SPEED_DEFAULT = ${speedDefault};
  const cameraEl = document.getElementById('camera');
  const noFeedEl = document.getElementById('no-feed');
  const sourceEl = document.getElementById('source');
  const speedEl = document.getElementById('speed');
  const speedVal = document.getElementById('speed-val');
  const statusEl = document.getElementById('status');

  let selectedTopic = '';
  let pollTimer = null;

  function setStatus(msg) { statusEl.textContent = msg; }
  function getSpeed() { return parseFloat(speedEl?.value || SPEED_DEFAULT); }
  speedEl?.addEventListener('input', function() { speedVal.textContent = this.value; });

  function cameraUrl() {
    if (!selectedTopic) return '';
    const u = '/rosclaw/teleop/camera?topic=' + encodeURIComponent(selectedTopic) + '&type=compressed&t=' + Date.now();
    return u;
  }

  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    if (!selectedTopic) { noFeedEl.style.display = 'flex'; cameraEl.style.display = 'none'; return; }
    noFeedEl.style.display = 'none';
    cameraEl.style.display = 'block';
    cameraEl.onerror = function() { setStatus('Camera failed (use a CompressedImage topic, e.g. .../image_raw/compressed)'); };
    cameraEl.src = cameraUrl();
    pollTimer = setInterval(function() { cameraEl.src = cameraUrl(); }, POLL_MS);
  }

  function loadSources() {
    fetch('/rosclaw/teleop/sources')
      .then(function(r) { return r.json(); })
      .then(function(arr) {
        if (!Array.isArray(arr) || arr.length === 0) {
          setStatus('No camera sources found. Publish to an Image/CompressedImage topic.');
          return;
        }
        sourceEl.innerHTML = '';
        arr.forEach(function(o) {
          const opt = document.createElement('option');
          opt.value = o.topic;
          opt.textContent = o.label || o.topic;
          sourceEl.appendChild(opt);
        });
        sourceEl.style.display = arr.length > 1 ? 'block' : 'none';
        if (arr.length === 1) selectedTopic = arr[0].topic;
        else if (arr.length > 1) selectedTopic = arr[0].topic;
        startPoll();
      })
      .catch(function(e) { setStatus('Failed to load sources: ' + e.message); });
  }

  sourceEl.addEventListener('change', function() {
    selectedTopic = this.value || '';
    startPoll();
  });

  function sendTwist(linearX, linearY, linearZ, angularX, angularY, angularZ) {
    const s = getSpeed();
    const body = {
      linear_x: (linearX ?? 0) * s,
      linear_y: (linearY ?? 0) * s,
      linear_z: linearZ ?? 0,
      angular_x: angularX ?? 0,
      angular_y: angularY ?? 0,
      angular_z: (angularZ ?? 0) * s
    };
    fetch('/rosclaw/teleop/twist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(function(e) { setStatus('Twist error: ' + e.message); });
  }

  function stop() {
    sendTwist(0,0,0,0,0,0);
    document.querySelectorAll('.btn-wrap button:not(.stop)').forEach(function(b) { b.classList.remove('active'); });
  }

  ['btn-fwd','btn-back','btn-left','btn-right'].forEach(function(id) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('pointerdown', function() {
      btn.classList.add('active');
      const lx = parseFloat(btn.dataset.linearX);
      const az = parseFloat(btn.dataset.angularZ);
      sendTwist(lx || 0, 0, 0, 0, 0, az || 0);
    });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
  });
  document.getElementById('btn-stop')?.addEventListener('click', function() { stop(); });

  loadSources();
})();
  </script>
</body>
</html>`;
}
