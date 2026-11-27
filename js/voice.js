/**
 * Voice Input Module for NutriTrack PWA
 * Resilient two-layer capture for iOS Safari / standalone PWA:
 * 1. Primary: Web Speech API with graceful rec.stop() teardown & session ID isolation
 *    (avoids the WebKit AVAudioSession hardware lock triggered by premature rec.abort()).
 * 2. Fallback: Startup watchdog + automatic MediaRecorder capture (16kHz Mono PCM WAV)
 *    transcribed via NutriGemini.transcribeAudio() when iOS WebKit wedges SpeechRecognition.
 */

class NutriVoice {
  constructor() {
    this.mode = null; // 'speech' | 'recorder' | null
    this.isStarting = false;
    this.isListening = false;
    this.isTranscribing = false;

    this.recognition = null;
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.audioMimeType = '';

    this.sessionId = 0;
    this.cancelledSessionId = 0;
    this.hasCompletedOneSession = false;
    this.speechRecognitionWedged = false;

    this.startupTimer = null;
    this.teardownTimer = null;
    this.maxRecordTimer = null;

    this.pendingTranscriptionPromise = null;
    this.pendingTranscriptionResolver = null;

    this.accumulatedText = '';
    this.baseText = '';
    this.onTextUpdate = null;
    this.onStateChange = null;
    this.onError = null;
  }

  get hasSpeechRecognition() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  get hasRecorderSupport() {
    return !!(
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window.MediaRecorder === 'function'
    );
  }

  get hasSupport() {
    return this.hasSpeechRecognition || this.hasRecorderSupport;
  }

  get isBusy() {
    return this.isStarting || this.isListening || this.isTranscribing;
  }

  isSessionActive(sid) {
    return sid === this.sessionId && sid !== this.cancelledSessionId;
  }

  clearTimers() {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
    if (this.maxRecordTimer) {
      clearTimeout(this.maxRecordTimer);
      this.maxRecordTimer = null;
    }
  }

  emitState(state, detail) {
    if (this.onStateChange) {
      this.onStateChange(state, detail);
    }
  }

  resolvePendingTranscription(payload) {
    if (this.pendingTranscriptionResolver) {
      const resolve = this.pendingTranscriptionResolver;
      this.pendingTranscriptionResolver = null;
      this.pendingTranscriptionPromise = null;
      resolve(payload);
    }
  }

