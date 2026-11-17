import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheck,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Save,
  Users,
  Search,
  Printer,
  ShieldCheck,
  Pencil,
  Lock,
  History,
  BarChart3,
  Building2,
  FileText,
  X,
  ArrowRight,
  UserCheck,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AcademicTerm, AttendanceRecord, SchoolClass, Student } from '../types';
import { SAMPLE_CLASSES } from '../data/sampleData';
import { subscribeClasses } from '../services/academicService';
import { doesStudentBelongToClass, getActiveClasses, groupClassesBySection } from '../utils/classUtils';
import { subscribeStudents } from '../services/schoolService';
import {
  AttendanceStatus,
  computeAttendanceSummary,
  computeClassBreakdown,
  correctAttendanceRecordInFirestore,
  getMonthDateRange,
  getSchoolWeekRange,
  saveClassAttendanceToFirestore,
  subscribeAttendance,
} from '../services/attendanceService';
import { SchoolLogo } from '../components/common/SchoolLogo';

type AttendanceTab = 'register' | 'summaries' | 'history' | 'school';
type SummaryPeriod = 'daily' | 'weekly' | 'monthly' | 'termly';

interface DraftEntry {
  status: AttendanceStatus;
  remark: string;
}

function getRealErrorMessage(err: unknown, fallback: string): string {
  if (!err) return fallback;
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error) {
      return String(parsed.error);
    }
  } catch {
    // Not JSON
  }
  return raw || fallback;
}

