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

export function readInput() {
  return {
    pitch: axis('KeyS', 'KeyW'),          // +1 = nose down / fly forward
    roll: axis('ArrowLeft', 'ArrowRight'), // +1 = bank right / strafe right
    yaw: axis('KeyD', 'KeyA'),            // +1 = turn left (CCW)
    climb: (keys.has('Space') ? 1 : 0) - (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0),
    reset: keys.has('KeyR'),
  };
}
