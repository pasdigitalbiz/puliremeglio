const btnSolve = document.getElementById("btnSolve");
const textarea = document.getElementById("q");
const statusEl = document.getElementById("status");
const answerBox = document.getElementById("answer");

function formatShareText(data) {
  let out = "";

  out += `COME PULIRE: ${data.title}\n\n`;
  out += `${data.summary}\n\n`;

  if (data.steps && data.steps.length) {
    out += "Procedura:\n";
    data.steps.forEach((s, i) => {
      out += `${i + 1}. ${s}\n`;
    });
    out += "\n";
  }

  if (data.mistakes && data.mistakes.length) {
    out += "Errori da evitare:\n";
    data.mistakes.forEach(m => {
      out += `- ${m}\n`;
    });
    out += "\n";
  }

  if (data.quick_alternative) {
    out += `Consiglio rapido:\n${data.quick_alternative}\n\n`;
  }

  out += "Fonte: PulireMeglio";

  return out;
}

function renderAnswer(data) {
  const shareText = formatShareText(data);

  answerBox.innerHTML = `
    <h2>${data.title}</h2>
    <p><strong>${data.summary}</strong></p>

    ${data.steps?.length ? `
      <h3>Procedura</h3>
      <ol>${data.steps.map(s => `<li>${s}</li>`).join("")}</ol>
    ` : ""}

    ${data.mistakes?.length ? `
      <h3>Errori da evitare</h3>
      <ul>${data.mistakes.map(m => `<li>${m}</li>`).join("")}</ul>
    ` : ""}

    ${data.quick_alternative ? `
      <p><em>${data.quick_alternative}</em></p>
    ` : ""}

    <div style="display:flex; gap:12px; margin-top:18px; flex-wrap:wrap">
      <button id="copyBtn" class="btn" style="background:#0f766e">
        Copia il metodo
      </button>
      <button id="shareBtn" class="btn" style="background:#2563eb">
        Condividi
      </button>
    </div>
  `;

  answerBox.style.display = "block";

  document.getElementById("copyBtn").onclick = async () => {
    await navigator.clipboard.writeText(shareText);
    statusEl.textContent = "Metodo copiato negli appunti.";
  };

  document.getElementById("shareBtn").onclick = async () => {
    if (navigator.share) {
      await navigator.share({
        title: data.title,
        text: shareText
      });
    } else {
      await navigator.clipboard.writeText(shareText);
      statusEl.textContent = "Condivisione non supportata. Testo copiato.";
    }
  };
}

btnSolve.onclick = async () => {
  const text = textarea.value.trim();
  if (!text) return;

  statusEl.textContent = "Sto preparando la soluzione…";
  btnSolve.disabled = true;

  try {
    const res = await fetch("/api/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    const data = await res.json();
    renderAnswer(data);
    statusEl.textContent = "";
  } catch (err) {
    statusEl.textContent = "Errore nel generare la soluzione.";
  } finally {
    btnSolve.disabled = false;
  }
};
