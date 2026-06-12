import * as THREE from 'three';

/**
 * Creates a beautiful flying carpet with:
 * - Curved/draped shape
 * - Fringe/tassels on edges
 * - Rich fabric-like appearance
 */
export class CarpetGeometry {

  /**
   * Create the main carpet body with a gentle curve/drape
   * @param {number} width - Carpet width (default 5)
   * @param {number} length - Carpet length (default 8)
   * @param {number} segments - Subdivision level for smoothness
   * @returns {THREE.BufferGeometry}
   */
  static createCarpetBody(width = 5, length = 8, segments = 16) {
    const geometry = new THREE.PlaneGeometry(width, length, segments, segments);
    const positions = geometry.attributes.position;
    const uvs = geometry.attributes.uv;

    // Apply gentle curve - drape in the middle, slightly raised edges
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i); // This is actually Z in world space after rotation

      // Normalize positions to -1 to 1 range
      const nx = x / (width / 2);
      const ny = y / (length / 2);

      // Create a gentle bowl/drape shape
      // Edges slightly raised, center slightly lower
      const edgeDistance = Math.max(Math.abs(nx), Math.abs(ny));
      const centerDip = (1 - edgeDistance * edgeDistance) * 0.15;

      // Add subtle wave along length for organic feel
      const wave = Math.sin(ny * Math.PI) * 0.08;

      // Side edges curl up slightly
      const edgeCurl = Math.pow(Math.abs(nx), 3) * 0.2;

