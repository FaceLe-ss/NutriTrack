/**
 * Voice Input Module for NutriTrack PWA
 * Rock-solid support for iOS Safari, WebKit, and mobile browsers
 */

class NutriVoice {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.isBusy = false;
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
      } catch (e) {}
      this.recognition = null;
    }
    this.isListening = false;
    this.isBusy = false;
  }

  start(onTextUpdate, onStateChange, onError, initialText = '') {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (onError) onError('Голосовой ввод через браузер не поддерживается. Нажмите на поле ниже и используйте микрофон на клавиатуре iPhone.');
      return false;
    }

    if (this.isBusy) {
      return false;
    }

    // Always ensure clean previous state
    this.cleanup();
    this.isBusy = true;

    this.accumulatedText = initialText ? initialText.trim() : '';
    this.baseText = initialText ? initialText.trim() + ' ' : '';
    this.onTextUpdate = onTextUpdate;
    this.onStateChange = onStateChange;
    this.onError = onError;

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ru-RU';
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      // On iOS Safari continuous can cause audio session crash or silent drop
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      recognition.continuous = !isIOS;

      recognition.onstart = () => {
        this.isBusy = false;
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
        this.isBusy = false;
        this.isListening = false;

        if (event.error === 'no-speech') {
          if (this.onStateChange) this.onStateChange(false, 'no-speech');
          return;
        }

        if (this.onStateChange) this.onStateChange(false, event.error);

        let msg = 'Ошибка микрофона (' + event.error + ').';
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          msg = 'Доступ к микрофону заблокирован в Safari. Включите микрофон в настройках сайта или используйте микрофон на клавиатуре iPhone.';
        } else if (event.error === 'network') {
          msg = 'Сетевая ошибка распознавания речи Apple. Попробуйте еще раз или используйте клавиатуру.';
        } else if (event.error === 'audio-capture') {
          msg = 'Микрофон недоступен (занят другим приложением).';
        }

        if (this.onError) this.onError(msg);
      };

      recognition.onend = () => {
        this.isBusy = false;
        this.isListening = false;
        this.cleanup();
        if (this.onStateChange) this.onStateChange(false, 'end');
      };

      this.recognition = recognition;
      recognition.start();
      return true;
    } catch (err) {
      console.error('SpeechRecognition start failed:', err);
      this.cleanup();
      if (this.onStateChange) this.onStateChange(false);
      if (onError) onError('Не удалось запустить микрофон: ' + (err.message || 'попробуйте еще раз'));
      return false;
    }
  }

  stop() {
    this.isListening = false;
    this.isBusy = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        try { this.recognition.abort(); } catch (err) {}
      }
      this.cleanup();
    }
    if (this.onStateChange) this.onStateChange(false, 'manual-stop');
    return this.accumulatedText.trim();
  }

  abort() {
    this.cleanup();
    this.accumulatedText = '';
    this.baseText = '';
    if (this.onStateChange) this.onStateChange(false, 'abort');
  }
}

window.NutriVoice = new NutriVoice();
