import * as THREE from 'three';
import { Logger } from '../../../utils/Logger.js';
import { System } from '../../core/System.js';

export class PlayerStateManager extends System {
  constructor(engine) {
    super(engine, 'playerState');
    this.requireDependencies(['network']);
    this.players = new Map();
    this.localPlayer = null;
  }

  async _initialize() {
      // Create local player immediately for single-player/offline mode
      this.createLocalPlayer('local-player-' + Date.now());
      
      const network = this.engine.systems.get('network');
      if (network) {
        const eventEmitter = network.eventEmitter;
        eventEmitter.on('connected', (data) => {
          if (data && data.id) {
            Logger.info('PlayerStateManager: Network connected, updating local player ID');
            this.updatePlayer(this.localPlayer.id, { id: data.id });
            this.localPlayer.id = data.id;
          }
        });
      
        eventEmitter.on('player_join', (data) => {
          this.createNetworkPlayer(data);
        });
      
        eventEmitter.on('player_leave', (data) => {
          this.removePlayer(data.id);
        });
      
        eventEmitter.on('player_update', (data) => {
          this.updateNetworkPlayer(data);
        });
      } else {
        Logger.warn('PlayerStateManager: No network system available, running in offline mode');
      }
  
      Logger.info("PlayerStateManager initialized with local player:", !!this.localPlayer);
    }

  createLocalPlayer(id) {
    const player = {
      id,
      isLocal: true,
      position: new THREE.Vector3(0, 150, 0),
      rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
      velocity: new THREE.Vector3(0, 0, 0),
      acceleration: new THREE.Vector3(0, 0, 0),
      bankAngle: 0,
      throttle: 0,
      mana: 0,
      totalMana: 0,
      landmarksVisited: 0,
      health: 100,
      maxHealth: 100,
      maxSpeed: 210,
      accelerationValue: 400,
      speedMultiplier: 1,
      rotationSpeed: 3,
      spells: [],
      altitude: 350,
      altitudeVelocity: 0,
      currentSpell: 0,
      visitedLandmarks: new Set()
    };

    this.players.set(id, player);
    this.localPlayer = player;

    Logger.info(`Local player created with ID: ${id}`);
  }

  createNetworkPlayer(data) {
    if (this.players.has(data.id)) return;

    const player = {
      id: data.id,
      isLocal: false,
      position: new THREE.Vector3(data.x || 0, data.y || 150, data.z || 0),
      rotation: new THREE.Euler(data.rotationX || 0, data.rotationY || 0, data.rotationZ || 0, 'YXZ'),
      velocity: new THREE.Vector3(0, 0, 0),
      bankAngle: data.bankAngle || 0,
      mana: 0,
      totalMana: 0,
      landmarksVisited: 0,
      health: 100,
      maxHealth: 100,
      visitedLandmarks: new Set()
    };

    this.players.set(data.id, player);

    Logger.info(`Network player created with ID: ${data.id}`);
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (player) {
      if (player.model && player.model.parent) {
        player.model.parent.remove(player.model);
      }
      this.players.delete(id);
      if (this.localPlayer && this.localPlayer.id === id) this.localPlayer = null;
      Logger.info(`Player removed with ID: ${id}`);
    }
  }

  updateNetworkPlayer(data) {
    let player = this.players.get(data.id);
    if (!player) {
      this.createNetworkPlayer(data);
      player = this.players.get(data.id);
    }
    if (!player || player.isLocal) return;

    if (data.x !== undefined && data.y !== undefined && data.z !== undefined) {
      const targetPos = new THREE.Vector3(data.x, data.y, data.z);
      player.velocity.copy(targetPos).sub(player.position);
      player.position.lerp(targetPos, 0.35);
    }

    if (data.rotationX !== undefined) {
      player.rotation.x = THREE.MathUtils.lerp(player.rotation.x, data.rotationX, 0.35);
    }
    if (data.rotationY !== undefined) {
      player.rotation.y = THREE.MathUtils.lerp(player.rotation.y, data.rotationY, 0.35);
    }
    if (data.rotationZ !== undefined) {
      player.rotation.z = THREE.MathUtils.lerp(player.rotation.z, data.rotationZ, 0.35);
    }
    if (data.bankAngle !== undefined) player.bankAngle = THREE.MathUtils.lerp(player.bankAngle || 0, data.bankAngle, 0.35);
    if (data.mana !== undefined) player.mana = data.mana;
    if (data.health !== undefined) player.health = data.health;
    if (data.speed !== undefined) player.speed = data.speed;
  }

  getPlayer(id) {
    return this.players.get(id);
  }

  updatePlayer(id, updates) {
    const player = this.players.get(id);
    if (player) {
      Object.assign(player, updates);
    }
  }
}
