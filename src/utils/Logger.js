export class Logger {
  static get level() {
    return import.meta.env.PROD ? 'error' : 'debug';
  }
  
  static shouldLog(level) {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    return levels[level] >= levels[Logger.level];
  }
  static levels = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
  };

  static currentLevel = import.meta.env.PROD ? this.levels.WARN : this.levels.DEBUG;

  static error(message, ...args) {
    console.error(`[ERROR] ${message}`, ...args);
  }

  static warn(message, ...args) {
    console.warn(`[WARN] ${message}`, ...args);
  }

  static info(message, ...args) {
    if (Logger.currentLevel >= Logger.levels.INFO) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  static debug(message, ...args) {
    if (Logger.currentLevel >= Logger.levels.DEBUG) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }
}
