import { doc, onSnapshot, setDoc, Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import { PublicSchoolBranding, SchoolSetting } from '../types';
import { INITIAL_SCHOOL_SETTINGS } from '../data/sampleData';
import { extractFriendlyError } from './schoolService';

export const MAX_RAW_LOGO_FILE_BYTES = 5 * 1024 * 1024; // 5 MB raw file cap before canvas compression
export const MAX_LOGO_DIMENSION = 400; // Max 400x400 px
export const MAX_LOGO_DATA_URL_BYTES = 300 * 1024; // Strictly under 300 KB
export const ALLOWED_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const ALLOWED_LOGO_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

export interface LogoValidationResult {
  valid: boolean;
  error?: string;
  extension?: string;
  normalizedMime?: string;
}

export interface ProcessedLogoResult {
  dataUrl: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  mimeType: 'image/png' | 'image/jpeg';
  hasTransparency: boolean;
  byteLength: number;
  sizeLabel: string;
}

export interface PdfLogoAsset {
  dataUrl: string;
  format: 'PNG' | 'JPEG';
  width: number;
  height: number;
}

const pdfImageCache = new Map<string, PdfLogoAsset | null>();

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  Object.keys(obj).forEach((key) => {
    if (obj[key] !== undefined) {
      cleaned[key] = obj[key];
    }
  });
  return cleaned;
}

