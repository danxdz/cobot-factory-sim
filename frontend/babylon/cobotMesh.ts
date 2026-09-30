// Stable entry point for scene and UI consumers.
export { COBOT_PEDESTAL_HEIGHT,COBOT_PEDESTAL_SAFEZONE_RADIUS } from './cobot/constants';
export { tickCobot } from './cobot/controller';
export { createCobot } from './cobot/createCobot';
export type { CobotState } from './cobot/stateTypes';
