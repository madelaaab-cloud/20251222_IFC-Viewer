# 20251222_IFC-Viewer

20251222_IFC-Viewer is a lightweight web app for loading IFC models in the browser, inspecting element properties, and using section planes and type filters to explore large BIM files without a backend.

## Features
- Upload and view IFC files in a 3D scene
- Click elements to inspect properties and parameters
- Add section planes for cut views
- Filter common element types (walls, slabs, columns, beams, doors, windows)

## Getting Started
1. Install dependencies: `npm install --legacy-peer-deps`
2. Start the dev server: `npm run dev`
3. Open the local URL printed in the terminal.

## Controls
- Orbit: drag with left mouse button
- Zoom: mouse wheel or trackpad scroll
- Inspect: click an element in the model
- Section planes: use the panel buttons to add or clear planes
- Filters: toggle checkboxes to hide/show element types
