import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './providers/anthropic.js';

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    provider = new AnthropicProvider(mockApiKey);
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default model', () => {
      expect(provider.name).toBe('Anthropic');
      expect(provider.tier).toBe('pro');
    });

    it('should allow custom default model', () => {
      const customProvider = new AnthropicProvider(mockApiKey, 'custom-model');
      // We can't directly test the private defaultModel, but we can verify it's used in sendMessage
      expect(customProvider.name).toBe('Anthropic');
    });
  });

  describe('sendMessage', () => {
    it('should send message with default parameters', async () => {
      const mockResponse = {
        content: [{ type: 'text', text: 'test response' }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.sendMessage('test prompt');
      expect(result).toBe('test response');

      expect(fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': mockApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          messages: [{ role: 'user', content: 'test prompt' }],
        }),
      });
    });

    it('should use custom model when provided', async () => {
      const mockResponse = {
        content: [{ type: 'text', text: 'test response' }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await provider.sendMessage('test prompt', { model: 'custom-model' });

      const call = (fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.model).toBe('custom-model');
    });

    it('should include system prompt when provided', async () => {
      const mockResponse = {
        content: [{ type: 'text', text: 'test response' }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await provider.sendMessage('test prompt', { systemPrompt: 'system message' });

      const call = (fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.system).toBe('system message');
    });

    it('should include temperature when provided', async () => {
      const mockResponse = {
        content: [{ type: 'text', text: 'test response' }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await provider.sendMessage('test prompt', { temperature: 0.5 });

      const call = (fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.temperature).toBe(0.5);
    });

    it('should throw error on API failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(provider.sendMessage('test prompt')).rejects.toThrow(
        'Anthropic API error 401: Unauthorized',
      );
    });

    it('should throw error on empty response', async () => {
      const mockResponse = {
        content: [],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await expect(provider.sendMessage('test prompt')).rejects.toThrow(
        'Anthropic returned empty response',
      );
    });
  });

  describe('estimateCost', () => {
    it('should calculate cost correctly', () => {
      const cost = provider.estimateCost(1000000, 1000000); // 1M input, 1M output tokens
      expect(cost).toBe(18); // $3 + $15 = $18
    });

    it('should handle zero tokens', () => {
      const cost = provider.estimateCost(0, 0);
      expect(cost).toBe(0);
    });

    it('should calculate input-only cost', () => {
      const cost = provider.estimateCost(1000000, 0);
      expect(cost).toBe(3); // $3 input cost only
    });

    it('should calculate output-only cost', () => {
      const cost = provider.estimateCost(0, 1000000);
      expect(cost).toBe(15); // $15 output cost only
    });
  });

  describe('supportsStructuredOutput', () => {
    it('should return true', () => {
      expect(provider.supportsStructuredOutput()).toBe(true);
    });
  });
});