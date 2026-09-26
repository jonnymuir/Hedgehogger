/**
 * Level 4's 3D renderer — a third-person chase-cam scene built from the same
 * deterministic simulation state every other level already produces
 * (obstacleX(), sprinklerState(), player/chaser state), never a second copy
 * of the game's rules. See docs/design.md's "Mechanic spec: the
 * third-dimension shift (Level 4)" for the full design rationale.
 *
 * This is the ONLY file in the repo that touches Three.js. It's a vendored,
 * pinned build checked into `js/vendor/` (`THREE_MODULE_URL` below, a
 * relative same-origin import), NOT loaded from a CDN — prismreference.com
 * (this game's deploy target) serves every response with a strict CSP
 * (`script-src 'self'`), which would silently block a cross-origin
 * `import()` outright. This was the actual cause of a real shipped bug:
 * Level 4 fell back to its plain 2D rendering path on the live site (the
 * CDN import rejected, tripping ensureRenderer3D()'s catch branch) — see
 * docs/design.md's Level 4 mechanic spec for the full story.
 *
 * The import below is still deliberately inside init() (an async method),
 * never at module top-level — the module itself is a normal, zero-cost,
 * same-origin static import (engine.js imports it unconditionally), but the
 * actual load only happens the first time init() runs, which only ever
 * happens for a `render3D` level, and only from the real hub-tap/tap-to-play
 * flow (see engine.js's ensureRenderer3D()) — never from any automated test,
 * which all drive the engine via direct state manipulation and never reach
 * that path.
 *
 * Kept deliberately asset-free (no textures, no GLTF/model pipeline) in the
 * same spirit as sprites.js's "every visual is drawn fresh from plain
 * numbers" philosophy — every mesh here is composed from primitives.
 */

const THREE_MODULE_URL = new URL('./vendor/three.module.min.js', import.meta.url);

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

// Orients a Y-aligned mesh (the default axis for Cylinder/Cone geometry) so
// it runs from `from` to `to`, positioned at their midpoint — the standard
// technique for placing a "rod" mesh along an arbitrary direction without
// fiddly per-case rotation.x/z math. The mesh's own geometry height must
// already equal the from/to distance.
function orientBetween(T, mesh, from, to) {
  const dir = new T.Vector3().subVectors(to, from);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().normalize());
}

function makeCatMesh(T, color, laneSize, relativeSize = 1) {
  // Every dimension below was originally authored against a unit (~1)
  // sphere with no reference to the level's actual grid scale at all — a
  // real bug that made both the road-obstacle cats and the chaser render
  // at roughly 1/30th their intended size (a couple of world units against
  // a laneSize=56 lane), invisible at the real gameplay chase-cam distance
  // even though it looked plausible in an up-close test shot. `scale`
  // folds laneSize in once here so every line below can stay exactly as
  // originally authored, just proportioned to the level instead of to 1.
  const scale = laneSize * 0.2 * relativeSize;
  const group = new T.Group();
  const mat = new T.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
  const stripeMat = new T.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.7 });

  const body = new T.Mesh(new T.SphereGeometry(1, 16, 12), mat);
  body.scale.set(1.1 * scale, 0.75 * scale, 1.5 * scale);
  body.position.y = 0.8 * scale;
  body.castShadow = true;
  group.add(body);

  // Tabby stripe patches — flattened dark ellipsoids hugging the back, the
  // same "a few tone-on-tone arcs" shorthand sprites.js uses in 2D.
  for (const t of [-0.5, 0, 0.55]) {
    const stripe = new T.Mesh(new T.SphereGeometry(0.32 * scale, 8, 6), stripeMat);
    stripe.scale.set(0.5, 0.18, 0.9);
    stripe.position.set(0, 1.15 * scale, t * scale);
    stripe.renderOrder = 1;
    group.add(stripe);
  }

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

    const innerEar = new T.Mesh(new T.ConeGeometry(0.12 * scale, 0.24 * scale, 8), stripeMat);
    innerEar.position.set(side * 0.3 * scale, 1.5 * scale, 1.22 * scale);
    innerEar.rotation.x = -0.3;
    group.add(innerEar);
  }

  // Face: two glowing eyes (brighter/narrower when stalking, set per-frame
  // in syncFromEngine) and a small pink nose.
  const eyeMat = new T.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffd23f, emissiveIntensity: 0.5, roughness: 0.3 });
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new T.Mesh(new T.SphereGeometry(0.07 * scale, 8, 8), eyeMat.clone());
    eye.position.set(side * 0.22 * scale, 1.22 * scale, 1.65 * scale);
    group.add(eye);
    eyes.push(eye);
  }
  const nose = new T.Mesh(new T.ConeGeometry(0.06 * scale, 0.1 * scale, 6), new T.MeshStandardMaterial({ color: 0xffb4a2, roughness: 0.5 }));
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.12 * scale, 1.72 * scale);
  group.add(nose);

  const tail = new T.Mesh(new T.CylinderGeometry(0.08 * scale, 0.14 * scale, 1.4 * scale, 8), mat);
  tail.rotation.z = Math.PI / 2.4;
  tail.position.set(0, 0.9 * scale, -1.3 * scale);
  group.add(tail);

  group.userData.eyes = eyes;
  return group;
}

