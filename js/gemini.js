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

  getSystemPrompt(xeRatio = 10, insulinEnabled = false) {
    const commentReq = insulinEnabled
      ? `- 1–2 кратких предложения: укажи тип углеводов (быстрые/медленные, плавный или резкий подъем сахара) и гликемический профиль блюда.
- Корректная формулировка для болюса: «Углеводы преимущественно медленные/быстрые. Учитывайте ХЕ при расчете дозы болюсного инсулина по вашему углеводному коэффициенту.»`
      : `- 1–2 кратких предложения: укажи тип углеводов (быстрые/медленные, плавный или резкий подъем сахара), клетчатку, сытность и баланс БЖУ.
- НЕ упоминай инсулин, уколы, болюсы или углеводные коэффициенты! Пиши только о составе блюда, ХЕ и гликемическом профиле.`;

    const exampleComment = insulinEnabled
      ? 'Сложные углеводы обеспечат плавный подъем сахара. Учитывайте 3.4 ХЕ при расчете дозы болюсного инсулина по вашему углеводному коэффициенту.'
      : 'Сложные углеводы обеспечат плавный подъем сахара и длительное чувство сытости без резких скачков.';

    return `Ты — профессиональный клинический диетолог и диабетолог-эндокринолог с глубоким пониманием доказательной медицины, точного подсчета КБЖУ и ХЕ.

КРИТИЧЕСКИ ВАЖНО ДЛЯ ДИАБЕТА:
- 1 Хлебная Единица (ХЕ) = ${xeRatio} граммов чистых усвояемых углеводов (net carbs = общие углеводы минус неусвояемая клетчатка; формула: bread_units = carbs_g / ${xeRatio}).
- ЗАВЫШЕНИЕ УГЛЕВОДОВ ОПАСНО! При любых сомнениях держись НИЖНЕЙ или СРЕДНЕЙ границы диапазона.
- СТРОГО ЗАПРЕЩЕНО писать в комментариях «внести ХЕ» или «ввести 4 ХЕ».

ПРАВИЛА ОЦЕНКИ ВЕСА, КАЛОРИЙНОСТИ И УГЛЕВОДОВ (РЕАЛИСТИЧНЫЕ ДОМАШНИЕ ПОРЦИИ, НЕ ЗАВЫШАТЬ!):
1. Оценивай ГОТОВУЮ еду на тарелке, а НЕ сухое/сырое сырье!
   - Крупы и макароны при варке впитывают воду и увеличиваются в весе в 2.5–3 раза.
   - Вареная гречка / рис: 100–120 ккал и 20–24г чистых углеводов на 100г готового блюда (НЕ 340 ккал!). Стандартная домашняя порция 150г = ~165 ккал и ~3.0–3.5 ХЕ.
   - Вареные макароны: 120–140 ккал и 24–27г углеводов на 100г.
   - Отварной картофель: 70–80 ккал и 15–17г углеводов на 100г; пюре с молоком: 85–100 ккал и 14–16г углеводов на 100г (порция 150г = 2.0–2.4 ХЕ).
   - Супы домашние (борщ, рассольник, куриный, щи): 30–50 ккал на 100г. Стандартная тарелка 250–300г = 90–140 ккал и всего 1.0–1.4 ХЕ (а не 300–400 ккал!).

2. БЕЛКОВЫЕ ПРОДУКТЫ И ЖИРЫ НЕ СОДЕРЖАТ ХЕ:
   - Мясо, курица, индейка, говядина, рыба, морепродукты, яйца, твердый сыр, растительное и сливочное масло содержат 0 ХЕ (менее 0.2 ХЕ на 100г). Не приписывай им углеводы!
   - Котлета мясная домашняя (с кусочком булки): 1 штука (~80–100г) = 150–200 ккал, не более 3–4г углеводов (0.3–0.4 ХЕ).

3. ОВОЩИ И САЛАТЫ:
   - В свежих овощах (огурцы, помидоры, капуста, зелень, кабачки) почти вся масса — вода и клетчатка. В 100г огурцов/помидоров всего 2.5–3г усвояемых углеводов (~0.25 ХЕ). Салат 150г со свежими овощами = 35–50 ккал (с 1 ч.л. растительного масла — ~80 ккал) и всего ~0.4 ХЕ.

4. ШТУЧНЫЕ СЛАДОСТИ, КОНФЕТЫ, ШОКОЛАД И СНЕКИ (ОЧЕНЬ СТРОГО, ЗАВЫШЕНИЕ НЕДОПУСТИМО!):
   - ОСОЗНАНИЕ МАКРОСЪЕМКИ (CLOSE-UP): На снимках смартфонов одна конфета, орех или печенье часто занимают 70–90% кадра! ЭТО НЕ ОЗНАЧАЕТ БОЛЬШОЙ ВЕС! Крупный план — это оптическое приближение. Подсчитай точное количество видимых штук (count items):
   - ЭТАЛОНЫ ВЕСА ДЛЯ ШТУЧНЫХ ПРОДУКТОВ:
     * 1 шоколадная конфета (глазированная с начинкой пралине, помадкой, вафельная, птичье молоко, «Мишка», «Ласточка», «Алёнка», «Raffaello»): ровно 13–16 г (НЕ 40г, НЕ 50г!). 65–85 ккал, 8–10г углеводов (~0.8–1.0 ХЕ). Если на фото видна ОДНА такая конфета — общий вес строго 14–16 г!
     * 1 крупная конфета / трюфель / батончик mini (fun-size): 18–22 г.
     * 1 карамелька / леденец («Барбарис», «Дюшес», мятная): 5–7 г (20–25 ккал, 5–6г углеводов = ~0.5 ХЕ).
     * 1 долька (квадратик) плиточного шоколада: 5–6 г (~30 ккал, ~3г углеводов = 0.3 ХЕ).
     * 1 печенье стандартное (сахарное, овсяное, «Юбилейное», крекер): 10–14 г (50–65 ккал, 7–9г углеводов = 0.7–0.9 ХЕ).
     * 1 пряник средний: 30–35 г.
     * Зефир: 1 половинка = 30–35 г, 1 целый зефир из 2 половинок = 65–70 г.
     * 1 мармеладная долька / фигурка: 10–15 г.
     * 1 стандартный ломтик хлеба (белый или черный): 25–30 г (~1.0–1.2 ХЕ, ~60–75 ккал).
     * Чай или кофе без сахара: 0–2 ккал, 0 ХЕ.
     * 1 чайная ложка сахара: 5 г чистых углеводов = 20 ккал, ровно 0.5 ХЕ.
     * Орехи: 1 половинка грецкого ореха = 2.5–3 г, 1 миндаль / фундук = 1–1.2 г, горсть орехов = 25–30 г.

5. ЕСЛИ ПОЛЬЗОВАТЕЛЬ УКАЗАЛ ТОЧНЫЙ ВЕС ИЛИ КОЛИЧЕСТВО:
   - Строго опирайся на цифры пользователя (например, «конфета 20г» — считай ровно 20г; «150г гречки» — считай ровно 150г вареной гречки, а не 300г!).

ТРЕБОВАНИЯ К ПОЛЮ "comment":
${commentReq}

Отвечай СТРОГО в формате валидного JSON без markdown кавычек (\`\`\`json), без вступительного и заключительного текста. Структура JSON:
{
  "dish_name": "Название блюда на русском языке (кратко и понятно)",
  "weight_g": 300,
  "calories": 310,
  "protein_g": 22,
  "fat_g": 9,
  "carbs_g": 34,
  "bread_units": 3.4,
  "confidence": "high",
  "comment": "${exampleComment}",
  "breakdown": [
    {
      "item": "Название ингредиента (в готовом виде)",
      "weight_g": 150,
      "calories": 165,
      "carbs_g": 32,
      "bread_units": 3.2
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

  async analyzeWithGeminiImage(base64Image, mimeType, userNotes, settings, xeRatio) {
    const insulinEnabled = settings.insulin_enabled === true;
    const promptText = `Определи продукт или блюдо на фотографии. ${userNotes ? 'Уточнение: ' + userNotes : ''}
ВНИМАНИЕ К МАСШТАБУ И ШТУЧНЫМ СЛАДОСТЯМ/СНЕКАМ:
- Если это штучный продукт (конфета, шоколад, печенье, снек, орехи): подсчитай точное число штук. Одиночная конфета крупным планом весит всего 13–16 г (НЕ 40г!), карамелька 5–7 г, долька шоколада 5–6 г, печенье 11–14 г. Не путай макросъемку с огромной порцией!
- Оцени реальный вес готовой порции (не завышай!), рассчитай калории (с учетом варки круп/макарон и умеренного содержания масла), БЖУ и Хлебные Единицы (1 ХЕ = ${xeRatio}г углеводов).`;

    const requestBody = {
      systemInstruction: {
        parts: [{ text: this.getSystemPrompt(xeRatio, insulinEnabled) }]
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
    return this.parseGeminiResponse(data, xeRatio, insulinEnabled);
  }

  async analyzeWithGeminiText(userSpeechText, settings, xeRatio) {
    const insulinEnabled = settings.insulin_enabled === true;
    const promptText = `Пользователь описал, что он съел: "${userSpeechText}".
Определи блюдо и ингредиенты. Если указано количество штук (например, «1 конфета», «2 печенья», «кусочек шоколада»), используй точные эталоны штучного веса (1 шоколадная конфета = 13–16г, 1 печенье = 11–14г). Оцени реальный вес готовой порции (не завышай!), рассчитай калории (с учетом варки круп/макарон и умеренного содержания масла), БЖУ и Хлебные Единицы (1 ХЕ = ${xeRatio}г углеводов).`;

    const requestBody = {
      systemInstruction: {
        parts: [{ text: this.getSystemPrompt(xeRatio, insulinEnabled) }]
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
    return this.parseGeminiResponse(data, xeRatio, insulinEnabled);
  }

  // --- OPENROUTER HANDLERS (NO VPN NEEDED FROM RUSSIA) ---

  async executeOpenRouterCall(model, apiKey, messages) {
    const response = await fetch(this.openRouterHost, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://nutritrack.app',
        'X-Title': 'NutriTrack PWA'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      let msg = errText;
      try {
        const j = JSON.parse(errText);
        msg = j.error?.message || errText;
      } catch (e) {}
      const err = new Error(`Ошибка OpenRouter (${response.status}): ${msg}`);
      err.status = response.status;
      err.rawMessage = msg;
      throw err;
    }

    return await response.json();
  }

  async callOpenRouterWithFallback(messages, settings) {
    const apiKey = (settings.openrouter_api_key || '').trim();
    if (!apiKey) {
      throw new Error('API-ключ OpenRouter не указан. Зарегистрируйтесь на openrouter.ai и вставьте ключ.');
    }

    const preferred = settings.openrouter_model || 'google/gemini-2.5-flash-lite';
    const fallbackList = [
      'google/gemini-2.5-flash-lite',
      'google/gemini-2.5-flash',
      'particle-ai/particle-1:free'
    ];
    const modelsToTry = [preferred, ...fallbackList.filter(m => m !== preferred)];

    let lastError = null;
    for (const model of modelsToTry) {
      try {
        const data = await this.executeOpenRouterCall(model, apiKey, messages);
        if (model !== preferred) {
          console.log(`Auto-switched OpenRouter model to ${model}`);
          window.NutriStorage.saveSettings({ openrouter_model: model }).catch(() => {});
        }
        return data;
      } catch (err) {
        lastError = err;
        const msg = err.rawMessage || err.message || '';
        if (err.status === 404 || err.status === 429 || msg.includes('rate-limited') || msg.includes('no longer available')) {
          console.warn(`Model ${model} unavailable on OpenRouter, trying next...`);
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  async analyzeWithOpenRouterImage(base64Image, mimeType, userNotes, settings, xeRatio) {
    const insulinEnabled = settings.insulin_enabled === true;
    const promptText = `Определи продукт или блюдо на фотографии. ${userNotes ? 'Уточнение: ' + userNotes : ''}
ВНИМАНИЕ К МАСШТАБУ И ШТУЧНЫМ СЛАДОСТЯМ/СНЕКАМ:
- Если это штучный продукт (конфета, шоколад, печенье, снек, орехи): подсчитай точное число штук. Одиночная конфета крупным планом весит всего 13–16 г (НЕ 40г!), карамелька 5–7 г, долька шоколада 5–6 г, печенье 11–14 г. Не путай макросъемку с огромной порцией!
- Оцени реальный вес готовой порции (не завышай!), рассчитай калории (с учетом варки круп/макарон и умеренного содержания масла), БЖУ и Хлебные Единицы (1 ХЕ = ${xeRatio}г углеводов).`;

    const messages = [
      { role: 'system', content: this.getSystemPrompt(xeRatio, insulinEnabled) },
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
    ];

    const data = await this.callOpenRouterWithFallback(messages, settings);
    return this.parseOpenRouterResponse(data, xeRatio, insulinEnabled);
  }

  async analyzeWithOpenRouterText(userSpeechText, settings, xeRatio) {
    const insulinEnabled = settings.insulin_enabled === true;
    const promptText = `Пользователь описал, что он съел: "${userSpeechText}".
Определи блюдо и ингредиенты. Если указано количество штук (например, «1 конфета», «2 печенья», «кусочек шоколада»), используй точные эталоны штучного веса (1 шоколадная конфета = 13–16г, 1 печенье = 11–14г). Оцени реальный вес готовой порции (не завышай!), рассчитай калории (с учетом варки круп/макарон и умеренного содержания масла), БЖУ и Хлебные Единицы (1 ХЕ = ${xeRatio}г углеводов).`;

    const messages = [
      { role: 'system', content: this.getSystemPrompt(xeRatio, insulinEnabled) },
      { role: 'user', content: promptText }
    ];

    const data = await this.callOpenRouterWithFallback(messages, settings);
    return this.parseOpenRouterResponse(data, xeRatio, insulinEnabled);
  }

  parseOpenRouterResponse(apiResponse, xeRatio, insulinEnabled = false) {
    const content = apiResponse.choices?.[0]?.message?.content;
    if (!content) throw new Error('ИИ не вернул ответ через OpenRouter.');

    const cleaned = content.replace(/```json\n?/, '').replace(/```\n?$/, '').trim();
    return this.sanitizeResult(JSON.parse(cleaned), xeRatio, insulinEnabled);
  }

  parseGeminiResponse(apiResponse, xeRatio, insulinEnabled = false) {
    const rawText = apiResponse.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('ИИ не вернул результат анализа.');

    const cleaned = rawText.replace(/```json\n?/, '').replace(/```\n?$/, '').trim();
    return this.sanitizeResult(JSON.parse(cleaned), xeRatio, insulinEnabled);
  }

  sanitizeResult(result, xeRatio, insulinEnabled = false) {
    const carbs = Math.max(0, Math.round(Number(result.carbs_g) || 0));
    const calculatedXE = Number((carbs / xeRatio).toFixed(1));

    let comment = (result.comment || '').trim();
    if (insulinEnabled) {
      // Clinical sanity filter: eliminate any AI hallucination saying "внести/ввести ХЕ"
      comment = comment.replace(/внести\s+(\d+[\.,]?\d*)\s*ХЕ\s*(для компенсации)?/gi, 'учесть $1 ХЕ для расчета болюса инсулина');
      comment = comment.replace(/ввести\s+(\d+[\.,]?\d*)\s*ХЕ\s*(для компенсации)?/gi, 'учесть $1 ХЕ для расчета болюса инсулина');
      comment = comment.replace(/для компенсации (углеводов )?рекомендуется внести/gi, 'для расчета болюсного инсулина учитывайте');
      comment = comment.replace(/для компенсации (углеводов )?внести/gi, 'для расчета болюса инсулина учитывайте');
    } else {
      // Strip insulin/bolus mentions completely when insulin calculator is disabled
      comment = comment.replace(/внести\s+(\d+[\.,]?\d*)\s*ХЕ\s*(для компенсации)?/gi, 'учесть $1 ХЕ');
      comment = comment.replace(/ввести\s+(\d+[\.,]?\d*)\s*ХЕ\s*(для компенсации)?/gi, 'учесть $1 ХЕ');
      const sentences = (comment.match(/[^.!?]+[.!?]*/g) || []).filter((s) => {
        return !/(инсулин|болюс|углеводн\w*\s+коэффициент)/i.test(s);
      });
      comment = sentences.map((s) => s.trim()).filter(Boolean).join(' ');
    }

    return {
      dish_name: result.dish_name || 'Распознанное блюдо',
      weight_g: Math.max(0, Math.round(Number(result.weight_g) || 0)),
      calories: Math.max(0, Math.round(Number(result.calories) || 0)),
      protein_g: Math.max(0, Math.round(Number(result.protein_g) || 0)),
      fat_g: Math.max(0, Math.round(Number(result.fat_g) || 0)),
      carbs_g: carbs,
      bread_units: calculatedXE,
      confidence: result.confidence || 'medium',
      comment: comment,
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
    const modelsToTry = ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash', 'particle-ai/particle-1:free'];
    let lastErr = null;

    for (const model of modelsToTry) {
      try {
        const response = await fetch(this.openRouterHost, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${keyToTest.trim()}`,
            'HTTP-Referer': 'https://nutritrack.app',
            'X-Title': 'NutriTrack PWA'
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: 'Say OK' }]
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
        } catch (e) {}

        if (response.status === 404 || response.status === 429) {
          lastErr = new Error(`Модель ${model}: ${msg}`);
          continue;
        }
        throw new Error('Ошибка проверки OpenRouter: ' + msg);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Ошибка проверки OpenRouter ключа.');
  }
}

window.NutriGemini = new NutriGemini();
