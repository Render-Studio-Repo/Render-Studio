/** Browser API shims for headless Three.js GLTFExporter under Node. */
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.onload = null;
      this.onerror = null;
      this.readyState = 0;
    }
    readAsArrayBuffer(blob) {
      this.readyState = 1;
      Promise.resolve(blob)
        .then((b) => (typeof b?.arrayBuffer === "function" ? b.arrayBuffer() : b))
        .then((buf) => {
          this.readyState = 2;
          this.result = buf;
          this.onload?.({ target: this });
        })
        .catch((err) => {
          this.readyState = 2;
          this.onerror?.(err);
        });
    }
    readAsDataURL(blob) {
      this.readyState = 1;
      Promise.resolve(blob)
        .then((b) => (typeof b?.arrayBuffer === "function" ? b.arrayBuffer() : b))
        .then((buf) => {
          const bytes = Buffer.from(buf);
          this.readyState = 2;
          this.result = `data:application/octet-stream;base64,${bytes.toString("base64")}`;
          this.onload?.({ target: this });
        })
        .catch((err) => {
          this.readyState = 2;
          this.onerror?.(err);
        });
    }
  };
}
