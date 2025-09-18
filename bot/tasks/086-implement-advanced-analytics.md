# Task 086: Implement Advanced Analytics and User Tracking

## 1. Task & Context
**Task:** Add comprehensive analytics system for user behavior tracking, performance monitoring, and game metrics
**Scope:** Analytics implementation, user tracking, performance metrics, A/B testing framework
**Branch:** slow-mode
**Priority:** MEDIUM - Business intelligence and optimization

## 2. Quick Plan
**Approach:** Implement privacy-compliant analytics, add user behavior tracking, create performance monitoring, set up A/B testing
**Complexity:** 3-High (analytics infrastructure, data processing)
**Uncertainty:** 2-Medium (analytics integration, data privacy)

## 3. Implementation

### Current Issues Found:
- No user analytics or tracking
- Missing performance monitoring
- No A/B testing capabilities
- Lack of user behavior insights
- No conversion funnel tracking

### Solution Approach:
1. Implement privacy-compliant analytics system
2. Add comprehensive user behavior tracking
3. Create performance monitoring dashboard
4. Set up A/B testing framework
5. Add conversion and retention analytics

### Implementation Steps:

**Step 1: Create Analytics System Architecture**
```javascript
// src/analytics/AnalyticsSystem.js
export class AnalyticsSystem extends System {
  constructor() {
    super();
    this.name = 'analytics';
    this.consentManager = new ConsentManager();
    this.eventQueue = [];
    this.sessionId = this.generateSessionId();
    this.userId = this.getOrCreateUserId();
  }

  initialize() {
    if (this.consentManager.hasConsent('analytics')) {
      this.setupEventTracking();
      this.trackSessionStart();
      this.setupPerformanceMonitoring();
    }
  }

  setupEventTracking() {
    // Track page visibility changes
    document.addEventListener('visibilitychange', () => {
      this.trackEvent('page_visibility', {
        hidden: document.hidden,
        timestamp: Date.now()
      });
    });

    // Track errors
    window.addEventListener('error', (event) => {
      this.trackError('javascript_error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack
      });
    });

    // Track unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.trackError('promise_rejection', {
        reason: event.reason,
        stack: event.reason?.stack
      });
    });
  }

  trackSessionStart() {
    this.trackEvent('session_start', {
      userAgent: navigator.userAgent,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screenResolution: `${screen.width}x${screen.height}`,
      viewportSize: `${window.innerWidth}x${window.innerHeight}`,
      devicePixelRatio: window.devicePixelRatio,
      platform: navigator.platform,
      cookieEnabled: navigator.cookieEnabled,
      online: navigator.onLine
    });
  }

  trackEvent(eventName, properties = {}) {
    if (!this.consentManager.hasConsent('analytics')) return;

    const event = {
      eventName,
      properties: {
        ...properties,
        sessionId: this.sessionId,
        userId: this.userId,
        timestamp: Date.now(),
        url: window.location.href,
        referrer: document.referrer
      }
    };

    this.eventQueue.push(event);

    // Send events in batches
    if (this.eventQueue.length >= 10) {
      this.flushEvents();
    }
  }

  trackGameEvent(eventType, data = {}) {
    const gameData = {
      gameVersion: GAME_CONFIG.version,
      playerLevel: this.getPlayerLevel(),
      gameMode: this.getCurrentGameMode(),
      ...data
    };

    this.trackEvent(`game_${eventType}`, gameData);
  }

  trackError(errorType, errorData) {
    this.trackEvent('error', {
      errorType,
      ...errorData
    });
  }

  async flushEvents() {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    try {
      await this.sendEventsToServer(events);
    } catch (error) {
      console.warn('Failed to send analytics events:', error);
      // Re-queue events for retry
      this.eventQueue.unshift(...events);
    }
  }

  async sendEventsToServer(events) {
    const response = await fetch('/api/analytics/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ events })
    });

    if (!response.ok) {
      throw new Error(`Analytics API error: ${response.status}`);
    }
  }

  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getOrCreateUserId() {
    let userId = localStorage.getItem('analytics_user_id');
    if (!userId) {
      userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('analytics_user_id', userId);
    }
    return userId;
  }

  getPlayerLevel() {
    return parseInt(localStorage.getItem('playerLevel')) || 1;
  }

  getCurrentGameMode() {
    return localStorage.getItem('gameMode') || 'default';
  }
}
```

