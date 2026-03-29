// Test: call fetchWithProxy directly from web-search.ts
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as https from 'https';
import * as http from 'http';

// Replicate exactly what web-search.ts does
function getProxyUrl(): string | undefined {
  return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
}

function fetchWithProxy(urlStr: string, timeout: number): Promise<{ ok: boolean; status: number; body: string }> {
  return new Promise((resolve) => {
    const isHttps = urlStr.startsWith('https://');
    const url = new URL(urlStr);
    const proxyUrl = getProxyUrl();
    const agent = proxyUrl
      ? new HttpsProxyAgent(proxyUrl)
      : isHttps
        ? https.globalAgent
        : http.globalAgent;

    console.log('[fetchWithProxy] proxyUrl:', proxyUrl, 'agent type:', typeof agent);

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      agent,
      timeout,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; content-center/1.0)', 'Accept': 'text/html' },
    };

    console.log('[fetchWithProxy] making request to:', options.hostname, 'port:', options.port);

    const req = (isHttps ? https : http).request(options, (res) => {
      console.log('[fetchWithProxy] got response status:', res.statusCode);
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', (err) => {
      console.error('[fetchWithProxy] error:', err.message);
      resolve({ ok: false, status: 0, body: '' });
    });
    req.on('timeout', () => {
      console.error('[fetchWithProxy] timeout! destroying');
      req.destroy();
      resolve({ ok: false, status: 0, body: '' });
    });
  });
}

async function main() {
  process.env.HTTPS_PROXY = 'http://127.0.0.1:7897';
  process.env.HTTP_PROXY = 'http://127.0.0.1:7897';
  console.log('[main] proxyUrl from getProxyUrl():', getProxyUrl());

  const result = await fetchWithProxy('https://html.duckduckgo.com/html/?q=test', 15000);
  console.log('[main] result:', result.ok, result.status, result.body.length);
}

main().catch(console.error);
