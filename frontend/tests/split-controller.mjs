import fs from 'node:fs';
import ts from 'typescript';
let source = fs.readFileSync('babylon/cobotMesh.ts', 'utf8');
const cut = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`Missing boundary ${start}`);
  const text = source.slice(a,b);
  source = source.slice(0,a)+source.slice(b);
  return text;
};
// Move the three closures to their owning modules with explicit state arguments.
let latch = cut('    const canLatchByProximity = (','    const flushPhaseLog =');
latch = latch.replace('    const canLatchByProximity = (','function canLatchByProximity(\n    state: CobotState,').replace('    } => {','    } {').replace(/};\s*$/, '}');
let flush = cut('    const flushPhaseLog = () => {','    const logStatusReason =');
flush = flush.replace('    const flushPhaseLog = () => {','function flushPhaseLog(state: CobotState) {').replace(/};\s*$/, '}');
let reason = cut('    const logStatusReason = (','    state.simTime += delta;');
reason = reason.replace('    const logStatusReason = (key:', 'function logStatusReason(state: CobotState, key:').replace(') => {', ') {').replace(/};\s*$/, '}');
source = source.replaceAll('canLatchByProximity(', 'canLatchByProximity(state, ').replaceAll('flushPhaseLog()', 'flushPhaseLog(state)').replaceAll('logStatusReason(', 'logStatusReason(state, ');

const programStart = source.indexOf('    } else if (state.program.length > 0) {', source.indexOf('export function tickCobot'));
const programEnd = source.indexOf('    if (state.retreatTimer', programStart);
if(programStart<0||programEnd<0)throw new Error('program boundaries');
let program = source.slice(programStart,programEnd).replace('    } else if (state.program.length > 0) {','    if (state.program.length > 0) {');
source = source.slice(0,programStart) + '    } else {\n        tickProgram(state, delta, isRunning, mountPos, L1, L2, L3);\n    }\n\n' + source.slice(programEnd);
program = `function tickProgram(state: CobotState, delta: number, isRunning: boolean, mountPos: Vector3, L1: number, L2: number, L3: number) {\n${program}\n}`;
const motionStart = source.lastIndexOf("    const precisePhase = state.phase === 'pick_descend'");
const motion = `function advanceMotion(state: CobotState, delta: number, isRunning: boolean, mountPos: Vector3, L1: number, L2: number, L3: number, collisionsOn: boolean) {\n    const shoulderLimits = cobotShoulderLimits(state.selfItem?.config);\n    const elbowLimits = cobotElbowLimits(state.selfItem?.config);\n    const wristLimits = cobotWristLimits(state.selfItem?.config);\n${source.slice(motionStart)}`;
source = source.slice(0,motionStart) + '    return advanceMotion(state, delta, isRunning, mountPos, L1, L2, L3, collisionsOn);\n}\n';

