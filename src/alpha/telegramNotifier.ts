type TelegramNotifyOptions = {
  disableNotification?: boolean;
};

type TelegramThrottleOptions = TelegramNotifyOptions & {
  throttleMinutes: number;
};

const throttleMemory = new Map<string, number>();

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function readTelegramConfig(): { token?: string; chatId?: string; disabled: boolean } {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const disabled = readBool(process.env.TELEGRAM_DISABLE_NOTIFICATIONS, false);
  return { token, chatId, disabled };
}

export function telegramEnabled(): boolean {
  const config = readTelegramConfig();
  return !config.disabled && Boolean(config.token) && Boolean(config.chatId);
}

export function readSkipNoticeThrottleMinutes(): number {
  const raw = process.env.ALPHA_TELEGRAM_SKIP_NOTICE_MINUTES?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return parsed;
}

export async function notifyTelegram(text: string, options: TelegramNotifyOptions = {}): Promise<boolean> {
  const { token, chatId, disabled } = readTelegramConfig();
  if (disabled || !token || !chatId) return false;

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        disable_notification: options.disableNotification ?? false,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Telegram sendMessage failed (${response.status}): ${errorText}`);
      return false;
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Telegram notify failed: ${message}`);
    return false;
  }
}

export async function notifyTelegramThrottled(
  throttleKey: string,
  text: string,
  options: TelegramThrottleOptions,
): Promise<boolean> {
  const now = Date.now();
  const previous = throttleMemory.get(throttleKey);
  const throttleMs = options.throttleMinutes * 60_000;
  if (previous !== undefined && now - previous < throttleMs) return false;
  const sent = await notifyTelegram(text, options);
  if (sent) throttleMemory.set(throttleKey, now);
  return sent;
}
