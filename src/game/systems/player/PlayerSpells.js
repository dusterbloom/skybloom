import * as THREE from 'three';

export class PlayerSpells {
  constructor(playerSystem) {
    this.playerSystem = playerSystem;
    this.engine = playerSystem.engine;
    this.scene = playerSystem.scene;
    
    // Spell system
    this.spells = [];
    this.cooldowns = {}; // per spell name
    this.activeEffects = []; // {spell, startTime, duration}
    this.unlockedSpells = new Set(); // indices of unlocked spells
    this.particlesTexture = null;
    this.particlesGeometry = null;
    this.maxParticles = 50;
  }
  
  async initialize() {
    // Load particles texture
    const loader = new THREE.TextureLoader();
    this.particlesTexture = loader.load('/assets/textures/particles.png');
    
    // Precompute particles geometry
    this.particlesGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.maxParticles * 3);
    for (let i = 0; i < this.maxParticles; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 10;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 10;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    this.particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    // Load spells from JSON
    try {
      const response = await fetch('/assets/spells.json');
      this.spells = await response.json();
      console.log('Spells loaded:', this.spells);
      
      // Initialize cooldowns
      this.spells.forEach(spell => {
        this.cooldowns[spell.name] = 0;
      });
    } catch (error) {
      console.error('Failed to load spells:', error);
      // Fallback to empty
    }
    
    // Load audio
    this.spellSound = new Audio('/assets/audio/spell.mp3');
  }
  
  checkUnlock(spell, player) {
    const condition = spell.unlockCondition;
    if (!condition) return true;
    
    switch (condition.type) {
      case 'mana':
        return player.totalMana >= condition.value;
      case 'landmarks':
        return (player.landmarksVisited || 0) >= condition.value;
      default:
        return false;
    }
  }
  
  selectSpell(index) {
    const player = this.playerSystem.localPlayer;
    if (!player) return;
    
    if (index >= 0 && index < this.spells.length) {
      const spell = this.spells[index];
      if (!this.unlockedSpells.has(index) && !this.checkUnlock(spell, player)) {
        if (this.engine.systems.ui) {
          this.engine.systems.ui.showMessage(`Spell "${spell.name}" not unlocked yet.`);
        }
        return;
      }
      // Unlock if condition met but not yet unlocked
      if (!this.unlockedSpells.has(index) && this.checkUnlock(spell, player)) {
        this.unlockedSpells.add(index);
      }
      
      player.currentSpell = index;
      
      // Update UI
      if (this.engine.systems.ui) {
        this.engine.systems.ui.selectSpell(index);
      }
    }
  }
  
  castSpell() {
    const player = this.playerSystem.localPlayer;
    if (!player) return;
    
    const index = player.currentSpell;
    if (index < 0 || index >= this.spells.length) return;
    
    const spell = this.spells[index];
    const cooldown = this.cooldowns[spell.name];
    
    if (cooldown > 0) {
      if (this.engine.systems.ui) {
        this.engine.systems.ui.showMessage(`Spell on cooldown: ${Math.ceil(cooldown)}s`);
      }
      return;
    }
    
    if (player.mana < spell.manaCost) {
      if (this.engine.systems.ui) {
        this.engine.systems.ui.showMessage('Insufficient mana');
      }
      return;
    }
    
    // Deduct mana
    player.mana -= spell.manaCost;
    if (this.engine.systems.ui) {
      this.engine.systems.ui.updateManaDisplay(player.mana);
    }
    
    // Set cooldown in seconds
    this.cooldowns[spell.name] = spell.cooldown;
    
    // Apply effect
    this.applyEffect(spell, player);
    
    // VFX
    this.createVFX(spell, player.position);
    
    // Play sound
    this.spellSound.play().catch(e => console.log('Audio play failed:', e));
  }
  
