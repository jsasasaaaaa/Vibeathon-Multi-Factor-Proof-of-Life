// --- M A T R I X   R A I N ---
const canvas = document.getElementById('matrix-bg');
const ctx = canvas.getContext('2d');

function fitCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
fitCanvas();

const katakana =
  'アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズブヅプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨョロヲゴゾドボポヴッン';
const latin = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const nums = '0123456789';
const alphabet = katakana + latin + nums;

const fontSize = 16;
let columns = Math.floor(canvas.width / fontSize);
let rainDrops = Array(columns).fill(1);

function drawMatrix() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#0F0';
  ctx.font = fontSize + 'px monospace';

  for (let i = 0; i < rainDrops.length; i++) {
    const text = alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    ctx.fillText(text, i * fontSize, rainDrops[i] * fontSize);

    if (rainDrops[i] * fontSize > canvas.height && Math.random() > 0.975) {
      rainDrops[i] = 0;
    }
    rainDrops[i]++;
  }
}
setInterval(drawMatrix, 30);

window.addEventListener('resize', () => {
  fitCanvas();
  columns = Math.floor(canvas.width / fontSize);
  rainDrops = Array(columns).fill(1);
});

// --- U T I L S ---
const $ = (id) => document.getElementById(id);
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }
function setStatus(id, text, done=false) {
  const el = $(id);
  el.textContent = text;
  el.className = done ? "status-indicator done" : "status-indicator";
}

async function postJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw { status: r.status, data };
  return data;
}

// --- S T A T E (your backend flow) ---
let sessionId = null;
let l1Target = null;

let l2 = { nonce: null, beepAt: null, tol: null, armedAtPerf: null, beepPerf: null, armed: false };
let l35 = { enabled: false, nonce: null, words: null };

let l1Start = null;
let moveCount = 0;
let l1Submitted = false;

// --- B E E P (match your original working approach) ---
function playBeep() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.value = 0.08;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  setTimeout(() => { osc.stop(); ctx.close(); }, 120);
}

// --- P A S S I V E  T E L E M E T R Y (optional display only) ---
let mouseDistance = 0;
document.addEventListener('mousemove', (e) => {
  mouseDistance += Math.hypot(e.movementX, e.movementY);
});
$("resolution-status").textContent = `${window.screen.width}x${window.screen.height}`;
$("ua-status").textContent = "Done";
$("mouse-path-status").textContent = "Tracking";

// --- W I R E  U I ---
const btnStart = $("btnStart");
const sessionInfo = $("sessionInfo");

// Layer 1 elements
const layer1 = $("layer-1");
const vol = $("vol");
const volVal = $("volVal");
const volumeValue = $("volume-value");
const targetDisplay = $("target-volume-display");
const btnL1Submit = $("btnL1Submit");
const l1Out = $("l1Out");

// Layer 2 elements
const layer2 = $("layer-2");
const armBtn = $("arm-reflex-btn");
const verifyBtn = $("verify-reflex-btn");
const signalBox = $("signal-box");
const reflexMsg = $("reflex-msg");
const l2Timer = $("l2Timer");
const l2Out = $("l2Out");

// Layer 3.5 elements
const layer35 = $("layer-35");
const phraseFlash = $("phraseFlash");
const btnShowPhrase = $("btnShowPhrase");
const btnStartSpeech = $("btnStartSpeech");
const l35Out = $("l35Out");

// Final elements
const finalCard = $("finalCard");
const btnFinalize = $("btnFinalize");
const tokenOut = $("tokenOut");
const btnConsume1 = $("btnConsume1");
const btnConsume2 = $("btnConsume2");
const consumeOut = $("consumeOut");

// --- S T A R T  S E S S I O N ---
btnStart.onclick = async () => {
  btnStart.disabled = true;
  sessionInfo.textContent = "starting...";
  try {
    const data = await postJson("/api/start", {});
    sessionId = data.session_id;
    l1Target = data.layer1_target;

    sessionInfo.textContent = `session_id=${sessionId}  ttl=${data.session_expires_in}s`;
    setStatus("status-1", "Pending");
    setStatus("status-2", "Pending");
    setStatus("status-final", "Locked");

    // reset UI / state
    show(layer1);
    hide(layer2);
    hide(layer35);
    hide(finalCard);

    l1Start = performance.now();
    moveCount = 0;
    l1Submitted = false;
    btnL1Submit.disabled = false;

    targetDisplay.textContent = String(l1Target);
    vol.value = "50";
    volVal.textContent = "50";
    volumeValue.textContent = "50";
    l1Out.textContent = "";

  } catch (e) {
    sessionInfo.textContent = "start failed";
    btnStart.disabled = false;
    console.error(e);
  }
};

