/**
 * Voice Input Module for NutriTrack PWA
 * Rock-solid support for iOS Safari, WebKit, and mobile browsers
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
      const rec = this.recognition;
      this.recognition = null;
      try {
        rec.onstart = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort();
      } catch (e) {}
    }
    this.isListening = false;
  }

  start(onTextUpdate, onStateChange, onError, initialText = '') {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (onError) onError('Голосовой ввод через браузер не поддерживается. Нажмите на поле ниже и используйте микрофон на клавиатуре iPhone.');
      return false;
    }

    // Clean up any stale or running instance immediately
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
      recognition.maxAlternatives = 1;

      // On iOS Safari continuous can cause audio session crash; on desktop Chrome/Edge continuous is great
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      recognition.continuous = !isIOS;

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
        this.isListening = false;

        if (event.error === 'no-speech') {
          if (this.onStateChange) this.onStateChange(false, 'no-speech');
          return;
        }

        if (this.onStateChange) this.onStateChange(false, event.error);

        let msg = 'Ошибка микрофона (' + event.error + ').';
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          msg = 'Доступ к микрофону заблокирован. Разрешите микрофон в настройках браузера или используйте микрофон на клавиатуре.';
        } else if (event.error === 'network') {
          msg = 'Сетевая ошибка распознавания речи. Попробуйте еще раз или используйте клавиатуру.';
        } else if (event.error === 'audio-capture') {
          msg = 'Микрофон недоступен (занят другим приложением).';
        }

        if (this.onError) this.onError(msg);
      };

      recognition.onend = () => {
        this.isListening = false;
        if (this.recognition === recognition) {
          this.recognition = null;
        }
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
    if (this.recognition) {
      const rec = this.recognition;
      this.recognition = null;
      try {
        rec.stop();
      } catch (e) {
        try { rec.abort(); } catch (err) {}
      }
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
