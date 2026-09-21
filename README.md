# Dungeon Omega WebXR viewer

This site displays `dungeon_omega.glb` directly; the original asset is never rewritten or converted.

## Run locally

From this folder, run:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. A web server is required because browser module and GLB loading are blocked from `file://` URLs.

## Quest 3 / GitHub Pages

Push these files (including the GLB) to a GitHub repository and enable **Pages** from the branch root. Open the HTTPS Pages URL in the Quest Browser and choose **Enter VR**. WebXR requires HTTPS (localhost is the only usual exception).

Controls: left stick walks at 0.45 m/s; right stick turns smoothly at a deliberately slow 1.15 rad/s. **Home / Reset**, the `H` key, or the Quest Touch **A/X** button returns to the starting position.

## Asset findings

- `geometry_0`: glTF primitive mode `POINTS`, 1,000,000 vertices; `POSITION` is float32 VEC3 (12 MB), and `COLOR_0` is normalized unsigned-byte RGBA (4 MB).
- `geometry_1` through `geometry_21`: 21 indexed triangle meshes with `extras.processed: true`, 14 vertices and 48 triangles each. These are colored camera-frustum markers and are hidden in the viewer, not removed from the GLB.
- The shared root transform is almost exactly a 180° rotation around X, giving Three.js a Y-up view. Unscaled reconstruction bounds are X 1.472, Y 0.996, Z 2.620 GLB units. Since VGGT reconstruction scale has no absolute unit, `SCENE_SCALE_METERS = 4.8` is an adjustable initial human-scale estimate.
