import { AGENT_URL } from './agentUrl';

export class LocalAgentService {
  private static _apiKey: string = '';
  private static _provider: 'gemini' | 'deepseek' | 'openclaw' = 'gemini';

  static initAgent(apiKey: string, provider: 'gemini' | 'deepseek' | 'openclaw' = 'gemini') {
    this._apiKey = apiKey;
    this._provider = provider;
  }

  static async runChat(
    text: string,
    sessionId: string,
    walletAddress?: string,
    mode: 'manual' | 'autonomous' = 'manual',
  ): Promise<{ finalText: string, pendingTx: any }> {
    if (!this._apiKey) {
      throw new Error('Agent is not initialized with an API key.');
    }

    try {
      const response = await fetch(`${AGENT_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          sessionId,
          provider: this._provider,
          apiKey: this._apiKey,
          mode,  // 'manual' = research + send_token only · 'autonomous' = full DeepBook
          // Pass the connected wallet so the agent doesn't ask the user every turn.
          ...(walletAddress ? { walletAddress } : {}),
        })
      });

      if (!response.ok) {
        // Read body to surface server-side error details
        let detail = response.statusText;
        try {
          const body = await response.json();
          detail = body.error || body.message || detail;
        } catch {}

        // Translate common errors to friendly English
        if (detail.includes('Missing') && detail.includes('apiKey')) {
          throw new Error('Missing AI API Key. Open ⚙ AI Settings or paste a key in the chat input below.');
        }
        if (detail.includes('Invalid API key') || detail.includes('API_KEY_INVALID')) {
          throw new Error('Invalid API Key. Check at Google AI Studio / DeepSeek dashboard.');
        }
        if (response.status === 429) {
          throw new Error('AI Provider rate limit. Wait 60s and retry.');
        }
        throw new Error(`Agent Error: ${detail}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      return { finalText: data.response, pendingTx: data.pendingTx };
    } catch (err: any) {
      console.error(err);
      if (err.message.includes('Failed to fetch') || err.message.includes('Load failed')) {
        throw new Error('Could not reach the Local Agent Daemon. Start the Suirobo Agent app on your computer (port 3001/3002).');
      }
      throw err;
    }
  }

  static async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${AGENT_URL}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
