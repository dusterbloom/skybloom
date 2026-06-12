import { io } from 'socket.io-client';
import { EventEmitter } from '../../utils/EventEmitter';
import { PlayerList } from '../ui/components/PlayerList';
import { System } from '../core/System';
import { Logger } from '../../utils/Logger.js';

export class NetworkManager extends System {
  constructor(engine) {
    super(engine, 'network');
    this.eventEmitter = new EventEmitter();
    this.socket = null;
    this.players = new Map();
    this.localPlayerId = null;
    this.serverTimeDiff = 0;
    this.ping = 0;
    this.isConnected = false;
    this.connectionFailureNotified = false;

    // Create UI components
    this.playerList = new PlayerList(engine);
    
    // Set up development mode for local testing
    this.isDev = import.meta.env.DEV;
    this.useSimulation = this.isDev && import.meta.env.VITE_USE_NETWORK_SIMULATION === 'true';
  }
  
  async _initialize() {
    // The intro screen is owned by the Engine; its start flow calls connect()

    // Set up server URL - FIXED for mobile devices
    // Use VITE_SERVER_URL if provided, otherwise use window.location.origin
    // This will use the same domain/IP that the website is loaded from
    // Set up server URL
    this.serverUrl = import.meta.env.VITE_SERVER_URL || window.location.origin;

    // If using auto IP detection
    if (import.meta.env.VITE_AUTO_IP === 'true') {
      // Use current window host but port 4000
      const url = new URL(window.location.href);
      this.serverUrl = `${url.protocol}//${url.hostname}:4000`;
    }    
    // For local development on computer only, use localhost if needed
    // To specifically test on localhost during development for desktop
    if (this.isDev && window.location.hostname === 'localhost') {
      this.serverUrl = 'http://localhost:4000';
    }
    
    Logger.info("Connecting to server URL:", this.serverUrl);
    
    // Create socket but don't connect yet
    // Reconnection is capped so a missing server can't retry (and log) forever
    this.socket = io(this.serverUrl, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    });

    // Set up socket event listeners
    this.setupEventListeners();

    // If in simulation mode, connect automatically after a short delay
    if (this.useSimulation) {
      Logger.info("Using network simulation mode");
      setTimeout(() => {
        this.simulateConnection();
      }, 500);
    }
    
