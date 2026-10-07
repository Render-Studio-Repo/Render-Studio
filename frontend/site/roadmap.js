import { getShowMeTour, startShowMe } from "./show-me-tour.js?v=20260908-agent-tabs-logo-ko1-settings-redesign2&vrboard=20260915-spatial-draw4";

function initRoadmapShowMe() {
  document.querySelectorAll("[data-show-me], [data-doc-link]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const guideId = btn.getAttribute("data-show-me") || "";
      const docLink = btn.getAttribute("data-doc-link") || "";
      if (guideId && getShowMeTour(guideId)) {
        startShowMe(guideId, { onDocsPage: true });
        return;
      }
      if (docLink) {
        window.location.href = docLink;
      }
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initRoadmapShowMe);
} else {
  initRoadmapShowMe();
}
