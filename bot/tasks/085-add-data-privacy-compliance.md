# Task 085: Add Data Privacy Compliance and GDPR

## 1. Task & Context
**Task:** Implement GDPR compliance, data privacy measures, and user consent management
**Scope:** Data collection, user consent, privacy policy, data retention policies
**Branch:** slow-mode
**Priority:** MEDIUM - Legal compliance

## 2. Quick Plan
**Approach:** Add consent management, implement data minimization, create privacy policy, add data export/deletion features
**Complexity:** 2-Moderate (privacy framework implementation)
**Uncertainty:** 2-Medium (GDPR legal requirements)

## 3. Implementation

### Current Issues Found:
- No GDPR compliance
- No privacy policy
- Player data collection without consent
- No data retention policies
- Missing data export/deletion features

### Solution Approach:
1. Implement consent management system
2. Add data minimization and anonymization
3. Create comprehensive privacy policy
4. Add data subject rights (access, rectification, erasure)
5. Implement data retention policies

### Implementation Steps:

**Step 1: Create Consent Management System**
```javascript
// src/utils/ConsentManager.js
export class ConsentManager {
  constructor() {
    this.consents = this.loadConsents();
    this.consentVersion = '1.0';
  }

  loadConsents() {
    const stored = localStorage.getItem('game-consents');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.version === this.consentVersion) {
          return parsed.consents;
        }
      } catch (error) {
        console.warn('Failed to parse stored consents:', error);
      }
    }
    return this.getDefaultConsents();
  }

  getDefaultConsents() {
    return {
      analytics: false,
      marketing: false,
      functional: true, // Essential for game functionality
      performance: false
    };
  }

  async requestConsent() {
    return new Promise((resolve) => {
      this.showConsentDialog(resolve);
    });
  }

  showConsentDialog(callback) {
    const dialog = document.createElement('div');
    dialog.className = 'consent-dialog';
    dialog.innerHTML = `
      <div class="consent-overlay">
        <div class="consent-content">
          <h2>Cookie & Privacy Preferences</h2>
          <p>We use cookies and collect data to improve your gaming experience.</p>

          <div class="consent-options">
            <label class="consent-option">
              <input type="checkbox" id="functional" checked disabled>
              <span>Essential (Required for game functionality)</span>
            </label>

            <label class="consent-option">
              <input type="checkbox" id="analytics">
              <span>Analytics (Help us improve the game)</span>
            </label>

            <label class="consent-option">
              <input type="checkbox" id="performance">
              <span>Performance (Monitor game performance)</span>
            </label>

            <label class="consent-option">
              <input type="checkbox" id="marketing">
              <span>Marketing (Personalized recommendations)</span>
            </label>
          </div>

          <div class="consent-buttons">
            <button id="accept-all">Accept All</button>
            <button id="accept-selected">Accept Selected</button>
            <button id="reject-all">Reject All</button>
          </div>

          <p class="privacy-link">
            <a href="/privacy-policy" target="_blank">Read our Privacy Policy</a>
          </p>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // Set up event listeners
    this.setupConsentListeners(dialog, callback);
  }

  setupConsentListeners(dialog, callback) {
    const acceptAll = dialog.querySelector('#accept-all');
    const acceptSelected = dialog.querySelector('#accept-selected');
    const rejectAll = dialog.querySelector('#reject-all');

    acceptAll.addEventListener('click', () => {
      this.consents = {
        analytics: true,
        marketing: true,
        functional: true,
        performance: true
      };
      this.saveConsents();
      dialog.remove();
      callback(this.consents);
    });

    acceptSelected.addEventListener('click', () => {
      this.consents = {
        analytics: dialog.querySelector('#analytics').checked,
        marketing: dialog.querySelector('#marketing').checked,
        functional: true,
        performance: dialog.querySelector('#performance').checked
      };
      this.saveConsents();
      dialog.remove();
      callback(this.consents);
    });

    rejectAll.addEventListener('click', () => {
      this.consents = {
        analytics: false,
        marketing: false,
        functional: true,
        performance: false
      };
      this.saveConsents();
      dialog.remove();
      callback(this.consents);
    });
  }

  saveConsents() {
    const data = {
      version: this.consentVersion,
      consents: this.consents,
      timestamp: new Date().toISOString()
    };
    localStorage.setItem('game-consents', JSON.stringify(data));
  }

  hasConsent(category) {
    return this.consents[category] === true;
  }

  withdrawConsent(category) {
    this.consents[category] = false;
    this.saveConsents();

    // Handle consent withdrawal
    this.handleConsentWithdrawal(category);
  }

  handleConsentWithdrawal(category) {
    switch (category) {
      case 'analytics':
        // Disable analytics tracking
        if (window.gtag) {
          window.gtag('consent', 'update', {
            analytics_storage: 'denied'
          });
        }
        break;
      case 'marketing':
        // Disable marketing cookies
        this.disableMarketingCookies();
        break;
      case 'performance':
        // Disable performance monitoring
        if (window.performanceObserver) {
          window.performanceObserver.disconnect();
        }
        break;
    }
  }

  disableMarketingCookies() {
    // Remove marketing cookies
    const cookies = document.cookie.split(';');
    cookies.forEach(cookie => {
      const [name] = cookie.trim().split('=');
      if (name.includes('marketing') || name.includes('ads')) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
    });
  }
}
```

**Step 2: Implement Data Minimization and Anonymization**
```javascript
// src/utils/DataManager.js
export class DataManager {
  constructor() {
    this.consentManager = new ConsentManager();
    this.anonymizationEnabled = true;
  }

