import * as THREE from "three";

export function createGameScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.setSize(window.innerWidth, window.innerHeight); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(0x142a38, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x142a38); scene.fog = new THREE.Fog(0x142a38, 115, 225);
  const camera = new THREE.PerspectiveCamera(53, window.innerWidth / window.innerHeight, 0.1, 600); camera.position.set(0, 92, -38); camera.lookAt(0, 0, 0);
  return { renderer, scene, camera };
}
