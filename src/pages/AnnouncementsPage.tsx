import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock,
  Database,
  History,
  Info,
  Megaphone,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  AcademicSession,
  AcademicTerm,
  Announcement,
  AnnouncementCategory,
  CalendarEventType,
  SchoolCalendarEvent,
  SchoolClass,
  Student,
} from '../types';
import {
  DEFAULT_ACADEMIC_SESSION,
  SAMPLE_CLASSES,
} from '../data/sampleData';
import { extractFriendlyError, subscribeStudents } from '../services/schoolService';
import { subscribeAcademicSessions, subscribeClasses } from '../services/academicService';
import { getActiveClasses, groupClassesBySection } from '../utils/classUtils';
import {
  deleteAnnouncementFromFirestore,
  deleteCalendarEventFromFirestore,
  filterVisibleAnnouncements,
  filterVisibleCalendarEvents,
  getTodayIsoDate,
  saveAnnouncementToFirestore,
  saveCalendarEventToFirestore,
  seedDefaultCommunicationToFirestore,
  subscribeAnnouncements,
  subscribeCalendarEvents,
  updateAnnouncementStatusInFirestore,
} from '../services/communicationService';
import { AnnouncementCommentsSection } from '../components/announcements/AnnouncementCommentsSection';

type CommTab = 'notices' | 'calendar' | 'history';

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

const CALENDAR_EVENT_TYPES: CalendarEventType[] = [
  'Examination Schedule',
  'Resumption Date',
  'Holiday',
  'Mid-Term Break',
  'PTA Meeting',
  'School Event',
];

