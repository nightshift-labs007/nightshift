export interface TextToSpeech {
  synthesize(text: string, lang: string): Promise<{ audio: Buffer; mime: string }>;
}

/**
 * ElevenLabs text-to-speech with a multilingual model (covers English, Hindi and Spanish with one voice).
 * Confirm the endpoint, model id and output formats against current ElevenLabs docs.
 */
export class ElevenLabsTts implements TextToSpeech {
  constructor(
    private apiKey: string,
    private voiceId: string,
    private modelId = "eleven_multilingual_v2",
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async synthesize(text: string): Promise<{ audio: Buffer; mime: string }> {
    const res = await this.fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: this.modelId }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`elevenlabs: HTTP ${res.status} ${await res.text()}`);
    return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
  }
}
