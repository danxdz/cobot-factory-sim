# Cobot simulation audit

## Result

The second audit reproduced a default-layout drop deadlock that the earlier controlled layouts missed. This report replaces the previous audit; previously fixed issues are not listed as open findings.

The browser test ran the actual React/Babylon scene with conveyor physics and both default cobots. Before the reach fix, both robots held a part in `transit_drop` after 43 simulated seconds. After the fix, both completed a drop by 14.2 simulated seconds in the observed run. Spawn timing and part selection are randomized, so this is a reproduction result rather than a throughput guarantee.

## Confirmed and fixed in this pass

| Priority | Defect | Change and evidence |
| --- | --- | --- |
| High | Default-layout transfer waits for an unreachable high travel pose | Motion projected the point into reach while phase completion compared against the original point. Transit now completes at the projected staging pose, then approaches the lower destination. Reproduced in the browser and covered for both default robots and all four part shapes. |
| High | Sorted drop selection chooses unreachable slots | Candidate slots must have a reachable hover approach. Receivers prefer the center, then try points within their existing capture radius when the center approach is unreachable. Exact unsorted taught positions are preserved. |
| High | Pick jumps past taught move/wait steps | Carry execution now follows the program sequence and keeps the gripper closed while holding a part. Regression checks that the waypoint is reached and the entire wait runs. |
| High | Receivers away from the 2.5-unit grid fail to score | Scene physics now chooses the support by its actual footprint and height. Real-browser tests verify both receiver types at X=2.2. Both receiver types also respect configured color and size filters. |
| Medium | Controller and physics disagree on support heights | Both now use the same world-height calculation. This includes elevated modules and the pile floor's 0.02 thickness; pile-wall and receiver-spindle clearance also follows configured height. Mesh-bound tests verify the surfaces. |
| Medium | Rectangular table rotation changes physics but not the mesh | Tables now apply the configured rotation. Test verifies visual bounds and support footprint agree. |
| Medium | Path visualization updates a fixed two-vertex buffer with variable-length routes | The overlay recreates its buffers only when waypoint count changes and skips updates when hidden. It is disposed on robot deletion/rebuild. Covered by a lifecycle test and real WebGL execution. |
| Medium | Collision frames overwrite the last safe recovery pose | The pose is retained when an obstacle/part collision or safety stop is detected. Existing recovery tests still pass. |
| Medium | Restart retains sensor/preview timing from the previous run | Reset now clears sensor slowdown and preview/log clocks along with scene release-history maps. |
| Medium | Runtime changes serialize and write the layout repeatedly | localStorage writes now happen only when persisted layout/preferences change. Store regression verifies telemetry/selection updates do not write, while configuration changes do. |
| Low | Obsolete transformation scripts and Vite configuration warning | Removed six one-off refactor scripts. Updated the Vite path alias to use import.meta.dirname. |

Earlier fixes remain covered: acquisition timeouts, stationary offset pickup, pause/resume, generated auto-organize programs, reservation ownership, occupied-drop waiting, restart registration, collision recovery, and the loaded-gripper clearance mismatch. The four controlled shape cycles still complete in roughly 5.7-6.1 simulated seconds with collision checks enabled.

## Validation

Run from `frontend`:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd audit
```

- 40 automated tests passed with Babylon NullEngine and real mesh transforms. Includes controller updates at 8, 15, 30, and 60 Hz, elevated bins, default-layout rear transfers, and taught program sequencing.
- TypeScript check and production build passed. Vite still warns about the large Babylon bundle (about 6.44 MB raw / 1.41 MB gzip).
- npm audit reported zero known vulnerabilities.
- Isolated headless Chrome passed four controlled start/stop pick/drop cycles, WebGL/path rendering, off-grid receiver scoring, then a full default-layout run with both robots completing drops. No browser runtime/console errors were captured. The script uses a separate temporary browser profile and does not read or overwrite the user's saved layout.

To reproduce the browser integration check, start a dedicated dev server in one terminal:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5188 --strictPort
```

Then, in another terminal in `frontend`:

```powershell
node tests/browser-smoke.mjs
```

The script defaults to the standard Windows Chrome installation. Set `CHROME_PATH` for a different Chromium executable. It uses debugging port 9229; keep that port free.

