import type { ItemAttachment } from '@/domain/schedule';
import {
  ITEM_ATTACHMENT_MAX_BYTES,
  ITEM_ATTACHMENT_MAX_COUNT,
} from '@/shared/schemas';

export const ITEM_ATTACHMENT_ACCEPT =
  '.png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.docx,.xlsx,image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MAX_IMAGE_DIMENSION = 1280;

const ALLOWED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

const ALLOWED_DOC_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function inferMimeFromExtension(fileName: string): string | null {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return null;
}

export function resolveItemAttachmentMime(file: {
  name: string;
  type: string;
}): string {
  const trimmed = file.type.trim().toLowerCase();
  if (trimmed === 'text/x-markdown') return 'text/markdown';
  if (trimmed === 'image/jpg') return 'image/jpeg';
  if (ALLOWED_IMAGE_MIMES.has(trimmed) || ALLOWED_DOC_MIMES.has(trimmed)) {
    return trimmed;
  }
  return inferMimeFromExtension(file.name) ?? (trimmed || 'application/octet-stream');
}

export function isItemAttachmentImage(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIMES.has(mimeType.toLowerCase());
}

export function isSupportedItemAttachmentMime(mimeType: string): boolean {
  const lower = mimeType.toLowerCase();
  return ALLOWED_IMAGE_MIMES.has(lower) || ALLOWED_DOC_MIMES.has(lower);
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('無法讀取檔案內容'));
      }
    };
    reader.onerror = () => reject(new Error('讀取檔案失敗'));
    reader.readAsDataURL(file);
  });
}

function estimateDataUrlByteSize(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return dataUrl.length;
  const base64 = dataUrl.slice(commaIdx + 1);
  return Math.max(0, Math.floor((base64.length * 3) / 4));
}

async function compressImageDataUrl(
  rawDataUrl: string,
  originalMime: string,
  originalSize: number,
): Promise<{ dataUrl: string; mimeType: string; size: number }> {
  if (
    typeof document === 'undefined' ||
    typeof Image === 'undefined' ||
    (typeof navigator !== 'undefined' &&
      navigator.userAgent.toLowerCase().includes('jsdom'))
  ) {
    return { dataUrl: rawDataUrl, mimeType: originalMime, size: originalSize };
  }

  try {
    const loadedImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const timer = globalThis.setTimeout(() => {
        reject(new Error('圖片解碼逾時'));
      }, 2000);
      img.onload = () => {
        globalThis.clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        globalThis.clearTimeout(timer);
        reject(new Error('圖片解碼失敗'));
      };
      img.src = rawDataUrl;
    });

    const width = loadedImage.naturalWidth || loadedImage.width;
    const height = loadedImage.naturalHeight || loadedImage.height;
    if (!width || !height) {
      return { dataUrl: rawDataUrl, mimeType: originalMime, size: originalSize };
    }

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { dataUrl: rawDataUrl, mimeType: originalMime, size: originalSize };
    }

    ctx.drawImage(loadedImage, 0, 0, targetWidth, targetHeight);
    let compressedUrl = canvas.toDataURL('image/webp', 0.82);
    let outputMime = 'image/webp';
    if (!compressedUrl.startsWith('data:image/webp')) {
      compressedUrl = canvas.toDataURL('image/jpeg', 0.82);
      outputMime = 'image/jpeg';
    }

    const compressedSize = estimateDataUrlByteSize(compressedUrl);
    if (compressedSize > 0 && (compressedSize < originalSize || scale < 1)) {
      return {
        dataUrl: compressedUrl,
        mimeType: outputMime,
        size: compressedSize,
      };
    }
    return { dataUrl: rawDataUrl, mimeType: originalMime, size: originalSize };
  } catch {
    return { dataUrl: rawDataUrl, mimeType: originalMime, size: originalSize };
  }
}

export async function processItemAttachmentFiles(
  files: FileList | readonly File[],
  existingCount: number,
): Promise<{
  added: ItemAttachment[];
  errors: string[];
}> {
  const fileArray = Array.from(files);
  const added: ItemAttachment[] = [];
  const errors: string[] = [];

  for (const file of fileArray) {
    if (existingCount + added.length >= ITEM_ATTACHMENT_MAX_COUNT) {
      errors.push(`每筆行程最多只能附加 ${ITEM_ATTACHMENT_MAX_COUNT} 個檔案`);
      break;
    }

    if (file.size > ITEM_ATTACHMENT_MAX_BYTES) {
      errors.push(`「${file.name}」超過 3MB 上限，請壓縮或縮小後再上傳`);
      continue;
    }

    const mimeType = resolveItemAttachmentMime(file);
    if (!isSupportedItemAttachmentMime(mimeType)) {
      errors.push(
        `不支援的檔案格式「${file.name}」，僅支援 PNG/JPG/WebP 圖片與 PDF/TXT/MD/DOCX/XLSX 文件`,
      );
      continue;
    }

    try {
      const rawDataUrl = await readFileAsDataUrl(file);
      const processed = isItemAttachmentImage(mimeType)
        ? await compressImageDataUrl(rawDataUrl, mimeType, file.size)
        : { dataUrl: rawDataUrl, mimeType, size: file.size };

      if (processed.size > ITEM_ATTACHMENT_MAX_BYTES) {
        errors.push(`「${file.name}」處理後仍超過 3MB 上限，無法附加`);
        continue;
      }

      const id =
        typeof globalThis.crypto?.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      added.push({
        id,
        name: file.name,
        mimeType: processed.mimeType,
        size: processed.size,
        dataUrl: processed.dataUrl,
        createdAt: new Date().toISOString(),
      });
    } catch {
      errors.push(`讀取檔案「${file.name}」失敗`);
    }
  }

  return { added, errors };
}

export function triggerAttachmentDownload(attachment: ItemAttachment): void {
  if (typeof document === 'undefined') return;
  const anchor = document.createElement('a');
  anchor.href = attachment.dataUrl;
  anchor.download = attachment.name;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
