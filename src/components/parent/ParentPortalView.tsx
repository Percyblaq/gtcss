import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Award,
  Calendar,
  CalendarDays,
  Download,
  Eye,
  FileText,
  Globe,
  GraduationCap,
  Lock,
  LogOut,
  Mail,
  Megaphone,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  Announcement,
  AnnouncementCategory,
  FeePayment,
  PublishedReportSnapshot,
  Student,
  StudentFee,
} from '../../types';
import { subscribeStudents } from '../../services/schoolService';
import {
  computeStudentFeeClearance,
  downloadPublishedSnapshotPDF,
  formatOrdinal,
  subscribePublishedReports,
} from '../../services/academicService';
import {
  formatNaira,
  subscribeFeePayments,
  subscribeStudentFees,
} from '../../services/feesService';
import {
  filterVisibleAnnouncements,
  getTodayIsoDate,
  subscribeAnnouncements,
} from '../../services/communicationService';
import { PublishedReportSnapshotCard } from '../academics/PublishedReportSnapshotCard';
import { AnnouncementCommentsSection } from '../announcements/AnnouncementCommentsSection';

interface ParentPortalViewProps {
  onNavigate?: (page: string) => void;
}

const TERM_ORDER: Record<string, number> = {
  'Third Term': 3,
  'Second Term': 2,
  'First Term': 1,
};

function formatPublishDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[] = [
  'General Notice',
  'Academic',
  'Examination Schedule',
  'Resumption Date',
  'Holiday',
  'PTA Meeting',
  'Finance',
  'Sports & Events',
];

