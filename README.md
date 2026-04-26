# Cobot Factory Simulator

An interactive 3D physics simulation and programming environment for industrial collaborative robots (Cobots). Built with React, TypeScript, and Babylon.js.

## Features
- **3D Factory Sandbox**: Place and configure various industrial modules like parts senders, conveyor belts, indexed receivers, smart pallets (`pile`), and 6-axis cobots.
- **Visual Programming**: Teach the cobot complex workflows using simple point-and-click `move`, `pick`, and `drop` instructions.
- **Smart Staging & Polling**: Cobots can automatically poll multiple stations, skip empty pick zones, and auto-arrange/sort parts by color into smart grids.
- **Kinematic Physics System**: Full inverse kinematics engine allowing the cobots to safely transport items, avoid collisions, and smoothly swing across their workspace.
- **State Export/Import**: Save your fully configured factory layouts and cobot programs locally as JSON via the UI dashboard.

## Tech Stack
- **Frontend**: React, TypeScript, TailwindCSS via CDN, custom lightweight store
- **3D Engine**: Babylon.js
- **Icons**: Lucide-React
- **Build Tool**: Vite

## Project Structure
- `frontend/`: Contains the main simulation app.
  - `components/`: React UI overlays and the main `BabylonScene` canvas.
  - `babylon/`: Core 3D logic, including `cobotMesh` (kinematics/pathing) and `entityMeshes` (module geometry).
  - `store.ts`: Custom global state and local-storage persistence.

## Getting Started

1. Ensure you have Node.js installed.
2. Install dependencies from the root directory:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Open the provided localhost URL in your browser to begin building your factory!
