# 3D Models Guide for Magical Carpet

## 🎯 Where to Find Free 3D Models

### **1. Poly Pizza** ⭐ (RECOMMENDED for this project)
- **URL**: https://poly.pizza
- **License**: CC0 (Public Domain)
- **Why**: Specifically curated for game dev, all low-poly style perfect for Magic Carpet
- **What to search**: "tree", "pine", "oak", "bird", "butterfly"
- **Format**: GLB (directly compatible)

### **2. Kenney Assets** ⭐ (Game Dev Favorite)
- **URL**: https://kenney.nl/assets?q=3d
- **License**: CC0 (No attribution needed!)
- **Packs to check**:
  - Nature Kit: https://kenney.nl/assets/nature-kit
  - Platformer Kit: https://kenney.nl/assets/platformer-kit
  - Racing Kit (has trees): https://kenney.nl/assets/racing-kit
- **Format**: GLB/GLTF
- **Why**: Massive collection, consistent style, optimized for games

### **3. Quaternius** ⭐ (Huge Free Library)
- **URL**: https://quaternius.com/index.html
- **License**: CC0
- **Collections**:
  - Ultimate Nature Pack
  - Ultimate Animals Pack
  - Lowpoly Medieval
- **Format**: FBX/GLB
- **Why**: Professional quality, game-ready, massive variety

### **4. Sketchfab** (Quality but requires filtering)
- **URL**: https://sketchfab.com/3d-models?features=downloadable&licenses=7c23a1ba438d4306920229c12afcb5f9
- **License**: Filter by CC0 or CC-BY
- **Search**: "low poly tree", "stylized bird", "butterfly"
- **Format**: GLB/GLTF (select when downloading)
- **Note**: Quality varies, check poly count

### **5. Three.js Examples** (Code-Based)
- **URL**: https://github.com/mrdoob/three.js/tree/dev/examples
- **Why**: Procedural geometry you can copy/adapt
- **Look for**: BufferGeometry examples
- **Format**: JavaScript code

## 📦 Downloading and Adding Models

### Step 1: Download Models

**Recommended starting pack:**
1. Go to Poly Pizza: https://poly.pizza
2. Search: "tree low poly"
3. Download 3-5 different tree models (GLB format)
4. Save to: `/home/user/magical-carpet/public/assets/models/`

**Example models to search for:**
- "pine tree low poly"
- "oak tree stylized"
- "cartoon tree"
- "low poly bird"
- "butterfly 3d"

### Step 2: Create Models Directory

```bash
cd /home/user/magical-carpet
mkdir -p public/assets/models
```

### Step 3: Add Model Paths to SimpleTreeSystem

Edit: `/home/user/magical-carpet/src/game/systems/SimpleTreeSystem.js`

Find this section (around line 23):
```javascript
// Model paths (user will add these)
this.modelPaths = [
  // Examples - user should download models and add paths here:
  // '/assets/models/tree1.glb',
  // '/assets/models/tree2.glb',
  // '/assets/models/tree3.glb',
];
```

Replace with your downloaded models:
```javascript
this.modelPaths = [
  '/assets/models/pine_tree.glb',
  '/assets/models/oak_tree.glb',
  '/assets/models/round_tree.glb',
];
```

### Step 4: Test

1. Run `npm run dev`
2. Check browser console for:
   - "Loaded tree model: /assets/models/pine_tree.glb"
   - "Spawned X trees in chunk..."
3. If models don't load, system will automatically use procedural fallback

## 🎨 Model Requirements

**Optimal specs for this game:**
- **Poly Count**: 100-500 triangles per tree (low-poly!)
- **Scale**: Around 1-5 units tall
- **Origin**: Base of tree at (0,0,0)
- **Format**: GLB or GLTF
- **Textures**: Baked or simple colors (avoid complex PBR)

## 🔧 Adjusting Tree Spawning

Edit `SimpleTreeSystem.js` constructor to tune:

```javascript
// Configuration
this.treeDensity = 0.03;       // 0.01 = sparse, 0.05 = dense
this.attemptsPerChunk = 30;    // More attempts = more trees
this.minTreeDistance = 20;      // Min space between trees
this.maxTreesPerChunk = 15;     // Hard limit per chunk
```

## 🐦 Adding Bird/Butterfly Models

Same process! Just create similar systems:
- `SimpleBirdSystem.js` - for flying GLB models
- `SimpleButterflySystem.js` - for fluttering models

Or add model support to existing `AmbientLifeSystem.js`

## 🎯 Quick Start (5 Minutes)

**Fastest way to get trees working:**

1. Go to Kenney Nature Kit: https://kenney.nl/assets/nature-kit
2. Click "Download" (it's free!)
3. Extract and find GLB files in the downloaded package
4. Copy 3-5 tree GLB files to `public/assets/models/`
5. Edit `SimpleTreeSystem.js` modelPaths array
6. Run `npm run dev`

**If you don't want to download anything right now:**
- The system automatically uses procedural fallback trees!
- You'll see simple cone (pine) and sphere (round) trees
- Still looks decent, just not as detailed

## 📝 Notes

- **Performance**: GLB models are already optimized and compressed
- **No attribution needed**: All recommended sources are CC0
- **Mix and match**: Use models from different sources
- **Scale in code**: Don't worry about exact model size, we scale them in `spawnTree()`

## 🚀 Advanced: Custom Models

Want to create your own trees in Blender?

1. Create simple low-poly tree (under 500 tris)
2. Apply materials/textures
3. Export as GLB (not GLTF + bin)
4. Place in `public/assets/models/`
5. Add path to `modelPaths` array

Done!
