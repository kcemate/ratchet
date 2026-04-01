import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenRouterProvider } from '../src/core/providers/openrouter.js';
import { AnthropicProvider } from '../src/core/providers/anthropic.js';
import { OpenAIProvider } from '../src/core/providers/openai.js';
import { LocalMLXProvider, LOCAL_MLX_DEFAULT_PORT } from '../src/core/providers/local.js';
import { detectProvider } from '../src/core/providers/index.js';
import { APIAgent, createAPIAgent } from '../src/core/agents/api.js';
import type { Provider } from '../src/core/providers/base.js';
import type { Target } from '../src/types.js';

// --- helpers ---

function makeTarget(overrides: Partial<Target> = {}): Target {
  return { name: 'test', path: 'src/', description: 'Test target', ...overrides };
}

function mockFetchOk(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
  });
}

function mockFetchOkAnthropic(text: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ content: [{ type: 'text', text }] }),
  });
}

function mockFetchError(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

// --- provider construction ---

describe('OpenRouterProvider', () => {
  it('constructs with an API key', () => {
    const p = new OpenRouterProvider('key-123');
    expect(p).toBeDefined();
    expect(typeof p.sendMessage).toBe('function');
  });

  it('POSTs to the OpenRouter endpoint', async () => {
    const fetchMock = mockFetchOk('hello from openrouter');
    vi.stubGlobal('fetch', fetchMock);

    const p = new OpenRouterProvider('key-123');
    const result = await p.sendMessage('test prompt');

    expect(result).toBe('hello from openrouter');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');

    vi.unstubAllGlobals();
  });

  it('sends the default model when none specified', async () => {
    const fetchMock = mockFetchOk('response');
    vi.stubGlobal('fetch', fetchMock);

    const p = new OpenRouterProvider('key-123');
    await p.sendMessage('prompt');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe('anthropic/claude-sonnet-4-6');

    vi.unstubAllGlobals();
  });

  it('uses custom model when provided', async () => {
    const fetchMock = mockFetchOk('response');
    vi.stubGlobal('fetch', fetchMock);

    const p = new OpenRouterProvider('key-123');
    await p.sendMessage('prompt', { model: 'openai/gpt-4o' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe('openai/gpt-4o');

    vi.unstubAllGlobals();
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetchError(401, 'Unauthorized'));

    const p = new OpenRouterProvider('bad-key');
    await expect(p.sendMessage('prompt')).rejects.toThrow('OpenRouter API error 401');

    vi.unstubAllGlobals();
  });
});

describe('AnthropicProvider', () => {
  it('constructs with an API key', () => {
    const p = new AnthropicProvider('key-456');
    expect(p).toBeDefined();
  });

  it('POSTs to the Anthropic endpoint', async () => {
    const fetchMock = mockFetchOkAnthropic('hello from anthropic');
    vi.stubGlobal('fetch', fetchMock);

    const p = new AnthropicProvider('key-456');
    const result = await p.sendMessage('test prompt');

    expect(result).toBe('hello from anthropic');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');

    vi.unstubAllGlobals();
  });

  it('sends the default model', async () => {
    const fetchMock = mockFetchOkAnthropic('response');
    vi.stubGlobal('fetch', fetchMock);

    const p = new AnthropicProvider('key-456');
    await p.sendMessage('prompt');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe('claude-sonnet-4-6');

    vi.unstubAllGlobals();
  });

  it('includes anthropic-version header', async () => {
    const fetchMock = mockFetchOkAnthropic('response');
    vi.stubGlobal('fetch', fetchMock);

    const p = new AnthropicProvider('key-456');
    await p.sendMessage('prompt');

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['anthropic-version']).toBe('2023-06-01');

    vi.unstubAllGlobals();
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetchError(403, 'Forbidden'));

    const p = new AnthropicProvider('bad-key');
    await expect(p.sendMessage('prompt')).rejects.toThrow('Anthropic API error 403');

    vi.unstubAllGlobals();
  });
});

describe('OpenAIProvider', () => {
  it('constructs with an API key', () => {
    const p = new OpenAIProvider('key-789');
    expect(p).toBeDefined();
  });

  it('POSTs to the OpenAI endpoint', async () => {
    const fetchMock = mockFetchOk('hello from openai');
    vi.stubGlobal('fetch', fetchMock);

    const p = new OpenAIProvider('key-789');
    const result = await p.sendMessage('test prompt');

    expect(result).toBe('hello from openai');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');

    vi.unstubAllGlobals();
  });

  it('sends the default model gpt-4.1', async () => {
    const fetchMock = mockFetchOk('response');
    vi.stubGlobal('fetch', fetchMock);

    const p = new OpenAIProvider('key-789');
    await p.sendMessage('prompt');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe('gpt-4.1');

    vi.unstubAllGlobals();
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetchError(429, 'Rate limited'));

    const p = new OpenAIProvider('key-789');
    await expect(p.sendMessage('prompt')).rejects.toThrow('OpenAI API error 429');

    vi.unstubAllGlobals();
  });
});

// --- LocalMLXProvider ---