  applyEffect(spell, player) {
    const effect = spell.effect;
    let effectData = {
      spell: spell.name,
      startTime: this.engine.elapsed,
      duration: effect.duration
    };
    
    switch (effect.type) {
      case 'speed_boost':
        player.speedMultiplier = (player.speedMultiplier || 1) * effect.value;
        effectData.reset = () => { player.speedMultiplier = player.speedMultiplier / effect.value || 1; };
        break;
      case 'invulnerability':
        player.invulnerable = true;
        effectData.reset = () => { player.invulnerable = false; };
        break;
      case 'scan':
        // Query world for mana/landmarks in radius
        if (this.engine.systems.world) {
          const nodes = this.engine.systems.world.getManaNodesInRadius(player.position, effect.value.radius);
          // Highlight on minimap or UI
          if (this.engine.systems.ui) {
            this.engine.systems.ui.highlightNodes(nodes);
          }
          if (this.engine.systems.minimap) {
            this.engine.systems.minimap.markNodes(nodes);
          }
        }
        // No duration, immediate
        return;
      case 'mana_multiplier':
        player.manaMultiplier = (player.manaMultiplier || 1) * effect.value;
        effectData.reset = () => { player.manaMultiplier = player.manaMultiplier / effect.value || 1; };
        break;
      default:
        console.warn('Unknown effect type:', effect.type);
        return;
    }
    
    this.activeEffects.push(effectData);
  }
  
  createVFX(spell, position) {
    const vfx = spell.vfx;
    const color = new THREE.Color(vfx.color); // Assume color name to hex mapping or use 0x for simplicity
    
    let emitter;
    if (vfx.type === 'aura' || vfx.type === 'shield') {
      // Attach to player
      const player = this.playerSystem.localPlayer;
      emitter = this.createParticleEmitter(color, true);
      player.model.add(emitter);
    } else if (vfx.type === 'scan') {
      // World space
      emitter = this.createParticleEmitter(color, false);
      emitter.position.copy(position);
      this.scene.add(emitter);
    }
    
    // Animate and remove after duration
    const duration = spell.effect.duration || 5;
    const startTime = this.engine.elapsed;
    const animate = () => {
      const elapsed = this.engine.elapsed - startTime;
      if (elapsed > duration) {
        if (emitter.parent === player.model) {
          player.model.remove(emitter);
        } else {
          this.scene.remove(emitter);
        }
        return;
      }
      emitter.material.opacity = 1 - (elapsed / duration);
      requestAnimationFrame(animate);
    };
    animate();
  }
  
  createParticleEmitter(color, attach = false) {
    const material = new THREE.PointsMaterial({
      map: this.particlesTexture,
      color: color,
      transparent: true,
      opacity: 1,
      size: 0.5,
      blending: THREE.AdditiveBlending
    });
    
    const points = new THREE.Points(this.particlesGeometry, material);
    if (attach) {
      points.position.set(0, 0, 0);
    }
    
    return points;
  }
  
  updateSpells(delta) {
    const elapsed = this.engine.elapsed;
    
    // Update cooldowns
    Object.keys(this.cooldowns).forEach(name => {
      if (this.cooldowns[name] > 0) {
        this.cooldowns[name] -= delta;
      }
    });
    
    // Update active effects
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      const timeElapsed = elapsed - effect.startTime;
      if (timeElapsed >= effect.duration) {
        if (effect.reset) {
          effect.reset();
        }
        this.activeEffects.splice(i, 1);
      }
    }

    // Check for spell unlocks occasionally
    if (Math.random() < 0.01) { // 1% chance per frame, adjust as needed
      this.unlockNextSpell();
    }
  }

  unlockNextSpell() {
    const playerState = this.playerSystem.engine.systemManager.get('playerState');
    const player = playerState?.localPlayer;
    if (!player) {
      console.warn('PlayerSpells.unlockNextSpell: No localPlayer available');
      return;
    }
    
    for (let i = 0; i < this.spells.length; i++) {
      if (!this.unlockedSpells.has(i) && this.checkUnlock(this.spells[i], player)) {
        this.unlockedSpells.add(i);
        if (this.engine.systemManager.get('ui')) {
          this.engine.systemManager.get('ui').showMessage(`Unlocked spell: ${this.spells[i].name}`);
        }
        player.currentSpell = i;
        console.log('PlayerSpells.unlockNextSpell: Unlocked spell', i, this.spells[i].name);
        return;
      }
    }
  }
}
