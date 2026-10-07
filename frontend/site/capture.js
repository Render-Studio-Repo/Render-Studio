/** Mobile phone / tablet capture page — records or uploads a labeled clip into a session. */

function qs(sel) {
  return document.querySelector(sel);
}

function setStatus(text, isError = false) {
  const el = qs("[data-cap-status]");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#ffb4af" : "#fff";
}

function tokenFromUrl() {
  const params = new URLSearchParams(location.search);
  return String(params.get("t") || params.get("token") || "").trim();
}

function pickMime() {
  const candidates = [
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const type of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) return type;
  }
  return "";
}

async function main() {
  const token = tokenFromUrl();
  const preview = qs("[data-cap-preview]");
  const recordBtn = qs("[data-cap-record]");
  const stopBtn = qs("[data-cap-stop]");
  const flipBtn = qs("[data-cap-flip]");
  const fileInput = qs("[data-cap-file]");
  const labelInput = qs("[data-cap-label]");

  if (!token) {
    setStatus("Missing capture link. Scan the QR again from the desktop editor.", true);
    recordBtn.disabled = true;
    return;
  }

  let facingMode = "environment";
  let stream = null;
  let recorder = null;
  let chunks = [];
  let recording = false;

  async function loadSession() {
    const res = await fetch(`/api/video/capture-sessions/${encodeURIComponent(token)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.detail || "Capture session expired. Generate a new QR on desktop.");
    }
    const data = await res.json();
    const hint = qs("[data-cap-hint]");
    if (hint && data?.hint) hint.textContent = data.hint;
    setStatus(`Ready · ${data.clip_count || 0} clip(s) already linked`);
    return data;
  }

  async function startCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    if (preview) {
      preview.srcObject = stream;
      preview.muted = true;
      await preview.play().catch(() => {});
    }
  }

  async function uploadBlob(blob, label) {
    setStatus("Uploading to desktop editor…");
    const form = new FormData();
    const ext = (blob.type || "").includes("mp4") ? "mp4" : "webm";
    form.append("video", blob, `phone-clip.${ext}`);
    form.append("label", label || "Phone clip");
    form.append("source", "phone");
    const res = await fetch(`/api/video/capture-sessions/${encodeURIComponent(token)}/clips`, {
      method: "POST",
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || "Upload failed.");
    setStatus(`Sent “${data?.clip?.label || label}”. You can record another.`);
  }

  function stopRecording() {
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }

  function startRecording() {
    if (!stream || recording) return;
    chunks = [];
    const mime = pickMime();
    try {
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
        : new MediaRecorder(stream, { videoBitsPerSecond: 6_000_000 });
    } catch (err) {
      setStatus(err?.message || "Could not start recorder.", true);
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      recording = false;
      recordBtn.classList.remove("hidden");
      stopBtn.classList.add("hidden");
      stopBtn.classList.remove("danger");
      const type = recorder?.mimeType || mime || "video/webm";
      const blob = new Blob(chunks, { type });
      chunks = [];
      if (!blob.size) {
        setStatus("Recording was empty.", true);
        return;
      }
      const label = labelInput?.value?.trim() || "Phone clip";
      void uploadBlob(blob, label).catch((err) => setStatus(err?.message || "Upload failed.", true));
    };
    recorder.start(250);
    recording = true;
    recordBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
    stopBtn.classList.add("danger");
    setStatus("Recording… tap Stop when done");
  }

  recordBtn?.addEventListener("click", () => startRecording());
  stopBtn?.addEventListener("click", () => stopRecording());
  flipBtn?.addEventListener("click", async () => {
    facingMode = facingMode === "environment" ? "user" : "environment";
    try {
      await startCamera();
      setStatus(facingMode === "environment" ? "Rear camera" : "Front camera");
    } catch (err) {
      setStatus(err?.message || "Could not flip camera.", true);
    }
  });

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const label = labelInput?.value?.trim() || file.name.replace(/\.[^.]+$/, "") || "Uploaded clip";
    try {
      await uploadBlob(file, label);
    } catch (err) {
      setStatus(err?.message || "Upload failed.", true);
    } finally {
      fileInput.value = "";
    }
  });

  try {
    await loadSession();
    await startCamera();
  } catch (err) {
    setStatus(err?.message || "Camera / session unavailable.", true);
    recordBtn.disabled = true;
  }
}

void main();