function makeMowerMesh(T, obs, laneSize) {
  const group = new T.Group();
  const bodyMat = new T.MeshStandardMaterial({ color: 0xd62828, roughness: 0.45, metalness: 0.3 });
  const stripeMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.3 });
  const wheelMat = new T.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.8 });

  const bodyH = laneSize * 0.34;
  const body = new T.Mesh(new T.BoxGeometry(obs.width * 0.85, bodyH, obs.height * 0.85), bodyMat);
  body.position.y = bodyH / 2 + laneSize * 0.1;
  body.castShadow = true;
  group.add(body);

  // Deck stripe, matching the 2D sprite's translucent white band.
  const stripe = new T.Mesh(new T.BoxGeometry(obs.width * 0.78, bodyH * 0.18, obs.height * 0.87), stripeMat);
  stripe.position.y = bodyH * 0.85 + laneSize * 0.1;
  group.add(stripe);

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

  // Spinning blade hub, tucked under the front of the deck — spun in
  // syncFromEngine() the same way sprites.js rotates its 2D counterpart.
  const hubMat = new T.MeshStandardMaterial({ color: 0xdfe6e9, roughness: 0.3, metalness: 0.7 });
  const hub = new T.Mesh(new T.CylinderGeometry(laneSize * 0.09, laneSize * 0.09, laneSize * 0.03, 16), hubMat);
  hub.rotation.z = Math.PI / 2;
  hub.position.set(0, laneSize * 0.11, 0);
  group.add(hub);
  const bladeMat = new T.MeshStandardMaterial({ color: 0x636e72, roughness: 0.4, metalness: 0.6 });
  const blades = new T.Group();
  blades.position.copy(hub.position);
  for (let i = 0; i < 4; i++) {
    const blade = new T.Mesh(new T.BoxGeometry(laneSize * 0.02, laneSize * 0.16, laneSize * 0.05), bladeMat);
    blade.rotation.x = (i / 4) * Math.PI * 2;
    blades.add(blade);
  }
  group.add(blades);

  // Headlamp — a small emissive nub at the leading edge.
  const lamp = new T.Mesh(
    new T.SphereGeometry(laneSize * 0.03, 8, 6),
    new T.MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xfff3b0, emissiveIntensity: 0.8 }),
  );
  lamp.position.set(obs.width / 2 - laneSize * 0.05, bodyH / 2 + laneSize * 0.1, 0);
  group.add(lamp);

  group.userData.blades = blades;
  return group;
}

function makeLogMesh(T, obs, laneSize) {
  const barkMat = new T.MeshStandardMaterial({ color: 0x7f5539, roughness: 0.85 });
  const endMat = new T.MeshStandardMaterial({ color: 0xceb18c, roughness: 0.7 });
  const ringMat = new T.MeshStandardMaterial({ color: 0x6f4425, roughness: 0.6 });
  const mossMat = new T.MeshStandardMaterial({ color: 0x52b788, roughness: 0.9 });
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

    // A couple of concentric growth rings on each end-grain face.
    for (const r of [0.6, 0.35]) {
      const ring = new T.Mesh(new T.TorusGeometry(radius * 0.9 * r, radius * 0.05, 6, 16), ringMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.x = side * (obs.width / 2 + laneSize * 0.011);
      group.add(ring);
    }
  }

  // Moss patches, echoing sprites.js's 2D log — small flattened blobs
  // nestled onto the bark near each end.
  for (const mx of [-obs.width * 0.32, obs.width * 0.3]) {
    const moss = new T.Mesh(new T.SphereGeometry(radius * 0.35, 8, 6), mossMat);
    moss.scale.set(1.4, 0.6, 1);
    moss.position.set(mx, radius * 0.75, 0);
    group.add(moss);
  }

  group.position.y = laneSize * 0.08;
  return group;
}

