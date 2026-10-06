/** Keep immersive frames alive, but park desktop WebGL when its surface cannot be seen. */
export function shouldRenderViewportFrame({
  presenting = false,
  documentHidden = false,
  viewportHidden = false,
} = {}) {
  return Boolean(presenting || (!documentHidden && !viewportHidden));
}
