# Cobot simulation audit

## Result

The simulation has reproducible control bugs, not just difficult geometry. The roughly 4,500-line cobot controller lets acquisition, phase logic, goal caching, path planning, collision response, and inverse kinematics independently modify the same target. Their rules can disagree.

The supplied `cobot_log.json` records entry into `pick_descend` at simulation time 25.578 and still shows that phase at 55.066, with zero commanded velocity and no successful grab or drop. It contains no full layout or part history, so it cannot reproduce the exact original scene. The tests use controlled layouts instead.

Existing local edits in the controller and both lockfiles were preserved. No packages were installed.

## Fixed

1. **Selected stationary parts were not the actual aim point.** Acquisition accepted table parts up to 1.5 units from the taught point, but hover/descent clamped their position to a much smaller radius and biased it back toward the taught point. A medium disc at X=0.8 produced a commanded X=0.506 and repeatedly failed pickup. Stationary approaches now use the selected part's position. Conveyor tracking retains its capture window.
2. **Pickup deadlines could fail to expire.** General stall logic subtracted time while pickup logic added it. In addition, unsuccessful near-contact latch branches could bypass timeout branches every frame. Pickup elapsed time is now preserved and failed latches still evaluate their deadline. Acquisition resets its wait timer.
3. **Lift and drop transitions used the previous waypoint.** `finalReached` was computed before each phase assigned its goal, after the preceding frame had replaced that goal with a waypoint. Tests observed transition to drop descent well away from the destination. Lift, transit, and hover now check the actual tool against their current goal; pickup clearance happens before horizontal transfer.
4. **Cached goals prevented final approach.** A second goal lock could preserve the preceding phase's endpoint. Hover also ignored changed goals or changes smaller than its acceptance requirements. The redundant goal lock no longer overrides phase goals, and precise approach replanning uses a smaller threshold. Travel height no longer continually adds 0.08 to the current height.
5. **Base yaw disagreed with the other joints.** Base yaw used a future waypoint while shoulder/elbow IK used the current Cartesian target. The actual tool could swing away from the planned path. All three now solve against the current target, with the existing yaw speed limit retained.
6. **Pause orphaned a pickup.** A paused tick reset the phase to idle while retaining a targeted part and advancing simulation time. Pausing now preserves the phase, reservation, and deadlines. Manual jog and tuning remain available.
7. **Some reset paths lost part reservations.** Unlock and manual-control setup cleared the target reference without freeing its `targeted` state. These paths now release that reservation. A cleared safety stop now returns to idle instead of leaving the controller in an unhandled recovery phase. Normal programmed drops also remember the released item for exit-contact handling.
8. **Runtime names and controller types were broken.** Fixed undefined `st` in collision-disable handling, undefined platform half-width/depth in teaching overlays, an invalid log type import, missing log fields, a duplicate object property, nullable part geometry, and the path-line mesh type.

## Remaining findings

These are code-review findings; they are not covered by the passing manipulation tests.

| Priority | Finding | Evidence / consequence |
| --- | --- | --- |
| High | Generated auto-organize programs are overwritten by store synchronization | `frontend/components/BabylonScene.tsx:1372` assigns the configured program on every frame, even when the controller has generated a temporary auto program. The same assignment exists in layout synchronization. Empty configured programs can erase autonomous work. |
| High | Safety recovery commands no actual movement | `frontend/babylon/cobotMesh.ts:2519` assigns a recovery target but returns before motion integration and IK. It can clear when the obstruction disappears; it cannot execute its advertised retreat while the obstruction remains. Also, `lastSafeIkTarget` is updated even after collision detection. |
| High | Deleting a cobot can orphan its part | `frontend/components/BabylonScene.tsx:395` removes the runtime state without releasing its targeted or grabbed item. That item may remain unavailable or suspended. |
| High | Drop destinations have no reservation shared by robots | Pickup uses the part's `targeted` state, but drop selection uses current occupancy and local locks. Two carrying robots can choose the same empty location before either releases. Needs a two-robot integration test and explicit destination ownership. |
| Medium | Collision and reach models remain inconsistent | Multiple collision layers separately change targets. Clearance uses conservative link bounds, and the reach envelope differs from the wrist-offset IK calculation. Complex layouts and restricted joint limits need further validation; successful simple layouts do not establish arbitrary reachability. |
| Medium | Torque display never reads runtime state | `frontend/components/UI.tsx:1035` reads `simState.cobotStates`, which does not exist. Its guard silently prevents updates. |
| Medium | Motion tracking and logs need lifecycle work | The module-level `itemMotionTracker` is never pruned/reset and is timed using individual cobot clocks. Every moving tick also appends a trace into a 600-entry log, quickly evicting useful earlier events. |
| Medium | Type checking is not part of the build | The production build passes while an explicit TypeScript check still reports 20 diagnostics in scene/UI/entity/store/entrypoint code. These include invalid Babylon properties, the missing torque state, and an effect cleanup returning a boolean. |
| Low | Large initial asset bundle | The build reports a Babylon chunk of about 6.55 MB before gzip (1.44 MB gzip). Loading/rendering performance needs a separate browser profile. |

## Validation

From `frontend`, using Node 24.19:

```sh
npm test
npm run build
node node_modules/typescript/bin/tsc --noEmit --jsx react-jsx --module esnext --moduleResolution bundler --target es2022 --allowSyntheticDefaultImports --skipLibCheck index.tsx
```

- Nine headless Babylon regression tests pass: offset disc/can/box/pyramid pickup and exact placement with collision checks enabled; correct destination alignment before descent; pause/resume; advancing pickup deadlines; stale-contact timeouts in descent and attach; and a slowly moving conveyor part.
- Production build passes, with the bundle-size warning above.
- The explicit TypeScript check still fails on the remaining diagnostics above. It now reports no diagnostics in the cobot controller or its supporting modules.
- Tests exercise real meshes, world transforms, and controller ticks through Babylon's `NullEngine`. Conveyor movement is supplied by the test. They do not execute the React render loop, full scene physics, camera rendering, multiple robots, or the user's persisted browser layout. Some collision-enabled test cycles take tens of simulated seconds; these tests establish completion, not optimized throughput.

## Complexity reduction

Keep one owner for each decision: a part/destination reservation service, a phase state machine that outputs a semantic goal, a planner that outputs waypoints, and an IK/motion layer that executes them. Collision handling should return an explicit blocked/replan result rather than silently rewriting a phase's goal. Replace string phases and independent nullable fields with a discriminated state type. Extract these responsibilities incrementally behind the regression tests; a wholesale rewrite would obscure the verified fixes.
