/**
 * Voice Input Module for NutriTrack PWA
 * Optimized for iOS Safari and mobile browsers with per-session instance recreation
 */

class NutriVoice {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.accumulatedText = '';
    this.baseText = '';
    this.onTextUpdate = null;
    this.onStateChange = null;
    this.onError = null;
  }

  get hasSupport() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  cleanup() {
    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.abort();
      } catch (e) {
        // Ignore cleanup errors
      }
      this.recognition = null;
    }
    this.isListening = false;
  }

  start(onTextUpdate, onStateChange, onError, initialText = '') {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (onError) onError('Голосовой ввод не поддерживается данным браузером. Нажмите на микрофон на клавиатуре iPhone при вводе текста.');
      return false;
    }

    // Always clean up previous instance so iOS Safari gets a fresh recognition session
    this.cleanup();

    this.accumulatedText = initialText ? initialText.trim() : '';
    this.baseText = initialText ? initialText.trim() + ' ' : '';
    this.onTextUpdate = onTextUpdate;
    this.onStateChange = onStateChange;
    this.onError = onError;

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ru-RU';
      recognition.interimResults = true;
      // On iOS Safari, continuous=true can fail or hang; continuous=false with interim is much more reliable
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      recognition.continuous = !isIOS;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        this.isListening = true;
        if (this.onStateChange) this.onStateChange(true);
      };

      recognition.onresult = (event) => {
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

        const sessionText = (finalStr + interimStr).trim();
        this.accumulatedText = (this.baseText + sessionText).trim();

        if (this.onTextUpdate && this.accumulatedText) {
          this.onTextUpdate(this.accumulatedText);
        }
      };

      recognition.onerror = (event) => {
        console.warn('SpeechRecognition error:', event.error);
        if (event.error === 'no-speech') {
          // Normal silence timeout, don't crash
          return;
        }

        this.isListening = false;
        if (this.onStateChange) this.onStateChange(false);

        let msg = 'Ошибка микрофона.';
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          msg = 'Доступ к микрофону заблокирован в настройках Safari.';
        } else if (event.error === 'network') {
          msg = 'Ошибка сетевого распознавания речи.';
        } else if (event.error === 'audio-capture') {
          msg = 'Микрофон не найден или занят другим приложением.';
        }

        if (this.onError) this.onError(msg);
      };

      recognition.onend = () => {
        this.isListening = false;
        if (this.onStateChange) this.onStateChange(false);
      };

      this.recognition = recognition;
      recognition.start();
      return true;
    } catch (err) {
      console.error('SpeechRecognition start failed:', err);
      this.cleanup();
      if (this.onStateChange) this.onStateChange(false);
      if (onError) onError('Не удалось включить микрофон. Попробуйте еще раз.');
      return false;
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
    this.cleanup();
    this.accumulatedText = '';
    if (this.onStateChange) this.onStateChange(false);
  }
}

window.NutriVoice = new NutriVoice();