  collectGameData(eventType, data) {
    if (!this.consentManager.hasConsent('analytics')) {
      return;
    }

    const anonymizedData = this.anonymizeData(data);
    const minimalData = this.minimizeData(eventType, anonymizedData);

    this.sendToAnalytics(minimalData);
  }

  anonymizeData(data) {
    if (!this.anonymizationEnabled) return data;

    const anonymized = { ...data };

    // Remove or hash personal identifiers
    if (anonymized.playerId) {
      anonymized.playerId = this.hashValue(anonymized.playerId);
    }

    if (anonymized.ip) {
      delete anonymized.ip;
    }

    if (anonymized.userAgent) {
      anonymized.browser = this.categorizeUserAgent(anonymized.userAgent);
      delete anonymized.userAgent;
    }

    return anonymized;
  }

  minimizeData(eventType, data) {
    // Only collect data necessary for the specific event type
    const minimalFields = {
      gameStart: ['timestamp', 'deviceType', 'gameVersion'],
      spellCast: ['timestamp', 'spellType', 'manaCost'],
      levelComplete: ['timestamp', 'levelId', 'completionTime', 'score'],
      error: ['timestamp', 'errorType', 'errorMessage']
    };

    const allowedFields = minimalFields[eventType] || [];
    const minimized = {};

    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        minimized[field] = data[field];
      }
    });

    return minimized;
  }

  hashValue(value) {
    // Simple hash function for anonymization
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  categorizeUserAgent(userAgent) {
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Other';
  }

  sendToAnalytics(data) {
    // Only send if user has consented
    if (this.consentManager.hasConsent('analytics')) {
      // Send to analytics service
      console.log('Sending analytics data:', data);
      // In production, this would send to your analytics provider
    }
  }
}
```

**Step 3: Create Privacy Policy and Data Subject Rights**
```javascript
// src/components/PrivacyPolicy.js
export class PrivacyPolicy {
  static showPrivacyPolicy() {
    const policy = `
      <div class="privacy-policy">
        <h1>Privacy Policy</h1>

        <h2>Data Collection</h2>
        <p>We collect minimal data necessary for game functionality:</p>
        <ul>
          <li>Game progress and achievements</li>
          <li>Device type and browser information (anonymized)</li>
          <li>Performance metrics (with consent)</li>
          <li>Error reports (anonymized)</li>
        </ul>

        <h2>Your Rights</h2>
        <p>Under GDPR, you have the right to:</p>
        <ul>
          <li><strong>Access:</strong> Request a copy of your data</li>
          <li><strong>Rectification:</strong> Correct inaccurate data</li>
          <li><strong>Erasure:</strong> Delete your data ("right to be forgotten")</li>
          <li><strong>Portability:</strong> Export your data in a portable format</li>
          <li><strong>Restriction:</strong> Limit how we process your data</li>
          <li><strong>Objection:</strong> Object to data processing</li>
        </ul>

        <h2>Data Retention</h2>
        <p>We retain your data for the following periods:</p>
        <ul>
          <li>Game progress: Until account deletion</li>
          <li>Analytics data: 26 months</li>
          <li>Error logs: 90 days</li>
        </ul>

        <h2>Contact Us</h2>
        <p>For privacy inquiries: privacy@magicalcarpet.game</p>
      </div>
    `;

    this.showModal('Privacy Policy', policy);
  }

