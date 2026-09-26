/**
 * Level 4's 3D renderer — a third-person chase-cam scene built from the same
 * deterministic simulation state every other level already produces
 * (obstacleX(), sprinklerState(), player/chaser state), never a second copy
 * of the game's rules. See docs/design.md's "Mechanic spec: the
 * third-dimension shift (Level 4)" for the full design rationale.
 *
 * This is the ONLY file in the repo that touches Three.js, and the CDN
 * import below is deliberately inside init() (an async method), never at
 * module top-level — the module itself is a normal, zero-cost, same-origin
 * static import (engine.js imports it unconditionally), but the actual
 * network fetch of Three.js only happens the first time init() runs, which
 * only ever happens for a `render3D` level, and only from the real
 * hub-tap/tap-to-play flow (see engine.js's ensureRenderer3D()) — never from
 * any automated test, which all drive the engine via direct state
 * manipulation and never reach that path.
 *
 * Kept deliberately asset-free (no textures, no GLTF/model pipeline) in the
 * same spirit as sprites.js's "every visual is drawn fresh from plain
 * numbers" philosophy — every mesh here is composed from primitives.
 */

const THREE_CDN_URL = 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

// Chase-camera geometry, expressed in laneSize units so it scales with any
// level's grid — see docs/design.md for the fairness rationale behind these
// specific numbers (wide FOV, generous height/lookahead, chosen to keep the
// full lane width and ~2 lanes of lookahead visible over a tighter, more
// "cinematic" lens).
const CHASE_HEIGHT_MULT = 3.2;
const CHASE_DISTANCE_MULT = 3.0;
const LOOKAHEAD_MULT = 2.5;
const CHASE_FOV = 58;
const TOPDOWN_HEIGHT_MULT = 7;
const TOPDOWN_FOV = 35;

function makeCatMesh(T, color, scale = 1) {
  const group = new T.Group();
  const mat = new T.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });

  const body = new T.Mesh(new T.SphereGeometry(1, 16, 12), mat);
  body.scale.set(1.1 * scale, 0.75 * scale, 1.5 * scale);
  body.position.y = 0.8 * scale;
  body.castShadow = true;
  group.add(body);

  const head = new T.Mesh(new T.SphereGeometry(0.6, 16, 12), mat);
  head.scale.set(scale, 0.9 * scale, 0.9 * scale);
  head.position.set(0, 1.15 * scale, 1.15 * scale);
  head.castShadow = true;
  group.add(head);

  const earGeo = new T.ConeGeometry(0.22 * scale, 0.4 * scale, 8);
  for (const side of [-1, 1]) {
    const ear = new T.Mesh(earGeo, mat);
    ear.position.set(side * 0.3 * scale, 1.55 * scale, 1.15 * scale);
    ear.rotation.x = -0.3;
    group.add(ear);
  }

  const tail = new T.Mesh(new T.CylinderGeometry(0.08 * scale, 0.14 * scale, 1.4 * scale, 8), mat);
  tail.rotation.z = Math.PI / 2.4;
  tail.position.set(0, 0.9 * scale, -1.3 * scale);
  group.add(tail);

  return group;
}

function makeMowerMesh(T, obs, laneSize) {
  const group = new T.Group();
  const bodyMat = new T.MeshStandardMaterial({ color: 0xd62828, roughness: 0.45, metalness: 0.3 });
  const wheelMat = new T.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.8 });

  const bodyH = laneSize * 0.34;
  const body = new T.Mesh(new T.BoxGeometry(obs.width * 0.85, bodyH, obs.height * 0.85), bodyMat);
  body.position.y = bodyH / 2 + laneSize * 0.1;
  body.castShadow = true;
  group.add(body);

  const wheelR = laneSize * 0.12;
  const wheelGeo = new T.CylinderGeometry(wheelR, wheelR, laneSize * 0.1, 12);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new T.Mesh(wheelGeo, wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(sx * obs.width * 0.32, wheelR, sz * obs.height * 0.32);
      wheel.castShadow = true;
      group.add(wheel);
    }
  }

  const guard = new T.Mesh(new T.BoxGeometry(obs.width * 0.95, laneSize * 0.06, obs.height * 0.3), bodyMat);
  guard.position.y = laneSize * 0.05;
  group.add(guard);

  return group;
}

