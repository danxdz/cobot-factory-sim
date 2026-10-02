# Cobot factory simulator

Run locally in PowerShell:

```powershell
cd C:\Users\user\Downloads\cobot-factory-sim\frontend
npm.cmd install
npm.cmd run dev
```

Open the local URL printed by Vite (usually http://localhost:5173). Keep the terminal open; Ctrl+C stops the server. After controller changes, refresh the page and start the simulation again.

To play, choose **Challenges → Open First Shift → Start shift**. Deliver six red discs to the left receiver and four blue boxes to the right receiver within three simulated minutes. The starter line costs 4,450 of your 5,500-credit budget. Tune its robots or buy equipment, then aim for a Gold, Silver, or Bronze medal.

The feed repeats red / blue / red every four simulated seconds, with at most 24 parts. Wrong destinations and the end outlet count as rejects. Pause freezes the clock; simulation speed changes wall-clock duration. **Retry layout** clears the run while keeping your equipment and settings. The reset control restores the starter kit. Results show sorting accuracy, throughput, cost, and robot idle time.

**Sandbox** restores your previous layout, templates, and credits. Challenges are temporary and never overwrite that save; refreshing returns to Sandbox. The feed and receivers are fixed during the challenge, and factory import/export remains available in Sandbox.

Checks, from `frontend`:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd audit
```

With a dev server on port 5188, run `node tests/browser-smoke.mjs --challenge` to verify the game flow in an isolated Chrome profile, including actual robot deliveries and Sandbox restoration.

The public robot entrypoint is `frontend/babylon/cobotMesh.ts`. Controller orchestration, program execution, pickup, placement, reach, planning, collision, motion, lifecycle, and visualization live in separate modules under `frontend/babylon/cobot/`.

See [AUDIT.md](AUDIT.md) for reproduced bugs, verification results, browser-test instructions, and remaining limitations.
