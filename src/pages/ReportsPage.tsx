import React, { useEffect, useMemo, useState } from 'react';
import {
  FileSpreadsheet,
  Printer,
  GraduationCap,
  AlertCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Users,
  FileText,
  CalendarCheck,
  Receipt,
  Download,
  RefreshCw,
  Award,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  AcademicConfig,
  AcademicRecord,
  AcademicSession,
  AcademicTerm,
  AttendanceRecord,
  FeePayment,
  SchoolClass,
  Student,
  StudentFee,
  StudentResultReview,
  Teacher,
} from '../types';
import {
  DEFAULT_ACADEMIC_CONFIG,
  DEFAULT_ACADEMIC_SESSION,
  SAMPLE_CLASSES,
} from '../data/sampleData';
import { subscribeStudents, subscribeTeachers } from '../services/schoolService';
import {
  computeAttendanceSummary,
  computeClassBreakdown,
  subscribeAttendance,
} from '../services/attendanceService';
import {
  computeClassResultsSummary,
  formatOrdinal,
  subscribeAcademicConfig,
  subscribeAcademicRecords,
  subscribeAcademicSessions,
  subscribeClasses,
  subscribeResultReviews,
} from '../services/academicService';
import { groupClassesBySection } from '../utils/classUtils';
import {
  computeClassPaymentSummaries,
  downloadClassFeeSummaryPDF,
  exportClassSummaryCSV,
  exportPaymentsLedgerCSV,
  formatNaira,
  reconcileStudentFeesWithPayments,
  subscribeFeePayments,
  subscribeStudentFees,
} from '../services/feesService';
import { ReportCardView } from '../components/academics/ReportCardView';
import { SchoolLogo } from '../components/common/SchoolLogo';

type ReportTab =
  | 'enrolment'
  | 'attendance'
  | 'academics'
  | 'fee_collection'
  | 'outstanding_fees'
  | 'teachers';

type AcademicSubMode = 'individual' | 'class_summary' | 'overview';

