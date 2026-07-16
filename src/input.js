// Keyboard state → normalized flight inputs, all in [-1, 1].
const keys = new Set();

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  // Keep the page from scrolling / triggering browser shortcuts mid-flight.
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function axis(negCode, posCode) {
  return (keys.has(posCode) ? 1 : 0) - (keys.has(negCode) ? 1 : 0);
}

// Virtual joysticks (touchControls.js) write here; keyboard and touch sum.
export const touchInput = { pitch: 0, roll: 0, yaw: 0, climb: 0, reset: false };

const clamp = (v) => Math.max(-1, Math.min(1, v));

export function readInput() {
  return {
    pitch: clamp(axis('KeyS', 'KeyW') + touchInput.pitch),          // +1 = nose down / fly forward
    roll: clamp(axis('ArrowLeft', 'ArrowRight') + touchInput.roll), // +1 = bank right / strafe right
    yaw: clamp(axis('KeyD', 'KeyA') + touchInput.yaw),              // +1 = turn left (CCW)
    climb: clamp(
      (keys.has('Space') ? 1 : 0)
      - (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0)
      + touchInput.climb,
    ),
    reset: keys.has('KeyR') || touchInput.reset,
  };
}
