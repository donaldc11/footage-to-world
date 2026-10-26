import * as THREE from 'three';
import {
  BuildingSpec,
  FoliageZoneSpec,
  PropSpec,
  RoadOrPathSpec,
  SceneBlueprint,
  WaterOrPoolSpec,
} from '../types/world';

// The Sacramento River flows diagonally across the scene from NW to SE
export const RIVER_ANGLE = -0.58; // ~ -33.2°
// Tower Bridge is oriented perpendicular to the river channel, spanning straight across the water
export const BRIDGE_ANGLE = RIVER_ANGLE + Math.PI / 2; // ~ +56.8°
export const RIVER_WIDTH = 32;
export const RIVER_WATER_Y = -0.95;

export const DEFAULT_INITIAL_BLUEPRINT: SceneBlueprint = {
  sceneSummary:
    'Neutral terrain landscape awaiting drone video frame extraction and procedural 3D reconstruction.',
  skyColor: '#38bdf8',
  horizonColor: '#bae6fd',
  groundColor: '#3f6212',
  secondaryGroundColor: '#4d7c0f',
  terrainRoughness: 0.5,
  terrainHillHeight: 0.25,
  terrainSlopeX: 0.002,
  terrainSlopeZ: -0.003,
  sunAzimuthDeg: 140,
  sunElevationDeg: 48,
  sunIntensity: 2.0,
  sunColor: '#fffbeb',
  buildings: [],
  waterBodies: [],
  roadsAndPaths: [],
  foliageZones: [],
  props: [],
  vantages: {
    droneMatch: { position: [24, 20, 28], target: [0, 2, 0] },
    poolAngle: { position: [16, 4.5, 12], target: [0, 3, 0] },
    backLot: { position: [-20, 8, -20], target: [0, 2.5, 0] },
    roadView: { position: [20, 4.2, 18], target: [0, 3, 0] },
  },
};

