/**
 * Preferred 3D slicer for “Export to …” (localStorage).
 * Protocol open URLs follow Printables / MakerWorld / slicer URI conventions.
 */

export const SLICER_PREF_KEY = "render3d:preferred-slicer";

/** @typedef {{
 *   id: string,
 *   name: string,
 *   shortName: string,
 *   accent: string,
 *   logo: string,
 *   homepage?: string,
 *   protocolOpen?: boolean,
 *   mobileHandy?: boolean,
 * }} SlicerDef */

/** @type {SlicerDef[]} */
export const SLICERS = [
  {
    id: "bambu",
    name: "Bambu Studio",
    shortName: "Bambu",
    accent: "#00aeef",
    logo: "/slicer-logos/bambu.svg",
    homepage: "https://bambulab.com/en/download/studio",
    protocolOpen: true,
    mobileHandy: true,
  },
  {
    id: "orca",
    name: "Orca Slicer",
    shortName: "Orca",
    accent: "#f97316",
    logo: "/slicer-logos/orca.svg",
    homepage: "https://github.com/SoftFever/OrcaSlicer/releases",
    protocolOpen: true,
  },
  {
    id: "prusa",
    name: "PrusaSlicer",
    shortName: "Prusa",
    accent: "#fa6831",
    logo: "/slicer-logos/prusa.svg",
    homepage: "https://www.prusa3d.com/page/prusaslicer_424/",
    protocolOpen: true,
  },
  {
    id: "cura",
    name: "UltiMaker Cura",
    shortName: "Cura",
    accent: "#2ec4b6",
    logo: "/slicer-logos/cura.svg",
    homepage: "https://ultimaker.com/software/ultimaker-cura/",
    protocolOpen: true,
  },
  {
    id: "creality",
    name: "Creality Print",
    shortName: "Creality",
    accent: "#1e90ff",
    logo: "/slicer-logos/creality.svg",
    homepage: "https://www.creality.com/pages/download-software",
    protocolOpen: true,
  },
  {
    id: "elegoo",
    name: "Elegoo Slicer",
    shortName: "Elegoo",
    accent: "#2563eb",
    logo: "/slicer-logos/elegoo.svg",
    homepage: "https://www.elegoo.com/pages/download",
    protocolOpen: false,
  },
  {
    id: "anycubic",
    name: "Anycubic Slicer",
    shortName: "Anycubic",
    accent: "#7c3aed",
    logo: "/slicer-logos/anycubic.svg",
    homepage: "https://www.anycubic.com/pages/software",
    protocolOpen: false,
  },
  {
    id: "superslicer",
    name: "SuperSlicer",
    shortName: "SuperSlicer",
    accent: "#e11d48",
    logo: "/slicer-logos/superslicer.svg",
    homepage: "https://github.com/supermerill/SuperSlicer/releases",
    protocolOpen: false,
  },
];

const byId = new Map(SLICERS.map((s) => [s.id, s]));

export function getSlicerById(id) {
  return byId.get(String(id || "")) || null;
}

export function getPreferredSlicerId() {
  try {
    const raw = localStorage.getItem(SLICER_PREF_KEY);
    if (!raw) return null;
    return byId.has(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function hasChosenSlicer() {
  return Boolean(getPreferredSlicerId());
}

export function setPreferredSlicerId(id) {
  const slicer = getSlicerById(id);
  if (!slicer) return null;
  try {
    localStorage.setItem(SLICER_PREF_KEY, slicer.id);
  } catch {
    /* ignore quota / private mode */
  }
  return slicer;
}

export function getPreferredSlicer() {
  return getSlicerById(getPreferredSlicerId());
}

export function slicerExportLabel(slicer, { mobile = false } = {}) {
  if (!slicer) return "Export to slicer";
  if (mobile && slicer.mobileHandy) return "Export to Bambu Handy";
  return `Export to ${slicer.name}`;
}

/**
 * Build custom-protocol open URLs for a slicer + absolute HTTPS 3MF URL.
 * @param {SlicerDef} slicer
 * @param {string} fileUrl
 */
export function slicerOpenUrls(slicer, fileUrl) {
  const encoded = encodeURIComponent(fileUrl);
  const id = slicer?.id || "bambu";

  if (id === "bambu") {
    return {
      windows: `bambustudio://open?file=${encoded}`,
      windowsEncoded: `bambustudio://open?file=${encoded}`,
      windowsPlain: `bambustudio://open?file=${fileUrl}`,
      linux: `bambustudio://open?file=${encoded}`,
      linuxEncoded: `bambustudio://open?file=${encoded}`,
      linuxPlain: `bambustudio://open?file=${fileUrl}`,
      macos: `bambustudioopen://${encoded}`,
      macosEncoded: `bambustudioopen://${encoded}`,
      macosPlain: `bambustudioopen://${fileUrl}`,
      handy: "bambu://",
      handyIos: "bambu://",
      handyAndroid: "intent://#Intent;package=bbl.intl.bambulab.com;scheme=bambu;end",
      handyPlayStore: "https://play.google.com/store/apps/details?id=bbl.intl.bambulab.com",
      handyAppStore: "https://apps.apple.com/app/bambu-handy/id1624242803",
      protocolOpen: true,
    };
  }

  if (id === "orca") {
    const open = `orcaslicer://open?file=${encoded}`;
    const openPlain = `orcaslicer://open?file=${fileUrl}`;
    return {
      windows: open,
      windowsEncoded: open,
      windowsPlain: openPlain,
      linux: open,
      linuxEncoded: open,
      linuxPlain: openPlain,
      // Some Orca builds register bambu-style open:// encoding on macOS.
      macos: `orcasliceropen://${encoded}`,
      macosEncoded: `orcasliceropen://${encoded}`,
      macosPlain: openPlain,
      macosAlt: open,
      protocolOpen: true,
    };
  }

  if (id === "prusa") {
    const open = `prusaslicer://open?file=${encoded}`;
    const openPlain = `prusaslicer://open?file=${fileUrl}`;
    return {
      windows: open,
      windowsEncoded: open,
      windowsPlain: openPlain,
      linux: open,
      linuxEncoded: open,
      linuxPlain: openPlain,
      macos: open,
      macosEncoded: open,
      macosPlain: openPlain,
      protocolOpen: true,
    };
  }

  if (id === "cura") {
    const open = `cura://open?file=${encoded}`;
    const openPlain = `cura://open?file=${fileUrl}`;
    return {
      windows: open,
      windowsEncoded: open,
      windowsPlain: openPlain,
      linux: open,
      linuxEncoded: open,
      linuxPlain: openPlain,
      macos: open,
      macosEncoded: open,
      macosPlain: openPlain,
      protocolOpen: true,
    };
  }

  if (id === "creality") {
    const open = `crealityprintlink://open?file=${encoded}`;
    const openPlain = `crealityprintlink://open?file=${fileUrl}`;
    return {
      windows: open,
      windowsEncoded: open,
      windowsPlain: openPlain,
      linux: open,
      linuxEncoded: open,
      linuxPlain: openPlain,
      macos: open,
      macosEncoded: open,
      macosPlain: openPlain,
      protocolOpen: true,
    };
  }

  // Download-only slicers (no reliable deep link).
  return { protocolOpen: false };
}

/** Whether a browser should ask the slicer protocol to import a remote URL. */
export function canOpenRemoteSlicerUrl(slicer, os, urls = {}) {
  if (!slicer?.protocolOpen || urls?.protocolOpen === false) return false;
  return Boolean(urls?.[os] || urls?.windows || urls?.macos);
}
