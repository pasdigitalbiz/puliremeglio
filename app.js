const btnSolve = document.getElementById("btnSolve");
const textarea = document.getElementById("q");
const statusEl = document.getElementById("status");
const answerBox = document.getElementById("answer");

let pendingBaseText = "";
let cooldownTimer = null;

const CLIENT_LIMIT = {
  maxRequests: 12,
  windowMs: 10 * 60 * 1000,
  cooldownMs: 1200
};

function nowMs() {
  return Date.now();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function showBox(html) {
  answerBox.innerHTML = html;
  answerBox.style.display = "block";
}

function showNiceLoadingCard(label = "Sto preparando la soluzione") {
  showBox(`
    <div style="
      border:1px solid #e2e8f0;
      background:#ffffff;
      border-radius:18px;
      padding:20px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
    ">
      <div style="display:flex; align-items:center; gap:14px;">
        <div style="
          width:46px;height:30px;border-radius:10px;background:#22c55e;
          position:relative;overflow:hidden;
          box-shadow: 0 10px 22px rgba(15, 23, 42, 0.06);
        ">
          <div class="pm-sponge"></div>
        </div>

        <div style="flex:1;">
          <div style="font-weight:900; letter-spacing:-0.01em; font-size:16px;">
            ${escapeHtml(label)}
          </div>
          <div style="color:#64748b; font-size:14px; margin-top:2px;">
            Un attimo, sto organizzando i passaggi in modo sicuro.
          </div>
        </div>
      </div>

      <style>
        .pm-sponge{
          position:absolute; top:0; left:-40%;
          width:42%; height:100%;
          background:rgba(255,255,255,0.45);
          animation: pmClean 1.1s infinite ease-in-out;
        }
        @keyframes pmClean{
          0%{ left:-40%; }
          50%{ left:45%; }
          100%{ left:120%; }
        }
      </style>
    </div>
  `);
}

function showNiceNotice(title, text) {
  showBox(`
    <div style="
      border:1px solid #e2e8f0;
      background:#ffffff;
      border-radius:18px;
      padding:18px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
    ">
      <div style="font-weight:900; font-size:16px; letter-spacing:-0.01em;">
        ${escapeHtml(title)}
      </div>
      <div id="pmNoticeText" style="color:#64748b; margin-top:6px; font-size:14px; line-height:1.5;">
        ${escapeHtml(text)}
      </div>
    </div>
  `);
}

function updateNoticeText(text) {
  const el = document.getElementById("pmNoticeText");
  if (el) el.textContent = text;
}

function startCooldownCountdown(waitMs) {
  if (cooldownTimer) clearInterval(cooldownTimer);

  btnSolve.disabled = true;

  const startedAt = nowMs();
  const endAt = startedAt + waitMs;

  const tick = () => {
    const remaining = Math.max(0, endAt - nowMs());
    const sec = Math.max(0, Math.ceil(remaining / 1000));
    updateNoticeText(`Per evitare click ripetuti, riprova tra ${sec}s.`);

    if (remaining <= 0) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      btnSolve.disabled = false;

      // se la notice è ancora quella del cooldown, la togliamo
      // (se nel frattempo è arrivato altro contenuto, non tocchiamo)
      const nt = document.getElementById("pmNoticeText");
      if (nt && nt.textContent.includes("riprova tra")) {
        answerBox.style.display = "none";
        answerBox.innerHTML = "";
      }
    }
  };

  tick();
  cooldownTimer = setInterval(tick, 200);
}

