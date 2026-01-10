const btnSolve = document.getElementById("btnSolve");
const textarea = document.getElementById("q");
const statusEl = document.getElementById("status");
const answerBox = document.getElementById("answer");

let pendingBaseText = "";

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

function hideBox() {
  answerBox.style.display = "none";
  answerBox.innerHTML = "";
}

async function callSolve({ text, followup }) {
  const res = await fetch("/api/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, followup })
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.message || "Errore API";
    throw new Error(msg);
  }
  return data;
}

function isFollowUpResponse(data) {
  return Array.isArray(data?.follow_up_questions) && data.follow_up_questions.length > 0;
}

function renderFollowUp(data) {
  const question = data.follow_up_questions[0] || "Mi serve un dettaglio in più.";
  const options = Array.isArray(data.follow_up_options) ? data.follow_up_options : [];

  const optionsHtml = options
    .map(
      (opt, idx) => `
        <button
          type="button"
          data-opt="${escapeHtml(opt)}"
          class="pm-opt"
          style="
            border:1px solid #e2e8f0;
            background:#ffffff;
            border-radius:999px;
            padding:10px 12px;
            font-weight:800;
            cursor:pointer;
          "
        >${escapeHtml(opt)}</button>
      `
    )
    .join("");

  showBox(`
    <div class="answerHead" style="margin-bottom:12px;">
      <h2 class="answerTitle" style="margin:0; font-size:28px; letter-spacing:-0.02em;">Mi serve un dettaglio in più</h2>
      <div class="answerMeta" style="margin-top:6px; color:#64748b; font-size:14px;">
        Rispondi e ti do subito il metodo giusto.
      </div>
    </div>

    <div style="font-size:16px; line-height:1.6; margin-bottom:12px;">
      <strong>Domanda</strong><br />
      ${escapeHtml(question)}
    </div>

    ${
      options.length
        ? `
      <div style="display:flex; flex-wrap:wrap; gap:10px; margin:12px 0 14px;">
        ${optionsHtml}
      </div>
      <div style="color:#64748b; font-size:13px; margin-bottom:14px;">
        Puoi cliccare un’opzione oppure scrivere una risposta breve.
      </div>
    `
        : `
      <div style="color:#64748b; font-size:13px; margin-bottom:14px;">
        Scrivi una risposta breve.
      </div>
    `
    }

    <div style="
      border:1px solid #e2e8f0;
      border-radius:14px;
      padding:12px;
      background:#f8fafc;
    ">
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

      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:12px;">
        <button id="btnFollowUp" type="button" class="btn" style="max-width:240px;">
          Continua
        </button>
      </div>
    </div>
  `);

  const followUpTextEl = document.getElementById("followUpText");
  const btnFollowUp = document.getElementById("btnFollowUp");

  function wireOptionButtons() {
    const buttons = Array.from(answerBox.querySelectorAll("button[data-opt]"));
    buttons.forEach(b => {
      b.addEventListener("click", async () => {
        const opt = b.getAttribute("data-opt") || "";
        followUpTextEl.value = opt;
        await submitFollowUp(opt);
      });
    });
  }

  async function submitFollowUp(userAnswer) {
    const answer = (userAnswer || "").trim();
    if (!answer) return;

    setStatus("Sto preparando la soluzione…");
    btnSolve.disabled = true;
    btnFollowUp.disabled = true;

    try {
      const merged = `${pendingBaseText}\n\nDettaglio aggiuntivo: ${answer}`;
      const data2 = await callSolve({ text: merged, followup: true });
      renderSolution(data2);
      setStatus("");
    } catch (e) {
      setStatus("Errore nel generare la soluzione. Riprova.");
    } finally {
      btnSolve.disabled = false;
      btnFollowUp.disabled = false;
    }
  }

  btnFollowUp.addEventListener("click", async () => {
    await submitFollowUp(followUpTextEl.value);
  });

  wireOptionButtons();
}

function renderSolution(data) {
  const title = data?.title ? escapeHtml(data.title) : "Soluzione";
  const summary = data?.summary ? escapeHtml(data.summary) : "";

  const difficulty = data?.difficulty ? escapeHtml(data.difficulty) : "";
  const time = data?.time ? escapeHtml(data.time) : "";
  const risk = data?.risk ? escapeHtml(data.risk) : "";

  const metaParts = [difficulty && `Difficoltà: ${difficulty}`, time && `Tempo: ${time}`, risk && `Rischio: ${risk}`].filter(Boolean);
  const meta = metaParts.length ? metaParts.join(" | ") : "";

  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const mistakes = Array.isArray(data?.mistakes) ? data.mistakes : [];
  const whenNot = Array.isArray(data?.when_not_to_do) ? data.when_not_to_do : [];
  const need = Array.isArray(data?.what_you_need) ? data.what_you_need : [];
  const quick = data?.quick_alternative ? escapeHtml(data.quick_alternative) : "";

  const needHtml =
    need.length
      ? `<h3 style="margin-top:18px;">Cosa serve</h3><ul>${need.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
      : "";

  const stepsHtml =
    steps.length
      ? `<h3 style="margin-top:18px;">Procedura</h3><ol>${steps.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ol>`
      : "";

  const mistakesHtml =
    mistakes.length
      ? `<h3 style="margin-top:18px;">Errori da evitare</h3><ul>${mistakes.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
      : "";

  const whenNotHtml =
    whenNot.length
      ? `<h3 style="margin-top:18px;">Quando non farlo</h3><ul>${whenNot.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
      : "";

  const quickHtml =
    quick
      ? `<h3 style="margin-top:18px;">Alternativa rapida</h3><p>${quick}</p>`
      : "";

  showBox(`
    <div class="answerHead" style="margin-bottom:12px;">
      <h2 class="answerTitle" style="margin:0; font-size:28px; letter-spacing:-0.02em;">${title}</h2>
      ${meta ? `<div class="answerMeta" style="margin-top:6px; color:#64748b; font-size:14px;">${escapeHtml(meta)}</div>` : ""}
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

btnSolve.onclick = async () => {
  const text = textarea.value.trim();
  if (!text) return;

  pendingBaseText = text;

  setStatus("Sto preparando la soluzione…");
  btnSolve.disabled = true;
  hideBox();

  try {
    const data = await callSolve({ text, followup: false });

    if (isFollowUpResponse(data)) {
      renderFollowUp(data);
    } else {
      renderSolution(data);
    }

    setStatus("");
  } catch (e) {
    setStatus("Errore nel generare la risposta. Riprova.");
  } finally {
    btnSolve.disabled = false;
  }
};
