import { describe, expect, jest, test } from "@jest/globals";

jest.mock("@/GameState", () => ({ GameState: { windManager: { windLevel: 1, pointSourceWinds: [] as any[] } } }));
jest.mock("@/utility/GameFileSystem", () => ({ GameFileSystem: {} }));

import * as THREE from "three";
import { OdysseyEmitter3D } from "@/three/odyssey/OdysseyEmitter3D";

/** An emitter with one live particle at the origin, and only what applyWindForces reads */
function emitter(renderMode: string, matrixWorld = new THREE.Matrix4()) {
  const e: any = Object.create(OdysseyEmitter3D.prototype);
  e.node = { renderMode, flags: { affectedByWind: true } };
  e.context = undefined;
  e.offsets = new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3);
  e.props = new THREE.BufferAttribute(new Float32Array([0, 1, 1, 0]), 4);
  e.matrixWorld = matrixWorld;
  return e;
}
const moved = (e: any) => Math.hypot(e.offsets.getX(0), e.offsets.getY(0), e.offsets.getZ(0));

describe("gravity on particles", () => {
  const withGravity = (renderMode: string, mass: number, quat = new THREE.Quaternion()) => {
    const e: any = Object.create(OdysseyEmitter3D.prototype);
    e.node = { renderMode, flags: {} };
    e.mass = mass;
    e.material = { uniforms: { mass: { value: new THREE.Vector3() } } };
    e.getWorldQuaternion = (q: THREE.Quaternion) => q.copy(quat);
    e.updateGravity();
    return e.material.uniforms.mass.value as THREE.Vector3;
  };

  test("positive mass falls, negative rises, at 9.8 m/s² a unit (sparks shot straight up at a steady 5 m/s)", () => {
    expect(withGravity('Normal', 1).toArray()).toEqual([0, 0, -9.8]);
    expect(withGravity('Motion_Blur', -0.1).z).toBeCloseTo(0.98, 5);
    expect(withGravity('Normal', 0).length()).toBe(0);
  });

  test("it points at the world's floor for particles kept in the emitter's turned space", () => {
    // An emitter turned on its side: the world's down is along its own -y... whatever way, down in the world
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const local = withGravity('Billboard_to_World_Z', 1, tilt);
    const world = local.clone().applyQuaternion(tilt);
    expect(world.x).toBeCloseTo(0, 5);
    expect(world.y).toBeCloseTo(0, 5);
    expect(world.z).toBeCloseTo(-9.8, 5);
  });
});

describe("wind on particles", () => {
  test("it carries a particle at the wind's speed, not a full unit every frame (fog shot across Dantooine)", () => {
    const e = emitter('Normal');
    for (let i = 0; i < 60; i++) e.applyWindForces(1 / 60);
    // One second at wind level 1
    expect(moved(e)).toBeCloseTo(OdysseyEmitter3D.WIND_SPEED_PER_LEVEL, 5);
  });

  test("a particle kept in the emitter's space moves the same distance in the world, however the emitter is turned and scaled", () => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(50, 20, 3), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.1), new THREE.Vector3(2, 2, 2));
    const e = emitter('Billboard_to_World_Z', m);
    for (let i = 0; i < 60; i++) e.applyWindForces(1 / 60);
    const local = new THREE.Vector3(e.offsets.getX(0), e.offsets.getY(0), e.offsets.getZ(0));
    const world = local.clone().applyMatrix4(m).sub(new THREE.Vector3(0, 0, 0).applyMatrix4(m));
    expect(world.length()).toBeCloseTo(OdysseyEmitter3D.WIND_SPEED_PER_LEVEL, 5);
    // Along the area's wind axis
    expect(world.normalize().dot(new THREE.Vector3(1, 1, 0).normalize())).toBeCloseTo(1, 5);
  });
});