  /**
   * Release hardware MediaStream tracks immediately so iOS clears Dynamic Island indicator.
   */
  releaseMediaTracks() {
    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => {
          try { track.stop(); } catch (e) {}
        });
      } catch (e) {}
      this.mediaStream = null;
    }
  }

  /**
   * Gracefully stop SpeechRecognition without wiping onend beforehand,
   * allowing iOS WebKit to release AVAudioSession cleanly.
   */
  gracefulStopRecognition(forceAbort = false) {
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }

    const rec = this.recognition;
    if (!rec) return;

    this.recognition = null;

    if (forceAbort) {
      try { rec.abort(); } catch (e) {}
      return;
    }

    try {
      rec.stop();
      // Safety net if WebKit never fires onend after stop()
      this.teardownTimer = setTimeout(() => {
        this.teardownTimer = null;
        this.speechRecognitionWedged = true;
        try { rec.abort(); } catch (e) {}
      }, 350);
    } catch (e) {
      try { rec.abort(); } catch (err) {}
    }
  }

  /**
   * Clear buffered transcript text when opening modal cleanly without poking idle hardware.
   */
  resetSessionText() {
    this.accumulatedText = '';
    this.baseText = '';
  }

  shouldUseRecorder() {
    return !this.hasSpeechRecognition || (this.speechRecognitionWedged && this.hasRecorderSupport);
  }

  /**
   * Start voice capture synchronously inside the user tap handler.
   */
  start(onTextUpdate, onStateChange, onError, initialText = '') {
    if (this.isTranscribing) {
      return false;
    }
    if (this.isStarting || this.isListening) {
      this.abort();
    }

    const sid = ++this.sessionId;
    this.accumulatedText = initialText ? initialText.trim() : '';
    this.baseText = initialText ? initialText.trim() + ' ' : '';
    this.onTextUpdate = onTextUpdate;
    this.onStateChange = onStateChange;
    this.onError = onError;

    if (!this.hasSupport) {
      if (this.onError) {
        this.onError('Голосовой ввод не поддерживается в этом браузере. Используйте клавиатуру или ручной ввод.');
      }
      return false;
    }

    const targetMode = this.shouldUseRecorder() ? 'recorder' : 'speech';
    this.emitState('starting', { mode: targetMode });

    if (targetMode === 'recorder') {
      return this.startMediaRecorder(sid, false);
    }
    return this.startSpeechRecognition(sid);
  }

  startSpeechRecognition(sid) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return this.tryFallbackToRecorder(sid, false);
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ru-RU';
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      recognition.continuous = !isIOS;

      this.recognition = recognition;
      this.mode = 'speech';
      this.isStarting = true;
      this.isListening = false;

      // Shorter watchdog after first session so hung WebKit restarts recover fast
      const watchdogMs = this.hasCompletedOneSession ? 850 : 2400;
      this.startupTimer = setTimeout(() => {
        this.startupTimer = null;
        if (this.isSessionActive(sid) && this.isStarting && !this.isListening) {
          console.warn('[NutriVoice] SpeechRecognition startup watchdog timed out; switching to MediaRecorder fallback.');
          this.speechRecognitionWedged = true;
          this.hasCompletedOneSession = true;
          this.isStarting = false;
          this.gracefulStopRecognition(true);
          this.tryFallbackToRecorder(sid, true);
        }
      }, watchdogMs);

      recognition.onstart = () => {
        if (this.startupTimer) {
          clearTimeout(this.startupTimer);
          this.startupTimer = null;
        }
        if (!this.isSessionActive(sid)) {
          try { recognition.stop(); } catch (e) {}
          return;
        }
        this.isStarting = false;
        this.isListening = true;
        this.hasCompletedOneSession = true;
        this.emitState(true, { mode: 'speech' });
      };

      recognition.onresult = (event) => {
        if (!this.isSessionActive(sid)) return;

        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = 0; i < event.results.length; i++) {
          const piece = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            finalTranscript += piece + ' ';
          } else {
            interimTranscript += piece;
          }
        }

        const combined = (this.baseText + finalTranscript + interimTranscript)
          .replace(/\s+/g, ' ')
          .trim();
        this.accumulatedText = combined;

        if (this.onTextUpdate) {
          this.onTextUpdate(combined);
        }
      };

      recognition.onerror = (event) => {
        if (this.startupTimer) {
          clearTimeout(this.startupTimer);
          this.startupTimer = null;
        }
        if (!this.isSessionActive(sid)) return;

        const errCode = event.error;
        this.hasCompletedOneSession = true;

        if (errCode === 'no-speech') {
          this.isStarting = false;
          this.isListening = false;
          this.emitState(false, 'no-speech');
          return;
        }

        if (
          errCode === 'aborted' ||
          errCode === 'audio-capture' ||
          errCode === 'service-not-allowed' ||
          errCode === 'not-allowed'
        ) {
          this.speechRecognitionWedged = true;
          if (!this.isListening && this.hasRecorderSupport) {
            this.isStarting = false;
            this.gracefulStopRecognition(true);
            this.tryFallbackToRecorder(sid, true);
            return;
          }
        }

        this.isStarting = false;
        this.isListening = false;

        let friendly = 'Ошибка микрофона: ' + errCode;
        if (errCode === 'not-allowed') {
          friendly = 'Доступ к микрофону запрещен. Разрешите его в настройках Safari/iPhone или надиктуйте через клавиатуру.';
        } else if (errCode === 'network') {
          friendly = 'Ошибка сети при распознавании речи.';
        } else if (errCode === 'audio-capture') {
          friendly = 'Микрофон занят другим процессом. Нажмите еще раз.';
        }

        if (errCode !== 'aborted' && this.onError) {
          this.onError(friendly);
        }
        this.emitState(false, errCode === 'aborted' ? 'aborted' : 'error');
      };

      recognition.onend = () => {
        if (this.startupTimer) {
          clearTimeout(this.startupTimer);
          this.startupTimer = null;
        }
        if (this.teardownTimer) {
          clearTimeout(this.teardownTimer);
          this.teardownTimer = null;
        }
        if (this.recognition === recognition) {
          this.recognition = null;
        }

        if (!this.isSessionActive(sid)) {
          return;
        }

        if (this.isStarting || this.isListening) {
          this.isStarting = false;
          this.isListening = false;
          this.emitState(false, 'end');
        }
      };

      recognition.start();
      return true;
    } catch (err) {
      console.error('[NutriVoice] SpeechRecognition.start() failed:', err);
      this.clearTimers();
      this.speechRecognitionWedged = true;
      this.hasCompletedOneSession = true;
      this.isStarting = false;
      this.gracefulStopRecognition(true);
      if (this.hasRecorderSupport) {
        return this.tryFallbackToRecorder(sid, false);
      }
      if (this.onError) {
        this.onError('Не удалось запустить микрофон: ' + (err.message || 'попробуйте еще раз'));
      }
      this.emitState(false, 'error');
      return false;
    }
  }

  tryFallbackToRecorder(sid, fromAsyncWatchdog) {
    if (!this.hasRecorderSupport) {
      this.isStarting = false;
      this.isListening = false;
      this.emitState(false, 'error');
      if (this.onError) {
        this.onError('Речь не распознается. Нажмите на поле текста и используйте микрофон на клавиатуре iPhone.');
      }
      return false;
    }
    return this.startMediaRecorder(sid, fromAsyncWatchdog);
  }

  pickSupportedMimeType() {
    if (typeof window.MediaRecorder === 'undefined' || typeof window.MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/ogg;codecs=opus'
    ];
    for (const type of candidates) {
      if (window.MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  }

  startMediaRecorder(sid, fromAsyncWatchdog = false) {
    if (!this.hasRecorderSupport) {
      return false;
    }

    this.mode = 'recorder';
    this.isStarting = true;
    this.isListening = false;
    this.audioChunks = [];
    this.emitState('starting', { mode: 'recorder' });

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (!this.isSessionActive(sid)) {
          try {
            stream.getTracks().forEach((t) => {
              try { t.stop(); } catch (e) {}
            });
          } catch (e) {}
          return;
        }

        this.mediaStream = stream;
        const mimeType = this.pickSupportedMimeType();
        this.audioMimeType = mimeType;

        const recorder = mimeType
          ? new window.MediaRecorder(stream, { mimeType })
          : new window.MediaRecorder(stream);

        this.mediaRecorder = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0 && this.isSessionActive(sid)) {
            this.audioChunks.push(event.data);
          }
        };

        recorder.onerror = () => {
          this.releaseMediaTracks();
          this.mediaRecorder = null;
          if (!this.isSessionActive(sid)) return;
          this.isStarting = false;
          this.isListening = false;
          this.isTranscribing = false;
          if (this.onError) {
            this.onError('Ошибка записи аудио. Попробуйте еще раз.');
          }
          this.emitState(false, 'error');
          this.resolvePendingTranscription({ text: this.accumulatedText.trim(), cancelled: false });
        };

        recorder.onstop = () => {
          this.handleRecorderStop(sid, recorder);
        };

        recorder.start();
        this.isStarting = false;
        this.isListening = true;
        this.hasCompletedOneSession = true;
        this.emitState(true, { mode: 'recorder' });

        // Cap audio duration at 60s to keep payload compact
        this.maxRecordTimer = setTimeout(() => {
          this.maxRecordTimer = null;
          if (this.isSessionActive(sid) && this.isListening) {
            this.stop();
          }
        }, 60000);
      })
      .catch((err) => {
        if (!this.isSessionActive(sid)) return;

        this.isStarting = false;
        this.isListening = false;
        this.hasCompletedOneSession = true;

        const name = err?.name || '';
        // If Safari refused getUserMedia strictly because it wasn't called synchronously in click,
        // keep speechRecognitionWedged = true and prompt a single tap (next tap is synchronous!)
        if (fromAsyncWatchdog && (name === 'NotAllowedError' || name === 'InvalidStateError' || name === 'AbortError')) {
          this.emitState(false, 'audio-retry');
          return;
        }

        let msg = 'Не удалось открыть микрофон.';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          msg = 'Доступ к микрофону запрещен. Разрешите микрофон в настройках iPhone или надиктуйте через клавиатуру.';
        } else if (name === 'NotFoundError') {
          msg = 'Микрофон не найден на устройстве.';
        } else if (name === 'NotReadableError') {
          msg = 'Микрофон временно занят. Нажмите на микрофон еще раз.';
        }

        if (this.onError) {
          this.onError(msg);
        }
        this.emitState(false, 'error');
      });

    return true;
  }

  async handleRecorderStop(sid, recorder) {
    this.releaseMediaTracks();
    if (this.mediaRecorder === recorder) {
      this.mediaRecorder = null;
    }

    if (!this.isSessionActive(sid)) {
      this.audioChunks = [];
      this.isTranscribing = false;
      this.resolvePendingTranscription({ text: '', cancelled: true });
      return;
    }

    const rawMime = recorder.mimeType || this.audioMimeType || 'audio/mp4';
    const blob = new Blob(this.audioChunks, { type: rawMime });
    this.audioChunks = [];

    if (blob.size < 800) {
      this.isTranscribing = false;
      this.emitState(false, 'no-speech');
      this.resolvePendingTranscription({ text: this.accumulatedText.trim(), noSpeech: true });
      return;
    }

    if (!this.isTranscribing) {
      this.isTranscribing = true;
      this.emitState('transcribing', { mode: 'recorder' });
    }

    try {
      const payload = await this.prepareAudioPayload(blob, rawMime);
      if (!this.isSessionActive(sid)) {
        this.isTranscribing = false;
        this.resolvePendingTranscription({ text: '', cancelled: true });
        return;
      }

      if (payload.tooShort || !payload.base64) {
        this.isTranscribing = false;
        this.emitState(false, 'no-speech');
        this.resolvePendingTranscription({ text: this.accumulatedText.trim(), noSpeech: true });
        return;
      }

      const transcript = await window.NutriGemini.transcribeAudio(
        payload.base64,
        payload.format,
        payload.mimeType
      );

      if (!this.isSessionActive(sid)) {
        this.isTranscribing = false;
        this.resolvePendingTranscription({ text: '', cancelled: true });
        return;
      }

      this.isTranscribing = false;

      if (!transcript) {
        this.emitState(false, 'no-speech');
        this.resolvePendingTranscription({ text: this.accumulatedText.trim(), noSpeech: true });
        return;
      }

      const fullText = (this.baseText + transcript).replace(/\s+/g, ' ').trim();
      this.accumulatedText = fullText;
      this.baseText = fullText + ' ';

      if (this.onTextUpdate) {
        this.onTextUpdate(fullText);
      }
      this.emitState(false, 'transcribed');
      this.resolvePendingTranscription({ text: fullText });
    } catch (err) {
      if (!this.isSessionActive(sid)) {
        this.isTranscribing = false;
        this.resolvePendingTranscription({ text: '', cancelled: true });
        return;
      }
      this.isTranscribing = false;
      if (this.onError) {
        this.onError('Ошибка распознавания речи: ' + (err.message || 'попробуйте еще раз'));
      }
      this.emitState(false, 'transcribe-error');
      this.resolvePendingTranscription({ text: this.accumulatedText.trim(), error: err });
    }
  }

  /**
   * Convert recorded audio Blob to 16kHz Mono 16-bit PCM WAV when WebAudio decode succeeds,
   * falling back cleanly to the raw recorded container (m4a/webm/ogg) if decodeAudioData fails.
   */
  async prepareAudioPayload(blob, rawMimeType) {
    const mimeType = (rawMimeType || blob.type || 'audio/mp4').split(';')[0].trim();

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const arrayBuffer = await blob.arrayBuffer();
        const ctx = new AudioCtx();
        try {
          const audioBuffer = await new Promise((resolve, reject) => {
            const maybePromise = ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
            if (maybePromise && typeof maybePromise.then === 'function') {
              maybePromise.then(resolve, reject);
            }
          });

          if (audioBuffer && audioBuffer.length > 0) {
            if (audioBuffer.duration < 0.2) {
              return { base64: '', format: 'wav', mimeType: 'audio/wav', tooShort: true };
            }
            const wavBuffer = this.encodeAudioBufferTo16kWav(audioBuffer);
            return {
              base64: this.arrayBufferToBase64(wavBuffer),
              format: 'wav',
              mimeType: 'audio/wav',
              tooShort: false
            };
          }
        } finally {
          try { ctx.close().catch(() => {}); } catch (e) {}
        }
      }
    } catch (decodeErr) {
      console.warn('[NutriVoice] WAV conversion skipped, using native container:', decodeErr);
    }

    const rawBuffer = await blob.arrayBuffer();
    let format = 'm4a';
    if (mimeType.includes('webm')) format = 'webm';
    else if (mimeType.includes('ogg')) format = 'ogg';
    else if (mimeType.includes('wav')) format = 'wav';
    else if (mimeType.includes('aac')) format = 'aac';

    return {
      base64: this.arrayBufferToBase64(rawBuffer),
      format,
      mimeType,
      tooShort: false
    };
  }

  encodeAudioBufferTo16kWav(audioBuffer) {
    const numChannels = Math.max(1, audioBuffer.numberOfChannels);
    const srcLen = audioBuffer.length;
    const mono = new Float32Array(srcLen);

    for (let ch = 0; ch < numChannels; ch++) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < srcLen; i++) {
        mono[i] += data[i] / numChannels;
      }
    }

    const targetRate = 16000;
    const srcRate = audioBuffer.sampleRate;
    let resampled;

    if (srcRate === targetRate) {
      resampled = mono;
    } else {
      const ratio = srcRate / targetRate;
      const outLen = Math.max(1, Math.round(srcLen / ratio));
      resampled = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const srcIdx = i * ratio;
        const idx0 = Math.floor(srcIdx);
        const idx1 = Math.min(idx0 + 1, srcLen - 1);
        const frac = srcIdx - idx0;
        resampled[i] = mono[idx0] * (1 - frac) + mono[idx1] * frac;
      }
    }

    const buffer = new ArrayBuffer(44 + resampled.length * 2);
    const view = new DataView(buffer);

    const writeAscii = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + resampled.length * 2, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true);  // Linear PCM
    view.setUint16(22, 1, true);  // Mono
    view.setUint32(24, targetRate, true);
    view.setUint32(28, targetRate * 2, true); // Byte rate
    view.setUint16(32, 2, true);  // Block align
    view.setUint16(34, 16, true); // Bits per sample
    writeAscii(36, 'data');
    view.setUint32(40, resampled.length * 2, true);

    let offset = 44;
    for (let i = 0; i < resampled.length; i++) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }

    return buffer;
  }

  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  /**
   * Stop active recording (preserving transcript or triggering MediaRecorder transcription).
   */
  stop() {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.maxRecordTimer) {
      clearTimeout(this.maxRecordTimer);
      this.maxRecordTimer = null;
    }

    if (this.mode === 'recorder') {
      if (this.isStarting && !this.mediaRecorder) {
        this.abort();
        return { pendingTranscription: false, text: this.accumulatedText.trim() };
      }

      if (this.mediaRecorder) {
        this.isStarting = false;
        this.isListening = false;
        this.isTranscribing = true;

        if (!this.pendingTranscriptionPromise) {
          this.pendingTranscriptionPromise = new Promise((resolve) => {
            this.pendingTranscriptionResolver = resolve;
          });
        }

        this.emitState('transcribing', { mode: 'recorder' });

        try {
          if (this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
          } else {
            this.releaseMediaTracks();
            this.isTranscribing = false;
            this.emitState(false, 'manual-stop');
            this.resolvePendingTranscription({ text: this.accumulatedText.trim() });
          }
        } catch (e) {
          this.releaseMediaTracks();
          this.isTranscribing = false;
          this.emitState(false, 'error');
          this.resolvePendingTranscription({ text: this.accumulatedText.trim(), error: e });
        }

        return {
          pendingTranscription: true,
          promise: this.pendingTranscriptionPromise,
          text: this.accumulatedText.trim()
        };
      }
    }

    this.isStarting = false;
    this.isListening = false;
    this.gracefulStopRecognition(false);
    this.emitState(false, 'manual-stop');
    return {
      pendingTranscription: false,
      text: this.accumulatedText.trim()
    };
  }

  /**
   * Stop recording or wait for pending AI transcription before submitting meal text.
   */
  async finishRecording() {
    if (this.isListening || this.isStarting) {
      const res = this.stop();
      if (res.pendingTranscription && res.promise) {
        return await res.promise;
      }
      return { text: res.text, cancelled: false };
    }
    if (this.isTranscribing && this.pendingTranscriptionPromise) {
      return await this.pendingTranscriptionPromise;
    }
    return { text: this.accumulatedText.trim(), cancelled: false };
  }

  /**
   * Cancel active capture cleanly without leaving native iOS audio sessions open.
   */
  abort() {
    this.cancelledSessionId = this.sessionId;
    this.clearTimers();

    this.isStarting = false;
    this.isListening = false;
    this.isTranscribing = false;
    this.audioChunks = [];

    this.gracefulStopRecognition(false);

    if (this.mediaRecorder) {
      const recorder = this.mediaRecorder;
      this.mediaRecorder = null;
      try {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      } catch (e) {}
    }
    this.releaseMediaTracks();

    this.resolvePendingTranscription({ text: '', cancelled: true });
    this.accumulatedText = '';
    this.baseText = '';
    this.emitState(false, 'cancel');
  }
}

window.NutriVoice = new NutriVoice();
