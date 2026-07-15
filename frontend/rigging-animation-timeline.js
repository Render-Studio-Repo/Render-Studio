/** Fusion 360–style animation transport bar for rigging workspace */

export function createRiggingAnimationTimeline(container, callbacks = {}) {
  const { onScrub, onPlayPause, onKeyframe, onTimeChange } = callbacks;

  const wrap = document.createElement("div");
  wrap.className = "rigging-anim-timeline";
  wrap.innerHTML = `
    <div class="rigging-anim-transport">
      <button type="button" class="rigging-anim-btn" data-action="prev-key" title="Previous keyframe">⏮</button>
      <button type="button" class="rigging-anim-btn rigging-anim-play" data-action="play" title="Play / Pause (Space)">▶</button>
      <button type="button" class="rigging-anim-btn" data-action="next-key" title="Next keyframe">⏭</button>
      <button type="button" class="rigging-anim-btn" data-action="stop" title="Stop">■</button>
      <span class="rigging-anim-time" id="rigging-anim-time">0:00.0 / 0:05.0</span>
      <span class="rigging-anim-frame" id="rigging-anim-frame">F0</span>
      <button type="button" class="rigging-anim-btn rigging-anim-collapse" data-action="collapse" title="Collapse animation banner" aria-expanded="true">▴</button>
      <button type="button" class="rigging-anim-btn rigging-anim-key" data-action="keyframe" title="Insert keyframe (K)">◆ Key</button>
    </div>
    <div class="rigging-anim-scrub">
      <input type="range" id="rigging-anim-slider" min="0" max="5000" value="0" step="1" />
      <div id="rigging-anim-markers" class="rigging-anim-markers"></div>
    </div>
    <div class="rigging-anim-meta">
      <span id="rigging-anim-name" class="rigging-anim-name">Animation 1</span>
      <span id="rigging-anim-fps" class="muted small">30 fps</span>
    </div>
  `;
  container.appendChild(wrap);

  const playBtn = wrap.querySelector('[data-action="play"]');
  const slider = wrap.querySelector("#rigging-anim-slider");
  const markersEl = wrap.querySelector("#rigging-anim-markers");
  const timeEl = wrap.querySelector("#rigging-anim-time");
  const frameEl = wrap.querySelector("#rigging-anim-frame");
  const nameEl = wrap.querySelector("#rigging-anim-name");
  const fpsEl = wrap.querySelector("#rigging-anim-fps");

  let duration = 5;
  let fps = 30;
  let currentTime = 0;
  let playing = false;
  let keyframeTimes = [];
  let collapsed = false;

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toFixed(1).padStart(4, "0")}`;
  }

  function timeToSlider(t) {
    return Math.round((t / duration) * parseInt(slider.max, 10));
  }

  function sliderToTime(v) {
    return (parseInt(v, 10) / parseInt(slider.max, 10)) * duration;
  }

  function updateDisplay() {
    timeEl.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    const frame = Math.round(currentTime * fps);
    frameEl.textContent = `F${frame}`;
    slider.value = String(timeToSlider(currentTime));
    playBtn.textContent = playing ? "⏸" : "▶";
    playBtn.title = playing ? "Pause (Space)" : "Play (Space)";
  }

  function renderMarkers() {
    markersEl.innerHTML = "";
    for (const t of keyframeTimes) {
      const pct = duration > 0 ? (t / duration) * 100 : 0;
      const dot = document.createElement("span");
      dot.className = "rigging-anim-marker";
      dot.style.left = `${pct}%`;
      dot.title = formatTime(t);
      markersEl.appendChild(dot);
    }
  }

  slider.addEventListener("input", () => {
    currentTime = sliderToTime(slider.value);
    updateDisplay();
    onScrub?.(currentTime, { scrubbing: true });
  });

  slider.addEventListener("change", () => {
    currentTime = sliderToTime(slider.value);
    updateDisplay();
    onTimeChange?.(currentTime);
    onScrub?.(currentTime, { scrubbing: false });
  });

  wrap.querySelector('[data-action="play"]')?.addEventListener("click", () => {
    playing = !playing;
    updateDisplay();
    onPlayPause?.(playing);
  });

  wrap.querySelector('[data-action="stop"]')?.addEventListener("click", () => {
    playing = false;
    currentTime = 0;
    updateDisplay();
    onPlayPause?.(false);
    onTimeChange?.(0);
    onScrub?.(0, { scrubbing: false });
  });

  wrap.querySelector('[data-action="keyframe"]')?.addEventListener("click", () => {
    onKeyframe?.(currentTime);
  });

  wrap.querySelector('[data-action="collapse"]')?.addEventListener("click", (event) => {
    collapsed = !collapsed;
    wrap.classList.toggle("is-collapsed", collapsed);
    event.currentTarget.textContent = collapsed ? "▾" : "▴";
    event.currentTarget.title = collapsed ? "Expand animation banner" : "Collapse animation banner";
    event.currentTarget.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });

  wrap.querySelector('[data-action="prev-key"]')?.addEventListener("click", () => {
    const prev = keyframeTimes.filter((t) => t < currentTime - 0.001).pop();
    if (prev != null) {
      currentTime = prev;
      updateDisplay();
      onTimeChange?.(currentTime);
      onScrub?.(currentTime, { scrubbing: false });
    }
  });

  wrap.querySelector('[data-action="next-key"]')?.addEventListener("click", () => {
    const next = keyframeTimes.find((t) => t > currentTime + 0.001);
    if (next != null) {
      currentTime = next;
      updateDisplay();
      onTimeChange?.(currentTime);
      onScrub?.(currentTime, { scrubbing: false });
    }
  });

  return {
    setAnimation({ name, durationSec, fps: nextFps, keyframes = [] }) {
      duration = Math.max(0.1, durationSec || 5);
      fps = nextFps || 30;
      keyframeTimes = [...new Set((keyframes || []).map((k) => k.time))].sort((a, b) => a - b);
      nameEl.textContent = name || "Animation 1";
      fpsEl.textContent = `${fps} fps`;
      slider.max = String(Math.round(duration * 1000));
      renderMarkers();
      updateDisplay();
    },
    setTime(t, { fromPlayback = false, scrubbing = false } = {}) {
      currentTime = Math.max(0, Math.min(duration, t));
      updateDisplay();
      if (!fromPlayback) onScrub?.(currentTime, { scrubbing });
    },
    getTime: () => currentTime,
    getDuration: () => duration,
    isPlaying: () => playing,
    setPlaying(p) {
      playing = !!p;
      updateDisplay();
    },
    togglePlay() {
      playing = !playing;
      updateDisplay();
      onPlayPause?.(playing);
      return playing;
    },
    refreshMarkers(keyframes) {
      keyframeTimes = [...new Set((keyframes || []).map((k) => k.time))].sort((a, b) => a - b);
      renderMarkers();
    },
  };
}
