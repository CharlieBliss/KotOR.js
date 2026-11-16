import { describe, expect, test } from "@jest/globals";
import * as THREE from "three";
import { FreeLookCamera } from "@/engine/FreeLookCamera";

/** Where the camera's top edge points, in world space */
function cameraUp(camera: THREE.Camera): THREE.Vector3 {
  camera.updateMatrixWorld();
  return new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
}

function cameraForward(camera: THREE.Camera): THREE.Vector3 {
  camera.updateMatrixWorld();
  return camera.getWorldDirection(new THREE.Vector3());
}

describe("free-look camera", () => {
  test("reads back the heading and tilt it was given", () => {
    const camera = new THREE.PerspectiveCamera();
    FreeLookCamera.setAngles(camera, 1.2, 1.0);
    const { yaw, pitch } = FreeLookCamera.getAngles(camera);
    expect(yaw).toBeCloseTo(1.2, 5);
    expect(pitch).toBeCloseTo(1.0, 5);
  });

  test("an upside-down camera is levelled on the next turn, still facing the same way", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.up.set(0, 0, 1);
    camera.position.set(0, 0, 2);
    camera.lookAt(5, 5, 0);
    // Roll it upside down
    camera.rotateZ(Math.PI);
    expect(cameraUp(camera).z).toBeLessThan(0);
    const heading = cameraForward(camera);

    FreeLookCamera.turn(camera, 0, 0);

    expect(cameraUp(camera).z).toBeGreaterThan(0);
    const after = cameraForward(camera);
    expect(after.x).toBeCloseTo(heading.x, 5);
    expect(after.y).toBeCloseTo(heading.y, 5);
    expect(after.z).toBeCloseTo(heading.z, 5);
  });

  test("never rolls, and tilting stops short of straight up or down", () => {
    const camera = new THREE.PerspectiveCamera();
    FreeLookCamera.setAngles(camera, 0, Math.PI / 2);
    for (let i = 0; i < 200; i++) {
      FreeLookCamera.turn(camera, 0.3, i < 100 ? 0.2 : -0.2);
      const up = cameraUp(camera);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      // Level: the camera's sideways axis stays horizontal, and its top never points down
      expect(Math.abs(right.z)).toBeLessThan(1e-6);
      expect(up.z).toBeGreaterThanOrEqual(-1e-6);
    }
    expect(FreeLookCamera.getAngles(camera).pitch).toBeCloseTo(FreeLookCamera.PITCH_MIN, 5);
  });

  test("turns the same way the mouse moves", () => {
    const camera = new THREE.PerspectiveCamera();
    // Looking along +Y at the horizon
    FreeLookCamera.setAngles(camera, 0, Math.PI / 2);
    expect(cameraForward(camera).y).toBeCloseTo(1, 5);

    // Mouse right (negative yaw) turns toward +X; mouse up (positive pitch) tilts up
    FreeLookCamera.turn(camera, -0.5, 0.3);
    const f = cameraForward(camera);
    expect(f.x).toBeGreaterThan(0);
    expect(f.z).toBeGreaterThan(0);
  });
});
