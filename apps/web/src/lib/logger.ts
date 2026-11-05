const REDACTED_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{8,}/g,
  /mk-[a-zA-Z0-9_-]{8,}/g,
  /tvly-[a-zA-Z0-9_-]{8,}/g,
  /api_token=[^&\s]+/gi,
];

export function redactString(input: string): string {
  let result = input;
  for (const pattern of REDACTED_PATTERNS) {
    result = result.replace(pattern, "[REDACTED_KEY]");
  }
  return result;
}

const SECRET_KEY_NAMES = new Set([
  "secret",
  "secretkey",
  "secret_key",
  "apikey",
  "api_key",
  "sk",
  "mk",
  "authorization",
  "password",
  "privatekey",
  "private_key",
  "userkeys",
  "decrypteduserskkey",
]);

export function sanitizeMeta(
  meta?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    const lower = k.toLowerCase();
    if (SECRET_KEY_NAMES.has(lower)) {
      clean[k] = "[REDACTED_KEY]";
    } else if (typeof v === "string") {
      clean[k] = redactString(v);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

function formatTimestamp(): string {
  const d = new Date();
  const pad = (n: number, z = 2) => String(n).padStart(z, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function formatErrorDetail(err: unknown): string[] {
  if (!err) return [];
  const lines: string[] = [];

  if (typeof err === "string") {
    const trimmed = err.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const pathStr =
              Array.isArray(item.path) && item.path.length > 0
                ? item.path.join(".")
                : item.path ?? "root";
            const receivedStr =
              item.received !== undefined ? ` (received: "${item.received}")` : "";
            const expectedStr = item.options
              ? ` [expected: ${item.options.join(" | ")}]`
              : "";
            lines.push(
              `  └─ [Validation Error] ${pathStr}: ${item.message}${receivedStr}${expectedStr}`
            );
          }
          return lines;
        } else if (typeof parsed === "object" && parsed !== null) {
          if (parsed.message) {
            lines.push(`  └─ [Error] ${parsed.message}`);
          }
        }
      } catch {
        // Not JSON
      }
    }
    for (const line of redactString(err).split("\n")) {
      if (line.trim()) lines.push(`  └─ ${line}`);
    }
    return lines;
  }

  if (err instanceof Error) {
    lines.push(`  └─ [Error] ${redactString(err.message)}`);
    if (err.stack) {
      const stackLines = err.stack.split("\n").slice(1, 4);
      for (const s of stackLines) {
        if (s.trim()) lines.push(`     ${s.trim()}`);
      }
    }
    return lines;
  }

  if (Array.isArray(err)) {
    for (const item of err) {
      if (
        typeof item === "object" &&
        item !== null &&
        "message" in item &&
        "path" in item
      ) {
        const pathStr =
          Array.isArray(item.path) && item.path.length > 0
            ? item.path.join(".")
            : item.path ?? "root";
        const receivedStr =
          item.received !== undefined ? ` (received: "${item.received}")` : "";
        const expectedStr = item.options
          ? ` [expected: ${item.options.join(" | ")}]`
          : "";
        lines.push(
          `  └─ [Validation Error] ${pathStr}: ${item.message}${receivedStr}${expectedStr}`
        );
      } else {
        lines.push(...formatErrorDetail(item));
      }
    }
    return lines;
  }

  lines.push(`  └─ ${redactString(JSON.stringify(err))}`);
  return lines;
}

export function formatLogLine(
  level: "INFO" | "WARN" | "ERROR",
  event: string,
  meta?: Record<string, unknown>
): string {
  const ts = formatTimestamp();
  const cleanEvent = redactString(event);
  const cleanMeta = sanitizeMeta(meta) ?? {};

  const scalarParts: string[] = [];
  const complexParts: string[] = [];
  const errorLines: string[] = [];

  for (const [k, v] of Object.entries(cleanMeta)) {
    if (k === "error" || k === "err" || k === "issues") {
      errorLines.push(...formatErrorDetail(v));
    } else if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      v === null ||
      v === undefined
    ) {
      if (!cleanEvent.includes(`${k}=`)) {
        scalarParts.push(`${k}=${v}`);
      }
    } else {
      complexParts.push(
        `  • ${k}: ${JSON.stringify(v, null, 2).replace(/\n/g, "\n    ")}`
      );
    }
  }

  let head = `[${ts}] [${level}] ${cleanEvent}`;
  if (scalarParts.length > 0) {
    head += ` | ${scalarParts.join(" | ")}`;
  }

  const allLines = [head, ...errorLines, ...complexParts];
  return allLines.join("\n");
}

export const logger = {
  info(event: string, meta?: Record<string, unknown>) {
    console.log(formatLogLine("INFO", event, meta));
  },
  warn(event: string, meta?: Record<string, unknown>) {
    console.warn(formatLogLine("WARN", event, meta));
  },
  error(event: string, meta?: Record<string, unknown>) {
    console.error(formatLogLine("ERROR", event, meta));
  },
};
