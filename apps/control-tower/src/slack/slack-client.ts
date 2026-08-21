/**
 * Slack Web API client (network I/O — excluded from unit coverage, same
 * rationale as the Prisma repositories and server bootstrap: the value is
 * the real HTTP call, which a dependency-free unit test cannot exercise).
 * The pure pieces it carries messages for — block builders, signature
 * verification, interaction parsing — are all fully covered elsewhere.
 *
 * Two implementations behind one interface:
 *   • RealSlackClient — posts to https://slack.com/api via fetch, used when
 *     SLACK_BOT_TOKEN is configured.
 *   • NoopSlackClient — does nothing, used when Slack isn't configured, so
 *     the UI-only demo runs identically without a Slack app.
 */
import type { SlackBlock } from "./blocks.js";

export interface PostMessageInput {
  channel: string;
  text: string;
  blocks?: SlackBlock[] | undefined;
  threadTs?: string | undefined;
}

export interface PostMessageResult {
  ok: boolean;
  ts?: string | undefined;
  channel?: string | undefined;
  error?: string | undefined;
}

export interface UpdateMessageInput {
  channel: string;
  ts: string;
  text: string;
  blocks?: SlackBlock[] | undefined;
}

export interface SlackClient {
  readonly enabled: boolean;
  postMessage(input: PostMessageInput): Promise<PostMessageResult>;
  updateMessage(input: UpdateMessageInput): Promise<PostMessageResult>;
}

/** Used when Slack isn't configured — every call is a successful no-op. */
export class NoopSlackClient implements SlackClient {
  readonly enabled = false;
  async postMessage(): Promise<PostMessageResult> {
    return { ok: true };
  }
  async updateMessage(): Promise<PostMessageResult> {
    return { ok: true };
  }
}

const SLACK_API = "https://slack.com/api";

export class RealSlackClient implements SlackClient {
  readonly enabled = true;
  constructor(private readonly botToken: string) {}

  private async call(method: string, body: Record<string, unknown>): Promise<PostMessageResult> {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; ts?: string; channel?: string; error?: string };
    if (!json.ok) {
      throw new Error(`Slack ${method} failed: ${json.error ?? `HTTP ${res.status}`}`);
    }
    return { ok: json.ok, ts: json.ts, channel: json.channel, error: json.error };
  }

  postMessage(input: PostMessageInput): Promise<PostMessageResult> {
    return this.call("chat.postMessage", {
      channel: input.channel,
      text: input.text,
      blocks: input.blocks,
      thread_ts: input.threadTs,
    });
  }

  updateMessage(input: UpdateMessageInput): Promise<PostMessageResult> {
    return this.call("chat.update", {
      channel: input.channel,
      ts: input.ts,
      text: input.text,
      blocks: input.blocks,
    });
  }
}

/** Picks the real client when a bot token is present, else the no-op. */
export function createSlackClient(botToken: string | undefined): SlackClient {
  return botToken ? new RealSlackClient(botToken) : new NoopSlackClient();
}
