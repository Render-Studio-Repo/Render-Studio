/**
 * Natural-language commands for the Video Studio (iMovie-style edits).
 * Used by the assemble prompt, polish prompt, and CAD/Render Agent when the editor is open.
 */

export function parseStudioEditCommand(raw = "") {
  const text = String(raw || "").trim();
  const lower = text.toLowerCase();
  const plan = {
    summary: [],
    reorder: null,
    transition: null,
    fadeIn: null,
    fadeOut: null,
    fadeDuration: null,
    splitAt: null,
    trimIn: null,
    trimOut: null,
    removeSelected: false,
    music: null,
    musicVolume: null,
    muteClipAudio: null,
    assemble: false,
    effects: {},
    grade: null,
    titleText: null,
    keepAudio: null,
  };
  if (!text) return plan;

  if (/\b(assemble|render timeline|build (the )?edit|export timeline|make (the )?final)\b/.test(lower)) {
    plan.assemble = true;
    plan.summary.push("assemble");
  }

  if (/\b(cross[\s-]?fade|dissolve)\b/.test(lower)) {
    plan.transition = "crossfade";
    plan.summary.push("crossfade");
  } else if (/\b(fade to black|black fade|fade between)\b/.test(lower)) {
    plan.transition = "fade";
    plan.summary.push("fade transition");
  } else if (/\b(hard cut|straight cut|no transition|cut only)\b/.test(lower)) {
    plan.transition = "cut";
    plan.summary.push("hard cuts");
  }

  if (/\bfade[\s-]?ins?\b/.test(lower) || /\bfade in\b/.test(lower)) {
    plan.fadeIn = true;
    plan.summary.push("fade in");
  }
  if (/\bfade[\s-]?outs?\b/.test(lower) || /\bfade out\b/.test(lower)) {
    plan.fadeOut = true;
    plan.summary.push("fade out");
  }
  if (/\bfades?\b/.test(lower) && plan.fadeIn == null && plan.fadeOut == null && plan.transition == null) {
    plan.fadeIn = true;
    plan.fadeOut = true;
    plan.effects.fade = true;
    plan.summary.push("fade in/out");
  }

  const durMatch = lower.match(/(?:fade|transition)\s*(?:for|of|=|:)?\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds|ms)?/);
  if (durMatch) {
    let n = Number(durMatch[1]);
    const unit = durMatch[2] || "s";
    if (unit === "ms") n /= 1000;
    if (Number.isFinite(n) && n > 0) {
      plan.fadeDuration = Math.min(5, Math.max(0.1, n));
      plan.summary.push(`${plan.fadeDuration}s fades`);
    }
  }

  if (/\b(add|with|include|put)\b.{0,24}\b(music|soundtrack|bgm|background music|song|score)\b/.test(lower)
    || /\b(music|soundtrack|bgm|score)\b.{0,16}\b(on|under|bed)\b/.test(lower)) {
    plan.music = "enable";
    plan.summary.push("music");
  }
  if (/\b(remove|no|without|mute)\b.{0,12}\b(music|soundtrack|bgm|song)\b/.test(lower)
    || /\b(music|soundtrack)\b.{0,12}\b(off|remove|mute)\b/.test(lower)) {
    plan.music = "disable";
    plan.summary.push("music off");
  }
  const volMatch = lower.match(/(?:music|bgm|soundtrack)\s*(?:volume|level|at)?\s*(\d{1,3})\s*%/);
  if (volMatch) {
    plan.musicVolume = Math.min(1, Math.max(0.05, Number(volMatch[1]) / 100));
    plan.summary.push(`music ${Math.round(plan.musicVolume * 100)}%`);
  } else if (/\b(quiet|soft)\b.{0,12}\bmusic\b|\bmusic\b.{0,12}\b(quiet|soft|low)\b/.test(lower)) {
    plan.musicVolume = 0.22;
    plan.summary.push("soft music");
  } else if (/\b(loud|boost)\b.{0,12}\bmusic\b|\bmusic\b.{0,12}\b(loud|up)\b/.test(lower)) {
    plan.musicVolume = 0.55;
    plan.summary.push("louder music");
  }

  if (/\b(mute|silent|no audio|hide audio)\b/.test(lower) && !/\bmusic\b/.test(lower)) {
    plan.muteClipAudio = true;
    plan.keepAudio = false;
    plan.summary.push("mute clip audio");
  } else if (/\b(keep audio|with sound|unmute)\b/.test(lower)) {
    plan.muteClipAudio = false;
    plan.keepAudio = true;
    plan.summary.push("keep clip audio");
  }

  const splitMatch = lower.match(/\bsplit\b(?:\s+(?:at|@))?\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds)?/);
  if (splitMatch) {
    plan.splitAt = Number(splitMatch[1]);
    plan.summary.push(`split @ ${plan.splitAt}s`);
  } else if (/\b(split|razor|cut clip|blade)\b/.test(lower)) {
    plan.splitAt = "playhead";
    plan.summary.push("split at playhead");
  }

  const trimIn = lower.match(/\b(?:trim|cut)\s*(?:in|start)\s*(?:to|at|=|:)?\s*(\d+(?:\.\d+)?)/);
  const trimOut = lower.match(/\b(?:trim|cut)\s*(?:out|end)\s*(?:to|at|=|:)?\s*(\d+(?:\.\d+)?)/);
  if (trimIn) {
    plan.trimIn = Number(trimIn[1]);
    plan.summary.push(`trim in ${plan.trimIn}s`);
  }
  if (trimOut) {
    plan.trimOut = Number(trimOut[1]);
    plan.summary.push(`trim out ${plan.trimOut}s`);
  }

  if (/\b(delete|remove)\b.{0,16}\b(clip|selected|this)\b/.test(lower)
    || /\b(delete|remove)\s+clip\b/.test(lower)) {
    plan.removeSelected = true;
    plan.summary.push("remove clip");
  }

  if (/\b(warm|golden|sunset)\b/.test(lower)) {
    plan.grade = "warm";
    plan.summary.push("warm");
  } else if (/\b(cool|blue|icy)\b/.test(lower)) {
    plan.grade = "cool";
    plan.summary.push("cool");
  } else if (/\b(vivid|punchy|saturated)\b/.test(lower)) {
    plan.grade = "vivid";
    plan.summary.push("vivid");
  } else if (/\b(noir|black and white|monochrome)\b/.test(lower)) {
    plan.grade = "noir";
    plan.summary.push("noir");
  }

  if (/\bvignette\b/.test(lower)) {
    plan.effects.vignette = true;
    plan.summary.push("vignette");
  }
  if (/\b(slow[\s-]?mo|slow motion)\b/.test(lower)) {
    plan.effects.slow = true;
    plan.summary.push("slow-mo");
  }

  const titleQuoted = text.match(/\btitle\s*[:=]\s*["“']([^"”']+)["”']/i)
    || text.match(/\b(?:add|with)\s+title\s+["“']([^"”']+)["”']/i);
  if (titleQuoted?.[1]) {
    plan.effects.title = true;
    plan.titleText = titleQuoted[1].trim().slice(0, 80);
    plan.summary.push(`title “${plan.titleText}”`);
  }

  if (/\b(cinematic|film look|imovie)\b/.test(lower)) {
    plan.grade = plan.grade || "warm";
    plan.fadeIn = true;
    plan.fadeOut = true;
    plan.effects.fade = true;
    plan.effects.vignette = true;
    plan.transition = plan.transition || "fade";
    plan.summary.push("cinematic");
  }

  return plan;
}

export function formatStudioCommandHelp() {
  return "Try: “fade in and out, soft music, crossfade, assemble” · “split at 2s” · “trim in 0.5” · “cinematic title: Launch”";
}
