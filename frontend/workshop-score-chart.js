function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function valueCell(value) {
  return value == null || value === ""
    ? `<span class="muted small">-</span>`
    : esc(value);
}

function idsCell(values) {
  const rows = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!rows.length) return `<span class="muted small">-</span>`;
  return rows.map((value) => `<code>${esc(value)}</code>`).join(" ");
}

function guardClass(color) {
  const safe = String(color || "").toLowerCase();
  if (safe === "green" || safe === "yellow" || safe === "red") return safe;
  return "waiting";
}

export function renderWorkshopScoreChartPanel(panel = {}) {
  const rows = Array.isArray(panel.rows) ? panel.rows : [];
  if (!rows.length) {
    return `
      <article class="workshop-card workshop-score-empty">
        <div class="workshop-card-head">
          <strong>PM score chart</strong>
          <span class="workshop-pill workshop-pill--waiting">empty</span>
        </div>
        <p>${esc(panel.empty_reason || "No fleet receipt or guard fixture JSON found yet.")}</p>
        <p class="muted small">${esc(panel.source_note || "Real receipt/guard data only.")}</p>
      </article>
    `;
  }
  return `
    <article class="workshop-card">
      <div class="workshop-card-head">
        <strong>PM score chart</strong>
        <span class="workshop-pill">${rows.length} row${rows.length === 1 ? "" : "s"}</span>
      </div>
      <p class="muted small">${esc(panel.source_note || "Real receipt/guard data only.")}</p>
      <div class="workshop-score-table-wrap">
        <table class="workshop-score-table">
          <thead>
            <tr>
              <th>receipt_id</th>
              <th>peer score</th>
              <th>guard color</th>
              <th>open FAIL count</th>
              <th>owner_slug</th>
              <th>open RCPT/FIX ids</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>
                  <div class="workshop-score-id">
                    <strong>${valueCell(row.receipt_id)}</strong>
                    ${row.source_path ? `<span>${esc(row.source_path)}</span>` : ""}
                  </div>
                </td>
                <td>${valueCell(row.peer_score)}</td>
                <td><span class="workshop-pill workshop-pill--${esc(guardClass(row.guard_color))}">${valueCell(row.guard_color)}</span></td>
                <td>${valueCell(row.open_fail_count)}</td>
                <td>${valueCell(row.owner_slug)}</td>
                <td>${idsCell(row.open_rcpt_fix_ids)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </article>
  `;
}