// Keep phase handlers separate from program scheduling.
function extractCases(start,end,name,args) {
 const a=program.indexOf(start), b=program.indexOf(end,a);
 if(a<0||b<0)throw new Error(name);
 const cases=program.slice(a,b);
 const labels=[...cases.matchAll(/^\s*case ('[^']+'): /gm)].map(m=>m[1]);
 const invocation=labels.map(l=>`            case ${l}:`).join('\n')+`\n                ${name}({ ${args.map(a=>a[0]).join(', ')} });\n                break;\n`;
 program=program.slice(0,a)+invocation+program.slice(b);
 return `function ${name}(context: { ${args.map(([n,t])=>`${n}: ${t}`).join('; ')} }) {\n    const { ${args.map(a=>a[0]).join(', ')} } = context;\n    switch (state.phase) {\n${cases}\n    }\n}`;
}
const pickup = extractCases("            case 'pick_hover':", "            case 'pick_recenter':", 'tickPickup', [['state','CobotState'],['delta','number'],['stepPos','Vector3'],['mountPos','Vector3'],['L1','number'],['L2','number'],['L3','number'],['hasDrop','boolean'],['getAutoSlot','(part: { color: string } & PartLike) => Vector3 | null']]);
const placement = extractCases("            case 'pick_recenter':", "            case 'next':", 'tickPlacement', [['state','CobotState'],['delta','number'],['actualTip','Vector3'],['hasDrop','boolean'],['getAutoSlot','(part: { color: string } & PartLike) => Vector3 | null'],['STACK_R','number'],['finalReached','boolean']]);
source += '\n'+[latch,flush,reason,program,pickup,placement,motion].join('\n\n');

const sf=ts.createSourceFile('controller.ts',source,ts.ScriptTarget.Latest,true);
const originalImports=new Map();
for(const n of sf.statements)if(ts.isImportDeclaration(n)) {
 const clause=n.importClause;
 for(const el of clause?.namedBindings?.elements??[]) {
   let path=n.moduleSpecifier.text.replace('../simState','../../simState').replace('../types','../../types').replace('../store','../../store').replace('./cobot/','./');
   originalImports.set(el.name.text,{path,type:clause.isTypeOnly||el.isTypeOnly});
 }
}
const groups={
 telemetry: 'ParsedCobotDetail parseCobotDetail logCobotEvent flushPhaseLog logStatusReason applyTuningElementHighlight',
 geometry: 'topSurfaceAt stackCenterYAt quantizeHeight stackAwareClearanceAt platformStackClearanceY stackPathClearanceY obstaclePathClearanceY segmentTouchesSelfPlatform segmentClearanceY toolSurfaceClearance isPickupContactOverride carriedPayloadRadius carriedPayloadHeight basePathKeepoutRadius clampTargetAboveSupports partHint itemFootprintHit machineTopY supportTopAt machineWallY wallTopAt dropObstacles driveVector driveTileAt slotCaptureRadius dropBaseCenterY normalizeAngle pointSegmentDistSq2D pointSegmentT2D itemFootprintSize itemWorldFootprintSize segmentFootprintHit2D',
 pickupTargets: 'itemMotionTracker predictedPickupPos estimateItemVelocity pickupLeadTime bestDetectionForItem pickupAimPoint pickupContactTipY pickupContactState nearbyPickupPenalty partMatchesPickFilters canReachPickupCandidate pickupCandidateStepDistance isPickupCandidateCovered clampTargetAroundAnchorXZ movingPickupWindowRadius pickupLatchPlanarRadius pickupLatchVerticalRadius currentPickTimeout canLatchByProximity',
 dropTargets: 'itemsNearSlot assignItemsToSlots isTemporarilyAvoidedDropTarget getOrganizedDropTarget getSelfPlatformDropTarget enforceDropReachability computeDropTarget currentDropTarget isSelfPlatformDropPhase resolveAutoDropTarget selfSortPreferences dropPlacementState computeDropExitTarget captureDropExitTarget',
 programTargets: 'currentProgramStep currentPickAnchor pickWaitTargetForStep currentPickWaitTarget nextPickWaitTarget currentDropAnchor autoDropAnchor nextProgramActionIndex carryTravelY',
 collision: 'collisionSafetyEnabled appendSegmentSamples collectArmSamples ArmLinkSample SELF_COLLISION_LINK_PAIRS collectArmLinks closestPointOnSegment closestSampledSegmentPoints selfCollisionRiskFromLinks selfCollisionRisk clampPickupHandAboveParts resolveHandDiskPartContacts resolveArmLinkStackClearance segmentHitsMachine armHitsObstacle armHitsPart isSoftAvoidCollision requestPredictiveReplan startRecoveryRetreat computeYieldTargetFromSensors',
 planner: 'isActiveSupportForPath findBlockingPathObstacle pathHitsObstacle2D detourAroundObstacle pushPointOutsideBaseKeepout appendPathSegment planToolpath nextPlannedTarget isFineAlignPhase transformWorldToLocal resolveFlowGoal buildPrecalculatedToolpathPreview',
 program: 'findPickupCandidateForStep acquirePickupTarget nearestSelfSlotIndex findItemToOrganize tickProgram',
 pickup: 'tickPickup', placement: 'tickPlacement', motion:'advanceMotion', controller:'tickCobot',
 contactConstants:'PICK_HAND_PART_CLEARANCE PICK_HAND_CONTACT_TOLERANCE HAND_DISK_COLLIDER_RADIUS HAND_DISK_COLLIDER_HALF_HEIGHT HAND_DISK_CONTACT_SKIN',
};
const owner=new Map(Object.entries(groups).flatMap(([g,names])=>names.split(' ').map(n=>[n,g])));
const defs=new Map();
for(const n of sf.statements) {
 const name=n.name?.text ?? (ts.isVariableStatement(n)?n.declarationList.declarations[0].name.getText(sf):undefined);
 if(name) {if(!owner.has(name))throw new Error(`Ungrouped ${name}`);defs.set(name,n);}
}
for(const [group,names] of Object.entries(groups)) {
 const nodes=names.split(' ').map(n=>{if(!defs.has(n))throw new Error(`Missing ${n}`);return defs.get(n);});
 const refs=new Set();
 const visit=n=>{if(ts.isIdentifier(n))refs.add(n.text);ts.forEachChild(n,visit);};
 nodes.forEach(visit);
 const imports=new Map();
 for(const name of refs) {
   const from=owner.get(name);
   const imp=from&&from!==group ? {path:'./'+from,type:ts.isTypeAliasDeclaration(defs.get(name))} : originalImports.get(name);
   if(!imp)continue;
   const key=(imp.type?'type ':'')+imp.path;
   if(!imports.has(key))imports.set(key,[]);
   imports.get(key).push(name);
 }
 const header=[...imports].map(([key,names])=>`import ${key.startsWith('type ')?'type ':''}{ ${names.sort().join(', ')} } from '${key.replace(/^type /,'')}';`).join('\n');
 const body=nodes.map(n=>{const text=n.getText(sf);return text.startsWith('export ')?text:'export '+text;}).join('\n\n');
 fs.writeFileSync(`babylon/cobot/${group}.ts`, header+'\n\n'+body+'\n');
}
fs.writeFileSync('babylon/cobotMesh.ts',`// Stable entry point for scene and UI consumers.\nexport { createCobot } from './cobot/createCobot';\nexport { tickCobot } from './cobot/controller';\nexport type { CobotState } from './cobot/stateTypes';\nexport { COBOT_PEDESTAL_HEIGHT, COBOT_PEDESTAL_SAFEZONE_RADIUS } from './cobot/constants';\n`);
