/**
 * NutriTrack PWA — Main Application Controller
 */

class NutriApp {
  constructor() {
    this.currentDateStr = this.getTodayDateStr();
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
      navigator.serviceWorker.register('./sw.js?v=20')
        .then((reg) => {
          console.log('Service Worker registered');
          try { reg.update(); } catch (e) {}
        })
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

  // --- LOCAL CALENDAR DATE HELPERS (Timezone-Proof) ---

  formatDateStr(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  parseDateStr(str) {
    if (!str) return new Date();
    const parts = str.split('-').map(Number);
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0); // 12:00:00 noon prevents any DST / UTC offset crossings
    }
    return new Date();
  }

  getTodayDateStr() {
    return this.formatDateStr(new Date());
  }

  formatReadableDate(dateStr) {
    const d = this.parseDateStr(dateStr);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  renderDateHeader() {
    const todayStr = this.getTodayDateStr();
    const isToday = this.currentDateStr === todayStr;

    // Current date label (top header)
    const dateElem = document.getElementById('currentDateLabel');
    const d = this.parseDateStr(this.currentDateStr);
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
    const returnTodayBtn = document.getElementById('dateNavReturnTodayBtn');

    if (navText) {
      navText.textContent = isToday ? `Сегодня, ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` : capDate;
    }
    if (todayBadge) {
      todayBadge.style.display = isToday ? 'inline-block' : 'none';
    }
    if (returnTodayBtn) {
      returnTodayBtn.style.display = isToday ? 'none' : 'inline-flex';
    }
  }

  changeDate(deltaDays) {
    const cur = this.parseDateStr(this.currentDateStr);
    cur.setDate(cur.getDate() + deltaDays);
    this.currentDateStr = this.formatDateStr(cur);
    this.renderDateHeader();
    this.refreshData();
  }

  goToToday() {
    this.currentDateStr = this.getTodayDateStr();
    this.renderDateHeader();
    this.refreshData();
    this.showToast('📅 Переключено на сегодняшний день');
  }

  jumpToDate(dateStr) {
    if (!dateStr) return;
    this.currentDateStr = dateStr;
    this.closeHistoryModal();
    this.renderDateHeader();
    this.refreshData();
    this.showToast(`📅 Переключено на ${this.formatReadableDate(dateStr)}`);
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

    try { this.renderCalorieGauge(summary); } catch (e) { console.error('renderCalorieGauge error:', e); }
    try { this.renderMacros(summary); } catch (e) { console.error('renderMacros error:', e); }
    try { this.renderXEBanner(summary); } catch (e) { console.error('renderXEBanner error:', e); }
    try { this.renderXEPlanStrip(); } catch (e) { console.error('renderXEPlanStrip error:', e); }
    try { this.renderMealsList(this.todayMeals); } catch (e) { console.error('renderMealsList error:', e); }
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

    const gaugeXe = document.getElementById('gaugeConsumedXE');
    if (gaugeXe) {
      gaugeXe.textContent = `· ${summary.bread_units} ХЕ`;
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
    const pVal = document.getElementById('proteinCurrentVal');
    if (pVal) pVal.innerHTML = `${curP} <small>/ ${targetP}г</small>`;
    const pPct = document.getElementById('proteinPercent');
    if (pPct) pPct.textContent = `${pctP}%`;
    const pBar = document.getElementById('proteinBarFill');
    if (pBar) pBar.style.width = `${pctP}%`;

    // Fat
    const pctF = Math.min(100, Math.round((curF / targetF) * 100));
    const fVal = document.getElementById('fatCurrentVal');
    if (fVal) fVal.innerHTML = `${curF} <small>/ ${targetF}г</small>`;
    const fPct = document.getElementById('fatPercent');
    if (fPct) fPct.textContent = `${pctF}%`;
    const fBar = document.getElementById('fatBarFill');
    if (fBar) fBar.style.width = `${pctF}%`;

    // Carbs
    const pctC = Math.min(100, Math.round((curC / targetC) * 100));
    const cVal = document.getElementById('carbsCurrentVal');
    if (cVal) cVal.innerHTML = `${curC} <small>/ ${targetC}г</small>`;
    const cPct = document.getElementById('carbsPercent');
    if (cPct) cPct.textContent = `${pctC}%`;
    const cBar = document.getElementById('carbsBarFill');
    if (cBar) cBar.style.width = `${pctC}%`;
    const carbsXe = document.getElementById('carbsCurrentXE');
    if (carbsXe) {
      carbsXe.textContent = `${summary.bread_units} ХЕ`;
    }
  }

  getDailyXEPlan(meals = this.todayMeals) {
    const s = this.settings || {};
    const xeRatio = Number(s.xe_ratio) || 10;
    const targetCalories = Number(s.target_calories) || 2100;
    const targetProtein = Number(s.target_protein) || 140;
    const targetFat = Number(s.target_fat) || 70;
    const targetCarbs = Number(s.target_carbs) || 220;
    const age = Number(s.user_age) || 35;
    const gender = s.user_gender || 'male';

    const dailyTargetXE = Number((targetCarbs / xeRatio).toFixed(1));
    const macroCalories = targetProtein * 4 + targetFat * 9 + targetCarbs * 4;
    const recommendedCarbsForCalories = Math.round((targetCalories * 0.40) / 4);
    const recommendedXEForCalories = Number((recommendedCarbsForCalories / xeRatio).toFixed(1));

    // Meal distribution: Breakfast 25%, Lunch 35%, Dinner 25%, Snacks 15%
    const breakfastTarget = Number((dailyTargetXE * 0.25).toFixed(1));
    const lunchTarget = Number((dailyTargetXE * 0.35).toFixed(1));
    const dinnerTarget = Number((dailyTargetXE * 0.25).toFixed(1));
    const snackTarget = Number(Math.max(0.5, dailyTargetXE - breakfastTarget - lunchTarget - dinnerTarget).toFixed(1));

    const targetsByType = {
      'Завтрак': breakfastTarget,
      'Обед': lunchTarget,
      'Ужин': dinnerTarget,
      'Перекус': snackTarget
    };

    const consumedByType = {
      'Завтрак': 0,
      'Обед': 0,
      'Ужин': 0,
      'Перекус': 0
    };

    let totalConsumedXE = 0;
    (meals || []).forEach((m) => {
      const xe = Number(m.bread_units) || 0;
      totalConsumedXE += xe;
      const type = Object.prototype.hasOwnProperty.call(consumedByType, m.type) ? m.type : 'Перекус';
      consumedByType[type] += xe;
    });

    Object.keys(consumedByType).forEach((k) => {
      consumedByType[k] = Number(consumedByType[k].toFixed(1));
    });
    totalConsumedXE = Number(totalConsumedXE.toFixed(1));

    const avgMainMealXE = Number(((breakfastTarget + lunchTarget + dinnerTarget) / 3).toFixed(1));
    const remainingDailyXE = Number((dailyTargetXE - totalConsumedXE).toFixed(1));

    return {
      xeRatio,
      age,
      gender,
      targetCalories,
      macroCalories,
      targetCarbs,
      dailyTargetXE,
      recommendedCarbsForCalories,
      recommendedXEForCalories,
      avgMainMealXE,
      targetsByType,
      consumedByType,
      totalConsumedXE,
      remainingDailyXE
    };
  }

  renderXEBanner(summary) {
    const xeElem = document.getElementById('todayTotalXE');
    if (xeElem) {
      const plan = this.getDailyXEPlan(this.todayMeals);
      xeElem.textContent = `${summary.bread_units} / ${plan.dailyTargetXE} ХЕ`;
    }
  }

  renderXEPlanStrip() {
    const strip = document.getElementById('mealXeStrip');
    if (!strip) return;

    const plan = this.getDailyXEPlan(this.todayMeals);
    const currentType = window.NutriStorage.detectMealType();
    const order = ['Завтрак', 'Обед', 'Ужин', 'Перекус'];

    strip.innerHTML = order.map((type) => {
      const target = plan.targetsByType[type] || 0;
      const consumed = plan.consumedByType[type] || 0;
      const pct = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
      const isCurrent = type === currentType;
      const isExceeded = consumed > target + 0.3;

      return `
        <div class="meal-xe-slot ${isCurrent ? 'is-current' : ''} ${isExceeded ? 'is-exceeded' : ''}">
          <div class="meal-xe-slot-top">
            <span>${type}</span>
          </div>
          <div class="meal-xe-slot-val">${consumed} <small>/ ${target}</small></div>
          <div class="meal-xe-slot-bar">
            <div class="meal-xe-slot-fill" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  openXePlanModal() {
    const overlay = document.getElementById('xePlanModalOverlay');
    const body = document.getElementById('xePlanModalBody');
    if (!overlay || !body) return;

    const plan = this.getDailyXEPlan(this.todayMeals);
    const currentType = window.NutriStorage.detectMealType();
    const basal = Number(this.settings?.basal_insulin) || 20;
    const bolusAvg = Number(this.settings?.bolus_avg) || 7;
    const icrB = Number(this.settings?.icr_breakfast) || 1.7;
    const icrL = Number(this.settings?.icr_lunch) || 1.5;
    const icrD = Number(this.settings?.icr_dinner) || 1.3;

    const slots = [
      { type: 'Завтрак', emoji: '🥣', pct: '25%', note: 'Утром резистентность выше — лучше медленные углеводы' },
      { type: 'Обед', emoji: '🥗', pct: '35%', note: 'Основной углеводный прием в пик дневной активности' },
      { type: 'Ужин', emoji: '🍲', pct: '25%', note: 'Желательно за 3–4 ч до сна для ровной ночи' },
      { type: 'Перекус', emoji: '☕', pct: '15%', note: '1–2 легких перекуса (фрукты, кисломолочное)' }
    ];

    const hasMismatch = Math.abs(plan.macroCalories - plan.targetCalories) > 150;
    const genderLabel = plan.gender === 'female' ? 'Женщина' : 'Мужчина';
    const normativeRange = plan.targetCalories <= 1850
      ? '14–17 ХЕ (снижение веса / умеренный дефицит)'
      : '18–22 ХЕ (поддержание веса и обычная активность)';

    const rowsHtml = slots.map((s) => {
      const targetXE = plan.targetsByType[s.type];
      const consumedXE = plan.consumedByType[s.type];
      const remainingXE = Number((targetXE - consumedXE).toFixed(1));
      const calc = this.getInsulinCalculation(targetXE, s.type);
      const isCurrent = s.type === currentType;

      return `
        <div class="xe-plan-row ${isCurrent ? 'is-active' : ''}">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;">
              <span>${s.emoji} ${s.type}</span>
              <span style="font-size:10px;color:var(--text-muted);font-weight:600;">(${s.pct})</span>
              ${isCurrent ? '<span style="font-size:9px;background:rgba(249,115,22,0.2);color:var(--color-xe);padding:1px 6px;border-radius:999px;">сейчас</span>' : ''}
            </div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px;line-height:1.3;">${s.note}</div>
            <div style="font-size:10.5px;margin-top:4px;color:var(--text-main);">
              Съедено: <strong>${consumedXE} ХЕ</strong> · ${remainingXE >= 0 ? `осталось ${remainingXE} ХЕ` : `<span style="color:#ef4444;">превышение +${Math.abs(remainingXE)} ХЕ</span>`}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:15px;font-weight:900;color:var(--color-xe);">~${targetXE} ХЕ</div>
            ${calc.enabled ? `<div style="font-size:10.5px;font-weight:700;color:var(--color-protein);margin-top:2px;">💉 ~${calc.dose} ед. <small style="font-weight:400;color:var(--text-muted);">(УК ${calc.icr})</small></div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    body.innerHTML = `
      <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:16px;padding:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Ваш ориентир на сутки</span>
          <span style="font-size:16px;font-weight:900;color:var(--color-xe);">${plan.totalConsumedXE} / ${plan.dailyTargetXE} ХЕ</span>
        </div>
        <div style="font-size:11.5px;color:var(--text-main);line-height:1.45;">
          Для профиля <strong>${genderLabel}, ${plan.age} лет</strong> с диабетом норма при <strong>${plan.targetCalories.toLocaleString('ru-RU')} ккал</strong> составляет <strong>${normativeRange}</strong> (1 ХЕ = ${plan.xeRatio}г углеводов).
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">
          По вашим настройкам задано <strong>${plan.targetCarbs} г</strong> углеводов = <strong>${plan.dailyTargetXE} ХЕ/сут</strong>.
        </div>
        ${hasMismatch ? `
          <div style="margin-top:8px;padding:8px 10px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3);border-radius:10px;font-size:11px;line-height:1.35;">
            ⚠️ Ваши БЖУ суммарно дают <strong>${plan.macroCalories.toLocaleString('ru-RU')} ккал</strong>, а цель стоит <strong>${plan.targetCalories.toLocaleString('ru-RU')} ккал</strong>. Для ${plan.targetCalories} ккал сбалансированная норма углеводов ≈ <strong>${plan.recommendedCarbsForCalories} г (${plan.recommendedXEForCalories} ХЕ)</strong>.
          </div>
        ` : ''}
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;padding:0 2px;">Распределение по приемам пищи</div>
        ${rowsHtml}
      </div>

      <div style="background:rgba(14,165,233,0.1);border:1px solid rgba(14,165,233,0.3);border-radius:14px;padding:12px;">
        <div style="font-size:12px;font-weight:700;color:var(--color-protein);margin-bottom:4px;">💉 Связь с вашими дозами инсулина</div>
        <div style="font-size:11px;color:var(--text-main);line-height:1.4;">
          • Длинный (базал): <strong>${basal} ед./сут</strong><br/>
          • Короткий на средний прием: <strong>~${bolusAvg} ед.</strong><br/>
          • Активные коэффициенты: Завтрак <strong>${icrB}</strong> · Обед <strong>${icrL}</strong> · Ужин <strong>${icrD}</strong> ед./ХЕ.<br/>
          • Средний основной прием по плану: <strong>${plan.avgMainMealXE} ХЕ</strong>.
        </div>
      </div>
    `;

    overlay.classList.add('active');
  }

  closeXePlanModal() {
    document.getElementById('xePlanModalOverlay')?.classList.remove('active');
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

    // Auto-recalculate Calories, Protein, Fat, Carbs, XE, and Insulin when weight is changed in verification modal
    const scanWeightInput = document.getElementById('scanWeightInput');
    if (scanWeightInput) {
      scanWeightInput.addEventListener('input', (e) => {
        this.onScanWeightChange(e.target.value);
      });
    }

    // Auto-recalculate ХЕ, Insulin and update macro ratios when carbs/macros are manually changed in verification modal
    const editCarbsInput = document.getElementById('scanCarbsInput');
    if (editCarbsInput) {
      editCarbsInput.addEventListener('input', (e) => {
        const carbs = Math.max(0, Number(e.target.value) || 0);
        this.updateVerificationInsulin(carbs);
        this.onManualMacroChange();
      });
    }

    const editCaloriesInput = document.getElementById('scanCaloriesInput');
    if (editCaloriesInput) {
      editCaloriesInput.addEventListener('input', () => this.onManualMacroChange());
    }

    const editProteinInput = document.getElementById('scanProteinInput');
    if (editProteinInput) {
      editProteinInput.addEventListener('input', () => this.onManualMacroChange());
    }

    const editFatInput = document.getElementById('scanFatInput');
    if (editFatInput) {
      editFatInput.addEventListener('input', () => this.onManualMacroChange());
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

    window.NutriVoice.abort();
    overlay.classList.add('active');
  }

  startVoiceSession() {
    const micBtn = document.getElementById('voiceMicHeroBtn');
    const statusLabel = document.getElementById('voiceStatusLabel');
    const input = document.getElementById('voiceTranscriptInput');
    const currentText = input ? input.value : '';

    if (statusLabel) statusLabel.textContent = '🔴 Слушаю вас... Говорите';
    if (micBtn) micBtn.classList.add('recording');

    const started = window.NutriVoice.start(
      (recognizedText) => {
        if (input) input.value = recognizedText;
      },
      (isListening, reason) => {
        if (!isListening && micBtn) {
          micBtn.classList.remove('recording');
          if (statusLabel) {
            const hasText = input && input.value.trim();
            if (reason === 'no-speech') {
              statusLabel.textContent = hasText ? 'Пауза речи. Нажмите микрофон, чтобы продолжить' : 'Речь не услышана. Нажмите на микрофон для записи';
            } else {
              statusLabel.textContent = hasText
                ? 'Запись завершена. Нажмите микрофон снова или «Рассчитать блюдо»'
                : 'Нажмите на микрофон для записи';
            }
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
      statusLabel.textContent = 'Микрофон недоступен. Нажмите на поле ввода и надиктуйте через клавиатуру iPhone.';
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

  // --- INSULIN & XE CALCULATION HELPERS ---

  getInsulinCalculation(breadUnits, mealType = null) {
    if (!this.settings || this.settings.insulin_enabled === false) {
      return { enabled: false, dose: 0, rawDose: '0', icr: 1.5, periodName: '', step: 1.0, mealType: mealType || 'Обед' };
    }

    const hour = new Date().getHours();
    const effectiveType = mealType || window.NutriStorage.detectMealType();

    let icr = Number(this.settings.icr_lunch) || 1.5;
    let periodName = 'Обед';

    if (effectiveType === 'Завтрак') {
      icr = Number(this.settings.icr_breakfast) || 1.7;
      periodName = 'Завтрак';
    } else if (effectiveType === 'Ужин') {
      icr = Number(this.settings.icr_dinner) || 1.3;
      periodName = 'Ужин';
    } else if (effectiveType === 'Перекус') {
      if (hour >= 5 && hour < 11) {
        icr = Number(this.settings.icr_breakfast) || 1.7;
        periodName = 'Перекус (утро)';
      } else if (hour >= 18 || hour < 5) {
        icr = Number(this.settings.icr_dinner) || 1.3;
        periodName = 'Перекус (вечер)';
      } else {
        icr = Number(this.settings.icr_lunch) || 1.5;
        periodName = 'Перекус (день)';
      }
    }

    const step = Number(this.settings.insulin_step) || 1.0;
    const rawDose = (Number(breadUnits) || 0) * icr;
    // Conservative clinical rounding: half-steps (e.g. X.5) round toward lower unit to reduce hypoglycemia risk
    const roundedDose = Number((Math.floor((rawDose / step) + 0.45) * step).toFixed(1));
    const dose = Number.isInteger(roundedDose) ? roundedDose.toString() : roundedDose.toFixed(1);

    return {
      enabled: true,
      dose,
      rawDose: rawDose.toFixed(1),
      icr,
      periodName,
      step,
      mealType: effectiveType
    };
  }

  selectVerificationMealType(mealType) {
    this.selectedVerificationMealType = mealType;
    document.querySelectorAll('#scanMealTypeSelector .meal-type-pill').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mealType === mealType);
    });
    const carbs = Math.max(0, Number(document.getElementById('scanCarbsInput')?.value) || 0);
    this.updateVerificationInsulin(carbs);
  }

  updateVerificationInsulin(carbs) {
    const xeRatio = Number(this.settings?.xe_ratio) || 10;
    const xe = Math.round((carbs / xeRatio) * 10) / 10;
    const xeDisplay = document.getElementById('scanBreadUnitsDisplay');
    if (xeDisplay) xeDisplay.textContent = `${xe} ХЕ`;

    const xeFormulaLabel = document.getElementById('scanXeFormulaLabel');
    if (xeFormulaLabel) {
      xeFormulaLabel.textContent = `Рассчитано по формуле (${Math.round(carbs)}г / ${xeRatio}г)`;
    }

    // Update recommended XE for this meal slot and daily budget
    const mealType = this.selectedVerificationMealType || window.NutriStorage.detectMealType();
    const plan = this.getDailyXEPlan(this.todayMeals);
    const mealTargetXE = plan.targetsByType[mealType] ?? 4.0;
    const alreadyInSlot = plan.consumedByType[mealType] || 0;
    const slotRemainingBefore = Number(Math.max(0, mealTargetXE - alreadyInSlot).toFixed(1));
    const projectedDailyTotal = Number((plan.totalConsumedXE + xe).toFixed(1));
    const projectedDailyRemaining = Number((plan.dailyTargetXE - projectedDailyTotal).toFixed(1));

    const mealNormLabel = document.getElementById('scanMealNormLabel');
    const dailyRemLabel = document.getElementById('scanDailyRemainingLabel');
    const xeVerdict = document.getElementById('scanXeVerdict');

    if (mealNormLabel) {
      mealNormLabel.textContent = `Норма «${mealType}»: ~${mealTargetXE} ХЕ` + (alreadyInSlot > 0 ? ` (уже ${alreadyInSlot})` : '');
    }
    if (dailyRemLabel) {
      dailyRemLabel.textContent = projectedDailyRemaining >= 0
        ? `После приема ост.: ${projectedDailyRemaining} из ${plan.dailyTargetXE} ХЕ`
        : `Перебор дня: +${Math.abs(projectedDailyRemaining)} ХЕ`;
    }
    if (xeVerdict) {
      xeVerdict.classList.remove('ok', 'warn', 'excess');
      if (projectedDailyTotal > plan.dailyTargetXE + 0.5) {
        xeVerdict.classList.add('excess');
        xeVerdict.textContent = `❗ Суточная норма ХЕ будет превышена (${projectedDailyTotal} из ${plan.dailyTargetXE} ХЕ)`;
      } else if (alreadyInSlot + xe > mealTargetXE + 0.8) {
        const diff = Number(((alreadyInSlot + xe) - mealTargetXE).toFixed(1));
        xeVerdict.classList.add('warn');
        xeVerdict.textContent = `⚠️ Выше рекомендуемой нормы «${mealType}» на +${diff} ХЕ`;
      } else if (xe === 0) {
        xeVerdict.classList.add('ok');
        xeVerdict.textContent = `✅ Безуглеводное блюдо (0 ХЕ)`;
      } else {
        const leftAfter = Math.max(0, Number((slotRemainingBefore - xe).toFixed(1)));
        xeVerdict.classList.add('ok');
        xeVerdict.textContent = leftAfter > 0.2
          ? `✅ В норме для «${mealType}» (останется еще ~${leftAfter} ХЕ)`
          : `✅ Идеально попадает в норму «${mealType}»`;
      }
    }

    const insulinCard = document.getElementById('scanInsulinCard');
    const insulinInput = document.getElementById('scanInsulinInput');
    const insulinFormula = document.getElementById('scanInsulinFormula');
    const insulinContext = document.getElementById('scanInsulinContext');

    if (!this.settings?.insulin_enabled) {
      if (insulinCard) insulinCard.style.display = 'none';
      return;
    }

    if (insulinCard) insulinCard.style.display = 'flex';
    const calc = this.getInsulinCalculation(xe, mealType);
    if (insulinInput) {
      insulinInput.value = calc.dose;
      insulinInput.step = calc.step.toString();
    }
    if (insulinFormula) {
      insulinFormula.textContent = `${calc.periodName}: ${xe} ХЕ × ${calc.icr} ед/ХЕ = ${calc.rawDose} → ${calc.dose} ед. (шаг ${calc.step} ед.)`;
    }
    if (insulinContext) {
      const bolusAvg = Number(this.settings?.bolus_avg) || 7;
      const basal = Number(this.settings?.basal_insulin) || 20;
      const doseNum = Number(calc.dose) || 0;
      if (xe === 0) {
        insulinContext.textContent = `Базал: ${basal} ед. · Углеводов нет — подколка не требуется`;
      } else if (doseNum > bolusAvg + 2) {
        insulinContext.textContent = `Выше вашей обычной дозы (~${bolusAvg} ед.) — порция больше средней`;
      } else if (doseNum < Math.max(1, bolusAvg - 2)) {
        insulinContext.textContent = `Ниже вашей обычной дозы (~${bolusAvg} ед.) — легкий прием`;
      } else {
        insulinContext.textContent = `Соответствует вашей средней дозе (~${bolusAvg} ед. · Базал ${basal} ед.)`;
      }
    }
  }

  // --- VERIFICATION & EDIT MODAL ---

  onScanWeightChange(newWeightStr) {
    if (!this.baseVerificationData) return;
    const weight = Number(newWeightStr);
    if (isNaN(weight) || weight <= 0) return;

    // Proportionally recalculate based on nutritional density per gram
    const newCalories = Math.round(weight * this.baseVerificationData.caloriesPerGram);
    const newProtein = Math.round(weight * this.baseVerificationData.proteinPerGram * 10) / 10;
    const newFat = Math.round(weight * this.baseVerificationData.fatPerGram * 10) / 10;
    const newCarbs = Math.round(weight * this.baseVerificationData.carbsPerGram * 10) / 10;

    const calInput = document.getElementById('scanCaloriesInput');
    const protInput = document.getElementById('scanProteinInput');
    const fatInput = document.getElementById('scanFatInput');
    const carbsInput = document.getElementById('scanCarbsInput');

    if (calInput) calInput.value = newCalories;
    if (protInput) protInput.value = newProtein;
    if (fatInput) fatInput.value = newFat;
    if (carbsInput) carbsInput.value = newCarbs;

    this.updateVerificationInsulin(newCarbs);
  }

  onManualMacroChange() {
    const weight = Math.max(1, Number(document.getElementById('scanWeightInput')?.value) || 1);
    const calories = Number(document.getElementById('scanCaloriesInput')?.value) || 0;
    const protein = Number(document.getElementById('scanProteinInput')?.value) || 0;
    const fat = Number(document.getElementById('scanFatInput')?.value) || 0;
    const carbs = Number(document.getElementById('scanCarbsInput')?.value) || 0;

    this.baseVerificationData = {
      baseWeight: weight,
      caloriesPerGram: calories / weight,
      proteinPerGram: protein / weight,
      fatPerGram: fat / weight,
      carbsPerGram: carbs / weight
    };
  }

  openScanVerificationModal(scanData) {
    this.tempScanResult = scanData;
    const overlay = document.getElementById('verifyModalOverlay');

    const rawWeight = Number(scanData.weight_g) || 0;
    const initialWeight = rawWeight > 0 ? rawWeight : 100;

    // Cache nutritional density (per gram) for real-time proportional scaling
    this.baseVerificationData = {
      baseWeight: initialWeight,
      caloriesPerGram: (Number(scanData.calories) || 0) / initialWeight,
      proteinPerGram: (Number(scanData.protein_g) || 0) / initialWeight,
      fatPerGram: (Number(scanData.fat_g) || 0) / initialWeight,
      carbsPerGram: (Number(scanData.carbs_g) || 0) / initialWeight
    };

    document.getElementById('scanDishNameInput').value = scanData.dish_name || '';
    document.getElementById('scanWeightInput').value = scanData.weight_g || 0;
    document.getElementById('scanCaloriesInput').value = scanData.calories || 0;
    document.getElementById('scanProteinInput').value = scanData.protein_g || 0;
    document.getElementById('scanFatInput').value = scanData.fat_g || 0;
    document.getElementById('scanCarbsInput').value = scanData.carbs_g || 0;

    // Set active meal type pill & update XE/Insulin recommendations dynamically
    const initialMealType = scanData.mealType || window.NutriStorage.detectMealType();
    this.selectVerificationMealType(initialMealType);

    // User Comment field is EMPTY by default per user request, ready for notes
    const commentInput = document.getElementById('scanCommentInput');
    if (commentInput) {
      commentInput.value = '';
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

    // Clinical advice comment - displayed in advice box
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
    this.baseVerificationData = null;
    this.selectedVerificationMealType = null;
  }

  async saveVerifiedMeal() {
    const name = document.getElementById('scanDishNameInput').value.trim() || 'Блюдо';
    const weight_g = Math.max(0, Number(document.getElementById('scanWeightInput').value) || 0);
    const calories = Math.max(0, Number(document.getElementById('scanCaloriesInput').value) || 0);
    const protein = Math.max(0, Number(document.getElementById('scanProteinInput').value) || 0);
    const fat = Math.max(0, Number(document.getElementById('scanFatInput').value) || 0);
    const carbs = Math.max(0, Number(document.getElementById('scanCarbsInput').value) || 0);
    const userComment = document.getElementById('scanCommentInput') ? document.getElementById('scanCommentInput').value.trim() : '';

    const mealType = this.selectedVerificationMealType || window.NutriStorage.detectMealType();
    const xeRatio = Number(this.settings?.xe_ratio) || 10;
    const bread_units = Math.round((carbs / xeRatio) * 10) / 10;
    const insulinCalc = this.getInsulinCalculation(bread_units, mealType);

    const userDoseInput = document.getElementById('scanInsulinInput');
    const userDose = userDoseInput ? Number(userDoseInput.value) : null;
    const finalInsulinDose = (!isNaN(userDose) && userDose !== null && userDose >= 0) ? userDose : (insulinCalc.enabled ? insulinCalc.dose : null);

    const mealData = {
      date: this.currentDateStr,
      type: mealType,
      name,
      weight_g,
      calories,
      protein,
      fat,
      carbs,
      bread_units,
      insulin_dose: insulinCalc.enabled ? finalInsulinDose : null,
      insulin_icr: insulinCalc.enabled ? insulinCalc.icr : null,
      ai_advice: this.tempScanResult?.comment || '',
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

    // Display recorded insulin bolus if present
    const insulinRow = document.getElementById('detailMealInsulinRow');
    const insulinVal = document.getElementById('detailMealInsulinVal');
    if (meal.insulin_dose) {
      if (insulinVal) insulinVal.textContent = `${meal.insulin_dose} ед. (УК: ${meal.insulin_icr || '—'})`;
      if (insulinRow) insulinRow.style.display = 'flex';
    } else {
      if (insulinRow) insulinRow.style.display = 'none';
    }

    // Display AI clinical advice if recorded
    const adviceBox = document.getElementById('detailMealAdviceBox');
    if (adviceBox) {
      if (meal.ai_advice) {
        adviceBox.textContent = `💡 Подсказка ИИ: ${meal.ai_advice}`;
        adviceBox.style.display = 'block';
      } else {
        adviceBox.style.display = 'none';
      }
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
    const genderInput = document.getElementById('settingUserGender');
    if (genderInput) genderInput.value = settings.user_gender || 'male';
    const ageInput = document.getElementById('settingUserAge');
    if (ageInput) ageInput.value = settings.user_age || 35;
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

    // Insulin settings
    const insulinEnabledCheckbox = document.getElementById('settingInsulinEnabled');
    if (insulinEnabledCheckbox) insulinEnabledCheckbox.checked = settings.insulin_enabled !== false;

    const basalInput = document.getElementById('settingBasalInsulin');
    if (basalInput) basalInput.value = settings.basal_insulin || 20;

    const bolusAvgInput = document.getElementById('settingBolusAvg');
    if (bolusAvgInput) bolusAvgInput.value = settings.bolus_avg || 7;

    const typicalMealInput = document.getElementById('settingTypicalMealXe');
    if (typicalMealInput) typicalMealInput.value = settings.typical_meal_xe || 4.8;

    const dailyInsulinInput = document.getElementById('settingDailyInsulin');
    if (dailyInsulinInput) dailyInsulinInput.value = settings.total_daily_insulin || 41;

    const icrBreakfastInput = document.getElementById('settingIcrBreakfast');
    if (icrBreakfastInput) icrBreakfastInput.value = settings.icr_breakfast ?? 1.7;

    const icrLunchInput = document.getElementById('settingIcrLunch');
    if (icrLunchInput) icrLunchInput.value = settings.icr_lunch ?? 1.5;

    const icrDinnerInput = document.getElementById('settingIcrDinner');
    if (icrDinnerInput) icrDinnerInput.value = settings.icr_dinner ?? 1.3;

    const insulinStepInput = document.getElementById('settingInsulinStep');
    if (insulinStepInput) {
      const currentStep = Number(settings.insulin_step);
      insulinStepInput.value = (currentStep === 0.5) ? '0.5' : '1';
    }

    const noticeBox = document.getElementById('settingsNoticeBox');
    if (noticeMsg) {
      noticeBox.textContent = noticeMsg;
      noticeBox.style.display = 'block';
    } else {
      noticeBox.style.display = 'none';
    }

    this.updateSettingsCalorieCheck();
    overlay.classList.add('active');
  }

  switchProvider(provider) {
    this.currentProvider = 'openrouter';
  }

  onProfileChange() {
    // Optional live feedback hook
  }

  updateSettingsCalorieCheck() {
    const targetCals = Number(document.getElementById('settingTargetCalories')?.value) || 2100;
    const p = Number(document.getElementById('settingTargetProtein')?.value) || 0;
    const f = Number(document.getElementById('settingTargetFat')?.value) || 0;
    const c = Number(document.getElementById('settingTargetCarbs')?.value) || 0;
    const xeRatio = Math.max(5, Number(document.getElementById('settingXeRatio')?.value) || 10);

    const dailyXE = Number((c / xeRatio).toFixed(1));
    const hint = document.getElementById('settingCarbsXeHint');
    if (hint) hint.textContent = `= ${dailyXE} ХЕ/сут`;

    const macroCals = Math.round(p * 4 + f * 9 + c * 4);
    const mismatchBox = document.getElementById('settingsMacroMismatchBox');
    const mismatchText = document.getElementById('settingsMacroMismatchText');
    if (mismatchBox && mismatchText) {
      if (Math.abs(macroCals - targetCals) > 150) {
        const recCarbs = Math.round((targetCals * 0.40) / 4);
        const recXE = Number((recCarbs / xeRatio).toFixed(1));
        mismatchText.innerHTML = `⚠️ Ваши БЖУ дают <strong>${macroCals.toLocaleString('ru-RU')} ккал</strong>, а дневная цель — <strong>${targetCals.toLocaleString('ru-RU')} ккал</strong>. Для ${targetCals} ккал норма ≈ <strong>${recCarbs}г угл. (${recXE} ХЕ)</strong>.`;
        mismatchBox.style.display = 'flex';
      } else {
        mismatchBox.style.display = 'none';
      }
    }
  }

  syncMacrosToCalories() {
    const cals = Math.max(800, Number(document.getElementById('settingTargetCalories')?.value) || 2100);
    const xeRatio = Math.max(5, Number(document.getElementById('settingXeRatio')?.value) || 10);

    // Balanced diabetic macro split: 25% Protein, 34% Fat, ~41% Carbs
    const protein = Math.round((cals * 0.25) / 4);
    const fat = Math.round((cals * 0.34) / 9);
    const carbs = Math.round(Math.max(100, cals - protein * 4 - fat * 9) / 4);
    const dailyXE = Number((carbs / xeRatio).toFixed(1));

    document.getElementById('settingTargetProtein').value = protein;
    document.getElementById('settingTargetFat').value = fat;
    document.getElementById('settingTargetCarbs').value = carbs;

    this.updateSettingsCalorieCheck();
    this.showToast(`✅ БЖУ подогнаны под ${cals} ккал: Углеводы ${carbs}г (${dailyXE} ХЕ/сут)`);
  }

  autoCalculateCalories() {
    const height = Number(document.getElementById('settingUserHeight').value);
    const weight = Number(document.getElementById('settingUserWeight').value);
    const age = Number(document.getElementById('settingUserAge')?.value) || 35;
    const gender = document.getElementById('settingUserGender')?.value || 'male';
    const xeRatio = Math.max(5, Number(document.getElementById('settingXeRatio')?.value) || 10);

    if (!height || !weight || height < 100 || weight < 30) {
      alert('Пожалуйста, укажите корректные рост (см) и вес (кг) для расчета нормы.');
      return;
    }

    // Mifflin-St Jeor equation using age and gender (baseline sedentary/light activity factor 1.35)
    const baseBmr = 10 * weight + 6.25 * height - 5 * age;
    const bmr = gender === 'female' ? baseBmr - 161 : baseBmr + 5;
    const tdee = Math.round(bmr * 1.35);

    const protein = Math.round((tdee * 0.25) / 4);
    const fat = Math.round((tdee * 0.33) / 9);
    const remainingCals = Math.max(400, tdee - (protein * 4 + fat * 9));
    const carbs = Math.round(remainingCals / 4);
    const dailyXE = Number((carbs / xeRatio).toFixed(1));

    document.getElementById('settingTargetCalories').value = tdee;
    document.getElementById('settingTargetProtein').value = protein;
    document.getElementById('settingTargetFat').value = fat;
    document.getElementById('settingTargetCarbs').value = carbs;

    this.updateSettingsCalorieCheck();
    this.showToast(`Норма (${age} лет): ${tdee} ккал (У:${carbs}г = ${dailyXE} ХЕ)`);
  }

  fillTypicalMealFromPlan() {
    const carbs = Number(document.getElementById('settingTargetCarbs')?.value) || 220;
    const xeRatio = Math.max(5, Number(document.getElementById('settingXeRatio')?.value) || 10);
    const dailyXE = carbs / xeRatio;
    // Main meals account for 85% of daily XE (Breakfast 25%, Lunch 35%, Dinner 25%) divided across 3 main meals
    const avgMainMealXE = Math.max(1.5, Number(((dailyXE * 0.85) / 3).toFixed(1)));

    const input = document.getElementById('settingTypicalMealXe');
    if (input) input.value = avgMainMealXE;

    const hint = document.getElementById('regimenCalibrationHint');
    if (hint) {
      hint.textContent = `📊 Средний основной прием при плане ${dailyXE.toFixed(1)} ХЕ/сут = ${avgMainMealXE} ХЕ. Нажмите «Пересчитать УК» для обновления коэффициентов.`;
    }
    this.showToast(`Подставлено из плана: ${avgMainMealXE} ХЕ (при ${dailyXE.toFixed(1)} ХЕ/сут)`);
  }

  autoCalculateICRFromRegimen() {
    const basal = Number(document.getElementById('settingBasalInsulin')?.value) || 20;
    const bolus = Number(document.getElementById('settingBolusAvg')?.value) || 7;
    const typicalMealXe = Math.max(1, Number(document.getElementById('settingTypicalMealXe')?.value) || 4.8);

    if (bolus <= 0) {
      alert('Пожалуйста, укажите вашу среднюю дозу короткого инсулина на прием пищи.');
      return;
    }

    const lunchIcr = Math.max(0.3, Math.round((bolus / typicalMealXe) * 10) / 10);
    // Morning dawn phenomenon / cortisol: ~15% higher resistance
    const breakfastIcr = Math.max(0.3, Math.round((lunchIcr * 1.15) * 10) / 10);
    // Evening: ~13% higher sensitivity
    const dinnerIcr = Math.max(0.3, Math.round((lunchIcr * 0.87) * 10) / 10);

    const bInput = document.getElementById('settingIcrBreakfast');
    const lInput = document.getElementById('settingIcrLunch');
    const dInput = document.getElementById('settingIcrDinner');
    if (bInput) bInput.value = breakfastIcr;
    if (lInput) lInput.value = lunchIcr;
    if (dInput) dInput.value = dinnerIcr;

    const tdd = basal + (bolus * 3);
    const dailyInput = document.getElementById('settingDailyInsulin');
    if (dailyInput) dailyInput.value = tdd;

    const hint = document.getElementById('regimenCalibrationHint');
    if (hint) {
      hint.textContent = `✅ Расчет: ${bolus} ед. ÷ ${typicalMealXe} ХЕ = ${lunchIcr} ед/ХЕ (Утро ${breakfastIcr}, Обед ${lunchIcr}, Ужин ${dinnerIcr})`;
    }

    this.showToast(`✅ УК откалиброваны (${bolus} ед. ÷ ${typicalMealXe} ХЕ): ${breakfastIcr} / ${lunchIcr} / ${dinnerIcr}`);
  }

  autoCalculateICR() {
    this.autoCalculateICRFromRegimen();
  }

  closeSettingsModal() {
    document.getElementById('settingsModalOverlay').classList.remove('active');
  }

  async saveSettings() {
    const user_name = document.getElementById('settingUserName').value.trim();
    const user_gender = document.getElementById('settingUserGender')?.value || 'male';
    const user_age = Math.max(10, Number(document.getElementById('settingUserAge')?.value) || 35);
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

    const insulin_enabled = document.getElementById('settingInsulinEnabled') ? document.getElementById('settingInsulinEnabled').checked : true;
    const basal_insulin = Number(document.getElementById('settingBasalInsulin')?.value) || 20;
    const bolus_avg = Number(document.getElementById('settingBolusAvg')?.value) || 7;
    const typical_meal_xe = Math.max(1, Number(document.getElementById('settingTypicalMealXe')?.value) || 4.8);
    const total_daily_insulin = Number(document.getElementById('settingDailyInsulin')?.value) || (basal_insulin + bolus_avg * 3);
    const icr_breakfast = Number(document.getElementById('settingIcrBreakfast')?.value) || 1.7;
    const icr_lunch = Number(document.getElementById('settingIcrLunch')?.value) || 1.5;
    const icr_dinner = Number(document.getElementById('settingIcrDinner')?.value) || 1.3;
    const insulin_step = Number(document.getElementById('settingInsulinStep')?.value) || 1.0;

    await window.NutriStorage.saveSettings({
      user_name,
      user_gender,
      user_age,
      user_height,
      user_weight,
      api_provider,
      openrouter_api_key,
      openrouter_model,
      target_calories,
      target_protein,
      target_fat,
      target_carbs,
      xe_ratio,
      insulin_enabled,
      basal_insulin,
      bolus_avg,
      typical_meal_xe,
      total_daily_insulin,
      icr_breakfast,
      icr_lunch,
      icr_dinner,
      insulin_step,
      v25_calibrated: true
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

  async forceHardUpdate() {
    if (confirm('Сбросить кэш и принудительно обновить приложение до последней версии?')) {
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) {
            await reg.unregister();
          }
        }
      } catch (e) {
        console.warn('Cache clear error:', e);
      }
      window.location.reload(true);
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

      let dateFormatted = this.formatReadableDate(dateStr);

      html += `
        <div class="history-group-header" style="cursor:pointer;" onclick="window.app.jumpToDate('${dateStr}')" title="Открыть этот день в дневнике">
          <span>📅 ${dateFormatted}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="color:var(--color-calories);">${dayCals} ккал · ${dayXE} ХЕ</span>
            <button type="button" class="date-nav-return-btn" style="padding:2px 8px;font-size:10px;" onclick="event.stopPropagation(); window.app.jumpToDate('${dateStr}')">Перейти ↗</button>
          </div>
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
