/**
 * Ensures the boot logo uses the futuristic metal gear + electricity overlay.
 * Safe to run even if index.html still has the legacy SVG gear.
 */
(function upgradeBootMetalGear() {
  var gear = document.querySelector(".studio-boot-logo-gear");
  if (!gear || gear.querySelector(".studio-boot-logo-gear-img")) return;

  var percent = gear.querySelector(".studio-boot-logo-percent");
  var spin = document.createElement("span");
  spin.className = "studio-boot-logo-gear-spin";
  spin.innerHTML =
    '<img class="studio-boot-logo-gear-img" src="/assets/futuristic-gear-metal.png?v=20260715-metal-gear" alt="" width="72" height="72" />' +
    '<svg class="studio-boot-logo-gear-electric" viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">' +
    '<defs><filter id="bootElecGlow" x="-60%" y="-60%" width="220%" height="220%">' +
    '<feGaussianBlur stdDeviation="1.35" result="blur"/>' +
    '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>' +
    "</filter></defs>" +
    '<g class="studio-boot-elec-arcs" filter="url(#bootElecGlow)" fill="none" stroke="#67e8f9" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">' +
    '<path class="studio-boot-elec-path studio-boot-elec-path--a" d="M32 18 L27 24 L33 28 L29 34 L32 40"/>' +
    '<path class="studio-boot-elec-path studio-boot-elec-path--b" d="M46 32 L40 27 L36 33 L42 37 L48 34"/>' +
    '<path class="studio-boot-elec-path studio-boot-elec-path--c" d="M32 46 L37 40 L31 36 L35 30 L32 24"/>' +
    '<path class="studio-boot-elec-path studio-boot-elec-path--d" d="M18 32 L24 37 L28 31 L22 27 L16 30"/>' +
    '<path class="studio-boot-elec-path studio-boot-elec-path--e" d="M42 20 L38 26 L44 30 L40 34"/>' +
    '<path class="studio-boot-elec-path studio-boot-elec-path--f" d="M22 44 L26 38 L20 34 L24 30"/>' +
    "</g>" +
    '<g class="studio-boot-elec-nodes" fill="#ecfeff" filter="url(#bootElecGlow)">' +
    '<circle class="studio-boot-elec-node" cx="27" cy="24" r="1.55"/>' +
    '<circle class="studio-boot-elec-node" cx="33" cy="28" r="1.35"/>' +
    '<circle class="studio-boot-elec-node" cx="40" cy="27" r="1.55"/>' +
    '<circle class="studio-boot-elec-node" cx="36" cy="33" r="1.35"/>' +
    '<circle class="studio-boot-elec-node" cx="37" cy="40" r="1.55"/>' +
    '<circle class="studio-boot-elec-node" cx="24" cy="37" r="1.55"/>' +
    '<circle class="studio-boot-elec-node" cx="38" cy="26" r="1.2"/>' +
    '<circle class="studio-boot-elec-node" cx="26" cy="38" r="1.2"/>' +
    "</g></svg>";

  gear.querySelectorAll(".studio-boot-logo-gear-svg").forEach(function (el) {
    el.remove();
  });
  gear.insertBefore(spin, percent || null);

  var word = document.querySelector(".studio-boot-logo-word");
  if (word) word.classList.add("studio-boot-logo-word--metal");
})();
