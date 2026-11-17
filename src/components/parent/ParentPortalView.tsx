import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  BookOpen,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  GraduationCap,
  Mail,
  MapPin,
  Megaphone,
  Phone,
  Printer,
  Receipt,
  ShieldCheck,
  User,
  Users,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  AcademicConfig,
  AcademicRecord,
  AcademicSession,
  AcademicTerm,
  Announcement,
  AttendanceRecord,
  FeePayment,
  SchoolCalendarEvent,
  SchoolClass,
  Student,
  StudentFee,
  StudentResultReview,
} from '../../types';
import {
  DEFAULT_ACADEMIC_CONFIG,
  DEFAULT_ACADEMIC_SESSION,
  SAMPLE_CLASSES,
} from '../../data/sampleData';
import { subscribeStudents } from '../../services/schoolService';
import {
  computeClassResultsSummary,
  downloadReportCardPDF,
  subscribeAcademicConfig,
  subscribeAcademicRecords,
  subscribeAcademicSessions,
  subscribeClasses,
  subscribeResultReviews,
} from '../../services/academicService';
import { computeAttendanceSummary, subscribeAttendance } from '../../services/attendanceService';
import {
  computeStudentStatement,
  downloadPaymentReceiptPDF,
  downloadStudentStatementPDF,
  formatNaira,
  reconcileStudentFeesWithPayments,
  subscribeFeePayments,
  subscribeStudentFees,
} from '../../services/feesService';
import {
  filterVisibleAnnouncements,
  filterVisibleCalendarEvents,
  getTodayIsoDate,
  subscribeAnnouncements,
  subscribeCalendarEvents,
} from '../../services/communicationService';
import { ReceiptModal } from '../fees/ReceiptModal';

interface ParentPortalViewProps {
  onNavigate: (page: string) => void;
}

type PortalSectionTab = 'overview' | 'academics' | 'attendance' | 'fees' | 'communication';