function createProceduralGroundTexture(primaryHex: string, secondaryHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = primaryHex || '#3f6212';
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = secondaryHex || '#4d7c0f';
  for (let i = 0; i < 900; i++) {
    const x = (i * 73) % 256;
    const y = (i * 137) % 256;
    const r = 2 + (i % 6);
    ctx.globalAlpha = 0.14;
    ctx.fillRect(x, y, r, r);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let g = 0; g < 256; g += 32) {
    ctx.beginPath();
    ctx.moveTo(g, 0);
    ctx.lineTo(g, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, g);
    ctx.lineTo(256, g);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  return tex;
}

function createWaterWaveTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0a3a48';
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = '#145a6c';
  for (let y = 0; y < 256; y += 4) {
    ctx.beginPath();
    for (let x = 0; x < 256; x += 8) {
      const offset = Math.sin(x * 0.08 + y * 0.12) * 2.2;
      ctx.fillRect(x, y + offset, 6, 1.8);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 32);
  return tex;
}

export function createSceneHelpers(scene: THREE.Scene, maxAnisotropy = 4) {
  let activeBlueprint: SceneBlueprint = DEFAULT_INITIAL_BLUEPRINT;

  // Signed perpendicular distance from (x, z) to the diagonal river centerline
  const distToRiverLine = (x: number, z: number, angle = RIVER_ANGLE, riverX = 0, riverZ = 0): number => {
    const nx = Math.sin(angle);
    const nz = -Math.cos(angle);
    return (x - riverX) * nx + (z - riverZ) * nz;
  };

  const groundHeightAt = (x: number, z: number): number => {
    const bp = activeBlueprint;
    const riverSpec = bp.waterBodies?.find((w) => w.type === 'river' || w.type === 'channel');
    const hasRiver = !!riverSpec;

    let baseHeight = 0.5;

    // Outer boundary gentle terrain rolling
    const distFromCenter = Math.sqrt(x * x + z * z);
    const outerFactor = THREE.MathUtils.smoothstep(distFromCenter, 28, 85);
    baseHeight +=
      Math.sin(x * 0.05) * Math.cos(z * 0.05) * (bp.terrainHillHeight || 0.4) * outerFactor +
      (x * (bp.terrainSlopeX || 0) + z * (bp.terrainSlopeZ || 0)) * outerFactor;

    if (hasRiver && riverSpec) {
      const riverAng = typeof riverSpec.rotationY === 'number' ? riverSpec.rotationY : RIVER_ANGLE;
      const riverW = Math.max(16, riverSpec.width || RIVER_WIDTH);
      const absDist = Math.abs(distToRiverLine(x, z, riverAng, riverSpec.x || 0, riverSpec.z || 0));
      const halfW = riverW / 2;
      const bankSlope = 9.0;

      if (absDist < halfW) {
        // Deep sunken riverbed under water surface
        return -2.4;
      } else if (absDist < halfW + bankSlope) {
        // Sloping river levee bank rising up to ground level
        const t = (absDist - halfW) / bankSlope;
        const smoothT = THREE.MathUtils.smoothstep(t, 0, 1);
        return THREE.MathUtils.lerp(-2.4, baseHeight, smoothT);
      }
    }

    return baseHeight;
  };

  const buildTerrain = (bp: SceneBlueprint) => {
    const geo = new THREE.PlaneGeometry(240, 240, 84, 84);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      pos.setY(i, groundHeightAt(vx, vz));
    }
    geo.computeVertexNormals();

    const groundTex = createProceduralGroundTexture(bp.groundColor, bp.secondaryGroundColor);
    groundTex.anisotropy = maxAnisotropy;

    const mat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: THREE.MathUtils.clamp(bp.terrainRoughness ?? 0.82, 0.35, 0.98),
      metalness: 0.04,
    });

    const terrainMesh = new THREE.Mesh(geo, mat);
    terrainMesh.receiveShadow = true;
    terrainMesh.name = 'procedural_terrain';
    scene.add(terrainMesh);
    return terrainMesh;
  };

  // Requirement 1: Render the river as a diagonal channel crossing under the bridge, not a rectangle, with banks following the frame
  const addRiverChannel = (wb: WaterOrPoolSpec) => {
    const group = new THREE.Group();
    group.name = `river_channel_${wb.id}`;

    const channelWidth = Math.max(20, wb.width || RIVER_WIDTH);
    const channelLength = Math.max(160, wb.depth || 260);

    // 1. Water Surface (Diagonal Ribbon)
    const waterGeo = new THREE.PlaneGeometry(channelWidth, channelLength, 16, 64);
    waterGeo.rotateX(-Math.PI / 2);

    const waveTex = createWaterWaveTexture();
    waveTex.anisotropy = maxAnisotropy;

    const waterMat = new THREE.MeshPhysicalMaterial({
      color: wb.waterColor || '#0e4a5a',
      roughness: 0.12,
      metalness: 0.22,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      transparent: true,
      opacity: 0.94,
      map: waveTex,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = RIVER_WATER_Y; // -0.95
    waterMesh.receiveShadow = true;
    group.add(waterMesh);

    // 2. Continuous Riverbank Embankments following both edges of the diagonal channel
    const bankMaterial = new THREE.MeshStandardMaterial({
      color: '#475569', // River rock riprap / levee concrete
      roughness: 0.92,
      metalness: 0.05,
    });

    const leveeGreenMat = new THREE.MeshStandardMaterial({
      color: '#2d5a27', // Shoreline reeds / levee grass
      roughness: 0.85,
    });

    for (const side of [-1, 1]) {
      const bankOffset = side * (channelWidth / 2 + 1.2);

      // Sloping rock riprap bank
      const riprapGeo = new THREE.BoxGeometry(2.4, 1.4, channelLength);
      const riprap = new THREE.Mesh(riprapGeo, bankMaterial);
      riprap.position.set(bankOffset, -0.4, 0);
      riprap.rotation.z = side * 0.28;
      riprap.receiveShadow = true;
      group.add(riprap);

      // Levee crest promenade path
      const leveeWalkGeo = new THREE.BoxGeometry(3.2, 0.25, channelLength);
      const leveeWalk = new THREE.Mesh(leveeWalkGeo, leveeGreenMat);
      leveeWalk.position.set(side * (channelWidth / 2 + 3.8), 0.45, 0);
      leveeWalk.receiveShadow = true;
      group.add(leveeWalk);

      // Promenade riverside railings
      const railingMat = new THREE.MeshStandardMaterial({
        color: '#1e293b',
        roughness: 0.5,
        metalness: 0.6,
      });
      const railGeo = new THREE.BoxGeometry(0.12, 0.75, channelLength);
      const rail = new THREE.Mesh(railGeo, railingMat);
      rail.position.set(side * (channelWidth / 2 + 2.2), 0.95, 0);
      group.add(rail);
    }

    // Position and rotate the river diagonally
    group.position.set(wb.x || 0, 0, wb.z || 0);
    group.rotation.y = wb.rotationY || RIVER_ANGLE;
    scene.add(group);
    return group;
  };

  const addStandardWaterBody = (wb: WaterOrPoolSpec) => {
    const group = new THREE.Group();
    group.name = `water_${wb.id}`;
    const w = Math.max(2.5, wb.width || 10);
    const d = Math.max(2.5, wb.depth || 5);
    const baseY = groundHeightAt(wb.x || 0, wb.z || 0);

    if (wb.hasDeck !== false) {
      const deckGeo = new THREE.BoxGeometry(w + 3.2, 0.16, d + 3.2);
      const deckMat = new THREE.MeshStandardMaterial({
        color: wb.deckColor || '#d6d3d1',
        roughness: 0.78,
        metalness: 0.05,
      });
      const deck = new THREE.Mesh(deckGeo, deckMat);
      deck.position.y = 0.08;
      deck.receiveShadow = true;
      group.add(deck);
    }

    const rimGeo = new THREE.BoxGeometry(w + 0.5, 0.22, d + 0.5);
    const rimMat = new THREE.MeshStandardMaterial({
      color: '#f5f5f4',
      roughness: 0.5,
      metalness: 0.1,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.y = 0.11;
    group.add(rim);

    const waterGeo = new THREE.PlaneGeometry(w, d);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshPhysicalMaterial({
      color: wb.waterColor || '#0284c7',
      roughness: 0.08,
      metalness: 0.15,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = 0.23;
    water.receiveShadow = true;
    group.add(water);

    group.position.set(wb.x || 0, baseY + 0.02, wb.z || 0);
    group.rotation.y = wb.rotationY || 0;
    scene.add(group);
    return group;
  };

  const addWaterBody = (wb: WaterOrPoolSpec) => {
    if (wb.type === 'river' || wb.type === 'channel') {
      return addRiverChannel(wb);
    }
    return addStandardWaterBody(wb);
  };

  // Requirement 2: Rotate Tower Bridge so it spans the river, with an open truss between the towers
  const addTowerBridge = (spec?: Partial<PropSpec>) => {
    const group = new THREE.Group();
    group.name = `prop_${spec?.id || 'tower_bridge'}`;

    const bridgeLength = Math.max(65, spec?.depth || 76);
    const deckWidth = Math.max(7.5, spec?.width || 8.8);
    const towerHeight = Math.max(18, spec?.height || 24);
    const deckY = 2.45; // Height of roadway over water

    const goldColor = spec?.color || '#eab308'; // Sacramento Tower Bridge Golden Ochre
    const bridgeGoldMat = new THREE.MeshStandardMaterial({
      color: goldColor,
      roughness: 0.42,
      metalness: 0.65,
    });

    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: '#334155',
      roughness: 0.5,
      metalness: 0.7,
    });

    const pierConcreteMat = new THREE.MeshStandardMaterial({
      color: '#94a3b8',
      roughness: 0.9,
      metalness: 0.08,
    });

    const roadAsphaltMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.88,
      metalness: 0.05,
    });

    const stripeYellowMat = new THREE.MeshStandardMaterial({
      color: '#fbbf24',
      roughness: 0.4,
    });

    const stripeWhiteMat = new THREE.MeshStandardMaterial({
      color: '#f8fafc',
      roughness: 0.4,
    });

    // 1. Concrete River Piers grounded into the riverbed supporting the two lift towers
    const pierDist = 13.5;
    for (const px of [-pierDist, pierDist]) {
      const pierGeo = new THREE.BoxGeometry(5.2, 5.2, deckWidth + 3.8);
      const pier = new THREE.Mesh(pierGeo, pierConcreteMat);
      pier.position.set(px, 0.4, 0);
      pier.castShadow = true;
      pier.receiveShadow = true;
      group.add(pier);

      // Aerodynamic Cutwater nose in the water
      const cutwaterGeo = new THREE.CylinderGeometry(1.6, 2.2, 4.8, 4);
      cutwaterGeo.rotateY(Math.PI / 4);
      const cutwater1 = new THREE.Mesh(cutwaterGeo, pierConcreteMat);
      cutwater1.position.set(px, 0.4, (deckWidth + 3.8) / 2 + 0.8);
      group.add(cutwater1);
      const cutwater2 = new THREE.Mesh(cutwaterGeo, pierConcreteMat);
      cutwater2.position.set(px, 0.4, -(deckWidth + 3.8) / 2 - 0.8);
      group.add(cutwater2);
    }

    // 2. Roadway Deck Structure spanning the entire river
    const deckGeo = new THREE.BoxGeometry(bridgeLength, 0.65, deckWidth);
    const deck = new THREE.Mesh(deckGeo, roadAsphaltMat);
    deck.position.set(0, deckY, 0);
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

    // Double yellow center divider stripes
    const yellowStripeGeo = new THREE.PlaneGeometry(bridgeLength, 0.22);
    yellowStripeGeo.rotateX(-Math.PI / 2);
    const yellowStripe = new THREE.Mesh(yellowStripeGeo, stripeYellowMat);
    yellowStripe.position.set(0, deckY + 0.34, 0);
    group.add(yellowStripe);

    // White lane divider dashes on north and south driving lanes
    for (const laneOffset of [-deckWidth * 0.22, deckWidth * 0.22]) {
      const dashCount = Math.floor(bridgeLength / 4.2);
      for (let i = 0; i < dashCount; i++) {
        const dx = -bridgeLength / 2 + (bridgeLength / dashCount) * (i + 0.5);
        const dashGeo = new THREE.PlaneGeometry(1.8, 0.16);
        dashGeo.rotateX(-Math.PI / 2);
        const dash = new THREE.Mesh(dashGeo, stripeWhiteMat);
        dash.position.set(dx, deckY + 0.34, laneOffset);
        group.add(dash);
      }
    }

    // Pedestrian Sidewalks and Golden Guardrails along both sides of the bridge
    const sidewalkMat = new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      roughness: 0.8,
    });
    for (const side of [-1, 1]) {
      const swZ = side * (deckWidth / 2 - 0.6);
      const swGeo = new THREE.BoxGeometry(bridgeLength, 0.22, 1.1);
      const sw = new THREE.Mesh(swGeo, sidewalkMat);
      sw.position.set(0, deckY + 0.44, swZ);
      group.add(sw);

      const railGeo = new THREE.BoxGeometry(bridgeLength, 0.85, 0.1);
      const rail = new THREE.Mesh(railGeo, bridgeGoldMat);
      rail.position.set(0, deckY + 0.95, side * (deckWidth / 2 - 0.1));
      group.add(rail);
    }

    // 3. The Two Iconic Golden Lift Towers (Streamline Moderne Stepped Architecture)
    const createTower = (posX: number, nameSuffix: string): THREE.Group => {
      const towerGroup = new THREE.Group();
      towerGroup.name = `tower_${nameSuffix}`;

      const colSpacingX = 3.6;
      const colSpacingZ = deckWidth + 1.2;

      // 4 Main Stepped Tapered Columns (legs) for each tower
      for (const cx of [-colSpacingX / 2, colSpacingX / 2]) {
        for (const cz of [-colSpacingZ / 2, colSpacingZ / 2]) {
          const colGeo = new THREE.BoxGeometry(0.85, towerHeight, 0.85);
          const col = new THREE.Mesh(colGeo, bridgeGoldMat);
          col.position.set(cx, towerHeight / 2 + 0.5, cz);
          col.castShadow = true;
          col.receiveShadow = true;
          towerGroup.add(col);
        }
      }

      // 4 Horizontal Tower Belt Ties / Cross Struts
      for (const tierY of [6.5, 11.5, 16.5, 21.0]) {
        const tieZGeo = new THREE.BoxGeometry(colSpacingX + 0.8, 0.55, 0.6);
        for (const cz of [-colSpacingZ / 2, colSpacingZ / 2]) {
          const tieZ = new THREE.Mesh(tieZGeo, bridgeGoldMat);
          tieZ.position.set(0, tierY, cz);
          towerGroup.add(tieZ);
        }

        const tieXGeo = new THREE.BoxGeometry(0.6, 0.55, colSpacingZ + 0.8);
        for (const cx of [-colSpacingX / 2, colSpacingX / 2]) {
          const tieX = new THREE.Mesh(tieXGeo, bridgeGoldMat);
          tieX.position.set(cx, tierY, 0);
          towerGroup.add(tieX);
        }
      }

      // Diagonal X-Braces on tower side panels
      const xBraceGeo = new THREE.BoxGeometry(0.35, 6.2, 0.35);
      for (const cx of [-colSpacingX / 2, colSpacingX / 2]) {
        for (const tierY of [9.0, 14.0, 18.8]) {
          const b1 = new THREE.Mesh(xBraceGeo, bridgeGoldMat);
          b1.position.set(cx, tierY, 0);
          b1.rotation.x = 0.72;
          towerGroup.add(b1);

          const b2 = new THREE.Mesh(xBraceGeo, bridgeGoldMat);
          b2.position.set(cx, tierY, 0);
          b2.rotation.x = -0.72;
          towerGroup.add(b2);
        }
      }

      // Tower Top Machinery House / Crown Arch
      const crownGeo = new THREE.BoxGeometry(colSpacingX + 1.2, 2.2, colSpacingZ + 1.2);
      const crown = new THREE.Mesh(crownGeo, bridgeGoldMat);
      crown.position.set(0, towerHeight + 1.6, 0);
      crown.castShadow = true;
      towerGroup.add(crown);

      // Massive Counterweight Lift Sheaves (Pulleys) atop the tower
      const sheaveGeo = new THREE.CylinderGeometry(1.6, 1.6, 0.45, 16);
      sheaveGeo.rotateZ(Math.PI / 2);
      for (const sz of [-colSpacingZ / 2 + 0.6, colSpacingZ / 2 - 0.6]) {
        const sheave = new THREE.Mesh(sheaveGeo, darkSteelMat);
        sheave.position.set(0, towerHeight + 2.8, sz);
        towerGroup.add(sheave);
      }

      towerGroup.position.x = posX;
      return towerGroup;
    };

    group.add(createTower(-pierDist, 'west'));
    group.add(createTower(pierDist, 'east'));

    // 4. OPEN OVERHEAD STEEL TRUSS BETWEEN THE TOWERS
    // Specifically requested: "with an open truss between the towers"
    // Spans between West Tower (-13.5) and East Tower (+13.5). Length = 27, clear open air between members!
    const trussGroup = new THREE.Group();
    trussGroup.name = 'open_overhead_truss_span';
    const trussSpan = pierDist * 2; // 27 units
    const trussH = 6.8;
    const trussBottomY = deckY + 2.8; // Vertical clearance above roadway
    const trussTopY = trussBottomY + trussH;
    const trussW = deckWidth + 0.6;

    // Top and Bottom Horizontal Steel Box Chords (North and South sides)
    const chordGeo = new THREE.BoxGeometry(trussSpan - 0.4, 0.42, 0.42);
    for (const tz of [-trussW / 2, trussW / 2]) {
      // Bottom Chord
      const bChord = new THREE.Mesh(chordGeo, bridgeGoldMat);
      bChord.position.set(0, trussBottomY, tz);
      bChord.castShadow = true;
      trussGroup.add(bChord);

      // Top Chord
      const tChord = new THREE.Mesh(chordGeo, bridgeGoldMat);
      tChord.position.set(0, trussTopY, tz);
      tChord.castShadow = true;
      trussGroup.add(tChord);
    }

    // Vertical Posts and Criss-Crossing Diagonal Struts forming open Warren/Pratt truss panels
    const panelCount = 8;
    const panelW = trussSpan / panelCount; // 3.375 units per panel
    const postGeo = new THREE.BoxGeometry(0.35, trussH, 0.35);
    const diagLen = Math.hypot(panelW, trussH);
    const diagAngle = Math.atan2(panelW, trussH);
    const diagGeo = new THREE.BoxGeometry(0.28, diagLen, 0.28);

    for (const tz of [-trussW / 2, trussW / 2]) {
      // Vertical Posts
      for (let p = 0; p <= panelCount; p++) {
        const px = -trussSpan / 2 + p * panelW;
        const post = new THREE.Mesh(postGeo, bridgeGoldMat);
        post.position.set(px, trussBottomY + trussH / 2, tz);
        post.castShadow = true;
        trussGroup.add(post);
      }

      // Diagonal Struts with genuine open space between beams
      for (let p = 0; p < panelCount; p++) {
        const midX = -trussSpan / 2 + (p + 0.5) * panelW;
        const sign = p % 2 === 0 ? 1 : -1;
        const diag = new THREE.Mesh(diagGeo, bridgeGoldMat);
        diag.position.set(midX, trussBottomY + trussH / 2, tz);
        diag.rotation.z = sign * diagAngle;
        diag.castShadow = true;
        trussGroup.add(diag);
      }
    }

    // Overhead Transverse Sway Braces & Portal Ties across the top chords
    const swayGeo = new THREE.BoxGeometry(0.35, 0.35, trussW);
    for (let p = 0; p <= panelCount; p++) {
      const px = -trussSpan / 2 + p * panelW;
      const sway = new THREE.Mesh(swayGeo, bridgeGoldMat);
      sway.position.set(px, trussTopY, 0);
      trussGroup.add(sway);
    }

    // Steel Vertical Lift Suspension Cables hanging from tower counterweights to truss ends
    const cableGeo = new THREE.CylinderGeometry(0.06, 0.06, towerHeight - trussTopY + 3.0, 6);
    for (const cx of [-pierDist + 0.8, pierDist - 0.8]) {
      for (const cz of [-trussW / 2 + 0.6, trussW / 2 - 0.6]) {
        const cable = new THREE.Mesh(cableGeo, darkSteelMat);
        cable.position.set(cx, (trussTopY + towerHeight + 2.5) / 2, cz);
        trussGroup.add(cable);
      }
    }

    group.add(trussGroup);

    // Position and orient the entire bridge
    group.position.set(spec?.x || 0, 0, spec?.z || 0);
    group.rotation.y = spec?.rotationY || BRIDGE_ANGLE;

    scene.add(group);
    return group;
  };

  // Requirement 3: Add denser background city blocks and highway lines instead of sparse trees
  const addDowntownCityBlocks = () => {
    const group = new THREE.Group();
    group.name = 'downtown_sacramento_city_blocks';

    const cityTowersData = [
      // Downtown high-rise cluster along Capitol Mall grid
      { x: 16, z: -30, w: 14, d: 12, h: 28, stories: 9, color: '#1e3a5f', trim: '#38bdf8', roof: 'flat' },
      { x: 34, z: -38, w: 16, d: 14, h: 36, stories: 12, color: '#0f172a', trim: '#60a5fa', roof: 'flat' },
      { x: -2, z: -42, w: 13, d: 13, h: 24, stories: 8, color: '#334155', trim: '#cbd5e1', roof: 'flat' },
      { x: 18, z: -52, w: 20, d: 14, h: 22, stories: 7, color: '#cbd5e1', trim: '#64748b', roof: 'flat' },
      { x: 38, z: -58, w: 15, d: 15, h: 30, stories: 10, color: '#1e293b', trim: '#94a3b8', roof: 'flat' },
      { x: -16, z: -54, w: 14, d: 12, h: 18, stories: 6, color: '#475569', trim: '#e2e8f0', roof: 'flat' },
      { x: 26, z: -18, w: 12, d: 10, h: 19, stories: 6, color: '#e2e8f0', trim: '#0284c7', roof: 'flat' },
      { x: 44, z: -24, w: 13, d: 11, h: 21, stories: 7, color: '#1e3a5f', trim: '#38bdf8', roof: 'flat' },
      { x: 6, z: -66, w: 18, d: 16, h: 32, stories: 11, color: '#0f172a', trim: '#38bdf8', roof: 'flat' },
      { x: 28, z: -72, w: 16, d: 14, h: 26, stories: 9, color: '#334155', trim: '#cbd5e1', roof: 'flat' },
      { x: -8, z: -76, w: 15, d: 13, h: 20, stories: 7, color: '#475569', trim: '#94a3b8', roof: 'flat' },
      { x: 50, z: -44, w: 14, d: 14, h: 25, stories: 8, color: '#e2e8f0', trim: '#475569', roof: 'flat' },
      // West Sacramento commercial blocks
      { x: -28, z: 22, w: 15, d: 12, h: 15, stories: 5, color: '#e2e8f0', trim: '#334155', roof: 'flat' },
      { x: -44, z: 34, w: 16, d: 14, h: 13, stories: 4, color: '#f1f5f9', trim: '#64748b', roof: 'flat' },
      { x: -56, z: 18, w: 14, d: 12, h: 12, stories: 4, color: '#cbd5e1', trim: '#334155', roof: 'flat' },
      { x: -38, z: 6, w: 13, d: 10, h: 14, stories: 4, color: '#e2e8f0', trim: '#0284c7', roof: 'flat' },
    ];

    cityTowersData.forEach((bldg, idx) => {
      const bldgGroup = new THREE.Group();
      bldgGroup.name = `city_tower_${idx + 1}`;

      const bMat = new THREE.MeshStandardMaterial({
        color: bldg.color,
        roughness: 0.65,
        metalness: 0.25,
      });

      const trimMat = new THREE.MeshStandardMaterial({
        color: bldg.trim,
        roughness: 0.35,
        metalness: 0.65,
      });

      // Main tower body
      const bodyGeo = new THREE.BoxGeometry(bldg.w, bldg.h, bldg.d);
      const body = new THREE.Mesh(bodyGeo, bMat);
      body.position.y = bldg.h / 2 + 0.4;
      body.castShadow = true;
      body.receiveShadow = true;
      bldgGroup.add(body);

      // Multi-story glass window grid bands
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: '#38bdf8',
        roughness: 0.1,
        metalness: 0.8,
        clearcoat: 1.0,
      });
      const stories = bldg.stories;
      for (let s = 1; s < stories; s++) {
        const bandY = (bldg.h / stories) * s;
        const winBandGeo = new THREE.BoxGeometry(bldg.w + 0.08, 0.45, bldg.d + 0.08);
        const winBand = new THREE.Mesh(winBandGeo, glassMat);
        winBand.position.y = bandY;
        bldgGroup.add(winBand);
      }

      // Rooftop mechanical penthouse and architectural crown
      const phW = bldg.w * 0.55;
      const phD = bldg.d * 0.55;
      const phH = Math.min(3.5, bldg.h * 0.14);
      const phGeo = new THREE.BoxGeometry(phW, phH, phD);
      const ph = new THREE.Mesh(phGeo, trimMat);
      ph.position.y = bldg.h + phH / 2 + 0.4;
      bldgGroup.add(ph);

      // Rooftop antenna mast with red beacon marker
      if (bldg.h > 24) {
        const antGeo = new THREE.CylinderGeometry(0.08, 0.14, 4.5, 6);
        const antMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.8 });
        const ant = new THREE.Mesh(antGeo, antMat);
        ant.position.set(0, bldg.h + phH + 2.5, 0);
        bldgGroup.add(ant);

        const beaconGeo = new THREE.SphereGeometry(0.2, 8, 8);
        const beaconMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });
        const beacon = new THREE.Mesh(beaconGeo, beaconMat);
        beacon.position.set(0, bldg.h + phH + 4.7, 0);
        bldgGroup.add(beacon);
      }

      const baseY = groundHeightAt(bldg.x, bldg.z);
      bldgGroup.position.set(bldg.x, baseY, bldg.z);
      group.add(bldgGroup);
    });

    scene.add(group);
    return group;
  };

  // Highway Lines & Multi-lane Expressway Arterials (Capitol Mall / I-5 Corridor)
  const addHighwayLines = () => {
    const group = new THREE.Group();
    group.name = 'capitol_mall_highway_lines';

    const roadMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.88,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const dividerYellowMat = new THREE.MeshStandardMaterial({
      color: '#fbbf24',
      roughness: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const dashWhiteMat = new THREE.MeshStandardMaterial({
      color: '#f8fafc',
      roughness: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    // Main multi-lane Capitol Mall highway connecting straight into downtown
    const highwayPoints: [number, number][] = [
      [22, 14],
      [42, 28],
      [64, 42],
      [90, 58],
      [115, 74],
    ];

    for (let i = 0; i < highwayPoints.length - 1; i++) {
      const [x1, z1] = highwayPoints[i];
      const [x2, z2] = highwayPoints[i + 1];
      const dx = x2 - x1;
      const dz = z2 - z1;
      const segLen = Math.hypot(dx, dz);
      const angle = Math.atan2(dx, dz);
      const midX = (x1 + x2) / 2;
      const midZ = (z1 + z2) / 2;
      const midY = groundHeightAt(midX, midZ);

      const hwGeo = new THREE.BoxGeometry(9.6, 0.16, segLen + 0.5);
      const hwMesh = new THREE.Mesh(hwGeo, roadMat);
      hwMesh.position.set(midX, midY + 0.1, midZ);
      hwMesh.rotation.y = angle;
      hwMesh.receiveShadow = true;
      group.add(hwMesh);

      // Yellow double center line
      const yellGeo = new THREE.PlaneGeometry(0.24, segLen);
      yellGeo.rotateX(-Math.PI / 2);
      const yell = new THREE.Mesh(yellGeo, dividerYellowMat);
      yell.position.set(midX, midY + 0.2, midZ);
      yell.rotation.y = angle;
      group.add(yell);

      // Dashed lane lines
      for (const offset of [-2.4, 2.4]) {
        const dashCount = Math.floor(segLen / 4.5);
        for (let d = 0; d < dashCount; d++) {
          const t = (d + 0.5) / dashCount;
          const lx = THREE.MathUtils.lerp(x1, x2, t);
          const lz = THREE.MathUtils.lerp(z1, z2, t);
          const ly = groundHeightAt(lx, lz);

          const dGeo = new THREE.PlaneGeometry(0.18, 1.8);
          dGeo.rotateX(-Math.PI / 2);
          const dash = new THREE.Mesh(dGeo, dashWhiteMat);
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);
          dash.position.set(lx + offset * cosA, ly + 0.2, lz - offset * sinA);
          dash.rotation.y = angle;
          group.add(dash);
        }
      }
    }

    // Overhead highway directional gantry
    const gantryMat = new THREE.MeshStandardMaterial({ color: '#64748b', metalness: 0.7 });
    const greenSignMat = new THREE.MeshStandardMaterial({ color: '#15803d', roughness: 0.4 });
    const gantryGroup = new THREE.Group();
    const gantryPostGeo = new THREE.CylinderGeometry(0.16, 0.16, 5.5, 8);
    for (const gz of [-5.2, 5.2]) {
      const gPost = new THREE.Mesh(gantryPostGeo, gantryMat);
      gPost.position.set(0, 2.75, gz);
      gantryGroup.add(gPost);
    }
    const gBeamGeo = new THREE.BoxGeometry(0.35, 0.35, 10.8);
    const gBeam = new THREE.Mesh(gBeamGeo, gantryMat);
    gBeam.position.set(0, 5.4, 0);
    gantryGroup.add(gBeam);

    const signGeo = new THREE.BoxGeometry(0.1, 1.5, 4.2);
    const sign = new THREE.Mesh(signGeo, greenSignMat);
    sign.position.set(0, 4.6, -1.8);
    gantryGroup.add(sign);

    gantryGroup.position.set(38, groundHeightAt(38, 25), 25);
    gantryGroup.rotation.y = BRIDGE_ANGLE;
    group.add(gantryGroup);

    scene.add(group);
    return group;
  };

  const addBuilding = (b: BuildingSpec) => {
    const group = new THREE.Group();
    group.name = `building_${b.id}`;
    const w = Math.max(3, b.width || 12);
    const d = Math.max(3, b.depth || 10);
    const h = Math.max(2.6, b.height || 5);
    const baseY = groundHeightAt(b.x || 0, b.z || 0);

    // Foundation Plinth
    const plinthGeo = new THREE.BoxGeometry(w + 0.5, 0.45, d + 0.5);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: b.trimColor || '#475569',
      roughness: 0.85,
      metalness: 0.1,
    });
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = 0.225;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    group.add(plinth);

    // Facade Body
    const bodyGeo = new THREE.BoxGeometry(w, h, d);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: b.wallColor || '#f5f5f4',
      roughness: 0.65,
      metalness: 0.08,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.45 + h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Story Belt Courses
    const stories = Math.max(1, Math.min(12, Math.round(b.stories || 1)));
    const trimMat = new THREE.MeshStandardMaterial({
      color: b.trimColor || '#334155',
      roughness: 0.4,
      metalness: 0.35,
    });
    for (let s = 1; s <= stories; s++) {
      const bandY = 0.45 + (h / stories) * s;
      const bandGeo = new THREE.BoxGeometry(w + 0.18, 0.14, d + 0.18);
      const band = new THREE.Mesh(bandGeo, trimMat);
      band.position.y = bandY;
      group.add(band);
    }

    // Windows
    if (b.hasWindowGrid !== false) {
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: '#38bdf8',
        roughness: 0.12,
        metalness: 0.75,
        clearcoat: 0.8,
      });
      const cols = Math.max(2, Math.min(7, Math.floor(w / 3.2)));
      for (let s = 0; s < stories; s++) {
        const storyCenterY = 0.45 + (s + 0.52) * (h / stories);
        const winH = Math.min(1.6, (h / stories) * 0.52);
        const winW = Math.min(1.8, (w / cols) * 0.55);

        for (let c = 0; c < cols; c++) {
          const offsetX = -w / 2 + (w / (cols + 1)) * (c + 1);
          const winGeo = new THREE.BoxGeometry(winW, winH, 0.12);

          const frontWin = new THREE.Mesh(winGeo, glassMat);
          frontWin.position.set(offsetX, storyCenterY, d / 2 + 0.03);
          group.add(frontWin);

          const backWin = new THREE.Mesh(winGeo, glassMat);
          backWin.position.set(offsetX, storyCenterY, -d / 2 - 0.03);
          group.add(backWin);
        }
      }
    }

    // Roof
    const roofMat = new THREE.MeshStandardMaterial({
      color: b.roofColor || '#334155',
      roughness: 0.72,
      metalness: 0.18,
    });
    const roofBaseY = 0.45 + h;

    if (b.roofType === 'flat') {
      const parapetGeo = new THREE.BoxGeometry(w + 0.4, 0.45, d + 0.4);
      const parapet = new THREE.Mesh(parapetGeo, roofMat);
      parapet.position.y = roofBaseY + 0.225;
      parapet.castShadow = true;
      group.add(parapet);

      // Rooftop HVAC unit
      const hvacGeo = new THREE.BoxGeometry(w * 0.35, 1.1, d * 0.35);
      const hvac = new THREE.Mesh(hvacGeo, trimMat);
      hvac.position.y = roofBaseY + 0.55;
      group.add(hvac);
    } else {
      const roofHeight = Math.max(1.4, Math.min(4.2, Math.min(w, d) * 0.26));
      const coneGeo = new THREE.ConeGeometry(Math.SQRT2 / 2, roofHeight, 4);
      coneGeo.rotateY(Math.PI / 4);
      const hipMesh = new THREE.Mesh(coneGeo, roofMat);
      hipMesh.scale.set(w + 1.0, 1, d + 1.0);
      hipMesh.position.y = roofBaseY + roofHeight / 2;
      hipMesh.castShadow = true;
      group.add(hipMesh);
    }

    group.position.set(b.x || 0, baseY, b.z || 0);
    group.rotation.y = b.rotationY || 0;
    scene.add(group);
    return group;
  };

  const addRoadOrPath = (r: RoadOrPathSpec) => {
    if (!Array.isArray(r.points) || r.points.length < 2) return null;
    const group = new THREE.Group();
    group.name = `road_${r.id}`;
    const width = Math.max(1.2, r.width || 5);

    const mat = new THREE.MeshStandardMaterial({
      color: r.color || '#1e293b',
      roughness: 0.88,
      metalness: 0.06,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const stripeMat = new THREE.MeshStandardMaterial({
      color: '#fbbf24',
      roughness: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    for (let i = 0; i < r.points.length - 1; i++) {
      const [x1, z1] = r.points[i];
      const [x2, z2] = r.points[i + 1];
      const dx = x2 - x1;
      const dz = z2 - z1;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 0.1) continue;

      const midX = (x1 + x2) / 2;
      const midZ = (z1 + z2) / 2;
      const midY = groundHeightAt(midX, midZ);
      const angle = Math.atan2(dx, dz);

      const segGeo = new THREE.BoxGeometry(width, 0.14, segLen + width * 0.25);
      const seg = new THREE.Mesh(segGeo, mat);
      seg.position.set(midX, midY + 0.07, midZ);
      seg.rotation.y = angle;
      seg.receiveShadow = true;
      group.add(seg);

      if (r.hasMarkings) {
        const dashCount = Math.floor(segLen / 4.2);
        for (let d = 0; d < dashCount; d++) {
          const t = (d + 0.5) / dashCount;
          const lx = THREE.MathUtils.lerp(x1, x2, t);
          const lz = THREE.MathUtils.lerp(z1, z2, t);
          const ly = groundHeightAt(lx, lz);
          const dashGeo = new THREE.PlaneGeometry(0.2, 1.8);
          dashGeo.rotateX(-Math.PI / 2);
          const dash = new THREE.Mesh(dashGeo, stripeMat);
          dash.position.set(lx, ly + 0.15, lz);
          dash.rotation.y = angle;
          group.add(dash);
        }
      }
    }

    scene.add(group);
    return group;
  };

  const createSingleTree = (
    treeType: FoliageZoneSpec['treeType'],
    foliageColor: string,
    trunkColor: string,
    scale: number
  ): THREE.Group => {
    const g = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({
      color: trunkColor || '#5c4033',
      roughness: 0.9,
      metalness: 0.02,
    });
    const leafMat = new THREE.MeshStandardMaterial({
      color: foliageColor || '#15803d',
      roughness: 0.78,
      metalness: 0.05,
    });

    if (treeType === 'cypress' || treeType === 'pine') {
      const trunkGeo = new THREE.CylinderGeometry(0.15, 0.24, 1.6, 7);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.8;
      trunk.castShadow = true;
      g.add(trunk);

      for (let tier = 0; tier < 3; tier++) {
        const coneGeo = new THREE.ConeGeometry(1.15 - tier * 0.25, 2.4, 8);
        const cone = new THREE.Mesh(coneGeo, leafMat);
        cone.position.y = 2.1 + tier * 1.15;
        cone.castShadow = true;
        g.add(cone);
      }
    } else {
      // Deciduous riverbank tree
      const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 2.2, 7);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.1;
      trunk.castShadow = true;
      g.add(trunk);

      const offsets: [number, number, number, number][] = [
        [0, 3.1, 0, 1.45],
        [-0.75, 2.6, 0.4, 1.05],
        [0.8, 2.7, -0.35, 1.1],
      ];
      for (const [ox, oy, oz, rad] of offsets) {
        const crownGeo = new THREE.DodecahedronGeometry(rad, 1);
        const crown = new THREE.Mesh(crownGeo, leafMat);
        crown.position.set(ox, oy, oz);
        crown.castShadow = true;
        g.add(crown);
      }
    }

    g.scale.setScalar(Math.max(0.4, scale || 1));
    return g;
  };

  const addFoliageZone = (fz: FoliageZoneSpec) => {
    const group = new THREE.Group();
    group.name = `foliage_${fz.id}`;
    const count = Math.max(1, Math.min(25, fz.count || 8));
    const radius = Math.max(1, fz.spreadRadius || 8);

    for (let i = 0; i < count; i++) {
      const r = count === 1 ? 0 : Math.sqrt((i + 0.5) / count) * radius;
      const theta = i * 2.39996;
      const tx = (fz.x || 0) + Math.cos(theta) * r;
      const tz = (fz.z || 0) + Math.sin(theta) * r;

      // Don't spawn trees directly in the riverbed channel if a river exists
      const riverSpec = activeBlueprint.waterBodies?.find((w) => w.type === 'river' || w.type === 'channel');
      if (riverSpec) {
        const riverAng = typeof riverSpec.rotationY === 'number' ? riverSpec.rotationY : RIVER_ANGLE;
        const riverW = Math.max(16, riverSpec.width || RIVER_WIDTH);
        if (Math.abs(distToRiverLine(tx, tz, riverAng, riverSpec.x || 0, riverSpec.z || 0)) < riverW / 2 + 1.5) {
          continue;
        }
      }

      const ty = groundHeightAt(tx, tz);
      const scaleVar = (fz.heightScale || 1) * (0.85 + ((i * 19) % 30) / 100);

      const tree = createSingleTree(fz.treeType || 'deciduous', fz.foliageColor, fz.trunkColor, scaleVar);
      tree.position.set(tx, ty, tz);
      tree.rotation.y = (i * 1.1) % (Math.PI * 2);
      group.add(tree);
    }

    scene.add(group);
    return group;
  };

  const addProp = (p: PropSpec) => {
    // Optional Tower Bridge builder used ONLY when a bridge is in the frame
    if (p.type === 'bridge' || p.type === 'bridge_tower') {
      return addTowerBridge(p);
    }

    if (p.type === 'pool' || p.type === 'swimming_pool') {
      return addStandardWaterBody({
        id: p.id,
        type: 'pool',
        x: p.x,
        z: p.z,
        width: p.width,
        depth: p.depth,
        rotationY: p.rotationY || 0,
        waterColor: p.color || '#0284c7',
        deckColor: '#e2e8f0',
        hasDeck: true,
      });
    }

    const group = new THREE.Group();
    group.name = `prop_${p.id}`;
    const w = Math.max(0.5, p.width || 3);
    const d = Math.max(0.5, p.depth || 3);
    const h = Math.max(0.4, p.height || 2);
    const baseY = groundHeightAt(p.x || 0, p.z || 0);

    const mat = new THREE.MeshStandardMaterial({
      color: p.color || '#64748b',
      roughness: 0.6,
      metalness: 0.25,
    });

    if (
      p.type === 'court' ||
      p.type === 'tennis_court' ||
      p.type === 'basketball_court' ||
      p.type === 'pickleball_court'
    ) {
      // Sports / Tennis / Basketball Court
      const courtW = Math.max(10, w);
      const courtD = Math.max(18, d);
      const courtColor = p.color || (p.type === 'basketball_court' ? '#b45309' : '#1e40af');
      const innerColor = p.type === 'basketball_court' ? '#d97706' : '#15803d';

      // Court outer apron
      const apronGeo = new THREE.BoxGeometry(courtW, 0.08, courtD);
      const apronMat = new THREE.MeshStandardMaterial({ color: courtColor, roughness: 0.85 });
      const apron = new THREE.Mesh(apronGeo, apronMat);
      apron.position.y = 0.04;
      apron.receiveShadow = true;
      group.add(apron);

      // Inner playing field
      const innerGeo = new THREE.BoxGeometry(courtW * 0.78, 0.09, courtD * 0.82);
      const innerMat = new THREE.MeshStandardMaterial({ color: innerColor, roughness: 0.85 });
      const inner = new THREE.Mesh(innerGeo, innerMat);
      inner.position.y = 0.045;
      inner.receiveShadow = true;
      group.add(inner);

      // Painted white perimeter line
      const lineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      const lineGeoW = new THREE.BoxGeometry(courtW * 0.78, 0.095, 0.12);
      const lineGeoD = new THREE.BoxGeometry(0.12, 0.095, courtD * 0.82);

      const topL = new THREE.Mesh(lineGeoW, lineMat);
      topL.position.set(0, 0.05, courtD * 0.41);
      group.add(topL);

      const botL = new THREE.Mesh(lineGeoW, lineMat);
      botL.position.set(0, 0.05, -courtD * 0.41);
      group.add(botL);

      const leftL = new THREE.Mesh(lineGeoD, lineMat);
      leftL.position.set(-courtW * 0.39, 0.05, 0);
      group.add(leftL);

      const rightL = new THREE.Mesh(lineGeoD, lineMat);
      rightL.position.set(courtW * 0.39, 0.05, 0);
      group.add(rightL);

      if (p.type === 'basketball_court') {
        const centerLine = new THREE.Mesh(lineGeoW, lineMat);
        centerLine.position.set(0, 0.05, 0);
        group.add(centerLine);

        const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: '#475569', metalness: 0.8 });
        const boardGeo = new THREE.BoxGeometry(1.8, 1.1, 0.06);
        const boardMat = new THREE.MeshStandardMaterial({ color: '#ffffff' });

        for (const sign of [-1, 1]) {
          const pole = new THREE.Mesh(poleGeo, poleMat);
          pole.position.set(0, 1.6, sign * (courtD * 0.41 + 0.6));
          group.add(pole);

          const board = new THREE.Mesh(boardGeo, boardMat);
          board.position.set(0, 2.9, sign * (courtD * 0.41 + 0.2));
          group.add(board);
        }
      } else {
        const netGeo = new THREE.BoxGeometry(courtW * 0.84, 0.95, 0.05);
        const netMat = new THREE.MeshStandardMaterial({
          color: '#f8fafc',
          roughness: 0.4,
          transparent: true,
          opacity: 0.85,
        });
        const net = new THREE.Mesh(netGeo, netMat);
        net.position.y = 0.52;
        group.add(net);

        const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8);
        const postMat = new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.7 });
        for (const side of [-1, 1]) {
          const post = new THREE.Mesh(postGeo, postMat);
          post.position.set(side * courtW * 0.43, 0.55, 0);
          group.add(post);
        }
      }
    } else if (p.type === 'sports_field' || p.type === 'field' || p.type === 'soccer_field') {
      // Sports Field / Soccer Turf
      const fieldW = Math.max(20, w);
      const fieldD = Math.max(30, d);
      const turfMat = new THREE.MeshStandardMaterial({ color: p.color || '#15803d', roughness: 0.9 });
      const turfGeo = new THREE.BoxGeometry(fieldW, 0.06, fieldD);
      const turf = new THREE.Mesh(turfGeo, turfMat);
      turf.position.y = 0.03;
      turf.receiveShadow = true;
      group.add(turf);

      const lineMat = new THREE.MeshBasicMaterial({ color: '#f8fafc' });
      const lineW1 = new THREE.Mesh(new THREE.BoxGeometry(fieldW * 0.92, 0.07, 0.16), lineMat);
      lineW1.position.set(0, 0.04, fieldD * 0.46);
      group.add(lineW1);

      const lineW2 = new THREE.Mesh(new THREE.BoxGeometry(fieldW * 0.92, 0.07, 0.16), lineMat);
      lineW2.position.set(0, 0.04, -fieldD * 0.46);
      group.add(lineW2);

      const lineMid = new THREE.Mesh(new THREE.BoxGeometry(fieldW * 0.92, 0.07, 0.16), lineMat);
      lineMid.position.set(0, 0.04, 0);
      group.add(lineMid);

      const lineD1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, fieldD * 0.92), lineMat);
      lineD1.position.set(-fieldW * 0.46, 0.04, 0);
      group.add(lineD1);

      const lineD2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, fieldD * 0.92), lineMat);
      lineD2.position.set(fieldW * 0.46, 0.04, 0);
      group.add(lineD2);
    } else if (p.type === 'fence') {
      const postCount = Math.max(2, Math.floor(w / 2.5));
      const postGeo = new THREE.BoxGeometry(0.12, h, 0.12);
      const railGeo = new THREE.BoxGeometry(w, 0.1, 0.06);

      for (let i = 0; i <= postCount; i++) {
        const px = -w / 2 + (w / postCount) * i;
        const post = new THREE.Mesh(postGeo, mat);
        post.position.set(px, h / 2, 0);
        post.castShadow = true;
        group.add(post);
      }
      for (const ry of [h * 0.35, h * 0.8]) {
        const rail = new THREE.Mesh(railGeo, mat);
        rail.position.set(0, ry, 0);
        group.add(rail);
      }
    } else if (p.type === 'pergola') {
      const colGeo = new THREE.BoxGeometry(0.2, h, 0.2);
      for (const cx of [-w / 2 + 0.2, w / 2 - 0.2]) {
        for (const cz of [-d / 2 + 0.2, d / 2 - 0.2]) {
          const col = new THREE.Mesh(colGeo, mat);
          col.position.set(cx, h / 2, cz);
          col.castShadow = true;
          group.add(col);
        }
      }
      const beamGeo = new THREE.BoxGeometry(w + 0.4, 0.2, 0.15);
      for (const cz of [-d / 2 + 0.2, d / 2 - 0.2]) {
        const beam = new THREE.Mesh(beamGeo, mat);
        beam.position.set(0, h + 0.1, cz);
        group.add(beam);
      }
      const slatCount = Math.max(3, Math.floor(w / 0.8));
      const slatGeo = new THREE.BoxGeometry(0.12, 0.15, d + 0.4);
      for (let i = 0; i < slatCount; i++) {
        const sx = -w / 2 + (w / (slatCount - 1)) * i;
        const slat = new THREE.Mesh(slatGeo, mat);
        slat.position.set(sx, h + 0.25, 0);
        group.add(slat);
      }
    } else if (p.type === 'vehicle') {
      const chassisGeo = new THREE.BoxGeometry(2.0, 0.65, 4.4);
      const chassis = new THREE.Mesh(chassisGeo, mat);
      chassis.position.y = 0.55;
      chassis.castShadow = true;
      group.add(chassis);

      const cabinGeo = new THREE.BoxGeometry(1.75, 0.55, 2.2);
      const cabinMat = new THREE.MeshPhysicalMaterial({
        color: '#1e293b',
        roughness: 0.15,
        metalness: 0.8,
      });
      const cabin = new THREE.Mesh(cabinGeo, cabinMat);
      cabin.position.set(0, 1.12, -0.2);
      cabin.castShadow = true;
      group.add(cabin);

      const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12);
      wheelGeo.rotateZ(Math.PI / 2);
      const wheelMat = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.9 });
      for (const wx of [-1.05, 1.05]) {
        for (const wz of [-1.3, 1.3]) {
          const wheel = new THREE.Mesh(wheelGeo, wheelMat);
          wheel.position.set(wx, 0.35, wz);
          group.add(wheel);
        }
      }
    } else {
      const boxGeo = new THREE.BoxGeometry(w, h, d);
      const box = new THREE.Mesh(boxGeo, mat);
      box.position.y = h / 2;
      box.castShadow = true;
      group.add(box);
    }

    group.position.set(p.x || 0, baseY, p.z || 0);
    group.rotation.y = p.rotationY || 0;
    scene.add(group);
    return group;
  };

  const renderBlueprint = (blueprint: SceneBlueprint) => {
    if (!blueprint) return;
    activeBlueprint = blueprint;

    const horizonHex = blueprint.horizonColor || '#bae6fd';
    scene.background = new THREE.Color(horizonHex);
    scene.fog = new THREE.FogExp2(horizonHex, 0.0055);

    // 1. Procedural terrain
    buildTerrain(blueprint);

    // 2. Water Bodies (Render ONLY what is in blueprint.waterBodies)
    if (Array.isArray(blueprint.waterBodies) && blueprint.waterBodies.length > 0) {
      blueprint.waterBodies.forEach((wb) => addWaterBody(wb));
    }

    // 3. Roads and Paths (Render ONLY what is in blueprint.roadsAndPaths)
    if (Array.isArray(blueprint.roadsAndPaths) && blueprint.roadsAndPaths.length > 0) {
      blueprint.roadsAndPaths.forEach((r) => addRoadOrPath(r));
    }

    // 4. Buildings (Render ONLY what is in blueprint.buildings)
    if (Array.isArray(blueprint.buildings) && blueprint.buildings.length > 0) {
      blueprint.buildings.forEach((b) => addBuilding(b));
    }

    // 5. Foliage Zones (Render ONLY what is in blueprint.foliageZones)
    if (Array.isArray(blueprint.foliageZones) && blueprint.foliageZones.length > 0) {
      blueprint.foliageZones.forEach((fz) => addFoliageZone(fz));
    }

    // 6. Props (Render ONLY what is in blueprint.props - bridges, courts, fields, fences, vehicles)
    if (Array.isArray(blueprint.props) && blueprint.props.length > 0) {
      blueprint.props.forEach((p) => addProp(p));
    }
  };

  return {
    groundHeightAt,
    buildTerrain,
    addRiverChannel,
    addTowerBridge,
    addDowntownCityBlocks,
    addHighwayLines,
    addBuilding,
    addWaterBody,
    addRoadOrPath,
    addFoliageZone,
    addProp,
    renderBlueprint,
  };
}

