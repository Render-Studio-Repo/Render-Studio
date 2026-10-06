/**
 * One-time howto on Fusion export: Insert creates a linked component;
 * Break Link (or Open the Part) before Extrude/Cut.
 * Shows annotated screenshots with pointers at the chain-link icon.
 */

const LS_KEY = "render3d:fusionUnlinkHowtoDismissed:v1";

function storageGet(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function shouldShowFusionUnlinkHowto() {
  return storageGet(LS_KEY) !== "1";
}

/**
 * Show annotated howto if not dismissed. Resolves when closed.
 * @returns {Promise<void>}
 */
export function maybeShowFusionUnlinkHowto() {
  if (!shouldShowFusionUnlinkHowto()) return Promise.resolve();
  return showFusionUnlinkHowto();
}

function showFusionUnlinkHowto() {
  return new Promise((resolve) => {
    document.getElementById("fusion-unlink-howto-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "fusion-unlink-howto-modal";
    modal.className = "auth-modal fusion-unlink-howto-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "fusion-unlink-howto-title");
    modal.innerHTML = `
      <div class="auth-backdrop" data-fusion-howto-dismiss></div>
      <div class="auth-card app-dialog-card fusion-unlink-howto-card">
        <button type="button" class="auth-close fusion-unlink-howto-close" data-fusion-howto-dismiss aria-label="Close">&times;</button>
        <p class="app-dialog-eyebrow">Fusion tip</p>
        <h2 id="fusion-unlink-howto-title" class="app-dialog-title">Inserted STEPs are linked — unlink to Cut</h2>
        <p class="fusion-unlink-howto-lead">
          Inserting a STEP into another design adds a <strong>chain-link</strong> component.
          Extrude Cut fails until you break that link (or open the Part on its own).
        </p>

        <div class="fusion-unlink-howto-stage">
          <div class="fusion-unlink-howto-shot">
            <img
              src="/media/images/fusion-instructions/fusion-unlink-full.png?v=20260908-img"
              alt="Fusion with a linked McMaster screw under HR04 Tunnel"
              width="1024"
              height="577"
            />
            <div class="fusion-unlink-pointer fusion-unlink-pointer--chain" aria-hidden="true">
              <span class="fusion-unlink-pointer-dot"></span>
              <span class="fusion-unlink-pointer-line"></span>
              <span class="fusion-unlink-pointer-label">1 · Chain link = linked</span>
            </div>
            <div class="fusion-unlink-pointer fusion-unlink-pointer--screw" aria-hidden="true">
              <span class="fusion-unlink-pointer-dot"></span>
              <span class="fusion-unlink-pointer-line"></span>
              <span class="fusion-unlink-pointer-label">Inserted STEP</span>
            </div>
          </div>

          <div class="fusion-unlink-howto-callout">
            <div class="fusion-unlink-howto-callout-shot">
              <img
                src="/media/images/fusion-instructions/fusion-unlink-browser.png?v=20260908-img"
                alt="Browser close-up: linked row has chain icon; blue row does not"
                width="278"
                height="96"
              />
              <div class="fusion-unlink-pointer fusion-unlink-pointer--closeup" aria-hidden="true">
                <span class="fusion-unlink-pointer-dot"></span>
                <span class="fusion-unlink-pointer-line"></span>
                <span class="fusion-unlink-pointer-label">2 · Right-click the linked row</span>
              </div>
            </div>
            <div class="fusion-unlink-howto-callout-shot fusion-unlink-howto-callout-shot--menu">
              <img
                src="/media/images/fusion-instructions/fusion-unlink-break-link.png?v=20260908-img"
                alt="Right-click menu showing Break Link on a linked component"
                width="387"
                height="285"
              />
              <div class="fusion-unlink-pointer fusion-unlink-pointer--break" aria-hidden="true">
                <span class="fusion-unlink-pointer-dot"></span>
                <span class="fusion-unlink-pointer-line"></span>
                <span class="fusion-unlink-pointer-label">3 · Break Link</span>
              </div>
            </div>
          </div>
          <ol class="fusion-unlink-howto-steps">
            <li>Find the row with the <strong>chain link</strong> icon.</li>
            <li><strong>Right-click</strong> that component → <strong>Break Link</strong>.</li>
            <li>Then <strong>Extrude → Cut</strong> on a solid face.</li>
            <li>Or skip Insert: <strong>Open</strong> the Part as its own design.</li>
          </ol>
        </div>

        <label class="welcome-dismiss app-remember-choice fusion-unlink-howto-dismiss">
          <input id="fusion-unlink-dont-show" type="checkbox" />
          <span>Don’t show this again</span>
        </label>
        <div class="app-dialog-actions">
          <button type="button" class="btn" data-fusion-howto-gotit>Got it</button>
        </div>
      </div>
    `;

    const finish = () => {
      const dontShow = modal.querySelector("#fusion-unlink-dont-show");
      if (dontShow?.checked) storageSet(LS_KEY, "1");
      modal.remove();
      document.removeEventListener("keydown", onKey);
      resolve();
    };

    const onKey = (event) => {
      if (event.key === "Escape") finish();
    };

    modal.querySelectorAll("[data-fusion-howto-dismiss]").forEach((el) => {
      el.addEventListener("click", finish);
    });
    modal.querySelector("[data-fusion-howto-gotit]")?.addEventListener("click", finish);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(modal);
    modal.querySelector("[data-fusion-howto-gotit]")?.focus();
  });
}
