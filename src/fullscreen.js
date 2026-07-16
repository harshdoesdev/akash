// Fullscreen, wrapped for Safari: iPhones have NO fullscreen API for page
// elements (only <video>), iPads only the webkit-prefixed one. Everything
// that touches fullscreen goes through here; on iPhone `supported` is false
// and callers hide their controls instead of showing a dead button.
const root = document.documentElement;

export const fullscreenSupported =
  !!(root.requestFullscreen || root.webkitRequestFullscreen);

export function fullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

export function enterFullscreen() {
  try {
    const fn = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!fn) return Promise.reject(new Error('fullscreen unsupported'));
    return Promise.resolve(fn.call(root)); // prefixed form returns undefined
  } catch (err) {
    return Promise.reject(err);
  }
}

export function exitFullscreen() {
  (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
}

export function onFullscreenChange(fn) {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
}