function makePlayerGroup(T, laneSize) {
  const group = new T.Group();
  const radius = laneSize * 0.3;
  const bodyMat = new T.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.6 });
  const faceMat = new T.MeshStandardMaterial({ color: 0xe9c99a, roughness: 0.55 });
  const spikeMat = new T.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.7 });
  const eyeMat = new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });

  const body = new T.Mesh(new T.SphereGeometry(radius, 20, 16), bodyMat);
  body.position.y = radius;
  body.castShadow = true;
  group.add(body);

  // Face mask + ears + snout, matching sprites.js's 2D hedgehog so the two
  // renderings read as the same character, not just "a spiky ball." Local
  // -Z is "front" throughout this group (see the existing eyes below, and
  // syncFromEngine()'s rotation.y convention), so every face part sits at
  // negative z.
  const face = new T.Mesh(new T.SphereGeometry(radius * 0.68, 16, 12), faceMat);
  face.position.set(0, radius * 1.05, -radius * 0.55);
  group.add(face);

  const earMat = new T.MeshStandardMaterial({ color: 0xc98a52, roughness: 0.6 });
  for (const side of [-1, 1]) {
    const ear = new T.Mesh(new T.SphereGeometry(radius * 0.18, 10, 8), earMat);
    ear.position.set(side * radius * 0.5, radius * 1.55, -radius * 0.7);
    group.add(ear);
  }

  const snout = new T.Mesh(
    new T.SphereGeometry(radius * 0.12, 10, 8),
    new T.MeshStandardMaterial({ color: 0xe63946, roughness: 0.4 }),
  );
  snout.position.set(0, radius * 0.95, -radius * 1.12);
  group.add(snout);

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

function makeAppleMesh(T, radius) {
  const group = new T.Group();

  // Glossy red body, very slightly flattened top-to-bottom like a real
  // apple rather than a plain sphere, with a top/bottom dimple.
  const bodyMat = new T.MeshPhysicalMaterial({ color: 0xe63946, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const body = new T.Mesh(new T.SphereGeometry(radius, 20, 16), bodyMat);
  body.scale.set(1, 0.9, 1);
  body.castShadow = true;
  group.add(body);
  const dimpleMat = new T.MeshStandardMaterial({ color: 0xb3212e, roughness: 0.5 });
  const topDimple = new T.Mesh(new T.SphereGeometry(radius * 0.28, 10, 8), dimpleMat);
  topDimple.position.y = radius * 0.82;
  group.add(topDimple);

  const stem = new T.Mesh(
    new T.CylinderGeometry(radius * 0.05, radius * 0.08, radius * 0.55, 6),
    new T.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.8 }),
  );
  stem.position.set(0, radius * 1.05, 0);
  stem.rotation.z = 0.2;
  group.add(stem);

  const leaf = new T.Mesh(
    new T.SphereGeometry(radius * 0.42, 10, 8),
    new T.MeshStandardMaterial({ color: 0x2a9d8f, roughness: 0.45 }),
  );
  leaf.scale.set(1, 0.18, 0.55);
  leaf.position.set(radius * 0.32, radius * 1.15, 0);
  leaf.rotation.set(0.2, 0.7, 0.3);
  group.add(leaf);

  // A soft, fixed "shine" highlight — clearcoat alone reads too subtly at
  // this scale, so a small bright patch sells "glossy fruit" unmistakably.
  const shine = new T.Mesh(
    new T.SphereGeometry(radius * 0.22, 8, 6),
    new T.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, roughness: 0.2 }),
  );
  shine.scale.set(0.6, 1, 0.4);
  shine.position.set(-radius * 0.38, radius * 0.35, radius * 0.55);
  group.add(shine);

  return group;
}

