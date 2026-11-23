// Escáner de códigos de barras y QR (cámara móvil + lectores USB/Bluetooth)
const SCAN_ICO = '<svg class="ic" viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><path d="M7 8v8M10 8v8M14 8v8M17 8v8"/></svg>';

const SCAN_STATE = {
  seq: 0,
  stream: null,
  timer: null,
  qr: null,
  torch: false,
  devices: [],
  devIdx: 0,
  lastCode: '',
  lastAt: 0,
  continuous: false,
  opts: null,
  audioCtx: null,
  libPromise: null,
  escHandler: null
};

function normalizeBarcode(code) {
  return String(code ?? '').trim().toLowerCase();
}

function findBySku(list, code) {
  const c = normalizeBarcode(code);
  if (!c) return null;
  const alts = new Set([c]);
  // Compatibilidad EAN-13 <-> UPC-A (cero inicial)
  if (/^\d{13}$/.test(c) && c.startsWith('0')) alts.add(c.slice(1));
  if (/^\d{12}$/.test(c)) alts.add('0' + c);
  return (list || []).find(p => {
    const s = normalizeBarcode(p.sku);
    return s && alts.has(s);
  }) || null;
}

function scanBeep(ok = true) {
  try {
    if (navigator.vibrate) navigator.vibrate(ok ? 65 : [75, 55, 75]);
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!SCAN_STATE.audioCtx) SCAN_STATE.audioCtx = new Ctx();
    const ctx = SCAN_STATE.audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const playTone = (freq, start, dur, vol) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = ok ? 'sine' : 'square';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(vol, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    if (ok) {
      playTone(1250, 0, 0.09, 0.14);
    } else {
      playTone(280, 0, 0.09, 0.12);
      playTone(220, 0.11, 0.12, 0.12);
    }
  } catch (e) {}
}

function loadHtml5QrLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  if (SCAN_STATE.libPromise) return SCAN_STATE.libPromise;
  SCAN_STATE.libPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
    s.onload = () => res();
    s.onerror = () => {
      SCAN_STATE.libPromise = null;
      rej(new Error('No se pudo cargar el motor de escaneo. Verifica tu conexión a internet.'));
    };
    document.head.appendChild(s);
  });
  return SCAN_STATE.libPromise;
}

function bindEnterSku(inputEl, onScan) {
  if (!inputEl) return;
  inputEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const code = inputEl.value.trim();
    if (!code) return;
    const handled = onScan(code);
    if (handled !== false) e.preventDefault();
  });
}