export const ParentPortalView: React.FC<ParentPortalViewProps> = ({ onNavigate }) => {
  const { currentUser, firebaseUser, schoolSettings } = useAuth();
  const isLiveFirestore = Boolean(firebaseUser);

  const [activeTab, setActiveTab] = useState<PortalSectionTab>('overview');
  const [selectedChildId, setSelectedChildId] = useState<string>('');

  // Live Firestore states (start empty when authenticated so zero fake data ever leaks)
  const [students, setStudents] = useState<Student[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([DEFAULT_ACADEMIC_SESSION]);
  const [classesList, setClassesList] = useState<SchoolClass[]>(SAMPLE_CLASSES);
  const [config, setConfig] = useState<AcademicConfig>(DEFAULT_ACADEMIC_CONFIG);
  const [academicRecords, setAcademicRecords] = useState<AcademicRecord[]>([]);
  const [resultReviews, setResultReviews] = useState<StudentResultReview[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [studentFees, setStudentFees] = useState<StudentFee[]>([]);
  const [feePayments, setFeePayments] = useState<FeePayment[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<SchoolCalendarEvent[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(isLiveFirestore);
  const [dataError, setDataError] = useState<string>('');
  const [receiptModalData, setReceiptModalData] = useState<{
    payment: FeePayment;
    feeItem?: StudentFee;
  } | null>(null);

  const activeSessionObj = useMemo(
    () => sessions.find((s) => s.isActive) || sessions[0] || DEFAULT_ACADEMIC_SESSION,
    [sessions]
  );
  const activeTermName: AcademicTerm = useMemo(
    () => activeSessionObj.terms.find((t) => t.isActive)?.name || schoolSettings.currentTerm,
    [activeSessionObj]
  );

  const [selectedSession, setSelectedSession] = useState<string>(activeSessionObj.name);
  const [selectedTerm, setSelectedTerm] = useState<AcademicTerm>(activeTermName);

  useEffect(() => {
    setSelectedSession(activeSessionObj.name);
    setSelectedTerm(activeTermName);
  }, [activeSessionObj.name, activeTermName]);

  useEffect(() => {
    if (!firebaseUser) {
      setStudents([]);
      setAnnouncements([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setDataError('');

    const unsubs = [
      subscribeStudents(
        'parent',
        currentUser,
        firebaseUser.email,
        (list) => {
          setStudents(list);
          setIsLoading(false);
        },
        (err) => {
          setDataError(err);
          setIsLoading(false);
        }
      ),
      subscribeAcademicSessions(setSessions, setDataError),
      subscribeClasses((cls) => setClassesList(cls), setDataError),
      subscribeAcademicConfig(setConfig, setDataError),
      subscribeAcademicRecords('parent', currentUser, firebaseUser.email, setAcademicRecords, setDataError),
      subscribeResultReviews('parent', currentUser, firebaseUser.email, setResultReviews, setDataError),
      subscribeAttendance('parent', currentUser, firebaseUser.email, setAttendanceRecords, setDataError),
      subscribeStudentFees('parent', currentUser, firebaseUser.email, setStudentFees, setDataError),
      subscribeFeePayments('parent', currentUser, firebaseUser.email, setFeePayments, setDataError),
      subscribeAnnouncements('parent', setAnnouncements, setDataError),
      subscribeCalendarEvents(setCalendarEvents, setDataError),
    ];

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [firebaseUser, currentUser]);

  // Ensure selectedChildId tracks an actual linked child
  useEffect(() => {
    if (students.length === 0) {
      setSelectedChildId('');
      return;
    }
    if (!students.some((s) => s.id === selectedChildId)) {
      setSelectedChildId(students[0].id);
    }
  }, [students, selectedChildId]);

  const selectedChild = useMemo(
    () => students.find((s) => s.id === selectedChildId) || students[0] || null,
    [students, selectedChildId]
  );

  const linkedClassNames = useMemo(
    () => Array.from(new Set(students.map((s) => s.className).filter(Boolean))),
    [students]
  );

  // Selected child academic result (strictly from saved records)
  const childResult = useMemo(() => {
    if (!selectedChild) return null;
    const summary = computeClassResultsSummary({
      students: [selectedChild],
      academicRecords,
      config,
      reviews: resultReviews,
      attendanceRecords,
      session: selectedSession,
      term: selectedTerm,
      className: selectedChild.className,
    });
    return summary[0] || null;
  }, [selectedChild, academicRecords, config, resultReviews, attendanceRecords, selectedSession, selectedTerm]);

  // Selected child attendance for selected session & term
  const childAttendanceRecords = useMemo(() => {
    if (!selectedChild) return [];
    return attendanceRecords
      .filter(
        (a) =>
          a.studentId === selectedChild.id &&
          a.session === selectedSession &&
          a.term === selectedTerm
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [selectedChild, attendanceRecords, selectedSession, selectedTerm]);

  const childAttendanceStats = useMemo(
    () => computeAttendanceSummary(childAttendanceRecords),
    [childAttendanceRecords]
  );

  // Selected child fee statement (strictly reconciled from saved StudentFee & FeePayment)
  const reconciledFees = useMemo(
    () => reconcileStudentFeesWithPayments(studentFees, feePayments),
    [studentFees, feePayments]
  );

  const childFeeStatement = useMemo(() => {
    if (!selectedChild) return null;
    return computeStudentStatement({
      student: selectedChild,
      reconciledFees,
      payments: feePayments,
      session: selectedSession,
      term: selectedTerm,
    });
  }, [selectedChild, reconciledFees, feePayments, selectedSession, selectedTerm]);

  // Visible announcements & calendar events (strictly filtered by status, publishDate, and child's class)
  const visibleAnnouncements = useMemo(() => {
    const classScope = selectedChild ? [selectedChild.className] : linkedClassNames;
    return filterVisibleAnnouncements(announcements, 'parent', classScope);
  }, [announcements, selectedChild, linkedClassNames]);

  const visibleCalendarEvents = useMemo(() => {
    const classScope = selectedChild ? [selectedChild.className] : linkedClassNames;
    return filterVisibleCalendarEvents(calendarEvents, 'parent', classScope);
  }, [calendarEvents, selectedChild, linkedClassNames]);

  const today = getTodayIsoDate();
  const upcomingEvents = useMemo(
    () => visibleCalendarEvents.filter((ev) => (ev.endDate || ev.startDate) >= today),
    [visibleCalendarEvents, today]
  );

  const selectedSessionObj = useMemo(
    () => sessions.find((s) => s.name === selectedSession) || activeSessionObj,
    [sessions, selectedSession, activeSessionObj]
  );
  const selectedTermConfig = useMemo(
    () => selectedSessionObj.terms.find((t) => t.name === selectedTerm),
    [selectedSessionObj, selectedTerm]
  );
  const selectedClassMeta = useMemo(
    () => classesList.find((c) => c.name === selectedChild?.className),
    [classesList, selectedChild]
  );

  const handleDownloadReportCard = async () => {
    if (!childResult) return;
    await downloadReportCardPDF({
      result: childResult,
      schoolSettings: schoolSettings,
      config,
      session: selectedSession,
      term: selectedTerm,
      section: selectedClassMeta?.section,
      nextTermResumption: selectedTermConfig?.nextTermResumption,
    });
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-10 text-center text-xs text-[#5E5B56] shadow-[0_1px_2px_rgba(42,42,46,0.04)]">
        Loading your linked ward records from Cloud Firestore...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {dataError && (
        <div className="bg-[#FAF0F2] border border-[#E2C1C5] rounded-[10px] p-4 flex items-center gap-2 text-xs text-[#86222E]">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{dataError}</span>
        </div>
      )}

      {/* Unlinked parent empty state */}
      {students.length === 0 ? (
        <div className="bg-white rounded-[10px] border border-[#E6DFD3] border-t-2 border-t-[#B8913A] p-8 sm:p-10 text-center max-w-2xl mx-auto shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
          <div className="w-12 h-12 rounded-[10px] bg-[#FAF0F2] text-[#6B1020] flex items-center justify-center mx-auto mb-4 border border-[#E2C1C5]">
            <Users className="w-6 h-6" />
          </div>
          <h2 className="font-serif text-lg font-semibold text-[#2A2A2E]">
            No Linked Child Profile Found
          </h2>
          <p className="text-xs text-[#5E5B56] mt-2 leading-relaxed">
            Your parent account (
            <strong className="font-semibold text-[#2A2A2E]">
              {firebaseUser?.email || currentUser?.email}
            </strong>
            ) is signed in securely, and cannot access other families&apos; private records. Please
            ask the School Administrator or Principal to link your email address on your
            child&apos;s student profile.
          </p>
        </div>
      ) : (
        <>
          {/* Linked Children Switcher + Term Selector */}
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-medium text-[#6B1020]">
                <ShieldCheck className="w-4 h-4 text-[#6B1020]" />
                <span>
                  Private Family Portal • {students.length} Linked Child
                  {students.length > 1 ? 'ren' : ''}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {students.map((child) => {
                  const active = child.id === selectedChild?.id;
                  return (
                    <button
                      key={child.id}
                      onClick={() => setSelectedChildId(child.id)}
                      className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-[8px] text-xs font-medium border transition-colors duration-150 ${
                        active
                          ? 'bg-[#6B1020] text-white border-[#6B1020]'
                          : 'bg-[#FAF8F4] text-[#2A2A2E] border-[#DDD5C7] hover:bg-[#FAF0F2] hover:text-[#6B1020]'
                      }`}
                    >
                      <User className="w-3.5 h-3.5" />
                      <span>{child.fullName}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full ${
                          active
                            ? 'bg-white/15 text-[#DFC484]'
                            : 'bg-white text-[#5E5B56] border border-[#E6DFD3]'
                        }`}
                      >
                        {child.className}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[#6E6A63] mb-1">
                  Academic Session
                </label>
                <select
                  value={selectedSession}
                  onChange={(e) => setSelectedSession(e.target.value)}
                  className="px-3 py-1.5 text-xs font-medium border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:outline-none focus:border-[#6B1020] transition-colors duration-150"
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#6E6A63] mb-1">Term</label>
                <select
                  value={selectedTerm}
                  onChange={(e) => setSelectedTerm(e.target.value as AcademicTerm)}
                  className="px-3 py-1.5 text-xs font-medium border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:outline-none focus:border-[#6B1020] transition-colors duration-150"
                >
                  <option value="First Term">First Term</option>
                  <option value="Second Term">Second Term</option>
                  <option value="Third Term">Third Term</option>
                </select>
              </div>
            </div>
          </div>

          {selectedChild && (
            <>
              {/* Linked Child Profile Card + Live KPI Cards */}
              <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-[#EFE9DF]">
                  <div className="flex items-start sm:items-center gap-4">
                    {selectedChild.passportPhoto ? (
                      <img
                        src={selectedChild.passportPhoto}
                        alt={selectedChild.fullName}
                        className="w-14 h-14 rounded-[10px] object-cover border border-[#B8913A]/60 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-[10px] bg-[#6B1020] text-[#DFC484] flex items-center justify-center font-semibold text-lg border border-[#B8913A]/60 shrink-0">
                        {selectedChild.firstName.charAt(0)}
                        {selectedChild.surname.charAt(0)}
                      </div>
                    )}
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-[#2A2A2E]">
                          {selectedChild.fullName}
                        </h2>
                        <span
                          className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${
                            selectedChild.status === 'Active'
                              ? 'bg-[#EEF4F0] text-[#2A583B]'
                              : 'bg-[#FAF8F4] text-[#5E5B56] border border-[#E6DFD3]'
                          }`}
                        >
                          {selectedChild.status}
                        </span>
                      </div>
                      <p className="text-xs text-[#5E5B56]">
                        Admission No:{' '}
                        <strong className="font-mono font-medium text-[#2A2A2E]">
                          {selectedChild.admissionNo}
                        </strong>{' '}
                        • Class:{' '}
                        <strong className="font-medium text-[#6B1020]">
                          {selectedChild.className}
                        </strong>
                        {selectedClassMeta?.formTeacherName && (
                          <>
                            {' '}
                            • Form Teacher:{' '}
                            <strong className="font-medium text-[#2A2A2E]">
                              {selectedClassMeta.formTeacherName}
                            </strong>
                          </>
                        )}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#6E6A63]">
                        <span>
                          DOB: {selectedChild.dateOfBirth} ({selectedChild.gender})
                        </span>
                        <span>Admitted: {selectedChild.admissionDate}</span>
                        {selectedChild.stateOfOrigin && (
                          <span>State: {selectedChild.stateOfOrigin}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      onClick={handleDownloadReportCard}
                      disabled={!childResult || childResult.records.length === 0}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#6B1020] hover:bg-[#540C19] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-[8px] transition-colors duration-150"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Report Card (PDF)
                    </button>
                    <button
                      onClick={() => onNavigate('reports')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] text-xs font-medium rounded-[8px] transition-colors duration-150"
                    >
                      <FileText className="w-3.5 h-3.5 text-[#6B1020]/75" />
                      Full Report Sheet
                    </button>
                  </div>
                </div>

                {/* 4 Live Computed Metric Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-6">
                  <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04)]">
                    <div className="flex items-center justify-between text-xs font-medium text-[#6E6A63] mb-2">
                      <span>Academic Average ({selectedTerm})</span>
                      <Award className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
                    </div>
                    <div className="text-2xl font-semibold text-[#2A2A2E] tabular-nums">
                      {childResult && childResult.subjectsCount > 0
                        ? `${childResult.averagePercentage}%`
                        : '—'}
                    </div>
                    <p className="text-xs text-[#6B1020] mt-1">
                      {childResult && childResult.subjectsCount > 0
                        ? `${childResult.subjectsCount} Subject(s) • Grade ${childResult.overallGrade}`
                        : 'Awaiting Principal-approved results'}
                    </p>
                  </div>

                  <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04)]">
                    <div className="flex items-center justify-between text-xs font-medium text-[#6E6A63] mb-2">
                      <span>Term Attendance</span>
                      <CalendarCheck className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
                    </div>
                    <div className="text-2xl font-semibold text-[#2A2A2E] tabular-nums">
                      {childAttendanceStats.totalRecords > 0
                        ? `${childAttendanceStats.attendanceRate}%`
                        : '—'}
                    </div>
                    <p className="text-xs text-[#2A583B] mt-1">
                      {childAttendanceStats.totalRecords > 0
                        ? `${childAttendanceStats.attendedCount}/${childAttendanceStats.totalRecords} days attended`
                        : '0 attendance days recorded'}
                    </p>
                  </div>

                  <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04)]">
                    <div className="flex items-center justify-between text-xs font-medium text-[#6E6A63] mb-2">
                      <span>Outstanding Balance (₦)</span>
                      <Receipt className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
                    </div>
                    <div
                      className={`text-2xl font-semibold tabular-nums ${
                        (childFeeStatement?.outstandingBalance || 0) === 0
                          ? 'text-[#2A583B]'
                          : 'text-[#6B1020]'
                      }`}
                    >
                      {formatNaira(childFeeStatement?.outstandingBalance || 0)}
                    </div>
                    <p className="text-xs text-[#6E6A63] mt-1">
                      {childFeeStatement
                        ? `${childFeeStatement.overallStatus} • Paid ${formatNaira(childFeeStatement.totalPaid)}`
                        : 'No fees assigned'}
                    </p>
                  </div>

                  <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04)]">
                    <div className="flex items-center justify-between text-xs font-medium text-[#6E6A63] mb-2">
                      <span>Next Resumption / Event</span>
                      <Calendar className="w-4 h-4 text-[#6B1020]/75 shrink-0" />
                    </div>
                    <div className="text-lg font-semibold text-[#2A2A2E] truncate mt-1 tabular-nums">
                      {upcomingEvents[0]?.startDate ||
                        selectedTermConfig?.nextTermResumption ||
                        schoolSettings.nextTermResumption}
                    </div>
                    <p className="text-xs text-[#6E6A63] truncate mt-1">
                      {upcomingEvents[0]?.title || 'Next Term Resumption Date'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Navigation Tabs inside Parent Portal */}
              <div className="flex flex-wrap gap-1.5 bg-white p-1.5 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04)]">
                {[
                  { id: 'overview', label: 'Overview & Profile', icon: User },
                  { id: 'academics', label: 'Academic Results & Report Card', icon: BookOpen },
                  { id: 'attendance', label: 'Attendance Records', icon: CalendarCheck },
                  { id: 'fees', label: 'School Fees & Receipts', icon: Receipt },
                  { id: 'communication', label: 'Notices & School Calendar', icon: Megaphone },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as PortalSectionTab)}
                      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-[8px] text-xs font-medium transition-colors duration-150 ${
                        active
                          ? 'bg-[#6B1020] text-white'
                          : 'text-[#5E5B56] hover:bg-[#FAF8F4] hover:text-[#6B1020]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* OVERVIEW TAB */}
              {activeTab === 'overview' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left: Ward & Guardian Profile Details */}
                  <div className="lg:col-span-5 bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
                    <div className="flex items-center justify-between pb-3.5 border-b border-[#EFE9DF]">
                      <h3 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2">
                        <GraduationCap className="w-4 h-4 text-[#6B1020]/80" />
                        Ward & Guardian Information
                      </h3>
                      <button
                        onClick={() => onNavigate('students')}
                        className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] hover:underline transition-colors duration-150"
                      >
                        Full Profile →
                      </button>
                    </div>

                    <div className="space-y-2.5 text-xs bg-[#FAF8F4] p-4 rounded-[8px] border border-[#E6DFD3]">
                      <div className="flex justify-between gap-2">
                        <span className="text-[#6E6A63]">Guardian Name:</span>
                        <strong className="font-medium text-[#2A2A2E] text-right">
                          {selectedChild.guardianName}
                        </strong>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-[#6E6A63] flex items-center gap-1">
                          <Phone className="w-3 h-3 text-[#6B1020]/75" /> Phone:
                        </span>
                        <strong className="font-medium text-[#2A2A2E]">
                          {selectedChild.guardianPhone}
                        </strong>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-[#6E6A63] flex items-center gap-1">
                          <Mail className="w-3 h-3 text-[#6B1020]/75" /> Email:
                        </span>
                        <strong className="font-medium text-[#2A2A2E] truncate">
                          {selectedChild.guardianEmail || '—'}
                        </strong>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-[#6E6A63] flex items-center gap-1 shrink-0">
                          <MapPin className="w-3 h-3 text-[#6B1020]/75" /> Address:
                        </span>
                        <span className="text-[#2A2A2E] text-right">{selectedChild.address}</span>
                      </div>
                    </div>

                    {/* Term Timetable shortcut */}
                    <div className="p-4 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[#2A2A2E]">Class Timetable</p>
                        <p className="text-[11px] text-[#6E6A63]">
                          View weekly schedule for {selectedChild.className}
                        </p>
                      </div>
                      <button
                        onClick={() => onNavigate('timetable')}
                        className="px-3.5 py-1.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150 shrink-0"
                      >
                        View Timetable
                      </button>
                    </div>
                  </div>

                  {/* Right: Latest Notices & Upcoming Calendar */}
                  <div className="lg:col-span-7 bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
                    <div className="flex items-center justify-between pb-3.5 border-b border-[#EFE9DF]">
                      <h3 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2">
                        <Megaphone className="w-4 h-4 text-[#6B1020]/80" />
                        Latest Notices for {selectedChild.className} & Parents
                      </h3>
                      <button
                        onClick={() => onNavigate('announcements')}
                        className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] hover:underline transition-colors duration-150 shrink-0"
                      >
                        All Notices & Calendar →
                      </button>
                    </div>

                    {visibleAnnouncements.length === 0 ? (
                      <div className="p-6 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-center text-xs text-[#6E6A63]">
                        No school announcements published for parents or {selectedChild.className}{' '}
                        yet.
                      </div>
                    ) : (
                      <div className="divide-y divide-[#EFE9DF]">
                        {visibleAnnouncements.slice(0, 3).map((ann) => (
                          <div key={ann.id} className="py-3 first:pt-0 last:pb-0">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                              <span className="text-xs font-medium text-[#2A2A2E]">
                                {ann.title}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] bg-[#FAF0F2] text-[#6B1020] px-2.5 py-0.5 rounded-full font-medium">
                                  {ann.category}
                                </span>
                                <span className="text-[10px] bg-[#FBF5E8] text-[#7D5A18] font-medium px-2.5 py-0.5 rounded-full">
                                  {ann.priority}
                                </span>
                              </div>
                            </div>
                            <p className="text-xs text-[#5E5B56] line-clamp-2">{ann.body}</p>
                            <p className="text-[10px] text-[#7F7A72] mt-1">
                              Published: {ann.publishDate || ann.date} • {ann.authorName}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Upcoming Calendar Events preview */}
                    <div className="pt-4 border-t border-[#EFE9DF]">
                      <p className="text-xs font-semibold text-[#2A2A2E] mb-2.5 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-[#6B1020]/80" />
                        Upcoming School Dates (Exams, Resumption & Holidays)
                      </p>
                      {upcomingEvents.length === 0 ? (
                        <p className="text-xs text-[#6E6A63]">
                          {selectedTerm} ({selectedSession}):{' '}
                          {selectedTermConfig?.startDate || schoolSettings.termBegins} to{' '}
                          {selectedTermConfig?.endDate || schoolSettings.termEnds} • Next Resumption:{' '}
                          {selectedTermConfig?.nextTermResumption ||
                            schoolSettings.nextTermResumption}
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {upcomingEvents.slice(0, 4).map((ev) => (
                            <div
                              key={ev.id}
                              className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-xs"
                            >
                              <span className="inline-block text-[10px] font-medium uppercase text-[#6B1020] mb-0.5">
                                {ev.eventType}
                              </span>
                              <p className="font-medium text-[#2A2A2E] truncate">{ev.title}</p>
                              <p className="text-[11px] text-[#6E6A63]">
                                {ev.startDate}
                                {ev.endDate && ev.endDate !== ev.startDate
                                  ? ` → ${ev.endDate}`
                                  : ''}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ACADEMICS & REPORT CARD TAB */}
              {activeTab === 'academics' && (
                <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#EFE9DF]">
                    <div>
                      <h3 className="font-semibold text-sm text-[#2A2A2E]">
                        Academic Results — {selectedChild.fullName}
                      </h3>
                      <p className="text-xs text-[#6E6A63] mt-0.5">
                        {selectedChild.className} • {selectedTerm} ({selectedSession}) • Approval:{' '}
                        <strong className="font-medium text-[#2A2A2E]">
                          {childResult?.review?.status || 'Draft / Pending Review'}
                        </strong>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={handleDownloadReportCard}
                        disabled={!childResult || childResult.records.length === 0}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors duration-150"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Report Card PDF
                      </button>
                      <button
                        onClick={() => onNavigate('reports')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] text-xs font-medium transition-colors duration-150"
                      >
                        <Printer className="w-3.5 h-3.5 text-[#6B1020]/75" />
                        Print Full View
                      </button>
                    </div>
                  </div>

                  {!childResult || childResult.records.length === 0 ? (
                    <div className="p-8 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-center text-xs text-[#6E6A63]">
                      No Principal-approved academic results have been published for{' '}
                      {selectedChild.fullName} in {selectedTerm} ({selectedSession}) yet.
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto border border-[#E6DFD3] rounded-[8px]">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-[#FAF8F4] text-[#5E5B56] text-[11px] font-medium border-b border-[#E6DFD3]">
                            <tr>
                              <th className="px-4 py-3">Subject</th>
                              {config.components.map((c) => (
                                <th key={c.id} className="px-3 py-3 text-center">
                                  {c.label} (/{c.maxMark})
                                </th>
                              ))}
                              <th className="px-3 py-3 text-center">Total</th>
                              <th className="px-3 py-3 text-center">%</th>
                              <th className="px-3 py-3 text-center">Grade</th>
                              <th className="px-4 py-3">Remark</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#EFE9DF]">
                            {childResult.records.map((rec) => {
                              const pct =
                                rec.percentage !== undefined
                                  ? rec.percentage
                                  : Math.round((rec.total / (rec.maxTotal || 100)) * 1000) / 10;
                              return (
                                <tr
                                  key={rec.id}
                                  className="hover:bg-[#FAF8F4]/80 transition-colors duration-150"
                                >
                                  <td className="px-4 py-3 font-medium text-[#2A2A2E]">
                                    {rec.subject}
                                  </td>
                                  {config.components.map((c) => {
                                    const val =
                                      rec.componentScores?.[c.key] ??
                                      (c.key === 'ca1'
                                        ? rec.ca1
                                        : c.key === 'ca2'
                                        ? rec.ca2
                                        : c.key === 'exam' || c.isExam
                                        ? rec.exam
                                        : 0);
                                    return (
                                      <td
                                        key={c.id}
                                        className="px-3 py-3 text-center text-[#5E5B56] tabular-nums"
                                      >
                                        {val}
                                      </td>
                                    );
                                  })}
                                  <td className="px-3 py-3 text-center font-semibold text-[#6B1020] tabular-nums">
                                    {rec.total}/{rec.maxTotal || 100}
                                  </td>
                                  <td className="px-3 py-3 text-center font-semibold tabular-nums text-[#2A2A2E]">
                                    {pct}%
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#FAF0F2] text-[#6B1020] font-medium">
                                      {rec.grade}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-[#5E5B56]">{rec.remark}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                        <div className="p-4 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-xs">
                          <p className="font-semibold text-[#2A2A2E] mb-1">
                            Form Teacher&apos;s Comment
                          </p>
                          <p className="text-[#5E5B56]">
                            {childResult.review?.teacherComment ||
                              'No teacher comment recorded yet.'}
                          </p>
                        </div>
                        <div className="p-4 rounded-[8px] bg-[#FAF0F2] border border-[#E2C1C5] text-xs">
                          <p className="font-semibold text-[#6B1020] mb-1">
                            Principal&apos;s Comment
                          </p>
                          <p className="text-[#2A2A2E]">
                            {childResult.review?.principalComment ||
                              "Awaiting Principal's comment."}
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ATTENDANCE TAB */}
              {activeTab === 'attendance' && (
                <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#EFE9DF]">
                    <div>
                      <h3 className="font-semibold text-sm text-[#2A2A2E]">
                        Attendance History — {selectedChild.fullName}
                      </h3>
                      <p className="text-xs text-[#6E6A63] mt-0.5">
                        {selectedTerm} ({selectedSession}) • Saved classroom register records
                      </p>
                    </div>
                    <button
                      onClick={() => onNavigate('attendance')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150 shrink-0"
                    >
                      <CalendarCheck className="w-3.5 h-3.5" />
                      Open Full Attendance Page
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                    <div className="p-3.5 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-xs">
                      <span className="text-[#6E6A63] block">Attendance Rate</span>
                      <strong className="text-xl font-semibold text-[#2A2A2E] tabular-nums mt-0.5 block">
                        {childAttendanceStats.totalRecords > 0
                          ? `${childAttendanceStats.attendanceRate}%`
                          : '—'}
                      </strong>
                    </div>
                    <div className="p-3.5 rounded-[8px] bg-[#EEF4F0] border border-[#C5D6CB] text-xs">
                      <span className="text-[#2A583B] block">Present</span>
                      <strong className="text-xl font-semibold text-[#2A583B] tabular-nums mt-0.5 block">
                        {childAttendanceStats.present}
                      </strong>
                    </div>
                    <div className="p-3.5 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6] text-xs">
                      <span className="text-[#7D5A18] block">Late</span>
                      <strong className="text-xl font-semibold text-[#7D5A18] tabular-nums mt-0.5 block">
                        {childAttendanceStats.late}
                      </strong>
                    </div>
                    <div className="p-3.5 rounded-[8px] bg-[#FAF0F2] border border-[#E2C1C5] text-xs">
                      <span className="text-[#86222E] block">Absent</span>
                      <strong className="text-xl font-semibold text-[#86222E] tabular-nums mt-0.5 block">
                        {childAttendanceStats.absent}
                      </strong>
                    </div>
                    <div className="p-3.5 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-xs">
                      <span className="text-[#6E6A63] block">Excused</span>
                      <strong className="text-xl font-semibold text-[#2A2A2E] tabular-nums mt-0.5 block">
                        {childAttendanceStats.excused}
                      </strong>
                    </div>
                  </div>

                  {childAttendanceRecords.length === 0 ? (
                    <div className="p-8 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-center text-xs text-[#6E6A63]">
                      No saved attendance register entries found for {selectedChild.fullName} in{' '}
                      {selectedTerm}.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-[#E6DFD3] rounded-[8px]">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[#5E5B56] text-[11px] font-medium">
                          <tr>
                            <th className="px-4 py-2.5">Date</th>
                            <th className="px-4 py-2.5">Class</th>
                            <th className="px-4 py-2.5">Status</th>
                            <th className="px-4 py-2.5">Recorded By</th>
                            <th className="px-4 py-2.5">Remark</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EFE9DF]">
                          {childAttendanceRecords.slice(0, 20).map((rec) => (
                            <tr
                              key={rec.id}
                              className="hover:bg-[#FAF8F4]/80 transition-colors duration-150"
                            >
                              <td className="px-4 py-2.5 font-mono font-medium text-[#2A2A2E]">
                                {rec.date}
                              </td>
                              <td className="px-4 py-2.5 text-[#5E5B56]">{rec.className}</td>
                              <td className="px-4 py-2.5">
                                <span
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                                    rec.status === 'Present'
                                      ? 'bg-[#EEF4F0] text-[#2A583B]'
                                      : rec.status === 'Late'
                                      ? 'bg-[#FBF5E8] text-[#7D5A18]'
                                      : rec.status === 'Absent'
                                      ? 'bg-[#FAF0F2] text-[#86222E]'
                                      : 'bg-[#FAF8F4] text-[#5E5B56]'
                                  }`}
                                >
                                  {rec.status}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-[#5E5B56]">
                                {rec.markedBy || 'Teacher'}
                              </td>
                              <td className="px-4 py-2.5 text-[#6E6A63]">{rec.remark || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* SCHOOL FEES & RECEIPTS TAB */}
              {activeTab === 'fees' && childFeeStatement && (
                <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#EFE9DF]">
                    <div>
                      <h3 className="font-semibold text-sm text-[#2A2A2E]">
                        School Fees & Payment Receipts — {selectedChild.fullName}
                      </h3>
                      <p className="text-xs text-[#6E6A63] mt-0.5">
                        {selectedTerm} ({selectedSession}) • Payments are verified & recorded
                        manually by the School Bursary.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={async () => {
                          await downloadStudentStatementPDF({
                            statement: childFeeStatement,
                            schoolSettings: schoolSettings,
                            session: selectedSession,
                            term: selectedTerm,
                          });
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Statement PDF
                      </button>
                      <button
                        onClick={() => onNavigate('fees')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] text-xs font-medium transition-colors duration-150"
                      >
                        <Receipt className="w-3.5 h-3.5 text-[#6B1020]/75" />
                        Open Full Fees Page
                      </button>
                    </div>
                  </div>

                  {/* Balance summary strip */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 rounded-[10px] bg-[#FAF8F4] border border-[#E6DFD3] border-t-2 border-t-[#B8913A]">
                      <span className="text-xs font-medium text-[#6E6A63]">Total Expected (₦)</span>
                      <div className="text-xl font-semibold text-[#2A2A2E] mt-1 tabular-nums">
                        {formatNaira(childFeeStatement.totalExpected)}
                      </div>
                    </div>
                    <div className="p-4 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB]">
                      <span className="text-xs font-medium text-[#2A583B]">Verified Paid (₦)</span>
                      <div className="text-xl font-semibold text-[#2A583B] mt-1 tabular-nums">
                        {formatNaira(childFeeStatement.totalPaid)}
                      </div>
                    </div>
                    <div className="p-4 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5]">
                      <span className="text-xs font-medium text-[#86222E]">
                        Outstanding Balance (₦)
                      </span>
                      <div className="text-xl font-semibold text-[#86222E] mt-1 tabular-nums">
                        {formatNaira(childFeeStatement.outstandingBalance)}
                      </div>
                    </div>
                  </div>

                  {/* Assigned Fee Breakdown */}
                  <div>
                    <h4 className="text-sm font-semibold text-[#2A2A2E] mb-3">
                      Assigned Term Fees
                    </h4>
                    {childFeeStatement.fees.length === 0 ? (
                      <div className="p-6 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-center text-xs text-[#6E6A63]">
                        No fees have been assigned for {selectedTerm} ({selectedSession}) yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-[#E6DFD3] rounded-[8px]">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[#5E5B56] text-[11px] font-medium">
                            <tr>
                              <th className="px-4 py-2.5">Fee Category</th>
                              <th className="px-4 py-2.5">Due Date</th>
                              <th className="px-4 py-2.5 text-right">Billed (₦)</th>
                              <th className="px-4 py-2.5 text-right">Paid (₦)</th>
                              <th className="px-4 py-2.5 text-right">Balance (₦)</th>
                              <th className="px-4 py-2.5 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#EFE9DF]">
                            {childFeeStatement.fees.map((fee) => (
                              <tr
                                key={fee.id}
                                className="hover:bg-[#FAF8F4]/80 transition-colors duration-150"
                              >
                                <td className="px-4 py-2.5 font-medium text-[#2A2A2E]">
                                  {fee.categoryName}
                                </td>
                                <td className="px-4 py-2.5 text-[#5E5B56]">{fee.dueDate}</td>
                                <td className="px-4 py-2.5 text-right font-medium text-[#2A2A2E] tabular-nums">
                                  {formatNaira(fee.amountDue)}
                                </td>
                                <td className="px-4 py-2.5 text-right text-[#2A583B] font-medium tabular-nums">
                                  {formatNaira(fee.amountPaid)}
                                </td>
                                <td className="px-4 py-2.5 text-right text-[#6B1020] font-semibold tabular-nums">
                                  {formatNaira(fee.balance)}
                                </td>
                                <td className="px-4 py-2.5 text-center">
                                  <span
                                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                                      fee.status === 'Paid'
                                        ? 'bg-[#EEF4F0] text-[#2A583B]'
                                        : fee.status === 'Partial'
                                        ? 'bg-[#FBF5E8] text-[#7D5A18]'
                                        : 'bg-[#FAF0F2] text-[#86222E]'
                                    }`}
                                  >
                                    {fee.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Payment Receipts History */}
                  <div>
                    <h4 className="text-sm font-semibold text-[#2A2A2E] mb-3">
                      Recorded Payment Receipts
                    </h4>
                    {childFeeStatement.payments.length === 0 ? (
                      <div className="p-6 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-center text-xs text-[#6E6A63]">
                        No bursary payment receipts recorded for this term yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-[#E6DFD3] rounded-[8px]">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-[#FAF8F4] text-[#5E5B56] text-[11px] font-medium border-b border-[#E6DFD3]">
                            <tr>
                              <th className="px-4 py-2.5">Receipt No</th>
                              <th className="px-4 py-2.5">Date</th>
                              <th className="px-4 py-2.5">Fee Category</th>
                              <th className="px-4 py-2.5">Method / Ref</th>
                              <th className="px-4 py-2.5 text-right">Amount (₦)</th>
                              <th className="px-4 py-2.5 text-right">Receipt Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#EFE9DF]">
                            {childFeeStatement.payments.map((pay) => {
                              const matchingFee = childFeeStatement.fees.find(
                                (f) => f.id === pay.studentFeeId
                              );
                              return (
                                <tr
                                  key={pay.id}
                                  className="hover:bg-[#FAF8F4]/80 transition-colors duration-150"
                                >
                                  <td className="px-4 py-2.5 font-mono font-medium text-[#6B1020]">
                                    {pay.receiptNo}
                                  </td>
                                  <td className="px-4 py-2.5 text-[#5E5B56]">{pay.paymentDate}</td>
                                  <td className="px-4 py-2.5 font-medium text-[#2A2A2E]">
                                    {pay.categoryName}
                                  </td>
                                  <td className="px-4 py-2.5 text-[#5E5B56]">
                                    {pay.paymentMethod} •{' '}
                                    <span className="font-mono">{pay.transactionRef}</span>
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-semibold text-[#2A583B] tabular-nums">
                                    {formatNaira(pay.amount)}
                                  </td>
                                  <td className="px-4 py-2.5 text-right">
                                    <div className="inline-flex items-center gap-1.5">
                                      <button
                                        onClick={() =>
                                          setReceiptModalData({
                                            payment: pay,
                                            feeItem: matchingFee,
                                          })
                                        }
                                        className="px-2.5 py-1 rounded-[6px] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] font-medium text-[11px] transition-colors duration-150"
                                      >
                                        View
                                      </button>
                                      <button
                                        onClick={async () => {
                                          await downloadPaymentReceiptPDF({
                                            payment: pay,
                                            schoolSettings: schoolSettings,
                                            feeItem: matchingFee,
                                          });
                                        }}
                                        className="px-2.5 py-1 rounded-[6px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-[11px] inline-flex items-center gap-1 transition-colors duration-150"
                                      >
                                        <Download className="w-3 h-3" />
                                        PDF
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* NOTICES & SCHOOL CALENDAR TAB */}
              {activeTab === 'communication' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-7 bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
                    <div className="flex items-center justify-between pb-3.5 border-b border-[#EFE9DF]">
                      <h3 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2">
                        <Megaphone className="w-4 h-4 text-[#6B1020]/80" />
                        School Circulars & Announcements
                      </h3>
                      <button
                        onClick={() => onNavigate('announcements')}
                        className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] hover:underline transition-colors duration-150 shrink-0"
                      >
                        Full Circular Board →
                      </button>
                    </div>

                    {visibleAnnouncements.length === 0 ? (
                      <div className="p-8 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-center text-xs text-[#6E6A63]">
                        No active notices published for parents or {selectedChild.className}.
                      </div>
                    ) : (
                      <div className="divide-y divide-[#EFE9DF]">
                        {visibleAnnouncements.map((ann) => (
                          <div key={ann.id} className="py-4 first:pt-0 last:pb-0 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-[#2A2A2E]">
                                {ann.title}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] bg-[#FAF0F2] text-[#6B1020] px-2.5 py-0.5 rounded-full font-medium">
                                  {ann.category}
                                </span>
                                <span className="text-[10px] bg-[#FBF5E8] text-[#7D5A18] px-2.5 py-0.5 rounded-full font-medium">
                                  {ann.priority}
                                </span>
                              </div>
                            </div>
                            <p className="text-xs text-[#5E5B56] whitespace-pre-line">{ann.body}</p>
                            <div className="text-[10px] text-[#7F7A72] flex items-center justify-between pt-1">
                              <span>
                                Target: {ann.targetAudience}
                                {ann.targetClasses && ann.targetClasses.length > 0
                                  ? ` (${ann.targetClasses.join(', ')})`
                                  : ''}
                              </span>
                              <span>
                                {ann.publishDate || ann.date} • {ann.authorName}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="lg:col-span-5 bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
                    <h3 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2 pb-3.5 border-b border-[#EFE9DF]">
                      <Calendar className="w-4 h-4 text-[#6B1020]/80" />
                      School Calendar ({selectedSession})
                    </h3>

                    <div className="space-y-2.5">
                      {selectedSessionObj.terms.map((t) => (
                        <div
                          key={t.name}
                          className={`p-3.5 rounded-[8px] border text-xs ${
                            t.isActive
                              ? 'bg-[#FAF0F2] border-[#E2C1C5]'
                              : 'bg-[#FAF8F4] border-[#E6DFD3]'
                          }`}
                        >
                          <div className="flex items-center justify-between font-medium text-[#2A2A2E]">
                            <span>{t.name}</span>
                            {t.isActive && (
                              <span className="text-[10px] bg-[#6B1020] text-white px-2.5 py-0.5 rounded-full">
                                Active Term
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#6E6A63] mt-1">
                            {t.startDate} to {t.endDate} • Next Resumption: {t.nextTermResumption}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="pt-4 border-t border-[#EFE9DF] space-y-2.5">
                      <p className="text-xs font-semibold text-[#2A2A2E]">
                        Published Exams, Holidays & Events
                      </p>
                      {visibleCalendarEvents.length === 0 ? (
                        <p className="text-xs text-[#6E6A63]">
                          No additional calendar events published yet.
                        </p>
                      ) : (
                        visibleCalendarEvents.map((ev) => (
                          <div
                            key={ev.id}
                            className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-medium uppercase text-[#6B1020]">
                                {ev.eventType}
                              </span>
                              <span className="text-[11px] font-medium text-[#6E6A63]">
                                {ev.startDate}
                                {ev.endDate && ev.endDate !== ev.startDate
                                  ? ` → ${ev.endDate}`
                                  : ''}
                              </span>
                            </div>
                            <p className="font-medium text-[#2A2A2E]">{ev.title}</p>
                            {ev.description && (
                              <p className="text-[11px] text-[#6E6A63]">{ev.description}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {receiptModalData && (
        <ReceiptModal
          payment={receiptModalData.payment}
          feeItem={receiptModalData.feeItem}
          schoolSettings={schoolSettings}
          onClose={() => setReceiptModalData(null)}
        />
      )}
    </div>
  );
};
