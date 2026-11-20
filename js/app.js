/**
 * NutriTrack PWA — Main Application Controller
 */

class NutriApp {
  constructor() {
    this.currentDateStr = new Date().toISOString().split('T')[0];
    this.settings = null;
    this.todayMeals = [];
    this.tempScanResult = null; // For holding AI scan before saving
    this.currentMealToEdit = null;
    this.historyTypeFilter = 'Все';
    this.historyPeriodFilter = 'all';
  }

  async init() {
    // Register Service Worker for PWA capabilities
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('Service Worker registered successfully'))
        .catch((err) => console.log('Service Worker registration failed:', err));
    }

    // Load settings
    this.settings = await window.NutriStorage.getSettings();

    // Apply saved Theme (dark / light)
    this.applyTheme(this.settings.theme || 'dark');

    // Render header date
    this.renderDateHeader();

    // Setup Event Listeners
    this.setupEventListeners();

    // Check if API key is present; if not, show gentle onboarding banner or prompt
    if (!this.settings.gemini_api_key) {
      console.log('No Gemini API key configured yet.');
    }

    // Refresh UI with today's data
    await this.refreshData();
  }

  // --- THEME MANAGEMENT ---

  applyTheme(theme) {
    const isLight = theme === 'light';
    const effectiveTheme = isLight ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', effectiveTheme);

    // Update Meta Theme Color for Safari Status Bar
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', isLight ? '#f8fafc' : '#090d16');
    }

    const metaStatusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (metaStatusBar) {
      metaStatusBar.setAttribute('content', isLight ? 'default' : 'black-translucent');
    }

    // Update Header Icon
    const headerIcon = document.getElementById('headerThemeIcon');
    if (headerIcon) {
      headerIcon.textContent = isLight ? '☀️' : '🌙';
    }

    // Update Two-Button Pill in Header (Moon and Sun)
    const moonBtn = document.getElementById('themeMoonBtn');
    const sunBtn = document.getElementById('themeSunBtn');
    if (moonBtn && sunBtn) {
      if (isLight) {
        sunBtn.classList.add('active');
        moonBtn.classList.remove('active');
      } else {
        moonBtn.classList.add('active');
        sunBtn.classList.remove('active');
      }
    }

    // Update segmented buttons in Settings
    const darkBtn = document.getElementById('themeDarkBtn');
    const lightBtn = document.getElementById('themeLightBtn');

    if (darkBtn && lightBtn) {
      if (isLight) {
        lightBtn.style.backgroundColor = 'var(--bg-surface)';
        lightBtn.style.color = 'var(--text-main)';
        lightBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';

        darkBtn.style.backgroundColor = 'transparent';
        darkBtn.style.color = 'var(--text-muted)';
        darkBtn.style.boxShadow = 'none';
      } else {
        darkBtn.style.backgroundColor = 'var(--bg-surface)';
        darkBtn.style.color = 'var(--text-main)';
        darkBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';

        lightBtn.style.backgroundColor = 'transparent';
        lightBtn.style.color = 'var(--text-muted)';
        lightBtn.style.boxShadow = 'none';
      }
    }
  }

  async setTheme(theme) {
    this.applyTheme(theme);
    await window.NutriStorage.saveSettings({ theme });
    this.settings = await window.NutriStorage.getSettings();
  }

  async toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const nextTheme = current === 'dark' ? 'light' : 'dark';
    await this.setTheme(nextTheme);
  }

  renderDateHeader() {
    const isToday = this.currentDateStr === new Date().toISOString().split('T')[0];

    // Current date label (top header)
    const dateElem = document.getElementById('currentDateLabel');
    const d = new Date(this.currentDateStr + 'T00:00:00');
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    const formatted = d.toLocaleDateString('ru-RU', options);
    const capDate = formatted.charAt(0).toUpperCase() + formatted.slice(1);

    if (dateElem) {
      if (this.settings?.user_name) {
        dateElem.textContent = `${capDate} · ${this.settings.user_name}`;
      } else {
        dateElem.textContent = capDate;
      }
    }

    // Date navigator in main view
    const navText = document.getElementById('dateNavText');
    const todayBadge = document.getElementById('dateNavTodayBadge');

    if (navText) {
      navText.textContent = isToday ? `Сегодня, ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` : capDate;
    }
    if (todayBadge) {
      todayBadge.style.display = isToday ? 'inline-block' : 'none';
    }
  }

  changeDate(deltaDays) {
    const cur = new Date(this.currentDateStr + 'T00:00:00');
    cur.setDate(cur.getDate() + deltaDays);
    this.currentDateStr = cur.toISOString().split('T')[0];
    this.renderDateHeader();
    this.refreshData();
  }

  openDatePicker() {
    const picker = document.getElementById('hiddenDatePicker');
    if (picker) {
      picker.value = this.currentDateStr;
      if (typeof picker.showPicker === 'function') {
        picker.showPicker();
      } else {
        picker.click();
      }
    }
  }

  onDatePicked(dateValue) {
    if (dateValue) {
      this.currentDateStr = dateValue;
      this.renderDateHeader();
      this.refreshData();
    }
  }

  async refreshData() {
    this.todayMeals = await window.NutriStorage.getMealsByDate(this.currentDateStr);
    const summary = await window.NutriStorage.getDaySummary(this.currentDateStr);
    this.settings = await window.NutriStorage.getSettings();

    this.renderCalorieGauge(summary);
    this.renderMacros(summary);
    this.renderXEBanner(summary);
    this.renderMealsList(this.todayMeals);
  }

  renderCalorieGauge(summary) {
    const target = Number(this.settings.target_calories) || 2100;
    const consumed = Math.round(summary.calories);
    const isExceeded = consumed > target;
    const diff = Math.abs(consumed - target);

    const radius = 50;
    const perimeter = 2 * Math.PI * radius; // ~314.15
    const progress = Math.min(1, consumed / target);
    const strokeOffset = isExceeded ? 0 : perimeter * (1 - progress);

    const circle = document.getElementById('gaugeCircleProgress');
    if (circle) {
      circle.style.strokeDasharray = perimeter;
      circle.style.strokeDashoffset = strokeOffset;
      circle.style.stroke = isExceeded ? '#ef4444' : 'var(--color-calories)';
    }

    const remainingElem = document.getElementById('gaugeRemainingNumber');
    if (remainingElem) {
      if (isExceeded) {
        remainingElem.textContent = `+${diff.toLocaleString('ru-RU')}`;
        remainingElem.style.color = '#ef4444';
        remainingElem.style.fontSize = diff >= 1000 ? '22px' : '26px';
      } else {
        remainingElem.textContent = (target - consumed).toLocaleString('ru-RU');
        remainingElem.style.color = 'var(--text-main)';
        remainingElem.style.fontSize = (target - consumed) >= 1000 ? '22px' : '26px';
      }
    }

    const remainingLabel = document.getElementById('gaugeRemainingLabel');
    if (remainingLabel) {
      if (isExceeded) {
        remainingLabel.textContent = 'превышено';
        remainingLabel.style.color = '#ef4444';
      } else {
        remainingLabel.textContent = 'осталось';
        remainingLabel.style.color = 'var(--text-muted)';
      }
    }

    const consumedElem = document.getElementById('gaugeConsumedNumber');
    if (consumedElem) {
      consumedElem.textContent = consumed.toLocaleString('ru-RU');
      consumedElem.style.color = isExceeded ? '#ef4444' : '';
    }

    const excessNotice = document.getElementById('gaugeExcessNotice');
    if (excessNotice) {
      if (isExceeded) {
        excessNotice.textContent = `⚠️ Превышено на ${diff.toLocaleString('ru-RU')} ккал`;
        excessNotice.style.display = 'block';
      } else {
        excessNotice.style.display = 'none';
      }
    }

    const targetElem = document.getElementById('gaugeTargetNumber');
    if (targetElem) {
      targetElem.textContent = target.toLocaleString('ru-RU');
    }
  }

  renderMacros(summary) {
    const targetP = Number(this.settings.target_protein) || 140;
    const targetF = Number(this.settings.target_fat) || 70;
    const targetC = Number(this.settings.target_carbs) || 220;

    const curP = Math.round(summary.protein);
    const curF = Math.round(summary.fat);
    const curC = Math.round(summary.carbs);

    // Protein
    const pctP = Math.min(100, Math.round((curP / targetP) * 100));
    document.getElementById('proteinCurrentVal').textContent = `${curP} / ${targetP}г`;
    document.getElementById('proteinPercent').textContent = `${pctP}%`;
    document.getElementById('proteinBarFill').style.width = `${pctP}%`;

    // Fat
    const pctF = Math.min(100, Math.round((curF / targetF) * 100));
    document.getElementById('fatCurrentVal').textContent = `${curF} / ${targetF}г`;
    document.getElementById('fatPercent').textContent = `${pctF}%`;
    document.getElementById('fatBarFill').style.width = `${pctF}%`;

    // Carbs
    const pctC = Math.min(100, Math.round((curC / targetC) * 100));
    document.getElementById('carbsCurrentVal').textContent = `${curC} / ${targetC}г`;
    document.getElementById('carbsPercent').textContent = `${pctC}%`;
    document.getElementById('carbsBarFill').style.width = `${pctC}%`;
  }

  renderXEBanner(summary) {
    const xeElem = document.getElementById('todayTotalXE');
    if (xeElem) {
      xeElem.textContent = `${summary.bread_units} ХЕ`;
    }
  }

  renderMealsList(meals) {
    const container = document.getElementById('mealsContainer');
    const countLabel = document.getElementById('mealsCountLabel');
    if (!container) return;

    if (countLabel) {
      countLabel.textContent = `${meals.length} ${this.declension(meals.length, ['блюдо', 'блюда', 'блюд'])}`;
    }

    if (meals.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🍽️</div>
          <div class="empty-state-title">Пока ничего не записано</div>
          <div class="empty-state-sub">Сфотографируйте блюдо, продиктуйте голосом или введите вручную с помощью кнопок ниже.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = meals.map((m) => {
      const typeEmoji = this.getMealEmoji(m.type);
      const thumbContent = m.photo
        ? `<img src="${m.photo}" alt="${this.escapeHtml(m.name)}" class="meal-thumb" />`
        : `<div class="meal-thumb">${typeEmoji}</div>`;

      return `
        <div class="meal-card" onclick="window.app.openMealDetailModal('${m.id}')">
          ${thumbContent}
          <div class="meal-info">
            <div class="meal-title-row">
              <span class="meal-title">${this.escapeHtml(m.name)}</span>
              <span class="meal-cals">${m.calories} ккал</span>
            </div>
            <div class="meal-meta-row">
              <span>${m.type} · ${m.time}</span>
              <span>·</span>
              <span>${m.weight_g}г</span>
              <span class="meal-xe-pill">🏷️ ${m.bread_units} ХЕ</span>
            </div>
            <div class="meal-macros-row">
              <span>Б: ${m.protein}г</span>
              <span>Ж: ${m.fat}г</span>
              <span>У: ${m.carbs}г</span>
            </div>
            ${m.comment ? `<div style="font-size:11px;color:var(--text-muted);margin-top:3px;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">💬 ${this.escapeHtml(m.comment)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  getMealEmoji(type) {
    switch (type) {
      case 'Завтрак': return '🥣';
      case 'Обед': return '🥗';
      case 'Перекус': return '☕';
      case 'Ужин': return '🍲';
      default: return '🍽️';
    }
  }

  declension(number, words) {
    return words[(number % 100 > 4 && number % 100 < 20) ? 2 : [2, 0, 1, 1, 1, 2][(number % 10 < 5) ? Math.abs(number) % 10 : 5]];
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // --- ACTIONS & DIALOGS ---

  setupEventListeners() {
    // Camera file input listener
    const cameraInput = document.getElementById('cameraInput');
    if (cameraInput) {
      cameraInput.addEventListener('change', (e) => this.handleCameraCapture(e));
    }

    // Modal close overlay clicks
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
          if (overlay.id === 'voiceModalOverlay') {
            this.cancelVoiceRecording();
          }
        }
      });
    });

    // Auto-recalculate ХЕ when carbs are manually changed in verification modal
    const editCarbsInput = document.getElementById('scanCarbsInput');
    if (editCarbsInput) {
      editCarbsInput.addEventListener('input', (e) => {
        const carbs = Math.max(0, Number(e.target.value) || 0);
        const xeRatio = Number(this.settings.xe_ratio) || 10;
        const xe = Number((carbs / xeRatio).toFixed(1));
        document.getElementById('scanBreadUnitsDisplay').textContent = `${xe} ХЕ`;
      });
    }

    // Universal Swipe-Down-To-Dismiss for all bottom sheets
    this.setupSwipeToDismiss();
  }

  setupSwipeToDismiss() {
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      const sheet = overlay.querySelector('.bottom-sheet');
      if (!sheet) return;

      let startY = 0;
      let currentY = 0;
      let isDragging = false;
      let canDrag = false;

      sheet.addEventListener('touchstart', (e) => {
        // Can only drag down if sheet is scrolled to the top
        if (sheet.scrollTop <= 2) {
          canDrag = true;
          startY = e.touches[0].clientY;
          currentY = startY;
          isDragging = false;
        } else {
          canDrag = false;
        }
      }, { passive: true });

      sheet.addEventListener('touchmove', (e) => {
        if (!canDrag) return;
        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;

        if (deltaY > 0) {
          isDragging = true;
          sheet.style.transform = `translateY(${deltaY}px)`;
          sheet.style.transition = 'none';
        }
      }, { passive: true });

      sheet.addEventListener('touchend', () => {
        if (!canDrag || !isDragging) return;
        const deltaY = currentY - startY;
        sheet.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';

        if (deltaY > 80) {
          // Close sheet
          sheet.style.transform = 'translateY(100%)';
          setTimeout(() => {
            overlay.classList.remove('active');
            sheet.style.transform = '';
            sheet.style.transition = '';
            if (overlay.id === 'voiceModalOverlay') {
              window.app.cancelVoiceRecording();
            }
          }, 220);
        } else {
          // Snap back
          sheet.style.transform = 'translateY(0)';
          setTimeout(() => {
            sheet.style.transform = '';
            sheet.style.transition = '';
          }, 250);
        }
        canDrag = false;
        isDragging = false;
      }, { passive: true });
    });
  }

  hasValidApiKey() {
    return !!(this.settings?.openrouter_api_key && this.settings.openrouter_api_key.trim());
  }

  // 1. TRIGGER CAMERA
  triggerPhotoCapture() {
    if (!this.hasValidApiKey()) {
      this.openSettingsModal('Для распознавания укажите API-ключ OpenRouter в настройках.');
      return;
    }
    const input = document.getElementById('cameraInput');
    if (input) {
      input.value = ''; // Reset
      input.click();
    }
  }

  async handleCameraCapture(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    this.showLoadingModal('ИИ распознает блюдо по фото...', 'Сжатие снимка и анализ размера порции, калорий и ХЕ');

    try {
      // 1. Compress image on client
      const processed = await window.NutriCamera.processImageFile(file, 1024, 0.82);

      // 2. Call OpenRouter / Gemini Vision API
      const aiResult = await window.NutriGemini.analyzeFoodImage(processed.base64, processed.mimeType);

      this.closeLoadingModal();

      // 3. Open Verification Modal
      this.openScanVerificationModal({
        ...aiResult,
        photoThumbnail: processed.thumbnailUrl
      });
    } catch (err) {
      this.closeLoadingModal();
      this.showToast('Ошибка: ' + err.message, true);
    }
  }

  // 2. VOICE CONTROLLER (Tap-to-start / Tap-to-stop with multi-trigger support)
  triggerVoiceInput() {
    if (!this.hasValidApiKey()) {
      this.openSettingsModal('Для голосового ввода укажите API-ключ OpenRouter в настройках.');
      return;
    }

    const overlay = document.getElementById('voiceModalOverlay');
    const input = document.getElementById('voiceTranscriptInput');
    const statusLabel = document.getElementById('voiceStatusLabel');
    const micBtn = document.getElementById('voiceMicHeroBtn');

    if (input) input.value = '';
    if (statusLabel) statusLabel.textContent = 'Нажмите на микрофон для записи';
    if (micBtn) micBtn.classList.remove('recording');

    overlay.classList.add('active');

    // Immediately start listening on dock button click (valid user gesture)
    this.startVoiceSession();
  }

  startVoiceSession() {
    const micBtn = document.getElementById('voiceMicHeroBtn');
    const statusLabel = document.getElementById('voiceStatusLabel');
    const input = document.getElementById('voiceTranscriptInput');
    const currentText = input ? input.value : '';

    if (statusLabel) statusLabel.textContent = 'Слушаю вас... Говорите';
    if (micBtn) micBtn.classList.add('recording');

    const started = window.NutriVoice.start(
      (recognizedText) => {
        if (input) input.value = recognizedText;
      },
      (isListening) => {
        if (!isListening && micBtn) {
          micBtn.classList.remove('recording');
          if (statusLabel) {
            const hasText = input && input.value.trim();
            statusLabel.textContent = hasText
              ? 'Запись остановлена. Нажмите микрофон снова или «Рассчитать блюдо»'
              : 'Нажмите на микрофон для записи';
          }
        }
      },
      (errorMsg) => {
        if (micBtn) micBtn.classList.remove('recording');
        if (statusLabel) statusLabel.textContent = errorMsg;
        this.showToast(errorMsg, true);
      },
      currentText
    );

    if (!started && statusLabel) {
      statusLabel.textContent = 'Микрофон недоступен. Надиктуйте через микрофон на клавиатуре.';
      input?.focus();
    }
  }

  toggleVoiceRecording() {
    const micBtn = document.getElementById('voiceMicHeroBtn');
    const statusLabel = document.getElementById('voiceStatusLabel');
    const input = document.getElementById('voiceTranscriptInput');

    if (window.NutriVoice.isListening) {
      // User tapped mic to STOP recording
      const text = window.NutriVoice.stop();
      if (micBtn) micBtn.classList.remove('recording');
      if (statusLabel) {
        statusLabel.textContent = text
          ? 'Запись остановлена. Нажмите «Рассчитать блюдо» или микрофон снова'
          : 'Нажмите на микрофон для записи';
      }
    } else {
      // User tapped mic to START recording (supports unlimited restarts)
      this.startVoiceSession();
    }
  }

  cancelVoiceRecording() {
    window.NutriVoice.abort();
    const micBtn = document.getElementById('voiceMicHeroBtn');
    if (micBtn) micBtn.classList.remove('recording');
    document.getElementById('voiceModalOverlay')?.classList.remove('active');
  }

  async submitVoiceText() {
    // If still listening, stop
    if (window.NutriVoice.isListening) {
      window.NutriVoice.stop();
    }
    const micBtn = document.getElementById('voiceMicHeroBtn');
    if (micBtn) micBtn.classList.remove('recording');

    const input = document.getElementById('voiceTranscriptInput');
    const text = input ? input.value.trim() : '';

    if (!text) {
      this.showToast('Пожалуйста, надиктуйте или введите название блюда', true);
      return;
    }

    // Close voice modal
    document.getElementById('voiceModalOverlay')?.classList.remove('active');

    // Show loading spinner
    this.showLoadingModal('ИИ рассчитывает состав блюда...', `«${text}»`);

    try {
      const aiResult = await window.NutriGemini.analyzeFoodText(text);
      this.closeLoadingModal();
      this.openScanVerificationModal({
        ...aiResult,
        photoThumbnail: null
      });
    } catch (err) {
      this.closeLoadingModal();
      this.showToast('Ошибка анализа: ' + err.message, true);
    }
  }

  // 3. TRIGGER MANUAL / AI TEXT INPUT
  openManualInputModal(placeholderDesc) {
    const overlay = document.getElementById('manualModalOverlay');
    const inputField = document.getElementById('manualTextInput');
    if (inputField) {
      inputField.value = '';
      if (placeholderDesc) inputField.placeholder = placeholderDesc;
    }
    overlay.classList.add('active');
  }

  closeManualModal() {
    document.getElementById('manualModalOverlay').classList.remove('active');
  }

  async submitManualText() {
    const text = document.getElementById('manualTextInput').value.trim();
    if (!text) return;

    if (!this.hasValidApiKey()) {
      this.closeManualModal();
      this.openSettingsModal('Для анализа текста укажите API-ключ (Gemini или OpenRouter) в настройках.');
      return;
    }

    this.closeManualModal();
    this.showLoadingModal('ИИ рассчитывает КБЖУ...', `«${text}»`);

    try {
      const aiResult = await window.NutriGemini.analyzeFoodText(text);
      this.closeLoadingModal();
      this.openScanVerificationModal({
        ...aiResult,
        photoThumbnail: null
      });
    } catch (err) {
      this.closeLoadingModal();
      this.showToast('Ошибка анализа: ' + err.message, true);
    }
  }

  // --- VERIFICATION & EDIT MODAL ---

  openScanVerificationModal(scanData) {
    this.tempScanResult = scanData;
    const overlay = document.getElementById('verifyModalOverlay');

    document.getElementById('scanDishNameInput').value = scanData.dish_name || '';
    document.getElementById('scanWeightInput').value = scanData.weight_g || 0;
    document.getElementById('scanCaloriesInput').value = scanData.calories || 0;
    document.getElementById('scanProteinInput').value = scanData.protein_g || 0;
    document.getElementById('scanFatInput').value = scanData.fat_g || 0;
    document.getElementById('scanCarbsInput').value = scanData.carbs_g || 0;

    // XE display
    document.getElementById('scanBreadUnitsDisplay').textContent = `${scanData.bread_units || 0} ХЕ`;

    // Editable User Comment in Verification
    const commentInput = document.getElementById('scanCommentInput');
    if (commentInput) {
      commentInput.value = scanData.comment || '';
    }

    // Photo preview
    const previewContainer = document.getElementById('scanPhotoPreview');
    if (scanData.photoThumbnail) {
      previewContainer.innerHTML = `<img src="${scanData.photoThumbnail}" class="w-full h-36 object-cover rounded-2xl border border-[var(--border-color)] mb-2" />`;
      previewContainer.style.display = 'block';
    } else {
      previewContainer.style.display = 'none';
      previewContainer.innerHTML = '';
    }

    // Clinical advice comment
    const commentBox = document.getElementById('scanCommentBox');
    if (scanData.comment) {
      commentBox.textContent = `💡 ${scanData.comment}`;
      commentBox.style.display = 'block';
    } else {
      commentBox.style.display = 'none';
    }

    overlay.classList.add('active');
  }

  closeVerifyModal() {
    document.getElementById('verifyModalOverlay').classList.remove('active');
    this.tempScanResult = null;
  }

  async saveVerifiedMeal() {
    const name = document.getElementById('scanDishNameInput').value.trim() || 'Блюдо';
    const weight_g = Math.max(0, Number(document.getElementById('scanWeightInput').value) || 0);
    const calories = Math.max(0, Number(document.getElementById('scanCaloriesInput').value) || 0);
    const protein = Math.max(0, Number(document.getElementById('scanProteinInput').value) || 0);
    const fat = Math.max(0, Number(document.getElementById('scanFatInput').value) || 0);
    const carbs = Math.max(0, Number(document.getElementById('scanCarbsInput').value) || 0);
    const userComment = document.getElementById('scanCommentInput') ? document.getElementById('scanCommentInput').value.trim() : '';

    const mealData = {
      date: this.currentDateStr,
      name,
      weight_g,
      calories,
      protein,
      fat,
      carbs,
      comment: userComment,
      photo: this.tempScanResult?.photoThumbnail || null,
      breakdown: this.tempScanResult?.breakdown || []
    };

    await window.NutriStorage.addMeal(mealData);
    this.closeVerifyModal();
    await this.refreshData();
    this.showToast('✅ Блюдо добавлено в дневник!');
  }

  // --- MEAL DETAIL / EDIT MODAL ---

  async openMealDetailModal(mealId) {
    const meal = this.todayMeals.find((m) => m.id === mealId) || (await window.NutriStorage.getAllMeals()).find((m) => m.id === mealId);
    if (!meal) return;

    this.currentMealToEdit = meal;
    const overlay = document.getElementById('mealDetailModalOverlay');

    document.getElementById('detailMealName').textContent = meal.name;
    document.getElementById('detailMealMeta').textContent = `${meal.type} · ${meal.time} · ${meal.weight_g}г`;
    document.getElementById('detailMealCalories').textContent = `${meal.calories} ккал`;
    document.getElementById('detailMealXE').textContent = `${meal.bread_units} ХЕ`;

    document.getElementById('detailMealProtein').textContent = `${meal.protein}г`;
    document.getElementById('detailMealFat').textContent = `${meal.fat}г`;
    document.getElementById('detailMealCarbs').textContent = `${meal.carbs}г`;

    // Populate editable comment
    const commentInput = document.getElementById('detailMealCommentInput');
    if (commentInput) {
      commentInput.value = meal.comment || '';
    }

    const photoElem = document.getElementById('detailMealPhoto');
    if (meal.photo) {
      photoElem.src = meal.photo;
      photoElem.style.display = 'block';
    } else {
      photoElem.style.display = 'none';
    }

    overlay.classList.add('active');
  }

  async saveCurrentMealComment() {
    if (!this.currentMealToEdit) return;
    const commentInput = document.getElementById('detailMealCommentInput');
    const newComment = commentInput ? commentInput.value.trim() : '';

    await window.NutriStorage.updateMeal(this.currentMealToEdit.id, { comment: newComment });
    this.currentMealToEdit.comment = newComment;

    await this.refreshData();
    if (document.getElementById('historyModalOverlay').classList.contains('active')) {
      await this.onHistorySearch();
    }
    this.showToast('💾 Комментарий сохранен!');
  }

  closeMealDetailModal() {
    document.getElementById('mealDetailModalOverlay').classList.remove('active');
    this.currentMealToEdit = null;
  }

  async deleteCurrentMeal() {
    if (!this.currentMealToEdit) return;
    if (confirm(`Удалить «${this.currentMealToEdit.name}» из дневника?`)) {
      await window.NutriStorage.deleteMeal(this.currentMealToEdit.id);
      this.closeMealDetailModal();
      await this.refreshData();
      this.showToast('Блюдо удалено.');
    }
  }

  // --- SETTINGS / PROFILE MODAL ---

  async openSettingsModal(noticeMsg) {
    const overlay = document.getElementById('settingsModalOverlay');
    const settings = await window.NutriStorage.getSettings();

    // Profile fields
    document.getElementById('settingUserName').value = settings.user_name || '';
    document.getElementById('settingUserHeight').value = settings.user_height || '';
    document.getElementById('settingUserWeight').value = settings.user_weight || '';
    this.applyTheme(settings.theme || 'dark');

    // Calories & Targets
    document.getElementById('settingTargetCalories').value = settings.target_calories || 2100;
    document.getElementById('settingTargetProtein').value = settings.target_protein || 140;
    document.getElementById('settingTargetFat').value = settings.target_fat || 70;
    document.getElementById('settingTargetCarbs').value = settings.target_carbs || 220;
    document.getElementById('settingXeRatio').value = settings.xe_ratio || 10;

    // OpenRouter fields
    const keyInput = document.getElementById('settingOpenRouterKey');
    if (keyInput) keyInput.value = settings.openrouter_api_key || '';
    const modelInput = document.getElementById('settingOpenRouterModel');
    if (modelInput) modelInput.value = settings.openrouter_model || 'google/gemini-2.5-flash-lite';

    const noticeBox = document.getElementById('settingsNoticeBox');
    if (noticeMsg) {
      noticeBox.textContent = noticeMsg;
      noticeBox.style.display = 'block';
    } else {
      noticeBox.style.display = 'none';
    }

    overlay.classList.add('active');
  }

  switchProvider(provider) {
    this.currentProvider = 'openrouter';
  }

  onProfileChange() {
    // Optional live feedback hook
  }

  autoCalculateCalories() {
    const height = Number(document.getElementById('settingUserHeight').value);
    const weight = Number(document.getElementById('settingUserWeight').value);

    if (!height || !weight || height < 100 || weight < 30) {
      alert('Пожалуйста, укажите корректные рост (см) и вес (кг) для расчета нормы.');
      return;
    }

    // Formula: Mifflin-St Jeor (assuming avg baseline activity factor 1.35)
    const bmr = 10 * weight + 6.25 * height - 145;
    const tdee = Math.round(bmr * 1.35);

    const protein = Math.round(weight * 1.8);
    const fat = Math.round(weight * 0.9);
    const remainingCals = Math.max(200, tdee - (protein * 4 + fat * 9));
    const carbs = Math.round(remainingCals / 4);

    document.getElementById('settingTargetCalories').value = tdee;
    document.getElementById('settingTargetProtein').value = protein;
    document.getElementById('settingTargetFat').value = fat;
    document.getElementById('settingTargetCarbs').value = carbs;

    this.showToast(`Рассчитана суточная норма: ${tdee} ккал (Б:${protein}г, Ж:${fat}г, У:${carbs}г)`);
  }

  closeSettingsModal() {
    document.getElementById('settingsModalOverlay').classList.remove('active');
  }

  async saveSettings() {
    const user_name = document.getElementById('settingUserName').value.trim();
    const user_height = Number(document.getElementById('settingUserHeight').value) || '';
    const user_weight = Number(document.getElementById('settingUserWeight').value) || '';

    const api_provider = 'openrouter';
    const openrouter_api_key = document.getElementById('settingOpenRouterKey') ? document.getElementById('settingOpenRouterKey').value.trim() : '';
    const openrouter_model = document.getElementById('settingOpenRouterModel') ? document.getElementById('settingOpenRouterModel').value : 'google/gemini-2.5-flash-lite';

    const target_calories = Math.max(500, Number(document.getElementById('settingTargetCalories').value) || 2100);
    const target_protein = Math.max(10, Number(document.getElementById('settingTargetProtein').value) || 140);
    const target_fat = Math.max(5, Number(document.getElementById('settingTargetFat').value) || 70);
    const target_carbs = Math.max(20, Number(document.getElementById('settingTargetCarbs').value) || 220);
    const xe_ratio = Math.max(5, Number(document.getElementById('settingXeRatio').value) || 10);

    await window.NutriStorage.saveSettings({
      user_name,
      user_height,
      user_weight,
      api_provider,
      openrouter_api_key,
      openrouter_model,
      target_calories,
      target_protein,
      target_fat,
      target_carbs,
      xe_ratio
    });

    this.settings = await window.NutriStorage.getSettings();
    this.renderDateHeader();
    this.closeSettingsModal();
    await this.refreshData();
    this.showToast('✅ Профиль и настройки сохранены!');
  }

  async testOpenRouterKey() {
    const key = document.getElementById('settingOpenRouterKey').value.trim();
    if (!key) {
      alert('Пожалуйста, введите API-ключ OpenRouter для проверки.');
      return;
    }

    const testBtn = document.getElementById('testOpenRouterKeyBtn');
    testBtn.textContent = 'Проверка...';
    testBtn.disabled = true;

    try {
      await window.NutriGemini.testOpenRouterKey(key);
      alert('Успешно! OpenRouter работает БЕЗ VPN, ключ валиден.');
    } catch (err) {
      alert(err.message);
    } finally {
      testBtn.textContent = 'Проверить';
      testBtn.disabled = false;
    }
  }

  async exportData() {
    const jsonStr = await window.NutriStorage.exportAll();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nutritrack_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async clearHistory() {
    if (confirm('Вы уверены, что хотите полностью очистить историю всех приемов пищи? Это действие необратимо.')) {
      await window.NutriStorage.clearAll();
      await this.refreshData();
      this.closeSettingsModal();
      this.showToast('История успешно очищена.');
    }
  }

  // --- HISTORY & SEARCH CONTROLLER ---

  async openHistoryModal() {
    const overlay = document.getElementById('historyModalOverlay');
    overlay.classList.add('active');
    const input = document.getElementById('historySearchInput');
    if (input) input.value = '';
    await this.onHistorySearch();
  }

  closeHistoryModal() {
    document.getElementById('historyModalOverlay').classList.remove('active');
  }

  setHistoryTypeFilter(type, buttonElem) {
    this.historyTypeFilter = type;
    document.querySelectorAll('#historyTypeFilters .filter-chip').forEach((btn) => btn.classList.remove('active'));
    if (buttonElem) buttonElem.classList.add('active');
    this.onHistorySearch();
  }

  setHistoryPeriodFilter(period, buttonElem) {
    this.historyPeriodFilter = period;
    document.querySelectorAll('#historyPeriodFilters .filter-chip').forEach((btn) => btn.classList.remove('active'));
    if (buttonElem) buttonElem.classList.add('active');
    this.onHistorySearch();
  }

  async onHistorySearch() {
    const query = document.getElementById('historySearchInput')?.value || '';
    const meals = await window.NutriStorage.searchHistory({
      query,
      mealType: this.historyTypeFilter,
      period: this.historyPeriodFilter
    });

    const countElem = document.getElementById('historyResultsCount');
    const totalsElem = document.getElementById('historyResultsTotals');
    const container = document.getElementById('historyMealsContainer');

    if (countElem) {
      countElem.textContent = `Найдено: ${meals.length} ${this.declension(meals.length, ['блюдо', 'блюда', 'блюд'])}`;
    }

    let totalCals = 0;
    let totalXE = 0;
    meals.forEach((m) => {
      totalCals += Number(m.calories) || 0;
      totalXE += Number(m.bread_units) || 0;
    });

    if (totalsElem) {
      totalsElem.textContent = `${totalCals.toLocaleString('ru-RU')} ккал · ${totalXE.toFixed(1)} ХЕ`;
    }

    if (!container) return;

    if (meals.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:24px 10px;">
          <div class="empty-state-icon">🔍</div>
          <div class="empty-state-title">Ничего не найдено</div>
          <div class="empty-state-sub">Попробуйте изменить поисковый запрос или сбросить фильтры.</div>
        </div>
      `;
      return;
    }

    // Group meals by date
    const groups = {};
    meals.forEach((m) => {
      const d = m.date || 'Без даты';
      if (!groups[d]) groups[d] = [];
      groups[d].push(m);
    });

    let html = '';
    const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    sortedDates.forEach((dateStr) => {
      const dayMeals = groups[dateStr];
      const dayCals = dayMeals.reduce((sum, item) => sum + (Number(item.calories) || 0), 0);
      const dayXE = dayMeals.reduce((sum, item) => sum + (Number(item.bread_units) || 0), 0).toFixed(1);

      let dateFormatted = dateStr;
      try {
        const dObj = new Date(dateStr + 'T00:00:00');
        dateFormatted = dObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      } catch (e) {}

      html += `
        <div class="history-group-header">
          <span>📅 ${dateFormatted}</span>
          <span style="color:var(--color-calories);">${dayCals} ккал · ${dayXE} ХЕ</span>
        </div>
      `;

      dayMeals.forEach((m) => {
        const typeEmoji = this.getMealEmoji(m.type);
        const thumbContent = m.photo
          ? `<img src="${m.photo}" alt="${this.escapeHtml(m.name)}" class="meal-thumb" />`
          : `<div class="meal-thumb">${typeEmoji}</div>`;

        html += `
          <div class="meal-card" onclick="window.app.openMealDetailModal('${m.id}')">
            ${thumbContent}
            <div class="meal-info">
              <div class="meal-title-row">
                <span class="meal-title">${this.escapeHtml(m.name)}</span>
                <span class="meal-cals">${m.calories} ккал</span>
              </div>
              <div class="meal-meta-row">
                <span>${m.type} · ${m.time}</span>
                <span>·</span>
                <span>${m.weight_g}г</span>
                <span class="meal-xe-pill">🏷️ ${m.bread_units} ХЕ</span>
              </div>
              <div class="meal-macros-row">
                <span>Б: ${m.protein}г</span>
                <span>Ж: ${m.fat}г</span>
                <span>У: ${m.carbs}г</span>
              </div>
              ${m.comment ? `<div style="font-size:11px;color:var(--text-muted);margin-top:3px;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">💬 ${this.escapeHtml(m.comment)}</div>` : ''}
            </div>
          </div>
        `;
      });
    });

    container.innerHTML = html;
  }

  // --- FEEDBACK & LOADERS ---

  showLoadingModal(title, subtitle) {
    document.getElementById('loadingTitle').textContent = title || 'Обработка...';
    document.getElementById('loadingSubtitle').textContent = subtitle || '';
    document.getElementById('loadingModalOverlay').classList.add('active');
  }

  closeLoadingModal() {
    document.getElementById('loadingModalOverlay').classList.remove('active');
  }

  showToast(message, isError = false, customTitle = null) {
    const toast = document.getElementById('appToast');
    if (!toast) return;

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }

    const iconEl = document.getElementById('toastIcon');
    const titleEl = document.getElementById('toastTitle');
    const messageEl = document.getElementById('toastMessage');

    // Clean up raw HTML if a server returned a web page
    let cleanMessage = String(message || '');
    if (cleanMessage.includes('<!DOCTYPE') || cleanMessage.includes('<html') || cleanMessage.includes('Login Redirect')) {
      cleanMessage = 'Сервер Netlify вернул страницу перенаправления (Login Redirect 401). Если вы включили "Site Protection" в настройках Netlify, снимите его, либо переключитесь на OpenRouter в настройках (⚙️).';
    }

    if (isError) {
      toast.classList.remove('toast-success');
      toast.classList.add('toast-error');
      if (iconEl) iconEl.textContent = '⚠️';
      if (titleEl) titleEl.textContent = customTitle || 'Ошибка анализа';
    } else {
      toast.classList.remove('toast-error');
      toast.classList.add('toast-success');
      if (iconEl) iconEl.textContent = '✅';
      if (titleEl) titleEl.textContent = customTitle || 'Успешно';
    }

    if (messageEl) messageEl.textContent = cleanMessage;
    toast.classList.add('show');

    // For errors: keep for 15 seconds so the user can comfortably read and screenshot!
    // For success notices: keep for 4 seconds.
    const duration = isError ? 15000 : 4000;
    this.toastTimeout = setTimeout(() => {
      this.hideToast();
    }, duration);
  }

  hideToast() {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    const toast = document.getElementById('appToast');
    if (toast) toast.classList.remove('show');
  }
}

// Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  window.app = new NutriApp();
  window.app.init();
});