function makeLogMesh(T, obs, laneSize) {
  const barkMat = new T.MeshStandardMaterial({ color: 0x7f5539, roughness: 0.85 });
  const endMat = new T.MeshStandardMaterial({ color: 0xceb18c, roughness: 0.7 });
  const radius = obs.height / 2;

  const group = new T.Group();
  const trunk = new T.Mesh(new T.CylinderGeometry(radius, radius, obs.width, 14), barkMat);
  trunk.rotation.z = Math.PI / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  for (const side of [-1, 1]) {
    const cap = new T.Mesh(new T.CylinderGeometry(radius * 0.92, radius * 0.92, laneSize * 0.02, 14), endMat);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = side * (obs.width / 2);
    group.add(cap);
  }

  group.position.y = laneSize * 0.08;
  return group;
}

function makePlayerGroup(T, laneSize) {
  const group = new T.Group();
  const radius = laneSize * 0.3;
  const bodyMat = new T.MeshStandardMaterial({ color: 0xcaa472, roughness: 0.6 });
  const spikeMat = new T.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.7 });
  const eyeMat = new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });

  const body = new T.Mesh(new T.SphereGeometry(radius, 20, 16), bodyMat);
  body.position.y = radius;
  body.castShadow = true;
  group.add(body);

  // Golden-angle spiral over the back/upper hemisphere (kept off the face)
  // so spike coverage looks natural without hand-authoring each one.
  const spikeCount = 26;
  const spikeGeo = new T.ConeGeometry(radius * 0.16, radius * 0.65, 6);
  const spikes = new T.InstancedMesh(spikeGeo, spikeMat, spikeCount);
  spikes.castShadow = true;
  const dummy = new T.Object3D();
  for (let i = 0; i < spikeCount; i++) {
    const t = i / spikeCount;
    const phi = Math.acos(1 - t * 1.15);
    const theta = i * 2.399963;
    const dir = new T.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta) - 0.25,
    ).normalize();
    const pos = dir.clone().multiplyScalar(radius).add(new T.Vector3(0, radius, 0));
    dummy.position.copy(pos);
    dummy.lookAt(pos.clone().add(dir));
    dummy.updateMatrix();
    spikes.setMatrixAt(i, dummy.matrix);
  }
  group.add(spikes);

  for (const side of [-1, 1]) {
    const eye = new T.Mesh(new T.SphereGeometry(radius * 0.09, 8, 8), eyeMat);
    eye.position.set(side * radius * 0.32, radius * 1.1, -radius * 0.85);
    group.add(eye);
  }

  return group;
}