## Remaining findings and limits

1. **Long-run performance:** dead parts are compacted with their index-keyed velocity maps, but several physics/vision loops still scan live parts or compare pairs. Large live-part populations and pooled meshes still need sustained performance testing.
2. **Arbitrary/custom reachability:** automatic destination selection checks the two-link reach envelope, not a complete joint-limit/collision-free reachability search. Extreme joint settings or an explicitly taught unreachable exact drop can still fail to complete. No global deadlock-free guarantee exists for crowded multi-robot layouts.
3. **Large time steps:** low-frequency controller ticks were tested, but the scene still uses variable time steps. A long background-tab pause or 10x speed on a slow device needs dedicated full-scene testing/substepping.
4. **Persistence validation:** parsed saved layouts do not have comprehensive schema validation. Malformed manually edited storage/imported configuration remains a potential failure source.
5. **Coverage:** the actual saved layout in the user's normal browser profile has not been loaded. Browser validation covers a fresh default layout and explicit fixtures. Receiver filters were inspected and corrected, but every filter combination and custom part geometry has not been exercised in-browser.

These are open findings, not claims that every layout is correct. The default-layout transit deadlock and the other defects listed above have concrete fixes and verification.

## Motion-smoothing follow-up

The motion layer now integrates velocity once, after proximity/yield constraints. An analytic velocity response replaces the separate frame-dependent blend/damping paths, including the accidental double blend near taught move endpoints. Tool displacement is integrated over the frame rather than approximated using only the final velocity. Endpoint clamping checks motion along the target direction, so sideways momentum cannot trigger a snap to the waypoint.

Wrist roll and tool-orientation blending use a bounded exponential response. Slow frames no longer multiply wrist-angle error by a factor greater than one and overshoot the commanded angle.

Validation: 43 automated tests and the production build pass. New tests compare velocity and displacement at 8, 15, 30, 60, and 144 Hz for the same command, check smooth direction reversal, and verify slow-frame wrist convergence. The full four-shape pick/drop fixtures complete in 5.75-6.53 simulated seconds. This makes the motion response frame-rate independent; the complete scene physics and collision decisions still use variable time steps, as noted above.

The next architectural simplification would separate scene simulation from rendering, enabling fixed-step physics with render interpolation. Collision-aware corner blending can follow; contact waypoints should remain exact.

The smoothing follow-up also passed the real-browser smoke test: four controlled restart/pick/drop cycles, receiver scoring, and both default cobots completing drops by 14.3 simulated seconds, with no captured browser errors.

## First Shift game layer

Added a separate, temporary challenge mode with a 180-second simulation clock, a 5,500-credit equipment budget, a repeatable 24-part feed, destination-specific orders, and medal/results feedback. Store guards lock the feed/receivers and prevent free credits or unsupported purchases. Retry preserves the edited equipment; reset restores the starter kit. Exiting restores the Sandbox snapshot, and challenge changes never persist over the Sandbox save.

The first browser run exposed missed pickups in the starter configuration and a reject outlet that accumulated parts at its entrance. The challenge now uses faster robots, slower pickup belts, and an entrance capture rule for its reject outlet. Sandbox receiver behavior is unchanged.

Validation: all 48 automated tests and the production build pass. Isolated Chrome runs completed the starter order in approximately 56.5 simulated seconds at 3x speed. The browser check also covers pause/resume, retry, actual reject intake, timeout, Sandbox storage restoration, and modal keyboard isolation. Desktop briefing, planning, results, and a 390px mobile briefing were visually inspected. No browser runtime/console errors were captured. Run `node tests/browser-smoke.mjs --challenge` with Vite on port 5188 to reproduce.

This is one introductory challenge, with no persistent medals or campaign progression yet. The incoming sequence is repeatable; full physics outcomes still depend on variable frame timing. The existing Babylon bundle-size warning remains.

## Path and perception audit

The cobots read live `simState.items` positions, colors, sizes, ownership, and stack coverage. Pickup candidates are filtered around the taught pickup point and by reach, then ranked by distance, crowding, and camera confidence/offset. Linking a camera biases those rankings; it does not require a detection before pickup. Obstacle geometry comes from placed machine footprints/heights, part geometry, and neighboring robot samples, not camera pixels. The wrist's four directional sensor indicators summarize nearby simulated geometry.