    Logger.info("Network manager initialized");
  }
  
  setupEventListeners() {
    this.socket.on('connect', () => {
      Logger.info('Connected to server');
      this.isConnected = true;
      this.eventEmitter.emit('connected');

      // Request player ID from server
      this.socket.emit('request_id');
    });

    this.socket.on('disconnect', () => {
      Logger.warn('Disconnected from server');
      this.isConnected = false;
      this.eventEmitter.emit('disconnected');
    });

    this.socket.on('connect_error', (error) => {
      // Keep per-attempt failures quiet; one warning is logged when we give up
      Logger.debug('Connection attempt failed:', error.message);
    });

    // Fired once by the socket.io manager after all reconnection attempts fail
    this.socket.io.on('reconnect_failed', () => {
      this.handleConnectionFailure();
    });

    this.socket.on('player_id', (data) => {
      this.localPlayerId = data.id;
      Logger.debug('Received player ID:', this.localPlayerId);
      this.eventEmitter.emit('connected', { id: this.localPlayerId });

      // Show player list
      this.playerList.show();
    });
    
    this.socket.on('player_join', (data) => {
      this.handlePlayerJoin(data);
    });
    
    this.socket.on('player_leave', (data) => {
      this.handlePlayerLeave(data);
    });
    
    this.socket.on('player_update', (data) => {
      this.handlePlayerUpdate(data);
    });
    
    this.socket.on('game_state', (data) => {
      this.handleGameState(data);
    });
    
    // Handle server ping response
    this.socket.on('pong', (latency) => {
      this.ping = latency;
      this.playerList.updatePing(latency);
    });
    
    // Set up ping interval
    setInterval(() => {
      if (this.isConnected) {
        const start = Date.now();
        this.socket.emit('ping', () => {
          const latency = Date.now() - start;
          this.ping = latency;
          this.playerList.updatePing(latency);
        });
      }
    }, 5000);
  }
  
  connect() {
    if (this.useSimulation) {
      this.simulateConnection();
      return;
    }

    // Connect to real server
    this.socket.connect();
  }

  // Called once when the socket gives up reconnecting; multiplayer is optional
  handleConnectionFailure() {
    if (this.connectionFailureNotified) return;
    this.connectionFailureNotified = true;

    Logger.warn('Multiplayer server unreachable, giving up after maximum reconnection attempts. Continuing in single-player mode.');

    // Show a small non-blocking notice if the UI system supports it
    const ui = this.engine.systems && this.engine.systems.ui;
    if (ui && typeof ui.showMessage === 'function') {
      ui.showMessage('Multiplayer unavailable — flying solo');
    }
  }

  simulateConnection() {
    Logger.info("Simulating network connection");

    setTimeout(() => {
      // Simulate receiving player ID
      this.localPlayerId = 'player_' + Math.floor(Math.random() * 10000);
      Logger.debug('Simulated player ID:', this.localPlayerId);
      
      // Emit connected event
      this.isConnected = true;
      this.eventEmitter.emit('connected', { id: this.localPlayerId });

      // Show player list
      this.playerList.show();
      
      // Add local player
      const localPlayer = {
        id: this.localPlayerId,
        name: 'Player',
        x: 0,
        y: 0,
        z: 0
      };
      this.handlePlayerJoin(localPlayer);
      
      // Simulate other players joining
      this.handlePlayerJoin({ id: 'player_ai_1', name: 'Magic Bot 1', x: 10, y: 5, z: 20 });
      this.handlePlayerJoin({ id: 'player_ai_2', name: 'Magic Bot 2', x: -15, y: 7, z: -5 });
      
      Logger.info("Network simulation initialized");
    }, 500);
  }
  
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
  
  // Player event handlers
  handlePlayerJoin(data) {
    this.players.set(data.id, data);
    this.playerList.updatePlayerList(Array.from(this.players.values()), this.localPlayerId);
    this.eventEmitter.emit('player_join', data);
  }
  
  handlePlayerLeave(data) {
    this.players.delete(data.id);
    this.playerList.updatePlayerList(Array.from(this.players.values()), this.localPlayerId);
    this.eventEmitter.emit('player_leave', data);
  }
  
  handlePlayerUpdate(data) {
    if (this.players.has(data.id)) {
      const player = this.players.get(data.id);
      Object.assign(player, data);
      this.eventEmitter.emit('player_update', player);
    }
  }
  
  handleGameState(data) {
    this.eventEmitter.emit('game_state', data);
  }
  
  // Send player updates to server
  sendPlayerUpdate(data) {
    if (this.useSimulation) {
      // For simulation, handle locally
      if (this.localPlayerId) {
        data.id = this.localPlayerId;
        this.handlePlayerUpdate(data);
      }
      return;
    }
    
    // Send to real server
    if (this.isConnected) {
      this.socket.emit('player_update', data);
    }
  }
  
  // Send player actions to server
  sendPlayerAction(action, data) {
    if (this.useSimulation) {
      // For simulation, handle locally
      this.eventEmitter.emit('player_action', { 
        playerId: this.localPlayerId,
        action, 
        ...data 
      });
      return;
    }
    
    // Send to real server
    if (this.isConnected) {
      this.socket.emit('player_action', { action, ...data });
    }
  }
  
  _update(delta) {
    // If in simulation mode, simulate network updates for AI players
    if (this.useSimulation && Math.random() < 0.05) {
      this.players.forEach((player, id) => {
        if (id !== this.localPlayerId) {
          // Simple random movement for AI players
          const update = {
            id,
            x: player.x + (Math.random() - 0.5) * 0.5,
            y: player.y + (Math.random() - 0.5) * 0.1,
            z: player.z + (Math.random() - 0.5) * 0.5
          };
          this.handlePlayerUpdate(update);
        }
      });
    }
  }
  
  getPlayers() {
    return Array.from(this.players.values());
  }
  
  getLocalPlayerId() {
    return this.localPlayerId;
  }
}