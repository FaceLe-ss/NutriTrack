/**
 * Voice Input Module for NutriTrack PWA
 * Optimized for iOS Safari with fallback and tap-to-toggle support
 */

class NutriVoice {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.hasSupport = false;
    this.accumulatedText = '';
    this.onTextUpdate = null;
    this.onStateChange = null;
    this.onError = null;
    this.init();
  }

  init() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true; // Keep listening until user explicitly stops
        this.recognition.interimResults = true;
        this.recognition.lang = 'ru-RU';
        this.hasSupport = true;
        this.setupHandlers();
      } catch (e) {
        console.warn('SpeechRecognition init error:', e);
        this.hasSupport = false;
      }
    } else {
      this.hasSupport = false;
    }
  }

  setupHandlers() {
    if (!this.recognition) return;

    this.recognition.onstart = () => {
      this.isListening = true;
      if (this.onStateChange) this.onStateChange(true);
    };

    this.recognition.onresult = (event) => {
      let finalStr = '';
      let interimStr = '';

      for (let i = 0; i < event.results.length; ++i) {
        const result = event.results[i];
        if (result.isFinal) {
          finalStr += result[0].transcript + ' ';
        } else {
          interimStr += result[0].transcript;
        }
      }

      this.accumulatedText = (finalStr + interimStr).trim();
      if (this.onTextUpdate) {
        this.onTextUpdate(this.accumulatedText);
      }
    };

    this.recognition.onerror = (event) => {
      console.warn('Speech recognition event error:', event.error);
      this.isListening = false;
      if (this.onStateChange) this.onStateChange(false);

      let msg = 'Ошибка микрофона.';
      if (event.error === 'not-allowed') {
        msg = 'Доступ к микрофону заблокирован в настройках Safari.';
      } else if (event.error === 'network') {
        msg = 'Ошибка сетевого распознавания речи.';
      } else if (event.error === 'no-speech') {
        // Just silence, don't crash
        return;
      }

      if (this.onError) this.onError(msg);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      if (this.onStateChange) this.onStateChange(false);
    };
  }

  start(onTextUpdate, onStateChange, onError) {
    if (!this.hasSupport) {
      if (onError) onError('Голосовой ввод не поддерживается данным браузером. Нажмите на микрофон на клавиатуре iPhone при вводе текста.');
      return false;
    }

    this.accumulatedText = '';
    this.onTextUpdate = onTextUpdate;
    this.onStateChange = onStateChange;
    this.onError = onError;

    try {
      this.recognition.start();
      return true;
    } catch (err) {
      console.warn('Recognition start exception:', err);
      // If already started, stop and restart
      try {
        this.recognition.stop();
        setTimeout(() => {
          try { this.recognition.start(); } catch (e) {}
        }, 150);
      } catch (e) {}
      return true;
    }
  }

  stop() {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
    if (this.onStateChange) this.onStateChange(false);
    return this.accumulatedText.trim();
  }

  abort() {
    this.isListening = false;
    this.accumulatedText = '';
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch (e) {}
    }
    if (this.onStateChange) this.onStateChange(false);
  }
}

window.NutriVoice = new NutriVoice();