Each program phase chooses a Cartesian tool target. The planner adds clearance/lift waypoints and obstacle detours; motion applies speed, proximity, and recovery constraints; two-link inverse kinematics converts the tool target into base, shoulder, elbow, and wrist angles. Final pickup/drop phases command contact targets directly. The planner remains a geometric heuristic with runtime collision checks, not a complete joint-space path search.

Reproduced and corrected:

- **Initial pose mismatch:** a fresh default arm was drawn with zero joint angles at tip Y=5.715 while its controller target was Y=2.2. Its first tick moved the visible tool about 3.6 scene units. Creation now solves the home pose before displaying the robot; a regression bounds first-frame displacement.
- **Base-axis crossing:** front-to-back paths could pass directly through the yaw axis, where the target angle flips by approximately 180 degrees. Transport now uses tangent/arc waypoints around that axis, including loaded transport. Exact contact targets remain intact.
- **Repeated pickup replanning:** small moving-target drift restarted the approach. Clear, small endpoint updates now retain completed waypoints; larger displacement or obstruction still triggers planning. Removed unnecessary elevated midpoints on clear routes.
- **Double velocity prediction:** interception added nominal belt travel and measured part travel together, then blended toward potentially old camera coordinates. It now uses one planar velocity estimate, with the same 0.92 belt speed factor as scene physics and time-based velocity filtering. Camera rankings remain available.
- **Misleading path display:** the bright trajectory showed an entire forecast loop, including old/current points. It now shows only the remaining active route. The separate future-program preview is faint, and its line buffers resize when waypoint count changes. Preview planning no longer mutates the controller's avoidance side.

Validation: 53 automated tests, TypeScript, and production build pass. Before the final initialization correction, isolated Chrome passed four pickup/drop restart cycles, both receiver types, and both default robots. The final version passed the full First Shift browser test in 55.24 simulated seconds with 8 red and 4 blue deliveries and zero rejects, plus pause/retry/timeout and Sandbox restoration. No captured browser errors. Custom saved layouts, arbitrary obstacles, and all joint-limit combinations remain outside that browser coverage.

## Adjacent cobots and shared pickup areas

Reproduced both arms entering permanent recovery when two cobots 2.5 units apart picked neighboring discs from the same table. Also reproduced symmetric idle yielding (both peers retreating) and non-robot sensor warnings incorrectly triggering neighbor parking.

Parking and motion now share the same loaded-part/ID priority rule. General part/table warnings no longer trigger cooperative parking. Neighbor braking preserves the requested direction instead of injecting a sideways repulsion velocity, permits separating motion, and remains enabled during precise pickup/drop contact. The scene refreshes all neighbor pose samples before ticking controllers, including stopped robots.

A pickup now checks the neighboring tool and active pickup/payload area before acquisition. A conflicting robot waits at home until the area clears. This prevents different part reservations from sending two arms into the same small workspace. The loaded pickup lift also uses stack-aware clearance; low taught pickup heights previously ended that lift inside a nearby part's collision margin, trapping recovery at the contact pose.

Automated validation: 60 tests and the production build pass. Independent adjacent transfers finish by 3.48 simulated seconds; shared-table transfers finish by 6.10–6.27 seconds in both controller update orders. Coverage includes one-sided equal-priority yielding, loaded priority, non-robot sensor isolation, and approach/separation braking. These are bounded two-robot fixtures, not a global deadlock guarantee for arbitrary crowded layouts.

The isolated Chrome fixture also passes: two robots 2.5 units apart take adjacent discs from one table, then score deliveries into separate receivers. Both finish by 6.59 seconds, and by 5.68 seconds after restarting; neither is safety-stopped and no browser runtime errors are captured. Run `node tests/browser-smoke.mjs --neighbors` against Vite on port 5188. Receiver positions are within the hover reach envelope. The initial browser fixture's exact unsorted drop points at Z=-2.5 were unreachable at receiver hover height and stalled in `hover_drop`; this remains part of the existing explicitly taught unreachable-target limitation, separate from neighbor coordination.