function closeScanner() {
  SCAN_STATE.seq++;
  if (SCAN_STATE.timer) {
    clearTimeout(SCAN_STATE.timer);
    SCAN_STATE.timer = null;
  }
  if (SCAN_STATE.qr) {
    const qr = SCAN_STATE.qr;
    SCAN_STATE.qr = null;
    try {
      qr.stop().then(() => { try { qr.clear(); } catch (e) {} }).catch(() => {});
    } catch (e) {}
  }
  if (SCAN_STATE.stream) {
    try { SCAN_STATE.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    SCAN_STATE.stream = null;
  }
  SCAN_STATE.torch = false;
  if (SCAN_STATE.escHandler) {
    document.removeEventListener('keydown', SCAN_STATE.escHandler);
    SCAN_STATE.escHandler = null;
  }
  const m = $('#scanModal');
  if (m) {
    m.classList.add('hidden');
    m.innerHTML = '';
  }
}

async function openScanner(opts = {}) {
  closeScanner();
  const mySeq = SCAN_STATE.seq;
  SCAN_STATE.opts = opts;
  SCAN_STATE.continuous = !!opts.continuous;
  SCAN_STATE.lastCode = '';
  SCAN_STATE.lastAt = 0;

  // Desbloquear audio en el gesto del usuario
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && !SCAN_STATE.audioCtx) SCAN_STATE.audioCtx = new Ctx();
    if (SCAN_STATE.audioCtx?.state === 'suspended') SCAN_STATE.audioCtx.resume();
  } catch (e) {}

  let m = $('#scanModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'scanModal';
    document.body.appendChild(m);
  }
  m.className = 'scan-modal';
  m.innerHTML = `
    <div class="scan-bg" data-sclose="1"></div>
    <div class="scan-box">
      <div class="title-row">
        <h2>${esc(opts.title || 'Escanear código de barras')}</h2>
        <div class="row0" style="gap:.4rem">
          <button type="button" class="icon-btn hidden" id="scTorch" title="Encender/apagar linterna" aria-label="Linterna">
            <svg class="ic" viewBox="0 0 24 24"><path d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg>
          </button>
          <button type="button" class="icon-btn hidden" id="scFlip" title="Cambiar cámara" aria-label="Cambiar cámara">
            <svg class="ic" viewBox="0 0 24 24"><path d="M20 7h-3l-2-2H9L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M9 13a3 3 0 015.1-2.1M15 13a3 3 0 01-5.1 2.1"/></svg>
          </button>
          <button type="button" class="lnk" data-sclose="1">Cerrar</button>
        </div>
      </div>

      <div class="scan-stage" id="scanStage">
        <video id="scanVideo" autoplay playsinline muted class="hidden"></video>
        <div id="scanReader" class="hidden"></div>
        <div class="scan-aim" id="scanAim"><i></i></div>
        <div class="scan-status" id="scanStatus">Iniciando cámara...</div>
      </div>

      ${opts.allowContinuous ? `<label class="chk" style="margin:.2rem 0"><input type="checkbox" id="scCont" ${SCAN_STATE.continuous ? 'checked' : ''}> Escaneo continuo (no cerrar al leer cada producto)</label>` : ''}

      <form id="scManual" class="row0" style="margin-top:.2rem">
        <input id="scManualIn" type="text" placeholder="O escribe / escanea el código aquí" autocomplete="off" style="margin:0;flex:1">
        <button type="submit" class="icon-btn" style="width:auto;padding:0 .9rem;font-weight:700">Usar</button>
      </form>
    </div>`;

  m.onclick = (e) => { if (e.target.dataset.sclose) closeScanner(); };
  SCAN_STATE.escHandler = (e) => { if (e.key === 'Escape') closeScanner(); };
  document.addEventListener('keydown', SCAN_STATE.escHandler);

  if ($('#scCont')) {
    $('#scCont').onchange = (e) => { SCAN_STATE.continuous = e.target.checked; };
  }

  const setStatus = (msg, type = '') => {
    const el = $('#scanStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'scan-status' + (type ? ' ' + type : '');
  };

  const flashAim = (ok) => {
    const aim = $('#scanAim');
    if (!aim) return;
    aim.classList.remove('ok', 'bad');
    void aim.offsetWidth;
    aim.classList.add(ok ? 'ok' : 'bad');
    setTimeout(() => aim.classList.remove('ok', 'bad'), 450);
  };

  const handleCode = (rawCode, fromManual = false) => {
    const code = String(rawCode || '').trim();
    if (!code) return;
    const now = Date.now();
    if (!fromManual) {
      if (code === SCAN_STATE.lastCode && (now - SCAN_STATE.lastAt) < 1600) return;
      if ((now - SCAN_STATE.lastAt) < 450) return;
    }
    SCAN_STATE.lastCode = code;
    SCAN_STATE.lastAt = now;

    const res = opts.onCode ? opts.onCode(code) : {ok: true, msg: 'Código leído: ' + code};
    const isOk = res === undefined ? true : (res === true || (typeof res === 'object' && res.ok !== false));
    const msg = typeof res === 'object' && res?.msg ? res.msg : (isOk ? 'Leído: ' + code : 'No encontrado: ' + code);

    scanBeep(isOk);
    flashAim(isOk);
    setStatus(msg, isOk ? 'ok' : 'bad');

    if (!SCAN_STATE.continuous) {
      setTimeout(() => { if (SCAN_STATE.seq === mySeq) closeScanner(); }, 220);
    }
  };

  $('#scManual').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#scManualIn').value.trim();
    if (!v) return;
    $('#scManualIn').value = '';
    handleCode(v, true);
  };

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Tu navegador no permite usar la cámara aquí (se requiere HTTPS). Usa el campo manual abajo.', 'bad');
    return;
  }

  const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];
  let useNative = false;
  let detector = null;
  if ('BarcodeDetector' in window) {
    try {
      const sup = typeof BarcodeDetector.getSupportedFormats === 'function' ? await BarcodeDetector.getSupportedFormats() : formats;
      const wanted = formats.filter(f => sup.includes(f));
      if (wanted.length) {
        detector = new BarcodeDetector({formats: wanted});
        useNative = true;
      }
    } catch (e) { useNative = false; }
  }
  if (mySeq !== SCAN_STATE.seq) return;

  const setupTorchAndFlip = async (track) => {
    try {
      const caps = track?.getCapabilities ? track.getCapabilities() : {};
      if (caps.torch && $('#scTorch')) {
        $('#scTorch').classList.remove('hidden');
        $('#scTorch').onclick = async () => {
          try {
            SCAN_STATE.torch = !SCAN_STATE.torch;
            await track.applyConstraints({advanced: [{torch: SCAN_STATE.torch}]});
            $('#scTorch').classList.toggle('on', SCAN_STATE.torch);
          } catch (e) { toast('Linterna no disponible en esta cámara', true); }
        };
      }
    } catch (e) {}
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      SCAN_STATE.devices = devs;
      if (devs.length > 1 && $('#scFlip')) {
        $('#scFlip').classList.remove('hidden');
        $('#scFlip').onclick = () => {
          SCAN_STATE.devIdx = (SCAN_STATE.devIdx + 1) % SCAN_STATE.devices.length;
          startNative(SCAN_STATE.devices[SCAN_STATE.devIdx].deviceId);
        };
      }
    } catch (e) {}
  };

  const startNative = async (deviceId = null) => {
    if (SCAN_STATE.timer) { clearTimeout(SCAN_STATE.timer); SCAN_STATE.timer = null; }
    if (SCAN_STATE.stream) { try { SCAN_STATE.stream.getTracks().forEach(t => t.stop()); } catch (e) {} SCAN_STATE.stream = null; }
    try {
      const videoConstraints = deviceId
        ? {deviceId: {exact: deviceId}, width: {ideal: 1280}, height: {ideal: 720}}
        : {facingMode: {ideal: 'environment'}, width: {ideal: 1280}, height: {ideal: 720}};
      const stream = await navigator.mediaDevices.getUserMedia({video: videoConstraints, audio: false});
      if (mySeq !== SCAN_STATE.seq) { stream.getTracks().forEach(t => t.stop()); return; }
      SCAN_STATE.stream = stream;
      const vid = $('#scanVideo');
      if (!vid) { stream.getTracks().forEach(t => t.stop()); return; }
      vid.classList.remove('hidden');
      vid.srcObject = stream;
      await vid.play();
      const track = stream.getVideoTracks()[0];
      setupTorchAndFlip(track);
      setStatus('Apunta al código de barras...');

      const loop = async () => {
        if (mySeq !== SCAN_STATE.seq) return;
        try {
          if (vid.readyState >= 2) {
            const hits = await detector.detect(vid);
            if (hits && hits.length && hits[0].rawValue) {
              handleCode(hits[0].rawValue);
            }
          }
        } catch (e) {}
        if (mySeq === SCAN_STATE.seq) SCAN_STATE.timer = setTimeout(loop, 130);
      };
      loop();
    } catch (err) {
      if (mySeq !== SCAN_STATE.seq) return;
      setStatus(err?.name === 'NotAllowedError'
        ? 'Permiso de cámara denegado. Habilítalo en el navegador o usa el campo manual.'
        : 'No se pudo abrir la cámara. Usa el campo manual abajo.', 'bad');
    }
  };

  const startFallback = async () => {
    try {
      setStatus('Cargando lector de cámara...');
      await loadHtml5QrLib();
      if (mySeq !== SCAN_STATE.seq) return;
      const readerEl = $('#scanReader');
      if (!readerEl) return;
      readerEl.classList.remove('hidden');
      $('#scanAim')?.classList.add('hidden');
      const F = window.Html5QrcodeSupportedFormats;
      const fmts = F ? [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR, F.QR_CODE].filter(x => x !== undefined) : undefined;
      const qr = new window.Html5Qrcode('scanReader', fmts ? {formatsToSupport: fmts, verbose: false} : false);
      SCAN_STATE.qr = qr;
      await qr.start(
        {facingMode: 'environment'},
        {fps: 10, qrbox: (w, h) => ({width: Math.min(280, Math.floor(w * 0.82)), height: Math.min(160, Math.floor(h * 0.5))})},
        (decodedText) => handleCode(decodedText),
        () => {}
      );
      if (mySeq !== SCAN_STATE.seq) { qr.stop().catch(() => {}); return; }
      setStatus('Apunta al código de barras...');
    } catch (err) {
      if (mySeq !== SCAN_STATE.seq) return;
      setStatus(String(err?.message || err || '').includes('Permission')
        ? 'Permiso de cámara denegado. Habilítalo en el navegador o usa el campo manual.'
        : 'No se pudo iniciar la cámara. Puedes escribir el código manualmente abajo.', 'bad');
    }
  };

  if (useNative) await startNative();
  else await startFallback();
}