**Step 2: Implement Performance Monitoring**
```javascript
// src/analytics/PerformanceMonitor.js
export class PerformanceMonitor {
  constructor(analyticsSystem) {
    this.analytics = analyticsSystem;
    this.metrics = {};
    this.observers = [];
  }

  initialize() {
    this.setupPerformanceObservers();
    this.trackInitialLoadMetrics();
    this.setupPeriodicReporting();
  }

  setupPerformanceObservers() {
    // Monitor Core Web Vitals
    if ('PerformanceObserver' in window) {
      // Largest Contentful Paint (LCP)
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        this.trackMetric('lcp', lastEntry.startTime);
      });
      lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });

      // First Input Delay (FID)
      const fidObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          this.trackMetric('fid', entry.processingStart - entry.startTime);
        });
      });
      fidObserver.observe({ entryTypes: ['first-input'] });

      // Cumulative Layout Shift (CLS)
      let clsValue = 0;
      const clsObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
          }
        });
        this.trackMetric('cls', clsValue);
      });
      clsObserver.observe({ entryTypes: ['layout-shift'] });

      this.observers.push(lcpObserver, fidObserver, clsObserver);
    }

    // Monitor frame rate
    this.setupFrameRateMonitoring();

    // Monitor memory usage
    this.setupMemoryMonitoring();
  }

  setupFrameRateMonitoring() {
    let frameCount = 0;
    let lastTime = performance.now();

    const measureFPS = () => {
      frameCount++;
      const currentTime = performance.now();

      if (currentTime - lastTime >= 1000) {
        const fps = (frameCount * 1000) / (currentTime - lastTime);
        this.trackMetric('fps', fps);
        frameCount = 0;
        lastTime = currentTime;
      }

      requestAnimationFrame(measureFPS);
    };

    requestAnimationFrame(measureFPS);
  }

  setupMemoryMonitoring() {
    if ('memory' in performance) {
      setInterval(() => {
        const memInfo = performance.memory;
        this.trackMetric('memory_used', memInfo.usedJSHeapSize);
        this.trackMetric('memory_total', memInfo.totalJSHeapSize);
        this.trackMetric('memory_limit', memInfo.jsHeapSizeLimit);
      }, 30000); // Every 30 seconds
    }
  }

  trackInitialLoadMetrics() {
    // Track initial page load metrics
    window.addEventListener('load', () => {
      setTimeout(() => {
        const navigation = performance.getEntriesByType('navigation')[0];
        if (navigation) {
          this.trackMetric('dom_content_loaded', navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart);
          this.trackMetric('load_complete', navigation.loadEventEnd - navigation.loadEventStart);
          this.trackMetric('dns_lookup', navigation.domainLookupEnd - navigation.domainLookupStart);
          this.trackMetric('tcp_connect', navigation.connectEnd - navigation.connectStart);
          this.trackMetric('server_response', navigation.responseEnd - navigation.requestStart);
        }
      }, 0);
    });
  }

  trackMetric(name, value, properties = {}) {
    this.metrics[name] = {
      value,
      timestamp: Date.now(),
      ...properties
    };

    this.analytics.trackEvent('performance_metric', {
      metricName: name,
      metricValue: value,
      ...properties
    });
  }

  setupPeriodicReporting() {
    // Send performance report every 5 minutes
    setInterval(() => {
      this.sendPerformanceReport();
    }, 5 * 60 * 1000);
  }

  sendPerformanceReport() {
    const report = {
      timestamp: Date.now(),
      metrics: { ...this.metrics },
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    this.analytics.trackEvent('performance_report', report);
  }

  getMetricsSummary() {
    return {
      averageFPS: this.calculateAverage('fps'),
      maxMemoryUsage: Math.max(...this.getMetricValues('memory_used')),
      coreWebVitals: {
        lcp: this.getLatestMetric('lcp'),
        fid: this.getLatestMetric('fid'),
        cls: this.getLatestMetric('cls')
      }
    };
  }

  calculateAverage(metricName) {
    const values = this.getMetricValues(metricName);
    return values.length > 0 ? values.reduce((a, b) => a + b) / values.length : 0;
  }

  getMetricValues(metricName) {
    return Object.values(this.metrics)
      .filter(metric => metric.name === metricName)
      .map(metric => metric.value);
  }

  getLatestMetric(metricName) {
    const metrics = Object.values(this.metrics)
      .filter(metric => metric.name === metricName)
      .sort((a, b) => b.timestamp - a.timestamp);

    return metrics.length > 0 ? metrics[0].value : null;
  }
}
```