## Pickup flicker and moving contact

The scene compacted dead parts and their velocity maps without moving their mesh pool entries. The same frame's final transform sync then applied surviving parts to the wrong meshes, including hidden meshes. Meshes and geometry keys now follow their surviving items; retired meshes remain available for reuse. A held part keeps the same visible mesh even when an earlier pool entry disappears.

The final conveyor attachment retry also renewed a frozen pickup target every tick. Moving attachments now track the live intercept, while stationary targets retain their position lock. Contact measurements use the actual part position rather than the closer of a forecast/locked position and the real part.

Browser traces reproduced another visible discontinuity: a randomly oriented part snapped approximately 73?75 degrees to wrist yaw when grabbed. The shared grasp helper preserves the initial yaw offset and rotates the loaded wrist toward the existing zero-yaw drop alignment at a bounded angular speed. Carry synchronization is shared by normal motion, tuning, and recovery. The three latch branches now use one attachment transition.

Validation: 66 automated tests and the production build pass. `node tests/browser-smoke.mjs --pickup` checks actual conveyor physics for disc, can, box, and pyramid, with an earlier mesh slot removed during each carry. All four preserve mesh identity/visibility and tool attachment, complete a drop in 3.22?3.92 simulated seconds at arm speed 1.5 and belt speed 0.5, and produce no browser runtime errors. The largest sampled yaw change falls to approximately 3 degrees per frame. Unit coverage also exercises stale contact locks, angle wrapping, bounded wrist rotation, final drop orientation, and neighboring robot transfers. These fixtures do not certify every saved layout or conveyor speed; simulation/render interpolation remains a separate limitation.


## Angled hand after the first pickup (regression correction)

The smooth wrist rotation exposed an incorrect pitch split in the existing IK pose: a wrist bend before the roll joint and a hand bend after it only cancel correctly when roll is zero. After the first rotated grab, the retained roll angle tilted the suction pad as the empty hand returned. The previous browser fixture restarted between shapes, masking that sequence.

Automatic IK now applies the downward-tool pitch at the wrist before roll and keeps the downstream hand pitch neutral throughout the cycle, matching the straight-down tool length used in the position solver. The obsolete phase-dependent pitch blend has been removed. Manual joint tuning and configured wrist limits remain in force. Mesh rebuilds also retain the grasp yaw offset and wrist target together.

A new regression failed on the old code immediately after the first drop, then passed after the pose correction. All 67 automated tests pass, along with the production build. The browser pickup test now runs all four shapes consecutively without resetting the robot and checks the actual world-space suction-pad normal every rendered frame. All four drops completed by 14.46 simulated seconds; maximum measured tilt was below 0.00001 degrees with default joint limits, with no missing meshes, detached payloads, safety stops, or browser runtime errors. Custom wrist limits can still prevent a vertical tool pose and are not overridden by this fix.


## Wide return swing after a drop

Reproduced default c2's visible hand deviating up to 1.38 world units from its planned Cartesian return. The route itself was short, but the shoulder/elbow advanced at Cartesian cruise speed while the base was still catching up under its angular speed limit. That mismatch produced a broad physical sweep outside the route drawn by the planner.

Motion now bounds progress along each proposed Cartesian segment by the same per-frame angular budget used by the base pose solver. It scales the integrated velocity accordingly and lets the base catch up when needed. This keeps the proposed segment intact instead of projecting the hand sideways, preserves radial motion, and uses the shortest angular difference across the angle wrap. Existing lift clearance, obstacle planning, and neighbor braking remain active. Sharp turns may take longer than the previously inaccurate motion; this is route tracking, not a claim of globally optimal planning for arbitrary layouts.

Validation: the 69-test suite passed, followed by the added default-c2 return regression (70 tests total), plus the production build. The return regression completes with 5.52 units of tool travel and less than 0.0001 units of planar tracking error. `node tests/browser-smoke.mjs --return` also passed in isolated Chrome: c1 completed three deliveries and c2 two, with 163 and 108 sampled return frames respectively, maximum planar tracking errors below 0.000001 units, level suction pads, and no browser runtime errors.
