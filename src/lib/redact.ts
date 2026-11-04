/**
 * Secret & PII guardrail. Runs server-side on every user message BEFORE
 * it is persisted or sent to the LLM provider.
 */

type Rule = {
  type: string;
  pattern: RegExp;
  /** Return the replacement; returning the original match means "not a hit". */
  replace?: (match: string, ...groups: string[]) => string;
};

const tag = (type: string) => `[REDACTED:${type}]`;

function luhnValid(digits: string) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const RULES: Rule[] = [
  { type: 'PRIVATE_KEY', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { type: 'TOKEN', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g }, // JWT
  {
    type: 'TOKEN',
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
    replace: (_m, scheme) => `${scheme} ${tag('TOKEN')}`,
  },
  { type: 'CLOUD_KEY', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g }, // AWS access key id
  {
    type: 'API_KEY',
    pattern:
      /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|ATATT[A-Za-z0-9_\-=]{20,}|glpat-[A-Za-z0-9_-]{20,})\b/g,
  },
  {
    // scheme://user:password@host
    type: 'CREDENTIAL',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^:/\s@]+):([^@\s]+)@/gi,
    replace: (_m, scheme, user) => `${scheme}${user}:${tag('CREDENTIAL')}@`,
  },
  {
    // Azure / .NET connection strings
    type: 'CREDENTIAL',
    pattern: /\b(AccountKey|SharedAccessKey|SharedAccessSignature|Password|Pwd)=([^;\s]+)/gi,
    replace: (_m, key) => `${key}=${tag('CREDENTIAL')}`,
  },
  {
    // "password is hunter2", "pwd: x", "passcode = 1234"
    type: 'CREDENTIAL',
    pattern: /\b(password|passwd|pwd|passcode|pin)(\s*(?:is|=|:|was)\s*)(["'`]?)([^\s"'`,;]{3,})\3/gi,
    replace: (_m, key, sep) => `${key}${sep}${tag('CREDENTIAL')}`,
  },
  {
    // "api_key=...", "client_secret: ...", "token=..."
    type: 'CREDENTIAL',
    pattern:
      /\b(api[_-]?key|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|token)(\s*[=:]\s*)(["'`]?)([^\s"'`,;]{8,})\3/gi,
    replace: (_m, key, sep) => `${key}${sep}${tag('CREDENTIAL')}`,
  },
  {
    // Payment card numbers (Luhn-checked to avoid redacting phone numbers etc.)
    type: 'CARD_NUMBER',
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    replace: (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? tag('CARD_NUMBER') : m;
    },
  },
  {
    // South African ID (13 digits, YYMMDD…) — common in Cassava HR/fintech contexts
    type: 'NATIONAL_ID',
    pattern: /\b\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{4}[01]\d{2}\b/g,
    replace: (m) => (luhnValid(m) ? tag('NATIONAL_ID') : m),
  },
];

export type RedactionResult = { text: string; count: number; types: string[] };

export function redact(input: string): RedactionResult {
  let text = input;
  let count = 0;
  const types = new Set<string>();

  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      const groups = rest.filter((r): r is string => typeof r === 'string');
      const out = rule.replace ? rule.replace(match, ...groups) : tag(rule.type);
      if (out !== match) {
        count++;
        types.add(rule.type);
      }
      return out;
    });
  }
  return { text, count, types: [...types] };
}

type PartLike = { type: string; text?: string };
type MessageLike = { role: string; parts: PartLike[] };

/** Redact every user text part of an AI SDK UIMessage list. */
export function redactMessages<M extends MessageLike>(messages: M[]): { messages: M[]; lastCount: number } {
  let lastCount = 0;
  const out = messages.map((m, idx) => {
    if (m.role !== 'user') return m;
    let msgCount = 0;
    const parts = m.parts.map((p) => {
      if (p.type !== 'text' || typeof p.text !== 'string') return p;
      const r = redact(p.text);
      msgCount += r.count;
      return { ...p, text: r.text };
    });
    if (idx === messages.length - 1) lastCount = msgCount;
    return { ...m, parts } as M;
  });
  return { messages: out, lastCount };
}
