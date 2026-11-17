import React, { useMemo, useState } from 'react';
import {
  Award,
  CheckCircle2,
  Clock,
  Download,
  Printer,
  AlertTriangle,
  Pencil,
  Save,
  Copy,
  Upload,
  Trash2,
  AlertCircle,
  Users,
  X,
} from 'lucide-react';
import {
  AcademicConfig,
  AcademicTerm,
  SchoolSetting,
  StudentResultReview,
} from '../../types';
import {
  buildResultReviewId,
  ComputedStudentResult,
  copyReportCardCommentToStudentsInFirestore,
  downloadReportCardPDF,
  formatOrdinal,
  QUICK_REPORT_COMMENTS,
  ReportCommentBoxType,
  saveReportCardCommentBoxToFirestore,
} from '../../services/academicService';
import { processSignatureImageToDataUrl } from '../../services/brandingService';
import { extractFriendlyError } from '../../services/schoolService';
import { useAuth } from '../../context/AuthContext';
import { SchoolLogo } from '../common/SchoolLogo';

interface ReportCardViewProps {
  result: ComputedStudentResult;
  classResults?: ComputedStudentResult[];
  schoolSettings: SchoolSetting;
  config: AcademicConfig;
  session: string;
  term: AcademicTerm;
  section?: string;
  nextTermResumption?: string;
  onPrint?: () => void;
  onReviewUpdated?: (review: StudentResultReview) => void;
}

const MAX_COMMENT_LENGTH = 300;

function formatCommentDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const ReportCardView: React.FC<ReportCardViewProps> = ({
  result,
  classResults,
  schoolSettings,
  config,
  session,
  term,
  section,
  nextTermResumption,
  onPrint,
  onReviewUpdated,
}) => {
  const { role, currentUser, firebaseUser } = useAuth();
  const isLiveFirestore = Boolean(firebaseUser);
  const approvalStatus = result.review?.status || 'Draft';

  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // Per-box comment editor state
  const [editingBox, setEditingBox] = useState<ReportCommentBoxType | null>(null);
  const [draftComment, setDraftComment] = useState('');
  const [draftSignerName, setDraftSignerName] = useState('');
  const [draftSignature, setDraftSignature] = useState<string | undefined>(undefined);
  const [quickCommentValue, setQuickCommentValue] = useState('');

  // "Copy to all students" drawer state
  const [isCopyOpen, setIsCopyOpen] = useState(false);
  const [copyStudentIds, setCopyStudentIds] = useState<string[]>([]);

  // Save / Approve feedback state
  const [isSavingBox, setIsSavingBox] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Visibility toggles from School Settings (default true when unset)
  const showTeacherBox = schoolSettings.enableTeacherComment !== false;
  const showHeadBox = schoolSettings.enableHeadComment !== false;
  const showPrincipalBox = schoolSettings.enablePrincipalComment !== false;

  // Chosen Head Teacher title (Headmaster | Headmistress)
  const headTitle =
    schoolSettings.headTeacherTitle || result.review?.headCommentTitle || 'Headmaster';

  // Role-based edit permissions
  const isClassTeacherForStudent =
    role === 'teacher' &&
    (currentUser?.assignedClasses || []).includes(result.student.className);
  const canEditTeacher = role === 'director' || isClassTeacherForStudent;
  const canEditHead = role === 'director' || role === 'head_teacher';
  const canEditPrincipal = role === 'director' || role === 'principal';

  // Roster for "Copy to all students"
  const classRoster = useMemo(() => {
    if (classResults && classResults.length > 0) {
      return classResults.map((r) => r.student);
    }
    return [result.student];
  }, [classResults, result.student]);

  const classReviewsPool = useMemo(() => {
    if (!classResults) return result.review ? [result.review] : [];
    return classResults
      .map((r) => r.review)
      .filter((rev): rev is StudentResultReview => Boolean(rev));
  }, [classResults, result.review]);

  // Display values with graceful defaults for Head & Principal names/signatures
  const teacherCommentText = result.review?.teacherComment?.trim() || '';
  const teacherCommentBy = result.review?.teacherCommentBy?.trim() || '';
  const teacherCommentAt = result.review?.teacherCommentAt;

  const headCommentText = result.review?.headComment?.trim() || '';
  const headCommentBy =
    result.review?.headCommentBy?.trim() || schoolSettings.headTeacherName?.trim() || '';
  const headCommentAt = result.review?.headCommentAt;
  const headSignatureUrl =
    (result.review?.headSignature ?? schoolSettings.headTeacherSignature)?.trim() || '';

  const principalCommentText = result.review?.principalComment?.trim() || '';
  const principalCommentBy =
    result.review?.principalCommentBy?.trim() ||
    result.review?.approvedBy?.trim() ||
    schoolSettings.principalName?.trim() ||
    '';
  const principalCommentAt = result.review?.principalCommentAt;
  const principalSignatureUrl =
    (result.review?.principalSignature ?? schoolSettings.principalSignature)?.trim() || '';
  const approvedAtFormatted = formatCommentDate(result.review?.approvedAt);

  const openEditor = (boxType: ReportCommentBoxType) => {
    setFeedback(null);
    setEditingBox(boxType);
    setQuickCommentValue('');
    setIsCopyOpen(false);
    setCopyStudentIds(classRoster.map((s) => s.id));

    const actorFallback = currentUser?.displayName || firebaseUser?.email || '';

    if (boxType === 'teacher') {
      setDraftComment(result.review?.teacherComment || '');
      setDraftSignerName(result.review?.teacherCommentBy || actorFallback);
      setDraftSignature(undefined);
    } else if (boxType === 'head') {
      setDraftComment(result.review?.headComment || '');
      setDraftSignerName(
        result.review?.headCommentBy || schoolSettings.headTeacherName || actorFallback
      );
      setDraftSignature(
        result.review?.headSignature ?? schoolSettings.headTeacherSignature ?? ''
      );
    } else {
      setDraftComment(result.review?.principalComment || '');
      setDraftSignerName(
        result.review?.principalCommentBy ||
          result.review?.approvedBy ||
          schoolSettings.principalName ||
          actorFallback
      );
      setDraftSignature(
        result.review?.principalSignature ?? schoolSettings.principalSignature ?? ''
      );
    }
  };

  const closeEditor = () => {
    setEditingBox(null);
    setIsCopyOpen(false);
    setQuickCommentValue('');
  };

  const buildLocalFallbackReview = (params: {
    student: ComputedStudentResult['student'];
    existing?: StudentResultReview;
    boxType: ReportCommentBoxType;
    comment: string;
    authorName: string;
    signatureDataUrl?: string;
    approveReport?: boolean;
  }): StudentResultReview => {
    const now = new Date().toISOString();
    const docId = buildResultReviewId(session, term, params.student.className, params.student.id);
    const base: StudentResultReview = params.existing || {
      id: docId,
      studentId: params.student.id,
      studentName: params.student.fullName,
      admissionNo: params.student.admissionNo,
      guardianEmail: (params.student.guardianEmail || '').trim().toLowerCase(),
      className: params.student.className,
      term,
      session,
      status: 'Draft',
      teacherComment: '',
      principalComment: '',
    };

    if (params.boxType === 'teacher') {
      return {
        ...base,
        teacherComment: params.comment.trim().slice(0, MAX_COMMENT_LENGTH),
        teacherCommentBy: params.authorName.trim(),
        teacherCommentAt: now,
        updatedAt: now,
      };
    }
    if (params.boxType === 'head') {
      return {
        ...base,
        headComment: params.comment.trim().slice(0, MAX_COMMENT_LENGTH),
        headCommentBy: params.authorName.trim(),
        headCommentTitle: headTitle,
        headCommentAt: now,
        headSignature:
          params.signatureDataUrl !== undefined ? params.signatureDataUrl : base.headSignature,
        updatedAt: now,
      };
    }
    return {
      ...base,
      principalComment: params.comment.trim().slice(0, MAX_COMMENT_LENGTH),
      principalCommentBy: params.authorName.trim(),
      principalCommentAt: now,
      principalSignature:
        params.signatureDataUrl !== undefined ? params.signatureDataUrl : base.principalSignature,
      ...(params.approveReport
        ? {
            status: 'Approved',
            reviewedBy: params.authorName.trim(),
            reviewedAt: now,
            approvedBy: params.authorName.trim(),
            approvedAt: now,
          }
        : {}),
      updatedAt: now,
    };
  };

  const handleSaveBox = async (boxType: ReportCommentBoxType, approveReport = false) => {
    const trimmed = draftComment.trim().slice(0, MAX_COMMENT_LENGTH);
    if (!trimmed && !approveReport) {
      setFeedback({
        type: 'error',
        text: 'Please enter a comment before saving.',
      });
      return;
    }

    const author =
      draftSignerName.trim() || currentUser?.displayName || firebaseUser?.email || 'Staff';

    setIsSavingBox(true);
    setFeedback(null);
    try {
      if (isLiveFirestore) {
        const updated = await saveReportCardCommentBoxToFirestore({
          student: result.student,
          session,
          term,
          className: result.student.className,
          boxType,
          comment: trimmed,
          authorName: author,
          headTitle,
          signatureDataUrl: boxType === 'teacher' ? undefined : draftSignature,
          approveReport,
        });
        onReviewUpdated?.(updated);
      } else {
        const updated = buildLocalFallbackReview({
          student: result.student,
          existing: result.review ?? undefined,
          boxType,
          comment: trimmed,
          authorName: author,
          signatureDataUrl: boxType === 'teacher' ? undefined : draftSignature,
          approveReport,
        });
        onReviewUpdated?.(updated);
      }

      const boxLabel =
        boxType === 'teacher'
          ? "Form / Class Teacher's Comment"
          : boxType === 'head'
            ? "Headmaster's/Headmistress's Comment"
            : approveReport
              ? "Principal's Comment & Official Approval"
              : "Principal's Comment";

      setFeedback({
        type: 'success',
        text: `${boxLabel} saved for ${result.student.fullName} (${term}, ${session}).`,
      });
      closeEditor();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractFriendlyError(err, 'Failed to save report card comment.'),
      });
    } finally {
      setIsSavingBox(false);
    }
  };

  const handleQuickApprovePrincipal = async () => {
    if (!canEditPrincipal) return;
    const author =
      result.review?.principalCommentBy ||
      schoolSettings.principalName ||
      currentUser?.displayName ||
      firebaseUser?.email ||
      'Principal';

    setIsSavingBox(true);
    setFeedback(null);
    try {
      if (isLiveFirestore) {
        const updated = await saveReportCardCommentBoxToFirestore({
          student: result.student,
          session,
          term,
          className: result.student.className,
          boxType: 'principal',
          comment: result.review?.principalComment || '',
          authorName: author,
          signatureDataUrl:
            result.review?.principalSignature ?? schoolSettings.principalSignature ?? undefined,
          approveReport: true,
        });
        onReviewUpdated?.(updated);
      } else {
        const updated = buildLocalFallbackReview({
          student: result.student,
          existing: result.review ?? undefined,
          boxType: 'principal',
          comment: result.review?.principalComment || '',
          authorName: author,
          signatureDataUrl:
            result.review?.principalSignature ?? schoolSettings.principalSignature ?? undefined,
          approveReport: true,
        });
        onReviewUpdated?.(updated);
      }

      setFeedback({
        type: 'success',
        text: `Report card officially approved for ${result.student.fullName} (${term}, ${session}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractFriendlyError(err, 'Failed to approve report card.'),
      });
    } finally {
      setIsSavingBox(false);
    }
  };

  const handleCopyToSelectedStudents = async (boxType: ReportCommentBoxType) => {
    const trimmed = draftComment.trim().slice(0, MAX_COMMENT_LENGTH);
    if (!trimmed) {
      setFeedback({
        type: 'error',
        text: 'Please write or select a comment before applying it to students.',
      });
      return;
    }

    const targets = classRoster.filter((s) => copyStudentIds.includes(s.id));
    if (targets.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Select at least one student to apply this comment to.',
      });
      return;
    }

    const author =
      draftSignerName.trim() || currentUser?.displayName || firebaseUser?.email || 'Staff';

    setIsSavingBox(true);
    setFeedback(null);
    try {
      if (isLiveFirestore) {
        await copyReportCardCommentToStudentsInFirestore({
          students: targets,
          existingReviews: classReviewsPool,
          session,
          term,
          className: result.student.className,
          boxType,
          comment: trimmed,
          authorName: author,
          headTitle,
          signatureDataUrl: boxType === 'teacher' ? undefined : draftSignature,
        });
      }

      targets.forEach((stu) => {
        const existing = classReviewsPool.find((r) => r.studentId === stu.id);
        const updated = buildLocalFallbackReview({
          student: stu,
          existing,
          boxType,
          comment: trimmed,
          authorName: author,
          signatureDataUrl: boxType === 'teacher' ? undefined : draftSignature,
        });
        onReviewUpdated?.(updated);
      });

      const boxLabel =
        boxType === 'teacher'
          ? "Form / Class Teacher's Comment"
          : boxType === 'head'
            ? "Headmaster's/Headmistress's Comment"
            : "Principal's Comment";

      setFeedback({
        type: 'success',
        text: `Applied ${boxLabel} to ${targets.length} student${targets.length === 1 ? '' : 's'} in ${result.student.className}. You can still edit any student individually.`,
      });
      closeEditor();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractFriendlyError(err, 'Failed to apply comment to selected students.'),
      });
    } finally {
      setIsSavingBox(false);
    }
  };

  const handleSignatureUpload = async (file: File | undefined) => {
    if (!file) return;
    setFeedback(null);
    try {
      const processed = await processSignatureImageToDataUrl(file);
      setDraftSignature(processed.dataUrl);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: extractFriendlyError(err, 'Unable to process signature image.'),
      });
    }
  };

  const getApprovalBadge = () => {
    switch (approvalStatus) {
      case 'Approved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB]">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Official Approved Result
          </span>
        );
      case 'Submitted for Review':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA]">
            <Clock className="w-3.5 h-3.5" />
            Submitted for Review
          </span>
        );
      case 'Returned for Correction':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#FAF0F2] text-[#86222E] border border-[#E2C1C5]">
            <AlertTriangle className="w-3.5 h-3.5" />
            Returned for Correction
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
            <Clock className="w-3.5 h-3.5" />
            Draft (Pending Approval)
          </span>
        );
    }
  };

  const renderInlineCommentEditor = (boxType: ReportCommentBoxType) => {
    const showNameAndSig = boxType === 'head' || boxType === 'principal';
    const isAllSelected =
      classRoster.length > 0 && copyStudentIds.length === classRoster.length;

    return (
      <div className="mt-3 pt-3 border-t border-[#E6DFD3] space-y-3 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-[#5E5B56] mb-1">
              Quick Comments (Optional Suggestion)
            </label>
            <select
              value={quickCommentValue}
              onChange={(e) => {
                const chosen = e.target.value;
                setQuickCommentValue(chosen);
                if (chosen) {
                  setDraftComment(chosen.slice(0, MAX_COMMENT_LENGTH));
                }
              }}
              className="w-full px-2.5 py-1.5 text-xs border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
            >
              <option value="">-- Choose a ready-made comment to edit --</option>
              {QUICK_REPORT_COMMENTS.map((group) => (
                <optgroup key={group.category} label={group.category}>
                  {group.items.map((item, idx) => (
                    <option key={`${group.category}-${idx}`} value={item}>
                      {item}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {showNameAndSig && (
            <div>
              <label className="block text-[11px] font-semibold text-[#5E5B56] mb-1">
                {boxType === 'head' ? "Headmaster's/Headmistress's Name" : "Principal's Name"}
              </label>
              <input
                type="text"
                maxLength={120}
                value={draftSignerName}
                onChange={(e) => setDraftSignerName(e.target.value)}
                placeholder={
                  boxType === 'head'
                    ? "Enter Headmaster's/Headmistress's name..."
                    : "Enter Principal's name..."
                }
                className="w-full px-2.5 py-1.5 text-xs border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
              />
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-[#5E5B56]">
              Comment Text (Editable)
            </label>
            <span
              className={`text-[11px] font-medium tabular-nums ${
                draftComment.length >= MAX_COMMENT_LENGTH
                  ? 'text-[#86222E]'
                  : 'text-[#6E6A63]'
              }`}
            >
              {draftComment.length} / {MAX_COMMENT_LENGTH} characters
            </span>
          </div>
          <textarea
            rows={3}
            maxLength={MAX_COMMENT_LENGTH}
            value={draftComment}
            onChange={(e) => setDraftComment(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
            placeholder={`Write ${
              boxType === 'teacher'
                ? 'Form / Class Teacher'
                : boxType === 'head'
                  ? 'Headmaster/Headmistress'
                  : 'Principal'
            }'s remark for ${result.student.fullName}...`}
            className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
          />
        </div>

        {showNameAndSig && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-[8px] bg-white border border-[#E6DFD3]">
            <div className="flex items-center gap-3">
              {draftSignature ? (
                <div className="h-10 px-2 rounded border border-[#E6DFD3] bg-[#FAF8F4] flex items-center justify-center">
                  <img
                    src={draftSignature}
                    alt="Signature preview"
                    className="max-h-8 max-w-[120px] object-contain"
                  />
                </div>
              ) : (
                <span className="text-[11px] text-[#7F7A72] italic">
                  No signature image attached
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] bg-[#FAF8F4] hover:bg-[#FAF0F2] border border-[#DDD5C7] text-[#6B1020] text-[11px] font-medium cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                {draftSignature ? 'Replace Signature' : 'Upload Signature'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    handleSignatureUpload(f);
                  }}
                />
              </label>
              {draftSignature && (
                <button
                  type="button"
                  onClick={() => setDraftSignature('')}
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-[6px] bg-[#FAF0F2] hover:bg-[#F3E1E5] border border-[#E2C1C5] text-[#86222E] text-[11px] font-medium transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Copy to all students helper */}
        {classRoster.length > 0 && role !== 'parent' && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setIsCopyOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#6B1020] hover:underline"
            >
              <Copy className="w-3.5 h-3.5" />
              {isCopyOpen
                ? 'Hide "Copy to all students" selector'
                : 'Copy to all students in this class'}
            </button>

            {isCopyOpen && (
              <div className="p-3 rounded-[8px] bg-white border border-[#DFC7CA] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#2A2A2E]">
                    <Users className="w-3.5 h-3.5 text-[#6B1020]" />
                    <span>
                      Select Students in {result.student.className} ({copyStudentIds.length}/
                      {classRoster.length})
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setCopyStudentIds(classRoster.map((s) => s.id))}
                      className="font-medium text-[#6B1020] hover:underline"
                    >
                      Select All
                    </button>
                    <span className="text-[#DDD5C7]">|</span>
                    <button
                      type="button"
                      onClick={() => setCopyStudentIds([])}
                      className="font-medium text-[#5E5B56] hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto p-1">
                  {classRoster.map((stu) => {
                    const checked = copyStudentIds.includes(stu.id);
                    return (
                      <label
                        key={stu.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-[6px] border cursor-pointer text-[11px] ${
                          checked
                            ? 'bg-[#FAF0F2] border-[#DFC7CA] text-[#6B1020] font-medium'
                            : 'bg-[#FAF8F4] border-[#E6DFD3] text-[#2A2A2E]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setCopyStudentIds((prev) =>
                              prev.includes(stu.id)
                                ? prev.filter((id) => id !== stu.id)
                                : [...prev, stu.id]
                            )
                          }
                          className="accent-[#6B1020] shrink-0"
                        />
                        <span className="truncate">
                          {stu.fullName} ({stu.admissionNo})
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#EFE9DF]">
                  <span className="text-[10px] text-[#6E6A63]">
                    {isAllSelected
                      ? 'Applies to every student in this class; individual edits remain editable.'
                      : 'Applies to checked students only.'}
                  </span>
                  <button
                    type="button"
                    disabled={isSavingBox || copyStudentIds.length === 0}
                    onClick={() => handleCopyToSelectedStudents(boxType)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#B8913A] hover:bg-[#9D7A2E] text-white text-[11px] font-medium disabled:opacity-50 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {isSavingBox
                      ? 'Applying...'
                      : `Apply & Save to ${copyStudentIds.length} Student${
                          copyStudentIds.length === 1 ? '' : 's'
                        }`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={isSavingBox}
            onClick={closeEditor}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] text-xs font-medium transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
          <button
            type="button"
            disabled={isSavingBox}
            onClick={() => handleSaveBox(boxType, false)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            {isSavingBox ? 'Saving...' : 'Save Comment'}
          </button>
          {boxType === 'principal' && (
            <button
              type="button"
              disabled={isSavingBox}
              onClick={() => handleSaveBox('principal', true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] bg-[#2A583B] hover:bg-[#21462E] text-white text-xs font-medium disabled:opacity-50 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {isSavingBox ? 'Approving...' : 'Save & Approve'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex items-center gap-2">{getApprovalBadge()}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isDownloadingPdf}
            onClick={async () => {
              setIsDownloadingPdf(true);
              try {
                await downloadReportCardPDF({
                  result,
                  schoolSettings,
                  config,
                  session,
                  term,
                  section,
                  nextTermResumption,
                });
              } finally {
                setIsDownloadingPdf(false);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] text-xs font-medium transition-colors duration-150 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-[#6B1020]" />
            {isDownloadingPdf ? 'Preparing PDF...' : 'Download PDF'}
          </button>
          <button
            type="button"
            onClick={() => (onPrint ? onPrint() : window.print())}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Report Card
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3.5 rounded-[8px] border text-xs flex items-center justify-between gap-2 no-print ${
            feedback.type === 'success'
              ? 'bg-[#EEF4F0] border-[#C5D6CB] text-[#2A583B]'
              : 'bg-[#FAF0F2] border-[#E2C1C5] text-[#86222E]'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-[#2A583B] shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-[#86222E] shrink-0" />
            )}
            <span>{feedback.text}</span>
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

      {/* Printable Report Card Dossier */}
      <div className="bg-white rounded-[10px] border border-[#DDD5C7] p-6 sm:p-10 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] print-only-card">
        {/* School Crest & Header */}
        <div className="text-center pb-5 border-b-2 border-[#6B1020]">
          <div className="flex items-center justify-center mb-2.5">
            <SchoolLogo
              logoDataUrl={schoolSettings.logoDataUrl}
              schoolName={schoolSettings.schoolName}
              size="2xl"
              variant="print"
            />
          </div>
          <h2 className="font-serif text-xl sm:text-2xl font-semibold text-[#6B1020] tracking-tight">
            {schoolSettings.schoolName}
          </h2>
          {schoolSettings.motto && (
            <p className="text-xs italic font-medium text-[#7D5A18] mt-0.5">
              {schoolSettings.motto}
            </p>
          )}
          <p className="text-xs text-[#5E5B56] mt-1">{schoolSettings.address}</p>
          <p className="text-xs text-[#6E6A63]">
            {[
              schoolSettings.phone && `Tel: ${schoolSettings.phone}`,
              schoolSettings.email && `Email: ${schoolSettings.email}`,
              schoolSettings.website,
            ]
              .filter(Boolean)
              .join(' • ')}
          </p>

          <div className="mt-4 inline-block bg-[#6B1020] text-[#DFC484] border border-[#B8913A]/50 px-6 py-1.5 rounded-full text-xs font-semibold uppercase tracking-widest">
            Continuous Assessment &amp; Terminal Examination Report Card
          </div>
        </div>

        {/* Pupil Biodata & Summary Grid */}
        <div className="flex flex-col sm:flex-row gap-4 py-5 border-b border-[#E6DFD3] items-start sm:items-center">
          {result.student.passportPhoto ? (
            <img
              src={result.student.passportPhoto}
              alt={result.student.fullName}
              className="w-20 h-24 rounded-[10px] object-cover border border-[#E6DFD3] shrink-0"
            />
          ) : (
            <div className="w-20 h-24 rounded-[10px] bg-[#6B1020] text-white font-semibold text-xl flex items-center justify-center shrink-0">
              {result.student.fullName.charAt(0)}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 flex-1 text-xs w-full">
            <div>
              <span className="text-[#6E6A63] block font-medium">Student Name:</span>
              <strong className="text-[#2A2A2E] text-sm">{result.student.fullName}</strong>
            </div>
            <div>
              <span className="text-[#6E6A63] block font-medium">Admission Number:</span>
              <strong className="text-[#2A2A2E] font-mono text-sm">
                {result.student.admissionNo}
              </strong>
            </div>
            <div>
              <span className="text-[#6E6A63] block font-medium">Class &amp; Section:</span>
              <strong className="text-[#2A2A2E] text-sm">
                {result.student.className}
                {section ? ` (${section})` : ''}
              </strong>
            </div>
            <div>
              <span className="text-[#6E6A63] block font-medium">Session &amp; Term:</span>
              <strong className="text-[#2A2A2E] text-sm">
                {session} • {term}
              </strong>
            </div>

            <div>
              <span className="text-[#6E6A63] block font-medium">Class Position:</span>
              <strong className="text-[#2A583B] text-sm tabular-nums">
                {result.position
                  ? `${formatOrdinal(result.position)} out of ${result.totalRankedStudents}`
                  : '—'}
              </strong>
            </div>
            <div>
              <span className="text-[#6E6A63] block font-medium">Term Average:</span>
              <strong className="text-[#6B1020] text-sm font-bold tabular-nums">
                {result.subjectsCount > 0 ? `${result.averagePercentage}%` : '—'}
              </strong>
            </div>
            <div>
              <span className="text-[#6E6A63] block font-medium">Overall Grade:</span>
              <strong className="text-[#2A2A2E] text-sm font-mono">
                {result.overallGrade} ({result.overallRemark})
              </strong>
            </div>
            <div>
              <span className="text-[#6E6A63] block font-medium">Result Status:</span>
              <strong className="text-[#2A2A2E]">{approvalStatus}</strong>
            </div>
          </div>
        </div>

        {/* Attendance Summary (Strictly from saved attendance records) */}
        <div className="py-4 border-b border-[#E6DFD3]">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-2">
            Term Attendance Summary (Calculated from Saved Attendance Registers)
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs tabular-nums">
            <div className="bg-[#FAF8F4] p-2.5 rounded-[8px] border border-[#E6DFD3]">
              <span className="text-[10px] text-[#6E6A63] block">Days Recorded</span>
              <strong className="text-[#2A2A2E]">{result.attendance.totalRecords}</strong>
            </div>
            <div className="bg-[#EEF4F0] p-2.5 rounded-[8px] border border-[#C5D6CB]">
              <span className="text-[10px] text-[#2A583B] block">Present</span>
              <strong className="text-[#2A583B]">{result.attendance.present}</strong>
            </div>
            <div className="bg-[#FBF5E8] p-2.5 rounded-[8px] border border-[#E3CFA6]">
              <span className="text-[10px] text-[#7D5A18] block">Late</span>
              <strong className="text-[#7D5A18]">{result.attendance.late}</strong>
            </div>
            <div className="bg-[#FAF0F2] p-2.5 rounded-[8px] border border-[#E2C1C5]">
              <span className="text-[10px] text-[#86222E] block">Absent</span>
              <strong className="text-[#86222E]">{result.attendance.absent}</strong>
            </div>
            <div className="bg-[#FAF0F2] p-2.5 rounded-[8px] border border-[#DFC7CA]">
              <span className="text-[10px] text-[#6B1020] block">Excused</span>
              <strong className="text-[#6B1020]">{result.attendance.excused}</strong>
            </div>
            <div className="bg-[#6B1020] text-white p-2.5 rounded-[8px] border border-[#B8913A]/40">
              <span className="text-[10px] text-[#F7F4EF]/80 block">Attendance %</span>
              <strong className="text-[#DFC484]">
                {result.attendance.totalRecords > 0
                  ? `${result.attendance.attendanceRate}%`
                  : '0%'}
              </strong>
            </div>
          </div>
        </div>

        {/* Academic Marks Table */}
        <div className="py-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5E5B56] mb-3">
            Cognitive Academic Performance (Saved Assessments &amp; Examination Scores)
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border border-[#E6DFD3]">
              <thead className="bg-[#FAF8F4] text-[11px] font-semibold text-[#5E5B56] uppercase border-b border-[#E6DFD3]">
                <tr>
                  <th className="py-2.5 px-3 border-r border-[#E6DFD3]">Subject</th>
                  {config.components.map((comp) => (
                    <th
                      key={comp.id}
                      className="py-2.5 px-3 text-center border-r border-[#E6DFD3]"
                    >
                      {comp.label} ({comp.maxMark})
                    </th>
                  ))}
                  <th className="py-2.5 px-3 text-center border-r border-[#E6DFD3] font-bold">
                    Total ({config.components.reduce((s, c) => s + c.maxMark, 0)})
                  </th>
                  <th className="py-2.5 px-3 text-center border-r border-[#E6DFD3]">%</th>
                  <th className="py-2.5 px-3 text-center border-r border-[#E6DFD3]">Grade</th>
                  <th className="py-2.5 px-3">Teacher Remark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFE9DF] tabular-nums">
                {result.records.length === 0 ? (
                  <tr>
                    <td
                      colSpan={config.components.length + 5}
                      className="py-8 text-center text-[#7F7A72]"
                    >
                      No subject assessment scores have been saved for this student in {term} (
                      {session}).
                    </td>
                  </tr>
                ) : (
                  result.records.map((rec) => {
                    const pct =
                      rec.percentage !== undefined
                        ? rec.percentage
                        : Math.round((rec.total / (rec.maxTotal || 100)) * 1000) / 10;
                    return (
                      <tr key={rec.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                        <td className="py-2.5 px-3 font-semibold text-[#2A2A2E] border-r border-[#E6DFD3]">
                          {rec.subject}
                        </td>
                        {config.components.map((comp) => {
                          let val = 0;
                          if (rec.componentScores && rec.componentScores[comp.key] !== undefined) {
                            val = rec.componentScores[comp.key];
                          } else if (comp.key === 'ca1') {
                            val = rec.ca1 ?? 0;
                          } else if (comp.key === 'ca2') {
                            val = rec.ca2 ?? 0;
                          } else if (comp.key === 'exam' || comp.isExam) {
                            val = rec.exam ?? 0;
                          }
                          return (
                            <td
                              key={comp.id}
                              className="py-2.5 px-3 text-center border-r border-[#E6DFD3] text-[#2A2A2E]"
                            >
                              {val}
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-3 text-center font-semibold text-[#6B1020] border-r border-[#E6DFD3]">
                          {rec.total}
                        </td>
                        <td className="py-2.5 px-3 text-center border-r border-[#E6DFD3] text-[#2A2A2E]">
                          {pct}%
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono font-semibold border-r border-[#E6DFD3] text-[#2A583B]">
                          {rec.grade}
                        </td>
                        <td className="py-2.5 px-3 text-[#5E5B56]">{rec.remark}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Grading Scale & Ranking Policy Legend */}
        <div className="bg-[#FAF8F4] rounded-[8px] p-3 border border-[#E6DFD3] text-[11px] text-[#5E5B56] space-y-1 mb-5">
          <div className="flex items-center gap-1.5 font-semibold text-[#2A2A2E]">
            <Award className="w-3.5 h-3.5 text-[#B8913A]" />
            School Grading Key &amp; Ranking Policy
          </div>
          <p className="font-mono">
            {config.gradingScale
              .map((g) => `${g.grade}: ${g.minScore}–${g.maxScore}% (${g.remark})`)
              .join(' • ')}
          </p>
          <p>
            <strong>Class Ranking Policy:</strong>{' '}
            {config.rankingPolicy === 'dense'
              ? 'Dense Ranking (1, 2, 2, 3) ordered by Term Average (%) across saved subjects.'
              : 'Standard Competition Ranking (1, 2, 2, 4) ordered by Term Average (%) across saved subjects.'}
          </p>
        </div>

        {/* Three Separate Comment Boxes (Ordered: Form Teacher -> Headmaster/Headmistress -> Principal) */}
        {(showTeacherBox || showHeadBox || showPrincipalBox) && (
          <div className="pt-4 border-t border-[#E6DFD3] space-y-3 text-xs">
            {/* 1. Form / Class Teacher's Comment */}
            {showTeacherBox && (
              <div className="bg-[#FAF8F4] p-4 rounded-[8px] border border-[#E6DFD3]">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <span className="font-semibold text-[#2A2A2E]">
                    Form / Class Teacher&apos;s Comment:
                  </span>
                  {canEditTeacher && editingBox !== 'teacher' && (
                    <button
                      type="button"
                      onClick={() => openEditor('teacher')}
                      className="no-print inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-white hover:bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA] text-[11px] font-medium transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                      Add / Edit Comment
                    </button>
                  )}
                </div>

                {teacherCommentText ? (
                  <p className="italic text-[#2A2A2E] leading-relaxed">
                    &ldquo;{teacherCommentText}&rdquo;
                  </p>
                ) : (
                  <p className="text-[#7F7A72] italic min-h-[1.25rem] no-print">
                    No Form / Class Teacher comment entered yet.
                  </p>
                )}

                {teacherCommentText && (teacherCommentBy || teacherCommentAt) && (
                  <div className="mt-2 pt-2 border-t border-[#E6DFD3]/70 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6E6A63]">
                    <span>
                      {teacherCommentAt ? `Updated: ${formatCommentDate(teacherCommentAt)}` : ''}
                    </span>
                    {teacherCommentBy && (
                      <span className="font-medium text-[#2A2A2E]">
                        Signed: {teacherCommentBy}
                      </span>
                    )}
                  </div>
                )}

                {editingBox === 'teacher' && canEditTeacher && renderInlineCommentEditor('teacher')}
              </div>
            )}

            {/* 2. Headmaster's/Headmistress's Comment */}
            {showHeadBox && (
              <div className="bg-[#FBF8F1] p-4 rounded-[8px] border border-[#E3CFA6]">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <span className="font-semibold text-[#7D5A18]">
                    Headmaster&apos;s/Headmistress&apos;s Comment:
                  </span>
                  {canEditHead && editingBox !== 'head' && (
                    <button
                      type="button"
                      onClick={() => openEditor('head')}
                      className="no-print inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-white hover:bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6] text-[11px] font-medium transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                      Add / Edit Comment
                    </button>
                  )}
                </div>

                {headCommentText ? (
                  <p className="italic text-[#2A2A2E] leading-relaxed">
                    &ldquo;{headCommentText}&rdquo;
                  </p>
                ) : (
                  <p className="text-[#7F7A72] italic min-h-[1.25rem] no-print">
                    No Headmaster&apos;s/Headmistress&apos;s comment entered yet.
                  </p>
                )}

                {(headCommentBy || headSignatureUrl || headCommentAt) && (
                  <div className="mt-2.5 pt-2 border-t border-[#E3CFA6]/70 flex flex-wrap items-end justify-between gap-3 text-[11px] text-[#6E6A63]">
                    <div>
                      {headCommentAt && (
                        <span>Date: {formatCommentDate(headCommentAt)}</span>
                      )}
                    </div>
                    <div className="flex items-end gap-3 ml-auto">
                      {headSignatureUrl && (
                        <img
                          src={headSignatureUrl}
                          alt={`${headTitle} signature`}
                          className="max-h-10 max-w-[110px] object-contain"
                        />
                      )}
                      {headCommentBy && (
                        <span>
                          {headTitle}: <strong className="text-[#2A2A2E]">{headCommentBy}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {editingBox === 'head' && canEditHead && renderInlineCommentEditor('head')}
              </div>
            )}

            {/* 3. Principal's Comment & Approval */}
            {showPrincipalBox && (
              <div className="bg-[#FAF0F2]/50 p-4 rounded-[8px] border border-[#DFC7CA]">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[#6B1020]">
                      Principal&apos;s Comment &amp; Approval:
                    </span>
                    {approvalStatus === 'Approved' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB]">
                        <CheckCircle2 className="w-3 h-3" />
                        Approved{approvedAtFormatted ? ` • ${approvedAtFormatted}` : ''}
                      </span>
                    ) : (
                      <span className="no-print inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
                        {approvalStatus}
                      </span>
                    )}
                  </div>

                  {canEditPrincipal && editingBox !== 'principal' && (
                    <div className="no-print flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditor('principal')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-white hover:bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA] text-[11px] font-medium transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        Add / Edit Comment
                      </button>
                      {approvalStatus !== 'Approved' && (
                        <button
                          type="button"
                          disabled={isSavingBox}
                          onClick={handleQuickApprovePrincipal}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-[#2A583B] hover:bg-[#21462E] text-white text-[11px] font-medium disabled:opacity-50 transition-colors"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Approve
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {principalCommentText ? (
                  <p className="italic text-[#2A2A2E] font-medium leading-relaxed">
                    &ldquo;{principalCommentText}&rdquo;
                  </p>
                ) : (
                  <p className="text-[#7F7A72] italic min-h-[1.25rem] no-print">
                    No Principal comment entered yet.
                  </p>
                )}

                <div className="mt-3 pt-2 border-t border-[#DFC7CA]/60 flex flex-wrap items-end justify-between gap-3 text-[11px] text-[#6E6A63]">
                  <div className="space-y-0.5">
                    <div>
                      Next Term Resumption:{' '}
                      <strong className="text-[#2A2A2E]">
                        {nextTermResumption || schoolSettings.nextTermResumption || 'To be announced'}
                      </strong>
                    </div>
                    {approvedAtFormatted && (
                      <div>
                        Approval Date:{' '}
                        <strong className="text-[#2A583B]">{approvedAtFormatted}</strong>
                      </div>
                    )}
                  </div>

                  <div className="flex items-end gap-3 ml-auto">
                    {principalSignatureUrl && (
                      <img
                        src={principalSignatureUrl}
                        alt="Principal signature"
                        className="max-h-10 max-w-[110px] object-contain"
                      />
                    )}
                    {principalCommentBy && (
                      <span>
                        Signed: <strong className="text-[#2A2A2E]">{principalCommentBy}</strong>
                      </span>
                    )}
                  </div>
                </div>

                {editingBox === 'principal' &&
                  canEditPrincipal &&
                  renderInlineCommentEditor('principal')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
