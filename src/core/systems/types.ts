import * as THREE from "three";
import type { Role, TeamId } from "../../data/types";

export type SimPlayerIntent = "hold" | "chase" | "support" | "return" | "keeper";

export type SimPlayer = {
  id: string;
  team: TeamId;
  role: Role;
  number: number;
  short: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  home: THREE.Vector3;
  hasBall: boolean;
  stamina: number;
  cooldown: number;
  intent: SimPlayerIntent;
  stats: {
    pace: number;
    shooting: number;
    passing: number;
    dribbling: number;
    defending: number;
    physical: number;
  };
  mesh: THREE.Group;
  body: THREE.Mesh;
};

export type SimBall = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  mesh: THREE.Mesh;
};

export type FieldBounds = {
  halfWidth: number;
  halfLength: number;
};