export const AttendancePage: React.FC = () => {
  const { role, currentUser, firebaseUser, schoolSettings } = useAuth();
  const isLiveFirestore = Boolean(firebaseUser);
  const isAdmin = role === 'director' || role === 'principal';
  const isTeacher = role === 'teacher';
  const isParent = role === 'parent';

  // Active tab (Parents default to individual ward history)
  const [activeTab, setActiveTab] = useState<AttendanceTab>(
    isParent ? 'history' : 'register'
  );

  // Sync tab if role switches in demo mode
  useEffect(() => {
    if (isParent && (activeTab === 'register' || activeTab === 'school')) {
      setActiveTab('history');
    } else if (!isAdmin && activeTab === 'school') {
      setActiveTab('register');
    }
  }, [isParent, isAdmin, activeTab]);

  // Live Classes, Students & Saved Attendance Records
  const [classesList, setClassesList] = useState<SchoolClass[]>(SAMPLE_CLASSES);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [savedRecords, setSavedRecords] = useState<AttendanceRecord[]>([]);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(isLiveFirestore);
  const [dataError, setDataError] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  // Teacher Class Scoping
  const teacherAssignedClasses = useMemo(() => {
    return (currentUser?.assignedClasses || []).filter(Boolean);
  }, [currentUser]);

  const availableClasses = useMemo(() => {
    const active = getActiveClasses(classesList);
    if (isTeacher) {
      return active.filter((c) => teacherAssignedClasses.includes(c.name));
    }
    return active;
  }, [classesList, isTeacher, teacherAssignedClasses]);

  // Register Controls
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [selectedClass, setSelectedClass] = useState<string>(
    availableClasses[0]?.name || SAMPLE_CLASSES[0].name
  );
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedTerm, setSelectedTerm] = useState<AcademicTerm>(
    schoolSettings.currentTerm
  );
  const selectedSession = schoolSettings.currentSession;

  // Ensure selectedClass remains valid when role/assigned classes change
  useEffect(() => {
    if (availableClasses.length > 0) {
      const exists = availableClasses.some((c) => c.name === selectedClass);
      if (!exists) {
        setSelectedClass(availableClasses[0].name);
      }
    }
  }, [availableClasses, selectedClass]);

  // Subscribe to Firestore Classes, Students & Attendance when authenticated
  useEffect(() => {
    if (!firebaseUser) {
      setStudentsList([]);
      setSavedRecords([]);
      setIsLoadingData(false);
      setDataError('');
      return;
    }

    setIsLoadingData(true);
    setDataError('');

    const unsubClasses = subscribeClasses(
      (liveClasses) => setClassesList(liveClasses.length > 0 ? liveClasses : SAMPLE_CLASSES),
      (err) => setDataError(err)
    );

    const unsubStudents = subscribeStudents(
      role,
      currentUser,
      firebaseUser.email,
      (liveStudents) => {
        setStudentsList(liveStudents);
      },
      (err) => setDataError(err)
    );

    const unsubAttendance = subscribeAttendance(
      role,
      currentUser,
      firebaseUser.email,
      (liveRecords) => {
        setSavedRecords(liveRecords);
        setIsLoadingData(false);
      },
      (err) => {
        setDataError(err);
        setIsLoadingData(false);
      }
    );

    return () => {
      unsubClasses();
      unsubStudents();
      unsubAttendance();
    };
  }, [firebaseUser, role, currentUser]);

  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(''), 5500);
    return () => clearTimeout(t);
  }, [successMsg]);

  // Scoped students list (when in demo mode, apply RBAC locally too)
  const scopedStudents = useMemo(() => {
    return studentsList.filter((s) => {
      if (!isLiveFirestore) {
        if (isParent) {
          const linked = currentUser?.linkedStudentIds || ['std-001'];
          return (
            linked.includes(s.id) ||
            s.guardianEmail.toLowerCase() === (currentUser?.email || '').toLowerCase()
          );
        }
        if (isTeacher) {
          return teacherAssignedClasses.includes(s.className);
        }
      }
      return true;
    });
  }, [studentsList, isLiveFirestore, isParent, isTeacher, currentUser, teacherAssignedClasses]);

  // Registered active pupils in the selected class
  const selectedClassObj = useMemo(
    () => classesList.find((c) => c.name === selectedClass),
    [classesList, selectedClass]
  );

  const pupilsInSelectedClass = useMemo(() => {
    return scopedStudents
      .filter((s) => {
        if (s.status !== 'Active') return false;
        if (selectedClassObj) return doesStudentBelongToClass(s, selectedClassObj);
        return s.className === selectedClass;
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [scopedStudents, selectedClass, selectedClassObj]);

  // Actual saved records for the selected (className, date)
  const savedForSelectedClassDate = useMemo(() => {
    return savedRecords.filter(
      (r) => r.className === selectedClass && r.date === selectedDate
    );
  }, [savedRecords, selectedClass, selectedDate]);

  const hasExistingRegister = savedForSelectedClassDate.length > 0;

  // Correction Mode state & Draft map
  const [isCorrectionMode, setIsCorrectionMode] = useState<boolean>(false);
  const [correctionReason, setCorrectionReason] = useState<string>('');
  const [correctionReasonError, setCorrectionReasonError] = useState<string>('');
  const [draftMap, setDraftMap] = useState<Record<string, DraftEntry>>({});
  const [isSavingRegister, setIsSavingRegister] = useState<boolean>(false);
  const correctionReasonInputRef = useRef<HTMLInputElement | null>(null);
  const prevClassDateRef = useRef<string>('');

  // Sync draftMap when class/date changes without wiping active Correction Mode or unsaved edits on snapshot ticks
  useEffect(() => {
    const classDateKey = `${selectedClass}__${selectedDate}`;
    const isClassOrDateChanged = prevClassDateRef.current !== classDateKey;
    prevClassDateRef.current = classDateKey;

    const savedByStudent = new Map<string, AttendanceRecord>();
    savedForSelectedClassDate.forEach((r) => savedByStudent.set(r.studentId, r));

    if (isClassOrDateChanged) {
      const next: Record<string, DraftEntry> = {};
      pupilsInSelectedClass.forEach((p) => {
        const existing = savedByStudent.get(p.id);
        next[p.id] = existing
          ? { status: existing.status, remark: existing.remark || '' }
          : { status: 'Present', remark: '' };
      });
      setDraftMap(next);
      setIsCorrectionMode(false);
      setCorrectionReason('');
      setCorrectionReasonError('');
      return;
    }

    setDraftMap((prev) => {
      const next: Record<string, DraftEntry> = {};
      pupilsInSelectedClass.forEach((p) => {
        const existing = savedByStudent.get(p.id);
        if (isCorrectionMode) {
          // Preserve in-progress correction edits; only populate pupils not yet in draft
          next[p.id] = prev[p.id]
            ? prev[p.id]
            : existing
            ? { status: existing.status, remark: existing.remark || '' }
            : { status: 'Present', remark: '' };
        } else if (existing) {
          next[p.id] = { status: existing.status, remark: existing.remark || '' };
        } else {
          // Preserve unsaved fresh roll call edits while register has not yet been saved
          next[p.id] = prev[p.id] ? prev[p.id] : { status: 'Present', remark: '' };
        }
      });
      return next;
    });
  }, [selectedClass, selectedDate, pupilsInSelectedClass, savedForSelectedClassDate, isCorrectionMode]);

  const isRegisterEditable = !hasExistingRegister || isCorrectionMode;

  const updatePupilDraft = (
    studentId: string,
    patch: Partial<DraftEntry>
  ) => {
    if (!isRegisterEditable) return;
    setDraftMap((prev) => ({
      ...prev,
      [studentId]: {
        status: prev[studentId]?.status || 'Present',
        remark: prev[studentId]?.remark || '',
        ...patch,
      },
    }));
  };

  const handleMarkAllPresent = () => {
    if (!isRegisterEditable) return;
    const next: Record<string, DraftEntry> = {};
    pupilsInSelectedClass.forEach((p) => {
      next[p.id] = {
        status: 'Present',
        remark: draftMap[p.id]?.remark || 'On time',
      };
    });
    setDraftMap(next);
  };

  // Save Register (Create or Authorized Correction)
  const handleSaveRegister = async () => {
    if (isParent) return;
    setSuccessMsg('');
    setDataError('');
    setCorrectionReasonError('');

    if (isTeacher && !teacherAssignedClasses.includes(selectedClass)) {
      const msg = 'Unauthorized: You can only record attendance for your assigned classes.';
      console.error(msg);
      setDataError(msg);
      return;
    }
    if (pupilsInSelectedClass.length === 0) {
      const msg = `No active registered pupils found in ${selectedClass}.`;
      console.error(msg);
      setDataError(msg);
      return;
    }
    if (hasExistingRegister && !isCorrectionMode) {
      const msg = `Duplicate Attendance Prevented: Register for ${selectedClass} on ${selectedDate} is already saved. Click "Correct Saved Register" to edit.`;
      console.error(msg);
      setDataError(msg);
      return;
    }
    if (hasExistingRegister && isCorrectionMode && !correctionReason.trim()) {
      setCorrectionReasonError('Please enter a reason for this correction');
      correctionReasonInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      correctionReasonInputRef.current?.focus();
      return;
    }

    const classMeta = classesList.find((c) => c.name === selectedClass);
    const entries = pupilsInSelectedClass.map((pupil) => {
      const entry = draftMap[pupil.id] || { status: 'Present' as AttendanceStatus, remark: '' };
      return {
        studentId: pupil.id,
        studentName: pupil.fullName,
        admissionNo: pupil.admissionNo,
        guardianEmail: pupil.guardianEmail || '',
        status: entry.status,
        remark: entry.remark || '',
      };
    });

    setIsSavingRegister(true);
    try {
      if (!isLiveFirestore) {
        throw new Error('Authentication required to save attendance records.');
      }

      const res = await saveClassAttendanceToFirestore({
        classId: classMeta?.id || selectedClass,
        className: selectedClass,
        date: selectedDate,
        term: selectedTerm,
        session: selectedSession,
        entries,
        markedBy: currentUser?.displayName || firebaseUser?.email || 'Staff',
        markedByUid: firebaseUser?.uid || currentUser?.uid || 'staff',
        allowCorrection: isCorrectionMode,
        correctionReason,
      });

      // Immediately refresh savedRecords so summary cards reflect newly saved/corrected data
      setSavedRecords((prev) => {
        const byId = new Map<string, AttendanceRecord>();
        prev.forEach((rec) => byId.set(rec.id, rec));
        res.savedRecords.forEach((rec) => byId.set(rec.id, rec));
        const merged = Array.from(byId.values());
        merged.sort((a, b) => b.date.localeCompare(a.date) || a.studentName.localeCompare(b.studentName));
        return merged;
      });

      setIsCorrectionMode(false);
      setCorrectionReason('');
      setCorrectionReasonError('');
      setSuccessMsg(
        res.updatedCount > 0 && res.createdCount > 0
          ? `Saved ${res.createdCount} new record(s) and corrected ${res.updatedCount} record(s) in ${selectedClass} (${selectedDate}).`
          : res.updatedCount > 0
          ? `Attendance corrected for ${res.updatedCount} pupil(s) in ${selectedClass} (${selectedDate}) and logged in Cloud Firestore.`
          : `Attendance saved for ${res.createdCount} pupil(s) in ${selectedClass} (${selectedDate}) to Cloud Firestore.`
      );
    } catch (err) {
      console.error('Failed to save attendance:', err);
      setDataError(getRealErrorMessage(err, 'Failed to save attendance register.'));
    } finally {
      setIsSavingRegister(false);
    }
  };

  // Summary calculation strictly from SAVED records for selected class & date
  const savedDailySummary = useMemo(() => {
    return computeAttendanceSummary(savedForSelectedClassDate);
  }, [savedForSelectedClassDate]);

  // =================== SUMMARIES & REPORTS STATE ===================
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>('daily');
  const [summaryClassFilter, setSummaryClassFilter] = useState<string>(
    isAdmin ? 'All' : availableClasses[0]?.name || 'All'
  );
  const [summaryDate, setSummaryDate] = useState<string>(todayStr);
  const [summaryMonth, setSummaryMonth] = useState<string>(todayStr.slice(0, 7));
  const [summaryTerm, setSummaryTerm] = useState<AcademicTerm>(
    schoolSettings.currentTerm
  );

  // Compute filtered records for Summary View strictly from actual saved records
  const summaryRecords = useMemo(() => {
    let base = savedRecords;

    if (summaryClassFilter !== 'All') {
      base = base.filter((r) => r.className === summaryClassFilter);
    }

    if (summaryPeriod === 'daily') {
      return base.filter((r) => r.date === summaryDate);
    }
    if (summaryPeriod === 'weekly') {
      const week = getSchoolWeekRange(summaryDate);
      return base.filter((r) => r.date >= week.start && r.date <= week.end);
    }
    if (summaryPeriod === 'monthly') {
      const monthRange = getMonthDateRange(summaryMonth);
      return base.filter((r) => r.date >= monthRange.start && r.date <= monthRange.end);
    }
    // termly
    return base.filter((r) => r.term === summaryTerm);
  }, [savedRecords, summaryClassFilter, summaryPeriod, summaryDate, summaryMonth, summaryTerm]);

  const summaryStats = useMemo(() => computeAttendanceSummary(summaryRecords), [summaryRecords]);

  // Per-pupil breakdown within summaryRecords
  const pupilSummaryRows = useMemo(() => {
    const map = new Map<
      string,
      { studentId: string; studentName: string; admissionNo: string; className: string; records: AttendanceRecord[] }
    >();
    summaryRecords.forEach((r) => {
      const current = map.get(r.studentId) || {
        studentId: r.studentId,
        studentName: r.studentName,
        admissionNo: r.admissionNo,
        className: r.className,
        records: [],
      };
      current.records.push(r);
      map.set(r.studentId, current);
    });
    return Array.from(map.values())
      .map((item) => ({
        ...item,
        stats: computeAttendanceSummary(item.records),
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName));
  }, [summaryRecords]);

  const summaryPeriodLabel = useMemo(() => {
    if (summaryPeriod === 'daily') return `Daily Report (${summaryDate})`;
    if (summaryPeriod === 'weekly') {
      const w = getSchoolWeekRange(summaryDate);
      return `Weekly Report (Mon ${w.start} – Fri ${w.end})`;
    }
    if (summaryPeriod === 'monthly') {
      return `Monthly Report (${getMonthDateRange(summaryMonth).label})`;
    }
    return `Termly Report (${summaryTerm} • ${selectedSession})`;
  }, [summaryPeriod, summaryDate, summaryMonth, summaryTerm, selectedSession]);

  // =================== PUPIL HISTORY & CORRECTION MODAL ===================
  const [historySearch, setHistorySearch] = useState<string>('');
  const [selectedHistoryStudentId, setSelectedHistoryStudentId] = useState<string>('');

  const filteredHistoryStudents = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return scopedStudents.filter(
      (s) =>
        !q ||
        s.fullName.toLowerCase().includes(q) ||
        s.admissionNo.toLowerCase().includes(q) ||
        s.className.toLowerCase().includes(q)
    );
  }, [scopedStudents, historySearch]);

  useEffect(() => {
    if (filteredHistoryStudents.length > 0) {
      const exists = filteredHistoryStudents.some((s) => s.id === selectedHistoryStudentId);
      if (!exists) {
        setSelectedHistoryStudentId(filteredHistoryStudents[0].id);
      }
    } else {
      setSelectedHistoryStudentId('');
    }
  }, [filteredHistoryStudents, selectedHistoryStudentId]);

  const selectedHistoryStudent = useMemo(
    () => scopedStudents.find((s) => s.id === selectedHistoryStudentId) || null,
    [scopedStudents, selectedHistoryStudentId]
  );

  const pupilHistoryRecords = useMemo(() => {
    if (!selectedHistoryStudent) return [];
    return savedRecords
      .filter((r) => r.studentId === selectedHistoryStudent.id)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [savedRecords, selectedHistoryStudent]);

  const pupilHistoryStats = useMemo(
    () => computeAttendanceSummary(pupilHistoryRecords),
    [pupilHistoryRecords]
  );

  // Single-record correction modal (from History or Summary)
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [editStatus, setEditStatus] = useState<AttendanceStatus>('Present');
  const [editRemark, setEditRemark] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');
  const [editReasonError, setEditReasonError] = useState<string>('');
  const [isUpdatingSingle, setIsUpdatingSingle] = useState<boolean>(false);

  const openSingleCorrection = (record: AttendanceRecord) => {
    if (isParent) return;
    if (isTeacher && !teacherAssignedClasses.includes(record.className)) return;
    setEditingRecord(record);
    setEditStatus(record.status);
    setEditRemark(record.remark || '');
    setEditReason('');
    setEditReasonError('');
  };

  const handleSaveSingleCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord) return;
    if (!editReason.trim()) {
      setEditReasonError('Please enter a reason for this correction');
      return;
    }

    setIsUpdatingSingle(true);
    setEditReasonError('');
    setDataError('');
    setSuccessMsg('');
    try {
      const updaterName = currentUser?.displayName || firebaseUser?.email || 'Authorized Staff';
      const updaterUid = firebaseUser?.uid || currentUser?.uid;
      if (!isLiveFirestore) {
        throw new Error('Authentication required to correct attendance records.');
      }

      const result = await correctAttendanceRecordInFirestore(editingRecord.id, {
        status: editStatus,
        remark: editRemark,
        correctionReason: editReason,
        updatedBy: updaterName,
        updatedByUid: updaterUid,
        oldStatus: editingRecord.status,
        oldRemark: editingRecord.remark || '',
        existingHistory: editingRecord.correctionHistory,
      });

      setSavedRecords((prev) =>
        prev.map((rec) =>
          rec.id === editingRecord.id
            ? {
                ...rec,
                status: editStatus,
                remark: editRemark.trim(),
                correctionReason: editReason.trim(),
                updatedBy: updaterName,
                updatedByUid: updaterUid,
                updatedAt: result.updatedAt,
                correctionHistory: result.correctionHistory,
              }
            : rec
        )
      );

      setSuccessMsg(
        `Corrected attendance record for ${editingRecord.studentName} on ${editingRecord.date} in Cloud Firestore.`
      );
      setEditingRecord(null);
    } catch (err) {
      console.error('Failed to correct single attendance record:', err);
      setDataError(getRealErrorMessage(err, 'Failed to correct attendance record.'));
    } finally {
      setIsUpdatingSingle(false);
    }
  };

  // =================== SCHOOL-WIDE OVERVIEW (DIRECTOR & PRINCIPAL) ===================
  const [schoolPeriod, setSchoolPeriod] = useState<SummaryPeriod>('daily');
  const [schoolDate, setSchoolDate] = useState<string>(todayStr);
  const [schoolMonth, setSchoolMonth] = useState<string>(todayStr.slice(0, 7));
  const [schoolTerm, setSchoolTerm] = useState<AcademicTerm>(schoolSettings.currentTerm);

  const schoolPeriodRecords = useMemo(() => {
    if (schoolPeriod === 'daily') {
      return savedRecords.filter((r) => r.date === schoolDate);
    }
    if (schoolPeriod === 'weekly') {
      const week = getSchoolWeekRange(schoolDate);
      return savedRecords.filter((r) => r.date >= week.start && r.date <= week.end);
    }
    if (schoolPeriod === 'monthly') {
      const m = getMonthDateRange(schoolMonth);
      return savedRecords.filter((r) => r.date >= m.start && r.date <= m.end);
    }
    return savedRecords.filter((r) => r.term === schoolTerm);
  }, [savedRecords, schoolPeriod, schoolDate, schoolMonth, schoolTerm]);

  const schoolOverallStats = useMemo(
    () => computeAttendanceSummary(schoolPeriodRecords),
    [schoolPeriodRecords]
  );

  const schoolClassBreakdown = useMemo(
    () => computeClassBreakdown(schoolPeriodRecords, classesList, studentsList),
    [schoolPeriodRecords, classesList, studentsList]
  );

  const getStatusBadgeStyle = (status: AttendanceStatus) => {
    switch (status) {
      case 'Present':
        return 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]';
      case 'Late':
        return 'bg-[#FBF5E8] text-[#7D5A18] border-[#E3CFA6]';
      case 'Absent':
        return 'bg-[#FAF0F2] text-[#86222E] border-[#E2C1C5]';
      case 'Excused':
        return 'bg-[#FAF0F2] text-[#6B1020] border-[#DFC7CA]';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Live Cloud Firestore Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB] text-xs text-[#2A583B] no-print">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#2A583B] shrink-0" />
          <span>
            <strong>Live Cloud Firestore Connected:</strong> Attendance marks, duplicate
            protections, and percentage analytics are computed strictly from real saved Firestore
            records.
          </span>
        </div>
        <span className="font-mono text-[11px] font-semibold bg-white px-2.5 py-0.5 rounded-full border border-[#C5D6CB] text-[#2A583B] tabular-nums">
          {savedRecords.length} Saved Records
        </span>
      </div>

      {/* Top Header & Navigation Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 no-print">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#2A2A2E] tracking-tight">
              Attendance Management
            </h1>
            <span className="bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA] text-xs font-medium px-2.5 py-0.5 rounded-full">
              {selectedTerm} • {selectedSession}
            </span>
          </div>
          <p className="text-xs text-[#6E6A63] mt-1">
            {isTeacher
              ? `Assigned Classes: ${
                  teacherAssignedClasses.length > 0
                    ? teacherAssignedClasses.join(', ')
                    : 'None Assigned'
                }`
              : isParent
              ? 'View your ward’s daily attendance records, percentages & printable history'
              : 'School-wide roll call, duplicate-safe registers, summaries & printable reports'}
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-1.5 bg-[#FAF8F4] p-1 rounded-[10px] border border-[#E6DFD3]">
          {!isParent && (
            <button
              onClick={() => setActiveTab('register')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors duration-150 ${
                activeTab === 'register'
                  ? 'bg-[#6B1020] text-white shadow-xs'
                  : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
              }`}
            >
              <CalendarCheck className="w-3.5 h-3.5" />
              Mark Register
            </button>
          )}
          <button
            onClick={() => setActiveTab('summaries')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors duration-150 ${
              activeTab === 'summaries'
                ? 'bg-[#6B1020] text-white shadow-xs'
                : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Summaries & Reports
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors duration-150 ${
              activeTab === 'history'
                ? 'bg-[#6B1020] text-white shadow-xs'
                : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Pupil History
          </button>
          {isAdmin && (
            <button
              onClick={() => setActiveTab('school')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors duration-150 ${
                activeTab === 'school'
                  ? 'bg-[#6B1020] text-white shadow-xs'
                  : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              School-Wide View
            </button>
          )}
        </div>
      </div>

      {/* Feedback Alerts */}
      {successMsg && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB] text-[#2A583B] text-xs font-medium no-print">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#2A583B] shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg('')} className="text-[#2A583B] hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {dataError && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] text-xs font-medium no-print">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#86222E] shrink-0" />
            <span>{dataError}</span>
          </div>
          <button onClick={() => setDataError('')} className="text-[#86222E] hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ==================== TAB 1: MARK & CORRECT DAILY REGISTER ==================== */}
      {activeTab === 'register' && !isParent && (
        <div className="space-y-6">
          {/* Teacher No Assigned Classes Notice */}
          {isTeacher && availableClasses.length === 0 ? (
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] p-10 text-center space-y-2">
              <Users className="w-9 h-9 mx-auto text-[#B5AEA4]" />
              <h3 className="font-semibold text-[#2A2A2E] text-sm">No Classes Assigned</h3>
              <p className="text-xs text-[#6E6A63] max-w-md mx-auto">
                Your teacher account does not currently have any assigned classes. Ask the School
                Director or Principal to assign classes to your profile.
              </p>
            </div>
          ) : (
            <>
              {/* Class, Date, Term Controls */}
              <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] no-print">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
                  <div className="lg:col-span-5">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                        {isTeacher ? 'Your Assigned Class' : 'Select Class / Arm'}
                      </label>
                      {isTeacher && (
                        <span className="text-[10px] text-[#6B1020] bg-[#FAF0F2] font-medium px-2 py-0.5 rounded-[6px] border border-[#DFC7CA]">
                          {availableClasses.length} Assigned
                        </span>
                      )}
                    </div>
                    <select
                      value={selectedClass}
                      onChange={(e) => setSelectedClass(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] text-[#2A2A2E] font-medium transition-colors duration-150"
                    >
                      {groupClassesBySection(availableClasses).map((g) => (
                        <optgroup key={g.section} label={g.label}>
                          {g.classes.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name} — {c.arm}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div className="lg:col-span-3">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                      Roll Call Date
                    </label>
                    <div className="relative">
                      <Calendar className="w-4 h-4 absolute left-3 top-2.5 text-[#7F7A72]" />
                      <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] text-[#2A2A2E] font-medium transition-colors duration-150"
                      />
                    </div>
                  </div>

                  <div className="lg:col-span-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                      Academic Term
                    </label>
                    <select
                      value={selectedTerm}
                      onChange={(e) => setSelectedTerm(e.target.value as AcademicTerm)}
                      className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] text-[#2A2A2E] font-medium transition-colors duration-150"
                    >
                      <option value="First Term">First Term</option>
                      <option value="Second Term">Second Term</option>
                      <option value="Third Term">Third Term</option>
                    </select>
                  </div>

                  <div className="lg:col-span-2 flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] text-xs font-medium transition-colors duration-150"
                    >
                      <Printer className="w-3.5 h-3.5 text-[#6B1020]" />
                      Print Sheet
                    </button>
                  </div>
                </div>
              </div>

              {/* Saved Daily Metrics (Strictly from actual saved records!) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 no-print">
                <div className="bg-white rounded-[10px] p-4 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
                  <span className="text-[11px] font-medium text-[#6E6A63] block">
                    Registered Pupils
                  </span>
                  <div className="text-2xl font-bold text-[#2A2A2E] mt-1 tabular-nums">
                    {pupilsInSelectedClass.length}
                  </div>
                  <span className="text-[10px] text-[#7F7A72]">Active in {selectedClass}</span>
                </div>

                <div className="bg-white rounded-[10px] p-4 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
                  <span className="text-[11px] font-medium text-[#2A583B] block">
                    Present
                  </span>
                  <div className="text-2xl font-bold text-[#2A583B] mt-1 tabular-nums">
                    {hasExistingRegister ? savedDailySummary.present : '—'}
                  </div>
                  <span className="text-[10px] text-[#7F7A72]">
                    {hasExistingRegister ? 'Saved on register' : 'Not yet saved'}
                  </span>
                </div>

                <div className="bg-white rounded-[10px] p-4 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
                  <span className="text-[11px] font-medium text-[#7D5A18] block">
                    Late
                  </span>
                  <div className="text-2xl font-bold text-[#7D5A18] mt-1 tabular-nums">
                    {hasExistingRegister ? savedDailySummary.late : '—'}
                  </div>
                  <span className="text-[10px] text-[#7F7A72]">Late arrival saved</span>
                </div>

                <div className="bg-white rounded-[10px] p-4 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
                  <span className="text-[11px] font-medium text-[#86222E] block">
                    Absent
                  </span>
                  <div className="text-2xl font-bold text-[#86222E] mt-1 tabular-nums">
                    {hasExistingRegister ? savedDailySummary.absent : '—'}
                  </div>
                  <span className="text-[10px] text-[#7F7A72]">Unexcused / absent</span>
                </div>

                <div className="bg-white rounded-[10px] p-4 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
                  <span className="text-[11px] font-medium text-[#6B1020] block">
                    Excused
                  </span>
                  <div className="text-2xl font-bold text-[#6B1020] mt-1 tabular-nums">
                    {hasExistingRegister ? savedDailySummary.excused : '—'}
                  </div>
                  <span className="text-[10px] text-[#7F7A72]">Authorized excuse</span>
                </div>

                <div className="bg-gradient-to-br from-[#6B1020] to-[#540C19] rounded-[10px] border border-[#B8913A]/40 p-4 text-white shadow-[0_1px_2px_rgba(42,42,46,0.06),0_6px_16px_rgba(42,42,46,0.08)]">
                  <span className="text-[11px] font-medium text-[#E3CFA6] block">
                    Attendance Rate
                  </span>
                  <div className="text-2xl font-bold text-white mt-1 tabular-nums">
                    {hasExistingRegister ? `${savedDailySummary.attendanceRate}%` : '—'}
                  </div>
                  <span className="text-[10px] text-[#E3CFA6]/85">
                    {hasExistingRegister
                      ? `${savedDailySummary.attendedCount}/${savedDailySummary.totalRecords} attended`
                      : 'Awaiting roll call'}
                  </span>
                </div>
              </div>

              {/* Duplicate Guard / Correction Banner */}
              {hasExistingRegister && (
                <div className="bg-[#FAF0F2] border border-[#DFC7CA] rounded-[10px] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
                  <div className="flex items-start gap-2.5 text-xs text-[#2A2A2E]">
                    <Lock className="w-4 h-4 text-[#6B1020] shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-[#6B1020]">
                        Attendance Already Saved for {selectedClass} on {selectedDate}
                      </p>
                      <p className="text-[11px] text-[#5E5B56] mt-0.5">
                        Duplicate entries for the same pupil, class, and date are blocked.{' '}
                        {isCorrectionMode
                          ? 'Correction Mode is active — provide a reason and save updates.'
                          : 'Click "Correct Saved Register" if an authorized correction is required.'}
                      </p>
                    </div>
                  </div>
                  {!isCorrectionMode ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCorrectionMode(true);
                        setDataError('');
                        setCorrectionReasonError('');
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium shrink-0 transition-colors duration-150"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Correct Saved Register
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCorrectionMode(false);
                        setCorrectionReason('');
                        setCorrectionReasonError('');
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] text-xs font-medium shrink-0 transition-colors duration-150"
                    >
                      Cancel Correction
                    </button>
                  )}
                </div>
              )}

              {/* Correction Reason Input */}
              {hasExistingRegister && isCorrectionMode && (
                <div
                  className={`rounded-[10px] p-4 space-y-2 no-print border ${
                    correctionReasonError
                      ? 'bg-[#FAF0F2] border-[#E2C1C5]'
                      : 'bg-[#FBF5E8] border-[#E3CFA6]'
                  }`}
                >
                  <label className="block text-xs font-semibold text-[#7D5A18]">
                    Reason for Attendance Correction (Audit Log) *
                  </label>
                  <input
                    ref={correctionReasonInputRef}
                    type="text"
                    placeholder="e.g. Pupil arrived with medical excuse note / clerical status correction"
                    value={correctionReason}
                    onChange={(e) => {
                      setCorrectionReason(e.target.value);
                      if (e.target.value.trim()) {
                        setCorrectionReasonError('');
                      }
                    }}
                    aria-invalid={Boolean(correctionReasonError)}
                    className={`w-full px-3 py-2 text-xs bg-white border rounded-[8px] focus:ring-2 focus:outline-none text-[#2A2A2E] ${
                      correctionReasonError
                        ? 'border-[#86222E] focus:ring-[#86222E]/20 focus:border-[#86222E]'
                        : 'border-[#E3CFA6] focus:ring-[#B8913A]/25 focus:border-[#B8913A]'
                    }`}
                  />
                  {correctionReasonError && (
                    <p role="alert" className="text-xs font-medium text-[#86222E] flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {correctionReasonError}
                    </p>
                  )}
                </div>
              )}

              {/* Printable Letterhead for Daily Register */}
              <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] overflow-hidden print-only-card">
                <div className="hidden print:flex items-center justify-between p-6 border-b-2 border-[#6B1020]">
                  <div>
                    <h2 className="font-serif text-lg font-semibold text-[#6B1020] uppercase tracking-wide">
                      {schoolSettings.schoolName}
                    </h2>
                    <p className="text-[11px] text-[#6E6A63]">{schoolSettings.address}</p>
                    <p className="text-xs font-semibold text-[#7D5A18] mt-1">
                      OFFICIAL DAILY ATTENDANCE REGISTER — {selectedClass} ({selectedDate})
                    </p>
                  </div>
                  <div className="text-right text-xs text-[#5E5B56]">
                    <p className="font-semibold text-[#2A2A2E]">{selectedTerm}</p>
                    <p>{selectedSession}</p>
                    {hasExistingRegister && (
                      <p className="font-semibold text-[#6B1020]">
                        Attendance Rate: {savedDailySummary.attendanceRate}%
                      </p>
                    )}
                  </div>
                </div>

                {/* Screen Table Header */}
                <div className="p-4 border-b border-[#EFE9DF] flex flex-wrap items-center justify-between gap-3 no-print">
                  <div>
                    <h3 className="font-semibold text-sm text-[#2A2A2E]">
                      {selectedClass} Roll Call Sheet — {selectedDate}
                    </h3>
                    <p className="text-xs text-[#6E6A63]">
                      {pupilsInSelectedClass.length} active registered pupil(s) •{' '}
                      {hasExistingRegister ? (
                        <span className="text-[#2A583B] font-medium">Saved in Register</span>
                      ) : (
                        <span className="text-[#7D5A18] font-medium">Pending Submission</span>
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {isRegisterEditable && pupilsInSelectedClass.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={handleMarkAllPresent}
                          disabled={isSavingRegister}
                          className="px-3 py-1.5 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] text-xs font-medium transition-colors duration-150 disabled:opacity-50"
                        >
                          Mark All Present
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveRegister}
                          disabled={isSavingRegister}
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-semibold shadow-xs transition-colors duration-150 disabled:opacity-50"
                        >
                          {isSavingRegister ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Save className="w-3.5 h-3.5" />
                          )}
                          {isSavingRegister ? 'Saving Attendance...' : 'Save Attendance'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                        <th className="py-3 px-4">Pupil Name</th>
                        <th className="py-3 px-4">Admission No</th>
                        <th className="py-3 px-4 text-center">Attendance Status</th>
                        <th className="py-3 px-4">Remark / Arrival Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFE9DF] text-xs">
                      {isLoadingData ? (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-[#7F7A72]">
                            Loading registered pupils & attendance records...
                          </td>
                        </tr>
                      ) : pupilsInSelectedClass.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-[#7F7A72]">
                            No active pupils are registered in {selectedClass}. Enroll or assign
                            students in Student Management first.
                          </td>
                        </tr>
                      ) : (
                        pupilsInSelectedClass.map((student) => {
                          const entry = draftMap[student.id] || {
                            status: 'Present' as AttendanceStatus,
                            remark: '',
                          };
                          const savedRec = savedForSelectedClassDate.find(
                            (r) => r.studentId === student.id
                          );

                          return (
                            <tr key={student.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-3">
                                  {student.passportPhoto ? (
                                    <img
                                      src={student.passportPhoto}
                                      alt={student.fullName}
                                      className="w-8 h-8 rounded-full object-cover border border-[#E6DFD3] shrink-0"
                                    />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-[#FAF0F2] border border-[#DFC7CA] text-[#6B1020] font-semibold flex items-center justify-center shrink-0">
                                      {student.fullName.charAt(0)}
                                    </div>
                                  )}
                                  <div>
                                    <p className="font-semibold text-[#2A2A2E]">{student.fullName}</p>
                                    <span className="text-[10px] text-[#7F7A72]">
                                      {student.gender}
                                      {savedRec?.updatedBy && (
                                        <> • Corrected by {savedRec.updatedBy}</>
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </td>

                              <td className="py-3 px-4 font-mono text-[#5E5B56] font-medium">
                                {student.admissionNo}
                              </td>

                              <td className="py-3 px-4">
                                {isRegisterEditable ? (
                                  <div className="flex items-center justify-center gap-1.5 flex-wrap no-print">
                                    {(['Present', 'Late', 'Absent', 'Excused'] as const).map(
                                      (st) => {
                                        const isActiveBtn = entry.status === st;
                                        const activeStyle =
                                          st === 'Present'
                                            ? 'bg-[#2A583B] text-white shadow-xs'
                                            : st === 'Late'
                                            ? 'bg-[#B8913A] text-white shadow-xs'
                                            : st === 'Absent'
                                            ? 'bg-[#86222E] text-white shadow-xs'
                                            : 'bg-[#6B1020] text-white shadow-xs';
                                        return (
                                          <button
                                            key={st}
                                            type="button"
                                            onClick={() =>
                                              updatePupilDraft(student.id, { status: st })
                                            }
                                            className={`px-2.5 py-1 rounded-[8px] text-[11px] font-medium transition-colors duration-150 ${
                                              isActiveBtn
                                                ? activeStyle
                                                : 'bg-[#FAF8F4] text-[#5E5B56] border border-[#E6DFD3] hover:bg-[#EFE9DF]'
                                            }`}
                                          >
                                            {st}
                                          </button>
                                        );
                                      }
                                    )}
                                  </div>
                                ) : null}

                                <div
                                  className={`text-center ${
                                    isRegisterEditable ? 'hidden print:block' : 'block'
                                  }`}
                                >
                                  <span
                                    className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${getStatusBadgeStyle(
                                      entry.status
                                    )}`}
                                  >
                                    {entry.status}
                                  </span>
                                </div>
                              </td>

                              <td className="py-3 px-4">
                                {isRegisterEditable ? (
                                  <input
                                    type="text"
                                    placeholder={
                                      entry.status === 'Present'
                                        ? 'Optional note (e.g. On time)'
                                        : entry.status === 'Late'
                                        ? 'Arrival time / reason'
                                        : 'Reason / parent note'
                                    }
                                    value={entry.remark}
                                    onChange={(e) =>
                                      updatePupilDraft(student.id, { remark: e.target.value })
                                    }
                                    className="w-full px-2.5 py-1.5 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] text-[#2A2A2E] placeholder:text-[#7F7A72]"
                                  />
                                ) : (
                                  <span className="text-xs text-[#5E5B56]">
                                    {entry.remark || '—'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Bottom Roll Call Sheet Action & Feedback Footer */}
                {isRegisterEditable && pupilsInSelectedClass.length > 0 && (
                  <div className="p-4 bg-[#FAF8F4] border-t border-[#EFE9DF] flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
                    <div className="text-xs flex-1">
                      {correctionReasonError ? (
                        <span className="text-[#86222E] font-medium inline-flex items-center gap-1.5">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          {correctionReasonError}
                        </span>
                      ) : dataError ? (
                        <span className="text-[#86222E] font-medium inline-flex items-center gap-1.5">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          {dataError}
                        </span>
                      ) : successMsg ? (
                        <span className="text-[#2A583B] font-medium inline-flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          {successMsg}
                        </span>
                      ) : (
                        <span className="text-[#6E6A63]">
                          {isCorrectionMode
                            ? 'Correction Mode: Review your changes and enter an audit reason above before saving.'
                            : `Ready to save attendance for ${pupilsInSelectedClass.length} pupil(s) in ${selectedClass}.`}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 justify-end shrink-0">
                      {isCorrectionMode && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsCorrectionMode(false);
                            setCorrectionReason('');
                            setCorrectionReasonError('');
                          }}
                          disabled={isSavingRegister}
                          className="px-3.5 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] text-xs font-medium transition-colors duration-150 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleSaveRegister}
                        disabled={isSavingRegister}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-semibold shadow-xs transition-colors duration-150 disabled:opacity-50"
                      >
                        {isSavingRegister ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        {isSavingRegister
                          ? isCorrectionMode
                            ? 'Saving Corrections...'
                            : 'Saving Attendance...'
                          : isCorrectionMode
                          ? 'Save Attendance Corrections'
                          : 'Save Attendance'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Printable Signatory Block */}
                <div className="hidden print:grid grid-cols-2 gap-10 p-6 pt-10 text-xs text-[#5E5B56]">
                  <div className="border-t border-[#7F7A72] pt-2">
                    <p className="font-semibold text-[#2A2A2E]">Form / Class Teacher Signature</p>
                    <p>Date: {selectedDate}</p>
                  </div>
                  <div className="border-t border-[#7F7A72] pt-2 text-right">
                    <p className="font-semibold text-[#2A2A2E]">{schoolSettings.principalName}</p>
                    <p>Principal Endorsement</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ==================== TAB 2: DAILY, WEEKLY, MONTHLY & TERMLY SUMMARIES ==================== */}
      {activeTab === 'summaries' && (
        <div className="space-y-6">
          {/* Period & Scope Controls */}
          <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-3 no-print">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {(['daily', 'weekly', 'monthly', 'termly'] as const).map((period) => (
                  <button
                    key={period}
                    onClick={() => setSummaryPeriod(period)}
                    className={`px-3 py-1.5 rounded-[8px] text-xs font-medium capitalize transition-colors duration-150 ${
                      summaryPeriod === period
                        ? 'bg-[#6B1020] text-white'
                        : 'bg-[#FAF8F4] text-[#5E5B56] border border-[#E6DFD3] hover:bg-[#EFE9DF]'
                    }`}
                  >
                    {period} Summary
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium shadow-xs transition-colors duration-150"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Summary Report
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 pt-2 border-t border-[#EFE9DF]">
              {!isParent && (
                <div className="lg:col-span-5">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                    Class Scope
                  </label>
                  <select
                    value={summaryClassFilter}
                    onChange={(e) => setSummaryClassFilter(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  >
                    <option value="All">
                      {isAdmin ? 'All Classes (School-Wide)' : 'All My Assigned Classes'}
                    </option>
                    {groupClassesBySection(availableClasses).map((g) => (
                      <optgroup key={g.section} label={g.label}>
                        {g.classes.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              )}

              {(summaryPeriod === 'daily' || summaryPeriod === 'weekly') && (
                <div className={isParent ? 'lg:col-span-6' : 'lg:col-span-4'}>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                    {summaryPeriod === 'daily' ? 'Select Date' : 'Select Any Date in Week (Mon–Fri)'}
                  </label>
                  <input
                    type="date"
                    value={summaryDate}
                    onChange={(e) => setSummaryDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
              )}

              {summaryPeriod === 'monthly' && (
                <div className={isParent ? 'lg:col-span-6' : 'lg:col-span-4'}>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                    Select Month
                  </label>
                  <input
                    type="month"
                    value={summaryMonth}
                    onChange={(e) => setSummaryMonth(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
              )}

              {summaryPeriod === 'termly' && (
                <div className={isParent ? 'lg:col-span-6' : 'lg:col-span-4'}>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                    Select Academic Term
                  </label>
                  <select
                    value={summaryTerm}
                    onChange={(e) => setSummaryTerm(e.target.value as AcademicTerm)}
                    className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  >
                    <option value="First Term">First Term</option>
                    <option value="Second Term">Second Term</option>
                    <option value="Third Term">Third Term</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Printable Summary Wrapper */}
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] overflow-hidden print-only-card">
            {/* Print Letterhead */}
            <div className="hidden print:flex items-center justify-between p-6 border-b-2 border-[#6B1020]">
              <div>
                <h2 className="font-serif text-lg font-semibold text-[#6B1020] uppercase tracking-wide">
                  {schoolSettings.schoolName}
                </h2>
                <p className="text-[11px] text-[#6E6A63]">{schoolSettings.address}</p>
                <p className="text-xs font-semibold text-[#7D5A18] mt-1">
                  ATTENDANCE SUMMARY REPORT — {summaryPeriodLabel}
                </p>
              </div>
              <div className="text-right text-xs">
                <p className="font-semibold text-[#2A2A2E]">
                  Scope: {summaryClassFilter === 'All' ? 'All Authorized Classes' : summaryClassFilter}
                </p>
                <p className="text-[#6E6A63]">{selectedSession}</p>
              </div>
            </div>

            <div className="p-5 border-b border-[#EFE9DF] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-sm text-[#2A2A2E]">{summaryPeriodLabel}</h3>
                  <p className="text-xs text-[#6E6A63]">
                    Calculated strictly from {summaryStats.totalRecords} saved attendance mark(s)
                    across {summaryStats.uniqueDays} recorded school day(s)
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[8px] bg-[#FAF0F2] border border-[#DFC7CA] text-xs font-medium text-[#6B1020] tabular-nums">
                  Attendance Rate: {summaryStats.attendanceRate}% • Punctuality:{' '}
                  {summaryStats.punctualityRate}%
                </div>
              </div>

              {/* Calculated KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="p-3 rounded-[10px] bg-[#FAF8F4] border border-[#E6DFD3]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                    Total Saved Marks
                  </span>
                  <span className="text-xl font-bold text-[#2A2A2E] tabular-nums">
                    {summaryStats.totalRecords}
                  </span>
                </div>
                <div className="p-3 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#2A583B] block">
                    Present
                  </span>
                  <span className="text-xl font-bold text-[#2A583B] tabular-nums">
                    {summaryStats.present}
                  </span>
                </div>
                <div className="p-3 rounded-[10px] bg-[#FBF5E8] border border-[#E3CFA6]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7D5A18] block">
                    Late
                  </span>
                  <span className="text-xl font-bold text-[#7D5A18] tabular-nums">
                    {summaryStats.late}
                  </span>
                </div>
                <div className="p-3 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#86222E] block">
                    Absent
                  </span>
                  <span className="text-xl font-bold text-[#86222E] tabular-nums">
                    {summaryStats.absent}
                  </span>
                </div>
                <div className="p-3 rounded-[10px] bg-[#FAF0F2] border border-[#DFC7CA]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B1020] block">
                    Excused
                  </span>
                  <span className="text-xl font-bold text-[#6B1020] tabular-nums">
                    {summaryStats.excused}
                  </span>
                </div>
                <div className="p-3 rounded-[10px] bg-gradient-to-br from-[#6B1020] to-[#540C19] border border-[#B8913A]/40 text-white">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#E3CFA6] block">
                    Attendance %
                  </span>
                  <span className="text-xl font-bold text-white tabular-nums">
                    {summaryStats.totalRecords > 0 ? `${summaryStats.attendanceRate}%` : '0%'}
                  </span>
                </div>
              </div>
            </div>

            {/* Pupil Attendance Summary Breakdown */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                    <th className="py-3 px-4">Pupil</th>
                    <th className="py-3 px-4">Admission No</th>
                    <th className="py-3 px-4">Class</th>
                    <th className="py-3 px-4 text-center">Days Recorded</th>
                    <th className="py-3 px-4 text-center">Present</th>
                    <th className="py-3 px-4 text-center">Late</th>
                    <th className="py-3 px-4 text-center">Absent</th>
                    <th className="py-3 px-4 text-center">Excused</th>
                    <th className="py-3 px-4 text-right">Attendance %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE9DF] text-xs">
                  {pupilSummaryRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-[#7F7A72]">
                        No saved attendance records found for {summaryPeriodLabel}. Record daily
                        registers on the Mark Register tab to generate calculations.
                      </td>
                    </tr>
                  ) : (
                    pupilSummaryRows.map((row) => (
                      <tr key={row.studentId} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                        <td className="py-3 px-4 font-semibold text-[#2A2A2E]">{row.studentName}</td>
                        <td className="py-3 px-4 font-mono text-[#5E5B56]">{row.admissionNo}</td>
                        <td className="py-3 px-4 text-[#5E5B56]">{row.className}</td>
                        <td className="py-3 px-4 text-center font-medium tabular-nums">
                          {row.stats.totalRecords}
                        </td>
                        <td className="py-3 px-4 text-center text-[#2A583B] font-semibold tabular-nums">
                          {row.stats.present}
                        </td>
                        <td className="py-3 px-4 text-center text-[#7D5A18] font-semibold tabular-nums">
                          {row.stats.late}
                        </td>
                        <td className="py-3 px-4 text-center text-[#86222E] font-semibold tabular-nums">
                          {row.stats.absent}
                        </td>
                        <td className="py-3 px-4 text-center text-[#6B1020] font-semibold tabular-nums">
                          {row.stats.excused}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full font-medium text-[11px] border tabular-nums ${
                              row.stats.attendanceRate >= 85
                                ? 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]'
                                : row.stats.attendanceRate >= 70
                                ? 'bg-[#FBF5E8] text-[#7D5A18] border-[#E3CFA6]'
                                : 'bg-[#FAF0F2] text-[#86222E] border-[#E2C1C5]'
                            }`}
                          >
                            {row.stats.attendanceRate}%
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 3: INDIVIDUAL PUPIL ATTENDANCE HISTORY ==================== */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* Pupil Selector Bar */}
          <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] no-print">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-5 relative">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                  Search Pupil
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#7F7A72]" />
                  <input
                    type="text"
                    placeholder="Filter by pupil name, admission no, or class..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] placeholder:text-[#7F7A72] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
              </div>

              <div className="sm:col-span-5">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                  Select Pupil Record
                </label>
                <select
                  value={selectedHistoryStudentId}
                  onChange={(e) => setSelectedHistoryStudentId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                >
                  {filteredHistoryStudents.length === 0 ? (
                    <option value="">No authorized pupils found</option>
                  ) : (
                    filteredHistoryStudents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} — {s.admissionNo} ({s.className})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  disabled={!selectedHistoryStudent}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium disabled:opacity-50 transition-colors duration-150"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print History
                </button>
              </div>
            </div>
          </div>

          {selectedHistoryStudent ? (
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] overflow-hidden print-only-card">
              {/* Printable Header */}
              <div className="p-6 border-b border-[#E6DFD3] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="hidden print:block font-serif text-xs font-semibold uppercase tracking-wide text-[#6B1020] mb-1">
                    {schoolSettings.schoolName} — Individual Pupil Attendance History
                  </p>
                  <h3 className="text-lg font-semibold text-[#2A2A2E]">
                    {selectedHistoryStudent.fullName}
                  </h3>
                  <p className="text-xs text-[#6E6A63] font-mono">
                    {selectedHistoryStudent.admissionNo} • {selectedHistoryStudent.className} •{' '}
                    Guardian: {selectedHistoryStudent.guardianName}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                      Calculated Attendance
                    </span>
                    <span className="text-2xl font-bold text-[#6B1020] tabular-nums">
                      {pupilHistoryStats.totalRecords > 0
                        ? `${pupilHistoryStats.attendanceRate}%`
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Stats Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 bg-[#FAF8F4] border-b border-[#EFE9DF]">
                <div className="bg-white p-3 rounded-[10px] border border-[#E6DFD3]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                    Days Recorded
                  </span>
                  <span className="text-lg font-bold text-[#2A2A2E] tabular-nums">
                    {pupilHistoryStats.totalRecords}
                  </span>
                </div>
                <div className="bg-white p-3 rounded-[10px] border border-[#C5D6CB]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#2A583B] block">
                    Present
                  </span>
                  <span className="text-lg font-bold text-[#2A583B] tabular-nums">
                    {pupilHistoryStats.present}
                  </span>
                </div>
                <div className="bg-white p-3 rounded-[10px] border border-[#E3CFA6]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7D5A18] block">
                    Late
                  </span>
                  <span className="text-lg font-bold text-[#7D5A18] tabular-nums">
                    {pupilHistoryStats.late}
                  </span>
                </div>
                <div className="bg-white p-3 rounded-[10px] border border-[#E2C1C5]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#86222E] block">
                    Absent
                  </span>
                  <span className="text-lg font-bold text-[#86222E] tabular-nums">
                    {pupilHistoryStats.absent}
                  </span>
                </div>
                <div className="bg-white p-3 rounded-[10px] border border-[#DFC7CA]">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B1020] block">
                    Excused
                  </span>
                  <span className="text-lg font-bold text-[#6B1020] tabular-nums">
                    {pupilHistoryStats.excused}
                  </span>
                </div>
              </div>

              {/* Chronological Log */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Term</th>
                      <th className="py-3 px-4">Class</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Remark / Audit Note</th>
                      {!isParent && <th className="py-3 px-4 text-right no-print">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFE9DF] text-xs">
                    {pupilHistoryRecords.length === 0 ? (
                      <tr>
                        <td colSpan={isParent ? 5 : 6} className="py-12 text-center text-[#7F7A72]">
                          No saved attendance history found yet for {selectedHistoryStudent.fullName}.
                        </td>
                      </tr>
                    ) : (
                      pupilHistoryRecords.map((rec) => (
                        <tr key={rec.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                          <td className="py-3 px-4 font-mono font-medium text-[#2A2A2E]">
                            {rec.date}
                          </td>
                          <td className="py-3 px-4 text-[#5E5B56]">{rec.term}</td>
                          <td className="py-3 px-4 text-[#5E5B56] font-medium">{rec.className}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${getStatusBadgeStyle(
                                rec.status
                              )}`}
                            >
                              {rec.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-[#5E5B56]">
                            <p>{rec.remark || '—'}</p>
                            {rec.correctionHistory && rec.correctionHistory.length > 0 ? (
                              <div className="mt-1 space-y-0.5">
                                {rec.correctionHistory.slice(-2).map((log, idx) => (
                                  <p key={idx} className="text-[10px] text-[#7D5A18]">
                                    Corrected ({log.oldStatus} → {log.newStatus}) by {log.correctedBy}
                                    {log.reason ? `: "${log.reason}"` : ''}
                                  </p>
                                ))}
                              </div>
                            ) : (
                              rec.updatedBy && (
                                <p className="text-[10px] text-[#7D5A18] mt-0.5">
                                  Corrected by {rec.updatedBy}
                                  {rec.correctionReason ? `: "${rec.correctionReason}"` : ''}
                                </p>
                              )
                            )}
                          </td>
                          {!isParent && (
                            <td className="py-3 px-4 text-right no-print">
                              <button
                                onClick={() => openSingleCorrection(rec)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-white hover:bg-[#FAF0F2] border border-[#DDD5C7] hover:border-[#DFC7CA] text-[#5E5B56] hover:text-[#6B1020] font-medium text-[11px] transition-colors duration-150"
                              >
                                <Pencil className="w-3 h-3" />
                                Correct
                              </button>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-12 text-center text-xs text-[#7F7A72]">
              Select a pupil above to inspect their attendance history.
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 4: SCHOOL-WIDE OVERVIEW (DIRECTOR & PRINCIPAL) ==================== */}
      {activeTab === 'school' && isAdmin && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-3 no-print">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {(['daily', 'weekly', 'monthly', 'termly'] as const).map((period) => (
                  <button
                    key={period}
                    onClick={() => setSchoolPeriod(period)}
                    className={`px-3 py-1.5 rounded-[8px] text-xs font-medium capitalize transition-colors duration-150 ${
                      schoolPeriod === period
                        ? 'bg-[#6B1020] text-white'
                        : 'bg-[#FAF8F4] text-[#5E5B56] border border-[#E6DFD3] hover:bg-[#EFE9DF]'
                    }`}
                  >
                    {period}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {(schoolPeriod === 'daily' || schoolPeriod === 'weekly') && (
                  <input
                    type="date"
                    value={schoolDate}
                    onChange={(e) => setSchoolDate(e.target.value)}
                    className="px-3 py-1.5 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] font-medium focus:outline-none focus:border-[#6B1020]"
                  />
                )}
                {schoolPeriod === 'monthly' && (
                  <input
                    type="month"
                    value={schoolMonth}
                    onChange={(e) => setSchoolMonth(e.target.value)}
                    className="px-3 py-1.5 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] font-medium focus:outline-none focus:border-[#6B1020]"
                  />
                )}
                {schoolPeriod === 'termly' && (
                  <select
                    value={schoolTerm}
                    onChange={(e) => setSchoolTerm(e.target.value as AcademicTerm)}
                    className="px-3 py-1.5 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] font-medium focus:outline-none focus:border-[#6B1020]"
                  >
                    <option value="First Term">First Term</option>
                    <option value="Second Term">Second Term</option>
                    <option value="Third Term">Third Term</option>
                  </select>
                )}

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print School Report
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] overflow-hidden print-only-card">
            <div className="p-5 border-b border-[#EFE9DF] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SchoolLogo
                  logoDataUrl={schoolSettings.logoDataUrl}
                  schoolName={schoolSettings.schoolName}
                  size="sm"
                  variant="print"
                  className="hidden print:flex"
                />
                <div>
                  <p className="hidden print:block font-serif text-xs font-semibold uppercase tracking-wide text-[#6B1020] mb-1">
                    {schoolSettings.schoolName} — School-Wide Attendance Report
                  </p>
                  <h3 className="font-semibold text-sm text-[#2A2A2E]">
                    Cross-School Class Attendance Breakdown ({schoolPeriod.toUpperCase()})
                  </h3>
                  <p className="text-xs text-[#6E6A63]">
                    School Attendance Rate:{' '}
                    <strong className="text-[#6B1020] tabular-nums">
                      {schoolOverallStats.totalRecords > 0
                        ? `${schoolOverallStats.attendanceRate}%`
                        : '—'}
                    </strong>{' '}
                    • Total Saved Marks: <strong className="text-[#2A2A2E] tabular-nums">{schoolOverallStats.totalRecords}</strong> (Present:{' '}
                    {schoolOverallStats.present}, Late: {schoolOverallStats.late}, Absent:{' '}
                    {schoolOverallStats.absent}, Excused: {schoolOverallStats.excused})
                  </p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                    <th className="py-3 px-4">Class / Arm</th>
                    <th className="py-3 px-4">Form Teacher</th>
                    <th className="py-3 px-4 text-center">Enrolled</th>
                    <th className="py-3 px-4 text-center">Days Saved</th>
                    <th className="py-3 px-4 text-center">Present</th>
                    <th className="py-3 px-4 text-center">Late</th>
                    <th className="py-3 px-4 text-center">Absent</th>
                    <th className="py-3 px-4 text-center">Excused</th>
                    <th className="py-3 px-4 text-right">Attendance %</th>
                    <th className="py-3 px-4 text-right no-print">Register</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE9DF] text-xs">
                  {schoolClassBreakdown.map((row) => (
                    <tr key={row.className} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                      <td className="py-3.5 px-4 font-semibold text-[#2A2A2E]">{row.className}</td>
                      <td className="py-3.5 px-4 text-[#5E5B56]">{row.formTeacherName}</td>
                      <td className="py-3.5 px-4 text-center font-medium tabular-nums">{row.enrolledCount}</td>
                      <td className="py-3.5 px-4 text-center font-medium text-[#5E5B56] tabular-nums">
                        {row.daysRecorded}
                      </td>
                      <td className="py-3.5 px-4 text-center text-[#2A583B] font-semibold tabular-nums">
                        {row.stats.present}
                      </td>
                      <td className="py-3.5 px-4 text-center text-[#7D5A18] font-semibold tabular-nums">
                        {row.stats.late}
                      </td>
                      <td className="py-3.5 px-4 text-center text-[#86222E] font-semibold tabular-nums">
                        {row.stats.absent}
                      </td>
                      <td className="py-3.5 px-4 text-center text-[#6B1020] font-semibold tabular-nums">
                        {row.stats.excused}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {row.stats.totalRecords > 0 ? (
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full font-medium text-[11px] border tabular-nums ${
                              row.stats.attendanceRate >= 85
                                ? 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]'
                                : row.stats.attendanceRate >= 70
                                ? 'bg-[#FBF5E8] text-[#7D5A18] border-[#E3CFA6]'
                                : 'bg-[#FAF0F2] text-[#86222E] border-[#E2C1C5]'
                            }`}
                          >
                            {row.stats.attendanceRate}%
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#7F7A72]">No marks</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right no-print">
                        <button
                          onClick={() => {
                            setSelectedClass(row.className);
                            if (schoolPeriod === 'daily') setSelectedDate(schoolDate);
                            setActiveTab('register');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-[#FAF0F2] hover:bg-[#F3E1E5] text-[#6B1020] border border-[#DFC7CA] font-medium text-[11px] transition-colors duration-150"
                        >
                          Open
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== SINGLE ATTENDANCE RECORD CORRECTION MODAL ==================== */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs no-print">
          <div className="bg-white rounded-[10px] max-w-md w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#EFE9DF]">
              <div>
                <h3 className="font-semibold text-base text-[#2A2A2E]">
                  Correct Attendance Record
                </h3>
                <p className="text-xs text-[#6E6A63]">
                  {editingRecord.studentName} • {editingRecord.className} ({editingRecord.date})
                </p>
              </div>
              <button
                onClick={() => setEditingRecord(null)}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors duration-150"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSingleCorrection} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-[#5E5B56] mb-1">
                  Updated Attendance Status *
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['Present', 'Late', 'Absent', 'Excused'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setEditStatus(st)}
                      className={`py-2 rounded-[8px] font-medium border transition-colors duration-150 ${
                        editStatus === st
                          ? 'bg-[#6B1020] text-white border-[#6B1020]'
                          : 'bg-[#FAF8F4] text-[#5E5B56] border-[#DDD5C7] hover:bg-[#EFE9DF]'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-medium text-[#5E5B56] mb-1">
                  Arrival / Attendance Remark
                </label>
                <input
                  type="text"
                  value={editRemark}
                  onChange={(e) => setEditRemark(e.target.value)}
                  placeholder="e.g. Verified sick note from guardian"
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-[#5E5B56] mb-1">
                  Reason for Correction (Required for Audit) *
                </label>
                <input
                  type="text"
                  value={editReason}
                  onChange={(e) => {
                    setEditReason(e.target.value);
                    if (e.target.value.trim()) setEditReasonError('');
                  }}
                  placeholder="e.g. Clerical error fixed / Medical note presented"
                  aria-invalid={Boolean(editReasonError)}
                  className={`w-full px-3 py-2 border rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:outline-none ${
                    editReasonError
                      ? 'border-[#86222E] focus:ring-[#86222E]/20 focus:border-[#86222E]'
                      : 'border-[#DDD5C7] focus:ring-[#6B1020]/20 focus:border-[#6B1020]'
                  }`}
                />
                {editReasonError && (
                  <p role="alert" className="text-[11px] font-medium text-[#86222E] mt-1">
                    {editReasonError}
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#EFE9DF]">
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingSingle}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                >
                  {isUpdatingSingle && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isUpdatingSingle ? 'Updating...' : 'Save Correction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