export function formatBytesLabel(bytes: number): string {
  const kb = bytes / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(kb))} KB`;
}

export function validateLogoFile(file: File | null | undefined): LogoValidationResult {
  if (!file) {
    return { valid: false, error: 'Please select an image file.' };
  }

  const nameParts = file.name.toLowerCase().split('.');
  const ext = nameParts.length > 1 ? nameParts.pop() || '' : '';
  const mime = (file.type || '').toLowerCase();

  const isAllowedMime = (ALLOWED_LOGO_MIME_TYPES as readonly string[]).includes(mime);
  const isAllowedExt = (ALLOWED_LOGO_EXTENSIONS as readonly string[]).includes(ext);

  if (!isAllowedMime && !isAllowedExt) {
    return {
      valid: false,
      error: 'Unsupported file format. Please choose a PNG, JPG, JPEG, or WEBP logo image.',
    };
  }

  if (file.size <= 0) {
    return { valid: false, error: 'The selected image file is empty.' };
  }

  if (file.size > MAX_RAW_LOGO_FILE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `Selected image (${sizeMb} MB) exceeds the 5 MB input limit. Please choose a smaller file.`,
    };
  }

  const normalizedMime = isAllowedMime
    ? mime
    : ext === 'png'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : 'image/jpeg';

  const safeExt =
    ext && isAllowedExt
      ? ext
      : normalizedMime === 'image/png'
        ? 'png'
        : normalizedMime === 'image/webp'
          ? 'webp'
          : 'jpg';

  return {
    valid: true,
    extension: safeExt,
    normalizedMime,
  };
}

function loadFileAsHtmlImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Selected file could not be decoded as a valid image.'));
    };
    img.src = objectUrl;
  });
}

function canvasHasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const imageData = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < imageData.length; i += 4) {
    if (imageData[i] < 252) {
      return true;
    }
  }
  return false;
}

/**
 * Resizes the selected logo image on an HTML canvas to max 400x400 px (preserving aspect ratio),
 * inspects transparency (keeps PNG if transparent, otherwise JPEG at 0.8 quality),
 * and ensures the resulting base64 data URL is strictly under 300 KB.
 */
export async function processLogoImageToDataUrl(file: File): Promise<ProcessedLogoResult> {
  const validation = validateLogoFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const img = await loadFileAsHtmlImage(file);
  const originalWidth = Math.max(1, img.naturalWidth || 1);
  const originalHeight = Math.max(1, img.naturalHeight || 1);

  const renderAtMaxDim = (maxDim: number) => {
    const scale = Math.min(1, maxDim / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser canvas 2D context is unavailable.');
    }
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    return { canvas, ctx, width, height };
  };

  const initial = renderAtMaxDim(MAX_LOGO_DIMENSION);
  const hasTransparency = canvasHasTransparency(initial.ctx, initial.width, initial.height);

  if (hasTransparency) {
    const dimSteps = [400, 340, 280, 220, 180, 140];
    for (let i = 0; i < dimSteps.length; i++) {
      const attempt = i === 0 ? initial : renderAtMaxDim(dimSteps[i]);
      const dataUrl = attempt.canvas.toDataURL('image/png');
      const byteLength = dataUrl.length;
      if (byteLength < MAX_LOGO_DATA_URL_BYTES) {
        return {
          dataUrl,
          width: attempt.width,
          height: attempt.height,
          originalWidth,
          originalHeight,
          mimeType: 'image/png',
          hasTransparency: true,
          byteLength,
          sizeLabel: formatBytesLabel(byteLength),
        };
      }
    }
    throw new Error(
      'This transparent PNG logo remains over 300 KB even after resizing below 400×400 px. Please simplify or optimize the PNG and try again.'
    );
  }

  // Non-transparent image -> JPEG at 0.8 quality (with fallback steps only if somehow > 300 KB)
  const jpegAttempts: Array<{ maxDim: number; quality: number }> = [
    { maxDim: 400, quality: 0.8 },
    { maxDim: 400, quality: 0.7 },
    { maxDim: 320, quality: 0.72 },
    { maxDim: 256, quality: 0.68 },
  ];

  for (let i = 0; i < jpegAttempts.length; i++) {
    const { maxDim, quality } = jpegAttempts[i];
    const attempt = maxDim === 400 ? initial : renderAtMaxDim(maxDim);
    // Paint white backdrop before JPEG encoding in case edge pixels have subtle rounding
    const jpegCanvas = document.createElement('canvas');
    jpegCanvas.width = attempt.width;
    jpegCanvas.height = attempt.height;
    const jCtx = jpegCanvas.getContext('2d');
    if (!jCtx) {
      throw new Error('Browser canvas 2D context is unavailable.');
    }
    jCtx.fillStyle = '#ffffff';
    jCtx.fillRect(0, 0, attempt.width, attempt.height);
    jCtx.drawImage(attempt.canvas, 0, 0);

    const dataUrl = jpegCanvas.toDataURL('image/jpeg', quality);
    const byteLength = dataUrl.length;
    if (byteLength < MAX_LOGO_DATA_URL_BYTES) {
      return {
        dataUrl,
        width: attempt.width,
        height: attempt.height,
        originalWidth,
        originalHeight,
        mimeType: 'image/jpeg',
        hasTransparency: false,
        byteLength,
        sizeLabel: formatBytesLabel(byteLength),
      };
    }
  }

  throw new Error('Compressed logo still exceeds the 300 KB limit. Please choose a simpler image.');
}

/**
 * Resizes an uploaded signature image cleanly into a compact base64 data URL (<= 150 KB)
 * suitable for storing on SchoolSetting / StudentResultReview in Firestore and embedding on PDFs.
 */
export async function processSignatureImageToDataUrl(file: File): Promise<ProcessedLogoResult> {
  const validation = validateLogoFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const img = await loadFileAsHtmlImage(file);
  const originalWidth = Math.max(1, img.naturalWidth || 1);
  const originalHeight = Math.max(1, img.naturalHeight || 1);

  const renderAtMaxBox = (maxW: number, maxH: number) => {
    const scale = Math.min(1, maxW / originalWidth, maxH / originalHeight);
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser canvas 2D context is unavailable.');
    }
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    return { canvas, ctx, width, height };
  };

  const MAX_SIG_BYTES = 150 * 1024;
  const initial = renderAtMaxBox(320, 120);
  const hasTransparency = canvasHasTransparency(initial.ctx, initial.width, initial.height);

  if (hasTransparency) {
    const steps: Array<[number, number]> = [
      [320, 120],
      [260, 100],
      [200, 80],
      [160, 64],
    ];
    for (let i = 0; i < steps.length; i++) {
      const attempt = i === 0 ? initial : renderAtMaxBox(steps[i][0], steps[i][1]);
      const dataUrl = attempt.canvas.toDataURL('image/png');
      if (dataUrl.length <= MAX_SIG_BYTES) {
        return {
          dataUrl,
          width: attempt.width,
          height: attempt.height,
          originalWidth,
          originalHeight,
          mimeType: 'image/png',
          hasTransparency: true,
          byteLength: dataUrl.length,
          sizeLabel: formatBytesLabel(dataUrl.length),
        };
      }
    }
  }

  const jpegAttempts: Array<{ w: number; h: number; q: number }> = [
    { w: 320, h: 120, q: 0.78 },
    { w: 260, h: 100, q: 0.7 },
    { w: 200, h: 80, q: 0.62 },
  ];

  for (const { w, h, q } of jpegAttempts) {
    const attempt = renderAtMaxBox(w, h);
    const jpegCanvas = document.createElement('canvas');
    jpegCanvas.width = attempt.width;
    jpegCanvas.height = attempt.height;
    const jCtx = jpegCanvas.getContext('2d');
    if (!jCtx) {
      throw new Error('Browser canvas 2D context is unavailable.');
    }
    jCtx.fillStyle = '#ffffff';
    jCtx.fillRect(0, 0, attempt.width, attempt.height);
    jCtx.drawImage(attempt.canvas, 0, 0);

    const dataUrl = jpegCanvas.toDataURL('image/jpeg', q);
    if (dataUrl.length <= MAX_SIG_BYTES) {
      return {
        dataUrl,
        width: attempt.width,
        height: attempt.height,
        originalWidth,
        originalHeight,
        mimeType: 'image/jpeg',
        hasTransparency: false,
        byteLength: dataUrl.length,
        sizeLabel: formatBytesLabel(dataUrl.length),
      };
    }
  }

  throw new Error('Signature image exceeds compact 150 KB size limit. Please choose a simpler signature image.');
}

export function buildPublicBrandingPayload(settings: SchoolSetting): PublicSchoolBranding {
  return stripUndefined({
    schoolName: (settings.schoolName || INITIAL_SCHOOL_SETTINGS.schoolName).trim().slice(0, 150),
    motto: (settings.motto || '').trim().slice(0, 200),
    logoDataUrl: (settings.logoDataUrl || '').trim().slice(0, 350000),
    website: (settings.website || '').trim().slice(0, 128),
    updatedAt: new Date().toISOString(),
  }) as unknown as PublicSchoolBranding;
}

export function buildFullSchoolSettingsPayload(settings: SchoolSetting): Record<string, unknown> {
  const now = new Date().toISOString();
  const merged: SchoolSetting = {
    ...INITIAL_SCHOOL_SETTINGS,
    ...settings,
  };

  return stripUndefined({
    schoolName: (merged.schoolName || INITIAL_SCHOOL_SETTINGS.schoolName).trim().slice(0, 150),
    schoolTagline: (merged.schoolTagline || '').trim().slice(0, 200),
    motto: (merged.motto || '').trim().slice(0, 200),
    address: (merged.address || '').trim().slice(0, 250),
    state: (merged.state || '').trim().slice(0, 80),
    phone: (merged.phone || '').trim().slice(0, 80),
    email: (merged.email || '').trim().slice(0, 128),
    website: (merged.website || '').trim().slice(0, 128),
    currentTerm: merged.currentTerm || INITIAL_SCHOOL_SETTINGS.currentTerm,
    currentSession: (merged.currentSession || INITIAL_SCHOOL_SETTINGS.currentSession)
      .trim()
      .slice(0, 40),
    termBegins: (merged.termBegins || '').trim().slice(0, 20),
    termEnds: (merged.termEnds || '').trim().slice(0, 20),
    nextTermResumption: (merged.nextTermResumption || '').trim().slice(0, 20),
    currency: (merged.currency || 'NGN').trim().slice(0, 10),
    currencySymbol: (merged.currencySymbol || '₦').trim().slice(0, 5),
    directorName: (merged.directorName || '').trim().slice(0, 120),
    principalName: (merged.principalName || '').trim().slice(0, 120),
    headTeacherTitle: merged.headTeacherTitle === 'Headmistress' ? 'Headmistress' : 'Headmaster',
    headTeacherName: (merged.headTeacherName || '').trim().slice(0, 120),
    headTeacherSignature: (merged.headTeacherSignature || '').trim().slice(0, 350000),
    principalSignature: (merged.principalSignature || '').trim().slice(0, 350000),
    enableTeacherComment: merged.enableTeacherComment !== false,
    enableHeadComment: merged.enableHeadComment !== false,
    enablePrincipalComment: merged.enablePrincipalComment !== false,
    requireFullFeesBeforePublishReport: Boolean(merged.requireFullFeesBeforePublishReport),
    logoDataUrl: (merged.logoDataUrl || '').trim().slice(0, 350000),
    logoUpdatedAt: (merged.logoUpdatedAt || '').trim().slice(0, 50),
    logoUpdatedBy: (merged.logoUpdatedBy || '').trim().slice(0, 120),
    updatedAt: now,
  });
}

export function subscribePublicBranding(
  onData: (branding: PublicSchoolBranding | null) => void,
  onError?: (msg: string) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'branding', 'school'),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(snap.data() as PublicSchoolBranding);
    },
    (err) => {
      if (onError) {
        onError(extractFriendlyError(err, 'Could not load public school branding.'));
      }
    }
  );
}

export async function saveSchoolBrandingAndSettings(settings: SchoolSetting): Promise<void> {
  const fullPayload = buildFullSchoolSettingsPayload(settings);
  const publicPayload = buildPublicBrandingPayload({
    ...INITIAL_SCHOOL_SETTINGS,
    ...settings,
  });

  try {
    await setDoc(doc(db, 'settings', 'school'), fullPayload);
    await setDoc(doc(db, 'branding', 'school'), publicPayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'settings/school');
  }
}

export async function saveSchoolLogoDataUrlToFirestore(params: {
  dataUrl: string;
  currentSettings: SchoolSetting;
  actorName: string;
  onProgress?: (percent: number, stage?: string) => void;
}): Promise<SchoolSetting> {
  const { dataUrl, currentSettings, actorName, onProgress } = params;

  const trimmed = (dataUrl || '').trim();
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(trimmed)) {
    throw new Error('Invalid compressed logo data URL. Please select an image and try again.');
  }
  if (trimmed.length >= MAX_LOGO_DATA_URL_BYTES) {
    throw new Error('Compressed logo exceeds the 300 KB limit for Firestore storage.');
  }

  onProgress?.(40, 'Preparing logo payload...');
  const updatedSettings: SchoolSetting = {
    ...INITIAL_SCHOOL_SETTINGS,
    ...currentSettings,
    logoDataUrl: trimmed,
    logoUpdatedAt: new Date().toISOString(),
    logoUpdatedBy: actorName,
  };

  onProgress?.(75, 'Saving logo to Cloud Firestore...');
  await saveSchoolBrandingAndSettings(updatedSettings);
  onProgress?.(100, 'Logo saved to Firestore.');

  return updatedSettings;
}

export async function removeSchoolLogoFromFirestore(params: {
  currentSettings: SchoolSetting;
  actorName: string;
}): Promise<SchoolSetting> {
  const { currentSettings, actorName } = params;

  const clearedSettings: SchoolSetting = {
    ...INITIAL_SCHOOL_SETTINGS,
    ...currentSettings,
    logoDataUrl: '',
    logoUpdatedAt: new Date().toISOString(),
    logoUpdatedBy: actorName,
  };

  await saveSchoolBrandingAndSettings(clearedSettings);
  return clearedSettings;
}

export async function loadImageForPdf(logoDataUrl?: string): Promise<PdfLogoAsset | null> {
  const trimmed = (logoDataUrl || '').trim();
  if (!trimmed || !trimmed.startsWith('data:image/')) return null;

  if (pdfImageCache.has(trimmed)) {
    return pdfImageCache.get(trimmed) || null;
  }

  try {
    const asset = await new Promise<PdfLogoAsset | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const format: 'PNG' | 'JPEG' = trimmed.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
        resolve({
          dataUrl: trimmed,
          format,
          width: Math.max(1, img.naturalWidth || 128),
          height: Math.max(1, img.naturalHeight || 128),
        });
      };
      img.onerror = () => resolve(null);
      img.src = trimmed;
    });

    pdfImageCache.set(trimmed, asset);
    return asset;
  } catch {
    pdfImageCache.set(trimmed, null);
    return null;
  }
}

export function fitDimensionsInsideBox(
  srcWidth: number,
  srcHeight: number,
  maxWidth: number,
  maxHeight: number
): { drawWidth: number; drawHeight: number; offsetX: number; offsetY: number } {
  const safeW = Math.max(1, srcWidth);
  const safeH = Math.max(1, srcHeight);
  const ratio = Math.min(maxWidth / safeW, maxHeight / safeH);
  const drawWidth = safeW * ratio;
  const drawHeight = safeH * ratio;
  return {
    drawWidth,
    drawHeight,
    offsetX: (maxWidth - drawWidth) / 2,
    offsetY: (maxHeight - drawHeight) / 2,
  };
}