function makeBeetleMesh(T, radius) {
  const group = new T.Group();
  const shellMat = new T.MeshPhysicalMaterial({ color: 0x2a9d8f, roughness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const darkMat = new T.MeshStandardMaterial({ color: 0x1b2a1c, roughness: 0.6 });

  const shell = new T.Mesh(new T.SphereGeometry(radius, 16, 12), shellMat);
  shell.scale.set(1, 0.62, 1.35);
  shell.castShadow = true;
  group.add(shell);

  // Seam down the middle of the shell (the fold between two wing cases).
  const seam = new T.Mesh(new T.BoxGeometry(radius * 0.035, radius * 0.6, radius * 2.55), darkMat);
  seam.position.y = radius * 0.18;
  group.add(seam);

  const head = new T.Mesh(new T.SphereGeometry(radius * 0.42, 10, 8), darkMat);
  head.position.set(0, radius * 0.1, radius * 1.15);
  group.add(head);

  const legGeo = new T.CylinderGeometry(radius * 0.035, radius * 0.03, radius * 0.65, 5);
  for (const side of [-1, 1]) {
    for (const zOff of [-0.55, 0, 0.55]) {
      const leg = new T.Mesh(legGeo, darkMat);
      orientBetween(
        T,
        leg,
        new T.Vector3(side * radius * 0.55, -radius * 0.05, zOff * radius * 0.7),
        new T.Vector3(side * radius * 1.15, -radius * 0.45, zOff * radius * 0.7),
      );
      group.add(leg);
    }
  }

  const antennaGeo = new T.CylinderGeometry(radius * 0.022, radius * 0.022, radius * 0.55, 5);
  for (const side of [-1, 1]) {
    const antenna = new T.Mesh(antennaGeo, darkMat);
    orientBetween(
      T,
      antenna,
      new T.Vector3(side * radius * 0.18, radius * 0.3, radius * 1.4),
      new T.Vector3(side * radius * 0.45, radius * 0.75, radius * 1.7),
    );
    group.add(antenna);
  }

  const shine = new T.Mesh(
    new T.SphereGeometry(radius * 0.18, 8, 6),
    new T.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, roughness: 0.2 }),
  );
  shine.scale.set(0.6, 1, 0.5);
  shine.position.set(-radius * 0.28, radius * 0.32, radius * 0.35);
  group.add(shine);

  return group;
}