  static showDataRightsDialog() {
    const dialog = `
      <div class="data-rights">
        <h2>Your Data Rights</h2>

        <button onclick="exportData()">Export My Data</button>
        <button onclick="deleteData()">Delete My Account</button>
        <button onclick="manageConsents()">Manage Consents</button>

        <p>Contact us to exercise other rights or for assistance.</p>
      </div>
    `;

    this.showModal('Data Subject Rights', dialog);
  }

  static showModal(title, content) {
    const modal = document.createElement('div');
    modal.className = 'privacy-modal';
    modal.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h2>${title}</h2>
            <button class="close-button" onclick="this.closest('.privacy-modal').remove()">×</button>
          </div>
          <div class="modal-body">
            ${content}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }
}

// Global functions for data rights
window.exportData = async function() {
  try {
    const data = await DataManager.exportUserData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-game-data.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert('Data export completed. Check your downloads.');
  } catch (error) {
    alert('Failed to export data. Please try again.');
  }
};

window.deleteData = async function() {
  if (confirm('Are you sure you want to delete all your data? This action cannot be undone.')) {
    try {
      await DataManager.deleteUserData();
      alert('Your data has been deleted. You will be logged out.');
      // Redirect to login or reset game state
      window.location.reload();
    } catch (error) {
      alert('Failed to delete data. Please contact support.');
    }
  }
};

window.manageConsents = function() {
  const consentManager = new ConsentManager();
  consentManager.requestConsent();
};
```

**Step 4: Implement Data Retention and Deletion**
```javascript
// src/utils/DataRetentionManager.js
export class DataRetentionManager {
  constructor() {
    this.retentionPolicies = {
      gameProgress: 365 * 24 * 60 * 60 * 1000, // 1 year
      analytics: 26 * 30 * 24 * 60 * 60 * 1000, // 26 months
      errorLogs: 90 * 24 * 60 * 60 * 1000, // 90 days
      temporaryData: 24 * 60 * 60 * 1000 // 24 hours
    };
  }

  async cleanupExpiredData() {
    const now = Date.now();

    // Clean up local storage
    this.cleanupLocalStorage(now);

    // Clean up indexedDB if used
    await this.cleanupIndexedDB(now);

    // Clean up server-side data (would call API)
    await this.cleanupServerData(now);
  }

  cleanupLocalStorage(now) {
    const keysToRemove = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        try {
          const value = localStorage.getItem(key);
          if (value) {
            const data = JSON.parse(value);
            if (data.timestamp && this.isExpired(data.timestamp, now, key)) {
              keysToRemove.push(key);
            }
          }
        } catch (error) {
          // Invalid JSON, might be old data to clean up
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
  }

  async cleanupIndexedDB(now) {
    // Implementation for IndexedDB cleanup
    if (!window.indexedDB) return;

    return new Promise((resolve) => {
      const request = indexedDB.open('GameDatabase', 1);

      request.onsuccess = (event) => {
        const db = event.target.result;

        // Clean up object stores
        const transaction = db.transaction(['gameData', 'analytics'], 'readwrite');

        // Implementation would clean up expired records
        // This is a simplified version

        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
      };

      request.onerror = () => resolve();
    });
  }

  async cleanupServerData(now) {
    // This would make API calls to clean up server-side data
    // For now, just log the intention
    console.log('Server data cleanup would be performed here');
  }

  isExpired(timestamp, now, key) {
    const age = now - new Date(timestamp).getTime();
    const policy = this.getRetentionPolicy(key);
    return age > policy;
  }

  getRetentionPolicy(key) {
    if (key.includes('analytics')) return this.retentionPolicies.analytics;
    if (key.includes('error')) return this.retentionPolicies.errorLogs;
    if (key.includes('temp')) return this.retentionPolicies.temporaryData;
    return this.retentionPolicies.gameProgress;
  }

  scheduleCleanup() {
    // Run cleanup daily
    setInterval(() => {
      this.cleanupExpiredData();
    }, 24 * 60 * 60 * 1000);

    // Also run on page load
    this.cleanupExpiredData();
  }
}
```

**Step 5: Add Data Export and Deletion Features**
```javascript
// src/utils/DataManager.js (continued)
export class DataManager {
  async exportUserData() {
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      data: {}
    };