function getClientHistory() {
  const raw = localStorage.getItem("pm_req_history");
  try {
    return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setClientHistory(arr) {
  localStorage.setItem("pm_req_history", JSON.stringify(arr));
}

function pruneHistory(arr) {
  const cutoff = nowMs() - CLIENT_LIMIT.windowMs;
  return arr.filter(ts => typeof ts === "number" && ts >= cutoff);
}

function canRequestNow() {
  const history = pruneHistory(getClientHistory());
  const last = history.length ? history[history.length - 1] : 0;

  const withinCooldown = last && (nowMs() - last) < CLIENT_LIMIT.cooldownMs;
  if (withinCooldown) {
    const waitMs = CLIENT_LIMIT.cooldownMs - (nowMs() - last);
    return { ok: false, reason: "cooldown", waitMs, history };
  }

  if (history.length >= CLIENT_LIMIT.maxRequests) {
    const oldest = history[0];
    const waitMs = CLIENT_LIMIT.windowMs - (nowMs() - oldest);
    return { ok: false, reason: "limit", waitMs, history };
  }

  return { ok: true, reason: "ok", waitMs: 0, history };
}

function registerRequest() {
  const history = pruneHistory(getClientHistory());
  history.push(nowMs());
  setClientHistory(history);
}

async function callSolve({ text, followup }) {
  const res = await fetch("/api/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, followup })
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const retryAfter = res.headers.get("Retry-After");
    const serverWaitSec = retryAfter ? Number(retryAfter) : null;
    const msg = data?.message || "Errore API";
    const err = new Error(msg);
    err.status = res.status;
    err.serverWaitSec = Number.isFinite(serverWaitSec) ? serverWaitSec : null;
    throw err;
  }

  return data;
}

function isFollowUpResponse(data) {
  return Array.isArray(data?.follow_up_questions) && data.follow_up_questions.length > 0;
}

function prettifyOptionLabel(opt) {
  const clean = String(opt || "").trim();
  if (clean.toLowerCase() === "non lo so") return "Non sono sicuro";
  return clean;
}

function renderSolution(data) {
  const title = data?.title ? escapeHtml(data.title) : "Soluzione";
  const summary = data?.summary ? escapeHtml(data.summary) : "";

  const difficulty = data?.difficulty ? escapeHtml(data.difficulty) : "";
  const time = data?.time ? escapeHtml(data.time) : "";
  const risk = data?.risk ? escapeHtml(data.risk) : "";

  const metaParts = [
    difficulty && `Difficoltà: ${difficulty}`,
    time && `Tempo: ${time}`,
    risk && `Rischio: ${risk}`
  ].filter(Boolean);

  const meta = metaParts.length ? metaParts.join(" | ") : "";

  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const mistakes = Array.isArray(data?.mistakes) ? data.mistakes : [];
  const whenNot = Array.isArray(data?.when_not_to_do) ? data.when_not_to_do : [];
  const need = Array.isArray(data?.what_you_need) ? data.what_you_need : [];
  const quick = data?.quick_alternative ? escapeHtml(data.quick_alternative) : "";

  const sectionTitle = txt => `<h3 style="margin-top:18px; margin-bottom:10px;">${txt}</h3>`;

  const listUl = arr =>
    `<ul style="margin:10px 0 0; padding-left:18px;">${arr
      .map(x => `<li style="margin:6px 0;">${escapeHtml(x)}</li>`)
      .join("")}</ul>`;

  const listOl = arr =>
    `<ol style="margin:10px 0 0; padding-left:18px;">${arr
      .map(x => `<li style="margin:6px 0;">${escapeHtml(x)}</li>`)
      .join("")}</ol>`;

  const warningBox = innerHtml => `
    <div style="
      margin-top:10px;
      border:1px solid #fecdd3;
      background:#fff1f2;
      border-radius:14px;
      padding:14px;
    ">
      ${innerHtml}
    </div>
  `;

  const needHtml = need.length ? `${sectionTitle("Cosa serve")}${listUl(need)}` : "";
  const stepsHtml = steps.length ? `${sectionTitle("Procedura")}${listOl(steps)}` : "";

  const mistakesHtml = mistakes.length
    ? `${sectionTitle("Errori da evitare")}${warningBox(listUl(mistakes))}`
    : "";

  const whenNotHtml = whenNot.length
    ? `${sectionTitle("Quando non farlo")}${warningBox(listUl(whenNot))}`
    : "";

  const quickHtml = quick
    ? `${sectionTitle("Alternativa rapida")}<p style="margin:10px 0 0; line-height:1.65;">${quick}</p>`
    : "";

  showBox(`
    <div style="margin-bottom:12px;">
      <h2 style="margin:0; font-size:28px; letter-spacing:-0.02em;">${title}</h2>
      ${meta ? `<div style="margin-top:6px; color:#64748b; font-size:14px;">${escapeHtml(meta)}</div>` : ""}
    </div>

    ${summary ? `<p style="font-size:16px; line-height:1.6; margin:0 0 8px;"><strong>${summary}</strong></p>` : ""}

    <div style="font-size:16px; line-height:1.65;">
      ${needHtml}
      ${stepsHtml}
      ${mistakesHtml}
      ${whenNotHtml}
      ${quickHtml}
    </div>
  `);
}

function renderFollowUp(data) {
  const question = data.follow_up_questions[0] || "Mi serve un dettaglio in più.";
  const options = Array.isArray(data.follow_up_options) ? data.follow_up_options : [];

  const optionsHtml = options
    .map(opt => {
      const display = prettifyOptionLabel(opt);
      return `
        <button
  type="button"
  data-opt="${escapeHtml(opt)}"
  style="
    border:1px solid #e2e8f0;
    background:#ffffff;
    border-radius:999px;
    padding:10px 12px;
    font-weight:900;
    cursor:pointer;
  "
>${escapeHtml(display)}</button>
      `;
    })
    .join("");

  showBox(`
    <div style="margin-bottom:12px;">
      <h2 style="margin:0; font-size:28px; letter-spacing:-0.02em;">Mi serve solo una cosa</h2>
      <div style="margin-top:6px; color:#64748b; font-size:14px;">
        Rispondi e ti do subito il metodo giusto.
      </div>
    </div>

    <div style="font-size:16px; line-height:1.6; margin-bottom:12px;">
      <strong>Domanda</strong><br />
      ${escapeHtml(question)}
    </div>

    ${
      options.length
        ? `<div style="display:flex; flex-wrap:wrap; gap:10px; margin:12px 0 10px;">${optionsHtml}</div>
           <div style="color:#64748b; font-size:13px; margin-bottom:14px;">
             Puoi cliccare un’opzione oppure scrivere una risposta breve.
           </div>`
        : `<div style="color:#64748b; font-size:13px; margin-bottom:14px;">
             Scrivi una risposta breve.
           </div>`
    }

    <div style="border:1px solid #e2e8f0; border-radius:14px; padding:12px; background:#f8fafc;">
      <textarea id="followUpText" style="
        width:100%;
        min-height:84px;
        border-radius:12px;
        border:1px solid #e2e8f0;
        padding:12px;
        font-size:16px;
        resize:vertical;
        background:#ffffff;
      " placeholder="Scrivi qui una risposta breve"></textarea>

      <div style="color:#64748b; font-size:13px; margin-top:10px;">
        Premi Invio per continuare. Shift+Invio per andare a capo.
      </div>
    </div>
  `);

  const followUpTextEl = document.getElementById("followUpText");

  async function submitFollowUp(userAnswer) {
    const answer = (userAnswer || "").trim();
    if (!answer) return;

    const check = canRequestNow();
    if (!check.ok) {
      showNiceNotice("Un attimo", "Per evitare click ripetuti, riprova tra 1s.");
      startCooldownCountdown(check.waitMs);
      return;
    }

    registerRequest();
    showNiceLoadingCard("Sto preparando la soluzione");
    btnSolve.disabled = true;
    setStatus("");

    try {
      const merged = `${pendingBaseText}\n\nDettaglio aggiuntivo: ${answer}`;
      const data2 = await callSolve({ text: merged, followup: true });
      renderSolution(data2);
    } catch (e) {
      showNiceNotice("Qualcosa è andato storto", "Riprova tra poco. Se continua, cambia leggermente la richiesta.");
    } finally {
      btnSolve.disabled = false;
    }
  }

  const buttons = Array.from(answerBox.querySelectorAll("button[data-opt]"));
  buttons.forEach(b => {
    b.addEventListener("click", async () => {
      const opt = b.getAttribute("data-opt") || "";
      followUpTextEl.value = prettifyOptionLabel(opt);
      await submitFollowUp(opt);
    });
  });

  followUpTextEl.addEventListener("keydown", async e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await submitFollowUp(followUpTextEl.value);
    }
  });

  followUpTextEl.focus();
}

btnSolve.onclick = async () => {
  const text = textarea.value.trim();
  if (!text) return;

  const check = canRequestNow();
  if (!check.ok) {
    showNiceNotice("Un attimo", "Per evitare click ripetuti, riprova tra 1s.");
    startCooldownCountdown(check.waitMs);
    return;
  }

  pendingBaseText = text;
  registerRequest();

  showNiceLoadingCard("Sto preparando la soluzione");
  btnSolve.disabled = true;
  setStatus("");

  try {
    const data = await callSolve({ text, followup: false });

    if (isFollowUpResponse(data)) {
      renderFollowUp(data);
    } else {
      renderSolution(data);
    }
  } catch (e) {
    showNiceNotice("Qualcosa è andato storto", "Riprova tra poco. Se continua, cambia leggermente la richiesta.");
  } finally {
    btnSolve.disabled = false;
  }
};