describe('LocalMLXProvider', () => {
  it('exposes default port constant', () => {
    expect(LOCAL_MLX_DEFAULT_PORT).toBe(8899);
  });

  it('constructs with defaults', () => {
    const p = new LocalMLXProvider();
    expect(p).toBeDefined();
    expect(typeof p.sendMessage).toBe('function');
    expect(typeof p.isRunning).toBe('function');
  });

  it('constructs with custom port', () => {
    const p = new LocalMLXProvider(11434);
    expect(p).toBeDefined();
  });

  it('POSTs to localhost completions endpoint', async () => {
    const fetchMock = mockFetchOk('local response');
    vi.stubGlobal('fetch', fetchMock);

    const p = new LocalMLXProvider(8899);
    const result = await p.sendMessage('test prompt');

    expect(result).toBe('local response');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8899/v1/chat/completions');
    expect(init.method).toBe('POST');

    vi.unstubAllGlobals();
  });

  it('uses custom port in URL', async () => {
    const fetchMock = mockFetchOk('response');
    vi.stubGlobal('fetch', fetchMock);

    const p = new LocalMLXProvider(11434);
    await p.sendMessage('prompt');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');

    vi.unstubAllGlobals();
  });

  it('sends the default model path when none specified', async () => {
    const fetchMock = mockFetchOk('response');
    vi.stubGlobal('fetch', fetchMock);

    const p = new LocalMLXProvider();
    await p.sendMessage('prompt');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toContain('ratchet-fix-fused-v2');

    vi.unstubAllGlobals();
  });

  it('uses custom model when provided via options', async () => {
    const fetchMock = mockFetchOk('response');
    vi.stubGlobal('fetch', fetchMock);

    const p = new LocalMLXProvider();
    await p.sendMessage('prompt', { model: '/path/to/my-model' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe('/path/to/my-model');

    vi.unstubAllGlobals();
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetchError(500, 'Internal Server Error'));

    const p = new LocalMLXProvider();
    await expect(p.sendMessage('prompt')).rejects.toThrow('Local MLX API error 500');

    vi.unstubAllGlobals();
  });

  it('isRunning returns true when server responds ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const p = new LocalMLXProvider();
    expect(await p.isRunning()).toBe(true);

    vi.unstubAllGlobals();
  });

  it('isRunning returns false when server is not reachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const p = new LocalMLXProvider();
    expect(await p.isRunning()).toBe(false);

    vi.unstubAllGlobals();
  });

  it('isRunning returns false when server responds with error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const p = new LocalMLXProvider();
    expect(await p.isRunning()).toBe(false);

    vi.unstubAllGlobals();
  });

  it('checks models endpoint for isRunning', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const p = new LocalMLXProvider(8899);
    await p.isRunning();

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8899/v1/models');

    vi.unstubAllGlobals();
  });
});

// --- provider detection ---

describe('detectProvider', () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it('returns OpenRouterProvider when OPENROUTER_API_KEY is set', () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    const provider = detectProvider();
    expect(provider).toBeInstanceOf(OpenRouterProvider);
  });

  it('returns AnthropicProvider when only ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'ant-key';
    const provider = detectProvider();
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('returns OpenAIProvider when only OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'oai-key';
    const provider = detectProvider();
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('prefers Anthropic over OpenRouter when both are set', () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    process.env.ANTHROPIC_API_KEY = 'ant-key';
    const provider = detectProvider();
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('prefers OpenAI over OpenRouter when both are set', () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    process.env.OPENAI_API_KEY = 'oai-key';
    const provider = detectProvider();
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('prefers Anthropic over OpenAI when both are set', () => {
    process.env.ANTHROPIC_API_KEY = 'ant-key';
    process.env.OPENAI_API_KEY = 'oai-key';
    const provider = detectProvider();
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('falls back to Local when no keys are set', () => {
    const provider = detectProvider();
    expect(provider).toBeInstanceOf(LocalMLXProvider);
  });
});

// --- APIAgent ---

describe('APIAgent', () => {
  function makeProvider(response = 'provider response'): Provider {
    return {
      sendMessage: vi.fn().mockResolvedValue(response),
    };
  }

  it('constructs with a provider', () => {
    const agent = new APIAgent({ provider: makeProvider() });
    expect(typeof agent.analyze).toBe('function');
    expect(typeof agent.propose).toBe('function');
    expect(typeof agent.build).toBe('function');
  });

  it('analyze calls provider.sendMessage', async () => {
    const provider = makeProvider('analysis result');
    const agent = new APIAgent({ provider });
    const result = await agent.analyze('some context');
    expect(result).toBe('analysis result');
    expect(provider.sendMessage).toHaveBeenCalledOnce();
  });

  it('propose calls provider.sendMessage', async () => {
    const provider = makeProvider('proposal result');
    const agent = new APIAgent({ provider });
    const result = await agent.propose('analysis', makeTarget());
    expect(result).toBe('proposal result');
    expect(provider.sendMessage).toHaveBeenCalledOnce();
  });

  it('build returns success result with provider output', async () => {
    const provider = makeProvider('MODIFIED: src/foo.ts\nsome output');
    const agent = new APIAgent({ provider });
    const result = await agent.build('do something', '/tmp');
    expect(result.success).toBe(true);
    expect(result.filesModified).toEqual(['src/foo.ts']);
  });

  it('build returns failed result when provider throws', async () => {
    const provider: Provider = {
      sendMessage: vi.fn().mockRejectedValue(new Error('network error')),
    };
    const agent = new APIAgent({ provider });
    const result = await agent.build('do something', '/tmp');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network error/);
  });

  it('createAPIAgent factory returns an APIAgent', () => {
    const agent = createAPIAgent({ provider: makeProvider() });
    expect(agent).toBeInstanceOf(APIAgent);
  });
});
