/**
 * AI Vision & NLP Module for NutriTrack PWA
 * Supports:
 * 1. Google Gemini API (Direct or via personal Cloudflare Worker proxy for 100% VPN-free access)
 * 2. OpenRouter API (Directly accessible from Russia/CIS without VPN, supports free Gemini models)
 */

class NutriGemini {
  constructor() {
    this.geminiDefaultHost = 'https://generativelanguage.googleapis.com';
    this.openRouterHost = 'https://openrouter.ai/api/v1/chat/completions';
  }

  getSystemPrompt(xeRatio = 10) {
    return `Ты — профессиональный клинический диетолог и эндокринолог, эксперт по оценке пищевой ценности и расчету Хлебных Единиц (ХЕ).
Правило расчета ХЕ: 1 ХЕ = ${xeRatio} граммов чистых углеводов (формула: bread_units = carbs_g / ${xeRatio}).

Твоя задача — проанализировать еду (по фотографии или текстовому описанию), оценить размер порции, калории, макронутриенты (белки, жиры, углеводы) и Хлебные Единицы.

Отвечай СТРОГО в формате валидного JSON без markdown кавычек (\`\`\`json), без вступительного и заключительного текста. Структура JSON:
{
  "dish_name": "Название блюда на русском языке (кратко и понятно)",
  "weight_g": 350,
  "calories": 520,
  "protein_g": 28,
  "fat_g": 16,
  "carbs_g": 64,
  "bread_units": 6.4,
  "confidence": "high",
  "comment": "Краткий комментарий по составу и совет по компенсации углеводов (1-2 предложения)",
  "breakdown": [
    {
      "item": "Название ингредиента",
      "weight_g": 150,
      "calories": 180,
      "carbs_g": 30,
      "bread_units": 3.0
    }
  ]
}`;
  }

  /**
   * Analyze food by Photo
   */
  async analyzeFoodImage(base64Image, mimeType = 'image/jpeg', userNotes = '') {
    const settings = await window.NutriStorage.getSettings();
    const provider = settings.api_provider || 'gemini';
    const xeRatio = Number(settings.xe_ratio) || 10;

    if (provider === 'openrouter') {
      return this.analyzeWithOpenRouterImage(base64Image, mimeType, userNotes, settings, xeRatio);
    } else {
      return this.analyzeWithGeminiImage(base64Image, mimeType, userNotes, settings, xeRatio);
    }
  }

  /**
   * Analyze food by Text/Voice
   */
  async analyzeFoodText(userSpeechText) {
    const settings = await window.NutriStorage.getSettings();
    const provider = settings.api_provider || 'gemini';
    const xeRatio = Number(settings.xe_ratio) || 10;

    if (provider === 'openrouter') {
      return this.analyzeWithOpenRouterText(userSpeechText, settings, xeRatio);
    } else {
      return this.analyzeWithGeminiText(userSpeechText, settings, xeRatio);
    }
  }

  // --- GEMINI HANDLERS ---

  getGeminiBaseUrl(settings) {
    const proxy = (settings.gemini_proxy_url || '').trim().replace(/\/+$/, '');
    if (proxy) {
      return `${proxy}/v1beta/models`;
    }
    // Auto-detect Netlify hosting or local proxy server to bypass geo-blocking without VPN!
    if (typeof window !== 'undefined') {
      if (window.location.hostname.endsWith('netlify.app') || window.location.port === '8000') {
        return `${window.location.origin}/api/gemini/v1beta/models`;
      }
    }
    return `${this.geminiDefaultHost}/v1beta/models`;
  }

