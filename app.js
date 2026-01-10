const btnSolve = document.getElementById("btnSolve");
const textarea = document.getElementById("q");
const statusEl = document.getElementById("status");
const answerBox = document.getElementById("answer");

btnSolve.onclick = async () => {
  const text = textarea.value.trim();
  if (!text) return;

  statusEl.textContent = "Sto preparando la soluzione…";
  btnSolve.disabled = true;
  answerBox.style.display = "none";
  answerBox.innerHTML = "";

  try {
    const res = await fetch("/api/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (!res.ok) {
      throw new Error("Errore API");
    }

    const data = await res.json();

    // 🔹 CASO 1: risposta testuale semplice
    if (typeof data.answer === "string") {
      answerBox.innerHTML = `
        <div style="white-space:pre-wrap; line-height:1.6">
          ${data.answer}
        </div>
      `;
    }

    // 🔹 CASO 2: risposta strutturata
    else {
      let html = "";

      if (data.title) {
        html += `<h2>${data.title}</h2>`;
      }

      if (data.summary) {
        html += `<p><strong>${data.summary}</strong></p>`;
      }

      if (Array.isArray(data.steps)) {
        html += "<h3>Procedura</h3><ol>";
        data.steps.forEach(step => {
          html += `<li>${step}</li>`;
        });
        html += "</ol>";
      }

      if (Array.isArray(data.mistakes)) {
        html += "<h3>Errori da evitare</h3><ul>";
        data.mistakes.forEach(m => {
          html += `<li>${m}</li>`;
        });
        html += "</ul>";
      }

      if (data.quick_alternative) {
        html += `<p><em>${data.quick_alternative}</em></p>`;
      }

      answerBox.innerHTML = html;
    }

    answerBox.style.display = "block";
    statusEl.textContent = "";

  } catch (err) {
    statusEl.textContent = "Errore nel generare la risposta. Riprova.";
  } finally {
    btnSolve.disabled = false;
  }
};
