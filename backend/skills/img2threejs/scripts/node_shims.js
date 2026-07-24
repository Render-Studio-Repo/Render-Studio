/** Browser API shims for headless Three.js GLTFExporter under Node. */

function fireLoad(reader) {
  reader.readyState = 2;
  const evt = { target: reader };
  reader.onload?.(evt);
  reader.onloadend?.(evt);
}

function fireError(reader, err) {
  reader.readyState = 2;
  reader.onerror?.(err);
  reader.onloadend?.({ target: reader });
}

if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.onload = null;
      this.onloadend = null;
      this.onerror = null;
      this.readyState = 0;
    }
    readAsArrayBuffer(blob) {
      this.readyState = 1;
      Promise.resolve(blob)
        .then((b) => (typeof b?.arrayBuffer === "function" ? b.arrayBuffer() : b))
        .then((buf) => {
          this.result = buf;
          fireLoad(this);
        })
        .catch((err) => fireError(this, err));
    }
    readAsDataURL(blob) {
      this.readyState = 1;
      Promise.resolve(blob)
        .then((b) => (typeof b?.arrayBuffer === "function" ? b.arrayBuffer() : b))
        .then((buf) => {
          const bytes = Buffer.from(buf);
          this.result = `data:application/octet-stream;base64,${bytes.toString("base64")}`;
          fireLoad(this);
        })
        .catch((err) => fireError(this, err));
    }
  };
}

// Minimal document stub so texture helpers don't throw when unused.
if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    createElement(tag) {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              fillStyle: "",
              fillRect() {},
              drawImage() {},
              getImageData(w, h) {
                return { data: new Uint8ClampedArray((w || 1) * (h || 1) * 4), width: w || 1, height: h || 1 };
              },
              putImageData() {},
            };
          },
          toBlob(cb) {
            cb(new Blob([]));
          },
          toDataURL() {
            return "data:image/png;base64,";
          },
        };
      }
      return {};
    },
  };
}
