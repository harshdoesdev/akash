import * as THREE from 'three';

// Smoothed chase camera: sits behind and above the drone in its yaw frame,
// with position lag for a sense of speed and a faster look-at for stability.
// Speed feel: FOV widens and the camera hangs further back as you accelerate.
const BASE_OFFSET = new THREE.Vector3(0, 2.2, 5.2); // behind (+z local) and above
const POSITION_LAG = 4.5; // 1/s — lower = floatier
const LOOK_HEIGHT = 0.6;
const BASE_FOV = 60;

export class ChaseCamera {
  constructor(camera, heightAt = () => 0) {
    this.camera = camera;
    this.heightAt = heightAt;
    this.currentLook = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.initialized = false;
  }

  update(dt, drone) {
    const speed = drone.speed;
    this.desired
      .copy(BASE_OFFSET)
      .setZ(BASE_OFFSET.z + Math.min(1.5, speed * 0.035))
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), drone.yaw);
    this.desired.add(drone.position);
    // Don't clip into hills behind the drone.
    this.desired.y = Math.max(this.desired.y, this.heightAt(this.desired.x, this.desired.z) + 0.6);

    const lookTarget = drone.position.clone();
    lookTarget.y += LOOK_HEIGHT;

    if (!this.initialized) {
      this.camera.position.copy(this.desired);
      this.currentLook.copy(lookTarget);
      this.initialized = true;
    } else {
      const t = 1 - Math.exp(-POSITION_LAG * dt);
      this.camera.position.lerp(this.desired, t);
      this.currentLook.lerp(lookTarget, 1 - Math.exp(-10 * dt));
    }

    // Speed rush: widen the FOV up to +13° at full tilt.
    const targetFov = BASE_FOV + Math.min(13, speed * 0.5);
    const newFov = this.camera.fov + (targetFov - this.camera.fov) * (1 - Math.exp(-3 * dt));
    if (Math.abs(newFov - this.camera.fov) > 0.01) {
      this.camera.fov = newFov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.lookAt(this.currentLook);
  }
}
