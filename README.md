# Cobot Factory Simulator

An interactive 3D physics simulation and programming environment for industrial collaborative robots (Cobots). Built with React, TypeScript, and Babylon.js.

## Features
- **3D Factory Sandbox**: Place and configure various industrial modules like parts senders, conveyor belts, indexed receivers, tables, smart cameras, and 6-axis cobots.
- **Visual Programming**: Teach the cobot complex workflows using simple point-and-click `move`, `pick`, and `drop` instructions directly in the 3D space.
- **Smart Vision System**: Mount cameras to any surface. Cameras scan parts, enabling cobots to filter picks by specific colors and sizes.
- **Auto-Stacking & Organizing**: Cobots can automatically organize items into clean grids on their back platform or onto smart tables based on part color and size.
- **Custom Part Creator**: Design your own custom shapes (cans, boxes, discs, pyramids) and customize their colors and sizes.
- **Kinematic Physics System**: Full inverse kinematics engine allows the cobots to physically reach for items, featuring safety stops if they drop parts over empty space or collide with obstacles.
- **Save & Load**: Save your fully configured factory layouts and cobot programs locally as JSON via the UI dashboard.

## How to Play / Instructions

1. **Camera Controls**:
   - Left-click and drag on the floor to rotate the camera.
   - Right-click and drag to pan the camera.
   - Scroll wheel to zoom in and out.

2. **Building Your Factory**:
   - Use the **Top Toolbar** to select an item to build (Belt, Cobot, Sender, Receiver, Camera, Table).
   - Hover over the 3D grid and click to place the item. 
   - Press **`R`** to rotate the item before placing.
   - Press **`Escape`** or click the red "Cancel" button to exit build mode.

3. **Moving & Modifying Items**:
   - Click the **Move (Arrows)** icon in the top toolbar to enter move mode.
   - Click an item to bring up the 3D movement arrows (Gizmo). Drag the arrows to move the item (it will snap perfectly to the grid).
   - In Move Mode, click an item to open its **Settings Panel** on the right side. You can resize belts/tables, change speeds, link cameras, and set sorting rules.
   - **Delete** an item by clicking the Trash icon in its settings panel.

4. **Programming the Cobot**:
   - Select a Cobot while in Move Mode to see its property panel.
   - Use the `Pick`, `Drop`, and `Wait` buttons to add steps to its program. 
   - After clicking `Pick` or `Drop`, click anywhere in the 3D scene to set the target location.
   - Press the **Play** button on the bottom bar to start the simulation!

5. **Safety Locks (Collisions)**:
   - If a cobot tries to drop an item over empty air or runs into a blockage, it will trigger an Emergency Stop and turn red.
   - Select the paused cobot and click **"UNLOCK COBOT"** to automatically return it to its safe home position and clear the error.

## Tech Stack
- **Frontend**: React, TypeScript, TailwindCSS via CDN, Zustand (lightweight store)
- **3D Engine**: Babylon.js with Havok Physics Engine (WASM)
- **Icons**: Lucide-React
- **Build Tool**: Vite

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
