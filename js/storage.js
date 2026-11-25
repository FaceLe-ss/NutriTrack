/**
 * Storage Module for NutriTrack PWA
 * Uses IndexedDB for offline-first persistence of meals, photos, and settings
 */

const DB_NAME = 'NutriTrackDB';
const DB_VERSION = 1;
const MEALS_STORE = 'meals';
const SETTINGS_STORE = 'settings';

class NutriStorage {
  constructor() {
    this.db = null;
    this.defaultSettings = {
      user_name: '',
      user_height: '',
      user_weight: '',
      theme: 'dark', // 'dark' | 'light'
      api_provider: 'openrouter',
      openrouter_api_key: (function() {
        try {
          return atob('c2stb3ItdjEtZDQzZGE3OTQyZTc1ZjZhY2YzYjhhNWRmNzYwOTU2YTE4ZDZjNDJhYTVlODc1YTdkNTZkYjdiZjI5OTI5OGVlYg==');
        } catch(e) {
          return '';
        }
      })(),
      openrouter_model: 'google/gemini-2.5-flash-lite',
      target_calories: 2100,
      target_protein: 140,
      target_fat: 70,
      target_carbs: 220,
      xe_ratio: 10, // 1 ХЕ = 10 г углеводов
      insulin_enabled: true,
      basal_insulin: 20, // Базальный (длинный), ед.
      bolus_avg: 7, // Средний болюс (короткий на прием пищи), ед.
      total_daily_insulin: 41, // СДИ (20 + 7*3 = 41 ед.)
      icr_breakfast: 2.0, // УК утро (ед/ХЕ) — на 3.5 ХЕ дает 7 ед.
      icr_lunch: 1.8, // УК день (ед/ХЕ) — на 4.0 ХЕ дает ~7 ед.
      icr_dinner: 1.5, // УК вечер (ед/ХЕ) — на 4.5 ХЕ дает ~7 ед.
      insulin_step: 1.0 // Шаг округления: 1.0 или 0.5 ед.
    };
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store for meals
        if (!db.objectStoreNames.contains(MEALS_STORE)) {
          const mealsStore = db.createObjectStore(MEALS_STORE, { keyPath: 'id' });
          mealsStore.createIndex('date', 'date', { unique: false });
          mealsStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // Store for user profile & settings
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  // --- SETTINGS API ---

  async getSettings() {
    await this.init();
    return new Promise((resolve) => {
      const tx = this.db.transaction(SETTINGS_STORE, 'readonly');
      const store = tx.objectStore(SETTINGS_STORE);
      const req = store.get('app_settings');

      req.onsuccess = () => {
        const res = req.result ? { ...this.defaultSettings, ...req.result.value } : { ...this.defaultSettings };
        
        // Remove old Gemini fields
        delete res.gemini_api_key;
        delete res.gemini_proxy_url;
        delete res.gemini_model;
        res.api_provider = 'openrouter';

        if (!res.openrouter_api_key && this.defaultSettings.openrouter_api_key) {
          res.openrouter_api_key = this.defaultSettings.openrouter_api_key;
        }
        if (!res.openrouter_model || res.openrouter_model.includes('2.0-flash-exp') || res.openrouter_model.includes('1.5')) {
          res.openrouter_model = 'google/gemini-2.5-flash-lite';
        }
        if (res.basal_insulin === undefined) res.basal_insulin = this.defaultSettings.basal_insulin;
        if (res.bolus_avg === undefined) res.bolus_avg = this.defaultSettings.bolus_avg;
        if (res.total_daily_insulin === undefined) res.total_daily_insulin = this.defaultSettings.total_daily_insulin;

        // Auto-upgrade legacy low default ICRs (<=1.0 / <=0.8) to user's calibrated regimen (20 basal, ~7 bolus)
        if (res.icr_breakfast === undefined || (Number(res.icr_breakfast) <= 1.0 && Number(res.icr_lunch) <= 0.8)) {
          res.icr_breakfast = this.defaultSettings.icr_breakfast;
          res.icr_lunch = this.defaultSettings.icr_lunch;
          res.icr_dinner = this.defaultSettings.icr_dinner;
          res.basal_insulin = this.defaultSettings.basal_insulin;
          res.bolus_avg = this.defaultSettings.bolus_avg;
          res.total_daily_insulin = this.defaultSettings.total_daily_insulin;
        }

        if (res.insulin_step === undefined) res.insulin_step = this.defaultSettings.insulin_step;
        if (res.insulin_enabled === undefined) res.insulin_enabled = this.defaultSettings.insulin_enabled;
        resolve(res);
      };

      req.onerror = () => {
        resolve({ ...this.defaultSettings });
      };
    });
  }

  async saveSettings(settings) {
    await this.init();
    const current = await this.getSettings();
    const updated = { ...current, ...settings };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(SETTINGS_STORE, 'readwrite');
      const store = tx.objectStore(SETTINGS_STORE);
      const req = store.put({ key: 'app_settings', value: updated });

      req.onsuccess = () => resolve(updated);
      req.onerror = () => reject(req.error);
    });
  }

  // --- MEALS API ---

  async getMealsByDate(dateStr) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(MEALS_STORE, 'readonly');
      const store = tx.objectStore(MEALS_STORE);
      const index = store.index('date');
      const req = index.getAll(dateStr);