**Step 3: Create User Behavior Tracking**
```javascript
// src/analytics/UserBehaviorTracker.js
export class UserBehaviorTracker {
  constructor(analyticsSystem) {
    this.analytics = analyticsSystem;
    this.sessionStartTime = Date.now();
    this.pageViews = 0;
    this.interactions = [];
    this.heatmaps = new Map();
  }

  initialize() {
    this.trackPageView();
    this.setupInteractionTracking();
    this.setupScrollTracking();
    this.setupClickTracking();
    this.setupFormTracking();
  }

  trackPageView() {
    this.pageViews++;
    this.analytics.trackEvent('page_view', {
      pageUrl: window.location.href,
      pageTitle: document.title,
      referrer: document.referrer,
      pageViewCount: this.pageViews
    });
  }

  setupInteractionTracking() {
    // Track mouse movements for heatmap data
    let lastMouseMove = 0;
    document.addEventListener('mousemove', (event) => {
      const now = Date.now();
      if (now - lastMouseMove > 100) { // Throttle to every 100ms
        this.trackMouseMovement(event.clientX, event.clientY);
        lastMouseMove = now;
      }
    });

    // Track keyboard interactions
    document.addEventListener('keydown', (event) => {
      this.trackKeyboardInteraction(event.key, event.ctrlKey, event.altKey, event.shiftKey);
    });
  }

  setupScrollTracking() {
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        this.trackScrollDepth();
      }, 100);
    });
  }

  setupClickTracking() {
    document.addEventListener('click', (event) => {
      const element = event.target;
      const elementInfo = this.getElementInfo(element);

      this.analytics.trackEvent('element_click', {
        elementType: element.tagName,
        elementId: element.id,
        elementClass: element.className,
        elementText: element.textContent?.substring(0, 100),
        x: event.clientX,
        y: event.clientY,
        ...elementInfo
      });
    });
  }

  setupFormTracking() {
    document.addEventListener('submit', (event) => {
      const form = event.target;
      const formData = this.getFormData(form);

      this.analytics.trackEvent('form_submit', {
        formId: form.id,
        formAction: form.action,
        fields: Object.keys(formData),
        fieldCount: Object.keys(formData).length
      });
    });

    // Track form field interactions
    document.addEventListener('focusin', (event) => {
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'SELECT') {
        this.trackFormFieldInteraction('focus', event.target);
      }
    });
  }

  trackMouseMovement(x, y) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Create heatmap data point
    const point = {
      x: Math.round((x / viewportWidth) * 100),
      y: Math.round((y / viewportHeight) * 100),
      timestamp: Date.now()
    };

    // Store in heatmap (simplified version)
    const key = `${point.x}-${point.y}`;
    if (!this.heatmaps.has(key)) {
      this.heatmaps.set(key, { x: point.x, y: point.y, count: 0 });
    }
    this.heatmaps.get(key).count++;
  }

  trackKeyboardInteraction(key, ctrl, alt, shift) {
    this.analytics.trackEvent('keyboard_interaction', {
      key,
      modifiers: {
        ctrl,
        alt,
        shift
      },
      timestamp: Date.now()
    });
  }

  trackScrollDepth() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const documentHeight = Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.clientHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );

    const scrollDepth = Math.round((scrollTop + windowHeight) / documentHeight * 100);

    this.analytics.trackEvent('scroll_depth', {
      depth: scrollDepth,
      maxDepth: Math.max(this.maxScrollDepth || 0, scrollDepth)
    });

    this.maxScrollDepth = Math.max(this.maxScrollDepth || 0, scrollDepth);
  }

  trackFormFieldInteraction(type, field) {
    this.analytics.trackEvent('form_field_interaction', {
      interactionType: type,
      fieldType: field.type,
      fieldName: field.name,
      fieldId: field.id,
      timestamp: Date.now()
    });
  }

  getElementInfo(element) {
    const rect = element.getBoundingClientRect();
    return {
      boundingRect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      },
      isVisible: rect.width > 0 && rect.height > 0,
      zIndex: window.getComputedStyle(element).zIndex
    };
  }

  getFormData(form) {
    const formData = new FormData(form);
    const data = {};

    for (const [key, value] of formData.entries()) {
      // Don't track sensitive data
      if (!this.isSensitiveField(key)) {
        data[key] = value.toString().substring(0, 100); // Limit length
      }
    }

    return data;
  }

  isSensitiveField(fieldName) {
    const sensitiveFields = ['password', 'creditcard', 'ssn', 'secret'];
    return sensitiveFields.some(sensitive => fieldName.toLowerCase().includes(sensitive));
  }

  getSessionSummary() {
    const sessionDuration = Date.now() - this.sessionStartTime;

    return {
      sessionDuration,
      pageViews: this.pageViews,
      interactions: this.interactions.length,
      maxScrollDepth: this.maxScrollDepth || 0,
      heatmapPoints: this.heatmaps.size
    };
  }
}
```

