export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const ALLOWED_TEXT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
] as const;

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...ALLOWED_TEXT_MIME_TYPES,
] as const;

export type AllowedAttachmentMimeType =
  (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number];

const ALLOWED_MIME_SET = new Set<string>(ALLOWED_ATTACHMENT_MIME_TYPES);
const IMAGE_MIME_SET = new Set<string>(ALLOWED_IMAGE_MIME_TYPES);

export const ATTACHMENT_FILE_ACCEPT =
  'image/jpeg,image/png,image/webp,text/plain,text/markdown,text/csv,application/json,.txt,.md,.csv,.json';

function inferTextMimeFromExtension(fileName: string): string | null {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'text/markdown';
  }
  if (lower.endsWith('.txt')) {
    return 'text/plain';
  }
  if (lower.endsWith('.csv')) {
    return 'text/csv';
  }
  if (lower.endsWith('.json')) {
    return 'application/json';
  }
  return null;
}

export function normalizeAttachmentMimeType(
  fileName: string,
  rawMimeType: string,
): string {
  const trimmed = rawMimeType.trim().toLowerCase();
  if (trimmed === 'text/x-markdown') {
    return 'text/markdown';
  }
  if (!trimmed) {
    return inferTextMimeFromExtension(fileName) ?? 'application/octet-stream';
  }
  return trimmed;
}

export interface AttachmentValidationSuccess {
  ok: true;
  normalizedMimeType: AllowedAttachmentMimeType;
}

export interface AttachmentValidationFailure {
  ok: false;
  reason: string;
}

export type AttachmentValidationResult =
  | AttachmentValidationSuccess
  | AttachmentValidationFailure;

export function validateAttachmentCandidate(input: {
  name: string;
  mimeType: string;
  size: number;
}): AttachmentValidationResult {
  if (!Number.isFinite(input.size) || input.size < 0) {
    return {
      ok: false,
      reason: `檔案「${input.name}」大小無效，無法上傳。`,
    };
  }

  if (input.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      ok: false,
      reason: `檔案「${input.name}」超過 5MB 大小限制，請壓縮後再上傳。`,
    };
  }

  const normalized = normalizeAttachmentMimeType(input.name, input.mimeType);
  if (!ALLOWED_MIME_SET.has(normalized)) {
    return {
      ok: false,
      reason: `不支援的檔案格式「${input.name}」（${normalized}），僅支援 JPG、PNG、WEBP 圖片與 TXT、MD、CSV、JSON 純文字檔。`,
    };
  }

  return {
    ok: true,
    normalizedMimeType: normalized as AllowedAttachmentMimeType,
  };
}

export function isImageMimeType(mimeType: string): boolean {
  return IMAGE_MIME_SET.has(mimeType.toLowerCase());
}
