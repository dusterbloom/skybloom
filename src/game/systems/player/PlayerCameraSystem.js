import * as THREE from 'three';
import { System } from '../../core/System.js';

export class PlayerCameraSystem extends System {
  constructor(engine) {
    super(engine, 'playerCamera');
    this.requireDependencies(['playerState']);
  }

  _initialize() {
    console.log("PlayerCameraSystem initialized");
  }

  _update(delta) {
    // console.log('PlayerCameraSystem._update: Checking playerState at', Date.now());
    // console.log('PlayerCameraSystem._update: engine exists:', !!this.engine);
    // console.log('PlayerCameraSystem._update: systemManager exists:', !!this.engine?.systemManager);
    
    const playerState = this.engine.systemManager.get('playerState');
    // console.log('PlayerCameraSystem._update: playerState via systemManager.get:', !!playerState);
    
    if (!playerState) {
      // console.warn('PlayerCameraSystem._update: playerState is undefined - cannot access via systemManager');
      return;
    }
    
    // console.log('PlayerCameraSystem._update: localPlayer exists:', !!playerState.localPlayer);
    const player = playerState.localPlayer;
    if (!player) {
      // console.warn('PlayerCameraSystem._update: No player available');
      return;
    }

    const isMobile = this.engine.input.isTouchDevice;

    let cameraOffset, lookAheadDistance;
    if (isMobile) {
      cameraOffset = new THREE.Vector3(0, 12, -20);
      lookAheadDistance = new THREE.Vector3(0, 3, 30);
    } else {
      cameraOffset = new THREE.Vector3(0, 10, -25);
      lookAheadDistance = new THREE.Vector3(0, 5, 25);
    }

    const quaternion = new THREE.Quaternion();
    quaternion.setFromEuler(new THREE.Euler(
      player.rotation.x,
      player.rotation.y,
      0,
      'YXZ'
    ));

    const rotatedOffset = cameraOffset.clone().applyQuaternion(quaternion);
    const rotatedLookAhead = lookAheadDistance.clone().applyQuaternion(quaternion);

    const targetCameraPos = player.position.clone().add(rotatedOffset);

    const terrainY = this.engine.systemManager.get('world').getTerrainHeight(targetCameraPos.x, targetCameraPos.z);
    const cameraMinOffset = 2;
    if (targetCameraPos.y < terrainY + cameraMinOffset) {
      targetCameraPos.y = terrainY + cameraMinOffset;
    }

    this.engine.camera.position.lerp(targetCameraPos, 0.1);

    const lookTarget = player.position.clone().add(rotatedLookAhead);
    this.engine.camera.lookAt(lookTarget);
  }
}