function makeRollBallMesh(T, laneSize) {
  const radius = laneSize * 0.3;
  const mat = new T.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.5, metalness: 0.1 });
  const mesh = new T.Mesh(new T.IcosahedronGeometry(radius, 1), mat);
  mesh.castShadow = true;
  mesh.position.y = radius;
  mesh.visible = false;
  return mesh;
}

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ready = false;
    this._lastResize = null;
  }

  async init(level, logicalWidth, logicalHeight, dpr) {
    const THREE = await import(THREE_CDN_URL);
    this.THREE = THREE;
    this.laneSize = level.laneSize;
    this.gridWidth = level.cols * level.laneSize;
    this.gridHeight = level.rows * level.laneSize;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d130e);
    this.scene.fog = new THREE.Fog(0x0d130e, this.laneSize * 5, this.laneSize * 18);

    this.hemiLight = new THREE.HemisphereLight(0x3a4a66, 0x0d1a10, 0.65);
    this.scene.add(this.hemiLight);

    // Moonlight — position/target re-aimed at the player every frame in
    // syncFromEngine() so its shadow-camera window (fixed here, relative to
    // the light) follows the player up a level far taller than any single
    // screen, without re-fitting the frustum bounds every frame.
    this.dirLight = new THREE.DirectionalLight(0xbfd4ff, 3.0);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(1024, 1024);
    this.dirLight.shadow.camera.near = this.laneSize;
    this.dirLight.shadow.camera.far = this.laneSize * 24;
    this.dirLight.shadow.camera.left = -this.laneSize * 6;
    this.dirLight.shadow.camera.right = this.laneSize * 6;
    this.dirLight.shadow.camera.top = this.laneSize * 9;
    this.dirLight.shadow.camera.bottom = -this.laneSize * 9;
    this.dirLight.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    this.camera = new THREE.PerspectiveCamera(CHASE_FOV, logicalWidth / logicalHeight, 0.5, this.laneSize * 60);

    this.buildLevel(level);

    const resize = this._lastResize || { logicalWidth, logicalHeight, dpr };
    this.handleResize(resize.logicalWidth, resize.logicalHeight, resize.dpr);

    this.ready = true;
  }

  buildLevel(level) {
    const T = this.THREE;
    this.worldGroup = new T.Group();
    this.scene.add(this.worldGroup);

    this.obstacleEntries = [];
    this.sprinklerEntries = [];
    this.itemEntries = [];

    const laneSize = level.laneSize;
    const grassMats = [
      new T.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.95 }),
      new T.MeshStandardMaterial({ color: 0x264d3b, roughness: 0.95 }),
    ];
    const roadMat = new T.MeshStandardMaterial({ color: 0x33363a, roughness: 0.9 });
    const riverMat = new T.MeshPhysicalMaterial({
      color: 0x146a8c, roughness: 0.15, metalness: 0.1, transmission: 0.55, thickness: laneSize * 0.3, ior: 1.33,
    });
    const goalMat = new T.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.95 });
    const burrowMat = new T.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 });
    const groundGeo = new T.PlaneGeometry(this.gridWidth, laneSize);

    level.lanes.forEach((lane, row) => {
      const z = -(row + 0.5) * laneSize;

      let mat;
      if (lane.type === 'SAFE') mat = grassMats[row % 2];
      else if (lane.type === 'ROAD') mat = roadMat;
      else if (lane.type === 'RIVER') mat = riverMat;
      else if (lane.type === 'SPRINKLER') mat = grassMats[1];
      else mat = goalMat;

      const ground = new T.Mesh(groundGeo, mat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(this.gridWidth / 2, 0, z);
      ground.receiveShadow = true;
      this.worldGroup.add(ground);

      if (lane.items) {
        for (const item of lane.items) {
          const isApple = item.type === 'APPLE';
          const geo = isApple ? new T.SphereGeometry(laneSize * 0.13, 12, 10) : new T.SphereGeometry(laneSize * 0.1, 10, 8);
          const itemMat = new T.MeshStandardMaterial({ color: isApple ? 0xe63946 : 0x2a9d8f, roughness: 0.4 });
          const mesh = new T.Mesh(geo, itemMat);
          mesh.castShadow = true;
          mesh.position.set((item.col + 0.5) * laneSize, laneSize * 0.22, z);
          this.worldGroup.add(mesh);
          this.itemEntries.push({ mesh, item, basePhase: Math.random() * Math.PI * 2, baseY: laneSize * 0.22 });
        }
      }

      if (lane.type === 'ROAD') {
        for (const obs of lane.obstacles) {
          const mesh = obs.kind === 'MOWER' ? makeMowerMesh(T, obs, laneSize) : makeCatMesh(T, 0x1d1d1d, 0.85);
          mesh.position.z = z;
          this.worldGroup.add(mesh);
          this.obstacleEntries.push({ mesh, lane, obs });
        }
      } else if (lane.type === 'RIVER') {
        for (const obs of lane.obstacles) {
          const mesh = makeLogMesh(T, obs, laneSize);
          mesh.position.z = z;
          this.worldGroup.add(mesh);
          this.obstacleEntries.push({ mesh, lane, obs });
        }
      } else if (lane.type === 'SPRINKLER') {
        for (const spr of lane.sprinklers) {
          const postMat = new T.MeshStandardMaterial({ color: 0x778da9, roughness: 0.5, metalness: 0.4 });
          const post = new T.Mesh(new T.CylinderGeometry(laneSize * 0.04, laneSize * 0.05, laneSize * 0.4, 10), postMat);
          post.position.set((spr.col + 0.5) * laneSize, laneSize * 0.2, z);
          post.castShadow = true;
          this.worldGroup.add(post);

          const glowMat = new T.MeshStandardMaterial({ color: 0x8ecae6, emissive: 0x8ecae6, emissiveIntensity: 0.15, roughness: 0.3 });
          const glow = new T.Mesh(new T.SphereGeometry(laneSize * 0.16, 14, 12), glowMat);
          glow.position.set((spr.col + 0.5) * laneSize, laneSize * 0.42, z);
          this.worldGroup.add(glow);

          const light = new T.PointLight(0x8ecae6, 0, laneSize * 3);
          light.position.copy(glow.position);
          this.worldGroup.add(light);

          this.sprinklerEntries.push({ glowMesh: glow, light, spr });
        }
      } else if (lane.type === 'GOAL') {
        for (const col of level.goalCols) {
          const burrow = new T.Mesh(new T.CylinderGeometry(laneSize * 0.22, laneSize * 0.22, laneSize * 0.06, 20), burrowMat);
          burrow.position.set((col + 0.5) * laneSize, laneSize * 0.03, z);
          this.worldGroup.add(burrow);
        }
      }
    });

    this.playerGroup = makePlayerGroup(T, laneSize);
    this.worldGroup.add(this.playerGroup);
    this.rollBall = makeRollBallMesh(T, laneSize);
    this.worldGroup.add(this.rollBall);

    if (level.chaser) {
      this.chaserGroup = makeCatMesh(T, 0x0b0b0b, 1.15);
      this.worldGroup.add(this.chaserGroup);
    }
  }

  // World-pixel coordinates (the same ones engine.js already computes for
  // every level) map onto the scene with x unchanged and z = worldY -
  // gridHeight — this lines up exactly with each lane's ground-plane z
  // (-(row+0.5)*laneSize) computed in buildLevel() above, so obstacles,
  // player and chaser all share one consistent coordinate space with zero
  // extra bookkeeping.
  worldToScenePos(game, worldX, worldY) {
    return { x: worldX, y: 0, z: worldY - game.gridHeight };
  }

  // Both poses (and every distance/fov constant) live here so the
  // flat-2D->3D cinematic blend in engine.js and the ongoing gameplay camera
  // below share exactly one definition of "what the chase camera looks
  // like" — see docs/design.md for why these particular numbers were chosen.
  getTopDownPose(game) {
    const p = game.player;
    const scene = this.worldToScenePos(game, p.x, p.y);
    return {
      pos: { x: scene.x, y: game.laneSize * TOPDOWN_HEIGHT_MULT, z: scene.z + game.laneSize * 0.5 },
      lookAt: { x: scene.x, y: 0, z: scene.z },
      fov: TOPDOWN_FOV,
    };
  }

  getChasePose(game) {
    const p = game.player;
    const scene = this.worldToScenePos(game, p.visualX, p.visualY);
    const laneSize = game.laneSize;
    return {
      pos: { x: scene.x, y: laneSize * CHASE_HEIGHT_MULT, z: scene.z + laneSize * CHASE_DISTANCE_MULT },
      lookAt: { x: scene.x, y: 0, z: scene.z - laneSize * LOOKAHEAD_MULT },
      fov: CHASE_FOV,
    };
  }

  setCameraPose(pos, lookAt, fov) {
    this.camera.position.set(pos.x, pos.y, pos.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
    if (fov !== undefined && Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  updateSprinklerVisual(entry, state, phaseT) {
    const { glowMesh, light } = entry;
    if (state === 'idle') {
      glowMesh.material.color.set(0x8ecae6);
      glowMesh.material.emissive.set(0x8ecae6);
      glowMesh.material.emissiveIntensity = 0.15;
      glowMesh.scale.setScalar(0.6);
      light.intensity = 0;
    } else if (state === 'charge') {
      const pulse = 0.5 + 0.5 * Math.sin(phaseT * 18);
      glowMesh.material.color.set(0xffb703);
      glowMesh.material.emissive.set(0xffb703);
      glowMesh.material.emissiveIntensity = 1.2 + pulse * 0.8;
      glowMesh.scale.setScalar(0.75 + pulse * 0.15);
      light.color.set(0xffb703);
      light.intensity = 1.5 + pulse;
    } else {
      glowMesh.material.color.set(0x8ecae6);
      glowMesh.material.emissive.set(0x8ecae6);
      glowMesh.material.emissiveIntensity = 2.4;
      glowMesh.scale.setScalar(1.6);
      light.color.set(0x8ecae6);
      light.intensity = 4;
    }
  }

  // Called once per frame for every state after the transition (PLAYING,
  // DEATH_ANIM, LEVEL_COMPLETE, GAMEOVER) — reads exactly the same pure
  // obstacleX()/sprinklerState()/chaser-state the 2D renderer reads, just
  // mapped into 3D. Also owns the ongoing gameplay camera (via
  // getChasePose()), so there is no separate "gameplay camera" code path.
  syncFromEngine(game) {
    const p = game.player;
    const scenePlayer = this.worldToScenePos(game, p.visualX, p.visualY);
    this.playerGroup.position.set(scenePlayer.x, p.jumpZ, scenePlayer.z);
    if (p.moveDir.x || p.moveDir.y) {
      // Three.js rotation.y=0 faces -Z; this maps our (moveDir.x, moveDir.y)
      // direction (moveDir.y already shares our z-axis sign convention, see
      // worldToScenePos) onto that default forward.
      this.playerGroup.rotation.y = Math.atan2(-p.moveDir.x, -p.moveDir.y);
    }
    this.playerGroup.visible = !p.isRolling;
    this.rollBall.visible = p.isRolling;
    if (p.isRolling) {
      this.rollBall.position.set(scenePlayer.x, p.jumpZ, scenePlayer.z);
      this.rollBall.rotation.z = game.decorAge * 14;
    }

    for (const entry of this.obstacleEntries) {
      const x = game.obstacleX(entry.lane, entry.obs);
      entry.mesh.position.x = x + entry.obs.width / 2;
    }

    for (const entry of this.sprinklerEntries) {
      const { state, phaseT } = game.sprinklerState(entry.spr);
      this.updateSprinklerVisual(entry, state, phaseT);
    }

    for (const entry of this.itemEntries) {
      entry.mesh.visible = !entry.item.collected;
      if (!entry.item.collected) {
        entry.mesh.position.y = entry.baseY + Math.sin(game.decorAge * 3 + entry.basePhase) * game.laneSize * 0.04;
      }
    }

    if (game.chaser && this.chaserGroup) {
      const cfg = game.level.chaser;
      const ch = game.chaser;
      const worldY = game.gridHeight - (ch.row + 0.5) * game.laneSize;
      const worldX = (ch.col + 0.5) * game.colWidth;
      const scenePos = this.worldToScenePos(game, worldX, worldY);
      this.chaserGroup.position.set(scenePos.x, 0, scenePos.z);
      const stalking = ch.idleTime > cfg.idleGrace && game.player.laneIndex - ch.row <= cfg.prowlRange;
      this.chaserGroup.scale.set(1, stalking ? 0.68 : 1, 1);
    }

    this.dirLight.position.set(scenePlayer.x - game.laneSize * 4, game.laneSize * 8, scenePlayer.z + game.laneSize * 6);
    this.dirLight.target.position.set(scenePlayer.x, 0, scenePlayer.z);
    this.dirLight.target.updateMatrixWorld();

    const chasePose = this.getChasePose(game);
    this.setCameraPose(chasePose.pos, chasePose.lookAt, chasePose.fov);
  }

  renderFrame() {
    this.renderer.render(this.scene, this.camera);
  }

  handleResize(logicalWidth, logicalHeight, dpr) {
    this._lastResize = { logicalWidth, logicalHeight, dpr };
    if (!this.renderer) return;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(logicalWidth, logicalHeight, false);
    this.camera.aspect = logicalWidth / logicalHeight;
    this.camera.updateProjectionMatrix();
  }
}
