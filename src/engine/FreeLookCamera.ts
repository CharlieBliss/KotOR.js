import * as THREE from "three";

/** Keep the camera just short of looking straight down or up, where heading is undefined */
const PITCH_MIN = 0.05;
const PITCH_MAX = Math.PI - 0.05;

const forward = new THREE.Vector3();

/**
 * FreeLookCamera
 *
 * Free-look turning for a Z-up world. The camera's orientation is always rebuilt from two angles:
 * - yaw: heading around the world Z axis
 * - pitch: 0 looks straight down, PI/2 at the horizon, PI straight up
 * so it never rolls and can't end up upside down, whatever set its rotation before (lookAt, another
 * Euler order, a saved camera). An upside-down camera is levelled on the next call.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file FreeLookCamera.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class FreeLookCamera {

  static readonly PITCH_MIN = PITCH_MIN;
  static readonly PITCH_MAX = PITCH_MAX;

  /**
   * The camera's current heading and tilt, read from where it is actually looking
   */
  static getAngles(camera: THREE.Camera): { yaw: number; pitch: number } {
    camera.updateMatrixWorld();
    camera.getWorldDirection(forward);
    const pitch = Math.acos(THREE.MathUtils.clamp(-forward.z, -1, 1));
    // Looking straight up or down has no heading of its own; keep the one from the camera's up vector
    const yaw = Math.hypot(forward.x, forward.y) > 1e-6
      ? Math.atan2(-forward.x, forward.y)
      : Math.atan2(camera.up.x, camera.up.y);
    return { yaw, pitch };
  }

  /**
   * Point the camera at a heading and tilt, level with the horizon (no roll)
   */
  static setAngles(camera: THREE.Camera, yaw: number, pitch: number) {
    camera.up.set(0, 0, 1);
    // ZXY applies the tilt first (around the camera's own X axis), then the heading around world Z
    camera.rotation.set(THREE.MathUtils.clamp(pitch, PITCH_MIN, PITCH_MAX), 0, yaw, 'ZXY');
  }

  /**
   * Turn the camera by the given amounts (radians). Positive yaw turns left, positive pitch tilts up.
   */
  static turn(camera: THREE.Camera, yawDelta: number = 0, pitchDelta: number = 0) {
    const { yaw, pitch } = this.getAngles(camera);
    this.setAngles(camera, yaw + yawDelta, pitch + pitchDelta);
  }

}
