import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  GraduationCap,
  Receipt,
  CalendarCheck,
  BookOpen,
  Megaphone,
  CheckCircle2,
  ChevronRight,
  FileText,
  AlertCircle,
  Clock,
  Activity,
  ClipboardCheck,
  Award,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  AcademicConfig,
  AcademicRecord,
  AcademicSession,
  Announcement,
  AttendanceRecord,
  FeePayment,
  SchoolClass,
  Student,
  StudentFee,
  StudentResultReview,
  SubjectTeacherAssignment,
  Teacher,
} from '../types';
import {
  DEFAULT_ACADEMIC_CONFIG,
  DEFAULT_ACADEMIC_SESSION,
  SAMPLE_CLASSES,
} from '../data/sampleData';
import { ParentPortalView } from '../components/parent/ParentPortalView';
import { SchoolLogo } from '../components/common/SchoolLogo';
import { subscribeStudents, subscribeTeachers } from '../services/schoolService';
import {
  computeClassResultsSummary,
  subscribeAcademicConfig,
  subscribeAcademicRecords,
  subscribeAcademicSessions,
  subscribeClasses,
  subscribeResultReviews,
  subscribeSubjectAssignments,
} from '../services/academicService';
import { computeAttendanceSummary, subscribeAttendance } from '../services/attendanceService';
import {
  formatNaira,
  reconcileStudentFeesWithPayments,
  subscribeFeePayments,
  subscribeStudentFees,
} from '../services/feesService';
import { filterVisibleAnnouncements, subscribeAnnouncements } from '../services/communicationService';
import { doesStudentBelongToClass, getActiveClasses } from '../utils/classUtils';

interface DashboardPageProps {
  onNavigate: (page: string) => void;
}