// Layer 1 tracking
vol.addEventListener("input", () => {
  volVal.textContent = vol.value;
  volumeValue.textContent = vol.value;
  if (!l1Submitted) moveCount++;
});

btnL1Submit.onclick = async () => {
  if (!sessionId || l1Submitted) return;
  l1Submitted = true;
  btnL1Submit.disabled = true;

  const timeMs = Math.round(performance.now() - l1Start);
  const payload = {
    time_ms: timeMs,
    final_val: parseInt(vol.value, 10),
    target_val: l1Target,
    moves: moveCount
  };

  try {
    const data = await postJson(`/api/${sessionId}/layer1`, payload);

    const risk = data.risk;
    l1Out.textContent = `Risk: ${risk.label} (score=${risk.score.toFixed(2)}) | Strictness: ${data.strictness}`;
    setStatus("status-1", "Locked", true);

    // prep Layer 2
    l2.nonce = data.layer2.nonce;
    l2.beepAt = data.layer2.params.beep_at_ms;
    l2.tol = data.layer2.params.tolerance_ms;
    l2.armed = false;
    l2.beepPerf = null;
    l2.armedAtPerf = null;

    // toggle Layer 3.5
    l35.enabled = data.layer35.enabled;
    l35.nonce = data.layer35.nonce;
    l35.words = data.layer35.words;

    if (l35.enabled) {
      show(layer35);
      setStatus("status-35", "Required");
      phraseFlash.textContent = "•••";
      btnShowPhrase.disabled = false;
      btnStartSpeech.disabled = true;
      l35Out.textContent = "Phrase challenge enabled due to risk/strictness.";
    } else {
      hide(layer35);
    }

    // show Layer 2
    show(layer2);
    setStatus("status-2", "Armed?");
    armBtn.disabled = false;
    armBtn.classList.remove("hidden");
    verifyBtn.disabled = true;
    verifyBtn.classList.add("hidden");
    signalBox.classList.add("hidden");
    signalBox.classList.remove("active");
    reflexMsg.textContent = "";
    l2Timer.textContent = `Server tolerance: ±${l2.tol}ms`;
    l2Out.textContent = "";

  } catch (e) {
    l1Out.textContent = `Layer1 failed: ${JSON.stringify(e.data)}`;
    setStatus("status-1", "Failed");
    console.error(e);
  }
};

// --- L A Y E R  2 ---
armBtn.addEventListener("click", () => {
  if (!sessionId || !l2.nonce) return;

  armBtn.disabled = true;
  setStatus("status-2", "Waiting...");
  reflexMsg.textContent = "Armed. Wait for red signal + beep.";
  l2Out.textContent = "";
  l2.armed = true;
  l2.armedAtPerf = performance.now();

  // schedule beep (server-defined)
  l2Timer.textContent = `beep in ~${l2.beepAt}ms`;
  setTimeout(() => {
    if (!l2.armed) return;

    l2.beepPerf = performance.now();
    signalBox.classList.remove("hidden");
    signalBox.classList.add("active");

    verifyBtn.classList.remove("hidden");
    verifyBtn.disabled = false;

    armBtn.classList.add("hidden");
    playBeep();
    l2Timer.textContent = "BEEP";
  }, l2.beepAt);
});

verifyBtn.addEventListener("click", async () => {
  if (!l2.armed) return;
  l2.armed = false;
  verifyBtn.disabled = true;

  signalBox.classList.remove("active");

  const clickPerf = performance.now();
  const clickAtMs = Math.round(clickPerf - l2.armedAtPerf);
  const heardAtMs = l2.beepPerf ? Math.round(l2.beepPerf - l2.armedAtPerf) : -1;

  try {
    const data = await postJson(`/api/${sessionId}/layer2/beep`, {
      nonce: l2.nonce,
      heard_at_ms: heardAtMs,
      click_at_ms: clickAtMs
    });

    if (data.passed) {
      setStatus("status-2", "Synced", true);
      l2Out.textContent = `Passed (delta=${data.delta_ms}ms, tol=${data.tolerance_ms}ms)`;

      // show final; enable finalize only if 3.5 not required
      show(finalCard);
      if (!l35.enabled) {
        btnFinalize.disabled = false;
        setStatus("status-final", "Ready");
      } else {
        btnFinalize.disabled = true;
        setStatus("status-final", "Awaiting Phrase");
      }
    } else {
      setStatus("status-2", "Failed");
      l2Out.textContent = `Failed (${data.reason || "unknown"}, delta=${data.delta_ms}ms)`;
    }

  } catch (e) {
    setStatus("status-2", "Error");
    l2Out.textContent = `Layer2 error: ${JSON.stringify(e.data)}`;
    console.error(e);
  }
});

