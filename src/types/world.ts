export interface ExtractedFrame {
  index: number;
  timestamp: number;
  formattedTime: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface CameraVantage {
  id: 'droneMatch' | 'poolAngle' | 'backLot' | 'roadView';
  label: string;
  description: string;
  position: [number, number, number];
  target: [number, number, number];
}

export interface BuildingSpec {
  id: string;
  label: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  stories: number;
  rotationY: number;
  wallColor: string;
  roofColor: string;
  roofType: 'gable' | 'hip' | 'flat' | 'shed';
  trimColor: string;
  hasWindowGrid: boolean;
  hasPorchOrBalcony: boolean;
}

export interface WaterOrPoolSpec {
  id: string;
  type: 'pool' | 'pond' | 'coast' | 'river' | 'channel';
  x: number;
  z: number;
  width: number;
  depth: number;
  rotationY: number;
  waterColor: string;
  deckColor: string;
  hasDeck: boolean;
}

export interface RoadOrPathSpec {
  id: string;
  type: 'road' | 'driveway' | 'walkway' | 'patio' | 'highway' | 'bridge_deck';
  points: [number, number][];
  width: number;
  color: string;
  hasMarkings: boolean;
}

export interface FoliageZoneSpec {
  id: string;
  treeType: 'palm' | 'cypress' | 'deciduous' | 'pine' | 'shrub';
  x: number;
  z: number;
  spreadRadius: number;
  count: number;
  heightScale: number;
  foliageColor: string;
  trunkColor: string;
}

export interface PropSpec {
  id: string;
  type:
    | 'fence'
    | 'pergola'
    | 'vehicle'
    | 'solar_panel'
    | 'rock_outcrop'
    | 'street_light'
    | 'lounger_set'
    | 'bridge'
    | 'bridge_tower'
    | 'highway_gantry'
    | 'city_block'
    | 'court'
    | 'tennis_court'
    | 'basketball_court'
    | 'pickleball_court'
    | 'sports_field'
    | 'field'
    | 'soccer_field'
    | 'pool'
    | 'swimming_pool';
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotationY: number;
  color: string;
}

export interface SceneBlueprint {
  sceneSummary: string;
  skyColor: string;
  horizonColor: string;
  groundColor: string;
  secondaryGroundColor: string;
  terrainRoughness: number;
  terrainHillHeight: number;
  terrainSlopeX: number;
  terrainSlopeZ: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunIntensity: number;
  sunColor: string;
  buildings: BuildingSpec[];
  waterBodies: WaterOrPoolSpec[];
  roadsAndPaths: RoadOrPathSpec[];
  foliageZones: FoliageZoneSpec[];
  props: PropSpec[];
  vantages: {
    droneMatch: { position: [number, number, number]; target: [number, number, number] };
    poolAngle: { position: [number, number, number]; target: [number, number, number] };
    backLot: { position: [number, number, number]; target: [number, number, number] };
    roadView: { position: [number, number, number]; target: [number, number, number] };
  };
}

export interface RoundArtifact {
  round: 1 | 2 | 3;
  status: 'pending' | 'building' | 'rendering' | 'critiquing' | 'complete' | 'error';
  originalFrameUrl: string;
  originalFrameTimestamp: string;
  renderSnapshotUrl: string | null;
  similarityScore: number | null;
  critique: string;
  fixesApplied: string[];
  sceneCode: string;
  blueprint: SceneBlueprint;
  modelUsed: string;
  isSimulatedGeometry: boolean;
}

export interface SavedClipInfo {
  fileName: string;
  url: string;
  sizeBytes: number;
  uploadedAt: string;
}