function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  const escape = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join(
    '\n'
  );
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const ReportsPage: React.FC = () => {
  const { role, currentUser, firebaseUser, schoolSettings } = useAuth();
  const isLiveFirestore = Boolean(firebaseUser);
  const isParent = role === 'parent';
  const isTeacher = role === 'teacher';
  const isAdmin = role === 'director' || role === 'principal';

  const [activeTab, setActiveTab] = useState<ReportTab>(
    isParent ? 'academics' : isTeacher ? 'academics' : 'enrolment'
  );
  const [academicMode, setAcademicMode] = useState<AcademicSubMode>('individual');

  // Data stores
  const [sessions, setSessions] = useState<AcademicSession[]>([DEFAULT_ACADEMIC_SESSION]);
  const [classesList, setClassesList] = useState<SchoolClass[]>(SAMPLE_CLASSES);
  const [config, setConfig] = useState<AcademicConfig>(DEFAULT_ACADEMIC_CONFIG);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [academicRecords, setAcademicRecords] = useState<AcademicRecord[]>([]);
  const [resultReviews, setResultReviews] = useState<StudentResultReview[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [studentFees, setStudentFees] = useState<StudentFee[]>([]);
  const [feePayments, setFeePayments] = useState<FeePayment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(isLiveFirestore);
  const [dataError, setDataError] = useState<string>('');

  // Enforce role permissions on active report tab
  useEffect(() => {
    if (isParent) {
      setActiveTab('academics');
      setAcademicMode('individual');
    } else if (
      isTeacher &&
      (activeTab === 'fee_collection' ||
        activeTab === 'outstanding_fees' ||
        activeTab === 'teachers')
    ) {
      setActiveTab('academics');
    }
  }, [isParent, isTeacher, activeTab]);

  useEffect(() => {
    if (!firebaseUser) {
      setStudentsList([]);
      setTeachersList([]);
      setAcademicRecords([]);
      setAttendanceRecords([]);
      setStudentFees([]);
      setFeePayments([]);
      setIsLoading(false);
      setDataError('');
      return;
    }

    setIsLoading(true);
    setDataError('');
    const unsubs: Array<() => void> = [];
    const onErr = (msg: string) => {
      setDataError((prev) => prev || msg);
      setIsLoading(false);
    };

    unsubs.push(subscribeAcademicSessions(setSessions, onErr));
    unsubs.push(
      subscribeClasses((cls) => setClassesList(cls.length > 0 ? cls : SAMPLE_CLASSES), onErr)
    );
    unsubs.push(subscribeAcademicConfig(setConfig, onErr));
    unsubs.push(subscribeStudents(role, currentUser, firebaseUser.email, setStudentsList, onErr));
    unsubs.push(
      subscribeAcademicRecords(
        role,
        currentUser,
        firebaseUser.email,
        (recs) => {
          setAcademicRecords(recs);
          setIsLoading(false);
        },
        onErr
      )
    );
    unsubs.push(
      subscribeResultReviews(role, currentUser, firebaseUser.email, setResultReviews, onErr)
    );
    unsubs.push(
      subscribeAttendance(role, currentUser, firebaseUser.email, setAttendanceRecords, onErr)
    );

    if (isAdmin) {
      unsubs.push(subscribeTeachers(setTeachersList, onErr));
      unsubs.push(
        subscribeStudentFees(role, currentUser, firebaseUser.email, setStudentFees, onErr)
      );
      unsubs.push(
        subscribeFeePayments(role, currentUser, firebaseUser.email, setFeePayments, onErr)
      );
    } else {
      setTeachersList([]);
      setStudentFees([]);
      setFeePayments([]);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [firebaseUser, role, currentUser, isAdmin]);

  // Active session & term defaults
  const activeSessionObj = useMemo(
    () => sessions.find((s) => s.isActive) || sessions[0] || DEFAULT_ACADEMIC_SESSION,
    [sessions]
  );
  const activeTermObj = useMemo(
    () => activeSessionObj.terms.find((t) => t.isActive) || activeSessionObj.terms[0],
    [activeSessionObj]
  );

  // Filters: Session, Term, Class, Date Range
  const [selectedSession, setSelectedSession] = useState<string>(
    activeSessionObj.name || schoolSettings.currentSession
  );
  const [selectedTerm, setSelectedTerm] = useState<AcademicTerm | 'All'>(
    activeTermObj?.name || schoolSettings.currentTerm
  );
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('All');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');

  useEffect(() => {
    if (!sessions.some((s) => s.name === selectedSession)) {
      setSelectedSession(activeSessionObj.name);
    }
  }, [sessions, activeSessionObj.name, selectedSession]);

  const effectiveAcademicTerm: AcademicTerm =
    selectedTerm === 'All' ? activeTermObj?.name || schoolSettings.currentTerm : selectedTerm;

  const currentSessionObj = useMemo(
    () => sessions.find((s) => s.name === selectedSession) || activeSessionObj,
    [sessions, selectedSession, activeSessionObj]
  );

  const selectedTermObj = useMemo(
    () => currentSessionObj.terms.find((t) => t.name === effectiveAcademicTerm),
    [currentSessionObj, effectiveAcademicTerm]
  );

  // Role-filtered classes
  const accessibleClasses = useMemo(() => {
    if (isTeacher) {
      const assigned = currentUser?.assignedClasses || [];
      return classesList.filter((c) => assigned.includes(c.name));
    }
    if (isParent) {
      const wardClasses = new Set(studentsList.map((s) => s.className));
      return classesList.filter((c) => wardClasses.has(c.name));
    }
    return classesList;
  }, [classesList, isTeacher, isParent, currentUser, studentsList]);

  // For class broadsheet & report card, we need a concrete class name
  const concreteClassName = useMemo(() => {
    if (selectedClassFilter !== 'All') return selectedClassFilter;
    return accessibleClasses[0]?.name || classesList[0]?.name || '';
  }, [selectedClassFilter, accessibleClasses, classesList]);

  const concreteClassObj = useMemo(
    () => classesList.find((c) => c.name === concreteClassName),
    [classesList, concreteClassName]
  );

  const matchesDateRange = (isoDate?: string) => {
    if (!isoDate) return !dateFrom && !dateTo;
    const d = isoDate.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  // ==================== 1. ENROLMENT REPORT DATA ====================
  const enrolmentStudents = useMemo(() => {
    return studentsList.filter((s) => {
      if (isTeacher && !(currentUser?.assignedClasses || []).includes(s.className)) return false;
      if (selectedClassFilter !== 'All' && s.className !== selectedClassFilter) return false;
      if ((dateFrom || dateTo) && !matchesDateRange(s.admissionDate)) return false;
      return true;
    });
  }, [studentsList, isTeacher, currentUser, selectedClassFilter, dateFrom, dateTo]);

  const enrolmentStats = useMemo(() => {
    const active = enrolmentStudents.filter((s) => s.status === 'Active').length;
    const graduated = enrolmentStudents.filter((s) => s.status === 'Graduated').length;
    const withdrawn = enrolmentStudents.filter((s) => s.status === 'Withdrawn').length;
    const male = enrolmentStudents.filter((s) => s.gender === 'Male').length;
    const female = enrolmentStudents.filter((s) => s.gender === 'Female').length;
    return { total: enrolmentStudents.length, active, graduated, withdrawn, male, female };
  }, [enrolmentStudents]);

  const enrolmentClassBreakdown = useMemo(() => {
    const scopedClasses =
      selectedClassFilter === 'All'
        ? accessibleClasses
        : accessibleClasses.filter((c) => c.name === selectedClassFilter);
    return scopedClasses.map((cls) => {
      const clsStudents = enrolmentStudents.filter((s) => s.className === cls.name);
      const active = clsStudents.filter((s) => s.status === 'Active').length;
      const male = clsStudents.filter((s) => s.gender === 'Male').length;
      const female = clsStudents.filter((s) => s.gender === 'Female').length;
      const occupancy =
        cls.capacity > 0 ? Math.min(100, Math.round((active / cls.capacity) * 100)) : 0;
      return {
        className: cls.name,
        section: cls.section || 'General',
        formTeacher: cls.formTeacherName,
        capacity: cls.capacity,
        active,
        total: clsStudents.length,
        male,
        female,
        occupancy,
      };
    });
  }, [accessibleClasses, selectedClassFilter, enrolmentStudents]);

  // ==================== 2. ATTENDANCE REPORT DATA ====================
  const filteredAttendance = useMemo(() => {
    return attendanceRecords
      .filter((r) => {
        if (r.session && r.session !== selectedSession) return false;
        if (selectedTerm !== 'All' && r.term !== selectedTerm) return false;
        if (isTeacher && !(currentUser?.assignedClasses || []).includes(r.className)) return false;
        if (selectedClassFilter !== 'All' && r.className !== selectedClassFilter) return false;
        if ((dateFrom || dateTo) && !matchesDateRange(r.date)) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [
    attendanceRecords,
    selectedSession,
    selectedTerm,
    isTeacher,
    currentUser,
    selectedClassFilter,
    dateFrom,
    dateTo,
  ]);

  const attendanceSummary = useMemo(
    () => computeAttendanceSummary(filteredAttendance),
    [filteredAttendance]
  );

  const attendanceClassBreakdown = useMemo(() => {
    const scopedClasses =
      selectedClassFilter === 'All'
        ? accessibleClasses
        : accessibleClasses.filter((c) => c.name === selectedClassFilter);
    return computeClassBreakdown(filteredAttendance, scopedClasses, studentsList);
  }, [filteredAttendance, accessibleClasses, selectedClassFilter, studentsList]);

  // ==================== 3. ACADEMIC REPORT DATA ====================
  useEffect(() => {
    if (isParent) {
      const firstWard = studentsList[0];
      if (firstWard && !studentsList.some((s) => s.id === selectedStudentId)) {
        setSelectedStudentId(firstWard.id);
      }
      return;
    }
  }, [isParent, studentsList, selectedStudentId]);

  const classResults = useMemo(() => {
    const targetCls = isParent
      ? studentsList.find((s) => s.id === selectedStudentId)?.className ||
        studentsList[0]?.className ||
        ''
      : concreteClassName;
    if (!targetCls) return [];
    return computeClassResultsSummary({
      students: studentsList,
      academicRecords,
      config,
      reviews: resultReviews,
      attendanceRecords,
      session: selectedSession,
      term: effectiveAcademicTerm,
      className: targetCls,
    });
  }, [
    isParent,
    studentsList,
    selectedStudentId,
    concreteClassName,
    academicRecords,
    config,
    resultReviews,
    attendanceRecords,
    selectedSession,
    effectiveAcademicTerm,
  ]);

  useEffect(() => {
    if (isParent) return;
    if (classResults.length === 0) {
      setSelectedStudentId('');
      return;
    }
    if (!classResults.some((r) => r.student.id === selectedStudentId)) {
      setSelectedStudentId(classResults[0].student.id);
    }
  }, [isParent, classResults, selectedStudentId]);

  const activeReportResult = useMemo(
    () =>
      classResults.find((r) => r.student.id === selectedStudentId) ||
      classResults[0] ||
      null,
    [classResults, selectedStudentId]
  );

  const classStats = useMemo(() => {
    const withScores = classResults.filter((r) => r.subjectsCount > 0);
    const avg =
      withScores.length > 0
        ? Math.round(
            (withScores.reduce((sum, r) => sum + r.averagePercentage, 0) / withScores.length) *
              10
          ) / 10
        : 0;
    const approvedCount = classResults.filter((r) => r.review?.status === 'Approved').length;
    return {
      totalStudents: classResults.length,
      scoredStudents: withScores.length,
      classAverage: avg,
      approvedCount,
    };
  }, [classResults]);

  const multiClassAcademicOverview = useMemo(() => {
    const scoped =
      selectedClassFilter === 'All'
        ? accessibleClasses
        : accessibleClasses.filter((c) => c.name === selectedClassFilter);
    return scoped.map((cls) => {
      const rows = computeClassResultsSummary({
        students: studentsList,
        academicRecords,
        config,
        reviews: resultReviews,
        attendanceRecords,
        session: selectedSession,
        term: effectiveAcademicTerm,
        className: cls.name,
      });
      const scored = rows.filter((r) => r.subjectsCount > 0);
      const mean =
        scored.length > 0
          ? Math.round(
              (scored.reduce((s, r) => s + r.averagePercentage, 0) / scored.length) * 10
            ) / 10
          : 0;
      const highest =
        scored.length > 0 ? Math.max(...scored.map((r) => r.averagePercentage)) : 0;
      const approved = rows.filter((r) => r.review?.status === 'Approved').length;
      return {
        className: cls.name,
        section: cls.section || 'General',
        enrolled: rows.length,
        scored: scored.length,
        mean,
        highest,
        approved,
      };
    });
  }, [
    accessibleClasses,
    selectedClassFilter,
    studentsList,
    academicRecords,
    config,
    resultReviews,
    attendanceRecords,
    selectedSession,
    effectiveAcademicTerm,
  ]);

  // ==================== 4 & 5. FEE COLLECTION & OUTSTANDING FEES DATA ====================
  const reconciledFees = useMemo(
    () => reconcileStudentFeesWithPayments(studentFees, feePayments),
    [studentFees, feePayments]
  );

  const scopedFees = useMemo(() => {
    return reconciledFees.filter((f) => {
      if (f.session !== selectedSession) return false;
      if (selectedTerm !== 'All' && f.term !== selectedTerm) return false;
      if (selectedClassFilter !== 'All' && f.className !== selectedClassFilter) return false;
      return true;
    });
  }, [reconciledFees, selectedSession, selectedTerm, selectedClassFilter]);

  const scopedPayments = useMemo(() => {
    return feePayments
      .filter((p) => {
        if (p.isVoided) return false;
        if (p.session !== selectedSession) return false;
        if (selectedTerm !== 'All' && p.term !== selectedTerm) return false;
        if (selectedClassFilter !== 'All' && p.className !== selectedClassFilter) return false;
        if ((dateFrom || dateTo) && !matchesDateRange(p.paymentDate)) return false;
        return true;
      })
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
  }, [feePayments, selectedSession, selectedTerm, selectedClassFilter, dateFrom, dateTo]);

  const classFeeSummaryRows = useMemo(() => {
    const allRows = computeClassPaymentSummaries({
      classes: classesList,
      students: studentsList,
      reconciledFees,
      session: selectedSession,
      term: selectedTerm,
    });
    return selectedClassFilter === 'All'
      ? allRows
      : allRows.filter((r) => r.className === selectedClassFilter);
  }, [classesList, studentsList, reconciledFees, selectedSession, selectedTerm, selectedClassFilter]);

  const feeTotals = useMemo(() => {
    const totalExpected = scopedFees.reduce((s, f) => s + f.amountDue, 0);
    const totalCollected = scopedFees.reduce((s, f) => s + f.amountPaid, 0);
    const outstandingBalance = Math.max(0, totalExpected - totalCollected);
    const collectedInDateRange = scopedPayments.reduce((s, p) => s + p.amount, 0);
    const rate =
      totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 1000) / 10 : 0;
    return {
      totalExpected,
      totalCollected,
      outstandingBalance,
      collectedInDateRange,
      rate,
    };
  }, [scopedFees, scopedPayments]);

  const paymentMethodBreakdown = useMemo(() => {
    const map = new Map<string, { method: string; count: number; total: number }>();
    scopedPayments.forEach((p) => {
      const cur = map.get(p.paymentMethod) || { method: p.paymentMethod, count: 0, total: 0 };
      cur.count += 1;
      cur.total += p.amount;
      map.set(p.paymentMethod, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [scopedPayments]);

  const outstandingRows = useMemo(() => {
    const byStudent = new Map<
      string,
      {
        studentId: string;
        studentName: string;
        admissionNo: string;
        className: string;
        expected: number;
        paid: number;
        balance: number;
        itemsCount: number;
      }
    >();

    scopedFees.forEach((f) => {
      if ((dateFrom || dateTo) && !matchesDateRange(f.dueDate)) return;
      const cur = byStudent.get(f.studentId) || {
        studentId: f.studentId,
        studentName: f.studentName,
        admissionNo: f.admissionNo,
        className: f.className,
        expected: 0,
        paid: 0,
        balance: 0,
        itemsCount: 0,
      };
      cur.expected += f.amountDue;
      cur.paid += f.amountPaid;
      cur.balance += f.balance;
      if (f.balance > 0) cur.itemsCount += 1;
      byStudent.set(f.studentId, cur);
    });

    return Array.from(byStudent.values())
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance);
  }, [scopedFees, dateFrom, dateTo]);

  // ==================== 6. TEACHER REPORT DATA ====================
  const filteredTeachers = useMemo(() => {
    return teachersList.filter((t) => {
      if (selectedClassFilter !== 'All' && !t.assignedClasses.includes(selectedClassFilter)) {
        return false;
      }
      if ((dateFrom || dateTo) && !matchesDateRange(t.employmentDate)) return false;
      return true;
    });
  }, [teachersList, selectedClassFilter, dateFrom, dateTo]);

  const teacherReportRows = useMemo(() => {
    return filteredTeachers.map((t) => {
      const scoresCount = academicRecords.filter(
        (r) =>
          r.session === selectedSession &&
          (selectedTerm === 'All' || r.term === selectedTerm) &&
          r.enteredBy &&
          (r.enteredBy.toLowerCase().includes(t.fullName.toLowerCase()) ||
            r.enteredBy.toLowerCase() === t.email.toLowerCase())
      ).length;
      const attCount = attendanceRecords.filter(
        (r) =>
          r.session === selectedSession &&
          (selectedTerm === 'All' || r.term === selectedTerm) &&
          r.markedBy &&
          (r.markedBy.toLowerCase().includes(t.fullName.toLowerCase()) ||
            r.markedBy.toLowerCase() === t.email.toLowerCase())
      ).length;
      return { teacher: t, scoresCount, attCount };
    });
  }, [filteredTeachers, academicRecords, attendanceRecords, selectedSession, selectedTerm]);

  const renderStatusPill = (status?: string) => {
    switch (status) {
      case 'Approved':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB]">
            <CheckCircle2 className="w-3 h-3" /> Approved
          </span>
        );
      case 'Submitted for Review':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA]">
            <Clock className="w-3 h-3" /> Submitted
          </span>
        );
      case 'Returned for Correction':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FAF0F2] text-[#86222E] border border-[#E2C1C5]">
            <AlertTriangle className="w-3 h-3" /> Returned
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
            <Clock className="w-3 h-3" /> Draft
          </span>
        );
    }
  };

  const reportTabs: { id: ReportTab; label: string; icon: React.ComponentType<{ className?: string }>; allowed: boolean }[] = [
    { id: 'enrolment', label: 'Enrolment', icon: Users, allowed: !isParent },
    { id: 'attendance', label: 'Attendance', icon: CalendarCheck, allowed: !isParent },
    { id: 'academics', label: 'Academic Performance', icon: Award, allowed: true },
    { id: 'fee_collection', label: 'Fee Collection (₦)', icon: Receipt, allowed: isAdmin },
    { id: 'outstanding_fees', label: 'Outstanding Fees', icon: AlertCircle, allowed: isAdmin },
    { id: 'teachers', label: 'Teacher Reports', icon: GraduationCap, allowed: isAdmin },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 no-print">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#2A2A2E] tracking-tight">
              Institutional Reports & Analytics
            </h1>
            <span className="bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6] text-xs font-medium px-2.5 py-0.5 rounded-full">
              {selectedTerm === 'All' ? 'All Terms' : selectedTerm}
            </span>
          </div>
          <p className="text-xs text-[#5E5B56] mt-0.5">
            Enrolment, attendance, academic transcripts, fee collection, arrears, and staff reports computed from saved records.
          </p>
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium shadow-xs w-fit transition-colors duration-150"
        >
          <Printer className="w-4 h-4" />
          Print Current Report
        </button>
      </div>

      {/* Report Category Tabs */}
      {!isParent && (
        <div className="flex flex-wrap gap-1 p-1 bg-[#FAF8F4] rounded-[10px] border border-[#E6DFD3] no-print">
          {reportTabs
            .filter((t) => t.allowed)
            .map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] text-xs font-medium transition-all duration-150 ${
                    active
                      ? 'bg-[#6B1020] text-white shadow-xs'
                      : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#E3CFA6]' : 'text-[#7F7A72]'}`} />
                  {tab.label}
                </button>
              );
            })}
        </div>
      )}

      {dataError && (
        <div className="flex items-center gap-2 bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] px-4 py-3 rounded-[10px] text-xs font-medium no-print">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{dataError}</span>
        </div>
      )}

      {/* Global Filter Bar: Session, Term, Class & Date Range */}
      <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-4 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] no-print space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
              Academic Session
            </label>
            <select
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name} {s.isActive ? '(Active)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
              Academic Term
            </label>
            <select
              value={selectedTerm}
              onChange={(e) => setSelectedTerm(e.target.value as AcademicTerm | 'All')}
              className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
            >
              <option value="First Term">First Term</option>
              <option value="Second Term">Second Term</option>
              <option value="Third Term">Third Term</option>
              {activeTab !== 'academics' && <option value="All">All Terms</option>}
            </select>
          </div>

          {!isParent && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                Class Scope
              </label>
              <select
                value={selectedClassFilter}
                onChange={(e) => setSelectedClassFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
              >
                <option value="All">
                  {isTeacher ? 'All Assigned Classes' : 'All School Classes (Creche – SS 3)'}
                </option>
                {groupClassesBySection(accessibleClasses).map((g) => (
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

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
              Date From
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
              Date To
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
              />
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="px-2.5 py-2 text-[11px] font-medium bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] rounded-[8px] shrink-0 transition-colors duration-150"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-12 text-center text-xs text-[#5E5B56] flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-[#6B1020]" />
          Loading saved records from Cloud Firestore...
        </div>
      ) : (
        <>
          {/* ==================== 1. STUDENT ENROLMENT REPORT ==================== */}
          {activeTab === 'enrolment' && !isParent && (
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 sm:p-8 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] print-only-card space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E6DFD3]">
                <div className="flex items-center gap-3.5">
                  <SchoolLogo
                    logoDataUrl={schoolSettings.logoDataUrl}
                    schoolName={schoolSettings.schoolName}
                    size="md"
                    variant="print"
                  />
                  <div>
                    <h2 className="font-serif text-lg font-semibold text-[#6B1020] uppercase tracking-wide">
                      {schoolSettings.schoolName} — Student Enrolment Report
                    </h2>
                    <p className="text-xs text-[#5E5B56]">
                      Class: <strong className="text-[#2A2A2E]">{selectedClassFilter}</strong>
                      {(dateFrom || dateTo) &&
                        ` • Admission Date: ${dateFrom || 'Start'} to ${dateTo || 'Present'}`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      `Student_Enrolment_${selectedClassFilter}.csv`,
                      ['Admission No', 'Full Name', 'Gender', 'Class', 'Admission Date', 'Status', 'Guardian', 'Phone'],
                      enrolmentStudents.map((s) => [
                        s.admissionNo,
                        s.fullName,
                        s.gender,
                        s.className,
                        s.admissionDate,
                        s.status,
                        s.guardianName,
                        s.guardianPhone,
                      ])
                    )
                  }
                  className="no-print inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] text-xs font-medium transition-colors duration-150"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                <div className="p-3.5 rounded-[10px] bg-[#FAF8F4] border border-[#E6DFD3] border-t-2 border-t-[#B8913A]">
                  <span className="text-[#5E5B56] block">Total Records</span>
                  <strong className="text-xl font-semibold text-[#2A2A2E] tabular-nums">
                    {enrolmentStats.total}
                  </strong>
                </div>
                <div className="p-3.5 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB]">
                  <span className="text-[#2A583B] block">Active Pupils</span>
                  <strong className="text-xl font-semibold text-[#2A583B] tabular-nums">
                    {enrolmentStats.active}
                  </strong>
                </div>
                <div className="p-3.5 rounded-[10px] bg-[#FAF0F2] border border-[#DFC7CA]">
                  <span className="text-[#6B1020] block">Male / Female</span>
                  <strong className="text-xl font-semibold text-[#6B1020] tabular-nums">
                    {enrolmentStats.male} / {enrolmentStats.female}
                  </strong>
                </div>
                <div className="p-3.5 rounded-[10px] bg-[#FBF5E8] border border-[#E3CFA6]">
                  <span className="text-[#7D5A18] block">Graduated</span>
                  <strong className="text-xl font-semibold text-[#7D5A18] tabular-nums">
                    {enrolmentStats.graduated}
                  </strong>
                </div>
                <div className="p-3.5 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5]">
                  <span className="text-[#86222E] block">Withdrawn</span>
                  <strong className="text-xl font-semibold text-[#86222E] tabular-nums">
                    {enrolmentStats.withdrawn}
                  </strong>
                </div>
              </div>

              <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                    <tr>
                      <th className="py-3 px-4">Class</th>
                      <th className="py-3 px-4">Section</th>
                      <th className="py-3 px-4">Form Teacher</th>
                      <th className="py-3 px-4 text-center">Active Pupils</th>
                      <th className="py-3 px-4 text-center">Male / Female</th>
                      <th className="py-3 px-4 text-center">Capacity</th>
                      <th className="py-3 px-4 text-center">Occupancy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFE9DF]">
                    {enrolmentClassBreakdown.map((row) => (
                      <tr key={row.className} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                        <td className="py-3 px-4 font-semibold text-[#2A2A2E]">{row.className}</td>
                        <td className="py-3 px-4 text-[#5E5B56]">{row.section}</td>
                        <td className="py-3 px-4 text-[#2A2A2E]">{row.formTeacher}</td>
                        <td className="py-3 px-4 text-center font-semibold text-[#6B1020] tabular-nums">
                          {row.active}
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums text-[#5E5B56]">
                          {row.male}M / {row.female}F
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums">{row.capacity}</td>
                        <td className="py-3 px-4 text-center font-medium tabular-nums">{row.occupancy}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 2. ATTENDANCE REPORT ==================== */}
          {activeTab === 'attendance' && !isParent && (
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 sm:p-8 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] print-only-card space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E6DFD3]">
                <div className="flex items-center gap-3.5">
                  <SchoolLogo
                    logoDataUrl={schoolSettings.logoDataUrl}
                    schoolName={schoolSettings.schoolName}
                    size="md"
                    variant="print"
                  />
                  <div>
                    <h2 className="font-serif text-lg font-semibold text-[#6B1020] uppercase tracking-wide">
                      {schoolSettings.schoolName} — Attendance Report
                    </h2>
                    <p className="text-xs text-[#5E5B56]">
                      {selectedSession} • {selectedTerm === 'All' ? 'All Terms' : selectedTerm} • Class:{' '}
                      <strong className="text-[#2A2A2E]">{selectedClassFilter}</strong>
                      {(dateFrom || dateTo) &&
                        ` • Dates: ${dateFrom || 'Start'} to ${dateTo || 'Present'}`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      `Attendance_Report_${selectedClassFilter}.csv`,
                      ['Date', 'Class', 'Term', 'Admission No', 'Student Name', 'Status', 'Remark', 'Marked By'],
                      filteredAttendance.map((r) => [
                        r.date,
                        r.className,
                        r.term,
                        r.admissionNo,
                        r.studentName,
                        r.status,
                        r.remark || '',
                        r.markedBy || '',
                      ])
                    )
                  }
                  className="no-print inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] text-xs font-medium transition-colors duration-150"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs">
                <div className="p-3 rounded-[10px] bg-[#FAF0F2] border border-[#DFC7CA]">
                  <span className="text-[#6B1020] block">Attendance Rate</span>
                  <strong className="text-xl font-semibold text-[#6B1020] tabular-nums">
                    {attendanceSummary.totalRecords > 0
                      ? `${attendanceSummary.attendanceRate}%`
                      : '—'}
                  </strong>
                </div>
                <div className="p-3 rounded-[10px] bg-[#FAF8F4] border border-[#E6DFD3]">
                  <span className="text-[#5E5B56] block">Total Marks</span>
                  <strong className="text-xl font-semibold text-[#2A2A2E] tabular-nums">
                    {attendanceSummary.totalRecords}
                  </strong>
                </div>
                <div className="p-3 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB]">
                  <span className="text-[#2A583B] block">Present</span>
                  <strong className="text-xl font-semibold text-[#2A583B] tabular-nums">
                    {attendanceSummary.present}
                  </strong>
                </div>
                <div className="p-3 rounded-[10px] bg-[#FBF5E8] border border-[#E3CFA6]">
                  <span className="text-[#7D5A18] block">Late</span>
                  <strong className="text-xl font-semibold text-[#7D5A18] tabular-nums">
                    {attendanceSummary.late}
                  </strong>
                </div>
                <div className="p-3 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5]">
                  <span className="text-[#86222E] block">Absent</span>
                  <strong className="text-xl font-semibold text-[#86222E] tabular-nums">
                    {attendanceSummary.absent}
                  </strong>
                </div>
                <div className="p-3 rounded-[10px] bg-[#FAF8F4] border border-[#DDD5C7]">
                  <span className="text-[#5E5B56] block">Excused</span>
                  <strong className="text-xl font-semibold text-[#2A2A2E] tabular-nums">
                    {attendanceSummary.excused}
                  </strong>
                </div>
              </div>

              <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                    <tr>
                      <th className="py-3 px-4">Class</th>
                      <th className="py-3 px-4 text-center">Enrolled</th>
                      <th className="py-3 px-4 text-center">Saved Marks</th>
                      <th className="py-3 px-4 text-center">Present</th>
                      <th className="py-3 px-4 text-center">Late</th>
                      <th className="py-3 px-4 text-center">Absent</th>
                      <th className="py-3 px-4 text-center">Excused</th>
                      <th className="py-3 px-4 text-center">Rate (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFE9DF]">
                    {attendanceClassBreakdown.map((row) => (
                      <tr key={row.className} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                        <td className="py-3 px-4 font-semibold text-[#2A2A2E]">{row.className}</td>
                        <td className="py-3 px-4 text-center tabular-nums">{row.enrolledCount}</td>
                        <td className="py-3 px-4 text-center tabular-nums">{row.stats.totalRecords}</td>
                        <td className="py-3 px-4 text-center text-[#2A583B] font-medium tabular-nums">
                          {row.stats.present}
                        </td>
                        <td className="py-3 px-4 text-center text-[#7D5A18] font-medium tabular-nums">
                          {row.stats.late}
                        </td>
                        <td className="py-3 px-4 text-center text-[#86222E] font-medium tabular-nums">
                          {row.stats.absent}
                        </td>
                        <td className="py-3 px-4 text-center text-[#6B1020] font-medium tabular-nums">
                          {row.stats.excused}
                        </td>
                        <td className="py-3 px-4 text-center font-semibold text-[#6B1020] tabular-nums">
                          {row.stats.totalRecords > 0 ? `${row.stats.attendanceRate}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 3. ACADEMIC PERFORMANCE REPORTS ==================== */}
          {activeTab === 'academics' && (
            <div className="space-y-4">
              {!isParent && (
                <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-4 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] no-print flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap p-1 bg-[#FAF8F4] rounded-[10px] border border-[#E6DFD3] w-fit">
                    <button
                      type="button"
                      onClick={() => setAcademicMode('individual')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[8px] transition-all duration-150 ${
                        academicMode === 'individual'
                          ? 'bg-[#6B1020] text-white shadow-xs'
                          : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Individual Report Card
                    </button>
                    <button
                      type="button"
                      onClick={() => setAcademicMode('class_summary')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[8px] transition-all duration-150 ${
                        academicMode === 'class_summary'
                          ? 'bg-[#6B1020] text-white shadow-xs'
                          : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
                      }`}
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      Class Result Broadsheet
                    </button>
                    <button
                      type="button"
                      onClick={() => setAcademicMode('overview')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[8px] transition-all duration-150 ${
                        academicMode === 'overview'
                          ? 'bg-[#6B1020] text-white shadow-xs'
                          : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
                      }`}
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      Class Performance Comparison
                    </button>
                  </div>

                  {academicMode === 'individual' && (
                    <div className="w-full sm:w-72">
                      <select
                        value={selectedStudentId}
                        onChange={(e) => setSelectedStudentId(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                      >
                        {classResults.length === 0 ? (
                          <option value="">No active students in {concreteClassName}</option>
                        ) : (
                          classResults.map((r) => (
                            <option key={r.student.id} value={r.student.id}>
                              {r.student.fullName} ({r.student.admissionNo})
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {isParent && studentsList.length > 1 && (
                <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-4 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] no-print">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                    Select Linked Child / Ward
                  </label>
                  <select
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="w-full sm:w-80 px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  >
                    {studentsList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} ({s.admissionNo}) — {s.className}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {academicMode === 'individual' ? (
                activeReportResult ? (
                  <ReportCardView
                    result={activeReportResult}
                    classResults={classResults}
                    schoolSettings={schoolSettings}
                    config={config}
                    session={selectedSession}
                    term={effectiveAcademicTerm}
                    section={concreteClassObj?.section}
                    nextTermResumption={
                      selectedTermObj?.nextTermResumption || schoolSettings.nextTermResumption
                    }
                    onReviewUpdated={(updatedReview) => {
                      setResultReviews((prev) => {
                        const idx = prev.findIndex((r) => r.id === updatedReview.id);
                        if (idx >= 0) {
                          return prev.map((r) => (r.id === updatedReview.id ? updatedReview : r));
                        }
                        return [...prev, updatedReview];
                      });
                    }}
                  />
                ) : (
                  <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-10 text-center space-y-2">
                    <GraduationCap className="w-10 h-10 text-[#DDD5C7] mx-auto" />
                    <h3 className="text-sm font-semibold text-[#2A2A2E]">No Student Selected</h3>
                    <p className="text-xs text-[#5E5B56] max-w-md mx-auto">
                      {isParent
                        ? 'No child record is linked to your parent profile yet. Please contact the school administration.'
                        : 'Select a class with enrolled active students to view and download report cards.'}
                    </p>
                  </div>
                )
              ) : academicMode === 'class_summary' ? (
                <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 sm:p-8 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] print-only-card space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E6DFD3]">
                    <div className="flex items-center gap-3.5">
                      <SchoolLogo
                        logoDataUrl={schoolSettings.logoDataUrl}
                        schoolName={schoolSettings.schoolName}
                        size="md"
                        variant="print"
                      />
                      <div>
                        <h2 className="font-serif text-lg font-semibold text-[#6B1020] uppercase tracking-wide">
                          {schoolSettings.schoolName}
                        </h2>
                        <p className="text-xs font-medium text-[#2A2A2E] mt-0.5">
                          Class Result Summary Broadsheet — {concreteClassName || 'No Class'}{' '}
                          {concreteClassObj?.section ? `(${concreteClassObj.section})` : ''}
                        </p>
                        <p className="text-[11px] text-[#5E5B56]">
                          {selectedSession} • {effectiveAcademicTerm} • Ranking Policy:{' '}
                          <strong className="text-[#2A2A2E]">
                            {config.rankingPolicy === 'dense'
                              ? 'Dense Ranking (1, 2, 2, 3)'
                              : 'Standard Competition (1, 2, 2, 4)'}
                          </strong>
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        downloadCsv(
                          `Class_Broadsheet_${concreteClassName}_${effectiveAcademicTerm}.csv`,
                          ['Position', 'Admission No', 'Student Name', 'Subjects', 'Total Obtained', 'Max Possible', 'Average %', 'Grade', 'Status'],
                          classResults.map((r) => [
                            r.position ? formatOrdinal(r.position) : '—',
                            r.student.admissionNo,
                            r.student.fullName,
                            String(r.subjectsCount),
                            String(r.totalMarksObtained),
                            String(r.totalMaxPossible),
                            String(r.averagePercentage),
                            r.overallGrade,
                            r.review?.status || 'Draft',
                          ])
                        )
                      }
                      className="no-print inline-flex items-center gap-2 px-3.5 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] text-xs font-medium w-fit transition-colors duration-150"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export CSV
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-[#FAF8F4] p-3 rounded-[10px] border border-[#E6DFD3]">
                      <span className="text-[11px] font-medium text-[#5E5B56] block">
                        Enrolled Pupils
                      </span>
                      <strong className="text-lg font-semibold text-[#2A2A2E] tabular-nums">
                        {classStats.totalStudents}
                      </strong>
                    </div>
                    <div className="bg-[#FAF0F2] p-3 rounded-[10px] border border-[#DFC7CA]">
                      <span className="text-[11px] font-medium text-[#6B1020] block">
                        Pupils with Saved Scores
                      </span>
                      <strong className="text-lg font-semibold text-[#6B1020] tabular-nums">
                        {classStats.scoredStudents}
                      </strong>
                    </div>
                    <div className="bg-[#FBF5E8] p-3 rounded-[10px] border border-[#E3CFA6]">
                      <span className="text-[11px] font-medium text-[#7D5A18] block">
                        Class Mean Average
                      </span>
                      <strong className="text-lg font-semibold text-[#7D5A18] tabular-nums">
                        {classStats.scoredStudents > 0 ? `${classStats.classAverage}%` : '—'}
                      </strong>
                    </div>
                    <div className="bg-[#EEF4F0] p-3 rounded-[10px] border border-[#C5D6CB]">
                      <span className="text-[11px] font-medium text-[#2A583B] block">
                        Approved Results
                      </span>
                      <strong className="text-lg font-semibold text-[#2A583B] tabular-nums">
                        {classStats.approvedCount} / {classStats.totalStudents}
                      </strong>
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FAF8F4] text-[11px] font-semibold text-[#5E5B56] uppercase tracking-wider">
                        <tr>
                          <th className="py-3 px-3 border-b border-[#E6DFD3]">Pos.</th>
                          <th className="py-3 px-3 border-b border-[#E6DFD3]">Admission No</th>
                          <th className="py-3 px-3 border-b border-[#E6DFD3]">Student Name</th>
                          <th className="py-3 px-3 text-center border-b border-[#E6DFD3]">Subjects</th>
                          <th className="py-3 px-3 text-center border-b border-[#E6DFD3]">
                            Total Obtained
                          </th>
                          <th className="py-3 px-3 text-center border-b border-[#E6DFD3]">
                            Average (%)
                          </th>
                          <th className="py-3 px-3 text-center border-b border-[#E6DFD3]">Grade</th>
                          <th className="py-3 px-3 text-center border-b border-[#E6DFD3]">
                            Attendance
                          </th>
                          <th className="py-3 px-3 border-b border-[#E6DFD3]">Approval Status</th>
                          <th className="py-3 px-3 text-right border-b border-[#E6DFD3] no-print">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EFE9DF]">
                        {classResults.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="py-10 text-center text-[#7F7A72]">
                              No active students enrolled in {concreteClassName || 'this class'}.
                            </td>
                          </tr>
                        ) : (
                          classResults.map((row) => (
                            <tr key={row.student.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                              <td className="py-3 px-3 font-semibold text-[#6B1020] tabular-nums">
                                {row.position ? formatOrdinal(row.position) : '—'}
                              </td>
                              <td className="py-3 px-3 font-mono text-[#5E5B56]">
                                {row.student.admissionNo}
                              </td>
                              <td className="py-3 px-3 font-semibold text-[#2A2A2E]">
                                {row.student.fullName}
                              </td>
                              <td className="py-3 px-3 text-center text-[#5E5B56] tabular-nums">
                                {row.subjectsCount}
                              </td>
                              <td className="py-3 px-3 text-center font-medium text-[#2A2A2E] tabular-nums">
                                {row.subjectsCount > 0
                                  ? `${row.totalMarksObtained} / ${row.totalMaxPossible}`
                                  : '—'}
                              </td>
                              <td className="py-3 px-3 text-center font-semibold text-[#6B1020] tabular-nums">
                                {row.subjectsCount > 0 ? `${row.averagePercentage}%` : '—'}
                              </td>
                              <td className="py-3 px-3 text-center font-mono font-semibold text-[#2A583B]">
                                {row.overallGrade}
                              </td>
                              <td className="py-3 px-3 text-center text-[#5E5B56] tabular-nums">
                                {row.attendance.totalRecords > 0
                                  ? `${row.attendance.attendanceRate}% (${row.attendance.attendedCount}/${row.attendance.totalRecords})`
                                  : '0 records'}
                              </td>
                              <td className="py-3 px-3">{renderStatusPill(row.review?.status)}</td>
                              <td className="py-3 px-3 text-right no-print">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedStudentId(row.student.id);
                                    setAcademicMode('individual');
                                  }}
                                  className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] underline"
                                >
                                  View Card
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 sm:p-8 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] print-only-card space-y-4">
                  <div className="flex items-center justify-between pb-4 border-b border-[#E6DFD3]">
                    <div className="flex items-center gap-3.5">
                      <SchoolLogo
                        logoDataUrl={schoolSettings.logoDataUrl}
                        schoolName={schoolSettings.schoolName}
                        size="md"
                        variant="print"
                      />
                      <div>
                        <h2 className="font-serif text-lg font-semibold text-[#6B1020] uppercase tracking-wide">
                          {schoolSettings.schoolName} — Cross-Class Academic Performance
                        </h2>
                        <p className="text-xs text-[#5E5B56]">
                          {selectedSession} • {effectiveAcademicTerm}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                        <tr>
                          <th className="py-3 px-4">Class</th>
                          <th className="py-3 px-4">Section</th>
                          <th className="py-3 px-4 text-center">Enrolled</th>
                          <th className="py-3 px-4 text-center">Pupils Scored</th>
                          <th className="py-3 px-4 text-center">Class Mean (%)</th>
                          <th className="py-3 px-4 text-center">Highest Avg (%)</th>
                          <th className="py-3 px-4 text-center">Approved</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EFE9DF]">
                        {multiClassAcademicOverview.map((r) => (
                          <tr key={r.className} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                            <td className="py-3 px-4 font-semibold text-[#2A2A2E]">{r.className}</td>
                            <td className="py-3 px-4 text-[#5E5B56]">{r.section}</td>
                            <td className="py-3 px-4 text-center tabular-nums">{r.enrolled}</td>
                            <td className="py-3 px-4 text-center tabular-nums">{r.scored}</td>
                            <td className="py-3 px-4 text-center font-semibold text-[#6B1020] tabular-nums">
                              {r.scored > 0 ? `${r.mean}%` : '—'}
                            </td>
                            <td className="py-3 px-4 text-center font-medium text-[#2A583B] tabular-nums">
                              {r.scored > 0 ? `${r.highest}%` : '—'}
                            </td>
                            <td className="py-3 px-4 text-center tabular-nums">
                              {r.approved} / {r.enrolled}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== 4. FEE COLLECTION REPORT ==================== */}
          {activeTab === 'fee_collection' && isAdmin && (
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 sm:p-8 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] print-only-card space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E6DFD3]">
                <div className="flex items-center gap-3.5">
                  <SchoolLogo
                    logoDataUrl={schoolSettings.logoDataUrl}
                    schoolName={schoolSettings.schoolName}
                    size="md"
                    variant="print"
                  />
                  <div>
                    <h2 className="font-serif text-lg font-semibold text-[#6B1020] uppercase tracking-wide">
                      {schoolSettings.schoolName} — Fee Collection Report (₦)
                    </h2>
                    <p className="text-xs text-[#5E5B56]">
                      {selectedSession} • {selectedTerm === 'All' ? 'All Terms' : selectedTerm} • Class:{' '}
                      <strong className="text-[#2A2A2E]">{selectedClassFilter}</strong>
                      {(dateFrom || dateTo) &&
                        ` • Payment Date: ${dateFrom || 'Start'} to ${dateTo || 'Present'}`}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 no-print">
                  <button
                    type="button"
                    onClick={async () => {
                      await downloadClassFeeSummaryPDF({
                        summaryRows: classFeeSummaryRows,
                        totals: feeTotals,
                        schoolSettings,
                        session: selectedSession,
                        term: selectedTerm,
                      });
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Summary PDF
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      exportClassSummaryCSV({
                        summaryRows: classFeeSummaryRows,
                        session: selectedSession,
                        term: selectedTerm,
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] text-xs font-medium transition-colors duration-150"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Summary CSV
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      exportPaymentsLedgerCSV({
                        payments: scopedPayments,
                        session: selectedSession,
                        term: selectedTerm,
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-[#EEF4F0] hover:bg-[#E1ECE5] text-[#2A583B] border border-[#C5D6CB] text-xs font-medium transition-colors duration-150"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Ledger CSV
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3.5 rounded-[10px] bg-[#FAF8F4] border border-[#E6DFD3] border-t-2 border-t-[#B8913A]">
                  <span className="text-[#5E5B56] block">Total Fees Expected</span>
                  <strong className="text-lg font-semibold text-[#2A2A2E] tabular-nums">
                    {formatNaira(feeTotals.totalExpected)}
                  </strong>
                </div>
                <div className="p-3.5 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB]">
                  <span className="text-[#2A583B] block">Total Collected</span>
                  <strong className="text-lg font-semibold text-[#2A583B] tabular-nums">
                    {formatNaira(feeTotals.totalCollected)}
                  </strong>
                </div>
                <div className="p-3.5 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5]">
                  <span className="text-[#86222E] block">Outstanding Balance</span>
                  <strong className="text-lg font-semibold text-[#86222E] tabular-nums">
                    {formatNaira(feeTotals.outstandingBalance)}
                  </strong>
                </div>
                <div className="p-3.5 rounded-[10px] bg-[#FAF0F2] border border-[#DFC7CA]">
                  <span className="text-[#6B1020] block">
                    {dateFrom || dateTo ? 'Collected in Date Range' : 'Collection Rate'}
                  </span>
                  <strong className="text-lg font-semibold text-[#6B1020] tabular-nums">
                    {dateFrom || dateTo
                      ? formatNaira(feeTotals.collectedInDateRange)
                      : `${feeTotals.rate}%`}
                  </strong>
                </div>
              </div>

              {paymentMethodBreakdown.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                  {paymentMethodBreakdown.map((m) => (
                    <div key={m.method} className="p-3 rounded-[10px] bg-[#FAF8F4] border border-[#E6DFD3]">
                      <span className="text-[11px] font-medium text-[#5E5B56] block">
                        {m.method} ({m.count})
                      </span>
                      <strong className="text-sm font-semibold text-[#2A2A2E] tabular-nums">
                        {formatNaira(m.total)}
                      </strong>
                    </div>
                  ))}
                </div>
              )}

              {/* Class Collection Summary Table */}
              <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                    <tr>
                      <th className="py-3 px-4">Class</th>
                      <th className="py-3 px-4 text-center">Billed</th>
                      <th className="py-3 px-4 text-right">Expected (₦)</th>
                      <th className="py-3 px-4 text-right">Collected (₦)</th>
                      <th className="py-3 px-4 text-right">Outstanding (₦)</th>
                      <th className="py-3 px-4 text-center">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFE9DF]">
                    {classFeeSummaryRows.map((row) => (
                      <tr key={row.className} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                        <td className="py-3 px-4 font-semibold text-[#2A2A2E]">{row.className}</td>
                        <td className="py-3 px-4 text-center tabular-nums">{row.billedStudentsCount}</td>
                        <td className="py-3 px-4 text-right tabular-nums">{formatNaira(row.totalExpected)}</td>
                        <td className="py-3 px-4 text-right font-medium text-[#2A583B] tabular-nums">
                          {formatNaira(row.totalCollected)}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-[#86222E] tabular-nums">
                          {formatNaira(row.outstandingBalance)}
                        </td>
                        <td className="py-3 px-4 text-center font-semibold tabular-nums">{row.collectionRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Filtered Payment Ledger */}
              <div className="space-y-2">
                <h3 className="font-semibold text-xs uppercase tracking-wider text-[#5E5B56]">
                  Recorded Payment Receipts ({scopedPayments.length})
                </h3>
                <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                      <tr>
                        <th className="py-2.5 px-3">Receipt No</th>
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Student</th>
                        <th className="py-2.5 px-3">Class</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3">Method</th>
                        <th className="py-2.5 px-3 text-right">Amount (₦)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFE9DF]">
                      {scopedPayments.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-[#7F7A72]">
                            No saved payment receipts match the selected filters.
                          </td>
                        </tr>
                      ) : (
                        scopedPayments.slice(0, 50).map((p) => (
                          <tr key={p.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                            <td className="py-2.5 px-3 font-mono font-semibold text-[#6B1020]">
                              {p.receiptNo}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[#5E5B56]">{p.paymentDate}</td>
                            <td className="py-2.5 px-3 font-semibold text-[#2A2A2E]">{p.studentName}</td>
                            <td className="py-2.5 px-3 text-[#5E5B56]">{p.className}</td>
                            <td className="py-2.5 px-3 text-[#2A2A2E]">{p.categoryName}</td>
                            <td className="py-2.5 px-3 text-[#5E5B56]">{p.paymentMethod}</td>
                            <td className="py-2.5 px-3 text-right font-semibold text-[#2A583B] tabular-nums">
                              {formatNaira(p.amount)}
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

          {/* ==================== 5. OUTSTANDING FEES REPORT ==================== */}
          {activeTab === 'outstanding_fees' && isAdmin && (
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 sm:p-8 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] print-only-card space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E6DFD3]">
                <div className="flex items-center gap-3.5">
                  <SchoolLogo
                    logoDataUrl={schoolSettings.logoDataUrl}
                    schoolName={schoolSettings.schoolName}
                    size="md"
                    variant="print"
                  />
                  <div>
                    <h2 className="font-serif text-lg font-semibold text-[#6B1020] uppercase tracking-wide">
                      {schoolSettings.schoolName} — Outstanding Fees Report (₦)
                    </h2>
                    <p className="text-xs text-[#5E5B56]">
                      {selectedSession} • {selectedTerm === 'All' ? 'All Terms' : selectedTerm} • Class:{' '}
                      <strong className="text-[#2A2A2E]">{selectedClassFilter}</strong>
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      `Outstanding_Fees_${selectedClassFilter}.csv`,
                      ['Admission No', 'Student Name', 'Class', 'Total Billed (NGN)', 'Total Paid (NGN)', 'Outstanding Balance (NGN)', 'Unpaid Fee Items'],
                      outstandingRows.map((r) => [
                        r.admissionNo,
                        r.studentName,
                        r.className,
                        String(r.expected),
                        String(r.paid),
                        String(r.balance),
                        String(r.itemsCount),
                      ])
                    )
                  }
                  className="no-print inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] text-xs font-medium transition-colors duration-150"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Arrears CSV
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3.5 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5]">
                  <span className="text-[#86222E] block">Total Outstanding Arrears</span>
                  <strong className="text-xl font-semibold text-[#86222E] tabular-nums">
                    {formatNaira(outstandingRows.reduce((s, r) => s + r.balance, 0))}
                  </strong>
                </div>
                <div className="p-3.5 rounded-[10px] bg-[#FBF5E8] border border-[#E3CFA6]">
                  <span className="text-[#7D5A18] block">Pupils with Balances</span>
                  <strong className="text-xl font-semibold text-[#7D5A18] tabular-nums">
                    {outstandingRows.length}
                  </strong>
                </div>
                <div className="p-3.5 rounded-[10px] bg-[#FAF8F4] border border-[#E6DFD3]">
                  <span className="text-[#5E5B56] block">Unpaid / Partial Fee Items</span>
                  <strong className="text-xl font-semibold text-[#2A2A2E] tabular-nums">
                    {outstandingRows.reduce((s, r) => s + r.itemsCount, 0)}
                  </strong>
                </div>
              </div>

              <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                    <tr>
                      <th className="py-3 px-4">Admission No</th>
                      <th className="py-3 px-4">Student Name</th>
                      <th className="py-3 px-4">Class</th>
                      <th className="py-3 px-4 text-center">Pending Items</th>
                      <th className="py-3 px-4 text-right">Expected (₦)</th>
                      <th className="py-3 px-4 text-right">Paid (₦)</th>
                      <th className="py-3 px-4 text-right">Balance Due (₦)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFE9DF]">
                    {outstandingRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-[#2A583B] font-medium">
                          No outstanding fee balances match the selected filters.
                        </td>
                      </tr>
                    ) : (
                      outstandingRows.map((row) => (
                        <tr key={row.studentId} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                          <td className="py-3 px-4 font-mono text-[#5E5B56]">{row.admissionNo}</td>
                          <td className="py-3 px-4 font-semibold text-[#2A2A2E]">{row.studentName}</td>
                          <td className="py-3 px-4 text-[#5E5B56]">{row.className}</td>
                          <td className="py-3 px-4 text-center tabular-nums">{row.itemsCount}</td>
                          <td className="py-3 px-4 text-right tabular-nums">{formatNaira(row.expected)}</td>
                          <td className="py-3 px-4 text-right text-[#2A583B] font-medium tabular-nums">
                            {formatNaira(row.paid)}
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-[#86222E] tabular-nums">
                            {formatNaira(row.balance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 6. TEACHER REPORTS ==================== */}
          {activeTab === 'teachers' && isAdmin && (
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 sm:p-8 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] print-only-card space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E6DFD3]">
                <div className="flex items-center gap-3.5">
                  <SchoolLogo
                    logoDataUrl={schoolSettings.logoDataUrl}
                    schoolName={schoolSettings.schoolName}
                    size="md"
                    variant="print"
                  />
                  <div>
                    <h2 className="font-serif text-lg font-semibold text-[#6B1020] uppercase tracking-wide">
                      {schoolSettings.schoolName} — Teaching Staff Report
                    </h2>
                    <p className="text-xs text-[#5E5B56]">
                      {selectedSession} • {selectedTerm === 'All' ? 'All Terms' : selectedTerm} • Class Filter:{' '}
                      <strong className="text-[#2A2A2E]">{selectedClassFilter}</strong>
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      `Teacher_Report_${selectedClassFilter}.csv`,
                      ['Staff ID', 'Full Name', 'Role Type', 'Status', 'Qualifications', 'Assigned Classes', 'Subjects', 'Scores Entered', 'Attendance Marked'],
                      teacherReportRows.map((r) => [
                        r.teacher.staffId,
                        r.teacher.fullName,
                        r.teacher.roleType,
                        r.teacher.employmentStatus,
                        r.teacher.qualifications,
                        r.teacher.assignedClasses.join('; '),
                        r.teacher.subjects.join('; '),
                        String(r.scoresCount),
                        String(r.attCount),
                      ])
                    )
                  }
                  className="no-print inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] text-xs font-medium transition-colors duration-150"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3.5 rounded-[10px] bg-[#FAF8F4] border border-[#E6DFD3] border-t-2 border-t-[#B8913A]">
                  <span className="text-[#5E5B56] block">Total Matching Staff</span>
                  <strong className="text-xl font-semibold text-[#2A2A2E] tabular-nums">
                    {filteredTeachers.length}
                  </strong>
                </div>
                <div className="p-3.5 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB]">
                  <span className="text-[#2A583B] block">Active Faculty</span>
                  <strong className="text-xl font-semibold text-[#2A583B] tabular-nums">
                    {filteredTeachers.filter((t) => t.employmentStatus === 'Active').length}
                  </strong>
                </div>
                <div className="p-3.5 rounded-[10px] bg-[#FBF5E8] border border-[#E3CFA6]">
                  <span className="text-[#7D5A18] block">On Leave</span>
                  <strong className="text-xl font-semibold text-[#7D5A18] tabular-nums">
                    {filteredTeachers.filter((t) => t.employmentStatus === 'On Leave').length}
                  </strong>
                </div>
                <div className="p-3.5 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5]">
                  <span className="text-[#86222E] block">Deactivated</span>
                  <strong className="text-xl font-semibold text-[#86222E] tabular-nums">
                    {filteredTeachers.filter((t) => t.employmentStatus === 'Deactivated').length}
                  </strong>
                </div>
              </div>

              <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                    <tr>
                      <th className="py-3 px-4">Staff ID</th>
                      <th className="py-3 px-4">Teacher Name</th>
                      <th className="py-3 px-4">Role / Status</th>
                      <th className="py-3 px-4">Qualifications</th>
                      <th className="py-3 px-4">Assigned Classes & Subjects</th>
                      <th className="py-3 px-4 text-center">Activity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFE9DF]">
                    {teacherReportRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-[#7F7A72]">
                          No teacher records match the selected filters.
                        </td>
                      </tr>
                    ) : (
                      teacherReportRows.map(({ teacher, scoresCount, attCount }) => (
                        <tr key={teacher.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                          <td className="py-3 px-4 font-mono text-[#5E5B56]">{teacher.staffId}</td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-[#2A2A2E]">{teacher.fullName}</p>
                            <p className="text-[11px] text-[#5E5B56]">{teacher.email}</p>
                          </td>
                          <td className="py-3 px-4">
                            <span className="block font-medium text-[#2A2A2E]">
                              {teacher.roleType}
                            </span>
                            <span
                              className={`inline-block mt-0.5 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                                teacher.employmentStatus === 'Active'
                                  ? 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]'
                                  : teacher.employmentStatus === 'On Leave'
                                    ? 'bg-[#FBF5E8] text-[#7D5A18] border-[#E3CFA6]'
                                    : 'bg-[#FAF0F2] text-[#86222E] border-[#E2C1C5]'
                              }`}
                            >
                              {teacher.employmentStatus}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-[#5E5B56]">{teacher.qualifications}</td>
                          <td className="py-3 px-4">
                            <p className="text-[#2A2A2E] font-medium">
                              Classes: {teacher.assignedClasses.join(', ') || 'None'}
                            </p>
                            <p className="text-[11px] text-[#5E5B56]">
                              Subjects: {teacher.subjects.join(', ') || 'None'}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="block font-semibold text-[#6B1020] tabular-nums">
                              {scoresCount} scores
                            </span>
                            <span className="text-[11px] text-[#5E5B56] tabular-nums">
                              {attCount} att. marks
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