// Assembled once per sprinkler; only `armsGroup.rotation` and the jet/glow
// materials change per frame (see updateSprinklerVisual()) — the geometry
// itself never rebuilds. Returns the pieces syncFromEngine()/
// updateSprinklerVisual() need, alongside the group to add to the scene.
function makeSprinklerMesh(T, laneSize) {
  const group = new T.Group();
  const metalMat = new T.MeshStandardMaterial({ color: 0xb7c2c8, roughness: 0.4, metalness: 0.6 });

  const spike = new T.Mesh(
    new T.ConeGeometry(laneSize * 0.05, laneSize * 0.14, 6),
    new T.MeshStandardMaterial({ color: 0x2f4a34, roughness: 0.8 }),
  );
  spike.position.y = laneSize * 0.07;
  group.add(spike);

  const collar = new T.Mesh(
    new T.CylinderGeometry(laneSize * 0.065, laneSize * 0.065, laneSize * 0.03, 12),
    new T.MeshStandardMaterial({ color: 0x3a5a40, roughness: 0.7 }),
  );
  collar.position.y = laneSize * 0.14;
  group.add(collar);

  const riserH = laneSize * 0.32;
  const riser = new T.Mesh(new T.CylinderGeometry(laneSize * 0.025, laneSize * 0.035, riserH, 8), metalMat);
  riser.position.y = laneSize * 0.14 + riserH / 2;
  riser.castShadow = true;
  group.add(riser);

  const headY = laneSize * 0.14 + riserH;
  const head = new T.Mesh(
    new T.SphereGeometry(laneSize * 0.09, 14, 10),
    new T.MeshStandardMaterial({ color: 0x4f6b3a, roughness: 0.55 }),
  );
  head.scale.set(1, 0.8, 1);
  head.position.y = headY;
  head.castShadow = true;
  group.add(head);

  // Three spray arms, baked 120° apart, pointing up and outward — the
  // single most sprinkler-defining shape. Only their shared parent's
  // rotation.y (a spin) changes at runtime, so the 120° spacing stays
  // rigid regardless of how fast that spin is.
  const armsGroup = new T.Group();
  armsGroup.position.y = headY;
  group.add(armsGroup);

  const armLen = laneSize * 0.22;
  const jets = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const tip = new T.Vector3(Math.cos(angle) * armLen, armLen * 0.4, Math.sin(angle) * armLen);
    const origin = new T.Vector3(0, 0, 0);

    const arm = new T.Mesh(new T.CylinderGeometry(laneSize * 0.012, laneSize * 0.012, tip.length(), 6), metalMat);
    orientBetween(T, arm, origin, tip);
    armsGroup.add(arm);

    const nozzle = new T.Mesh(new T.SphereGeometry(laneSize * 0.018, 8, 6), metalMat);
    nozzle.position.copy(tip);
    armsGroup.add(nozzle);

    const jetMat = new T.MeshStandardMaterial({
      color: 0xade8f4, emissive: 0xade8f4, emissiveIntensity: 0.6, transparent: true, opacity: 0, roughness: 0.2,
    });
    const jetLen = laneSize * 0.18;
    const jetTip = tip.clone().add(tip.clone().normalize().multiplyScalar(jetLen));
    jetTip.y = tip.y + jetLen * 0.3;
    const jet = new T.Mesh(new T.ConeGeometry(laneSize * 0.025, jetLen, 8, 1, true), jetMat);
    orientBetween(T, jet, tip, jetTip);
    armsGroup.add(jet);

    jets.push(jet);
  }

  // A soft glow sphere over the whole area, giving a rough sense of "how
  // far this is dangerous" — additive-blended and fairly small/translucent
  // on purpose so it reads as a light bloom sitting IN FRONT of the actual
  // sprinkler model, not an opaque dome that swallows it. In true 3D this
  // is a secondary cue (distance/perspective already make a literal radius
  // hard to read the way a flat top-down circle is); the primary, always-
  // legible telegraph is the arm animation + jets + point light below.
  const glow = new T.Mesh(
    new T.SphereGeometry(1, 16, 12),
    new T.MeshBasicMaterial({
      color: 0x8ecae6, transparent: true, opacity: 0.28, blending: T.AdditiveBlending, depthWrite: false,
    }),
  );
  glow.position.y = laneSize * 0.12;
  group.add(glow);

  const light = new T.PointLight(0x8ecae6, 0, laneSize * 3);
  light.position.y = headY;
  group.add(light);

  return { group, armsGroup, glowMesh: glow, jets, light };
}

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ready = false;
    this._lastResize = null;
  }

  async init(level, logicalWidth, logicalHeight, dpr) {
    const THREE = await import(THREE_MODULE_URL);
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
          const itemRadius = isApple ? laneSize * 0.15 : laneSize * 0.12;
          const mesh = isApple ? makeAppleMesh(T, itemRadius) : makeBeetleMesh(T, itemRadius);
          const baseY = isApple ? laneSize * 0.22 : laneSize * 0.14;
          mesh.position.set((item.col + 0.5) * laneSize, baseY, z);
          mesh.rotation.y = Math.random() * Math.PI * 2;
          this.worldGroup.add(mesh);
          this.itemEntries.push({ mesh, item, basePhase: Math.random() * Math.PI * 2, baseY });
        }
      }

      if (lane.type === 'ROAD') {
        for (const obs of lane.obstacles) {
          const mesh = obs.kind === 'MOWER' ? makeMowerMesh(T, obs, laneSize) : makeCatMesh(T, 0x1d1d1d, laneSize, 0.85);
          mesh.position.z = z;
          // Cats have a real face/tail (see makeCatMesh); face them the way
          // they're actually moving instead of a fixed default orientation.
          if (obs.kind !== 'MOWER') mesh.rotation.y = lane.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
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
          const { group: sprinklerGroup, armsGroup, glowMesh, jets, light } = makeSprinklerMesh(T, laneSize);
          sprinklerGroup.position.set((spr.col + 0.5) * laneSize, 0, z);
          this.worldGroup.add(sprinklerGroup);
          this.sprinklerEntries.push({ armsGroup, glowMesh, jets, light, spr });
        }
      } else if (lane.type === 'GOAL') {
        // A flush, near-black disc at ground level reads as almost nothing
        // from the chase camera's shallow, mostly-forward viewing angle —
        // a raised dirt mound gives it real silhouette/shadow, and a
        // sunken dark hole plus a few grass tufts around the rim (echoing
        // sprites.js's 2D burrow) makes it unmistakably "a burrow to reach"
        // rather than a random dark spot on the ground.
        const moundMat = new T.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.9 });
        const tuftMat = new T.MeshStandardMaterial({ color: 0x3f8d46, roughness: 0.8 });
        for (const col of level.goalCols) {
          const cx = (col + 0.5) * laneSize;
          const mound = new T.Mesh(new T.CylinderGeometry(laneSize * 0.26, laneSize * 0.3, laneSize * 0.12, 20), moundMat);
          mound.position.set(cx, laneSize * 0.06, z);
          mound.castShadow = true;
          mound.receiveShadow = true;
          this.worldGroup.add(mound);

          const hole = new T.Mesh(new T.CylinderGeometry(laneSize * 0.16, laneSize * 0.13, laneSize * 0.08, 16), burrowMat);
          hole.position.set(cx, laneSize * 0.1, z);
          this.worldGroup.add(hole);

          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            const tuft = new T.Mesh(new T.ConeGeometry(laneSize * 0.02, laneSize * 0.09, 5), tuftMat);
            tuft.position.set(cx + Math.cos(a) * laneSize * 0.27, laneSize * 0.1, z + Math.sin(a) * laneSize * 0.27);
            tuft.rotation.set((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4);
            this.worldGroup.add(tuft);
          }
        }
      }
    });

    this.playerGroup = makePlayerGroup(T, laneSize);
    this.worldGroup.add(this.playerGroup);
    this.rollBall = makeRollBallMesh(T, laneSize);
    this.worldGroup.add(this.rollBall);

    if (level.chaser) {
      this.chaserGroup = makeCatMesh(T, 0x0b0b0b, laneSize, 1.15);
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
    const { armsGroup, glowMesh, jets, light, spr } = entry;
    const laneSize = this.laneSize;
    // Mild proportional variation between differently-sized sprinklers,
    // relative to a typical configured radius — not a literal world-unit
    // size (see the glow material's own comment in makeSprinklerMesh()).
    const rFactor = spr.radius / 70;

    // The pinwheel head: idle-drifts slowly, judders while charging (the
    // same jittery `shake` idea sprites.js uses in 2D), spins fast on
    // burst — always visible in every state, so the object reads as "a
    // sprinkler" even at rest, not just once it's already dangerous.
    if (state === 'idle') {
      armsGroup.rotation.y = phaseT * 0.35;
      armsGroup.rotation.z = 0;
    } else if (state === 'charge') {
      armsGroup.rotation.y += 0.02;
      armsGroup.rotation.z = Math.sin(phaseT * 45) * 0.06;
    } else {
      armsGroup.rotation.y = phaseT * 9;
      armsGroup.rotation.z = 0;
    }

    for (const jet of jets) jet.material.opacity = 0;

    if (state === 'idle') {
      glowMesh.material.color.set(0x8ecae6);
      glowMesh.material.opacity = 0.12;
      glowMesh.scale.setScalar(laneSize * 0.09 * rFactor);
      light.intensity = 0;
    } else if (state === 'charge') {
      const pulse = 0.5 + 0.5 * Math.sin(phaseT * 18);
      glowMesh.material.color.set(0xffb703);
      glowMesh.material.opacity = 0.22 + pulse * 0.1;
      glowMesh.scale.setScalar(laneSize * (0.14 + pulse * 0.03) * rFactor);
      light.color.set(0xffb703);
      light.intensity = 1.5 + pulse;
    } else {
      glowMesh.material.color.set(0x8ecae6);
      glowMesh.material.opacity = 0.32 + Math.sin(phaseT * 10) * 0.06;
      glowMesh.scale.setScalar(laneSize * (0.26 + Math.sin(phaseT * 10) * 0.03) * rFactor);
      light.color.set(0x8ecae6);
      light.intensity = 4;
      // Each arm's own water jet, pulsing independently for a lively spray
      // rather than a uniform static cone — purely the prop selling
      // "water"; the glow sphere above still carries the actual hazard
      // radius.
      jets.forEach((jet, i) => {
        jet.material.opacity = 0.55 + 0.35 * Math.sin(phaseT * 30 + i * 2);
      });
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
      if (entry.mesh.userData.blades) entry.mesh.userData.blades.rotation.x = game.decorAge * 22;
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
      for (const eye of this.chaserGroup.userData.eyes || []) {
        eye.material.emissiveIntensity = stalking ? 1.6 : 0.4;
      }
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