**Step 4: Implement A/B Testing Framework**
```javascript
// src/analytics/ABTesting.js
export class ABTesting {
  constructor(analyticsSystem) {
    this.analytics = analyticsSystem;
    this.tests = new Map();
    this.userVariants = new Map();
  }

  createTest(testId, variants, weights = null) {
    if (this.tests.has(testId)) {
      console.warn(`A/B test ${testId} already exists`);
      return;
    }

    this.tests.set(testId, {
      variants,
      weights: weights || variants.map(() => 1 / variants.length),
      startTime: Date.now()
    });
  }

  getVariant(testId) {
    if (this.userVariants.has(testId)) {
      return this.userVariants.get(testId);
    }

    const test = this.tests.get(testId);
    if (!test) {
      console.warn(`A/B test ${testId} not found`);
      return null;
    }

    const variant = this.selectVariant(test);
    this.userVariants.set(testId, variant);

    // Track variant assignment
    this.analytics.trackEvent('ab_test_variant_assigned', {
      testId,
      variant,
      timestamp: Date.now()
    });

    return variant;
  }

  selectVariant(test) {
    const random = Math.random();
    let cumulativeWeight = 0;

    for (let i = 0; i < test.variants.length; i++) {
      cumulativeWeight += test.weights[i];
      if (random <= cumulativeWeight) {
        return test.variants[i];
      }
    }

    // Fallback to first variant
    return test.variants[0];
  }

  trackConversion(testId, goalName, properties = {}) {
    const variant = this.getVariant(testId);
    if (!variant) return;

    this.analytics.trackEvent('ab_test_conversion', {
      testId,
      variant,
      goalName,
      ...properties
    });
  }

  trackEngagement(testId, actionName, properties = {}) {
    const variant = this.getVariant(testId);
    if (!variant) return;

    this.analytics.trackEvent('ab_test_engagement', {
      testId,
      variant,
      actionName,
      ...properties
    });
  }

  getTestResults(testId) {
    // This would typically query analytics data
    // For now, return mock results
    return {
      testId,
      variants: ['control', 'variant_a', 'variant_b'],
      conversionRates: [0.15, 0.18, 0.12],
      sampleSizes: [1000, 980, 1020],
      confidence: 0.95,
      winner: 'variant_a'
    };
  }

  endTest(testId) {
    const test = this.tests.get(testId);
    if (test) {
      test.endTime = Date.now();

      this.analytics.trackEvent('ab_test_ended', {
        testId,
        duration: test.endTime - test.startTime,
        variants: test.variants
      });
    }
  }
}

// Example usage
const abTesting = new ABTesting(analyticsSystem);

// Create a test for button color
abTesting.createTest('button_color_test', ['red', 'blue', 'green']);

// Get variant for current user
const buttonColor = abTesting.getVariant('button_color_test');

// Apply the variant
button.style.backgroundColor = buttonColor;

// Track conversions
button.addEventListener('click', () => {
  abTesting.trackConversion('button_color_test', 'button_click');
});
```

