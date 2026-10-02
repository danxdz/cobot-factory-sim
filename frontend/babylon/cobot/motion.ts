import { Color3,Vector3 } from '@babylonjs/core';
import { updateCobotPath } from './pathVisuals';
import { integrateToolVelocity } from './motionProfile';
import { simState } from '../../simState';
import { factoryStore } from '../../store';
import { PlacedItem } from '../../types';
import { armHitsObstacle,armHitsPart,clampPickupHandAboveParts,collectArmSamples,isSoftAvoidCollision,requestPredictiveReplan,resolveArmLinkStackClearance,resolveHandDiskPartContacts,selfCollisionRisk,startRecoveryRetreat } from './collision';
import { COBOT_ARM_HARD_STOP_DIST,COBOT_ARM_REDUCED_SPEED_DIST,COBOT_BODY_D,COBOT_BODY_W,COBOT_NEIGHBOR_YIELD_TRIGGER,COBOT_PEDESTAL_HEIGHT,COBOT_PLATFORM_TOP_Y,COBOT_SELF_REDUCED_SPEED_DIST,CONTACT_STALL_TIMEOUT,DISC_RADIUS,HAND_SAFETY_EXTRA_RADIUS,MAX_RECOVERY_ATTEMPTS,OVERDRIVE_HIT_PENALTY,OVERDRIVE_STALL_PENALTY,PART_CONTACT_STOP_TIMEOUT,PART_CONTACT_WARN_TIMEOUT,PICK_GRAB_RADIUS,SAFETY_HARD_STOP_DIST,SAFETY_MIN_SPEED_FACTOR,SAFETY_REDUCED_SPEED_DIST,STALL_PROGRESS_EPSILON,STUCK_STALL_TIMEOUT } from './constants';
import { currentDropTarget,isSelfPlatformDropPhase } from './dropTargets';
import { carriedPayloadRadius,clampTargetAboveSupports,dropObstacles,isPickupContactOverride,itemFootprintHit,machineTopY,supportTopAt,toolSurfaceClearance } from './geometry';
import { solvePose } from './kinematics';
import { clamp,projectTargetToReachEnvelope } from './math';
import { partHalfHeight,partRadiusForSpec } from './partGeometry';
import { pickupContactState } from './pickupTargets';
import { buildPrecalculatedToolpathPreview,nextPlannedTarget,resolveFlowGoal } from './planner';
import type { CobotState } from './stateTypes';
import { flushPhaseLog,logCobotEvent } from './telemetry';

