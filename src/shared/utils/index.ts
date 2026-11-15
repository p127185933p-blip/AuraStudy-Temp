export const APP_NAME = 'AuraStudy' as const;

export {
  buildIsoFromLocalDateTime,
  formatDateKey,
  formatDayHeaderParts,
  formatRangeTitle,
  getBrowserTimeZone,
  getDateKeyFromInstant,
  getDayOfWeekFromDateKey,
  getLocalTimeHHmm,
  getMinutesFromMidnight,
  getMonthGridDateKeys,
  getWeekDateKeys,
  minutesToHHmm,
  parseDateKey,
  shiftDateKey,
  shiftMonthDateKey,
  type ParsedDateKey,
} from './dateTime';
export {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_TEXT_MIME_TYPES,
  ATTACHMENT_FILE_ACCEPT,
  MAX_ATTACHMENT_SIZE_BYTES,
  isImageMimeType,
  normalizeAttachmentMimeType,
  validateAttachmentCandidate,
  type AllowedAttachmentMimeType,
  type AttachmentValidationFailure,
  type AttachmentValidationResult,
  type AttachmentValidationSuccess,
} from './attachments';
export {
  THEME_COLOR_BY_MODE,
  THEME_STORAGE_KEY,
  applyTheme,
  getStoredTheme,
  initializeTheme,
  setStoredTheme,
  type ThemeMode,
} from './theme';
export {
  TAG_COLOR_PRESETS,
  getTagColorMeta,
  type TagColorMeta,
} from './tagColors';

