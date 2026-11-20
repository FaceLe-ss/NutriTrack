/**
 * Cloudflare Worker Proxy for Google Gemini API
 * 
 * Инструкция по созданию бесплатного прокси за 1 минуту:
 * 1. Зайдите на https://dash.cloudflare.com/ (бесплатная регистрация).
 * 2. Перейдите в раздел "Workers & Pages" -> "Create Worker".
 * 3. Назовите воркер (например: "gemini-proxy") и нажмите "Deploy".
 * 4. Нажмите "Edit code", сотрите всё и вставьте код ниже. Нажмите "Deploy".
 * 5. Скопируйте полученный адрес (например: https://gemini-proxy.username.workers.dev).
 * 6. Вставьте этот адрес в настройки NutriTrack в поле "Прокси URL".
 * 
 * Теперь Gemini работает БЕЗ VPN из любой точки мира!
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-goog-api-client, x-goog-api-key',
        },
      });
    }

    const url = new URL(request.url);
    url.hostname = 'generativelanguage.googleapis.com';

    // Clone request with new target
    const modifiedRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow',
    });

    const response = await fetch(modifiedRequest);

    // Re-attach CORS headers for browser
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, x-goog-api-client, x-goog-api-key');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
