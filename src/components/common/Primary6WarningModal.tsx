import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, CheckCircle2, Trash2, Users, X } from 'lucide-react';
import { SchoolClass, UserRole } from '../../types';
import { DEFAULT_SCHOOL_CLASSES } from '../../data/sampleData';
import {
  migratePrimary6StudentsToClass,
  Primary6DependencySummary,
  removePrimary6ClassAndAssignments,
  subscribeClasses,
} from '../../services/academicService';
import { getActiveClasses, groupClassesBySection, isPrimary6Class } from '../../utils/classUtils';
import { extractFriendlyError } from '../../services/schoolService';

interface Primary6WarningModalProps {
  isOpen: boolean;
  summary: Primary6DependencySummary | null;
  classesList?: SchoolClass[];
  userRole: UserRole;
  onClose: () => void;
  onRefreshSummary: () => Promise<Primary6DependencySummary | null>;
}

export const Primary6WarningModal: React.FC<Primary6WarningModalProps> = ({
  isOpen,
  summary,
  classesList,
  userRole,
  onClose,
  onRefreshSummary,
}) => {
  const [liveClasses, setLiveClasses] = useState<SchoolClass[]>(
    classesList && classesList.length > 0 ? classesList : DEFAULT_SCHOOL_CLASSES
  );
  const [targetClassId, setTargetClassId] = useState<string>('');
  const [isWorking, setIsWorking] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (classesList && classesList.length > 0) {
      setLiveClasses(classesList);
      return;
    }
    if (!isOpen) return;
    const unsub = subscribeClasses(
      (cls) => setLiveClasses(cls.length > 0 ? cls : DEFAULT_SCHOOL_CLASSES),
      () => {}
    );
    return () => unsub();
  }, [isOpen, classesList]);

  const availableTargets = useMemo(
    () => getActiveClasses(liveClasses).filter((c) => !isPrimary6Class(c)),
    [liveClasses]
  );

  const groupedTargets = useMemo(
    () => groupClassesBySection(availableTargets),
    [availableTargets]
  );

  useEffect(() => {
    if (!isOpen) {
      setErrorMsg('');
      setSuccessMsg('');
      return;
    }
    const preferred =
      availableTargets.find((c) => c.name.trim().toLowerCase() === 'primary 5') ||
      availableTargets.find((c) => c.name.trim().toLowerCase() === 'jss 1') ||
      availableTargets[0];
    setTargetClassId((prev) =>
      prev && availableTargets.some((c) => c.id === prev) ? prev : preferred?.id || ''
    );
  }, [isOpen, availableTargets]);

  if (!isOpen || !summary) return null;

  const affectedItems: Array<{ label: string; countText: string }> = [];
  if (summary.studentsCount > 0) {
    affectedItems.push({
      label: 'Enrolled Pupils',
      countText: `${summary.studentsCount} pupil${summary.studentsCount === 1 ? '' : 's'}`,
    });
  }
  if (summary.academicsCount > 0 || summary.resultReviewsCount > 0) {
    const parts: string[] = [];
    if (summary.academicsCount > 0) {
      parts.push(`${summary.academicsCount} academic score${summary.academicsCount === 1 ? '' : 's'}`);
    }
    if (summary.resultReviewsCount > 0) {
      parts.push(`${summary.resultReviewsCount} report review${summary.resultReviewsCount === 1 ? '' : 's'}`);
    }
    affectedItems.push({
      label: 'Scores & Report Cards',
      countText: parts.join(', '),
    });
  }
  if (summary.attendanceCount > 0) {
    affectedItems.push({
      label: 'Attendance Records',
      countText: `${summary.attendanceCount} attendance log${summary.attendanceCount === 1 ? '' : 's'}`,
    });
  }
  if (summary.feesCount > 0 || summary.feeSchedulesCount > 0) {
    const parts: string[] = [];
    if (summary.feesCount > 0) {
      parts.push(`${summary.feesCount} student fee item${summary.feesCount === 1 ? '' : 's'}`);
    }
    if (summary.feeSchedulesCount > 0) {
      parts.push(`${summary.feeSchedulesCount} fee schedule${summary.feeSchedulesCount === 1 ? '' : 's'}`);
    }
    affectedItems.push({
      label: 'Fee Records',
      countText: parts.join(', '),
    });
  }
  if (
    summary.teachersCount > 0 ||
    summary.subjectAssignmentsCount > 0 ||
    summary.staffInvitesCount > 0 ||
    summary.hasFormTeacher
  ) {
    const parts: string[] = [];
    if (summary.hasFormTeacher) {
      parts.push(`Form teacher: ${summary.formTeacherNames.join(', ')}`);
    }
    if (summary.teachersCount > 0) {
      parts.push(`${summary.teachersCount} staff profile${summary.teachersCount === 1 ? '' : 's'}`);
    }
    if (summary.subjectAssignmentsCount > 0) {
      parts.push(
        `${summary.subjectAssignmentsCount} subject assignment${summary.subjectAssignmentsCount === 1 ? '' : 's'}`
      );
    }
    if (summary.staffInvitesCount > 0) {
      parts.push(
        `${summary.staffInvitesCount} staff invite${summary.staffInvitesCount === 1 ? '' : 's'}`
      );
    }
    affectedItems.push({
      label: 'Teacher Assignments',
      countText: parts.join(' · '),
    });
  }
  if (summary.timetableCount > 0) {
    affectedItems.push({
      label: 'Timetable Slots',
      countText: `${summary.timetableCount} timetable slot${summary.timetableCount === 1 ? '' : 's'}`,
    });
  }

  const handleMovePupils = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetClass = availableTargets.find((c) => c.id === targetClassId);
    if (!targetClass) return;

    setIsWorking(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await migratePrimary6StudentsToClass(targetClass);
      await onRefreshSummary();
      setSuccessMsg(
        `Moved ${res.migratedCount} pupil${res.migratedCount === 1 ? '' : 's'} from Primary 6 to ${targetClass.name}.`
      );
    } catch (err) {
      setErrorMsg(extractFriendlyError(err, 'Failed to move Primary 6 pupils.'));
    } finally {
      setIsWorking(false);
    }
  };

  const handleRemovePrimary6 = async () => {
    setIsWorking(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await removePrimary6ClassAndAssignments();
      await onRefreshSummary();
      onClose();
    } catch (err) {
      setErrorMsg(extractFriendlyError(err, 'Unable to remove Primary 6 class record.'));
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#2A2A2E]/60 backdrop-blur-xs flex items-center justify-center p-4 no-print">
      <div className="bg-white rounded-[10px] max-w-lg w-full max-h-[calc(100vh-48px)] flex flex-col shadow-[0_12px_36px_rgba(42,42,46,0.2)] border border-[#E6DFD3]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#EFE9DF] shrink-0">
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6] flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="w-4.5 h-4.5 text-[#9A6E1B]" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#2A2A2E] leading-snug">
                Primary 6 Has Linked Data in Firestore
              </h2>
              <p className="text-xs text-[#6E6A63] mt-0.5">
                Primary 6 is hidden from all class lists, but existing database records were found.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors"
            aria-label="Close warning"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto space-y-4 text-xs">
          <p className="text-[#5E5B56] leading-relaxed">
            Nothing has been deleted silently. Review what is currently linked to{' '}
            <strong className="text-[#2A2A2E]">Primary 6</strong> before taking action:
          </p>

          {affectedItems.length > 0 && (
            <div className="rounded-[8px] border border-[#E3CFA6] bg-[#FBF5E8]/60 divide-y divide-[#EFE3C8]">
              {affectedItems.map((item) => (
                <div
                  key={item.label}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                >
                  <span className="font-semibold text-[#2A2A2E]">{item.label}</span>
                  <span className="text-[#7D5A18] font-medium text-right">{item.countText}</span>
                </div>
              ))}
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-[8px] bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E]">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-[8px] bg-[#EEF4F0] border border-[#C5D6CB] text-[#2A583B] flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {summary.studentsCount > 0 ? (
            <form
              onSubmit={handleMovePupils}
              className="p-3.5 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] space-y-3"
            >
              <div className="flex items-center gap-2 text-[#2A2A2E] font-semibold">
                <Users className="w-4 h-4 text-[#6B1020]" />
                <span>Move {summary.studentsCount} Primary 6 Pupil(s) to Another Class</span>
              </div>
              <p className="text-[11px] text-[#5E5B56] leading-relaxed">
                Reassigns pupils to the selected class while preserving their existing scores, attendance history, and fee records.
              </p>
              <div>
                <label className="block font-semibold text-[#2A2A2E] mb-1">
                  Destination Class *
                </label>
                <select
                  required
                  value={targetClassId}
                  onChange={(e) => setTargetClassId(e.target.value)}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                >
                  <option value="">-- Select destination class --</option>
                  {groupedTargets.map((g) => (
                    <optgroup key={g.section} label={g.label}>
                      {g.classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isWorking || !targetClassId}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium disabled:opacity-50 transition-colors"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  {isWorking ? 'Moving Pupils...' : 'Move Pupils to Selected Class'}
                </button>
              </div>
            </form>
          ) : (
            <div className="p-3.5 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] space-y-2">
              <p className="font-semibold text-[#2A2A2E]">No enrolled pupils remain in Primary 6.</p>
              <p className="text-[11px] text-[#5E5B56] leading-relaxed">
                Removing Primary 6 clears the class entry and any active teacher, subject, timetable, or fee-schedule links while keeping historical student scores, attendance logs, and fee records untouched.
              </p>
              {userRole !== 'director' && (
                <p className="text-[11px] text-[#7D5A18] font-medium">
                  Only the School Director can permanently delete the Primary 6 class record from Firestore.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[#EFE9DF] flex flex-wrap items-center justify-end gap-2 shrink-0 bg-[#FAF8F4]/60 rounded-b-[10px]">
          <button
            type="button"
            onClick={onClose}
            disabled={isWorking}
            className="px-4 py-2 rounded-[8px] bg-white border border-[#DDD5C7] hover:bg-[#FAF8F4] text-[#2A2A2E] text-xs font-medium transition-colors"
          >
            Cancel
          </button>

          {userRole === 'director' && summary.studentsCount === 0 && (
            <button
              type="button"
              onClick={handleRemovePrimary6}
              disabled={isWorking}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#86222E] hover:bg-[#6E1A24] text-white text-xs font-medium disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isWorking ? 'Removing...' : 'Remove Primary 6 Class'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
