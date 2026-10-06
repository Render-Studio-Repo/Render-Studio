/**
 * Share-clip studio — thin wrapper around the VID-tab timeline editor.
 */

export {
  mountVideoTimelineEditor as mountVideoClipStudio,
  parseFilmEditPrompt,
  reorderClips,
  defaultVideoAiKeyValue,
  localImproveVideoPrompt,
  mediaKindFromFile,
  bindMediaDropTarget,
  filesFromDropEvent,
  isMediaFileDrag,
  planDroppedMedia,
  prettyAudioLabel,
  isEditorTypingTarget,
} from "./video-timeline-editor.js?v=20260914-clipdnd1-20260914-clipmedia2-20260914-tlupload1-20260914-musicon1-20260914-clipcut1-20260914-shareprompt1-cliplit1-cliptrim1-clipkeys1-clipaud1-clipplay1-sharexcap1-xsharepct1-vidclose1-clipaudtrim1-cliptrimui1-cliploop1-clipaudsave1-xsharebtn1-trimup1-addaudio1-escunsel1-trimdone1-sharegif2-sharexsame1-dledit1-vedir1-clipauddrop1-recdedupe1-tlkeys2-tlspin1-tlaudio1-tldupe1-imovie1-tlinstant1-filmeditkey1-clipshare1-trimwave1-trimlen1-sharexfull1-veditorhub1-clipui1-xtab1-vidlayout1-vidzoom1-vidmodel1-vidjob1-clipgen1-filmlive2&vidclose2=20260916-1&filmfix=20260916-1&dlprog1=20260916-1&clipperf1-deskdbg1&leakobs1&leakfix4&leakfix30&leakfix32&leakfix33&editautosave=20261006-3&spaceplay=20261006-2";

/** Order clips from an assemble prompt by matching labels mentioned in order. */
export function parseAssembleOrder(prompt, clips = []) {
  const text = String(prompt || "").toLowerCase();
  if (!text.trim() || !clips.length) return clips.map((c) => c.id);

  const remaining = [...clips];
  const ordered = [];

  const numbered = [...text.matchAll(/(?:^|\n|;|\.)\s*(\d+)[.)]\s*([^\n;]+)/g)];
  if (numbered.length) {
    const byNum = numbered
      .map((m) => ({ n: Number(m[1]), phrase: m[2].trim() }))
      .sort((a, b) => a.n - b.n);
    for (const item of byNum) {
      const hit = remaining.find((c) => item.phrase.includes(String(c.label || "").toLowerCase())
        || String(c.label || "").toLowerCase().includes(item.phrase.slice(0, 24)));
      if (hit) {
        ordered.push(hit.id);
        remaining.splice(remaining.indexOf(hit), 1);
      }
    }
  }

  const positions = remaining
    .map((c) => {
      const label = String(c.label || "").toLowerCase().trim();
      if (label.length < 2) return null;
      const idx = text.indexOf(label);
      return idx >= 0 ? { id: c.id, idx, clip: c } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.idx - b.idx);

  for (const item of positions) {
    ordered.push(item.id);
    const i = remaining.findIndex((c) => c.id === item.id);
    if (i >= 0) remaining.splice(i, 1);
  }

  for (const c of remaining) {
    if (!ordered.includes(c.id)) ordered.push(c.id);
  }
  return ordered;
}