export const ParentPortalView: React.FC<ParentPortalViewProps> = () => {
  const { currentUser, firebaseUser, schoolSettings, signOutUser } = useAuth();
  const isLiveFirestore = Boolean(firebaseUser);

  const [activeTab, setActiveTab] = useState<'children' | 'announcements'>('children');
  const [students, setStudents] = useState<Student[]>([]);
  const [publishedReports, setPublishedReports] = useState<PublishedReportSnapshot[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementSearch, setAnnouncementSearch] = useState<string>('');
  const [announcementCategory, setAnnouncementCategory] = useState<string>('All');
  const [studentFees, setStudentFees] = useState<StudentFee[]>([]);
  const [feePayments, setFeePayments] = useState<FeePayment[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(isLiveFirestore);
  const [dataError, setDataError] = useState<string>('');
  const [selectedSnapshot, setSelectedSnapshot] = useState<PublishedReportSnapshot | null>(null);
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);

  const feeGatingEnabled = schoolSettings.requireFullFeesBeforePublishReport === true;

  useEffect(() => {
    if (!firebaseUser) {
      setStudents([]);
      setPublishedReports([]);
      setStudentFees([]);
      setFeePayments([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setDataError('');

    let studentsReady = false;
    let reportsReady = false;
    const syncLoadingState = () => {
      if (studentsReady && reportsReady) {
        setIsLoading(false);
      }
    };

    const reportParentError = (source: string) => (err: string) => {
      console.error(`Parent portal load error (${source}):`, err);
      setDataError((prev) => (prev && !prev.includes(err) ? `${prev} | ${err}` : err));
    };

    const u1 = subscribeStudents(
      'parent',
      currentUser,
      firebaseUser.email,
      (list) => {
        setStudents(list);
        studentsReady = true;
        syncLoadingState();
      },
      (err) => {
        reportParentError('students')(err);
        studentsReady = true;
        syncLoadingState();
      }
    );

    const u2 = subscribePublishedReports(
      'parent',
      currentUser,
      firebaseUser.email,
      (reports) => {
        setPublishedReports(reports.filter((r) => r.isPublished === true));
        reportsReady = true;
        syncLoadingState();
      },
      (err) => {
        reportParentError('publishedReports')(err);
        reportsReady = true;
        syncLoadingState();
      }
    );

    const u3 = feeGatingEnabled
      ? subscribeStudentFees(
          'parent',
          currentUser,
          firebaseUser.email,
          setStudentFees,
          reportParentError('studentFees')
        )
      : (() => {
          setStudentFees([]);
          return () => {};
        })();

    const u4 = feeGatingEnabled
      ? subscribeFeePayments(
          'parent',
          currentUser,
          firebaseUser.email,
          setFeePayments,
          reportParentError('feePayments')
        )
      : (() => {
          setFeePayments([]);
          return () => {};
        })();

    const u5 = subscribeAnnouncements(
      'parent',
      setAnnouncements,
      reportParentError('announcements')
    );

    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
    };
  }, [firebaseUser, currentUser, feeGatingEnabled]);

  // Keep open snapshot synchronized if unpublished or republished in real time
  useEffect(() => {
    if (!selectedSnapshot) return;
    const latest = publishedReports.find(
      (r) => r.id === selectedSnapshot.id && r.isPublished === true
    );
    if (!latest) {
      setSelectedSnapshot(null);
    } else if (latest.updatedAt !== selectedSnapshot.updatedAt) {
      setSelectedSnapshot(latest);
    }
  }, [publishedReports, selectedSnapshot]);

  const sortedStudents = useMemo(() => {
    const map = new Map<string, Student>();
    students.forEach((stu) => map.set(stu.id, stu));

    // Also ensure any published report snapshot whose student record didn't match (e.g. legacy mixed-case student email)
    // still surfaces the child card from frozen snapshot metadata.
    publishedReports.forEach((snap) => {
      if (snap.isPublished && !map.has(snap.studentId)) {
        const nameParts = (snap.studentName || 'Student').trim().split(/\s+/);
        map.set(snap.studentId, {
          id: snap.studentId,
          admissionNo: snap.admissionNo,
          firstName: nameParts[0] || snap.studentName,
          surname: nameParts.slice(1).join(' ') || '',
          fullName: snap.studentName,
          dateOfBirth: '',
          gender: 'Male',
          classId: snap.classId || '',
          className: snap.className,
          guardianName: currentUser?.displayName || 'Parent / Guardian',
          guardianPhone: '',
          guardianEmail: snap.guardianEmail,
          address: '',
          admissionDate: '',
          passportPhoto: snap.passportPhoto,
          status: 'Active',
          feeStatus: 'Paid',
          stateOfOrigin: '',
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [students, publishedReports, currentUser?.displayName]);

  const reportsByStudentId = useMemo(() => {
    const map = new Map<string, PublishedReportSnapshot[]>();
    publishedReports.forEach((snap) => {
      if (!snap.isPublished) return;
      const arr = map.get(snap.studentId) || [];
      arr.push(snap);
      map.set(snap.studentId, arr);
    });
    map.forEach((arr, key) => {
      arr.sort((a, b) => {
        const sessionCmp = b.session.localeCompare(a.session);
        if (sessionCmp !== 0) return sessionCmp;
        const termCmp = (TERM_ORDER[b.term] || 0) - (TERM_ORDER[a.term] || 0);
        if (termCmp !== 0) return termCmp;
        return (b.publishedAt || '').localeCompare(a.publishedAt || '');
      });
      map.set(key, arr);
    });
    return map;
  }, [publishedReports]);

  const childClassNames = useMemo(
    () => Array.from(new Set(sortedStudents.map((s) => s.className).filter(Boolean))),
    [sortedStudents]
  );

  const visibleAnnouncements = useMemo(() => {
    const today = getTodayIsoDate();
    return filterVisibleAnnouncements(announcements, 'parent', childClassNames).filter((item) => {
      const st = item.status || 'Published';
      const pubDate = item.publishDate || item.date;
      if (st !== 'Published') return false;
      if (pubDate && pubDate > today) return false;
      return true;
    });
  }, [announcements, childClassNames]);

  const filteredAnnouncements = useMemo(() => {
    const q = announcementSearch.trim().toLowerCase();
    return visibleAnnouncements.filter((item) => {
      const matchesSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.body.toLowerCase().includes(q) ||
        item.authorName.toLowerCase().includes(q);
      const matchesCategory =
        announcementCategory === 'All' || item.category === announcementCategory;
      return matchesSearch && matchesCategory;
    });
  }, [visibleAnnouncements, announcementSearch, announcementCategory]);

  const parentEmailDisplay = firebaseUser?.email || currentUser?.email || '';

  if (isLoading) {
    return (
      <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-10 text-center text-xs text-[#5E5B56] shadow-[0_1px_2px_rgba(42,42,46,0.04)]">
        Loading your children&apos;s published report cards...
      </div>
    );
  }

  // If a parent opened a published report card, render the read-only frozen snapshot
  if (selectedSnapshot) {
    const ownerStudent = students.find((s) => s.id === selectedSnapshot.studentId);
    const feeClearance = ownerStudent
      ? computeStudentFeeClearance({
          student: ownerStudent,
          session: selectedSnapshot.session,
          term: selectedSnapshot.term,
          studentFees,
          feePayments,
        })
      : { cleared: true, outstanding: 0, hasFeeRecords: false };

    const isWithheldForFees = feeGatingEnabled && !feeClearance.cleared;

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 no-print">
          <button
            type="button"
            onClick={() => setSelectedSnapshot(null)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] text-xs font-medium transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-[#6B1020]" />
            Back to My Children
          </button>

          <span className="text-xs text-[#6E6A63]">
            {selectedSnapshot.studentName} • {selectedSnapshot.session} • {selectedSnapshot.term}
          </span>
        </div>

        {isWithheldForFees ? (
          <div className="bg-white rounded-[10px] border border-[#E3CFA6] border-t-2 border-t-[#B8913A] p-8 text-center max-w-xl mx-auto space-y-3 shadow-[0_1px_2px_rgba(42,42,46,0.04)]">
            <div className="w-12 h-12 rounded-[10px] bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6] flex items-center justify-center mx-auto">
              <Lock className="w-6 h-6" />
            </div>
            <h2 className="font-serif text-lg font-semibold text-[#2A2A2E]">
              Report Card Withheld — Outstanding School Fees
            </h2>
            <p className="text-xs text-[#5E5B56] leading-relaxed">
              The published report card for{' '}
              <strong className="text-[#2A2A2E]">{selectedSnapshot.studentName}</strong> (
              {selectedSnapshot.term}, {selectedSnapshot.session}) is currently withheld until
              school fees are fully paid.
              {feeClearance.hasFeeRecords && feeClearance.outstanding > 0 && (
                <>
                  {' '}
                  Outstanding balance:{' '}
                  <strong className="text-[#86222E]">
                    {formatNaira(feeClearance.outstanding)}
                  </strong>
                  .
                </>
              )}
            </p>
            <p className="text-[11px] text-[#6E6A63]">
              Please contact the School Bursar or Administration to settle any outstanding balance.
              Once fees are cleared, this report card unlocks automatically.
            </p>
          </div>
        ) : (
          <PublishedReportSnapshotCard
            snapshot={selectedSnapshot}
            schoolSettings={schoolSettings}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Parent Portal Section Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04)] no-print">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('children')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-[8px] text-xs font-medium transition-colors duration-150 ${
              activeTab === 'children'
                ? 'bg-[#6B1020] text-white shadow-xs'
                : 'text-[#5E5B56] hover:bg-[#FAF8F4] hover:text-[#2A2A2E]'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            My Children ({sortedStudents.length})
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedSnapshot(null);
              setActiveTab('announcements');
            }}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-[8px] text-xs font-medium transition-colors duration-150 ${
              activeTab === 'announcements'
                ? 'bg-[#6B1020] text-white shadow-xs'
                : 'text-[#5E5B56] hover:bg-[#FAF8F4] hover:text-[#2A2A2E]'
            }`}
          >
            <Megaphone className="w-3.5 h-3.5" />
            Announcements ({visibleAnnouncements.length})
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs text-[#5E5B56] bg-[#FAF8F4] px-3 py-1.5 rounded-[8px] border border-[#E6DFD3]">
          <Mail className="w-3.5 h-3.5 text-[#6B1020] shrink-0" />
          <span className="truncate max-w-[240px] font-medium text-[#2A2A2E]">
            {parentEmailDisplay}
          </span>
        </div>
      </div>

      {dataError && (
        <div className="bg-[#FAF0F2] border border-[#E2C1C5] rounded-[10px] p-4 flex items-center gap-2 text-xs text-[#86222E]">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{dataError}</span>
        </div>
      )}

      {activeTab === 'announcements' ? (
        <div className="space-y-5">
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-serif text-2xl font-semibold text-[#2A2A2E] tracking-tight">
                  School Announcements
                </h1>
                <span className="bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA] text-[11px] font-medium px-2.5 py-0.5 rounded-full tabular-nums">
                  {visibleAnnouncements.length} Published
                </span>
              </div>
              <p className="text-xs text-[#5E5B56] mt-1">
                View official school circulars and post comments or questions below each notice.
              </p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04)]">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-8 relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#7F7A72]" />
                <input
                  type="text"
                  placeholder="Search announcements by title, keyword, or sender..."
                  value={announcementSearch}
                  onChange={(e) => setAnnouncementSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] placeholder:text-[#7F7A72] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4]"
                />
              </div>

              <div className="sm:col-span-4">
                <select
                  value={announcementCategory}
                  onChange={(e) => setAnnouncementCategory(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] text-[#2A2A2E]"
                >
                  <option value="All">Category: All Types</option>
                  {ANNOUNCEMENT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {filteredAnnouncements.length === 0 ? (
            <div className="bg-white rounded-[10px] p-12 text-center text-[#6E6A63] border border-[#E6DFD3] text-xs shadow-[0_1px_2px_rgba(42,42,46,0.04)]">
              No published announcements match your current filters.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredAnnouncements.map((item) => (
                <div
                  key={item.id}
                  className={`bg-white rounded-[10px] border p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] transition-colors duration-150 ${
                    item.priority === 'Urgent'
                      ? 'border-[#E2C1C5] border-l-4 border-l-[#86222E]'
                      : item.priority === 'High'
                      ? 'border-[#E3CFA6] border-l-4 border-l-[#B8913A]'
                      : 'border-[#E6DFD3]'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-[10px] uppercase font-semibold tracking-wider px-2.5 py-0.5 rounded-full border ${
                          item.priority === 'Urgent'
                            ? 'bg-[#FAF0F2] text-[#86222E] border-[#E2C1C5]'
                            : item.priority === 'High'
                            ? 'bg-[#FBF5E8] text-[#7D5A18] border-[#E3CFA6]'
                            : 'bg-[#FAF8F4] text-[#5E5B56] border-[#E6DFD3]'
                        }`}
                      >
                        {item.priority} Priority
                      </span>

                      <span className="text-[10px] font-medium bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA] px-2.5 py-0.5 rounded-full">
                        Target: {item.targetAudience}
                        {item.targetAudience === 'Specific Classes' &&
                        item.targetClasses &&
                        item.targetClasses.length > 0
                          ? ` (${item.targetClasses.join(', ')})`
                          : ''}
                      </span>

                      <span className="text-[10px] font-medium bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6] px-2.5 py-0.5 rounded-full">
                        {item.category}
                      </span>
                    </div>

                    <span className="text-xs text-[#6E6A63] flex items-center gap-1 tabular-nums">
                      <Calendar className="w-3.5 h-3.5" />
                      Published: {item.publishDate || item.date}
                    </span>
                  </div>

                  <h3 className="text-base font-semibold text-[#2A2A2E] mb-2">{item.title}</h3>

                  {item.eventStartDate && (
                    <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-[#6B1020] bg-[#FAF0F2] px-2.5 py-1 rounded-[6px] border border-[#DFC7CA] tabular-nums">
                      <CalendarDays className="w-3.5 h-3.5" />
                      Event Date: {item.eventStartDate}
                      {item.eventEndDate && item.eventEndDate !== item.eventStartDate
                        ? ` to ${item.eventEndDate}`
                        : ''}
                    </div>
                  )}

                  <p className="text-xs text-[#5E5B56] leading-relaxed whitespace-pre-line mb-4">
                    {item.body}
                  </p>

                  <div className="pt-3 border-t border-[#EFE9DF] flex flex-wrap items-center justify-between gap-2 text-xs text-[#6E6A63]">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[#6B1020] text-white font-semibold text-[10px] flex items-center justify-center">
                        {item.authorName.charAt(0)}
                      </div>
                      <span>
                        Issued by: <strong className="text-[#2A2A2E] font-medium">{item.authorName}</strong> (
                        {item.authorRole})
                      </span>
                    </div>

                    <span className="text-[11px] text-[#7F7A72]">
                      {item.term} • {item.session}
                    </span>
                  </div>

                  <AnnouncementCommentsSection
                    announcementId={item.id}
                    canModerate={false}
                    defaultExpanded={true}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Unmatched Google email empty state */}
          {sortedStudents.length === 0 ? (
        <div className="bg-white rounded-[10px] border border-[#E6DFD3] border-t-2 border-t-[#B8913A] p-8 sm:p-10 text-center max-w-2xl mx-auto shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
          <div className="w-12 h-12 rounded-[10px] bg-[#FAF0F2] text-[#6B1020] flex items-center justify-center mx-auto border border-[#E2C1C5]">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-serif text-xl font-semibold text-[#2A2A2E]">
              No students are linked to this email
            </h2>
            <p className="text-xs text-[#5E5B56] mt-2 leading-relaxed">
              No student record at <strong>{schoolSettings.schoolName}</strong> currently has{' '}
              <strong className="text-[#2A2A2E]">{parentEmailDisplay}</strong> listed as their
              Parent Email.
            </p>
          </div>

          <div className="p-4 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-xs text-[#5E5B56] text-left space-y-1.5">
            <p className="font-semibold text-[#2A2A2E]">What to do next:</p>
            <p>
              1. Confirm you signed in with the exact Gmail / Google address you gave the school.
            </p>
            <p>
              2. Ask the School Administrator or Principal to update your child&apos;s{' '}
              <strong>Parent Email</strong> to{' '}
              <span className="font-mono text-[#6B1020]">{parentEmailDisplay}</span>.
            </p>
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={signOutUser}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out / Switch Google Account
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Page Intro Header */}
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-serif text-2xl font-semibold text-[#2A2A2E] tracking-tight">
                  My Children
                </h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB]">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {sortedStudents.length} Child{sortedStudents.length === 1 ? '' : 'ren'} Linked
                </span>
              </div>
              <p className="text-xs text-[#5E5B56] mt-1">
                Select any published terminal report card below to view, print, or download as PDF.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-[#5E5B56] bg-[#FAF8F4] px-3 py-2 rounded-[8px] border border-[#E6DFD3]">
              <Mail className="w-3.5 h-3.5 text-[#6B1020] shrink-0" />
              <span className="truncate font-medium text-[#2A2A2E]">{parentEmailDisplay}</span>
            </div>
          </div>

          {/* Children List Cards */}
          <div className="space-y-6">
            {sortedStudents.map((child) => {
              const childReports = reportsByStudentId.get(child.id) || [];

              // Group reports by session for neat presentation
              const reportsBySession = new Map<string, PublishedReportSnapshot[]>();
              childReports.forEach((snap) => {
                const list = reportsBySession.get(snap.session) || [];
                list.push(snap);
                reportsBySession.set(snap.session, list);
              });

              return (
                <div
                  key={child.id}
                  className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] overflow-hidden"
                >
                  {/* Child Header with Passport Photo, Name & Class */}
                  <div className="p-5 sm:p-6 bg-[#FAF8F4] border-b border-[#E6DFD3] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      {child.passportPhoto ? (
                        <img
                          src={child.passportPhoto}
                          alt={child.fullName}
                          className="w-16 h-20 rounded-[10px] object-cover border border-[#B8913A]/50 shrink-0 bg-white"
                        />
                      ) : (
                        <div className="w-16 h-20 rounded-[10px] bg-[#6B1020] text-[#DFC484] flex items-center justify-center font-semibold text-xl border border-[#B8913A]/50 shrink-0">
                          {(child.firstName || child.fullName).charAt(0)}
                          {(child.surname || '').charAt(0)}
                        </div>
                      )}

                      <div className="space-y-1">
                        <h2 className="font-serif text-lg sm:text-xl font-semibold text-[#2A2A2E]">
                          {child.fullName}
                        </h2>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[6px] bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA] font-medium">
                            <GraduationCap className="w-3.5 h-3.5" />
                            {child.className}
                          </span>
                          <span className="font-mono text-[11px] text-[#5E5B56] bg-white px-2.5 py-0.5 rounded-[6px] border border-[#E6DFD3]">
                            Adm No: {child.admissionNo}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-[#5E5B56] shrink-0">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-white border border-[#E6DFD3] font-medium text-[#2A2A2E]">
                        <FileText className="w-3.5 h-3.5 text-[#6B1020]" />
                        {childReports.length} Published Report Card
                        {childReports.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>

                  {/* Child Published Report Cards by Session & Term */}
                  <div className="p-5 sm:p-6">
                    {childReports.length === 0 ? (
                      <div className="p-6 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-center text-xs text-[#6E6A63]">
                        No report cards have been published for{' '}
                        <strong className="text-[#2A2A2E]">{child.fullName}</strong> yet. When the
                        Principal or Director publishes a term report card, it will appear here.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {Array.from(reportsBySession.entries()).map(([sessionName, snaps]) => (
                          <div key={sessionName} className="space-y-2.5">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                              <Calendar className="w-3.5 h-3.5 text-[#B8913A]" />
                              <span>{sessionName}</span>
                            </div>

                            <div className="divide-y divide-[#EFE9DF] border border-[#E6DFD3] rounded-[8px] overflow-hidden">
                              {snaps.map((snap) => {
                                const feeClearance = computeStudentFeeClearance({
                                  student: child,
                                  session: snap.session,
                                  term: snap.term,
                                  studentFees,
                                  feePayments,
                                });
                                const isWithheld = feeGatingEnabled && !feeClearance.cleared;
                                const pubDate = formatPublishDate(snap.publishedAt);
                                const isBusyPdf = downloadingReportId === snap.id;

                                return (
                                  <div
                                    key={snap.id}
                                    className="p-4 bg-white hover:bg-[#FAF8F4]/70 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                                  >
                                    <div className="space-y-1.5">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-semibold text-sm text-[#2A2A2E]">
                                          {snap.term}
                                        </span>
                                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-[6px] bg-[#FAF8F4] border border-[#E6DFD3] text-[#5E5B56]">
                                          {snap.className}
                                        </span>
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB]">
                                          <Globe className="w-3 h-3" />
                                          Published{pubDate ? ` • ${pubDate}` : ''}
                                        </span>
                                      </div>

                                      {isWithheld ? (
                                        <div className="p-2.5 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6] text-xs text-[#7D5A18] flex items-start gap-2">
                                          <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                                          <span>
                                            <strong>Report Withheld:</strong> School fees for{' '}
                                            {snap.term} ({snap.session}) are not fully paid
                                            {feeClearance.hasFeeRecords &&
                                            feeClearance.outstanding > 0
                                              ? ` (Outstanding balance: ${formatNaira(feeClearance.outstanding)})`
                                              : ''}
                                            . Please settle fees with the Bursar to view or download
                                            this report card.
                                          </span>
                                        </div>
                                      ) : (
                                        <div className="flex flex-wrap items-center gap-3 text-xs text-[#5E5B56]">
                                          <span className="inline-flex items-center gap-1">
                                            <Award className="w-3.5 h-3.5 text-[#B8913A]" />
                                            Average:{' '}
                                            <strong className="text-[#6B1020] tabular-nums">
                                              {snap.subjectsCount > 0
                                                ? `${snap.averagePercentage}%`
                                                : '—'}
                                            </strong>
                                          </span>
                                          <span>
                                            Grade:{' '}
                                            <strong className="font-mono text-[#2A2A2E]">
                                              {snap.overallGrade}
                                            </strong>
                                          </span>
                                          {snap.position && (
                                            <span>
                                              Position:{' '}
                                              <strong className="text-[#2A583B]">
                                                {formatOrdinal(snap.position)} of{' '}
                                                {snap.totalRankedStudents}
                                              </strong>
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>

                                    {!isWithheld && (
                                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                                        <button
                                          type="button"
                                          disabled={isBusyPdf}
                                          onClick={async () => {
                                            setDownloadingReportId(snap.id);
                                            try {
                                              await downloadPublishedSnapshotPDF(
                                                snap,
                                                schoolSettings
                                              );
                                            } finally {
                                              setDownloadingReportId(null);
                                            }
                                          }}
                                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] text-xs font-medium transition-colors disabled:opacity-50"
                                        >
                                          <Download className="w-3.5 h-3.5 text-[#6B1020]" />
                                          {isBusyPdf ? 'Preparing PDF...' : 'Download PDF'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setSelectedSnapshot(snap)}
                                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors"
                                        >
                                          <Eye className="w-3.5 h-3.5" />
                                          Open Report Card
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
        </>
      )}
    </div>
  );
};
