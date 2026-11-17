import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Globe,
  Image as ImageIcon,
  Lock,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  RotateCcw,
  Save,
  School,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { SchoolSetting } from '../../types';
import { INITIAL_SCHOOL_SETTINGS } from '../../data/sampleData';
import {
  formatBytesLabel,
  MAX_RAW_LOGO_FILE_BYTES,
  ProcessedLogoResult,
  processLogoImageToDataUrl,
  removeSchoolLogoFromFirestore,
  saveSchoolBrandingAndSettings,
  saveSchoolLogoDataUrlToFirestore,
} from '../../services/brandingService';
import { extractFriendlyError } from '../../services/schoolService';
import { SchoolLogo } from '../common/SchoolLogo';

interface SchoolBrandingSettingsProps {
  isDirector: boolean;
  isLiveFirestore: boolean;
  actorName: string;
  schoolSettings: SchoolSetting;
}

export const SchoolBrandingSettings: React.FC<SchoolBrandingSettingsProps> = ({
  isDirector,
  isLiveFirestore,
  actorName,
  schoolSettings,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Editable School Identity form state
  const [identity, setIdentity] = useState({
    schoolName: schoolSettings.schoolName || INITIAL_SCHOOL_SETTINGS.schoolName,
    motto: schoolSettings.motto || '',
    address: schoolSettings.address || '',
    phone: schoolSettings.phone || '',
    email: schoolSettings.email || '',
    website: schoolSettings.website || '',
  });

  // Pending compressed logo (ready to preview & save to Firestore)
  const [pendingLogo, setPendingLogo] = useState<ProcessedLogoResult | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string>('');
  const [isProcessingImage, setIsProcessingImage] = useState<boolean>(false);

  const [previewSurface, setPreviewSurface] = useState<'checker' | 'light' | 'dark'>('checker');
  const [previewImgError, setPreviewImgError] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadStage, setUploadStage] = useState<string>('');
  const [isSavingLogo, setIsSavingLogo] = useState<boolean>(false);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [confirmRemove, setConfirmRemove] = useState<boolean>(false);
  const [isSavingIdentity, setIsSavingIdentity] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    setIdentity({
      schoolName: schoolSettings.schoolName || INITIAL_SCHOOL_SETTINGS.schoolName,
      motto: schoolSettings.motto || '',
      address: schoolSettings.address || '',
      phone: schoolSettings.phone || '',
      email: schoolSettings.email || '',
      website: schoolSettings.website || '',
    });
  }, [schoolSettings]);

  useEffect(() => {
    setPreviewImgError(false);
  }, [pendingLogo?.dataUrl, schoolSettings.logoDataUrl]);

  if (!isDirector) {
    return (
      <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] p-8 text-center max-w-xl mx-auto space-y-3">
        <div className="w-12 h-12 rounded-[10px] bg-[#FBF5E8] border border-[#E3CFA6] text-[#7D5A18] flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-[#2A2A2E]">Director Authorization Required</h3>
        <p className="text-xs text-[#6E6A63] leading-relaxed">
          Only the School Director has permission to access School Branding, upload or remove the
          official school logo, or edit institutional identity details.
        </p>
      </div>
    );
  }

  const clearPendingSelection = () => {
    setPendingLogo(null);
    setPendingFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSelectFile = async (file: File | null | undefined) => {
    setFeedback(null);
    setConfirmRemove(false);
    if (!file) return;

    setIsProcessingImage(true);
    try {
      const processed = await processLogoImageToDataUrl(file);
      setPendingLogo(processed);
      setPendingFileName(file.name);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to process the selected image file.',
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleSaveLogoToFirestore = async () => {
    if (!pendingLogo) return;
    if (!isLiveFirestore) {
      setFeedback({
        type: 'error',
        text: 'Please sign in as the verified Director to save the school logo.',
      });
      return;
    }

    setFeedback(null);
    setIsSavingLogo(true);
    setUploadProgress(15);
    setUploadStage('Validating compressed logo...');

    try {
      const mergedSettings: SchoolSetting = {
        ...schoolSettings,
        schoolName: identity.schoolName.trim() || schoolSettings.schoolName,
        motto: identity.motto.trim(),
        address: identity.address.trim(),
        phone: identity.phone.trim(),
        email: identity.email.trim(),
        website: identity.website.trim(),
      };

      const savedSettings = await saveSchoolLogoDataUrlToFirestore({
        dataUrl: pendingLogo.dataUrl,
        currentSettings: mergedSettings,
        actorName,
        onProgress: (pct, stage) => {
          setUploadProgress((prev) => Math.max(prev, pct));
          if (stage) setUploadStage(stage);
        },
      });

      if (!savedSettings.logoDataUrl) {
        throw new Error('Firestore save completed without a logoDataUrl.');
      }

      clearPendingSelection();
      setFeedback({
        type: 'success',
        text: 'School logo optimized, saved to Cloud Firestore, and applied across the login portal, headers, report cards, receipts, and PDFs.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractFriendlyError(err, 'Failed to save school logo to Firestore.'),
      });
    } finally {
      setIsSavingLogo(false);
      setUploadProgress(0);
      setUploadStage('');
    }
  };

  const handleRemoveLogo = async () => {
    if (!isLiveFirestore) {
      setFeedback({
        type: 'error',
        text: 'Please sign in as the verified Director to remove the uploaded logo.',
      });
      return;
    }

    setFeedback(null);
    setIsRemoving(true);
    try {
      await removeSchoolLogoFromFirestore({
        currentSettings: {
          ...schoolSettings,
          schoolName: identity.schoolName.trim() || schoolSettings.schoolName,
          motto: identity.motto.trim(),
          address: identity.address.trim(),
          phone: identity.phone.trim(),
          email: identity.email.trim(),
          website: identity.website.trim(),
        },
        actorName,
      });
      clearPendingSelection();
      setConfirmRemove(false);
      setFeedback({
        type: 'success',
        text: 'Custom school logo removed and default SchoolDesk emblem restored.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractFriendlyError(err, 'Could not remove the uploaded logo.'),
      });
    } finally {
      setIsRemoving(false);
    }
  };

  const handleSaveIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identity.schoolName.trim()) {
      setFeedback({ type: 'error', text: 'School name is required.' });
      return;
    }
    if (!isLiveFirestore) {
      setFeedback({
        type: 'error',
        text: 'Please sign in as Director to save school identity details.',
      });
      return;
    }

    setFeedback(null);
    setIsSavingIdentity(true);
    try {
      await saveSchoolBrandingAndSettings({
        ...schoolSettings,
        schoolName: identity.schoolName.trim(),
        motto: identity.motto.trim(),
        address: identity.address.trim(),
        phone: identity.phone.trim(),
        email: identity.email.trim(),
        website: identity.website.trim(),
      });
      setFeedback({
        type: 'success',
        text: 'School branding details saved to Cloud Firestore and synchronized across the portal.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractFriendlyError(err, 'Failed to save school identity details.'),
      });
    } finally {
      setIsSavingIdentity(false);
    }
  };

  const activeDisplayLogo = pendingLogo?.dataUrl || schoolSettings.logoDataUrl || '';
  const hasSavedLogo = Boolean(schoolSettings.logoDataUrl && schoolSettings.logoDataUrl.trim());
  const savedLogoSizeLabel = hasSavedLogo
    ? formatBytesLabel((schoolSettings.logoDataUrl || '').length)
    : '';
  const maxRawMb = Math.round(MAX_RAW_LOGO_FILE_BYTES / (1024 * 1024));

  const previewSurfaceBg =
    previewSurface === 'dark'
      ? 'bg-[#2A2A2E] text-white border-[#2A2A2E]'
      : previewSurface === 'light'
        ? 'bg-white text-[#2A2A2E] border-[#E6DFD3]'
        : 'bg-[linear-gradient(45deg,#FAF8F4_25%,transparent_25%),linear-gradient(-45deg,#FAF8F4_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#FAF8F4_75%),linear-gradient(-45deg,transparent_75%,#FAF8F4_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0] bg-white border-[#E6DFD3]';

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className={`p-3.5 rounded-[10px] border text-xs flex items-start justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-[#EEF4F0] border-[#C5D6CB] text-[#2A583B]'
              : 'bg-[#FAF0F2] border-[#E2C1C5] text-[#86222E]'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-[#2A583B] shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-[#86222E] shrink-0 mt-0.5" />
            )}
            <span className="leading-relaxed">{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[11px] font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: LOGO UPLOAD, CANVAS OPTIMIZATION & PREVIEW */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] p-6 space-y-5">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#EFE9DF]">
              <div>
                <h3 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-[#6B1020]" />
                  Official School Logo
                </h3>
                <p className="text-xs text-[#6E6A63] mt-0.5">
                  PNG, JPG, JPEG, or WEBP (up to {maxRawMb} MB) · Auto-resized to max 400×400 px
                </p>
              </div>
              <div className="flex items-center gap-1 p-0.5 bg-[#FAF8F4] border border-[#E6DFD3] rounded-[8px] text-[11px]">
                {(['checker', 'light', 'dark'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPreviewSurface(mode)}
                    className={`px-2 py-1 rounded-[6px] font-medium capitalize transition-colors duration-150 whitespace-nowrap ${
                      previewSurface === mode
                        ? 'bg-white text-[#2A2A2E] shadow-xs border border-[#E6DFD3]'
                        : 'text-[#6E6A63] hover:text-[#2A2A2E]'
                    }`}
                  >
                    {mode === 'checker' ? 'Grid' : mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Live Preview Box */}
            <div
              className={`rounded-[10px] border p-6 flex flex-col items-center justify-center min-h-[190px] transition-colors duration-150 ${previewSurfaceBg}`}
            >
              {isProcessingImage ? (
                <div className="flex flex-col items-center gap-2 text-center text-xs text-[#6B1020]">
                  <RefreshCw className="w-6 h-6 animate-spin" />
                  <span className="font-semibold">Resizing & compressing logo...</span>
                </div>
              ) : activeDisplayLogo && !previewImgError ? (
                <img
                  src={activeDisplayLogo}
                  alt={`${identity.schoolName} Logo Preview`}
                  onError={() => setPreviewImgError(true)}
                  className="max-h-32 max-w-full object-contain select-none"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-center">
                  <SchoolLogo schoolName={identity.schoolName} size="2xl" variant="default" />
                  <span
                    className={`text-xs font-medium ${
                      previewSurface === 'dark' ? 'text-[#E6DFD3]' : 'text-[#6E6A63]'
                    }`}
                  >
                    {previewImgError
                      ? 'Could not display the stored logo. Please select a new image or restore default.'
                      : 'Default emblem active (no custom logo saved yet)'}
                  </span>
                </div>
              )}
            </div>

            {/* File Metadata Readout (Pending or Saved) */}
            {pendingLogo ? (
              <div className="p-3 rounded-[8px] bg-[#FAF0F2] border border-[#DFC7CA] text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[#6B1020] truncate">{pendingFileName}</span>
                  <span className="text-[#6B1020] font-medium shrink-0">Ready to Save</span>
                </div>
                <p className="text-[11px] text-[#5E5B56] tabular-nums">
                  {pendingLogo.width} × {pendingLogo.height} px · {pendingLogo.sizeLabel} ·{' '}
                  {pendingLogo.hasTransparency ? 'PNG (Transparent)' : 'JPEG (0.8 quality)'}
                </p>
              </div>
            ) : (
              <div className="text-[11px] text-[#6E6A63] space-y-1 tabular-nums">
                <div className="flex justify-between gap-2">
                  <span>Status:</span>
                  <strong className="text-[#2A2A2E]">
                    {hasSavedLogo
                      ? `Saved in Cloud Firestore (${savedLogoSizeLabel})`
                      : 'Default SchoolDesk crest'}
                  </strong>
                </div>
                {schoolSettings.logoUpdatedAt && (
                  <div className="flex justify-between gap-2">
                    <span>Last Updated:</span>
                    <span className="text-[#5E5B56]">
                      {new Date(schoolSettings.logoUpdatedAt).toLocaleDateString()} ·{' '}
                      {schoolSettings.logoUpdatedBy || 'Director'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Save Progress Bar */}
            {isSavingLogo && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#6B1020] truncate">
                    {uploadStage || 'Saving school logo to Cloud Firestore...'}
                  </span>
                  <span className="font-mono font-semibold text-[#6B1020] tabular-nums shrink-0">
                    {uploadProgress}%
                  </span>
                </div>
                <div className="w-full h-2 bg-[#FAF8F4] rounded-full overflow-hidden border border-[#E6DFD3]">
                  <div
                    className="h-full bg-[#6B1020] transition-all duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Hidden Input (supports desktop file browser & Android gallery/files) */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              onChange={(e) => handleSelectFile(e.target.files?.[0])}
              className="hidden"
              aria-label="Choose school logo image"
            />

            {/* Primary Save / Replace / Remove Controls */}
            <div className="space-y-2.5">
              {pendingLogo ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isSavingLogo || isProcessingImage}
                    onClick={handleSaveLogoToFirestore}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-xs transition-colors duration-150 disabled:opacity-50 whitespace-nowrap"
                  >
                    {isSavingLogo ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {isSavingLogo ? `Saving (${uploadProgress}%)...` : 'Save School Logo'}
                  </button>
                  <button
                    type="button"
                    disabled={isSavingLogo}
                    onClick={clearPendingSelection}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-[8px] border border-[#DDD5C7] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] font-medium text-xs transition-colors duration-150 disabled:opacity-50 whitespace-nowrap"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isSavingLogo || isRemoving || isProcessingImage}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-xs transition-colors duration-150 disabled:opacity-50 whitespace-nowrap"
                >
                  <Upload className="w-4 h-4" />
                  {hasSavedLogo ? 'Replace School Logo' : 'Select School Logo'}
                </button>
              )}

              {hasSavedLogo && !pendingLogo && (
                <>
                  {!confirmRemove ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={isRemoving}
                        onClick={() => setConfirmRemove(true)}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-[8px] border border-[#E2C1C5] bg-[#FAF0F2] hover:bg-[#F5E2E6] text-[#86222E] font-medium text-xs transition-colors duration-150 whitespace-nowrap"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove Logo
                      </button>
                      <button
                        type="button"
                        disabled={isRemoving}
                        onClick={() => setConfirmRemove(true)}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-[8px] border border-[#DDD5C7] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] font-medium text-xs transition-colors duration-150 whitespace-nowrap"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Restore Default
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5] space-y-2.5 text-xs">
                      <p className="text-[#86222E] font-medium">
                        Remove the saved logo from Firestore and restore the default emblem?
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isRemoving}
                          onClick={handleRemoveLogo}
                          className="px-3 py-1.5 rounded-[8px] bg-[#86222E] hover:bg-[#6E1A24] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                        >
                          {isRemoving ? 'Removing...' : 'Confirm Remove & Restore'}
                        </button>
                        <button
                          type="button"
                          disabled={isRemoving}
                          onClick={() => setConfirmRemove(false)}
                          className="px-3 py-1.5 rounded-[8px] bg-white border border-[#DDD5C7] text-[#2A2A2E] font-medium hover:bg-[#FAF8F4] transition-colors duration-150"
                        >
                          Keep Current Logo
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Firestore Logo Optimization Callout */}
          <div className="bg-[#FAF8F4] rounded-[10px] border border-[#E6DFD3] p-5 space-y-2 text-xs">
            <h4 className="font-semibold text-[#2A2A2E] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#2A583B]" />
              Automatic Browser Optimization & Firestore Sync
            </h4>
            <p className="text-[#5E5B56] leading-relaxed">
              Selected logos are resized in your browser to a maximum of <strong>400×400 px</strong>{' '}
              and compressed below <strong>300 KB</strong> (preserving transparency as PNG, or JPEG at
              0.8 quality for opaque logos) before saving directly to Cloud Firestore.
            </p>
          </div>
        </div>

        {/* RIGHT COLUMN: EDITABLE SCHOOL IDENTITY & LETTERHEAD PREVIEW */}
        <div className="lg:col-span-7 space-y-6">
          <form
            onSubmit={handleSaveIdentity}
            className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] p-6 space-y-4"
          >
            <div className="pb-3 border-b border-[#EFE9DF]">
              <h3 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2">
                <School className="w-4 h-4 text-[#6B1020]" />
                School Identity Details
              </h3>
              <p className="text-xs text-[#6E6A63] mt-0.5">
                Printed across the login portal, navigation header, student dossiers, report cards,
                payment receipts, and PDF reports.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-medium text-[#5E5B56] mb-1">School Name *</label>
                <input
                  type="text"
                  required
                  maxLength={150}
                  value={identity.schoolName}
                  onChange={(e) => setIdentity({ ...identity, schoolName: e.target.value })}
                  placeholder="Great God's Time Comprehensive School"
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] font-semibold focus:outline-none focus:border-[#6B1020]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-medium text-[#5E5B56] mb-1">School Motto</label>
                <input
                  type="text"
                  maxLength={200}
                  value={identity.motto}
                  onChange={(e) => setIdentity({ ...identity, motto: e.target.value })}
                  placeholder="e.g. Raising Godly Leaders Through Academic Excellence"
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-medium text-[#5E5B56] mb-1">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-[#7F7A72]" />
                    Campus Address
                  </span>
                </label>
                <input
                  type="text"
                  maxLength={250}
                  value={identity.address}
                  onChange={(e) => setIdentity({ ...identity, address: e.target.value })}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                />
              </div>

              <div>
                <label className="block font-medium text-[#5E5B56] mb-1">
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-[#7F7A72]" />
                    Telephone Number
                  </span>
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={identity.phone}
                  onChange={(e) => setIdentity({ ...identity, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                />
              </div>

              <div>
                <label className="block font-medium text-[#5E5B56] mb-1">
                  <span className="inline-flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5 text-[#7F7A72]" />
                    Email Address
                  </span>
                </label>
                <input
                  type="email"
                  maxLength={128}
                  value={identity.email}
                  onChange={(e) => setIdentity({ ...identity, email: e.target.value })}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-medium text-[#5E5B56] mb-1">
                  <span className="inline-flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5 text-[#7F7A72]" />
                    Website (Optional)
                  </span>
                </label>
                <input
                  type="text"
                  maxLength={128}
                  value={identity.website}
                  onChange={(e) => setIdentity({ ...identity, website: e.target.value })}
                  placeholder="https://www.greatgodstimeschool.edu.ng"
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={isSavingIdentity}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-xs transition-colors duration-150 disabled:opacity-50 whitespace-nowrap"
              >
                {isSavingIdentity ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {isSavingIdentity ? 'Saving Identity...' : 'Save School Identity'}
              </button>
            </div>
          </form>

          {/* Live Letterhead Preview */}
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] p-6 space-y-3">
            <p className="text-xs font-medium text-[#6E6A63]">
              Live Letterhead Preview (Report Cards, Receipts &amp; Printed Reports)
            </p>
            <div className="rounded-[10px] border border-[#E6DFD3] p-5 bg-[#FAF8F4] flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
              <SchoolLogo
                logoDataUrl={activeDisplayLogo}
                schoolName={identity.schoolName}
                size="xl"
                variant="print"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <h4 className="font-serif text-base font-semibold text-[#6B1020] tracking-tight">
                  {identity.schoolName || INITIAL_SCHOOL_SETTINGS.schoolName}
                </h4>
                {identity.motto && (
                  <p className="text-xs italic font-medium text-[#7D5A18]">{identity.motto}</p>
                )}
                <p className="text-[11px] text-[#5E5B56]">{identity.address}</p>
                <p className="text-[11px] text-[#6E6A63]">
                  {[
                    identity.phone && `Tel: ${identity.phone}`,
                    identity.email && `Email: ${identity.email}`,
                    identity.website && identity.website,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