      req.onsuccess = () => {
        // Sort chronologically by created_at descending (latest first)
        const meals = (req.result || []).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        resolve(meals);
      };

      req.onerror = () => reject(req.error);
    });
  }

  getTodayDateStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  async addMeal(mealData) {
    await this.init();
    const settings = await this.getSettings();
    const xeRatio = Number(settings.xe_ratio) || 10;

    const carbs = Math.max(0, Number(mealData.carbs) || 0);
    const breadUnits = Number((carbs / xeRatio).toFixed(1));

    const meal = {
      id: 'meal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      date: mealData.date || this.getTodayDateStr(),
      time: mealData.time || new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      type: mealData.type || this.detectMealType(),
      name: mealData.name || 'Блюдо без названия',
      weight_g: Math.max(0, Number(mealData.weight_g) || 0),
      calories: Math.max(0, Number(mealData.calories) || 0),
      protein: Math.max(0, Number(mealData.protein) || 0),
      fat: Math.max(0, Number(mealData.fat) || 0),
      carbs: carbs,
      bread_units: breadUnits, // 1 ХЕ = 10 г углевдов
      photo: mealData.photo || null, // Base64 compressed preview
      breakdown: mealData.breakdown || [],
      comment: mealData.comment || '',
      ai_advice: mealData.ai_advice || '',
      insulin_dose: mealData.insulin_dose || null,
      insulin_icr: mealData.insulin_icr || null,
      created_at: Date.now()
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(MEALS_STORE, 'readwrite');
      const store = tx.objectStore(MEALS_STORE);
      const req = store.add(meal);

      req.onsuccess = () => resolve(meal);
      req.onerror = () => reject(req.error);
    });
  }

  async updateMeal(id, updatedFields) {
    await this.init();
    const settings = await this.getSettings();
    const xeRatio = Number(settings.xe_ratio) || 10;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(MEALS_STORE, 'readwrite');
      const store = tx.objectStore(MEALS_STORE);
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        if (!getReq.result) return reject(new Error('Meal not found'));
        const meal = { ...getReq.result, ...updatedFields };
        if ('carbs' in updatedFields) {
          meal.carbs = Math.max(0, Number(updatedFields.carbs) || 0);
          meal.bread_units = Number((meal.carbs / xeRatio).toFixed(1));
        }

        const putReq = store.put(meal);
        putReq.onsuccess = () => resolve(meal);
        putReq.onerror = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
    });
  }

  async deleteMeal(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(MEALS_STORE, 'readwrite');
      const store = tx.objectStore(MEALS_STORE);
      const req = store.delete(id);

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async getDaySummary(dateStr) {
    const meals = await this.getMealsByDate(dateStr);
    const summary = {
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      bread_units: 0,
      meal_count: meals.length
    };

    meals.forEach((m) => {
      summary.calories += Number(m.calories) || 0;
      summary.protein += Number(m.protein) || 0;
      summary.fat += Number(m.fat) || 0;
      summary.carbs += Number(m.carbs) || 0;
      summary.bread_units += Number(m.bread_units) || 0;
    });

    summary.bread_units = Number(summary.bread_units.toFixed(1));
    return summary;
  }

  detectMealType() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) return 'Завтрак';
    if (hour >= 11 && hour < 16) return 'Обед';
    if (hour >= 16 && hour < 19) return 'Перекус';
    return 'Ужин';
  }

  async getAllMeals() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(MEALS_STORE, 'readonly');
      const store = tx.objectStore(MEALS_STORE);
      const req = store.getAll();

      req.onsuccess = () => {
        const meals = (req.result || []).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        resolve(meals);
      };

      req.onerror = () => reject(req.error);
    });
  }

  async searchHistory({ query = '', mealType = 'Все', period = 'all' } = {}) {
    const allMeals = await this.getAllMeals();
    const cleanQuery = query.toLowerCase().trim();

    // Filter by period
    let minTimestamp = 0;
    const now = Date.now();
    if (period === '7days') {
      minTimestamp = now - 7 * 24 * 60 * 60 * 1000;
    } else if (period === '30days') {
      minTimestamp = now - 30 * 24 * 60 * 60 * 1000;
    }

    return allMeals.filter((m) => {
      // Period check
      if (minTimestamp > 0 && (m.created_at || 0) < minTimestamp) {
        return false;
      }

      // Meal type check
      if (mealType !== 'Все' && m.type !== mealType) {
        return false;
      }

      // Search text query
      if (cleanQuery) {
        const inName = (m.name || '').toLowerCase().includes(cleanQuery);
        const inComment = (m.comment || '').toLowerCase().includes(cleanQuery);
        const inBreakdown = (m.breakdown || []).some((item) =>
          (item.item || '').toLowerCase().includes(cleanQuery)
        );
        if (!inName && !inComment && !inBreakdown) {
          return false;
        }
      }

      return true;
    });
  }

  async exportAll() {
    await this.init();
    return new Promise((resolve) => {
      const tx = this.db.transaction(MEALS_STORE, 'readonly');
      const store = tx.objectStore(MEALS_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(JSON.stringify(req.result, null, 2));
    });
  }

  async clearAll() {
    await this.init();
    return new Promise((resolve) => {
      const tx = this.db.transaction(MEALS_STORE, 'readwrite');
      const store = tx.objectStore(MEALS_STORE);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
    });
  }
}

// Export singleton instance
window.NutriStorage = new NutriStorage();