**Step 5: Create Analytics Dashboard**
```javascript
// src/analytics/AnalyticsDashboard.js
export class AnalyticsDashboard {
  constructor(analyticsSystem) {
    this.analytics = analyticsSystem;
    this.dashboardElement = null;
  }

  createDashboard() {
    this.dashboardElement = document.createElement('div');
    this.dashboardElement.className = 'analytics-dashboard';
    this.dashboardElement.innerHTML = `
      <div class="dashboard-header">
        <h2>Analytics Dashboard</h2>
        <button class="close-dashboard">×</button>
      </div>
      <div class="dashboard-content">
        <div class="metric-cards">
          <div class="metric-card">
            <h3>Active Users</h3>
            <div class="metric-value" id="active-users">-</div>
          </div>
          <div class="metric-card">
            <h3>Session Duration</h3>
            <div class="metric-value" id="session-duration">-</div>
          </div>
          <div class="metric-card">
            <h3>Conversion Rate</h3>
            <div class="metric-value" id="conversion-rate">-</div>
          </div>
          <div class="metric-card">
            <h3>Error Rate</h3>
            <div class="metric-value" id="error-rate">-</div>
          </div>
        </div>
        <div class="charts-container">
          <div class="chart" id="user-flow-chart"></div>
          <div class="chart" id="performance-chart"></div>
        </div>
      </div>
    `;

    document.body.appendChild(this.dashboardElement);
    this.setupEventListeners();
    this.loadDashboardData();
  }

  setupEventListeners() {
    const closeButton = this.dashboardElement.querySelector('.close-dashboard');
    closeButton.addEventListener('click', () => {
      this.hideDashboard();
    });
  }

  async loadDashboardData() {
    try {
      const data = await this.fetchAnalyticsData();

      this.updateMetrics(data);
      this.renderCharts(data);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    }
  }

  async fetchAnalyticsData() {
    // This would fetch real analytics data from your backend
    // For now, return mock data
    return {
      activeUsers: 1250,
      averageSessionDuration: 450, // seconds
      conversionRate: 0.23,
      errorRate: 0.02,
      userFlow: [
        { step: 'Landing', users: 1000 },
        { step: 'Game Start', users: 750 },
        { step: 'Tutorial Complete', users: 600 },
        { step: 'First Purchase', users: 230 }
      ],
      performance: {
        averageFPS: 58,
        averageLoadTime: 2.3,
        memoryUsage: 45
      }
    };
  }

  updateMetrics(data) {
    document.getElementById('active-users').textContent = data.activeUsers.toLocaleString();
    document.getElementById('session-duration').textContent = `${Math.round(data.averageSessionDuration / 60)}m`;
    document.getElementById('conversion-rate').textContent = `${(data.conversionRate * 100).toFixed(1)}%`;
    document.getElementById('error-rate').textContent = `${(data.errorRate * 100).toFixed(2)}%`;
  }

  renderCharts(data) {
    // Simple chart rendering (would use a charting library in production)
    this.renderUserFlowChart(data.userFlow);
    this.renderPerformanceChart(data.performance);
  }

  renderUserFlowChart(userFlow) {
    const chartElement = document.getElementById('user-flow-chart');
    // Simplified chart rendering
    chartElement.innerHTML = '<h4>User Flow</h4>' +
      userFlow.map(step =>
        `<div class="flow-step">${step.step}: ${step.users} users</div>`
      ).join('');
  }

  renderPerformanceChart(performance) {
    const chartElement = document.getElementById('performance-chart');
    chartElement.innerHTML = `
      <h4>Performance Metrics</h4>
      <div>Average FPS: ${performance.averageFPS}</div>
      <div>Average Load Time: ${performance.averageLoadTime}s</div>
      <div>Memory Usage: ${performance.memoryUsage}%</div>
    `;
  }

  showDashboard() {
    if (!this.dashboardElement) {
      this.createDashboard();
    }
    this.dashboardElement.style.display = 'block';
  }

  hideDashboard() {
    if (this.dashboardElement) {
      this.dashboardElement.style.display = 'none';
    }
  }
}
```

## 4. Check & Commit

**Files to Update:**
- src/analytics/AnalyticsSystem.js (new)
- src/analytics/PerformanceMonitor.js (new)
- src/analytics/UserBehaviorTracker.js (new)
- src/analytics/ABTesting.js (new)
- src/analytics/AnalyticsDashboard.js (new)
- src/game/core/Engine.js (register analytics system)

**Expected Impact:**
- Comprehensive user behavior insights
- Performance monitoring and optimization
- A/B testing capabilities for feature validation
- Data-driven decision making
- Improved user experience through analytics

**Testing:**
- Verify analytics events are tracked correctly
- Test performance monitoring accuracy
- Validate A/B testing variant assignment
- Check dashboard data visualization
- Ensure privacy compliance

**Commit Message:** feat: Implement comprehensive analytics system with user tracking, performance monitoring, and A/B testing

**Status:** Ready for implementation