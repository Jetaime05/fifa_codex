import * as THREE from "three";

// Compatibility facade: each presentation feature owns its own lifecycle.
export { createPlayerVisual } from "./PlayerPresentation";
export { addPitch } from "./StadiumPresentation";
export const FIELD_WIDTH = 72;
export const FIELD_LENGTH = 112;
export const HALF_W = FIELD_WIDTH / 2;
export const HALF_L = FIELD_LENGTH / 2;
export const GOAL_WIDTH = 13.5;
export const GOAL_DEPTH = 4.5;

export function createBallVisual(radius: number) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), new THREE.MeshStandardMaterial({ color: 0xf8faf2, roughness: 0.52 }));
  const panelSource = new THREE.IcosahedronGeometry(1, 0);
  const panels = panelSource.getAttribute("position");
  const used = new Set<string>();
  const patchGeometry = new THREE.CircleGeometry(radius * 0.23, 5);
  const patchMaterial = new THREE.MeshStandardMaterial({ color: 0x14253a, roughness: 0.55 });
  for (let index = 0; index < panels.count; index++) {
    const direction = new THREE.Vector3().fromBufferAttribute(panels, index).normalize();
    const key = direction.toArray().map(value => value.toFixed(3)).join(",");
    if (used.has(key)) continue;
    used.add(key);
    const patch = new THREE.Mesh(patchGeometry, patchMaterial);
    patch.position.copy(direction).multiplyScalar(radius + 0.003);
    patch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    mesh.add(patch);
  }
  panelSource.dispose();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