// --- L A Y E R  3.5 (optional) ---
btnShowPhrase.onclick = () => {
  if (!l35.enabled || !l35.words) return;
  btnShowPhrase.disabled = true;
  const phrase = l35.words.join(" ");
  phraseFlash.textContent = phrase;

  setTimeout(() => {
    phraseFlash.textContent = "•••";
    btnStartSpeech.disabled = false;
  }, 2000);
};

btnStartSpeech.onclick = async () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    l35Out.textContent = "SpeechRecognition not supported in this browser.";
    return;
  }

  btnStartSpeech.disabled = true;
  l35Out.textContent = "Listening... say the phrase.";

  const rec = new SpeechRecognition();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onresult = async (evt) => {
    const transcript = evt.results[0][0].transcript;

    try {
      const data = await postJson(`/api/${sessionId}/layer35/speech`, {
        nonce: l35.nonce,
        transcript
      });

      if (data.passed) {
        setStatus("status-35", "Passed", true);
        l35Out.textContent = `Passed (heard: "${transcript}")`;

        show(finalCard);
        btnFinalize.disabled = false;
        setStatus("status-final", "Ready");
      } else {
        setStatus("status-35", "Failed");
        l35Out.textContent = `Failed (heard: "${transcript}") expected: ${data.expected.join(" ")}`;
        btnStartSpeech.disabled = false;
      }

    } catch (e) {
      setStatus("status-35", "Error");
      l35Out.textContent = `Layer3.5 error: ${JSON.stringify(e.data)}`;
      btnStartSpeech.disabled = false;
    }
  };

  rec.onerror = (e) => {
    l35Out.textContent = `Speech error: ${e.error}`;
    btnStartSpeech.disabled = false;
  };

  rec.onend = () => {
    // allow retry if not yet finalized
    if (btnFinalize.disabled) btnStartSpeech.disabled = false;
  };

  rec.start();
};

// --- F I N A L I Z E  +  C O N S U M E ---
btnFinalize.onclick = async () => {
  btnFinalize.disabled = true;
  tokenOut.textContent = "Issuing token...";
  consumeOut.textContent = "";

  try {
    const data = await postJson(`/api/${sessionId}/finalize`, {});
    const token = data.token;

    tokenOut.innerHTML =
      `<div>Token issued (expires in ${data.expires_in}s)</div>` +
      `<div class="mono" style="margin-top:8px; word-break:break-all;">${token}</div>`;

    btnConsume1.disabled = false;
    btnConsume2.disabled = true;

    btnConsume1.onclick = async () => {
      try {
        const res = await fetch(`/api/consume?token=${encodeURIComponent(token)}`, { method: "POST" });
        const j = await res.json();
        if (res.ok) {
          consumeOut.textContent = `1st consume ok: ${JSON.stringify(j)}`;
          btnConsume2.disabled = false;
          btnConsume1.disabled = true;
        } else {
          consumeOut.textContent = `Consume failed: ${JSON.stringify(j)}`;
        }
      } catch {
        consumeOut.textContent = "Consume error";
      }
    };

    btnConsume2.onclick = async () => {
      try {
        const res = await fetch(`/api/consume?token=${encodeURIComponent(token)}`, { method: "POST" });
        const j = await res.json();
        if (res.ok) {
          consumeOut.textContent = `Replay unexpectedly succeeded: ${JSON.stringify(j)}`;
        } else {
          consumeOut.textContent = `Replay blocked: ${JSON.stringify(j)}`;
        }
        btnConsume2.disabled = true;
      } catch {
        consumeOut.textContent = "Replay error";
      }
    };

  } catch (e) {
    tokenOut.textContent = `Finalize failed: ${JSON.stringify(e.data)}`;
    btnFinalize.disabled = false;
  }
};