interface ActivityEntry {
  id: string;
  timestamp: string;
  title: string;
  detail: string;
  category: 'payment' | 'attendance' | 'academics' | 'announcement' | 'enrolment';
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate }) => {
  const { role, currentUser, firebaseUser, schoolSettings } = useAuth();
  const isLiveFirestore = Boolean(firebaseUser);
  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);

  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classesList, setClassesList] = useState<SchoolClass[]>(SAMPLE_CLASSES);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [academicRecords, setAcademicRecords] = useState<AcademicRecord[]>([]);
  const [resultReviews, setResultReviews] = useState<StudentResultReview[]>([]);
  const [subjectAssignments, setSubjectAssignments] = useState<SubjectTeacherAssignment[]>([]);
  const [academicConfig, setAcademicConfig] = useState<AcademicConfig>(DEFAULT_ACADEMIC_CONFIG);
  const [sessions, setSessions] = useState<AcademicSession[]>([DEFAULT_ACADEMIC_SESSION]);
  const [studentFees, setStudentFees] = useState<StudentFee[]>([]);
  const [feePayments, setFeePayments] = useState<FeePayment[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(firebaseUser) && role !== 'parent');
  const [dataError, setDataError] = useState<string>('');

  useEffect(() => {
    if (role === 'parent') {
      setIsLoading(false);
      return;
    }

    if (!firebaseUser) {
      setStudents([]);
      setTeachers([]);
      setAttendanceRecords([]);
      setAcademicRecords([]);
      setResultReviews([]);
      setSubjectAssignments([]);
      setStudentFees([]);
      setFeePayments([]);
      setAnnouncements([]);
      setIsLoading(false);
      setDataError('');
      return;
    }

    setIsLoading(true);
    setDataError('');

    const unsubs: Array<() => void> = [];
    const handleErr = (msg: string) => {
      setDataError((prev) => prev || msg);
      setIsLoading(false);
    };

    unsubs.push(
      subscribeStudents(
        role,
        currentUser,
        firebaseUser.email,
        (list) => {
          setStudents(list);
          setIsLoading(false);
        },
        handleErr
      )
    );
    unsubs.push(
      subscribeClasses((cls) => setClassesList(cls.length > 0 ? cls : SAMPLE_CLASSES), handleErr)
    );
    unsubs.push(
      subscribeAttendance(role, currentUser, firebaseUser.email, setAttendanceRecords, handleErr)
    );
    unsubs.push(
      subscribeAcademicRecords(role, currentUser, firebaseUser.email, setAcademicRecords, handleErr)
    );
    unsubs.push(
      subscribeResultReviews(role, currentUser, firebaseUser.email, setResultReviews, handleErr)
    );
    unsubs.push(subscribeSubjectAssignments(setSubjectAssignments, handleErr));
    unsubs.push(subscribeAcademicConfig(setAcademicConfig, handleErr));
    unsubs.push(subscribeAcademicSessions(setSessions, handleErr));
    unsubs.push(subscribeAnnouncements(role, setAnnouncements, handleErr));

    // Director, Principal, and Head Teacher can view school-wide teachers; only Director and Principal can read bursary collections
    if (role === 'director' || role === 'principal' || role === 'head_teacher') {
      unsubs.push(subscribeTeachers(setTeachers, handleErr));
    } else {
      setTeachers([]);
    }

    if (role === 'director' || role === 'principal' || role === 'bursar') {
      unsubs.push(
        subscribeStudentFees(role, currentUser, firebaseUser.email, setStudentFees, handleErr)
      );
      unsubs.push(
        subscribeFeePayments(role, currentUser, firebaseUser.email, setFeePayments, handleErr)
      );
    } else {
      setStudentFees([]);
      setFeePayments([]);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [firebaseUser, role, currentUser]);

  const activeSessionName = useMemo(() => {
    const active = sessions.find((s) => s.isActive);
    return active?.name || schoolSettings.currentSession;
  }, [sessions, schoolSettings.currentSession]);

  const activeTerm = useMemo(() => {
    const activeSess = sessions.find((s) => s.isActive);
    const activeT = activeSess?.terms.find((t) => t.isActive);
    return activeT?.name || schoolSettings.currentTerm;
  }, [sessions, schoolSettings.currentTerm]);

  // Core computed metrics strictly from loaded records
  const activeStudents = useMemo(() => students.filter((s) => s.status === 'Active'), [students]);
  const activeTeachers = useMemo(
    () => teachers.filter((t) => t.employmentStatus === 'Active'),
    [teachers]
  );

  // Reconciled fees (Director & Principal)
  const reconciledFees = useMemo(
    () => reconcileStudentFeesWithPayments(studentFees, feePayments),
    [studentFees, feePayments]
  );

  const feeSummary = useMemo(() => {
    const expected = reconciledFees.reduce((s, f) => s + f.amountDue, 0);
    const collected = reconciledFees.reduce((s, f) => s + f.amountPaid, 0);
    const outstanding = Math.max(0, expected - collected);
    const rate = expected > 0 ? Math.round((collected / expected) * 1000) / 10 : 0;
    const unpaidItems = reconciledFees.filter((f) => f.balance > 0).length;
    return { expected, collected, outstanding, rate, unpaidItems };
  }, [reconciledFees]);

  // Attendance metrics (Today + Overall Term)
  const todayAttendanceRecords = useMemo(
    () => attendanceRecords.filter((r) => r.date === todayIso),
    [attendanceRecords, todayIso]
  );
  const todayAttendanceStats = useMemo(
    () => computeAttendanceSummary(todayAttendanceRecords),
    [todayAttendanceRecords]
  );
  const termAttendanceRecords = useMemo(
    () => attendanceRecords.filter((r) => r.term === activeTerm),
    [attendanceRecords, activeTerm]
  );
  const termAttendanceStats = useMemo(
    () => computeAttendanceSummary(termAttendanceRecords),
    [termAttendanceRecords]
  );

  // Class enrollment counts strictly from students
  const activeClassesList = useMemo(() => getActiveClasses(classesList), [classesList]);

  const classEnrolmentRows = useMemo(() => {
    return classesList
      .map((cls) => {
        const enrolled = activeStudents.filter((s) => doesStudentBelongToClass(s, cls)).length;
        const pct = cls.capacity > 0 ? Math.min(100, Math.round((enrolled / cls.capacity) * 100)) : 0;
        return { ...cls, enrolled, pct };
      })
      .filter((cls) => cls.isActive !== false || cls.enrolled > 0);
  }, [classesList, activeStudents]);

  // Academic performance & Examination progress (Principal + Director)
  const termAcademicRecords = useMemo(
    () => academicRecords.filter((r) => r.term === activeTerm && r.session === activeSessionName),
    [academicRecords, activeTerm, activeSessionName]
  );

  const overallAcademicStats = useMemo(() => {
    const records = termAcademicRecords.length > 0 ? termAcademicRecords : academicRecords;
    if (records.length === 0) {
      return { count: 0, meanPercentage: 0, passRate: 0, distinctions: 0 };
    }
    const pctSum = records.reduce((s, r) => {
      const pct = r.percentage ?? (r.maxTotal ? (r.total / r.maxTotal) * 100 : r.total);
      return s + pct;
    }, 0);
    const passed = records.filter((r) => {
      const pct = r.percentage ?? (r.maxTotal ? (r.total / r.maxTotal) * 100 : r.total);
      return pct >= 50;
    }).length;
    const distinctions = records.filter((r) => {
      const pct = r.percentage ?? (r.maxTotal ? (r.total / r.maxTotal) * 100 : r.total);
      return pct >= 75;
    }).length;
    return {
      count: records.length,
      meanPercentage: Math.round((pctSum / records.length) * 10) / 10,
      passRate: Math.round((passed / records.length) * 1000) / 10,
      distinctions,
    };
  }, [termAcademicRecords, academicRecords]);

  // Class performance comparison (Principal)
  const classPerformanceRows = useMemo(() => {
    return activeClassesList
      .map((cls) => {
        const summaries = computeClassResultsSummary({
          students,
          academicRecords,
          config: academicConfig,
          reviews: resultReviews,
          attendanceRecords,
          session: activeSessionName,
          term: activeTerm,
          className: cls.name,
        });
        const scored = summaries.filter((s) => s.subjectsCount > 0);
        const avg =
          scored.length > 0
            ? Math.round(
                (scored.reduce((acc, s) => acc + s.averagePercentage, 0) / scored.length) * 10
              ) / 10
            : 0;
        const approved = summaries.filter((s) => s.review?.status === 'Approved').length;
        const submitted = summaries.filter(
          (s) => s.review?.status === 'Submitted for Review'
        ).length;
        const returned = summaries.filter(
          (s) => s.review?.status === 'Returned for Correction'
        ).length;
        return {
          className: cls.name,
          section: cls.section || '',
          pupilCount: summaries.length,
          scoredCount: scored.length,
          avgPercentage: avg,
          approved,
          submitted,
          returned,
        };
      })
      .filter((r) => r.pupilCount > 0 || r.scoredCount > 0);
  }, [
    classesList,
    students,
    academicRecords,
    academicConfig,
    resultReviews,
    attendanceRecords,
    activeSessionName,
    activeTerm,
  ]);

  // Examination review counts (Principal)
  const examProgress = useMemo(() => {
    const termReviews = resultReviews.filter(
      (r) => r.term === activeTerm && r.session === activeSessionName
    );
    const approved = termReviews.filter((r) => r.status === 'Approved').length;
    const submitted = termReviews.filter((r) => r.status === 'Submitted for Review').length;
    const returned = termReviews.filter((r) => r.status === 'Returned for Correction').length;
    const draft = Math.max(0, activeStudents.length - approved - submitted - returned);
    return { approved, submitted, returned, draft, total: activeStudents.length };
  }, [resultReviews, activeTerm, activeSessionName, activeStudents.length]);

  // Teacher activity summary (Principal)
  const teacherActivityRows = useMemo(() => {
    return activeTeachers.slice(0, 8).map((t) => {
      const assignedPairs = subjectAssignments.filter(
        (a) =>
          a.teacherId === t.id ||
          a.teacherName.toLowerCase() === t.fullName.toLowerCase() ||
          (a.teacherEmail && a.teacherEmail.toLowerCase() === t.email.toLowerCase())
      );
      const scoresLogged = academicRecords.filter(
        (r) =>
          r.enteredBy &&
          (r.enteredBy.toLowerCase().includes(t.fullName.toLowerCase()) ||
            r.enteredBy.toLowerCase() === t.email.toLowerCase())
      ).length;
      const attendanceLogged = attendanceRecords.filter(
        (r) =>
          r.markedBy &&
          (r.markedBy.toLowerCase().includes(t.fullName.toLowerCase()) ||
            r.markedBy.toLowerCase() === t.email.toLowerCase())
      ).length;
      return {
        teacher: t,
        assignedSubjectCount: Math.max(t.subjects.length, assignedPairs.length),
        scoresLogged,
        attendanceLogged,
      };
    });
  }, [activeTeachers, subjectAssignments, academicRecords, attendanceRecords]);

  // TEACHER-SPECIFIC COMPUTATIONS
  const teacherAssignedClasses = useMemo(() => {
    const names = currentUser?.assignedClasses || [];
    return classesList.filter((c) => names.includes(c.name));
  }, [classesList, currentUser]);

  const teacherAssignedSubjects = useMemo(() => {
    const set = new Set<string>(currentUser?.assignedSubjects || []);
    const userEmail = (firebaseUser?.email || currentUser?.email || '').toLowerCase();
    const userName = (currentUser?.displayName || '').toLowerCase();
    subjectAssignments.forEach((a) => {
      if (
        (a.teacherEmail && a.teacherEmail.toLowerCase() === userEmail) ||
        a.teacherName.toLowerCase() === userName
      ) {
        set.add(a.subject);
      }
    });
    return Array.from(set);
  }, [currentUser, firebaseUser, subjectAssignments]);

  const teacherTodayAttendanceByClass = useMemo(() => {
    return teacherAssignedClasses.map((cls) => {
      const clsPupils = activeStudents.filter((s) => s.className === cls.name);
      const clsToday = todayAttendanceRecords.filter((r) => r.className === cls.name);
      const stats = computeAttendanceSummary(clsToday);
      return {
        className: cls.name,
        pupilCount: clsPupils.length,
        markedCount: clsToday.length,
        isMarked: clsToday.length > 0,
        stats,
      };
    });
  }, [teacherAssignedClasses, activeStudents, todayAttendanceRecords]);

  const teacherPendingScoreTasks = useMemo(() => {
    const tasks: Array<{
      className: string;
      subject: string;
      enrolledPupils: number;
      scoredPupils: number;
    }> = [];

    const userEmail = (firebaseUser?.email || currentUser?.email || '').toLowerCase();
    const userName = (currentUser?.displayName || '').toLowerCase();
    const matchedAssignments = subjectAssignments.filter(
      (a) =>
        (a.teacherEmail && a.teacherEmail.toLowerCase() === userEmail) ||
        a.teacherName.toLowerCase() === userName
    );

    const pairs =
      matchedAssignments.length > 0
        ? matchedAssignments.map((a) => ({ className: a.className, subject: a.subject }))
        : teacherAssignedClasses.flatMap((cls) =>
            (teacherAssignedSubjects.length > 0
              ? teacherAssignedSubjects
              : cls.subjects?.slice(0, 2) || ['Mathematics']
            ).map((subj) => ({ className: cls.name, subject: subj }))
          );

    pairs.forEach((pair) => {
      const enrolled = activeStudents.filter((s) => s.className === pair.className).length;
      const scored = academicRecords.filter(
        (r) =>
          r.className === pair.className &&
          r.subject === pair.subject &&
          r.term === activeTerm &&
          r.session === activeSessionName
      ).length;
      if (enrolled > 0 && scored < enrolled) {
        tasks.push({
          className: pair.className,
          subject: pair.subject,
          enrolledPupils: enrolled,
          scoredPupils: scored,
        });
      }
    });

    return tasks;
  }, [
    firebaseUser,
    currentUser,
    subjectAssignments,
    teacherAssignedClasses,
    teacherAssignedSubjects,
    activeStudents,
    academicRecords,
    activeTerm,
    activeSessionName,
  ]);

  // Visible announcements for current role
  const visibleAnnouncements = useMemo(() => {
    const classNames = role === 'teacher' ? currentUser?.assignedClasses || [] : [];
    return filterVisibleAnnouncements(announcements, role, classNames)
      .filter((a) => (a.status || 'Published') === 'Published')
      .slice(0, 4);
  }, [announcements, role, currentUser]);

  // Real Recent Activities feed derived from Firestore records
  const recentActivities = useMemo(() => {
    const items: ActivityEntry[] = [];

    if (role === 'director' || role === 'principal' || role === 'bursar') {
      feePayments.slice(0, 4).forEach((p) => {
        items.push({
          id: `act-pay-${p.id}`,
          timestamp: p.createdAt || p.paymentDate,
          title: `Payment Recorded: ${formatNaira(p.amount)}`,
          detail: `${p.studentName} (${p.className}) • ${p.categoryName} • ${p.receiptNo}`,
          category: 'payment',
        });
      });

      students.slice(0, 3).forEach((s) => {
        if (s.createdAt) {
          items.push({
            id: `act-stu-${s.id}`,
            timestamp: s.createdAt,
            title: `Student Enrolled: ${s.fullName}`,
            detail: `${s.admissionNo} • ${s.className}`,
            category: 'enrolment',
          });
        }
      });
    }

    // Group recent attendance by date+class
    const attGroups = new Map<string, { date: string; className: string; count: number; markedBy: string; ts: string }>();
    attendanceRecords.slice(0, 40).forEach((a) => {
      const key = `${a.date}__${a.className}`;
      const cur = attGroups.get(key);
      if (cur) {
        cur.count += 1;
      } else {
        attGroups.set(key, {
          date: a.date,
          className: a.className,
          count: 1,
          markedBy: a.markedBy || 'Staff',
          ts: a.updatedAt || a.createdAt || a.date,
        });
      }
    });
    Array.from(attGroups.values())
      .slice(0, 4)
      .forEach((g) => {
        items.push({
          id: `act-att-${g.date}-${g.className}`,
          timestamp: g.ts,
          title: `Attendance Saved: ${g.className}`,
          detail: `${g.count} pupil(s) on ${g.date} by ${g.markedBy}`,
          category: 'attendance',
        });
      });

    academicRecords
      .slice()
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 4)
      .forEach((rec) => {
        items.push({
          id: `act-acad-${rec.id}`,
          timestamp: rec.updatedAt || '',
          title: `Score Updated: ${rec.subject} (${rec.className})`,
          detail: `${rec.studentName} • Total: ${rec.total} (${rec.grade})`,
          category: 'academics',
        });
      });

    visibleAnnouncements.slice(0, 3).forEach((ann) => {
      items.push({
        id: `act-ann-${ann.id}`,
        timestamp: ann.createdAt || ann.publishDate || ann.date,
        title: `Notice: ${ann.title}`,
        detail: `${ann.category} • Audience: ${ann.targetAudience}`,
        category: 'announcement',
      });
    });

    return items
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      .slice(0, 7);
  }, [role, feePayments, students, attendanceRecords, academicRecords, visibleAnnouncements]);

  return (
    <div className="space-y-6">
      {/* Executive Welcome Banner */}
      <div className="relative overflow-hidden rounded-[10px] bg-gradient-to-br from-[#6B1020] via-[#630E1D] to-[#4E0A16] text-[#F7F4EF] border border-[#B8913A]/45 p-6 sm:p-7 shadow-[0_2px_6px_rgba(42,42,46,0.08),0_10px_24px_rgba(107,16,32,0.10)]">
        {/* Very faint crest watermark */}
        <div
          aria-hidden="true"
          className="pointer-events-none select-none absolute -right-4 top-1/2 -translate-y-1/2 opacity-[0.06]"
        >
          {schoolSettings.logoDataUrl ? (
            <img
              src={schoolSettings.logoDataUrl}
              alt=""
              className="w-40 h-40 sm:w-48 sm:h-48 object-contain brightness-200 contrast-125"
            />
          ) : (
            <GraduationCap className="w-40 h-40 sm:w-48 sm:h-48 text-white" />
          )}
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex items-start sm:items-center gap-4 min-w-0">
            <SchoolLogo
              logoDataUrl={schoolSettings.logoDataUrl}
              schoolName={schoolSettings.schoolName}
              size="lg"
              variant="light"
              className="shrink-0"
            />
            <div className="min-w-0 space-y-1">
              <p className="font-serif text-sm sm:text-base font-medium text-[#EFE8DE]/90 truncate">
                {schoolSettings.schoolName}
              </p>
              <h1 className="font-serif text-xl sm:text-2xl font-semibold tracking-tight text-white leading-snug">
                Welcome, {currentUser?.displayName}
              </h1>
              {schoolSettings.motto && (
                <p className="italic text-xs sm:text-sm text-[#DFC484] leading-relaxed">
                  “{schoolSettings.motto}”
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <span className="text-xs font-medium text-[#EFE8DE]/85">{activeSessionName}</span>
            <span className="inline-flex items-center px-3.5 py-1 rounded-full border border-[#B8913A]/75 text-[#F7F4EF] text-xs font-medium tracking-wide">
              {activeTerm}
            </span>
          </div>
        </div>
      </div>

      {/* Error / Loading Indicators */}
      {dataError && (
        <div className="p-4 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5] text-xs text-[#86222E] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-[#86222E]" />
          <span>{dataError}</span>
        </div>
      )}

      {isLoading && role !== 'parent' && (
        <div className="p-4 rounded-[10px] bg-white border border-[#E6DFD3] text-xs text-[#5E5B56] flex items-center gap-2 shadow-[0_1px_2px_rgba(42,42,46,0.03)]">
          <RefreshCw className="w-4 h-4 animate-spin text-[#6B1020]" />
          <span>Synchronizing live dashboard metrics from Cloud Firestore...</span>
        </div>
      )}

      {/* ==================== PARENT PORTAL ==================== */}
      {role === 'parent' && <ParentPortalView onNavigate={onNavigate} />}

      {/* ==================== DIRECTOR DASHBOARD ==================== */}
      {role === 'director' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Total Pupils */}
            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Total Pupils</span>
                <Users className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#2A2A2E] tabular-nums">
                  {activeStudents.length}
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5">
                  {students.length} total records across {activeClassesList.length} classes
                </p>
              </div>
            </div>

            {/* Total Teachers */}
            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Total Teachers</span>
                <GraduationCap className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#2A2A2E] tabular-nums">
                  {activeTeachers.length}
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5">
                  {teachers.length} registered staff •{' '}
                  {teachers.filter((t) => t.employmentStatus === 'On Leave').length} on leave
                </p>
              </div>
            </div>

            {/* Fee Collection */}
            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Fee Collection (₦)</span>
                <Receipt className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#2A2A2E] tabular-nums">
                  {formatNaira(feeSummary.collected)}
                </div>
                <p className="text-xs text-[#2A583B] font-medium mt-1.5">
                  {feeSummary.rate}% of {formatNaira(feeSummary.expected)} billed
                </p>
              </div>
            </div>

            {/* Outstanding Fees */}
            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Outstanding Fees (₦)</span>
                <AlertCircle className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#6B1020] tabular-nums">
                  {formatNaira(feeSummary.outstanding)}
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5">
                  {feeSummary.unpaidItems} unpaid/partial fee item(s)
                </p>
              </div>
            </div>
          </div>

          {/* Today's Attendance + Quick Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-5">
              <div className="flex items-center justify-between gap-2 pb-3.5 border-b border-[#EFE9DF]">
                <h3 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2">
                  <CalendarCheck className="w-4 h-4 text-[#6B1020]/80" />
                  Today&apos;s Attendance ({todayIso})
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate('attendance')}
                  className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] hover:underline transition-colors duration-150 shrink-0"
                >
                  Open Register →
                </button>
              </div>

              {todayAttendanceStats.totalRecords === 0 ? (
                <div className="p-4 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-xs text-[#5E5B56] leading-relaxed">
                  No attendance register saved yet for{' '}
                  <strong className="font-semibold text-[#2A2A2E]">{todayIso}</strong>. Term overall
                  attendance rate across {termAttendanceStats.totalRecords} saved marks is{' '}
                  <strong className="font-semibold text-[#2A2A2E]">
                    {termAttendanceStats.totalRecords > 0
                      ? `${termAttendanceStats.attendanceRate}%`
                      : '—'}
                  </strong>
                  .
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-3xl font-semibold tracking-tight text-[#2A2A2E] tabular-nums">
                      {todayAttendanceStats.attendanceRate}%
                    </span>
                    <span className="text-xs text-[#6E6A63]">
                      {todayAttendanceStats.totalRecords} pupil(s) marked today
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                    <div className="p-3 rounded-[8px] bg-[#EEF4F0] border border-[#C5D6CB] text-[#2A583B]">
                      <strong className="block text-base font-semibold tabular-nums">
                        {todayAttendanceStats.present}
                      </strong>
                      Present
                    </div>
                    <div className="p-3 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6] text-[#7D5A18]">
                      <strong className="block text-base font-semibold tabular-nums">
                        {todayAttendanceStats.late}
                      </strong>
                      Late
                    </div>
                    <div className="p-3 rounded-[8px] bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E]">
                      <strong className="block text-base font-semibold tabular-nums">
                        {todayAttendanceStats.absent}
                      </strong>
                      Absent
                    </div>
                    <div className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-[#5E5B56]">
                      <strong className="block text-base font-semibold text-[#2A2A2E] tabular-nums">
                        {todayAttendanceStats.excused}
                      </strong>
                      Excused
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="lg:col-span-7 bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="pb-3.5 mb-5 border-b border-[#EFE9DF]">
                <h2 className="font-semibold text-sm text-[#2A2A2E]">Director Quick Actions</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { id: 'students', label: 'Manage Students', icon: Users },
                  { id: 'teachers', label: 'Manage Teachers', icon: GraduationCap },
                  { id: 'fees', label: 'Fees & Receipts (₦)', icon: Receipt },
                  { id: 'attendance', label: 'School Attendance', icon: CalendarCheck },
                  { id: 'reports', label: 'Executive Reports', icon: FileText },
                  { id: 'settings', label: 'RBAC & Settings', icon: BookOpen },
                ].map((btn) => {
                  const Icon = btn.icon;
                  return (
                    <button
                      key={btn.id}
                      type="button"
                      onClick={() => onNavigate(btn.id)}
                      className="flex items-center gap-2.5 px-3.5 py-3 rounded-[8px] border border-[#E6DFD3] bg-[#FAF8F4]/70 hover:bg-[#FAF0F2] hover:border-[#6B1020]/45 text-[#2A2A2E] hover:text-[#6B1020] transition-colors duration-150 text-left group"
                    >
                      <Icon className="w-4 h-4 shrink-0 text-[#6B1020]/75 group-hover:text-[#6B1020] transition-colors duration-150" />
                      <span className="text-xs font-medium">{btn.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Class Enrolment + Recent Activities */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2 pb-3.5 mb-5 border-b border-[#EFE9DF]">
                <div>
                  <h3 className="font-semibold text-sm text-[#2A2A2E]">
                    Class Enrolment vs Capacity
                  </h3>
                  <p className="text-xs text-[#6E6A63] mt-0.5">
                    Computed from active registered students across classes
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('classes')}
                  className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] hover:underline inline-flex items-center transition-colors duration-150 shrink-0"
                >
                  All Classes <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                </button>
              </div>

              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                {classEnrolmentRows.map((cls) => (
                  <div
                    key={cls.id}
                    className="p-3.5 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3]"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-xs text-[#2A2A2E]">{cls.name}</span>
                        <span className="text-[11px] text-[#6E6A63]">({cls.section})</span>
                      </div>
                      <span className="text-xs font-semibold text-[#2A2A2E] tabular-nums">
                        {cls.enrolled} / {cls.capacity} Pupils
                      </span>
                    </div>
                    <div className="w-full bg-[#E8E1D5] h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-200 ${
                          cls.pct > 90 ? 'bg-[#B8913A]' : 'bg-[#6B1020]'
                        }`}
                        style={{ width: `${cls.pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#6E6A63] mt-2">
                      <span>Form Teacher: {cls.formTeacherName}</span>
                      <span>{cls.roomNumber}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-5 bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between pb-3.5 mb-5 border-b border-[#EFE9DF]">
                <h3 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#6B1020]/80" />
                  Recent Activities
                </h3>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#FAF8F4] border border-[#E6DFD3] text-[#5E5B56] text-[11px] font-medium">
                  Live feed
                </span>
              </div>

              {recentActivities.length === 0 ? (
                <p className="text-xs text-[#7F7A72] py-8 text-center">
                  No recent transactions or academic activities recorded yet.
                </p>
              ) : (
                <div className="divide-y divide-[#EFE9DF]">
                  {recentActivities.map((act) => (
                    <div key={act.id} className="py-3 first:pt-0 last:pb-0 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-[#2A2A2E]">{act.title}</span>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#FAF0F2] text-[#6B1020] text-[10px] font-medium capitalize shrink-0">
                          {act.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#6E6A63] mt-0.5">{act.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ==================== BURSAR DASHBOARD ==================== */}
      {role === 'bursar' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Active Students</span>
                <Users className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#2A2A2E] tabular-nums">
                  {activeStudents.length}
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5">
                  Across {activeClassesList.length} active classes
                </p>
              </div>
            </div>

            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Total Expected (₦)</span>
                <FileText className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#2A2A2E] tabular-nums">
                  {formatNaira(feeSummary.expected)}
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5">
                  {reconciledFees.length} billed fee item(s)
                </p>
              </div>
            </div>

            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Fee Collection (₦)</span>
                <Receipt className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#2A583B] tabular-nums">
                  {formatNaira(feeSummary.collected)}
                </div>
                <p className="text-xs text-[#2A583B] font-medium mt-1.5">
                  {feeSummary.rate}% recovery rate
                </p>
              </div>
            </div>

            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Outstanding Balances</span>
                <AlertCircle className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#6B1020] tabular-nums">
                  {formatNaira(feeSummary.outstanding)}
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5">
                  {feeSummary.unpaidItems} pending/partial fee item(s)
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-sm text-[#2A2A2E]">Bursary & Fee Operations</h2>
              <p className="text-xs text-[#6E6A63] mt-1">
                Record installment or full fee payments, inspect student running statements, and print official receipts.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('fees')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium shadow-xs transition-colors duration-150 shrink-0"
            >
              <Receipt className="w-4 h-4 text-[#E3CFA6]" />
              Open School Fees & Payments
            </button>
          </div>
        </>
      )}

      {/* ==================== PRINCIPAL / HEAD TEACHER DASHBOARD ==================== */}
      {(role === 'principal' || role === 'head_teacher') && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Academic Performance */}
            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Academic Performance</span>
                <Award className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#2A2A2E] tabular-nums">
                  {overallAcademicStats.count > 0 ? `${overallAcademicStats.meanPercentage}%` : '—'}
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5">
                  Pass Rate:{' '}
                  <strong className="font-semibold text-[#2A2A2E]">
                    {overallAcademicStats.passRate}%
                  </strong>{' '}
                  • {overallAcademicStats.count} score entries
                </p>
              </div>
            </div>

            {/* Attendance Statistics */}
            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Attendance Statistics</span>
                <CalendarCheck className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#2A2A2E] tabular-nums">
                  {todayAttendanceStats.totalRecords > 0
                    ? `${todayAttendanceStats.attendanceRate}%`
                    : termAttendanceStats.totalRecords > 0
                      ? `${termAttendanceStats.attendanceRate}%`
                      : '—'}
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5">
                  Today: {todayAttendanceStats.totalRecords} marks • Term:{' '}
                  {termAttendanceStats.totalRecords} marks
                </p>
              </div>
            </div>

            {/* Examination Progress */}
            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Examination Progress</span>
                <ClipboardCheck className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#2A2A2E] tabular-nums">
                  {examProgress.approved} / {examProgress.total}
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5">
                  Approved • {examProgress.submitted} awaiting review
                </p>
              </div>
            </div>

            {/* Teacher Activity */}
            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Teacher Activity</span>
                <GraduationCap className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#2A2A2E] tabular-nums">
                  {activeTeachers.length} Active
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5">
                  {subjectAssignments.length} subject-class allocations
                </p>
              </div>
            </div>
          </div>

          {/* Examination Progress Strip */}
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 mb-5 border-b border-[#EFE9DF]">
              <h3 className="font-semibold text-sm text-[#2A2A2E]">
                Terminal Examination & Result Approval Progress ({activeTerm})
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('academics')}
                className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] hover:underline transition-colors duration-150"
              >
                Review & Approve Results →
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div className="p-4 rounded-[8px] bg-[#EEF4F0] border border-[#C5D6CB]">
                <span className="text-xs font-medium text-[#2A583B] block">Approved</span>
                <strong className="text-2xl font-semibold text-[#2A583B] tabular-nums mt-1 block">
                  {examProgress.approved}
                </strong>
              </div>
              <div className="p-4 rounded-[8px] bg-[#FAF0F2] border border-[#E2C1C5]">
                <span className="text-xs font-medium text-[#6B1020] block">
                  Submitted for Review
                </span>
                <strong className="text-2xl font-semibold text-[#6B1020] tabular-nums mt-1 block">
                  {examProgress.submitted}
                </strong>
              </div>
              <div className="p-4 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6]">
                <span className="text-xs font-medium text-[#7D5A18] block">
                  Returned for Correction
                </span>
                <strong className="text-2xl font-semibold text-[#7D5A18] tabular-nums mt-1 block">
                  {examProgress.returned}
                </strong>
              </div>
              <div className="p-4 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3]">
                <span className="text-xs font-medium text-[#5E5B56] block">Pending / Draft</span>
                <strong className="text-2xl font-semibold text-[#2A2A2E] tabular-nums mt-1 block">
                  {examProgress.draft}
                </strong>
              </div>
            </div>
          </div>

          {/* Class Performance & Teacher Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between pb-3.5 mb-5 border-b border-[#EFE9DF]">
                <h3 className="font-semibold text-sm text-[#2A2A2E]">
                  Class Performance Comparison ({activeTerm})
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate('reports')}
                  className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] hover:underline transition-colors duration-150 shrink-0"
                >
                  View Broadsheets →
                </button>
              </div>
              <div className="overflow-x-auto border border-[#E6DFD3] rounded-[8px]">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-medium text-[#5E5B56]">
                      <th className="py-2.5 px-3.5">Class</th>
                      <th className="py-2.5 px-3.5 text-center">Pupils</th>
                      <th className="py-2.5 px-3.5 text-center">Scored</th>
                      <th className="py-2.5 px-3.5 text-center">Mean %</th>
                      <th className="py-2.5 px-3.5 text-center">Approved</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFE9DF]">
                    {classPerformanceRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-[#7F7A72]">
                          No enrolled classes or scores recorded yet.
                        </td>
                      </tr>
                    ) : (
                      classPerformanceRows.map((row) => (
                        <tr
                          key={row.className}
                          className="hover:bg-[#FAF8F4]/80 transition-colors duration-150"
                        >
                          <td className="py-2.5 px-3.5 font-medium text-[#2A2A2E]">
                            {row.className}
                          </td>
                          <td className="py-2.5 px-3.5 text-center tabular-nums text-[#5E5B56]">
                            {row.pupilCount}
                          </td>
                          <td className="py-2.5 px-3.5 text-center tabular-nums text-[#5E5B56]">
                            {row.scoredCount}
                          </td>
                          <td className="py-2.5 px-3.5 text-center font-semibold text-[#6B1020] tabular-nums">
                            {row.scoredCount > 0 ? `${row.avgPercentage}%` : '—'}
                          </td>
                          <td className="py-2.5 px-3.5 text-center">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#EEF4F0] text-[#2A583B] font-medium tabular-nums">
                              {row.approved}/{row.pupilCount}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lg:col-span-5 bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between pb-3.5 mb-5 border-b border-[#EFE9DF]">
                <h3 className="font-semibold text-sm text-[#2A2A2E]">
                  Teacher Activity Supervision
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate('teachers')}
                  className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] hover:underline transition-colors duration-150 shrink-0"
                >
                  Faculty Roster →
                </button>
              </div>
              <div className="divide-y divide-[#EFE9DF]">
                {teacherActivityRows.length === 0 ? (
                  <p className="text-xs text-[#7F7A72] py-8 text-center">
                    No active teachers registered yet.
                  </p>
                ) : (
                  teacherActivityRows.map((row) => (
                    <div
                      key={row.teacher.id}
                      className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-[#2A2A2E] truncate">
                          {row.teacher.fullName}
                        </p>
                        <p className="text-[11px] text-[#6E6A63] truncate">
                          Classes: {row.teacher.assignedClasses.join(', ') || 'Unassigned'}
                        </p>
                      </div>
                      <div className="text-right shrink-0 text-[11px] tabular-nums">
                        <span className="block font-semibold text-[#6B1020]">
                          {row.scoresLogged} scores
                        </span>
                        <span className="text-[#6E6A63]">{row.attendanceLogged} att. marks</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ==================== TEACHER DASHBOARD ==================== */}
      {role === 'teacher' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Assigned Classes */}
            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Assigned Classes</span>
                <Users className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#2A2A2E] tabular-nums">
                  {teacherAssignedClasses.length}
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5 truncate">
                  {teacherAssignedClasses.map((c) => c.name).join(', ') || 'None assigned yet'}
                </p>
              </div>
            </div>

            {/* Assigned Subjects */}
            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Assigned Subjects</span>
                <BookOpen className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#2A2A2E] tabular-nums">
                  {teacherAssignedSubjects.length}
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5 truncate">
                  {teacherAssignedSubjects.join(', ') || 'Contact Principal/Director'}
                </p>
              </div>
            </div>

            {/* Today's Attendance */}
            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Today&apos;s Attendance</span>
                <CalendarCheck className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#2A2A2E] tabular-nums">
                  {todayAttendanceStats.totalRecords > 0
                    ? `${todayAttendanceStats.attendanceRate}%`
                    : 'Pending'}
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5">
                  {teacherTodayAttendanceByClass.filter((c) => c.isMarked).length} /{' '}
                  {teacherTodayAttendanceByClass.length} class(es) marked today
                </p>
              </div>
            </div>

            {/* Pending Score Submissions */}
            <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#6E6A63]">Pending Score Entries</span>
                <AlertTriangle className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
              </div>
              <div className="mt-3">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#6B1020] tabular-nums">
                  {teacherPendingScoreTasks.length}
                </div>
                <p className="text-xs text-[#6E6A63] mt-1.5">
                  Subject-class registers incomplete for {activeTerm}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Today's Attendance & Assigned Classes */}
            <div className="lg:col-span-6 space-y-6">
              <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
                <div className="flex items-center justify-between gap-2 pb-3.5 border-b border-[#EFE9DF]">
                  <h3 className="font-semibold text-sm text-[#2A2A2E]">
                    My Assigned Classes & Today&apos;s Roll Call ({todayIso})
                  </h3>
                  <button
                    type="button"
                    onClick={() => onNavigate('attendance')}
                    className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] hover:underline transition-colors duration-150 shrink-0"
                  >
                    Mark Attendance →
                  </button>
                </div>

                {teacherTodayAttendanceByClass.length === 0 ? (
                  <p className="text-xs text-[#7F7A72] py-6 text-center">
                    No classes are currently assigned to your teacher profile.
                  </p>
                ) : (
                  <div className="divide-y divide-[#EFE9DF]">
                    {teacherTodayAttendanceByClass.map((item) => (
                      <div
                        key={item.className}
                        className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <p className="font-medium text-[#2A2A2E]">{item.className}</p>
                          <p className="text-[11px] text-[#6E6A63]">
                            {item.pupilCount} active pupil(s)
                          </p>
                        </div>
                        {item.isMarked ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#EEF4F0] text-[#2A583B] font-medium text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#2A583B]" />
                            Saved ({item.stats.attendanceRate}%)
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onNavigate('attendance')}
                            className="px-3 py-1.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-[11px] transition-colors duration-150"
                          >
                            Pending Today • Mark Now
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {teacherAssignedSubjects.length > 0 && (
                  <div className="pt-4 border-t border-[#EFE9DF]">
                    <span className="text-xs font-medium text-[#6E6A63] block mb-2.5">
                      Assigned Subjects
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {teacherAssignedSubjects.map((sub) => (
                        <span
                          key={sub}
                          className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#FAF0F2] text-[#6B1020] text-[11px] font-medium"
                        >
                          {sub}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Pending Score Submissions */}
              <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
                <div className="flex items-center justify-between gap-2 pb-3.5 border-b border-[#EFE9DF]">
                  <h3 className="font-semibold text-sm text-[#2A2A2E]">
                    Pending Score Submissions ({activeTerm})
                  </h3>
                  <button
                    type="button"
                    onClick={() => onNavigate('academics')}
                    className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] hover:underline transition-colors duration-150 shrink-0"
                  >
                    Enter CA & Exam Scores →
                  </button>
                </div>

                {teacherPendingScoreTasks.length === 0 ? (
                  <div className="p-4 rounded-[8px] bg-[#EEF4F0] border border-[#C5D6CB] text-xs text-[#2A583B] flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#2A583B] shrink-0" />
                    <span>All assigned subject score sheets for {activeTerm} are up to date.</span>
                  </div>
                ) : (
                  <div className="divide-y divide-[#EFE9DF]">
                    {teacherPendingScoreTasks.slice(0, 6).map((t) => (
                      <div
                        key={`${t.className}-${t.subject}`}
                        className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <p className="font-medium text-[#2A2A2E]">
                            {t.subject} — {t.className}
                          </p>
                          <p className="text-[11px] text-[#7D5A18]">
                            {t.scoredPupils} of {t.enrolledPupils} pupils scored
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onNavigate('academics')}
                          className="px-3 py-1.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-[11px] transition-colors duration-150 shrink-0"
                        >
                          Upload Scores
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Recent Class Activities & Notices */}
            <div className="lg:col-span-6 space-y-6">
              <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
                <div className="flex items-center justify-between pb-3.5 mb-5 border-b border-[#EFE9DF]">
                  <h3 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#6B1020]/80" />
                    Recent Class Activities
                  </h3>
                </div>
                {recentActivities.length === 0 ? (
                  <p className="text-xs text-[#7F7A72] py-6 text-center">
                    No recent activity recorded in your assigned classes yet.
                  </p>
                ) : (
                  <div className="divide-y divide-[#EFE9DF]">
                    {recentActivities.map((act) => (
                      <div key={act.id} className="py-3 first:pt-0 last:pb-0 text-xs">
                        <p className="font-medium text-[#2A2A2E]">{act.title}</p>
                        <p className="text-[11px] text-[#6E6A63] mt-0.5">{act.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
                <div className="flex items-center justify-between pb-3.5 mb-5 border-b border-[#EFE9DF]">
                  <h3 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2">
                    <Megaphone className="w-4 h-4 text-[#6B1020]/80" />
                    Staff & School Notices
                  </h3>
                  <button
                    type="button"
                    onClick={() => onNavigate('announcements')}
                    className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] hover:underline transition-colors duration-150 shrink-0"
                  >
                    All Notices →
                  </button>
                </div>
                {visibleAnnouncements.length === 0 ? (
                  <p className="text-xs text-[#7F7A72] py-4 text-center">No active notices.</p>
                ) : (
                  <div className="divide-y divide-[#EFE9DF]">
                    {visibleAnnouncements.slice(0, 3).map((ann) => (
                      <div key={ann.id} className="py-3 first:pt-0 last:pb-0 text-xs">
                        <p className="font-medium text-[#2A2A2E]">{ann.title}</p>
                        <p className="text-[11px] text-[#6E6A63] line-clamp-2 mt-0.5">{ann.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
