import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';

// VGGT reconstruction scale is arbitrary. 4.8 makes the reconstructed room human-scale.
const SCENE_SCALE_METERS = 4.8;
const WALK_SPEED = 0.45; // meters/sec: deliberately slow for comfort.
const TURN_SPEED = 1.15; // radians/sec

const status = document.querySelector('#status');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070c);
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.02, 100);
const player = new THREE.Group();
player.add(camera);
scene.add(player);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.4, 0);
controls.maxDistance = 15;
controls.minDistance = 0.15;

let homePosition = new THREE.Vector3(0, 0, 3.7);
let homeTarget = new THREE.Vector3(0, 1.4, 0);
let elapsedLast = 0;
const controllerButtonState = new WeakMap();

function resetHome() {
  player.position.copy(homePosition);
  player.rotation.set(0, 0, 0);
  camera.position.set(0, 1.6, 0);
  if (!renderer.xr.isPresenting) {
    controls.target.copy(homeTarget);
    controls.update();
  }
}
document.querySelector('#home').addEventListener('click', resetHome);
window.addEventListener('keydown', (event) => { if (event.key.toLowerCase() === 'h') resetHome(); });

const loader = new GLTFLoader();
loader.load('./dungeon_omega.glb', (gltf) => {
  const model = gltf.scene;
  let pointCount = 0;
  let markerCount = 0;

  model.traverse((object) => {
    if (object.isPoints) {
      pointCount += object.geometry.attributes.position.count;
      // Preserve COLOR_0 explicitly; GLB's mesh material is not a point material.
      object.material = new THREE.PointsMaterial({
        size: 0.012, sizeAttenuation: true, vertexColors: true,
        depthTest: true, depthWrite: true, transparent: false
      });
    }
    // The 21 processed, indexed triangle meshes are VGGT camera frusta, not room data.
    if (object.isMesh && object.userData.processed === true) {
      object.visible = false;
      markerCount++;
    }
  });

  // Camera frusta are hidden above, but Box3 still includes invisible objects.
  // Ground the room from the actual colored reconstruction only.
  model.updateMatrixWorld(true);
  const pointBounds = new THREE.Box3();
  model.traverse((object) => {
    if (object.isPoints) pointBounds.expandByObject(object);
  });
  // VGGT leaves a few sparse points below the dense floor. Choose the lowest
  // occupied 10% of the point cloud rather than the single lowest outlier.
  const FLOOR_QUANTILE = 0.10;
  const FLOOR_BINS = 2048;
  const floorHistogram = new Uint32Array(FLOOR_BINS);
  const floorRange = pointBounds.max.y - pointBounds.min.y;
  model.traverse((object) => {
    if (!object.isPoints) return;
    const positions = object.geometry.attributes.position;
    const elements = object.matrixWorld.elements;
    for (let index = 0; index < positions.count; index++) {
      const localIndex = index * positions.itemSize;
      const worldY = elements[1] * positions.array[localIndex] + elements[5] * positions.array[localIndex + 1] + elements[9] * positions.array[localIndex + 2] + elements[13];
      const bin = Math.min(FLOOR_BINS - 1, Math.max(0, Math.floor((worldY - pointBounds.min.y) / floorRange * FLOOR_BINS)));
      floorHistogram[bin]++;
    }
  });
  const floorTarget = pointCount * FLOOR_QUANTILE;
  let accumulated = 0;
  let floorBin = 0;
  for (; floorBin < FLOOR_BINS - 1; floorBin++) {
    accumulated += floorHistogram[floorBin];
    if (accumulated >= floorTarget) break;
  }
  const floorY = pointBounds.min.y + (floorBin + 0.5) / FLOOR_BINS * floorRange;
  model.scale.setScalar(SCENE_SCALE_METERS);
  model.position.set(-pointBounds.getCenter(new THREE.Vector3()).x * SCENE_SCALE_METERS,
    -floorY * SCENE_SCALE_METERS, -pointBounds.getCenter(new THREE.Vector3()).z * SCENE_SCALE_METERS);
  scene.add(model);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  // Start just inside the open/front side of the cloud, not outside its whole depth.
  homePosition.set(0, 0, Math.max(size.z * 0.32, 1.8));
  homeTarget.set(0, Math.min(1.5, size.y * 0.58), 0);
  resetHome();
  status.textContent = `${pointCount.toLocaleString()} colored points · ${markerCount} camera markers hidden · ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} m`;
}, undefined, (error) => {
  console.error(error);
  status.textContent = 'Could not load dungeon_omega.glb. Serve this folder over HTTP (see README).';
});

function moveFromControllers(dt) {
  if (!renderer.xr.isPresenting) return;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  for (const source of renderer.xr.getSession().inputSources) {
    const axes = source.gamepad?.axes;
    if (!axes || axes.length < 2) continue;
    const x = Math.abs(axes[0]) > 0.15 ? axes[0] : 0;
    const y = Math.abs(axes[1]) > 0.15 ? axes[1] : 0;
    // A/X is the third face button on Quest Touch controllers. Trigger only on press.
    const wasResetPressed = controllerButtonState.get(source) ?? false;
    const isResetPressed = source.gamepad.buttons[3]?.pressed ?? false;
    if (isResetPressed && !wasResetPressed) resetHome();
    controllerButtonState.set(source, isResetPressed);
    if (source.handedness === 'right') player.rotation.y -= x * TURN_SPEED * dt;
    else player.position.addScaledVector(right, x * WALK_SPEED * dt).addScaledVector(forward, -y * WALK_SPEED * dt);
  }
}

renderer.xr.addEventListener('sessionstart', () => { controls.enabled = false; resetHome(); });
renderer.xr.addEventListener('sessionend', () => { controls.enabled = true; resetHome(); });
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight);
});
renderer.setAnimationLoop((time) => {
  const dt = Math.min((time - elapsedLast) / 1000 || 0, 0.1); elapsedLast = time;
  moveFromControllers(dt);
  if (!renderer.xr.isPresenting) controls.update();
  renderer.render(scene, camera);
});