      // Set the Z position (height)
      const z = -centerDip + wave + edgeCurl;
      positions.setZ(i, z);
    }

    // Rotate to be horizontal (plane is created vertical by default)
    geometry.rotateX(-Math.PI / 2);

    // Recompute normals for proper lighting
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Create fringe/tassels for carpet edges using InstancedMesh for performance
   * @param {number} width - Carpet width
   * @param {number} length - Carpet length
   * @param {number} fringeLength - Length of each tassel
   * @param {number} fringeCount - Number of tassels per edge
   * @returns {THREE.InstancedMesh}
   */
  static createFringe(width = 5, length = 8, fringeLength = 0.5, fringeCount = 8) {
    // Calculate total tassel count
    const sideCount = Math.floor(fringeCount * length / width);
    const totalTassels = (fringeCount * 2) + (sideCount * 2);

    // Create single shared geometry for all tassels
    const tasselGeometry = new THREE.CylinderGeometry(0.025, 0.012, fringeLength, 3);
    tasselGeometry.translate(0, -fringeLength / 2, 0);

    // Create placeholder material (will be set later)
    const tasselMaterial = new THREE.MeshStandardMaterial({
      color: 0xDAA520,
      roughness: 0.9,
      metalness: 0
    });

    // Create InstancedMesh - single draw call for all tassels!
    const fringeMesh = new THREE.InstancedMesh(tasselGeometry, tasselMaterial, totalTassels);
    fringeMesh.castShadow = true;

    const dummy = new THREE.Object3D();
    let instanceIndex = 0;

    // Front and back edges
    const edges = [
      { z: -length / 2, dir: -1 },
      { z: length / 2, dir: 1 }
    ];

    edges.forEach(edge => {
      for (let i = 0; i < fringeCount; i++) {
        const x = (i / (fringeCount - 1) - 0.5) * (width - 0.3);

        dummy.position.set(x, 0, edge.z + edge.dir * 0.05);
        dummy.rotation.set(
          edge.dir * 0.2 + (Math.random() - 0.5) * 0.1,
          0,
          (Math.random() - 0.5) * 0.08
        );
        dummy.updateMatrix();
        fringeMesh.setMatrixAt(instanceIndex++, dummy.matrix);
      }
    });

    // Side edges
    const sideEdges = [
      { x: -width / 2, dir: -1 },
      { x: width / 2, dir: 1 }
    ];

    sideEdges.forEach(edge => {
      for (let i = 0; i < sideCount; i++) {
        const z = (i / (sideCount - 1) - 0.5) * (length - 0.3);

        dummy.position.set(edge.x + edge.dir * 0.05, 0, z);
        dummy.rotation.set(
          (Math.random() - 0.5) * 0.08,
          0,
          -edge.dir * 0.25 + (Math.random() - 0.5) * 0.1
        );
        dummy.scale.set(0.8, 0.7, 0.8); // Slightly smaller on sides
        dummy.updateMatrix();
        fringeMesh.setMatrixAt(instanceIndex++, dummy.matrix);
      }
    });

    fringeMesh.instanceMatrix.needsUpdate = true;
    return fringeMesh;
  }

  /**
   * Create a procedural carpet texture with woven pattern
   * @param {number} size - Texture resolution
   * @param {THREE.Color} primaryColor - Main carpet color
   * @param {THREE.Color} secondaryColor - Pattern accent color
   * @param {THREE.Color} borderColor - Border/edge color
   * @returns {THREE.CanvasTexture}
   */
  static createCarpetTexture(size = 512, primaryColor = null, secondaryColor = null, borderColor = null) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Default rich colors if not provided
    const primary = primaryColor || new THREE.Color(0x8B0000); // Dark red
    const secondary = secondaryColor || new THREE.Color(0xDAA520); // Goldenrod
    const border = borderColor || new THREE.Color(0x1a1a4a); // Dark blue

    // Convert THREE.Color to CSS
    const toCSS = (color) => `rgb(${Math.floor(color.r*255)},${Math.floor(color.g*255)},${Math.floor(color.b*255)})`;

    // Fill background with primary color
    ctx.fillStyle = toCSS(primary);
    ctx.fillRect(0, 0, size, size);

    // Draw border
    const borderWidth = size * 0.08;
    ctx.strokeStyle = toCSS(border);
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(borderWidth/2, borderWidth/2, size - borderWidth, size - borderWidth);

    // Inner border with secondary color
    ctx.strokeStyle = toCSS(secondary);
    ctx.lineWidth = borderWidth * 0.3;
    ctx.strokeRect(borderWidth * 1.2, borderWidth * 1.2, size - borderWidth * 2.4, size - borderWidth * 2.4);

    // Create woven texture pattern
    ctx.globalAlpha = 0.15;
    for (let y = 0; y < size; y += 4) {
      for (let x = 0; x < size; x += 4) {
        if ((x + y) % 8 === 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.1)';
          ctx.fillRect(x, y, 2, 2);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Draw central medallion pattern
    const centerX = size / 2;
    const centerY = size / 2;
    const medallionRadius = size * 0.25;

    // Outer medallion ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, medallionRadius, 0, Math.PI * 2);
    ctx.strokeStyle = toCSS(secondary);
    ctx.lineWidth = size * 0.02;
    ctx.stroke();

    // Inner medallion
    ctx.beginPath();
    ctx.arc(centerX, centerY, medallionRadius * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = toCSS(border);
    ctx.fill();

    // Center star/flower pattern
    const points = 8;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const radius = i % 2 === 0 ? medallionRadius * 0.5 : medallionRadius * 0.25;
      const px = centerX + Math.cos(angle) * radius;
      const py = centerY + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = toCSS(secondary);
    ctx.fill();

    // Corner decorations
    const cornerSize = size * 0.12;
    const corners = [
      [borderWidth * 2, borderWidth * 2],
      [size - borderWidth * 2, borderWidth * 2],
      [borderWidth * 2, size - borderWidth * 2],
      [size - borderWidth * 2, size - borderWidth * 2]
    ];

    corners.forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, cornerSize, 0, Math.PI * 2);
      ctx.fillStyle = toCSS(secondary);
      ctx.globalAlpha = 0.3;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Small diamond in corner
      ctx.beginPath();
      ctx.moveTo(cx, cy - cornerSize * 0.5);
      ctx.lineTo(cx + cornerSize * 0.5, cy);
      ctx.lineTo(cx, cy + cornerSize * 0.5);
      ctx.lineTo(cx - cornerSize * 0.5, cy);
      ctx.closePath();
      ctx.fillStyle = toCSS(border);
      ctx.fill();
    });

    // Add some noise for fabric texture
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 15;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;

    return texture;
  }

  /**
   * Create complete carpet mesh with body, fringe, and material
   * @param {object} options - Configuration options
   * @returns {THREE.Group}
   */
  static createCarpet(options = {}) {
    const {
      width = 5,
      length = 8,
      primaryColor = new THREE.Color(0x8B0000),
      secondaryColor = new THREE.Color(0xDAA520),
      borderColor = new THREE.Color(0x1a1a4a),
      includeFringe = true,
      segments = 12 // Reduced from 16 for better performance
    } = options;

    const carpetGroup = new THREE.Group();

    // Create carpet body
    const bodyGeometry = this.createCarpetBody(width, length, segments);
    const texture = this.createCarpetTexture(256, primaryColor, secondaryColor, borderColor); // Reduced from 512

    const bodyMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide
    });

    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = false; // Don't receive shadows for performance
    body.name = 'carpetBody';
    carpetGroup.add(body);

    // Add fringe (now using InstancedMesh - single draw call)
    if (includeFringe) {
      const fringe = this.createFringe(width, length, 0.5, 8);
      // Update the fringe material color
      fringe.material.color.copy(secondaryColor);
      fringe.name = 'carpetFringe';
      carpetGroup.add(fringe);
    }

    // Add subtle glow underneath for magical effect
    const glowGeometry = new THREE.PlaneGeometry(width * 0.7, length * 0.7, 1, 1);
    glowGeometry.rotateX(-Math.PI / 2);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide, // Only visible from below
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.y = -0.25;
    glow.name = 'carpetGlow';
    carpetGroup.add(glow);

    return carpetGroup;
  }

  /**
   * Predefined carpet color schemes
   */
  static colorSchemes = {
    persian: {
      primary: new THREE.Color(0x8B0000),    // Dark red
      secondary: new THREE.Color(0xDAA520),   // Goldenrod
      border: new THREE.Color(0x1a1a4a)       // Dark blue
    },
    royal: {
      primary: new THREE.Color(0x1a1a6a),    // Royal blue
      secondary: new THREE.Color(0xFFD700),   // Gold
      border: new THREE.Color(0x4a0a2a)       // Deep purple
    },
    emerald: {
      primary: new THREE.Color(0x0a4a2a),    // Deep green
      secondary: new THREE.Color(0xC0C0C0),   // Silver
      border: new THREE.Color(0x2a2a2a)       // Dark gray
    },
    sunset: {
      primary: new THREE.Color(0x8B4513),    // Saddle brown
      secondary: new THREE.Color(0xFF6347),   // Tomato
      border: new THREE.Color(0x4a2a1a)       // Dark brown
    },
    mystic: {
      primary: new THREE.Color(0x4a0a4a),    // Deep purple
      secondary: new THREE.Color(0x00CED1),   // Dark turquoise
      border: new THREE.Color(0x1a1a3a)       // Dark navy
    },
    ocean: {
      primary: new THREE.Color(0x0a3a5a),    // Deep ocean blue
      secondary: new THREE.Color(0x48D1CC),   // Medium turquoise
      border: new THREE.Color(0x1a2a4a)       // Navy
    }
  };

  /**
   * Get a color scheme by name or index
   * @param {string|number} key - Scheme name or numeric index
   * @returns {object} Color scheme
   */
  static getColorScheme(key) {
    const schemes = Object.values(this.colorSchemes);
    if (typeof key === 'number') {
      return schemes[Math.abs(key) % schemes.length];
    }
    return this.colorSchemes[key] || this.colorSchemes.persian;
  }
}