  async executeGeminiCall(model, apiKey, requestBody, settings) {
    const endpointsToTry = [];

    // 1. Explicit proxy if specified in settings
    const explicitProxy = (settings.gemini_proxy_url || '').trim().replace(/\/+$/, '');
    if (explicitProxy) {
      endpointsToTry.push({
        url: `${explicitProxy}/v1beta/models/${model}:generateContent?key=${apiKey}`,
        isProxy: true,
        label: 'Пользовательский прокси'
      });
    } else {
      // 2. On Netlify or local dev server: try the proxy endpoint
      if (typeof window !== 'undefined' && (window.location.hostname.endsWith('netlify.app') || window.location.port === '8000')) {
        endpointsToTry.push({
          url: `${window.location.origin}/api/gemini/v1beta/models/${model}:generateContent?key=${apiKey}`,
          isProxy: true,
          label: 'Netlify прокси'
        });
      }
      // 3. Direct Google Gemini endpoint as automatic fallback
      endpointsToTry.push({
        url: `${this.geminiDefaultHost}/v1beta/models/${model}:generateContent?key=${apiKey}`,
        isProxy: false,
        label: 'Google Gemini напрямую'
      });
    }

    let lastError = null;

    for (const endpoint of endpointsToTry) {
      try {
        const response = await fetch(endpoint.url, {
          method: 'POST',
          credentials: endpoint.isProxy ? 'include' : 'omit',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errText = await response.text();
          let msg = errText;
          try {
            const j = JSON.parse(errText);
            msg = j.error?.message || errText;
          } catch (e) {
            // Server returned HTML (e.g. Netlify Login Redirect 401)
            if (errText.includes('Login Redirect') || errText.includes('edge-access') || errText.includes('<!DOCTYPE')) {
              console.warn(`[NutriGemini] ${endpoint.label} вернул 401 Login Redirect. Пробуем следующий эндпоинт...`);
              lastError = new Error('Шлюз Netlify вернул страницу авторизации (Login Redirect 401). Если у вас включен "Site Protection", снимите его в настройках Netlify.');
              continue;
            }
          }

          if (response.status === 400 && msg.includes('User location is not supported')) {
            throw new Error('Google заблокировал доступ из вашего региона (User location not supported). Рекомендуем переключиться на OpenRouter в настройках (⚙️) — он работает из РФ без VPN!');
          }

          const err = new Error(`Ошибка Gemini API (${response.status}): ${msg}`);
          err.status = response.status;
          err.rawMessage = msg;

          // If proxy returned 401, 403, or 502, continue to next endpoint
          if (endpoint.isProxy && (response.status === 401 || response.status === 403 || response.status === 502)) {
            console.warn(`[NutriGemini] ${endpoint.label} вернул статус ${response.status}. Пробуем прямое подключение...`);
            lastError = err;
            continue;
          }

          throw err;
        }

        return await response.json();
      } catch (netErr) {
        if (netErr.message && netErr.message.includes('User location is not supported')) {
          throw netErr;
        }
        console.warn(`[NutriGemini] Ошибка запроса к ${endpoint.label}:`, netErr.message);
        lastError = netErr;
      }
    }

    throw lastError || new Error('Не удалось получить ответ от Gemini API. Проверьте подключение.');
  }

  async callGeminiWithFallback(requestBody, settings, initialModel) {
    const apiKey = (settings.gemini_api_key || '').trim();
    if (!apiKey) {
      throw new Error('API-ключ Gemini не указан. Укажите его в настройках.');
    }

    const preferred = initialModel || settings.gemini_model || 'gemini-3.5-flash-lite';
    const fallbackList = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'];
    const modelsToTry = [preferred, ...fallbackList.filter(m => m !== preferred)];

    let lastError = null;
    for (const model of modelsToTry) {
      try {
        const data = await this.executeGeminiCall(model, apiKey, requestBody, settings);
        if (model !== preferred) {
          console.log(`Auto-switched model from ${preferred} to working model ${model}`);
          window.NutriStorage.saveSettings({ gemini_model: model }).catch(() => {});
        }
        return data;
      } catch (err) {
        lastError = err;
        const msg = err.rawMessage || err.message || '';
        if (err.status === 404 || msg.includes('not supported') || msg.includes('not found') || msg.includes('no longer available')) {
          console.warn(`Model ${model} not available, trying next model...`);
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  async analyzeFoodImage(base64Image, mimeType = 'image/jpeg', userNotes = '') {
    const settings = await window.NutriStorage.getSettings();
    const provider = settings.api_provider || 'gemini';
    const xeRatio = Number(settings.xe_ratio) || 10;

    if (provider === 'openrouter') {
      return this.analyzeWithOpenRouterImage(base64Image, mimeType, userNotes, settings, xeRatio);
    } else {
      return this.analyzeWithGeminiImage(base64Image, mimeType, userNotes, settings, xeRatio);
    }
  }

  async analyzeWithGeminiImage(base64Image, mimeType, userNotes, settings, xeRatio) {
    const promptText = `Определи блюдо на фотографии. ${userNotes ? 'Уточнение: ' + userNotes : ''}
Оцени вес порции в граммах, калории, белки, жиры, углеводы и рассчитай Хлебные Единицы (1 ХЕ = ${xeRatio}г углеводов).`;

    const requestBody = {
      systemInstruction: {
        parts: [{ text: this.getSystemPrompt(xeRatio) }]
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Image
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    };

    const data = await this.callGeminiWithFallback(requestBody, settings, settings.gemini_model || 'gemini-3.5-flash-lite');
    return this.parseGeminiResponse(data, xeRatio);
  }

  async analyzeWithGeminiText(userSpeechText, settings, xeRatio) {
    const promptText = `Пользователь голосом или текстом описал, что он съел: "${userSpeechText}".
Определи блюда, оцени средний вес порции, рассчитай калории, БЖУ и Хлебные Единицы (1 ХЕ = ${xeRatio}г углеводов).`;

    const requestBody = {
      systemInstruction: {
        parts: [{ text: this.getSystemPrompt(xeRatio) }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: promptText }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    };

    const data = await this.callGeminiWithFallback(requestBody, settings, settings.gemini_model || 'gemini-3.5-flash-lite');
    return this.parseGeminiResponse(data, xeRatio);
  }

  // --- OPENROUTER HANDLERS (NO VPN NEEDED FROM RUSSIA) ---

  async analyzeWithOpenRouterImage(base64Image, mimeType, userNotes, settings, xeRatio) {
    const apiKey = (settings.openrouter_api_key || '').trim();
    if (!apiKey) {
      throw new Error('API-ключ OpenRouter не указан. Зарегистрируйтесь на openrouter.ai и вставьте ключ.');
    }

    const model = settings.openrouter_model || 'google/gemini-2.0-flash-exp:free';
    const promptText = `Определи блюдо на фотографии. ${userNotes ? 'Уточнение: ' + userNotes : ''}
Оцени вес порции в граммах, калории, белки, жиры, углеводы и рассчитай Хлебные Единицы (1 ХЕ = ${xeRatio}г углеводов).`;

    const requestBody = {
      model: model,
      messages: [
        { role: 'system', content: this.getSystemPrompt(xeRatio) },
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        }
      ],
      temperature: 0.2
    };

    const response = await fetch(this.openRouterHost, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://nutritrack.app',
        'X-Title': 'NutriTrack PWA'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ошибка OpenRouter API (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return this.parseOpenRouterResponse(data, xeRatio);
  }

  async analyzeWithOpenRouterText(userSpeechText, settings, xeRatio) {
    const apiKey = (settings.openrouter_api_key || '').trim();
    if (!apiKey) {
      throw new Error('API-ключ OpenRouter не указан. Вставьте ключ в настройках.');
    }

    const model = settings.openrouter_model || 'google/gemini-2.0-flash-exp:free';
    const promptText = `Пользователь описал, что он съел: "${userSpeechText}".
Определи блюда, оцени средний вес порции, рассчитай калории, БЖУ и Хлебные Единицы (1 ХЕ = ${xeRatio}г углеводов).`;

    const requestBody = {
      model: model,
      messages: [
        { role: 'system', content: this.getSystemPrompt(xeRatio) },
        { role: 'user', content: promptText }
      ],
      temperature: 0.2
    };

    const response = await fetch(this.openRouterHost, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://nutritrack.app',
        'X-Title': 'NutriTrack PWA'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ошибка OpenRouter API (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return this.parseOpenRouterResponse(data, xeRatio);
  }

  parseOpenRouterResponse(apiResponse, xeRatio) {
    const content = apiResponse.choices?.[0]?.message?.content;
    if (!content) throw new Error('ИИ не вернул ответ через OpenRouter.');

    const cleaned = content.replace(/```json\n?/, '').replace(/```\n?$/, '').trim();
    return this.sanitizeResult(JSON.parse(cleaned), xeRatio);
  }

  parseGeminiResponse(apiResponse, xeRatio) {
    const rawText = apiResponse.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('ИИ не вернул результат анализа.');

    const cleaned = rawText.replace(/```json\n?/, '').replace(/```\n?$/, '').trim();
    return this.sanitizeResult(JSON.parse(cleaned), xeRatio);
  }

  sanitizeResult(result, xeRatio) {
    const carbs = Math.max(0, Math.round(Number(result.carbs_g) || 0));
    const calculatedXE = Number((carbs / xeRatio).toFixed(1));

    return {
      dish_name: result.dish_name || 'Распознанное блюдо',
      weight_g: Math.max(0, Math.round(Number(result.weight_g) || 0)),
      calories: Math.max(0, Math.round(Number(result.calories) || 0)),
      protein_g: Math.max(0, Math.round(Number(result.protein_g) || 0)),
      fat_g: Math.max(0, Math.round(Number(result.fat_g) || 0)),
      carbs_g: carbs,
      bread_units: calculatedXE,
      confidence: result.confidence || 'medium',
      comment: result.comment || '',
      breakdown: Array.isArray(result.breakdown) ? result.breakdown : []
    };
  }

  /**
   * Validate API Key / Proxy
   */
  async testApiKey(keyToTest, proxyUrl = '') {
    const cleanProxy = proxyUrl.trim().replace(/\/+$/, '');
    const bases = [];
    if (cleanProxy) {
      bases.push({ base: `${cleanProxy}/v1beta/models`, isProxy: true, label: 'Пользовательский прокси' });
    } else {
      if (typeof window !== 'undefined' && (window.location.hostname.endsWith('netlify.app') || window.location.port === '8000')) {
        bases.push({ base: `${window.location.origin}/api/gemini/v1beta/models`, isProxy: true, label: 'Netlify прокси' });
      }
      bases.push({ base: `${this.geminiDefaultHost}/v1beta/models`, isProxy: false, label: 'Google напрямую' });
    }

    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'];
    let lastErr = null;

    for (const b of bases) {
      for (const model of modelsToTry) {
        const url = `${b.base}/${model}:generateContent?key=${keyToTest.trim()}`;
        try {
          const response = await fetch(url, {
            method: 'POST',
            credentials: b.isProxy ? 'include' : 'omit',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'Привет! Ответь словом "OK".' }] }]
            })
          });

          if (response.ok) {
            return true;
          }

          const errText = await response.text();
          let msg = errText;
          try {
            const j = JSON.parse(errText);
            msg = j.error?.message || errText;
          } catch (e) {
            if (errText.includes('Login Redirect') || errText.includes('edge-access') || errText.includes('<!DOCTYPE')) {
              console.warn(`[NutriGemini] ${b.label} вернул 401 Login Redirect при тесте.`);
              lastErr = new Error('Шлюз Netlify вернул страницу авторизации (Login Redirect 401). Проверьте настройки Netlify.');
              break;
            }
          }

          if (response.status === 400 && msg.includes('User location is not supported')) {
            throw new Error('Google блокирует этот IP (User location not supported). В Netlify или через OpenRouter этот запрос пройдёт без VPN.');
          }
          if (response.status === 404 || msg.includes('not supported') || msg.includes('not found') || msg.includes('no longer available')) {
            lastErr = new Error(`Модель ${model} недоступна: ${msg}`);
            continue;
          }
          throw new Error('Ошибка проверки ключа: ' + msg);
        } catch (e) {
          if (e.message.includes('User location') || e.message.includes('API key not valid')) {
            throw e;
          }
          lastErr = e;
        }
      }
    }
    throw lastErr || new Error('Не удалось подключиться к моделям Gemini.');
  }

  async testOpenRouterKey(keyToTest) {
    const response = await fetch(this.openRouterHost, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keyToTest.trim()}`
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [{ role: 'user', content: 'Say OK' }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error('Ошибка проверки OpenRouter ключа: ' + err);
    }
    return true;
  }
}

window.NutriGemini = new NutriGemini();