export const AnnouncementsPage: React.FC = () => {
  const { role, currentUser, firebaseUser, schoolSettings } = useAuth();
  const isLiveFirestore = Boolean(firebaseUser);
  const isAdmin = role === 'director' || role === 'principal';
  const isDirector = role === 'director';

  const [activeTab, setActiveTab] = useState<CommTab>('notices');
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<SchoolCalendarEvent[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([DEFAULT_ACADEMIC_SESSION]);
  const [classesList, setClassesList] = useState<SchoolClass[]>(SAMPLE_CLASSES);
  const [scopedStudents, setScopedStudents] = useState<Student[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(isLiveFirestore);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAudience, setSelectedAudience] = useState<string>('All');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<
    'All' | 'Published' | 'Scheduled' | 'Archived'
  >('All');
  const [calendarTypeFilter, setCalendarTypeFilter] = useState<string>('All');

  // Modals
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);

  const activeSessionObj = useMemo(
    () => sessions.find((s) => s.isActive) || sessions[0] || DEFAULT_ACADEMIC_SESSION,
    [sessions]
  );
  const activeTermName: AcademicTerm = useMemo(
    () => activeSessionObj.terms.find((t) => t.isActive)?.name || schoolSettings.currentTerm,
    [activeSessionObj]
  );

  // Circular Form State
  const today = getTodayIsoDate();
  const [noticeForm, setNoticeForm] = useState<{
    title: string;
    body: string;
    targetAudience: Announcement['targetAudience'];
    targetClasses: string[];
    priority: Announcement['priority'];
    category: AnnouncementCategory;
    publishDate: string;
    session: string;
    term: AcademicTerm;
    alsoAddToCalendar: boolean;
    eventStartDate: string;
    eventEndDate: string;
  }>({
    title: '',
    body: '',
    targetAudience: 'Parents',
    targetClasses: [],
    priority: 'Normal',
    category: 'General Notice',
    publishDate: today,
    session: activeSessionObj.name,
    term: activeTermName,
    alsoAddToCalendar: false,
    eventStartDate: today,
    eventEndDate: today,
  });

  // Standalone Calendar Event Form State
  const [calendarForm, setCalendarForm] = useState<{
    title: string;
    eventType: CalendarEventType;
    session: string;
    term: AcademicTerm;
    startDate: string;
    endDate: string;
    targetAudience: SchoolCalendarEvent['targetAudience'];
    targetClasses: string[];
    description: string;
  }>({
    title: '',
    eventType: 'Examination Schedule',
    session: activeSessionObj.name,
    term: activeTermName,
    startDate: today,
    endDate: today,
    targetAudience: 'All',
    targetClasses: [],
    description: '',
  });

  useEffect(() => {
    setNoticeForm((prev) => ({
      ...prev,
      session: activeSessionObj.name,
      term: activeTermName,
    }));
    setCalendarForm((prev) => ({
      ...prev,
      session: activeSessionObj.name,
      term: activeTermName,
    }));
  }, [activeSessionObj.name, activeTermName]);

  // Ensure non-admins cannot stay on History tab
  useEffect(() => {
    if (!isAdmin && activeTab === 'history') {
      setActiveTab('notices');
    }
  }, [isAdmin, activeTab]);

  useEffect(() => {
    if (!firebaseUser) {
      setAnnouncements([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    const unsubs = [
      subscribeAnnouncements(
        role,
        (list) => {
          setAnnouncements(list);
          setIsLoading(false);
        },
        (err) => {
          setErrorMsg(err);
          setIsLoading(false);
        }
      ),
      subscribeCalendarEvents(setCalendarEvents, setErrorMsg),
      subscribeAcademicSessions(setSessions, setErrorMsg),
      subscribeClasses((cls) => setClassesList(cls), setErrorMsg),
    ];

    if (role === 'parent') {
      unsubs.push(
        subscribeStudents('parent', currentUser, firebaseUser.email, setScopedStudents, setErrorMsg)
      );
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [firebaseUser, role, currentUser]);

  // Derive classes relevant to the signed-in user for class-targeted notice filtering
  const userClassNames = useMemo(() => {
    if (role === 'teacher') {
      return currentUser?.assignedClasses || [];
    }
    if (role === 'parent') {
      return Array.from(new Set(scopedStudents.map((s) => s.className).filter(Boolean)));
    }
    return classesList.map((c) => c.name);
  }, [role, currentUser, scopedStudents, classesList]);

  // Role & publication-date filtered visible notices (for active board)
  const roleVisibleNotices = useMemo(() => {
    const visible = filterVisibleAnnouncements(announcements, role, userClassNames);
    // On the main notices board, show Published & currently active notices (even for admins, keep Scheduled/Archived in History tab)
    return visible.filter((item) => {
      const st = item.status || 'Published';
      const pubDate = item.publishDate || item.date;
      if (st !== 'Published') return false;
      if (pubDate && pubDate > getTodayIsoDate()) return false;
      return true;
    });
  }, [announcements, role, userClassNames]);

  const filteredNotices = useMemo(() => {
    return roleVisibleNotices.filter((item) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.body.toLowerCase().includes(q) ||
        item.authorName.toLowerCase().includes(q);

      const matchesAudience =
        selectedAudience === 'All' || item.targetAudience === selectedAudience;

      const matchesCategory =
        selectedCategory === 'All' || item.category === selectedCategory;

      return matchesSearch && matchesAudience && matchesCategory;
    });
  }, [roleVisibleNotices, searchQuery, selectedAudience, selectedCategory]);

  // Full history for Director/Principal
  const filteredHistory = useMemo(() => {
    return announcements.filter((item) => {
      const status = item.status || 'Published';
      if (historyStatusFilter !== 'All' && status !== historyStatusFilter) return false;
      const q = searchQuery.toLowerCase();
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.body.toLowerCase().includes(q) ||
        item.authorName.toLowerCase().includes(q)
      );
    });
  }, [announcements, historyStatusFilter, searchQuery]);

  // Calendar events filtered by user class visibility + type filter
  const visibleCalendarEvents = useMemo(() => {
    const base = filterVisibleCalendarEvents(calendarEvents, role, userClassNames);
    if (calendarTypeFilter === 'All') return base;
    return base.filter((ev) => ev.eventType === calendarTypeFilter);
  }, [calendarEvents, role, userClassNames, calendarTypeFilter]);

  const toggleClassTarget = (
    list: string[],
    className: string,
    setter: (next: string[]) => void
  ) => {
    if (list.includes(className)) {
      setter(list.filter((c) => c !== className));
    } else {
      setter([...list, className]);
    }
  };

  const handlePublishNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!isAdmin) {
      setErrorMsg('Unauthorized: Only the Director and Principal can issue official circulars.');
      return;
    }
    if (!firebaseUser) {
      setErrorMsg('Please sign in via Firebase Authentication to publish notices to Firestore.');
      return;
    }
    if (
      noticeForm.targetAudience === 'Specific Classes' &&
      noticeForm.targetClasses.length === 0
    ) {
      setErrorMsg('Please select at least one target class for class-specific notices.');
      return;
    }

    setIsSubmitting(true);
    try {
      const saved = await saveAnnouncementToFirestore({
        announcement: {
          title: noticeForm.title.trim(),
          body: noticeForm.body.trim(),
          targetAudience: noticeForm.targetAudience,
          targetClasses: noticeForm.targetClasses,
          priority: noticeForm.priority,
          category: noticeForm.category,
          authorName: currentUser?.displayName || 'School Administration',
          authorRole: currentUser?.title || (role === 'director' ? 'Director' : 'Principal'),
          term: noticeForm.term,
          session: noticeForm.session,
          date: noticeForm.publishDate,
          publishDate: noticeForm.publishDate,
          eventStartDate: noticeForm.alsoAddToCalendar ? noticeForm.eventStartDate : undefined,
          eventEndDate: noticeForm.alsoAddToCalendar
            ? noticeForm.eventEndDate || noticeForm.eventStartDate
            : undefined,
        },
        actorUid: firebaseUser.uid,
        alsoCreateCalendarEvent: noticeForm.alsoAddToCalendar,
      });

      setSuccessMsg(
        saved.status === 'Scheduled'
          ? `Circular "${saved.title}" scheduled for publication on ${saved.publishDate}.`
          : `Circular "${saved.title}" published to SchoolDesk in-portal notices.`
      );
      setIsPublishModalOpen(false);
      setNoticeForm({
        title: '',
        body: '',
        targetAudience: 'Parents',
        targetClasses: [],
        priority: 'Normal',
        category: 'General Notice',
        publishDate: getTodayIsoDate(),
        session: activeSessionObj.name,
        term: activeTermName,
        alsoAddToCalendar: false,
        eventStartDate: getTodayIsoDate(),
        eventEndDate: getTodayIsoDate(),
      });
    } catch (err) {
      setErrorMsg(extractFriendlyError(err, 'Failed to publish school announcement.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveCalendarEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!isAdmin || !firebaseUser) {
      setErrorMsg('Only authenticated Directors and Principals can publish calendar events.');
      return;
    }
    if (
      calendarForm.targetAudience === 'Specific Classes' &&
      calendarForm.targetClasses.length === 0
    ) {
      setErrorMsg('Please select at least one class for a class-specific event.');
      return;
    }

    setIsSubmitting(true);
    try {
      await saveCalendarEventToFirestore(
        {
          title: calendarForm.title.trim(),
          eventType: calendarForm.eventType,
          session: calendarForm.session,
          term: calendarForm.term,
          startDate: calendarForm.startDate,
          endDate: calendarForm.endDate || calendarForm.startDate,
          targetAudience: calendarForm.targetAudience,
          targetClasses: calendarForm.targetClasses,
          description: calendarForm.description.trim(),
        },
        currentUser?.displayName || 'School Administration'
      );
      setSuccessMsg(`Calendar event "${calendarForm.title}" published.`);
      setIsCalendarModalOpen(false);
      setCalendarForm({
        title: '',
        eventType: 'Examination Schedule',
        session: activeSessionObj.name,
        term: activeTermName,
        startDate: getTodayIsoDate(),
        endDate: getTodayIsoDate(),
        targetAudience: 'All',
        targetClasses: [],
        description: '',
      });
    } catch (err) {
      setErrorMsg(extractFriendlyError(err, 'Failed to publish school calendar event.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, nextStatus: 'Published' | 'Archived') => {
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await updateAnnouncementStatusInFirestore(id, nextStatus);
      setSuccessMsg(
        nextStatus === 'Published'
          ? 'Announcement published immediately.'
          : 'Announcement moved to archive.'
      );
    } catch (err) {
      setErrorMsg(extractFriendlyError(err, 'Failed to update announcement status.'));
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    setErrorMsg('');
    try {
      await deleteAnnouncementFromFirestore(id);
      setSuccessMsg('Announcement deleted permanently.');
    } catch (err) {
      setErrorMsg(extractFriendlyError(err, 'Only the School Director can delete announcements.'));
    }
  };

  const handleDeleteCalendarEvent = async (id: string) => {
    setErrorMsg('');
    try {
      await deleteCalendarEventFromFirestore(id);
      setSuccessMsg('Calendar event removed.');
    } catch (err) {
      setErrorMsg(extractFriendlyError(err, 'Failed to remove calendar event.'));
    }
  };

  const handleSeedStarter = async () => {
    if (!isAdmin || !firebaseUser) return;
    setIsSubmitting(true);
    setErrorMsg('');
    try {
      await seedDefaultCommunicationToFirestore(
        currentUser?.displayName || 'School Administration',
        firebaseUser.uid,
        activeSessionObj.name,
        activeTermName
      );
      setSuccessMsg('Starter academic calendar events and welcome notice created in Firestore.');
    } catch (err) {
      setErrorMsg(extractFriendlyError(err, 'Failed to seed communication data.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#2A2A2E] tracking-tight">
              School Communication &amp; Calendar
            </h1>
            <span className="bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA] text-xs font-medium px-2.5 py-0.5 rounded-full tabular-nums">
              {roleVisibleNotices.length} Published Notices
            </span>
          </div>
          <p className="text-xs text-[#6E6A63] mt-1">
            Official school notices, exam schedules, resumption dates, holidays, and circular
            history
          </p>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            {isLiveFirestore && announcements.length === 0 && calendarEvents.length === 0 && (
              <button
                onClick={handleSeedStarter}
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6] hover:bg-[#F4E9D0] text-[#7D5A18] text-xs font-medium transition-colors duration-150"
              >
                <Database className="w-3.5 h-3.5" />
                Seed Starter Calendar &amp; Notice
              </button>
            )}
            <button
              onClick={() => setIsCalendarModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-white border border-[#DDD5C7] hover:bg-[#FAF8F4] text-[#2A2A2E] text-xs font-medium shadow-xs transition-colors duration-150"
            >
              <Calendar className="w-3.5 h-3.5 text-[#6B1020]" />
              Add Calendar Event
            </button>
            <button
              onClick={() => setIsPublishModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium shadow-xs transition-colors duration-150"
            >
              <Plus className="w-4 h-4" />
              Issue New Circular
            </button>
          </div>
        )}
      </div>

      {/* Honest In-Portal Messaging Notice */}
      <div className="bg-[#FAF0F2] border border-[#DFC7CA] rounded-[8px] p-3.5 flex items-start gap-2.5 text-xs text-[#2A2A2E]">
        <Info className="w-4 h-4 text-[#6B1020] shrink-0 mt-0.5" />
        <div>
          <strong className="font-semibold text-[#6B1020]">In-Portal School Communication:</strong>{' '}
          Circulars and calendar events published here appear securely inside SchoolDesk Parent,
          Teacher, and Staff portals according to audience targeting and publication dates. External
          WhatsApp and SMS broadcasting are not integrated.
        </div>
      </div>

      {errorMsg && (
        <div className="bg-[#FAF0F2] border border-[#E2C1C5] rounded-[8px] p-3.5 flex items-center gap-2 text-xs text-[#86222E]">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="bg-[#EEF4F0] border border-[#C5D6CB] rounded-[8px] p-3.5 flex items-center justify-between gap-2 text-xs text-[#2A583B]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg('')} className="text-[#2A583B] hover:text-[#20452E]">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 bg-white p-2 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
        <button
          onClick={() => setActiveTab('notices')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-[8px] text-xs font-medium transition-colors duration-150 ${
            activeTab === 'notices'
              ? 'bg-[#6B1020] text-white shadow-xs'
              : 'text-[#5E5B56] hover:bg-[#FAF8F4] hover:text-[#2A2A2E]'
          }`}
        >
          <Megaphone className="w-3.5 h-3.5" />
          School Notices &amp; Circulars ({roleVisibleNotices.length})
        </button>

        <button
          onClick={() => setActiveTab('calendar')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-[8px] text-xs font-medium transition-colors duration-150 ${
            activeTab === 'calendar'
              ? 'bg-[#6B1020] text-white shadow-xs'
              : 'text-[#5E5B56] hover:bg-[#FAF8F4] hover:text-[#2A2A2E]'
          }`}
        >
          <CalendarDays className="w-3.5 h-3.5" />
          School Calendar, Exams &amp; Holidays ({visibleCalendarEvents.length})
        </button>

        {isAdmin && (
          <button
            onClick={() => setActiveTab('history')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-[8px] text-xs font-medium transition-colors duration-150 ${
              activeTab === 'history'
                ? 'bg-[#6B1020] text-white shadow-xs'
                : 'text-[#5E5B56] hover:bg-[#FAF8F4] hover:text-[#2A2A2E]'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Announcement History ({announcements.length})
          </button>
        )}
      </div>

      {/* TAB 1: SCHOOL NOTICES & CIRCULARS */}
      {activeTab === 'notices' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-6 relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#7F7A72]" />
                <input
                  type="text"
                  placeholder="Search circulars by keyword, title, or issuer..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] placeholder:text-[#7F7A72] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4]"
                />
              </div>

              <div className="lg:col-span-3">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
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

              <div className="lg:col-span-3">
                <select
                  value={selectedAudience}
                  onChange={(e) => setSelectedAudience(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] text-[#2A2A2E]"
                >
                  <option value="All">Audience: All Visible</option>
                  <option value="Parents">Parents</option>
                  <option value="Specific Classes">Class-Specific</option>
                  {role !== 'parent' && <option value="Teachers">Teachers</option>}
                  <option value="Students">Students</option>
                </select>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="bg-white rounded-[10px] p-10 text-center text-[#6E6A63] border border-[#E6DFD3] text-xs shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              Loading official notices from Cloud Firestore...
            </div>
          ) : filteredNotices.length === 0 ? (
            <div className="bg-white rounded-[10px] p-12 text-center text-[#6E6A63] border border-[#E6DFD3] text-xs shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              No published notices matching your filters.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredNotices.map((item) => (
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
                    canModerate={isAdmin}
                    defaultExpanded={false}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SCHOOL CALENDAR, EXAMS & HOLIDAYS */}
      {activeTab === 'calendar' && (
        <div className="space-y-6">
          {/* Term Calendar Cards from Active Session */}
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
            <h2 className="text-sm font-semibold text-[#2A2A2E] mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#6B1020]" />
              Nigerian Academic Term Schedule ({activeSessionObj.name})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {activeSessionObj.terms.map((t) => (
                <div
                  key={t.name}
                  className={`p-4 rounded-[8px] border ${
                    t.isActive
                      ? 'bg-[#FAF0F2] border-[#DFC7CA] border-t-2 border-t-[#B8913A]'
                      : 'bg-[#FAF8F4] border-[#E6DFD3]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm text-[#2A2A2E]">{t.name}</span>
                    {t.isActive && (
                      <span className="text-[10px] font-medium bg-[#6B1020] text-white px-2.5 py-0.5 rounded-full">
                        Current Term
                      </span>
                    )}
                  </div>
                  <div className="space-y-1 text-xs text-[#5E5B56] tabular-nums">
                    <p>
                      Resumption: <strong className="text-[#2A2A2E] font-medium">{t.startDate}</strong>
                    </p>
                    <p>
                      Vacation / Close: <strong className="text-[#2A2A2E] font-medium">{t.endDate}</strong>
                    </p>
                    <p>
                      Next Term Resumes:{' '}
                      <strong className="text-[#6B1020] font-semibold">{t.nextTermResumption}</strong>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Published School Events (Exams, Resumption, Holidays) */}
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#2A2A2E]">
                  Published Examination Schedules, Resumption Dates &amp; Holidays
                </h2>
                <p className="text-xs text-[#6E6A63]">
                  Official dates published by School Administration
                </p>
              </div>
              <select
                value={calendarTypeFilter}
                onChange={(e) => setCalendarTypeFilter(e.target.value)}
                className="px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
              >
                <option value="All">All Event Types</option>
                {CALENDAR_EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {visibleCalendarEvents.length === 0 ? (
              <div className="p-8 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-center text-xs text-[#6E6A63]">
                No calendar events published for this filter yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {visibleCalendarEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-4 rounded-[8px] border border-[#E6DFD3] bg-[#FAF8F4] flex flex-col justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span
                          className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${
                            ev.eventType === 'Examination Schedule'
                              ? 'bg-[#FAF0F2] text-[#86222E] border-[#E2C1C5]'
                              : ev.eventType === 'Holiday' || ev.eventType === 'Mid-Term Break'
                              ? 'bg-[#FBF5E8] text-[#7D5A18] border-[#E3CFA6]'
                              : ev.eventType === 'Resumption Date'
                              ? 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]'
                              : 'bg-[#FAF0F2] text-[#6B1020] border-[#DFC7CA]'
                          }`}
                        >
                          {ev.eventType}
                        </span>
                        <span className="text-xs font-semibold text-[#6B1020] font-mono tabular-nums">
                          {ev.startDate}
                          {ev.endDate && ev.endDate !== ev.startDate ? ` → ${ev.endDate}` : ''}
                        </span>
                      </div>
                      <h3 className="font-semibold text-sm text-[#2A2A2E]">{ev.title}</h3>
                      {ev.description && (
                        <p className="text-xs text-[#5E5B56] mt-1">{ev.description}</p>
                      )}
                    </div>

                    <div className="pt-2 border-t border-[#E6DFD3] flex items-center justify-between text-[11px] text-[#6E6A63]">
                      <span>
                        {ev.term} • Target: {ev.targetAudience}
                        {ev.targetAudience === 'Specific Classes' &&
                        ev.targetClasses &&
                        ev.targetClasses.length > 0
                          ? ` (${ev.targetClasses.join(', ')})`
                          : ''}
                      </span>
                      {isAdmin && isLiveFirestore && (
                        <button
                          onClick={() => handleDeleteCalendarEvent(ev.id)}
                          className="text-[#86222E] hover:text-[#6E1A24] font-medium inline-flex items-center gap-1 transition-colors duration-150"
                        >
                          <Trash2 className="w-3 h-3" />
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: ANNOUNCEMENT HISTORY (Director & Principal Only) */}
      {activeTab === 'history' && isAdmin && (
        <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[#2A2A2E]">
                Announcement History &amp; Publication Log
              </h2>
              <p className="text-xs text-[#6E6A63]">
                Manage published, scheduled, and archived school circulars
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['All', 'Published', 'Scheduled', 'Archived'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setHistoryStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors duration-150 ${
                    historyStatusFilter === status
                      ? 'bg-[#6B1020] text-white'
                      : 'bg-[#FAF8F4] border border-[#E6DFD3] text-[#5E5B56] hover:bg-[#EFE9DF]'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="p-8 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-center text-xs text-[#6E6A63]">
              No announcements recorded in history for this filter.
            </div>
          ) : (
            <div className="overflow-x-auto border border-[#E6DFD3] rounded-[8px]">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[#5E5B56] uppercase text-[11px] font-semibold tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Circular Title &amp; Category</th>
                    <th className="px-4 py-3">Target Audience</th>
                    <th className="px-4 py-3">Publication Date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Issued By</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE9DF]">
                  {filteredHistory.map((item) => {
                    const status = item.status || 'Published';
                    return (
                      <tr key={item.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-[#2A2A2E]">{item.title}</p>
                          <p className="text-[11px] text-[#6E6A63]">
                            {item.category} • {item.priority} Priority
                          </p>
                        </td>
                        <td className="px-4 py-3 text-[#2A2A2E]">
                          <span className="font-medium">{item.targetAudience}</span>
                          {item.targetAudience === 'Specific Classes' &&
                            item.targetClasses &&
                            item.targetClasses.length > 0 && (
                              <span className="block text-[11px] text-[#6E6A63]">
                                {item.targetClasses.join(', ')}
                              </span>
                            )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[#5E5B56] tabular-nums">
                          {item.publishDate || item.date}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${
                              status === 'Published'
                                ? 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]'
                                : status === 'Scheduled'
                                ? 'bg-[#FBF5E8] text-[#7D5A18] border-[#E3CFA6]'
                                : 'bg-[#FAF8F4] text-[#5E5B56] border-[#E6DFD3]'
                            }`}
                          >
                            {status === 'Scheduled' && <Clock className="w-3 h-3" />}
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[#5E5B56]">{item.authorName}</td>
                        <td className="px-4 py-3 text-right">
                          {isLiveFirestore && (
                            <div className="inline-flex items-center gap-1.5">
                              {status !== 'Published' ? (
                                <button
                                  onClick={() => handleStatusChange(item.id, 'Published')}
                                  className="px-2.5 py-1 rounded-[8px] bg-[#2A583B] hover:bg-[#20452E] text-white font-medium text-[11px] inline-flex items-center gap-1 transition-colors duration-150"
                                >
                                  <Send className="w-3 h-3" />
                                  Publish Now
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleStatusChange(item.id, 'Archived')}
                                  className="px-2.5 py-1 rounded-[8px] bg-white border border-[#DDD5C7] hover:bg-[#FAF8F4] text-[#2A2A2E] font-medium text-[11px] inline-flex items-center gap-1 transition-colors duration-150"
                                >
                                  <Archive className="w-3 h-3" />
                                  Archive
                                </button>
                              )}
                              {isDirector && (
                                <button
                                  onClick={() => handleDeleteAnnouncement(item.id)}
                                  className="p-1.5 rounded-[8px] text-[#86222E] hover:bg-[#FAF0F2] transition-colors duration-150"
                                  title="Delete permanently"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PUBLISH NOTICE MODAL */}
      {isPublishModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs">
          <div className="bg-white rounded-[10px] max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3]">
            <div className="flex items-center justify-between pb-4 border-b border-[#EFE9DF]">
              <div>
                <h3 className="font-semibold text-base text-[#2A2A2E]">
                  Issue Official School Circular
                </h3>
                <p className="text-[11px] text-[#6E6A63] mt-0.5">
                  Publishes to SchoolDesk portals only (no WhatsApp or SMS dispatch).
                </p>
              </div>
              <button
                onClick={() => setIsPublishModalOpen(false)}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors duration-150"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePublishNotice} className="py-4 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-[#2A2A2E] mb-1">Notice Title *</label>
                <input
                  type="text"
                  required
                  maxLength={150}
                  placeholder="e.g. First Term Terminal Examination Timetable & Guidelines"
                  value={noticeForm.title}
                  onChange={(e) => setNoticeForm({ ...noticeForm, title: e.target.value })}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Category</label>
                  <select
                    value={noticeForm.category}
                    onChange={(e) =>
                      setNoticeForm({
                        ...noticeForm,
                        category: e.target.value as AnnouncementCategory,
                      })
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  >
                    {ANNOUNCEMENT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Target Audience</label>
                  <select
                    value={noticeForm.targetAudience}
                    onChange={(e) =>
                      setNoticeForm({
                        ...noticeForm,
                        targetAudience: e.target.value as Announcement['targetAudience'],
                      })
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  >
                    <option value="All">All School</option>
                    <option value="Parents">All Parents</option>
                    <option value="Specific Classes">Specific Classes (Parents &amp; Staff)</option>
                    <option value="Teachers">Teachers &amp; Faculty Only</option>
                    <option value="Students">Students</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Priority</label>
                  <select
                    value={noticeForm.priority}
                    onChange={(e) =>
                      setNoticeForm({
                        ...noticeForm,
                        priority: e.target.value as Announcement['priority'],
                      })
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  >
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>
              </div>

              {noticeForm.targetAudience === 'Specific Classes' && (
                <div className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] space-y-2">
                  <label className="block font-semibold text-[#2A2A2E]">
                    Select Target Classes * ({noticeForm.targetClasses.length} selected)
                  </label>
                  <div className="space-y-2.5 max-h-48 overflow-y-auto">
                    {groupClassesBySection(getActiveClasses(classesList)).map((group) => (
                      <div key={group.section} className="space-y-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                          {group.label}
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {group.classes.map((cls) => (
                            <label
                              key={cls.id}
                              className="flex items-center gap-2 text-xs text-[#2A2A2E] cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={noticeForm.targetClasses.includes(cls.name)}
                                onChange={() =>
                                  toggleClassTarget(noticeForm.targetClasses, cls.name, (next) =>
                                    setNoticeForm({ ...noticeForm, targetClasses: next })
                                  )
                                }
                                className="rounded border-[#DDD5C7] text-[#6B1020] focus:ring-[#6B1020]"
                              />
                              <span>{cls.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">
                    Publication Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={noticeForm.publishDate}
                    onChange={(e) => setNoticeForm({ ...noticeForm, publishDate: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                  <span className="text-[10px] text-[#6E6A63] mt-0.5 block">
                    {noticeForm.publishDate > getTodayIsoDate()
                      ? 'Scheduled for future release'
                      : 'Publishes immediately'}
                  </span>
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Session</label>
                  <select
                    value={noticeForm.session}
                    onChange={(e) => setNoticeForm({ ...noticeForm, session: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  >
                    {sessions.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Term</label>
                  <select
                    value={noticeForm.term}
                    onChange={(e) =>
                      setNoticeForm({ ...noticeForm, term: e.target.value as AcademicTerm })
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  >
                    <option value="First Term">First Term</option>
                    <option value="Second Term">Second Term</option>
                    <option value="Third Term">Third Term</option>
                  </select>
                </div>
              </div>

              {/* Optional Calendar Sync */}
              <div className="p-3 rounded-[8px] bg-[#FAF0F2] border border-[#DFC7CA] space-y-2.5">
                <label className="flex items-center gap-2 font-semibold text-[#6B1020] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={noticeForm.alsoAddToCalendar}
                    onChange={(e) =>
                      setNoticeForm({ ...noticeForm, alsoAddToCalendar: e.target.checked })
                    }
                    className="rounded border-[#DDD5C7] text-[#6B1020] focus:ring-[#6B1020]"
                  />
                  <span>Also publish dates to School Calendar (Exam / Resumption / Holiday)</span>
                </label>

                {noticeForm.alsoAddToCalendar && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block font-medium text-[#2A2A2E] mb-1">Event Start *</label>
                      <input
                        type="date"
                        required
                        value={noticeForm.eventStartDate}
                        onChange={(e) =>
                          setNoticeForm({ ...noticeForm, eventStartDate: e.target.value })
                        }
                        className="w-full px-3 py-1.5 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E]"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-[#2A2A2E] mb-1">Event End</label>
                      <input
                        type="date"
                        value={noticeForm.eventEndDate}
                        onChange={(e) =>
                          setNoticeForm({ ...noticeForm, eventEndDate: e.target.value })
                        }
                        className="w-full px-3 py-1.5 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E]"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block font-medium text-[#2A2A2E] mb-1">Circular Content *</label>
                <textarea
                  rows={5}
                  required
                  maxLength={3000}
                  placeholder="Enter detailed notice, exam instructions, resumption details, or holiday dates..."
                  value={noticeForm.body}
                  onChange={(e) => setNoticeForm({ ...noticeForm, body: e.target.value })}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-[#EFE9DF]">
                <button
                  type="button"
                  onClick={() => setIsPublishModalOpen(false)}
                  className="px-4 py-2 rounded-[8px] bg-white border border-[#DDD5C7] hover:bg-[#FAF8F4] text-[#2A2A2E] font-medium transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                >
                  {isSubmitting
                    ? 'Saving...'
                    : noticeForm.publishDate > getTodayIsoDate()
                    ? 'Schedule Circular'
                    : 'Publish Circular'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD CALENDAR EVENT MODAL */}
      {isCalendarModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs">
          <div className="bg-white rounded-[10px] max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3]">
            <div className="flex items-center justify-between pb-4 border-b border-[#EFE9DF]">
              <h3 className="font-semibold text-base text-[#2A2A2E]">
                Publish School Calendar Event
              </h3>
              <button
                onClick={() => setIsCalendarModalOpen(false)}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors duration-150"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCalendarEvent} className="py-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-[#2A2A2E] mb-1">Event Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Second Term Resumption / Mid-Term Break"
                  value={calendarForm.title}
                  onChange={(e) => setCalendarForm({ ...calendarForm, title: e.target.value })}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Event Type *</label>
                  <select
                    value={calendarForm.eventType}
                    onChange={(e) =>
                      setCalendarForm({
                        ...calendarForm,
                        eventType: e.target.value as CalendarEventType,
                      })
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  >
                    {CALENDAR_EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Target Audience</label>
                  <select
                    value={calendarForm.targetAudience}
                    onChange={(e) =>
                      setCalendarForm({
                        ...calendarForm,
                        targetAudience: e.target.value as SchoolCalendarEvent['targetAudience'],
                      })
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  >
                    <option value="All">All School</option>
                    <option value="Parents">Parents</option>
                    <option value="Specific Classes">Specific Classes</option>
                  </select>
                </div>
              </div>

              {calendarForm.targetAudience === 'Specific Classes' && (
                <div className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] space-y-2">
                  <label className="block font-semibold text-[#2A2A2E]">
                    Select Target Classes * ({calendarForm.targetClasses.length} selected)
                  </label>
                  <div className="space-y-2.5 max-h-44 overflow-y-auto">
                    {groupClassesBySection(getActiveClasses(classesList)).map((group) => (
                      <div key={group.section} className="space-y-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                          {group.label}
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {group.classes.map((cls) => (
                            <label
                              key={cls.id}
                              className="flex items-center gap-2 text-xs text-[#2A2A2E] cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={calendarForm.targetClasses.includes(cls.name)}
                                onChange={() =>
                                  toggleClassTarget(calendarForm.targetClasses, cls.name, (next) =>
                                    setCalendarForm({ ...calendarForm, targetClasses: next })
                                  )
                                }
                                className="rounded border-[#DDD5C7] text-[#6B1020] focus:ring-[#6B1020]"
                              />
                              <span>{cls.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Session</label>
                  <select
                    value={calendarForm.session}
                    onChange={(e) => setCalendarForm({ ...calendarForm, session: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  >
                    {sessions.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Term</label>
                  <select
                    value={calendarForm.term}
                    onChange={(e) =>
                      setCalendarForm({ ...calendarForm, term: e.target.value as AcademicTerm })
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  >
                    <option value="First Term">First Term</option>
                    <option value="Second Term">Second Term</option>
                    <option value="Third Term">Third Term</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Start Date *</label>
                  <input
                    type="date"
                    required
                    value={calendarForm.startDate}
                    onChange={(e) => setCalendarForm({ ...calendarForm, startDate: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">End Date</label>
                  <input
                    type="date"
                    value={calendarForm.endDate}
                    onChange={(e) => setCalendarForm({ ...calendarForm, endDate: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-[#2A2A2E] mb-1">Description</label>
                <textarea
                  rows={3}
                  placeholder="Optional details about resumption time, examination rules, or holiday schedule..."
                  value={calendarForm.description}
                  onChange={(e) => setCalendarForm({ ...calendarForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-[#EFE9DF]">
                <button
                  type="button"
                  onClick={() => setIsCalendarModalOpen(false)}
                  className="px-4 py-2 rounded-[8px] bg-white border border-[#DDD5C7] hover:bg-[#FAF8F4] text-[#2A2A2E] font-medium transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                >
                  {isSubmitting ? 'Saving...' : 'Publish Calendar Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
