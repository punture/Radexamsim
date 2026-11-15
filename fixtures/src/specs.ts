import type { CaseSpec } from "./common";
import { strokeFixture } from "./cases/stroke";
import { spineFixture } from "./cases/spine";
import { ringFixture } from "./cases/ring";

export const FIXTURE_SPECS: readonly CaseSpec[] = [strokeFixture, spineFixture, ringFixture];