    // Collect all user data
    exportData.data.gameProgress = await this.getGameProgress();
    exportData.data.settings = this.getUserSettings();
    exportData.data.consents = this.consentManager.consents;

    // Only include analytics if user consented
    if (this.consentManager.hasConsent('analytics')) {
      exportData.data.analytics = await this.getAnalyticsData();
    }

    return exportData;
  }

  async getGameProgress() {
    // Collect game progress data
    return {
      level: localStorage.getItem('playerLevel') || 1,
      experience: localStorage.getItem('playerXP') || 0,
      achievements: JSON.parse(localStorage.getItem('achievements') || '[]'),
      inventory: JSON.parse(localStorage.getItem('inventory') || '[]'),
      lastPlayed: localStorage.getItem('lastPlayed')
    };
  }

  getUserSettings() {
    return {
      audioVolume: localStorage.getItem('audioVolume') || 0.8,
      musicEnabled: localStorage.getItem('musicEnabled') !== 'false',
      graphicsQuality: localStorage.getItem('graphicsQuality') || 'medium',
      controls: JSON.parse(localStorage.getItem('controls') || '{}')
    };
  }

  async getAnalyticsData() {
    // Collect user's analytics data (anonymized)
    const analytics = localStorage.getItem('analytics');
    return analytics ? JSON.parse(analytics) : {};
  }

  async deleteUserData() {
    // Clear all user data
    const keysToRemove = [
      'playerLevel', 'playerXP', 'achievements', 'inventory',
      'lastPlayed', 'audioVolume', 'musicEnabled', 'graphicsQuality',
      'controls', 'analytics', 'game-consents'
    ];

    keysToRemove.forEach(key => localStorage.removeItem(key));

    // Clear any server-side data (would call API)
    await this.deleteServerData();

    // Reset game state
    this.resetGameState();
  }

  async deleteServerData() {
    // This would make API calls to delete server-side data
    console.log('Server data deletion would be performed here');
  }

  resetGameState() {
    // Reset to initial game state
    if (window.gameEngine) {
      window.gameEngine.reset();
    }
  }

  // GDPR compliance: Data portability
  async exportDataPortable() {
    const data = await this.exportUserData();

    // Convert to common format (e.g., JSON-LD for interoperability)
    return {
      '@context': 'https://schema.org',
      '@type': 'GameProfile',
      ...data
    };
  }
}
```

## 4. Check & Commit

**Files to Update:**
- src/utils/ConsentManager.js (new)
- src/utils/DataManager.js (new)
- src/components/PrivacyPolicy.js (new)
- src/utils/DataRetentionManager.js (new)
- src/main.js (initialize privacy systems)

**Expected Impact:**
- GDPR compliance for EU users
- Transparent data collection practices
- User control over personal data
- Proper data retention and deletion
- Improved trust and user confidence

**Testing:**
- Test consent dialog functionality
- Verify data export works correctly
- Test data deletion process
- Check privacy policy accessibility
- Validate GDPR compliance

**Commit Message:** feat: Add GDPR compliance with consent management, data privacy controls, and user rights

**Status:** Ready for implementation