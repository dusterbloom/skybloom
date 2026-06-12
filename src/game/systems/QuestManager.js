import * as THREE from 'three';
import { Logger } from '../../utils/Logger.js';
import { System } from '../core/System.js';

export class QuestManager extends System {
  constructor(engine) {
    super(engine, 'questManager');
    this.requireDependencies(['player']);
    this.eventBus = engine.eventBus;
    this.quests = [];
    this.activeQuests = [];
    this.totalDistance = 0;
    this.lastPosition = null;
  }

  async _initialize() {
    // Load quests and initialize listeners
    await this.loadQuests();
    this.initializeEventListeners();
  }

  async loadQuests() {
    try {
      const response = await fetch('/assets/quests.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      this.quests = await response.json();
      Logger.info('Quests loaded:', this.quests);
    } catch (error) {
      Logger.error('Failed to load quests:', error);
      // Fallback to empty array or default quests
      this.quests = [];
    }
  }

  initializeEventListeners() {
    // Initialize active quests after load
    if (this.quests.length > 0) {
      this.activeQuests = this.quests.map(quest => ({
        ...quest,
        status: 'active',
        objectives: quest.objectives.map(obj => ({ ...obj, current: 0 }))
      }));
    }

    // Listen for events
    this.eventBus.on('manaCollected', (data) => this.handleManaCollected(data));
    this.eventBus.on('spellCast', (data) => this.handleSpellCast(data));
    this.eventBus.on('landmarkVisited', (data) => this.handleLandmarkVisited(data));
  }

  _update(delta, elapsed) {
    const player = this.engine.systems.get('playerState')?.localPlayer;
    if (!player || !player.position) return;

    if (this.lastPosition) {
      // Cap per-frame contribution so teleports/respawns don't credit the explore quest
      const dist = Math.min(player.position.distanceTo(this.lastPosition), 200);
      this.totalDistance += dist;
      this.checkExploreObjectives(this.totalDistance);
    }
    this.lastPosition = player.position.clone();
  }

  handleManaCollected(data) {
    if (!data || typeof data.amount !== 'number') return;
    this.activeQuests.forEach(quest => {
      if (quest.status !== 'active') return;
      const obj = quest.objectives.find(o => o.type === 'collectMana');
      if (obj) {
        obj.current += data.amount;
        console.log(`Quest progress: ${quest.name} - Mana: ${obj.current}/${obj.target}`);
        this.checkObjectiveCompletion(quest, obj);
      }
    });
  }

  handleSpellCast(data) {
    if (!data || !data.spellId) return;
    this.activeQuests.forEach(quest => {
      if (quest.status !== 'active') return;
      const obj = quest.objectives.find(o => o.type === 'castSpell' && o.spellId === data.spellId);
      if (obj) {
        obj.current += 1;
        console.log(`Quest progress: ${quest.name} - Casts: ${obj.current}/${obj.target}`);
        this.checkObjectiveCompletion(quest, obj);
      }
    });
  }

  handleLandmarkVisited(data) {
    if (!data || !data.landmarkId) return;
    this.activeQuests.forEach(quest => {
      if (quest.status !== 'active') return;
      const obj = quest.objectives.find(o => o.type === 'visitLandmarks');
      if (obj) {
        obj.current += 1;
        console.log(`Quest progress: ${quest.name} - Landmarks: ${obj.current}/${obj.target}`);
        this.checkObjectiveCompletion(quest, obj);
      }
    });
  }

  checkExploreObjectives(distance) {
    this.activeQuests.forEach(quest => {
      if (quest.status !== 'active') return;
      const obj = quest.objectives.find(o => o.type === 'exploreDistance');
      if (obj) {
        // Keep progress live for the UI; clamp so current never exceeds target
        obj.current = Math.min(distance, obj.target);
        if (distance >= obj.target) {
          console.log(`Quest progress: ${quest.name} - Distance: ${obj.current}/${obj.target}`);
          this.checkObjectiveCompletion(quest, obj);
        }
      }
    });
  }

  checkObjectiveCompletion(quest, objective) {
    const allComplete = quest.objectives.every(obj => obj.current >= obj.target);
    if (allComplete) {
      quest.status = 'completed';
      this.applyRewards(quest);
      // Non-blocking corner toast; Q toggles the full tracker panel
      const ui = this.engine.systems.get('ui');
      if (ui && typeof ui.showMessage === 'function') {
        const reward = quest.rewards && quest.rewards.mana ? ` — +${quest.rewards.mana} mana` : '';
        ui.showMessage(`✦ Quest complete: ${quest.name}${reward}`, 4500, '#ffcc66');
      }
      console.log(`Quest completed: ${quest.name}`);
    }
  }

  applyRewards(quest) {
    const player = this.engine.systems.get('playerState')?.localPlayer;
    if (!player) return;

    if (quest.rewards.mana) {
      player.mana += quest.rewards.mana;
      const ui = this.engine.systems.get('ui');
      if (ui) {
        ui.updateManaDisplay(player.mana);
      }
    }

    if (quest.rewards.unlockSpell) {
      // Call unlock on PlayerSpells
      const playerSystem = this.engine.systems.get('player');
      if (playerSystem && playerSystem.spells) {
        playerSystem.spells.unlockNextSpell();
      }
    }
  }

  getActiveQuests() {
    return this.activeQuests.filter(q => q.status === 'active' || q.status === 'completed');
  }
}