import type { Role } from "./types";

export type FormationId = "4-3-3";

export type FormationLine = {
  role: Role;
  count: number;
};

export type FormationData = {
  id: FormationId;
  name: string;
  lines: FormationLine[];
};

export const formations: Record<FormationId, FormationData> = {
  "4-3-3": {
    id: "4-3-3",
    name: "4-3-3",
    lines: [
      { role: "GK", count: 1 },
      { role: "DEF", count: 4 },
      { role: "MID", count: 3 },
      { role: "FWD", count: 3 }
    ]
  }
};

export const defaultFormation = formations["4-3-3"];