export function clearDynamicSceneObjects(scene: THREE.Scene) {
  const toRemove: THREE.Object3D[] = [];
  scene.traverse((obj) => {
    if (obj.parent === scene && !obj.userData?.isPermanentLight) {
      toRemove.push(obj);
    }
  });

  for (const obj of toRemove) {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }
      }
    });
    scene.remove(obj);
  }
}

export function executeSceneCodeAndBlueprint(
  scene: THREE.Scene,
  blueprint: SceneBlueprint,
  sceneCode: string,
  sunLight: THREE.DirectionalLight | null,
  hemiLight: THREE.HemisphereLight | null,
  maxAnisotropy = 4
) {
  clearDynamicSceneObjects(scene);

  if (sunLight && blueprint) {
    const az = THREE.MathUtils.degToRad(blueprint.sunAzimuthDeg ?? 142);
    const el = THREE.MathUtils.degToRad(
      THREE.MathUtils.clamp(blueprint.sunElevationDeg ?? 46, 12, 82)
    );
    const dist = 65;
    sunLight.position.set(
      Math.cos(el) * Math.sin(az) * dist,
      Math.sin(el) * dist,
      Math.cos(el) * Math.cos(az) * dist
    );
    sunLight.color.set(blueprint.sunColor || '#fffbeb');
    sunLight.intensity = THREE.MathUtils.clamp(blueprint.sunIntensity ?? 2.1, 0.8, 3.0);
  }

  if (hemiLight && blueprint) {
    hemiLight.color.set(blueprint.skyColor || '#38bdf8');
    hemiLight.groundColor.set(blueprint.groundColor || '#3f6212');
  }

  const helpers = createSceneHelpers(scene, maxAnisotropy);
  let blueprintRendered = false;

  const wrappedHelpers = {
    ...helpers,
    renderBlueprint: (bp: SceneBlueprint) => {
      if (!blueprintRendered) {
        blueprintRendered = true;
        helpers.renderBlueprint(bp || blueprint);
      }
    },
  };

  if (sceneCode && sceneCode.trim().length > 0) {
    try {
      const cleanedCode = sceneCode
        .replace(/^```(?:javascript|js|ts|typescript)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      const fn = new Function('THREE', 'scene', 'helpers', 'blueprint', cleanedCode);
      fn(THREE, scene, wrappedHelpers, blueprint);
    } catch (err) {
      console.warn('Custom sceneCode execution warning (falling back to structured blueprint):', err);
    }
  }

  if (!blueprintRendered) {
    wrappedHelpers.renderBlueprint(blueprint);
  }
}