export function advanceMotion(state: CobotState, delta: number, isRunning: boolean, mountPos: Vector3, L1: number, L2: number, L3: number, collisionsOn: boolean) {
    const precisePhase = state.phase === 'pick_descend' || state.phase === 'descend_drop';
    const maxReach = L1 + L2 - 0.02;
    const desiredEnvelopeTarget = projectTargetToReachEnvelope(state.desiredTarget, mountPos, state.position[1] + 0.1, maxReach, L3);
    state.isOutOfRange = Vector3.Distance(state.desiredTarget, desiredEnvelopeTarget) > 0.05;
    state.desiredTarget.copyFrom(clampTargetAboveSupports(state, desiredEnvelopeTarget.clone(), state.phase, !!state.grabbedItem));
    const rawGoal = state.desiredTarget.clone();
    const activeDropTargetForFlow = ['hover_drop', 'descend_drop', 'release', 'drop_recenter'].includes(state.phase)
        ? currentDropTarget(state)
        : null;
    const dropOnSelfSupportFlow = !!(
        activeDropTargetForFlow &&
        state.selfItem &&
        itemFootprintHit(state.selfItem, activeDropTargetForFlow.x, activeDropTargetForFlow.z, 0.08)
    );
    const dropOnSelfSupportPhase = dropOnSelfSupportFlow &&
        (state.phase === 'hover_drop' || state.phase === 'descend_drop' || state.phase === 'release' || state.phase === 'drop_recenter');
    const flowGoal = resolveFlowGoal(state, rawGoal);
    const pathTarget = nextPlannedTarget(state, mountPos, flowGoal, precisePhase);
    if (!state.lastPreviewUpdate || state.simTime - state.lastPreviewUpdate > 0.5) {
        state.precalculatedPath = buildPrecalculatedToolpathPreview(state, mountPos, flowGoal, precisePhase);
        state.lastPreviewUpdate = state.simTime;
    }
    let commandedTarget = pathTarget.clone();
    clampTargetAboveSupports(state, commandedTarget, state.phase, !!state.grabbedItem);
    state.desiredTarget.copyFrom(commandedTarget);
    const toTarget = state.desiredTarget.subtract(state.ikTarget);
    const distanceToTarget = toTarget.length();
    const planarTargetDelta = Math.hypot(toTarget.x, toTarget.z);
    const verticalTargetDelta = Math.abs(toTarget.y);
    const pureVerticalContactMotion =
        (state.phase === 'pick_descend' || state.phase === 'pick_attach' || state.phase === 'descend_drop' || state.phase === 'release' || state.phase === 'lift') &&
        verticalTargetDelta > 0.015 &&
        planarTargetDelta < 0.52 &&
        verticalTargetDelta > planarTargetDelta * 0.6;
    const pickCommitPhase = state.phase === 'pick_descend' || state.phase === 'pick_attach';
    const pickCommitContact = pickCommitPhase ? pickupContactState(state, state.targetedItem) : null;
    const committedPickTouch = !!pickCommitContact && (pickCommitContact.touchingPart || pickCommitContact.touchingSurface);
    const pickupContactOverride = isPickupContactOverride(state);
    const relaxedContactMotion = pickupContactOverride || committedPickTouch || pureVerticalContactMotion;

    state.wristRoll.computeWorldMatrix(true);
    const wristPos = state.wristRoll.getAbsolutePosition();
    if (state.selfItem) {
        simState.cobotWrists[state.selfItem.id] = wristPos.clone();
        simState.cobotArmSamples[state.selfItem.id] = collectArmSamples(state);
        simState.cobotLoads[state.selfItem.id] = !!state.grabbedItem;
    }

    const grabbedRadius = state.grabbedItem ? carriedPayloadRadius(state) : 0.08;
    const mountPlanarDx = wristPos.x - mountPos.x;
    const mountPlanarDz = wristPos.z - mountPos.z;
    const mountPlanarDist = Math.sqrt(mountPlanarDx * mountPlanarDx + mountPlanarDz * mountPlanarDz);
    const nearOwnPedestal = mountPlanarDist < (state.mountCollisionRadius + 0.42) && wristPos.y < (state.position[1] + COBOT_PEDESTAL_HEIGHT + 0.34);
    const handSafetyPad = grabbedRadius + (nearOwnPedestal || !!state.grabbedItem ? HAND_SAFETY_EXTRA_RADIUS : 0.015);

    const visualRadius = 0.2 + grabbedRadius + (nearOwnPedestal ? HAND_SAFETY_EXTRA_RADIUS : 0.015);
    state.collisionSphere.scaling.setAll(visualRadius * 2);

    const sensorHeading = state.baseRotY + state.basePivot.rotation.y;
    const sensorForward = new Vector3(Math.sin(sensorHeading), 0, Math.cos(sensorHeading));
    const sensorRight = new Vector3(sensorForward.z, 0, -sensorForward.x);
    let hazardForward = 0;
    let hazardRight = 0;
    let hazardBackward = 0;
    let hazardLeft = 0;
    const sensorRange = 0.46;
    const addDirectionalHazard = (point: Vector3, dist: number) => {
        if (dist >= sensorRange) return;
        const planar = point.subtract(wristPos);
        planar.y = 0;
        const planarDist = planar.length();
        if (planarDist < 0.0001) return;
        const dir = planar.scale(1 / planarDist);
        const strength = clamp((sensorRange - Math.max(0, dist)) / sensorRange, 0, 1);
        const fDot = Vector3.Dot(dir, sensorForward);
        const rDot = Vector3.Dot(dir, sensorRight);
        if (fDot >= 0) hazardForward = Math.max(hazardForward, strength * fDot);
        else hazardBackward = Math.max(hazardBackward, strength * -fDot);
        if (rDot >= 0) hazardRight = Math.max(hazardRight, strength * rDot);
        else hazardLeft = Math.max(hazardLeft, strength * -rDot);
    };

    let closestPoint: Vector3 | null = null;
    let minDist = Infinity;

    for (const item of factoryStore.getState().placedItems) {
        if (item.id === state.selfItem?.id || item.type === 'camera') continue;
        let pad = handSafetyPad, w = 2, d = 2, h = item.config?.machineHeight || 0.538;
        if (item.type === 'table') { [w, d] = item.config?.tableSize || [1.8, 1.8]; h = item.config?.tableHeight || 0.45; }
        else if (item.type === 'belt') { [w, d] = item.config?.beltSize || [2, 2]; h = item.config?.beltHeight || 0.538; }
        else if (['sender', 'receiver', 'indexed_receiver', 'pile'].includes(item.type)) { [w, d] = item.config?.machineSize || [2, 2]; }
        else if (item.type === 'cobot') { w = COBOT_BODY_W; d = COBOT_BODY_D; pad = 0.05 + handSafetyPad; h = COBOT_PLATFORM_TOP_Y; }

        const cx = clamp(wristPos.x, item.position[0] - w / 2 - pad, item.position[0] + w / 2 + pad);
        const cz = clamp(wristPos.z, item.position[2] - d / 2 - pad, item.position[2] + d / 2 + pad);
        const cy = clamp(wristPos.y, 0, h + 0.05);
        const closest = new Vector3(cx, cy, cz);
        const dist = Vector3.Distance(wristPos, closest);
        addDirectionalHazard(closest, dist);
        if (dist < minDist) {
            minDist = dist;
            closestPoint = closest;
        }
    }

    const currentItems = factoryStore.getState().placedItems;
    const lookAheadTime = precisePhase ? 0.08 : 0.22;
    const predictedWrist = wristPos.add(state.ikVelocity.scale(lookAheadTime));
    let nearestCobotClearance = Infinity;
    let nearestCobotPoint: Vector3 | null = null;
    let nearestCobotId: string | null = null;
    for (const staleId of Object.keys(simState.cobotArmSamples)) {
        if (!currentItems.some(i => i.id === staleId)) {
            delete simState.cobotArmSamples[staleId];
            delete simState.cobotWrists[staleId];
            delete simState.cobotLoads[staleId];
        }
    }
    for (const [id, armPoints] of Object.entries(simState.cobotArmSamples)) {
        if (id === state.selfItem?.id || !armPoints?.length) continue;
        for (const p of armPoints) {
            const crossArmPad = nearOwnPedestal ? handSafetyPad : grabbedRadius;
            const distNow = Vector3.Distance(wristPos, p) - (0.2 + crossArmPad);
            const distSoon = Vector3.Distance(predictedWrist, p) - (0.24 + crossArmPad);
            const dist = Math.min(distNow, distSoon);
            if (dist < nearestCobotClearance) {
                nearestCobotClearance = dist;
                nearestCobotPoint = p.clone();
                nearestCobotId = id;
            }
            if (dist < minDist) {
                minDist = Math.max(0, dist);
                const dir = p.subtract(wristPos);
                if (dir.lengthSquared() > 0.000001) {
                    dir.normalize();
                    closestPoint = wristPos.add(dir.scale(minDist));
                } else {
                    closestPoint = p.clone();
                }
            }
            addDirectionalHazard(p, dist);
        }
    }

    const ownLinkRisk = selfCollisionRisk(state);
    if (ownLinkRisk.point && ownLinkRisk.clearance < COBOT_SELF_REDUCED_SPEED_DIST) {
        const selfDist = Math.max(0, ownLinkRisk.clearance);
        addDirectionalHazard(ownLinkRisk.point, selfDist);
        if (selfDist < minDist) {
            minDist = selfDist;
            closestPoint = ownLinkRisk.point.clone();
        }
    }

    for (const item of simState.items) {
        if (item === state.grabbedItem) continue;
        const pickPhaseActive = state.phase === 'pick_hover' || state.phase === 'pick_descend' || state.phase === 'pick_attach';
        if (item === state.targetedItem && pickPhaseActive) continue;
        if (state.phase === 'pick_descend' && state.targetedItem) {
            const distToTargetPart = Vector3.Distance(item.pos, state.targetedItem.pos);
            if (distToTargetPart < 0.4) continue;
        }
        if (item === state.targetedItem && distanceToTarget < 0.6) continue;
        if (item.state === 'dead' || item.state === 'grabbed') continue;
        if (dropOnSelfSupportPhase && activeDropTargetForFlow) {
            const ddx = item.pos.x - activeDropTargetForFlow.x;
            const ddz = item.pos.z - activeDropTargetForFlow.z;
            const itemR = partRadiusForSpec(item);
            const nearSelfDrop = Math.sqrt(ddx * ddx + ddz * ddz) < Math.max(0.3, itemR * 1.4);
            const belowApproachBand = item.pos.y <= activeDropTargetForFlow.y + partHalfHeight(item) + 0.28;
            if (nearSelfDrop && belowApproachBand) continue;
        }
        if (pickPhaseActive && state.targetedItem) {
            const tdx = item.pos.x - state.targetedItem.pos.x;
            const tdz = item.pos.z - state.targetedItem.pos.z;
            const nearTarget = Math.sqrt(tdx * tdx + tdz * tdz) < Math.max(0.34, partRadiusForSpec(state.targetedItem) * 1.25);
            if (nearTarget && item.pos.y <= state.targetedItem.pos.y + partHalfHeight(state.targetedItem) + 0.12) continue;
            if (state.phase === 'pick_descend') {
                const descentBuffer = Math.sqrt(tdx * tdx + tdz * tdz) < Math.max(0.52, partRadiusForSpec(state.targetedItem) * 1.8);
                const inDescentBand = item.pos.y <= state.targetedItem.pos.y + partHalfHeight(state.targetedItem) + 0.2;
                if (descentBuffer && inDescentBand) continue;
            }
        }
        const otherRad = partRadiusForSpec(item);
        const otherHalf = partHalfHeight(item);

        const dy = clamp(wristPos.y, item.pos.y - otherHalf, item.pos.y + otherHalf);
        const dx = wristPos.x - item.pos.x;
        const dz = wristPos.z - item.pos.z;
        const len = Math.sqrt(dx * dx + dz * dz);

        let cx = item.pos.x, cz = item.pos.z;
        if (len > 0) {
            const looseItemPad = nearOwnPedestal ? handSafetyPad : grabbedRadius;
            const rad = Math.min(len, otherRad + looseItemPad);
            cx += (dx / len) * rad;
            cz += (dz / len) * rad;
        }

        const closest = new Vector3(cx, dy, cz);
        const dist = Vector3.Distance(wristPos, closest);
        addDirectionalHazard(closest, dist);
        if (dist < minDist) {
            minDist = dist;
            closestPoint = closest;
        }
    }

    const hzAlpha = clamp(delta * 8.5, 0, 1);
    state.sensorHazards[0] += (hazardForward - state.sensorHazards[0]) * hzAlpha;
    state.sensorHazards[1] += (hazardRight - state.sensorHazards[1]) * hzAlpha;
    state.sensorHazards[2] += (hazardBackward - state.sensorHazards[2]) * hzAlpha;
    state.sensorHazards[3] += (hazardLeft - state.sensorHazards[3]) * hzAlpha;
    const distSample = isFinite(minDist) ? minDist : 2;
    state.sensorMinDist += (distSample - state.sensorMinDist) * clamp(delta * 7.5, 0, 1);

    hazardForward = state.sensorHazards[0];
    hazardRight = state.sensorHazards[1];
    hazardBackward = state.sensorHazards[2];
    hazardLeft = state.sensorHazards[3];
    minDist = state.sensorMinDist;
    if (!collisionsOn) {
        hazardForward = 0;
        hazardRight = 0;
        hazardBackward = 0;
        hazardLeft = 0;
        minDist = 2;
        state.sensorHazards = [0, 0, 0, 0];
        state.sensorMinDist = 2;
        state.avoidanceSide = 0;
    }
    if (pickupContactOverride) {
        hazardForward = 0;
        hazardRight = 0;
        hazardBackward = 0;
        hazardLeft = 0;
        minDist = 2;
        state.sensorHazards = [0, 0, 0, 0];
        state.sensorMinDist = 2;
        state.avoidanceSide = 0;
        state.recoveryTimer = 0;
    }

    const colorForHazard = (hazard: number) => {
        if (hazard > 0.58) return Color3.FromHexString('#ef4444');
        if (hazard > 0.01) return Color3.FromHexString('#f59e0b');
        return Color3.FromHexString('#22c55e');
    };
    const sensorHazards = [hazardForward, hazardRight, hazardBackward, hazardLeft];
    for (let i = 0; i < state.proximityMats.length; i++) {
        const hz = sensorHazards[Math.min(i, sensorHazards.length - 1)] ?? 0;
        state.proximityMats[i].emissiveColor = colorForHazard(hz);
    }
    state.proximityMult = 1.0;

    const dropOnSelfSupport = isSelfPlatformDropPhase(state, activeDropTargetForFlow);
    const activeStep = state.program.length > 0 ? state.program[state.stepIndex % state.program.length] : null;
    const precisionMoveApproach = !!(
        activeStep?.action === 'move' &&
        activeStep.pos &&
        state.phase === 'idle' &&
        Vector3.Distance(state.ikTarget, new Vector3(activeStep.pos[0], activeStep.pos[1], activeStep.pos[2])) < 0.08
    );
    const maxHazard = Math.max(hazardForward, hazardRight, hazardBackward, hazardLeft);
    const nearRisk = minDist < COBOT_NEIGHBOR_YIELD_TRIGGER
        ? clamp((COBOT_NEIGHBOR_YIELD_TRIGGER - Math.max(0, minDist)) / COBOT_NEIGHBOR_YIELD_TRIGGER, 0, 1)
        : 0;
    const slowdownZone = minDist < SAFETY_REDUCED_SPEED_DIST;
    if (!relaxedContactMotion && !precisionMoveApproach && closestPoint && (maxHazard > 0.45 || nearRisk > 0.5)) {
        // No repulsion force here. Sensors only mark risk, slow down, and ask the path planner
        // for a fresh waypoint sequence if the current trajectory is becoming unsafe.
        state.targetSource = 'avoidance';
        state.pathReplanCooldown = 0;
    }
    if (state.recoveryTimer > 0) {
        state.recoveryTimer = Math.max(0, state.recoveryTimer - delta);
    }

    const isSlowPhase = precisePhase || state.phase === 'release' || state.phase === 'pick_descend' || state.phase === 'descend_drop';
    const cruiseSpeed = (state.recoveryTimer > 0 ? 0.8 : (isSlowPhase ? 1.4 : 5.8)) * state.speed;
    const settleRadius = precisePhase ? 0.2 : 0.5;
    const accel = (precisePhase ? 8.0 : 5.5) * state.speed;
    const drag = (precisePhase ? 14.5 : 8.5) * (relaxedContactMotion ? 0.2 : 0.35);

    let desiredVelocity = Vector3.Zero();
    if (distanceToTarget > 0.0001) {
        const dir = toTarget.scale(1 / distanceToTarget);
        const ramp = distanceToTarget < settleRadius
            ? Math.max(0.12, distanceToTarget / settleRadius)
            : 1;
        desiredVelocity = dir.scale(cruiseSpeed * ramp);
    }
    // IK limits base rotation for the current Cartesian target. Gating travel on
    // the future waypoint's yaw creates a feedback loop: movement must happen
    // before yaw can change. Proximity and collision checks below govern speed.
    {
        if (!relaxedContactMotion && !precisionMoveApproach) {
            const avoidanceGain = precisePhase ? 0.45 : 1.0;
            const planar = new Vector3(desiredVelocity.x, 0, desiredVelocity.z);
            const forwardComp = Vector3.Dot(planar, sensorForward);
            const rightComp = Vector3.Dot(planar, sensorRight);
            const forwardHazard = (forwardComp >= 0 ? hazardForward : hazardBackward) * avoidanceGain;
            const rightHazard = (rightComp >= 0 ? hazardRight : hazardLeft) * avoidanceGain;
            const forwardScale = 1 - forwardHazard;
            const rightScale = 1 - rightHazard;
            const safePlanar = sensorForward
                .scale(forwardComp * clamp(forwardScale, 0, 1))
                .add(sensorRight.scale(rightComp * clamp(rightScale, 0, 1)));
            desiredVelocity.x = safePlanar.x;
            desiredVelocity.z = safePlanar.z;
        }
    }
	    {
	        if (!relaxedContactMotion) {
	            if (precisionMoveApproach) {
                state.safetySpeedFactor += (1 - state.safetySpeedFactor) * clamp(delta * 8.5, 0, 1);
                state.reducedSpeedActive = false;
                state.avoidanceSide = 0;
            } else {
                const reducedDistFactor = minDist < SAFETY_REDUCED_SPEED_DIST
                    ? clamp(
                        (Math.max(minDist, SAFETY_HARD_STOP_DIST) - SAFETY_HARD_STOP_DIST) /
                        (SAFETY_REDUCED_SPEED_DIST - SAFETY_HARD_STOP_DIST),
                        SAFETY_MIN_SPEED_FACTOR,
                        1
                    )
                    : 1;
                const reducedHazardFactor = slowdownZone
                    ? clamp(1 - maxHazard * (dropOnSelfSupport ? 0.42 : 0.58), SAFETY_MIN_SPEED_FACTOR, 1)
                    : 1;
                const safetySlowdown = Math.min(reducedDistFactor, reducedHazardFactor);
                const avoidanceSlowdown = slowdownZone
                    ? clamp(
                        1 - Math.max(maxHazard * 0.72, nearRisk * 0.85),
                        precisePhase ? 0.42 : 0.24,
                        1
                    )
                    : 1;
                const slowdown = Math.min(avoidanceSlowdown, safetySlowdown);
                desiredVelocity.scaleInPlace(slowdown);
                state.safetySpeedFactor += (slowdown - state.safetySpeedFactor) * clamp(delta * 8.5, 0, 1);
                state.reducedSpeedActive = state.safetySpeedFactor < 0.97 && !state.safetyStopped;

                if (maxHazard < 0.08 && nearRisk < 0.08) state.avoidanceSide = 0;
            }
        } else {
            state.safetySpeedFactor += (1 - state.safetySpeedFactor) * clamp(delta * 8.5, 0, 1);
            state.reducedSpeedActive = false;
	        }
	    }

    if (!relaxedContactMotion && nearestCobotPoint && nearestCobotClearance < COBOT_ARM_REDUCED_SPEED_DIST) {
        const selfId = state.selfItem?.id ?? '';
        const otherLoaded = nearestCobotId ? simState.cobotLoads[nearestCobotId] === true : false;
        const selfLoaded = !!state.grabbedItem;
        const equalPriority = selfLoaded === otherLoaded;
        const shouldYield =
            (!selfLoaded && otherLoaded) ||
            (equalPriority && !!nearestCobotId && selfId > nearestCobotId);

        const toOther = nearestCobotPoint.subtract(wristPos);
        if (toOther.lengthSquared() > 0.000001) {
            toOther.normalize();
            const towardOther = Vector3.Dot(desiredVelocity, toOther);
            if (towardOther > 0) {
                desiredVelocity.addInPlace(toOther.scale(-towardOther * (shouldYield ? 1.0 : 0.72)));
            }

            const clearance = Math.max(0, nearestCobotClearance);
            const floorSpeed = shouldYield ? 0 : 0.22;
            const clearanceScale = clamp(
                (clearance - COBOT_ARM_HARD_STOP_DIST) /
                Math.max(0.001, COBOT_ARM_REDUCED_SPEED_DIST - COBOT_ARM_HARD_STOP_DIST),
                floorSpeed,
                1
            );
            desiredVelocity.scaleInPlace(clearanceScale);

            if (shouldYield) {
                const away = toOther.scale(-1);
                away.y = 0;
                if (away.lengthSquared() > 0.000001) {
                    away.normalize();
                    desiredVelocity.addInPlace(away.scale(cruiseSpeed * (1 - clearanceScale) * 0.32));
                }
                state.targetSource = 'yield';
                state.reducedSpeedActive = true;
                state.safetySpeedFactor = Math.min(state.safetySpeedFactor, Math.max(0.05, clearanceScale));
            }
        }
    }

    {
        const step = integrateToolVelocity(state.ikVelocity, desiredVelocity, delta, accel, drag);
        // Only clamp a step that reaches the target along the intended direction.
        // Sideways momentum must not teleport the tool to a nearby waypoint.
        if (distanceToTarget > 0 && Vector3.Dot(step, toTarget) >= distanceToTarget * distanceToTarget) {
            state.ikTarget.copyFrom(state.desiredTarget);
            state.ikVelocity.setAll(0);
        } else {
            state.ikTarget.addInPlace(step);
        }
        clampTargetAboveSupports(state, state.ikTarget, state.phase, !!state.grabbedItem);
    }

    if (
        !Number.isFinite(state.ikTarget.x) ||
        !Number.isFinite(state.ikTarget.y) ||
        !Number.isFinite(state.ikTarget.z)
    ) {
        state.ikTarget.copyFrom(state.desiredTarget);
        if (
            !Number.isFinite(state.ikTarget.x) ||
            !Number.isFinite(state.ikTarget.y) ||
            !Number.isFinite(state.ikTarget.z)
        ) {
            state.ikTarget.copyFrom(state.idleTarget);
        }
        state.ikVelocity.setAll(0);
    }

    solvePose(state, delta, mountPos, L1, L2, L3);

    // Hard surface guard: never allow end-effector to sink into machine/support tops.
    state.gripperTip.computeWorldMatrix(true);
    const tipGuard = state.gripperTip.getAbsolutePosition();
    const guardObstacles = state.grabbedItem ? dropObstacles(state) : (state.selfItem ? [...state.obstacles, state.selfItem] : state.obstacles);
    const guardClearance = toolSurfaceClearance(state, state.phase);
    const guardTop = supportTopAt(tipGuard.x, tipGuard.z, guardObstacles, 0.15);
    const guardMinY = guardTop + guardClearance;
    if (!pickupContactOverride && tipGuard.y < guardMinY) {
        const lift = guardMinY - tipGuard.y;
        state.ikTarget.y += lift;
        state.desiredTarget.y = Math.max(state.desiredTarget.y, state.ikTarget.y);
        state.ikVelocity.y = Math.max(0, state.ikVelocity.y);
    }
    clampPickupHandAboveParts(state);
    resolveHandDiskPartContacts(state);
    resolveArmLinkStackClearance(state);

    if (isRunning && collisionsOn && !pickupContactOverride) {
        const hit = armHitsObstacle(state, state.obstacles);
        if (hit) {
            requestPredictiveReplan(state, hit);
            const penalty = hit.type === 'cobot' ? OVERDRIVE_HIT_PENALTY + 0.3 : OVERDRIVE_HIT_PENALTY;
            state.overdriveScore = Math.max(0, state.overdriveScore - penalty * 0.5);
            if (!isSoftAvoidCollision(state, hit)) {
                state.recoveryTimer = Math.max(state.recoveryTimer, 0.12);
            }
        }
        const partHit = armHitsPart(state);
        if (partHit) {
            const fineContactPhase =
                state.phase === 'pick_hover' ||
                state.phase === 'pick_descend' ||
                state.phase === 'pick_attach' ||
                state.phase === 'hover_drop' ||
                state.phase === 'descend_drop' ||
                state.phase === 'release';
            const pickCommitPhase = state.phase === 'pick_descend' || state.phase === 'pick_attach';
            const contactGain = fineContactPhase ? (partHit.severe ? 0.35 : 0.22) : (partHit.severe ? 1.45 : 1.0);
            state.partContactTimer += delta * contactGain;
            if (!pickCommitPhase || partHit.severe) {
                state.blockedTimer += delta * 0.35;
            }
            state.overdriveScore = Math.max(0, state.overdriveScore - OVERDRIVE_STALL_PENALTY * 0.35);
            if (state.partContactTimer > PART_CONTACT_WARN_TIMEOUT && (!pickCommitPhase || partHit.severe)) {
                state.recoveryTimer = Math.max(state.recoveryTimer, 0.16);
                const fakeObstacle: PlacedItem = {
                    id: `part_contact_${partHit.item.id}`,
                    type: 'pile',
                    position: [partHit.item.pos.x, Math.max(0, partHit.item.pos.y - partHalfHeight(partHit.item)), partHit.item.pos.z],
                    rotation: 0,
                    config: { machineSize: [0.5, 0.5], machineHeight: 0.45 }
                };
                requestPredictiveReplan(state, fakeObstacle);
            }
            if (!fineContactPhase && state.partContactTimer > PART_CONTACT_STOP_TIMEOUT) {
                state.safetyStopped = true;
                state.desiredTarget.copyFrom(state.ikTarget);
                if (state.targetedItem?.state === 'targeted') state.targetedItem.state = 'free';
                state.targetedItem = null;
                state.activeDropTarget = null;
            }
        } else {
            state.partContactTimer = Math.max(0, state.partContactTimer - delta * 2.2);
        }
        if (!hit && !partHit && !state.safetyStopped) state.lastSafeIkTarget.copyFrom(state.ikTarget);
    } else if (isRunning && pickupContactOverride) {
        state.partContactTimer = 0;
        state.blockedTimer = 0;
        state.motionStallTimer = 0;
        state.lastSafeIkTarget.copyFrom(state.ikTarget);
    } else if (isRunning) {
        state.partContactTimer = 0;
        state.blockedTimer = Math.max(0, state.blockedTimer - delta * 4);
        state.lastSafeIkTarget.copyFrom(state.ikTarget);
    }

    // Carry grabbed item
    if (state.grabbedItem) {
        state.gripperTip.computeWorldMatrix(true);
        const wp = state.gripperTip.getAbsolutePosition();
        state.grabbedItem.pos.set(wp.x, wp.y - partHalfHeight(state.grabbedItem) - 0.001, wp.z);
        state.grabbedItem.rotY = state.currentWristRoll;
    }

    // Keep release deterministic through state machine; avoid hidden auto-place teleports here.

    if (isRunning && collisionsOn && !pickupContactOverride) {
        state.gripperTip.computeWorldMatrix(true);
        const tip = state.gripperTip.getAbsolutePosition();
        const probe = state.grabbedItem?.pos ?? tip;
        const probeBottom = state.grabbedItem ? probe.y - partHalfHeight(state.grabbedItem) : tip.y - 0.03;
        const probeRadius = state.grabbedItem ? partRadiusForSpec(state.grabbedItem) : DISC_RADIUS * 0.5;
        const probeMotion = Vector3.Distance(probe, state.lastProbePos);
        const wantsToMove = Vector3.Distance(state.ikTarget, state.desiredTarget) > 0.12;

        const isAllowedPickContact = state.phase === 'pick_hover' || state.phase === 'pick_descend' || state.phase === 'pick_attach';
        const isAllowedDropContact = state.phase === 'hover_drop' || state.phase === 'descend_drop' || state.phase === 'release';
        const dropTarget = currentDropTarget(state);
        const dropOnSelfSupport = !!(
            isAllowedDropContact &&
            dropTarget &&
            state.selfItem &&
            itemFootprintHit(state.selfItem, dropTarget.x, dropTarget.z, 0.08)
        );
        const dropContactRadius = Math.max(DISC_RADIUS, probeRadius) + (dropOnSelfSupport ? 0.18 : 0);
        const pickContact = isAllowedPickContact ? pickupContactState(state, state.targetedItem) : null;
        let blocked = false;

        for (const obstacle of dropObstacles(state)) {
            if (obstacle.type === 'camera') continue;
            // Never treat own cobot body/platform as a hard blocking obstacle for stall-stop logic.
            if (state.selfItem && obstacle.id === state.selfItem.id) continue;
            if (isAllowedPickContact && pickContact?.targetPos) {
                const targetSupportHere = itemFootprintHit(obstacle, pickContact.targetPos.x, pickContact.targetPos.z, 0.06);
                if (
                    targetSupportHere &&
                    pickContact.horizontalDist < Math.max(PICK_GRAB_RADIUS * 1.45, pickContact.targetRadius * 1.18)
                ) {
                    // During precise pickup, allow contact against the target support surface
                    // (belt/table) so we don't bounce away right before attach.
                    continue;
                }
            }
            if (isAllowedDropContact && dropTarget) {
                const dx = probe.x - dropTarget.x;
                const dz = probe.z - dropTarget.z;
                const nearActiveDrop = Math.sqrt(dx * dx + dz * dz) < dropContactRadius;
                if (nearActiveDrop && itemFootprintHit(obstacle, dropTarget.x, dropTarget.z, 0.08)) {
                    continue;
                }
                if (dropOnSelfSupport && state.selfItem && obstacle.id === state.selfItem.id && nearActiveDrop) {
                    continue;
                }
            }
            if (!itemFootprintHit(obstacle, probe.x, probe.z, state.grabbedItem ? probeRadius : 0.04)) continue;
            if (probeBottom <= machineTopY(obstacle) + 0.02) {
                blocked = true;
                if (wantsToMove && probeMotion < 0.003) {
                    state.blockedTimer += delta;
                    const avoidanceKickIn = dropOnSelfSupport ? 0.42 : 0.24;
                    const stallTimeout = dropOnSelfSupport ? 2.1 : STUCK_STALL_TIMEOUT;
                    if (state.blockedTimer > avoidanceKickIn && state.retreatTimer <= 0) {
                        requestPredictiveReplan(state, obstacle);
                    }
                    if (state.blockedTimer > stallTimeout) {
                        startRecoveryRetreat(state, obstacle);
                        state.blockedTimer = 0;
                        state.motionStallTimer = 0;
                        if (state.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
                            state.safetyStopped = true;
                            state.retreatTarget = null;
                            state.retreatTimer = 0;
                            state.desiredTarget.copyFrom(state.ikTarget);
                            if (state.targetedItem?.state === 'targeted') state.targetedItem.state = 'free';
                            state.targetedItem = null;
                            state.activeDropTarget = null;
                            state.phase = 'idle';
                            state.waitTimer = 0;
                            logCobotEvent(state, 'safety_stop', 'stuck_on_drop_obstacle');
                            flushPhaseLog(state);
                            return true;
                        }
                    }
                }
                break;
            }
        }
        if (!blocked || !wantsToMove || probeMotion >= 0.003) {
            state.blockedTimer = 0;
        }
        const obstacleHitNow = armHitsObstacle(state, state.obstacles);
        const partHitNow = armHitsPart(state);
        const fineContactPhase =
            state.phase === 'pick_hover' ||
            state.phase === 'pick_descend' ||
            state.phase === 'pick_attach' ||
            state.phase === 'hover_drop' ||
            state.phase === 'descend_drop' ||
            state.phase === 'release';
        const isSelfObstacleHit = !!(obstacleHitNow && state.selfItem && obstacleHitNow.id === state.selfItem.id);
        const obstacleStallRisk = !!obstacleHitNow && !isSelfObstacleHit && (!pureVerticalContactMotion || obstacleHitNow.type === 'cobot');
        const partStallRisk = !!partHitNow && (!fineContactPhase || partHitNow.severe);
        const hazardStall = blocked || obstacleStallRisk || partStallRisk;
        const movementDemand = wantsToMove || (pureVerticalContactMotion && verticalTargetDelta > 0.04);
        const noProgress = probeMotion < STALL_PROGRESS_EPSILON;
        if (movementDemand && hazardStall && noProgress) {
            state.motionStallTimer += delta;
            const stallTimeout = (fineContactPhase || pureVerticalContactMotion) ? CONTACT_STALL_TIMEOUT : STUCK_STALL_TIMEOUT;
            if (state.motionStallTimer > stallTimeout) {
                state.safetyStopped = true;
                state.blockedTimer = 0;
                state.motionStallTimer = 0;
                state.retreatTarget = null;
                state.retreatTimer = 0;
                state.ikVelocity.setAll(0);
                state.desiredTarget.copyFrom(state.ikTarget);
                if (state.targetedItem?.state === 'targeted') state.targetedItem.state = 'free';
                state.targetedItem = null;
                state.activeDropTarget = null;
                state.phase = 'idle';
                state.waitTimer = 0;
                logCobotEvent(state, 'safety_stop', 'overload_stall_emergency');
                flushPhaseLog(state);
                return true;
            }
        } else {
            state.motionStallTimer = Math.max(0, state.motionStallTimer - delta * 3.5);
        }
        state.lastProbePos.copyFrom(probe);
    } else if (isRunning && pickupContactOverride) {
        state.gripperTip.computeWorldMatrix(true);
        const tip = state.gripperTip.getAbsolutePosition();
        state.lastProbePos.copyFrom(tip);
        state.blockedTimer = 0;
        state.motionStallTimer = 0;
    } else if (isRunning) {
        state.blockedTimer = Math.max(0, state.blockedTimer - delta * 4);
        state.motionStallTimer = Math.max(0, state.motionStallTimer - delta * 4);
    }

    flushPhaseLog(state);

    // ── TORQUE AND OVERLOAD MONITORING ──────────────────────────────────────
    const currentAngles: [number, number, number, number] = [
        state.basePivot.rotation.y,
        state.shoulder.rotation.x,
        state.elbow.rotation.x,
        state.wrist.rotation.x
    ];

    const angularDelta = (current: number, previous: number) => {
        let diff = current - previous;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        return Math.abs(diff);
    };
    
    const wantsToMoveFast = state.ikVelocity.length() > 0.2;
    
    for (let i = 0; i < 4; i++) {
        const angleDiff = angularDelta(currentAngles[i], state.lastJointAngles[i]);
        // If we want to move but the joint is static, torque increases
        const load = (wantsToMoveFast && angleDiff < 0.001) ? 0.85 : (angleDiff * 2.5);
        state.jointTorques[i] = state.jointTorques[i] * 0.85 + load * 0.15;
        state.lastJointAngles[i] = currentAngles[i];
    }


    // High-resolution Motion Trace (log every point for debugging)
    const speed = state.ikVelocity.length();
    if (speed > 0.05 || state.phase !== 'idle') {
        logCobotEvent(state, 'motion_trace', `v=${speed.toFixed(3)} targetSource=${state.targetSource || 'unknown'}`);
    }

    // ── Path Visualization Update ──────────────────────────────────────────
    updateCobotPath(state);

    return false;
}
