import React, { useEffect, useMemo, useState } from 'react';
import {
  School,
  UserCheck,
  MapPin,
  Plus,
  BookOpen,
  Pencil,
  X,
  CheckCircle2,
  AlertCircle,
  Search,
  Eye,
  Trash2,
  ArrowRightLeft,
  Archive,
  RefreshCw,
  Users,
  CalendarCheck,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  AcademicRecord,
  AttendanceRecord,
  SchoolClass,
  SchoolSection,
  Student,
  StudentResultReview,
  Teacher,
} from '../types';
import {
  DEFAULT_SCHOOL_CLASSES,
  NIGERIAN_LEVELS_LIST,
  NIGERIAN_SUBJECTS_LIST,
} from '../data/sampleData';
import {
  extractFriendlyError,
  subscribeStudents,
  subscribeTeachers,
} from '../services/schoolService';
import {
  deleteClassSafelyFromFirestore,
  migrateClassStudentsInFirestore,
  saveClassToFirestore,
  subscribeAcademicRecords,
  subscribeClasses,
  subscribeResultReviews,
  syncStandardClassesToFirestore,
  toggleClassActiveStatusInFirestore,
} from '../services/academicService';
import { computeAttendanceSummary, subscribeAttendance } from '../services/attendanceService';
import {
  doesStudentBelongToClass,
  getActiveClasses,
  groupClassesBySection,
  LEVELS_BY_SECTION,
  resolveClassSection,
  SCHOOL_SECTIONS,
  SECTION_LABELS,
  STANDARD_CLASS_NAMES_SET,
} from '../utils/classUtils';

const SECTION_FILTERS: Array<'All' | SchoolSection> = ['All', ...SCHOOL_SECTIONS];

export const ClassesPage: React.FC<{ onNavigate: (page: string) => void }> = ({ onNavigate }) => {
  const { role, currentUser, firebaseUser } = useAuth();
  const isLiveFirestore = Boolean(firebaseUser);
  const isAdmin = role === 'director' || role === 'principal';
  const isDirector = role === 'director';
  const isTeacher = role === 'teacher';

  const [classesList, setClassesList] = useState<SchoolClass[]>(DEFAULT_SCHOOL_CLASSES);
  const [classesSeeded, setClassesSeeded] = useState<boolean>(false);
  const [missingStandardCount, setMissingStandardCount] = useState<number>(0);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [academicRecords, setAcademicRecords] = useState<AcademicRecord[]>([]);
  const [resultReviews, setResultReviews] = useState<StudentResultReview[]>([]);

  const [sectionFilter, setSectionFilter] = useState<'All' | SchoolSection>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showInactive, setShowInactive] = useState<boolean>(true);
  const [dataError, setDataError] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Create / Edit Class Modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [editingPreviousName, setEditingPreviousName] = useState<string>('');
  const [editingCreatedAt, setEditingCreatedAt] = useState<string | undefined>(undefined);
  const [editingSortOrder, setEditingSortOrder] = useState<number | undefined>(undefined);

  const [formSection, setFormSection] = useState<SchoolSection>('Primary');
  const [formName, setFormName] = useState<string>('');
  const [formLevel, setFormLevel] = useState<string>('Primary 1');
  const [formArm, setFormArm] = useState<string>('Standard');
  const [formCapacity, setFormCapacity] = useState<number>(30);
  const [formRoom, setFormRoom] = useState<string>('');
  const [formTeacherName, setFormTeacherName] = useState<string>('');
  const [formTeacherId, setFormTeacherId] = useState<string>('');
  const [formIsActive, setFormIsActive] = useState<boolean>(true);
  const [formNotes, setFormNotes] = useState<string>('');
  const [formSubjects, setFormSubjects] = useState<string[]>([]);
  const [customSubject, setCustomSubject] = useState<string>('');
  const [selectedQuickSubject, setSelectedQuickSubject] = useState<string>('');
  const [editingSubjectIndex, setEditingSubjectIndex] = useState<number | null>(null);
  const [editingSubjectValue, setEditingSubjectValue] = useState<string>('');
  const [useCustomLevel, setUseCustomLevel] = useState<boolean>(false);

  // View Class Profile Modal state
  const [viewingClass, setViewingClass] = useState<SchoolClass | null>(null);

  // Migrate Pupils Modal state (for safe transition from legacy class names)
  const [migratingClass, setMigratingClass] = useState<SchoolClass | null>(null);
  const [migrateTargetId, setMigrateTargetId] = useState<string>('');
  const [migrateDeactivateSource, setMigrateDeactivateSource] = useState<boolean>(true);

  useEffect(() => {
    if (!firebaseUser) {
      setStudentsList([]);
      setTeachersList([]);
      setAttendanceRecords([]);
      setAcademicRecords([]);
      setResultReviews([]);
      return;
    }

    setDataError('');
    const unsubs: Array<() => void> = [];

    unsubs.push(
      subscribeClasses((cls, seeded, missingCount) => {
        setClassesList(cls);
        setClassesSeeded(seeded);
        setMissingStandardCount(missingCount ?? 0);
      }, setDataError)
    );
    unsubs.push(
      subscribeStudents(role, currentUser, firebaseUser.email, setStudentsList, setDataError)
    );
    if (role !== 'parent') {
      unsubs.push(subscribeTeachers(setTeachersList, setDataError));
    } else {
      setTeachersList([]);
    }
    unsubs.push(
      subscribeAttendance(
        role,
        currentUser,
        firebaseUser.email,
        setAttendanceRecords,
        () => {}
      )
    );
    unsubs.push(
      subscribeAcademicRecords(
        role,
        currentUser,
        firebaseUser.email,
        setAcademicRecords,
        () => {}
      )
    );
    unsubs.push(
      subscribeResultReviews(
        role,
        currentUser,
        firebaseUser.email,
        setResultReviews,
        () => {}
      )
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [firebaseUser, role, currentUser]);

  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(''), 6000);
    return () => clearTimeout(t);
  }, [successMsg]);

  // Compute live per-class metrics strictly from saved Firestore collections
  const classMetricsMap = useMemo(() => {
    const map = new Map<
      string,
      {
        enrolledStudents: Student[];
        enrolledCount: number;
        attendanceRate: number | null;
        attendanceDays: number;
        attendanceRecordsCount: number;
        avgAcademicPct: number | null;
        academicRecordsCount: number;
        approvedCount: number;
      }
    >();

    classesList.forEach((cls) => {
      const enrolledStudents = studentsList.filter(
        (s) => s.status === 'Active' && doesStudentBelongToClass(s, cls)
      );
      const stuIdSet = new Set(enrolledStudents.map((s) => s.id));
      const normalizedClsName = cls.name.trim().toLowerCase();

      const clsAttendance = attendanceRecords.filter(
        (a) =>
          a.classId === cls.id ||
          a.className.trim().toLowerCase() === normalizedClsName ||
          stuIdSet.has(a.studentId)
      );
      const attSummary = computeAttendanceSummary(clsAttendance);

      const clsAcademics = academicRecords.filter(
        (r) => r.className.trim().toLowerCase() === normalizedClsName
      );
      let avgAcademicPct: number | null = null;
      if (clsAcademics.length > 0) {
        const sumPct = clsAcademics.reduce((acc, r) => {
          const pct =
            typeof r.percentage === 'number'
              ? r.percentage
              : r.maxTotal
              ? (r.total / r.maxTotal) * 100
              : r.total;
          return acc + pct;
        }, 0);
        avgAcademicPct = Math.round((sumPct / clsAcademics.length) * 10) / 10;
      }

      const approvedCount = resultReviews.filter(
        (rev) =>
          rev.className.trim().toLowerCase() === normalizedClsName && rev.status === 'Approved'
      ).length;

      map.set(cls.id, {
        enrolledStudents,
        enrolledCount: enrolledStudents.length,
        attendanceRate: attSummary.totalRecords > 0 ? attSummary.attendanceRate : null,
        attendanceDays: attSummary.uniqueDays,
        attendanceRecordsCount: attSummary.totalRecords,
        avgAcademicPct,
        academicRecordsCount: clsAcademics.length,
        approvedCount,
      });
    });

    return map;
  }, [classesList, studentsList, attendanceRecords, academicRecords, resultReviews]);

  // Role-filtered, status-filtered, search-filtered, section-filtered classes
  const visibleClasses = useMemo(() => {
    let base = classesList;

    if (isTeacher) {
      const assigned = (currentUser?.assignedClasses || []).map((c) => c.trim().toLowerCase());
      base = base.filter(
        (c) =>
          assigned.includes(c.name.trim().toLowerCase()) ||
          (c.formTeacherId && c.formTeacherId === currentUser?.uid)
      );
    }

    if (!showInactive) {
      base = base.filter((c) => c.isActive !== false);
    }

    if (sectionFilter !== 'All') {
      base = base.filter((c) => resolveClassSection(c) === sectionFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      base = base.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.section || '').toLowerCase().includes(q) ||
          (c.formTeacherName || '').toLowerCase().includes(q) ||
          (c.roomNumber || '').toLowerCase().includes(q) ||
          (c.subjects || []).some((sub) => sub.toLowerCase().includes(q))
      );
    }

    return base;
  }, [classesList, isTeacher, currentUser, showInactive, sectionFilter, searchQuery]);

  const groupedSections = useMemo(
    () => groupClassesBySection(visibleClasses, false),
    [visibleClasses]
  );

  // Track active legacy classes in Firestore that are outside the 16 standard classes

  const legacyClasses = useMemo(() => {
    if (!classesSeeded) return [];
    return classesList.filter(
      (c) => !STANDARD_CLASS_NAMES_SET.has(c.name.trim()) && c.isActive !== false
    );
  }, [classesList, classesSeeded]);

  const activeClassesForDropdown = useMemo(
    () => getActiveClasses(classesList),
    [classesList]
  );

  const activeVisibleClasses = visibleClasses.filter((c) => c.isActive !== false);
  const totalClassCapacity = activeVisibleClasses.reduce((acc, c) => acc + (c.capacity || 0), 0);
  const totalEnrolled = visibleClasses.reduce(
    (acc, c) => acc + (classMetricsMap.get(c.id)?.enrolledCount ?? 0),
    0
  );
  const utilizationPct =
    totalClassCapacity > 0 ? Math.min(100, Math.round((totalEnrolled / totalClassCapacity) * 100)) : 0;

  const openCreateModal = (defaultSection: SchoolSection = 'Primary') => {
    const sectionLevels = LEVELS_BY_SECTION[defaultSection] || NIGERIAN_LEVELS_LIST;
    setEditingClassId(null);
    setEditingPreviousName('');
    setEditingCreatedAt(undefined);
    setEditingSortOrder(undefined);
    setUseCustomLevel(false);
    setSelectedQuickSubject('');
    setEditingSubjectIndex(null);
    setEditingSubjectValue('');
    setFormSection(defaultSection);
    setFormName('');
    setFormLevel(sectionLevels[0] || 'Primary 1');
    setFormArm('Standard');
    setFormCapacity(defaultSection === 'Creche' ? 15 : defaultSection === 'Nursery' ? 22 : 35);
    setFormRoom('');
    setFormTeacherName('');
    setFormTeacherId('');
    setFormIsActive(true);
    setFormNotes('');
    setFormSubjects(
      defaultSection === 'Creche'
        ? ['Rhymes & Songs', 'Social Habits', 'Motor Skills & Play']
        : defaultSection === 'Nursery'
        ? ['Numeracy', 'Literacy & Phonics', 'Rhymes & Songs', 'Creative Arts']
        : ['English Language', 'Mathematics', 'Basic Science']
    );
    setCustomSubject('');
    setIsModalOpen(true);
  };

  const openEditModal = (cls: SchoolClass) => {
    setEditingClassId(cls.id);
    setEditingPreviousName(cls.name);
    setEditingCreatedAt(cls.createdAt);
    setEditingSortOrder(cls.sortOrder);
    setUseCustomLevel(Boolean(cls.level && !NIGERIAN_LEVELS_LIST.includes(cls.level)));
    setSelectedQuickSubject('');
    setEditingSubjectIndex(null);
    setEditingSubjectValue('');
    setFormSection(resolveClassSection(cls));
    setFormName(cls.name);
    setFormLevel(cls.level || cls.name);
    setFormArm(cls.arm || 'Standard');
    setFormCapacity(cls.capacity || 30);
    setFormRoom(cls.roomNumber || '');
    setFormTeacherName(
      cls.formTeacherName && cls.formTeacherName !== 'Unassigned' ? cls.formTeacherName : ''
    );
    setFormTeacherId(cls.formTeacherId || '');
    setFormIsActive(cls.isActive !== false);
    setFormNotes(cls.notes || '');
    setFormSubjects([...(cls.subjects || [])]);
    setCustomSubject('');
    setIsModalOpen(true);
  };

  const handleSelectTeacherFromDropdown = (teacherId: string) => {
    if (!teacherId) {
      setFormTeacherId('');
      return;
    }
    const teacher = teachersList.find((t) => t.id === teacherId);
    if (teacher) {
      setFormTeacherId(teacher.id);
      setFormTeacherName(teacher.fullName);
    }
  };

  const handleManualTeacherNameChange = (val: string) => {
    setFormTeacherName(val);
    // Clear linked teacherId when manually typed so custom entries save verbatim without fallback
    const exactMatch = teachersList.find(
      (t) => t.fullName.trim().toLowerCase() === val.trim().toLowerCase()
    );
    setFormTeacherId(exactMatch ? exactMatch.id : '');
  };

  const handleAddCustomSubject = () => {
    const trimmed = customSubject.trim();
    if (!trimmed) return;
    if (!formSubjects.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setFormSubjects((prev) => [...prev, trimmed]);
    }
    setCustomSubject('');
  };

  const handleRemoveSubject = (subject: string) => {
    setFormSubjects((prev) => prev.filter((s) => s !== subject));
    setEditingSubjectIndex(null);
  };

  const handleCommitInlineSubjectEdit = (idx: number) => {
    const trimmed = editingSubjectValue.trim();
    if (!trimmed) {
      setEditingSubjectIndex(null);
      return;
    }
    setFormSubjects((prev) => {
      const next = [...prev];
      next[idx] = trimmed;
      return Array.from(new Set(next));
    });
    setEditingSubjectIndex(null);
    setEditingSubjectValue('');
  };

  const handleSaveClass = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = formName.trim();
    if (!trimmedName) {
      setDataError('Please enter a class name (e.g., Creche, Nursery 1, Primary 3, JSS 1A, SS 2A).');
      return;
    }

    setIsSaving(true);
    setDataError('');
    try {
      const existingMatch = editingClassId
        ? classMetricsMap.get(editingClassId)?.enrolledCount ?? 0
        : 0;
      const teacherDisplay = formTeacherName.trim() || 'Unassigned';

      const payload: SchoolClass = {
        id: editingClassId || '',
        name: trimmedName,
        section: formSection,
        level: formLevel.trim() || trimmedName,
        arm: formArm.trim() || 'Standard',
        formTeacherId: formTeacherId.trim(),
        formTeacherName: teacherDisplay,
        totalStudents: existingMatch,
        capacity: Math.max(1, Math.min(500, Number(formCapacity) || 30)),
        roomNumber: formRoom.trim() || 'Main Block',
        subjects: formSubjects,
        isActive: formIsActive,
        sortOrder: editingSortOrder,
        notes: formNotes.trim(),
        createdAt: editingCreatedAt,
      };

      const saved = await saveClassToFirestore(payload, {
        existingClasses: classesSeeded ? classesList : undefined,
        previousName: editingPreviousName,
      });

      setSuccessMsg(
        `Saved "${saved.name}" (${SECTION_LABELS[saved.section || formSection]}) — Form Teacher: ${saved.formTeacherName}.`
      );
      setIsModalOpen(false);
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to save class changes.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncStandardClasses = async () => {
    setIsSaving(true);
    setDataError('');
    try {
      const res = await syncStandardClassesToFirestore();
      if (res.addedCount === 0 && res.updatedCount === 0) {
        setSuccessMsg('All 16 classes across Creche, Nursery, Primary, JSS & SS are already synchronized.');
      } else {
        setSuccessMsg(
          `Synchronized Cloud Firestore classes (${res.addedCount} added, ${res.updatedCount} section grouping fixed, ${res.skippedCount} preserved).`
        );
      }
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to synchronize school class structure.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (cls: SchoolClass) => {
    if (!isAdmin) return;
    setIsSaving(true);
    setDataError('');
    try {
      const nextActive = cls.isActive === false;
      await toggleClassActiveStatusInFirestore(cls.id, nextActive);
      setSuccessMsg(
        `${cls.name} is now ${nextActive ? 'Active' : 'Deactivated (Archived)'}.`
      );
      if (viewingClass?.id === cls.id) {
        setViewingClass({ ...cls, isActive: nextActive });
      }
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to update class status.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSafeDelete = async (cls: SchoolClass) => {
    if (!isDirector) return;
    setIsSaving(true);
    setDataError('');
    try {
      await deleteClassSafelyFromFirestore(cls);
      setSuccessMsg(`Deleted unused class "${cls.name}".`);
      setIsModalOpen(false);
      if (viewingClass?.id === cls.id) setViewingClass(null);
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Unable to delete class.'));
    } finally {
      setIsSaving(false);
    }
  };

  const openMigrateModal = (sourceCls: SchoolClass) => {
    const candidates = activeClassesForDropdown.filter(
      (c) => c.id !== sourceCls.id && STANDARD_CLASS_NAMES_SET.has(c.name)
    );
    const fallbackCandidates = activeClassesForDropdown.filter((c) => c.id !== sourceCls.id);
    setMigratingClass(sourceCls);
    setMigrateTargetId((candidates[0] || fallbackCandidates[0])?.id || '');
    setMigrateDeactivateSource(true);
  };

  const handleConfirmMigration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!migratingClass || !migrateTargetId) return;
    const targetCls = classesList.find((c) => c.id === migrateTargetId);
    if (!targetCls) return;

    setIsSaving(true);
    setDataError('');
    try {
      const res = await migrateClassStudentsInFirestore({
        sourceClass: migratingClass,
        targetClass: targetCls,
        deactivateSource: migrateDeactivateSource,
      });
      setSuccessMsg(
        `Moved ${res.migratedCount} pupil(s) from "${migratingClass.name}" to "${targetCls.name}"${
          migrateDeactivateSource ? ' and archived the old class' : ''
        }.`
      );
      setMigratingClass(null);
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to migrate class pupils.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#2A2A2E] tracking-tight">
            Classes &amp; Arms Management
          </h1>
          <p className="text-xs text-[#6E6A63] mt-1">
            Creche · Nursery (1–3) · Primary (1–6) · Junior Secondary (JSS 1–3) · Senior Secondary (SS 1–3)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && isLiveFirestore && (!classesSeeded || missingStandardCount > 0) && (
            <button
              type="button"
              onClick={handleSyncStandardClasses}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#2A583B] hover:bg-[#20452E] text-white text-xs font-medium shadow-xs transition-colors duration-150 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
              {!classesSeeded
                ? 'Initialize 16 School Classes'
                : `Sync ${missingStandardCount} Missing Class${missingStandardCount > 1 ? 'es' : ''}`}
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => openCreateModal(sectionFilter === 'All' ? 'Primary' : sectionFilter)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium shadow-xs transition-colors duration-150 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" /> Add New Class
            </button>
          )}
        </div>
      </div>

      {/* Feedback Alerts */}
      {dataError && (
        <div className="bg-[#FAF0F2] border border-[#E2C1C5] rounded-[8px] p-3.5 flex items-start gap-2.5 text-xs text-[#86222E]">
          <AlertCircle className="w-4 h-4 text-[#86222E] shrink-0 mt-0.5" />
          <div className="flex-1">{dataError}</div>
          <button type="button" onClick={() => setDataError('')} aria-label="Dismiss error">
            <X className="w-4 h-4 text-[#86222E]" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="bg-[#EEF4F0] border border-[#C5D6CB] rounded-[8px] p-3.5 flex items-center justify-between gap-2 text-xs text-[#2A583B]">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-[#2A583B] shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg('')} aria-label="Dismiss notice">
            <X className="w-4 h-4 text-[#2A583B]" />
          </button>
        </div>
      )}

      {/* Legacy Classes Transition Notice (Non-Destructive) */}
      {isAdmin && legacyClasses.length > 0 && (
        <div className="bg-[#FBF5E8] border border-[#E3CFA6] rounded-[10px] p-4 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold text-[#7D5A18]">
                Legacy Class Records Detected ({legacyClasses.length})
              </h2>
              <p className="text-[11px] text-[#7D5A18]/90 mt-0.5">
                Historical academic and attendance records are preserved safely. Reassign any enrolled pupils to the updated 21-class structure or archive unused classes below.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {legacyClasses.map((leg) => {
              const count = classMetricsMap.get(leg.id)?.enrolledCount ?? 0;
              return (
                <div
                  key={leg.id}
                  className="flex items-center gap-2 bg-white border border-[#E3CFA6] rounded-[8px] px-3 py-1.5 text-xs"
                >
                  <span className="font-semibold text-[#2A2A2E]">{leg.name}</span>
                  <span className="text-[#6E6A63] tabular-nums">({count} pupils)</span>
                  <button
                    type="button"
                    onClick={() => openMigrateModal(leg)}
                    className="text-[#6B1020] hover:text-[#540C19] font-semibold whitespace-nowrap ml-1"
                  >
                    Move &amp; Archive
                  </button>
                  {count === 0 && (
                    <button
                      type="button"
                      onClick={() => handleToggleActive(leg)}
                      className="text-[#6E6A63] hover:text-[#2A2A2E] font-medium whitespace-nowrap"
                    >
                      Archive
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top KPI Summary Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-[10px] border border-[#E6DFD3] border-t-2 border-t-[#B8913A] p-4 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
          <p className="text-xs font-medium text-[#6E6A63]">Classes in View</p>
          <p className="text-2xl font-semibold text-[#2A2A2E] mt-1 tabular-nums">
            {activeVisibleClasses.length}
          </p>
          <p className="text-[11px] text-[#7F7A72] mt-0.5">
            Across {groupedSections.length} school section{groupedSections.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="bg-white rounded-[10px] border border-[#E6DFD3] border-t-2 border-t-[#B8913A] p-4 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
          <p className="text-xs font-medium text-[#6E6A63]">Active Enrolled Pupils</p>
          <p className="text-2xl font-semibold text-[#2A2A2E] mt-1 tabular-nums">{totalEnrolled}</p>
          <p className="text-[11px] text-[#7F7A72] mt-0.5 tabular-nums">
            Total capacity: {totalClassCapacity} seats
          </p>
        </div>

        <div className="bg-white rounded-[10px] border border-[#E6DFD3] border-t-2 border-t-[#B8913A] p-4 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
          <p className="text-xs font-medium text-[#6E6A63]">Seat Occupancy Rate</p>
          <p className="text-2xl font-semibold text-[#6B1020] mt-1 tabular-nums">{utilizationPct}%</p>
          <div className="w-full h-1.5 bg-[#EFE9DF] rounded-full overflow-hidden mt-2">
            <div
              className="h-full bg-[#6B1020] rounded-full transition-all duration-150"
              style={{ width: `${utilizationPct}%` }}
            />
          </div>
        </div>

        <div className="bg-white rounded-[10px] border border-[#E6DFD3] border-t-2 border-t-[#B8913A] p-4 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
          <p className="text-xs font-medium text-[#6E6A63]">Form Teachers Assigned</p>
          <p className="text-2xl font-semibold text-[#2A2A2E] mt-1 tabular-nums">
            {
              activeVisibleClasses.filter(
                (c) => c.formTeacherName && c.formTeacherName !== 'Unassigned'
              ).length
            }
            <span className="text-sm font-normal text-[#7F7A72]">
              {' '}
              / {activeVisibleClasses.length}
            </span>
          </p>
          <p className="text-[11px] text-[#7F7A72] mt-0.5">Manual or staff directory entry</p>
        </div>
      </div>

      {/* Section Filter Tabs & Search Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
        <div className="flex flex-wrap items-center gap-1.5">
          {SECTION_FILTERS.map((sec) => {
            const active = sectionFilter === sec;
            const count =
              sec === 'All'
                ? classesList.filter((c) => showInactive || c.isActive !== false).length
                : classesList.filter(
                    (c) =>
                      resolveClassSection(c) === sec && (showInactive || c.isActive !== false)
                  ).length;
            return (
              <button
                key={sec}
                type="button"
                onClick={() => setSectionFilter(sec)}
                className={`px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors duration-150 whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#6B1020] text-white shadow-xs'
                    : 'text-[#5E5B56] hover:bg-[#FAF8F4] hover:text-[#2A2A2E]'
                }`}
              >
                {sec === 'All' ? 'All Sections' : sec} ({count})
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 md:w-56">
            <Search className="w-3.5 h-3.5 text-[#7F7A72] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search class, teacher, room..."
              className="w-full pl-8 pr-3 py-1.5 border border-[#DDD5C7] rounded-[8px] text-xs text-[#2A2A2E] placeholder:text-[#7F7A72] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-[#5E5B56] cursor-pointer whitespace-nowrap px-2">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-[#DDD5C7] text-[#6B1020] focus:ring-[#6B1020]"
            />
            Show archived
          </label>
        </div>
      </div>

      {/* Section-Organized Class Profile Cards */}
      {groupedSections.length === 0 ? (
        <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-10 text-center space-y-2 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
          <School className="w-8 h-8 text-[#B8913A]/60 mx-auto" />
          <p className="text-sm font-semibold text-[#2A2A2E]">No classes match your current filter</p>
          <p className="text-xs text-[#6E6A63]">
            Adjust the section filter or search query, or add a new class.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groupedSections.map((group) => {
            const sectionEnrolled = group.classes.reduce(
              (s, c) => s + (classMetricsMap.get(c.id)?.enrolledCount ?? 0),
              0
            );
            const sectionCap = group.classes.reduce((s, c) => s + (c.capacity || 0), 0);

            return (
              <section key={group.section} className="space-y-3">
                {/* Clean Typographic Section Header */}
                <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2 border-b border-[#E6DFD3]">
                  <div className="flex items-baseline gap-2.5">
                    <h2 className="text-base font-semibold text-[#2A2A2E] tracking-tight">
                      {group.label}
                    </h2>
                    <span className="text-xs text-[#6E6A63] tabular-nums">
                      {group.classes.length} class{group.classes.length === 1 ? '' : 'es'} ·{' '}
                      {sectionEnrolled} / {sectionCap} enrolled
                    </span>
                  </div>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => openCreateModal(group.section)}
                      className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] flex items-center gap-1 whitespace-nowrap transition-colors duration-150"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add to {group.section}
                    </button>
                  )}
                </div>

                {/* Class Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {group.classes.map((cls) => {
                    const metrics = classMetricsMap.get(cls.id);
                    const enrolled = metrics?.enrolledCount ?? 0;
                    const cap = cls.capacity || 30;
                    const fillPct = cap > 0 ? Math.min(100, Math.round((enrolled / cap) * 100)) : 0;
                    const subjects = cls.subjects || [];
                    const isInactive = cls.isActive === false;

                    return (
                      <article
                        key={cls.id}
                        className={`bg-white rounded-[10px] border p-5 flex flex-col justify-between gap-4 transition-all duration-150 ${
                          isInactive
                            ? 'border-[#E6DFD3] opacity-75 bg-[#FAF8F4]'
                            : 'border-[#E6DFD3] hover:border-[#B8913A]/60 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]'
                        }`}
                      >
                        {/* Top Row: Class Identity & Edit/View Controls */}
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="text-lg font-semibold text-[#2A2A2E] tracking-tight truncate">
                                  {cls.name}
                                </h3>
                                {isInactive && (
                                  <span className="text-[11px] font-medium text-[#7D5A18]">
                                    · Archived
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-[#6E6A63] mt-0.5">
                                {SECTION_LABELS[resolveClassSection(cls)]} · Arm: {cls.arm || 'Standard'}
                              </p>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => setViewingClass(cls)}
                                className="px-2.5 py-1.5 rounded-[8px] border border-[#DDD5C7] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] text-xs font-medium flex items-center gap-1 whitespace-nowrap transition-colors duration-150"
                                title="View full class profile"
                              >
                                <Eye className="w-3.5 h-3.5" /> View
                              </button>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => openEditModal(cls)}
                                  className="px-2.5 py-1.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium flex items-center gap-1 whitespace-nowrap transition-colors duration-150"
                                  title="Edit class details, form teacher & subjects"
                                >
                                  <Pencil className="w-3.5 h-3.5" /> Edit
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Teacher & Location Rows */}
                          <div className="space-y-1.5 text-xs">
                            <div className="flex items-center justify-between gap-2 py-1 border-b border-[#EFE9DF]">
                              <span className="text-[#6E6A63] flex items-center gap-1.5">
                                <UserCheck className="w-3.5 h-3.5 text-[#7F7A72] shrink-0" />
                                Form Teacher
                              </span>
                              <span
                                className={`font-semibold text-right truncate max-w-[190px] ${
                                  cls.formTeacherName && cls.formTeacherName !== 'Unassigned'
                                    ? 'text-[#2A2A2E]'
                                    : 'text-[#7F7A72] italic font-normal'
                                }`}
                              >
                                {cls.formTeacherName || 'Unassigned'}
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-2 py-1 border-b border-[#EFE9DF]">
                              <span className="text-[#6E6A63] flex items-center gap-1.5">
                                <MapPin className="w-3.5 h-3.5 text-[#7F7A72] shrink-0" />
                                Classroom
                              </span>
                              <span className="font-medium text-[#2A2A2E] text-right truncate max-w-[190px]">
                                {cls.roomNumber || 'Not set'}
                              </span>
                            </div>
                          </div>

                          {/* Capacity & Enrollment */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-[#6E6A63] flex items-center gap-1.5">
                                <Users className="w-3.5 h-3.5 text-[#7F7A72]" />
                                Enrolled Pupils
                              </span>
                              <span className="font-semibold text-[#2A2A2E] tabular-nums">
                                {enrolled}{' '}
                                <span className="font-normal text-[#7F7A72]">/ {cap} max</span>
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-[#EFE9DF] rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-150 ${
                                  fillPct >= 95
                                    ? 'bg-[#86222E]'
                                    : fillPct >= 75
                                    ? 'bg-[#B8913A]'
                                    : 'bg-[#2A583B]'
                                }`}
                                style={{ width: `${fillPct}%` }}
                              />
                            </div>
                          </div>

                          {/* Live Attendance & Academic Performance Summary */}
                          <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
                            <div className="p-2.5 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3]">
                              <div className="flex items-center gap-1 text-[11px] text-[#6E6A63]">
                                <CalendarCheck className="w-3 h-3 text-[#7F7A72]" />
                                Attendance
                              </div>
                              <p className="font-semibold text-[#2A2A2E] mt-0.5 tabular-nums">
                                {metrics?.attendanceRate !== null &&
                                metrics?.attendanceRate !== undefined
                                  ? `${metrics.attendanceRate}%`
                                  : '—'}
                              </p>
                              <p className="text-[11px] text-[#7F7A72] tabular-nums">
                                {metrics && metrics.attendanceDays > 0
                                  ? `${metrics.attendanceDays} day${metrics.attendanceDays === 1 ? '' : 's'} logged`
                                  : 'No register yet'}
                              </p>
                            </div>

                            <div className="p-2.5 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3]">
                              <div className="flex items-center gap-1 text-[11px] text-[#6E6A63]">
                                <BarChart3 className="w-3 h-3 text-[#7F7A72]" />
                                Academics
                              </div>
                              <p className="font-semibold text-[#2A2A2E] mt-0.5 tabular-nums">
                                {metrics?.avgAcademicPct !== null &&
                                metrics?.avgAcademicPct !== undefined
                                  ? `${metrics.avgAcademicPct}% avg`
                                  : '—'}
                              </p>
                              <p className="text-[11px] text-[#7F7A72] tabular-nums">
                                {metrics && metrics.academicRecordsCount > 0
                                  ? `${metrics.academicRecordsCount} score${metrics.academicRecordsCount === 1 ? '' : 's'}`
                                  : 'No scores yet'}
                              </p>
                            </div>
                          </div>

                          {/* Assigned Subjects */}
                          <div className="pt-1">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="font-medium text-[#5E5B56] flex items-center gap-1">
                                <BookOpen className="w-3.5 h-3.5 text-[#7F7A72]" />
                                Assigned Subjects ({subjects.length})
                              </span>
                            </div>
                            <p className="text-xs text-[#6E6A63] leading-relaxed line-clamp-2">
                              {subjects.length > 0
                                ? subjects.join(' · ')
                                : 'No subjects assigned yet. Click Edit to assign subjects.'}
                            </p>
                          </div>
                        </div>

                        {/* Card Footer Quick Module Links */}
                        <div className="pt-3 border-t border-[#EFE9DF] flex items-center justify-between gap-2 text-[11px] font-medium text-[#6B1020]">
                          <button
                            type="button"
                            onClick={() => onNavigate('students')}
                            className="hover:text-[#540C19] whitespace-nowrap transition-colors duration-150"
                          >
                            Pupils
                          </button>
                          <span className="text-[#DDD5C7]">·</span>
                          <button
                            type="button"
                            onClick={() => onNavigate('attendance')}
                            className="hover:text-[#540C19] whitespace-nowrap transition-colors duration-150"
                          >
                            Attendance
                          </button>
                          <span className="text-[#DDD5C7]">·</span>
                          <button
                            type="button"
                            onClick={() => onNavigate('academics')}
                            className="hover:text-[#540C19] whitespace-nowrap transition-colors duration-150"
                          >
                            Academics
                          </button>
                          <span className="text-[#DDD5C7]">·</span>
                          <button
                            type="button"
                            onClick={() => onNavigate('timetable')}
                            className="hover:text-[#540C19] whitespace-nowrap transition-colors duration-150"
                          >
                            Timetable
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* ==================== CLASS DETAILS / VIEW PROFILE MODAL ==================== */}
      {viewingClass && (
        <div className="fixed inset-0 z-50 bg-[#2A2A2E]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-[10px] max-w-2xl w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-[#EFE9DF] pb-4">
              <div>
                <h2 className="text-lg font-semibold text-[#2A2A2E]">{viewingClass.name}</h2>
                <p className="text-xs text-[#6E6A63] mt-0.5">
                  {SECTION_LABELS[resolveClassSection(viewingClass)]} · Level:{' '}
                  {viewingClass.level} · Arm: {viewingClass.arm || 'Standard'}
                  {viewingClass.isActive === false ? ' · Archived' : ' · Active'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      const cls = viewingClass;
                      setViewingClass(null);
                      openEditModal(cls);
                    }}
                    className="px-3 py-1.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium flex items-center gap-1 transition-colors duration-150"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit Class
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewingClass(null)}
                  className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors duration-150"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {(() => {
              const m = classMetricsMap.get(viewingClass.id);
              const roster = m?.enrolledStudents || [];
              return (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3]">
                      <p className="text-[#6E6A63]">Form Teacher</p>
                      <p className="font-semibold text-[#2A2A2E] mt-0.5">
                        {viewingClass.formTeacherName || 'Unassigned'}
                      </p>
                    </div>
                    <div className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3]">
                      <p className="text-[#6E6A63]">Classroom</p>
                      <p className="font-semibold text-[#2A2A2E] mt-0.5">
                        {viewingClass.roomNumber || 'Not set'}
                      </p>
                    </div>
                    <div className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3]">
                      <p className="text-[#6E6A63]">Enrollment</p>
                      <p className="font-semibold text-[#2A2A2E] mt-0.5 tabular-nums">
                        {roster.length} / {viewingClass.capacity}
                      </p>
                    </div>
                    <div className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3]">
                      <p className="text-[#6E6A63]">Attendance / Avg</p>
                      <p className="font-semibold text-[#2A2A2E] mt-0.5 tabular-nums">
                        {m?.attendanceRate !== null && m?.attendanceRate !== undefined
                          ? `${m.attendanceRate}%`
                          : '—'}{' '}
                        /{' '}
                        {m?.avgAcademicPct !== null && m?.avgAcademicPct !== undefined
                          ? `${m.avgAcademicPct}%`
                          : '—'}
                      </p>
                    </div>
                  </div>

                  {viewingClass.notes && (
                    <div className="text-xs bg-[#FAF0F2] border border-[#DFC7CA] rounded-[8px] p-3 text-[#2A2A2E]">
                      <span className="font-semibold text-[#6B1020]">Notes: </span>
                      {viewingClass.notes}
                    </div>
                  )}

                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-[#5E5B56] uppercase tracking-wider">
                      Assigned Subjects ({viewingClass.subjects?.length || 0})
                    </h3>
                    {viewingClass.subjects && viewingClass.subjects.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                        {viewingClass.subjects.map((sub, i) => (
                          <div
                            key={`${sub}-${i}`}
                            className="px-3 py-2 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-[#2A2A2E] font-medium"
                          >
                            {sub}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[#7F7A72] italic">No subjects assigned yet.</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-[#5E5B56] uppercase tracking-wider">
                      Enrolled Pupils ({roster.length})
                    </h3>
                    {roster.length === 0 ? (
                      <p className="text-xs text-[#7F7A72] italic py-2">
                        No active pupils currently enrolled in {viewingClass.name}.
                      </p>
                    ) : (
                      <div className="border border-[#E6DFD3] rounded-[8px] overflow-hidden max-h-56 overflow-y-auto">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                            <tr>
                              <th className="py-2 px-3">Admission No</th>
                              <th className="py-2 px-3">Pupil Name</th>
                              <th className="py-2 px-3">Gender</th>
                              <th className="py-2 px-3">Fee Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#EFE9DF]">
                            {roster.map((st) => (
                              <tr key={st.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                                <td className="py-2 px-3 font-mono text-[#6E6A63]">
                                  {st.admissionNo}
                                </td>
                                <td className="py-2 px-3 font-semibold text-[#2A2A2E]">
                                  {st.fullName}
                                </td>
                                <td className="py-2 px-3 text-[#5E5B56]">{st.gender}</td>
                                <td className="py-2 px-3 text-[#2A2A2E]">{st.feeStatus}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ==================== CREATE / MANUAL EDIT CLASS MODAL ==================== */}
      {isModalOpen && isAdmin && (
        <div className="fixed inset-0 z-50 bg-[#2A2A2E]/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-[10px] max-w-2xl w-full shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] flex flex-col max-h-[88vh] overflow-hidden">
            {/* Fixed Modal Header */}
            <div className="shrink-0 flex items-start justify-between gap-3 border-b border-[#EFE9DF] px-4 sm:px-5 pt-3 pb-2.5">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold leading-tight text-[#2A2A2E] truncate">
                  {editingClassId ? `Edit Class — ${editingPreviousName}` : 'Add New School Class'}
                </h2>
                <p className="text-[11px] leading-snug text-[#6E6A63] mt-0.5">
                  Configure class details, Form Teacher, and assigned subjects.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors duration-150 shrink-0"
                aria-label="Close edit modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveClass} className="flex flex-col flex-1 min-h-0 text-xs">
              {/* Scrollable Middle Content */}
              <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3 space-y-2.5">
                {/* Row 1: Class Name & School Section */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">Class Name *</label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. Creche, Nursery 1, Primary 3, JSS 1A, SS 2A"
                      className="w-full h-9 px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">
                      School Section *
                    </label>
                    <select
                      value={formSection}
                      onChange={(e) => {
                        const nextSec = e.target.value as SchoolSection;
                        setFormSection(nextSec);
                        const levels = LEVELS_BY_SECTION[nextSec];
                        if (levels && !useCustomLevel && !levels.includes(formLevel)) {
                          setFormLevel(levels[0]);
                        }
                      }}
                      className="w-full h-9 px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                    >
                      {SCHOOL_SECTIONS.map((sec) => (
                        <option key={sec} value={sec}>
                          {SECTION_LABELS[sec]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Row 2: Class Level, Arm / Stream, Maximum Capacity */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">Class Level *</label>
                    {!useCustomLevel ? (
                      <select
                        required
                        value={NIGERIAN_LEVELS_LIST.includes(formLevel) ? formLevel : ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '__custom__') {
                            setUseCustomLevel(true);
                            setFormLevel('');
                          } else {
                            setFormLevel(val);
                          }
                        }}
                        className="w-full h-9 px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                      >
                        <option value="">-- Select Level --</option>
                        {NIGERIAN_LEVELS_LIST.map((lvl) => (
                          <option key={lvl} value={lvl}>
                            {lvl}
                          </option>
                        ))}
                        <option value="__custom__">+ Enter Custom Level...</option>
                      </select>
                    ) : (
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          required
                          value={formLevel}
                          onChange={(e) => setFormLevel(e.target.value)}
                          placeholder="e.g. Pre-KG"
                          className="w-full h-9 px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setUseCustomLevel(false);
                            if (!NIGERIAN_LEVELS_LIST.includes(formLevel)) {
                              setFormLevel(LEVELS_BY_SECTION[formSection]?.[0] || 'Primary 1');
                            }
                          }}
                          className="h-9 px-2.5 rounded-[8px] bg-[#FAF8F4] border border-[#DDD5C7] hover:bg-[#EFE9DF] text-[#2A2A2E] font-medium shrink-0 transition-colors duration-150"
                        >
                          List
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">Arm / Stream</label>
                    <input
                      type="text"
                      value={formArm}
                      onChange={(e) => setFormArm(e.target.value)}
                      placeholder="e.g. Standard, A, B"
                      className="w-full h-9 px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">
                      Maximum Capacity *
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      max={500}
                      value={formCapacity}
                      onChange={(e) => setFormCapacity(Number(e.target.value) || 30)}
                      className="w-full h-9 px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                    />
                  </div>
                </div>

                {/* Row 3: Classroom Location / Block & Active Class checkbox */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-[#2A2A2E] mb-1">
                      Classroom Location / Block *
                    </label>
                    <input
                      type="text"
                      required
                      value={formRoom}
                      onChange={(e) => setFormRoom(e.target.value)}
                      placeholder="e.g. Primary Block, Room 101"
                      className="w-full h-9 px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                    />
                  </div>

                  <div className="flex flex-col justify-end">
                    <label className="h-9 flex items-center gap-2 px-2.5 rounded-[8px] border border-[#DDD5C7] bg-[#FAF8F4] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formIsActive}
                        onChange={(e) => setFormIsActive(e.target.checked)}
                        className="rounded border-[#DDD5C7] text-[#6B1020] focus:ring-[#6B1020]"
                      />
                      <span className="font-medium text-[#2A2A2E] truncate">
                        {formIsActive ? 'Active Class' : 'Archived / Inactive'}
                      </span>
                    </label>
                  </div>
                </div>

                {/* Compact Form Teacher Management Box */}
                <div className="p-2.5 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <label className="font-semibold text-[#2A2A2E]">
                        Form Teacher&apos;s Full Name
                      </label>
                      <span className="text-[11px] text-[#6E6A63]">
                        Enter manually or pick from registered staff
                      </span>
                    </div>
                    {formTeacherName && (
                      <button
                        type="button"
                        onClick={() => {
                          setFormTeacherName('');
                          setFormTeacherId('');
                        }}
                        className="text-[11px] font-medium text-[#6E6A63] hover:text-[#86222E] transition-colors duration-150"
                      >
                        Clear Teacher
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-[#5E5B56] mb-1">
                        Manual Full Name Entry
                      </label>
                      <input
                        type="text"
                        value={formTeacherName}
                        onChange={(e) => handleManualTeacherNameChange(e.target.value)}
                        placeholder="e.g. Mrs. Ngozi Okafor"
                        className="w-full h-9 px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[#5E5B56] mb-1">
                        Pick Registered Teacher
                      </label>
                      <select
                        value={formTeacherId}
                        onChange={(e) => handleSelectTeacherFromDropdown(e.target.value)}
                        className="w-full h-9 px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                      >
                        <option value="">-- Optional staff quick-pick --</option>
                        {teachersList.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.fullName} ({t.staffId})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Compact Single-Line Auto-Expanding Notes Field */}
                <div>
                  <label className="block font-semibold text-[#2A2A2E] mb-1">
                    Other Class Information / Notes (Optional)
                  </label>
                  <textarea
                    rows={
                      formNotes
                        ? Math.min(
                            4,
                            Math.max(
                              1,
                              formNotes.split('\n').length,
                              Math.ceil(formNotes.length / 78)
                            )
                          )
                        : 1
                    }
                    maxLength={450}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Optional classroom notes, wing details, or special stream instructions"
                    className="w-full min-h-[36px] max-h-24 px-2.5 py-1.5 leading-5 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] resize-none overflow-y-auto [field-sizing:content] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                {/* Compact Assigned Subjects Section */}
                <div className="space-y-2 pt-2 border-t border-[#EFE9DF]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="font-semibold text-[#2A2A2E]">
                      Assigned Subjects ({formSubjects.length})
                    </label>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        aria-label="Add subject from curriculum"
                        value={selectedQuickSubject}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val && !formSubjects.includes(val)) {
                            setFormSubjects((prev) => [...prev, val]);
                          }
                          setSelectedQuickSubject('');
                        }}
                        className="h-8 px-2.5 py-1 border border-[#DDD5C7] rounded-[8px] bg-white text-[11px] font-medium text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                      >
                        <option value="">+ Add from curriculum list...</option>
                        {NIGERIAN_SUBJECTS_LIST.filter((s) => !formSubjects.includes(s)).map(
                          (sub) => (
                            <option key={sub} value={sub}>
                              {sub}
                            </option>
                          )
                        )}
                      </select>

                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={customSubject}
                          onChange={(e) => setCustomSubject(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddCustomSubject();
                            }
                          }}
                          placeholder="Custom subject..."
                          className="h-8 px-2.5 py-1 border border-[#DDD5C7] rounded-[8px] text-[11px] w-36 text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                        />
                        <button
                          type="button"
                          onClick={handleAddCustomSubject}
                          className="h-8 px-2.5 rounded-[8px] bg-[#2A2A2E] hover:bg-[#1E1E22] text-white font-medium text-[11px] whitespace-nowrap transition-colors duration-150"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Editable List of Currently Assigned Subjects */}
                  <div className="p-2 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] max-h-36 overflow-y-auto">
                    {formSubjects.length === 0 ? (
                      <p className="text-[11px] text-[#7F7A72] italic px-1 py-0.5">
                        No subjects assigned yet. Use the selector or custom input above to add subjects.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {formSubjects.map((sub, idx) => (
                          <div
                            key={`${sub}-${idx}`}
                            className="flex items-center justify-between gap-1.5 bg-white border border-[#E6DFD3] rounded-[6px] px-2.5 py-1 text-[11px]"
                          >
                            {editingSubjectIndex === idx ? (
                              <div className="flex items-center gap-1 flex-1">
                                <input
                                  type="text"
                                  value={editingSubjectValue}
                                  onChange={(e) => setEditingSubjectValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleCommitInlineSubjectEdit(idx);
                                    }
                                  }}
                                  autoFocus
                                  className="flex-1 px-2 py-0.5 border border-[#6B1020] rounded-[6px] text-[11px] text-[#2A2A2E] focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleCommitInlineSubjectEdit(idx)}
                                  className="text-[11px] font-semibold text-[#6B1020] px-1.5"
                                >
                                  Save
                                </button>
                              </div>
                            ) : (
                              <>
                                <span className="font-medium text-[#2A2A2E] truncate">{sub}</span>
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingSubjectIndex(idx);
                                      setEditingSubjectValue(sub);
                                    }}
                                    className="p-0.5 text-[#7F7A72] hover:text-[#6B1020] transition-colors duration-150"
                                    title="Rename subject"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveSubject(sub)}
                                    className="p-0.5 text-[#7F7A72] hover:text-[#86222E] transition-colors duration-150"
                                    title="Remove subject from this class"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Fixed Modal Footer Controls */}
              <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-2.5 border-t border-[#EFE9DF] bg-[#FAF8F4]/60">
                <div className="flex flex-wrap items-center gap-2">
                  {editingClassId && isDirector && classesSeeded && (
                    <>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => {
                          const target = classesList.find((c) => c.id === editingClassId);
                          if (target) {
                            setIsModalOpen(false);
                            openMigrateModal(target);
                          }
                        }}
                        className="h-9 px-3 rounded-[8px] border border-[#DDD5C7] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] font-medium flex items-center gap-1.5 transition-colors duration-150"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" /> Move Pupils
                      </button>

                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => {
                          const target = classesList.find((c) => c.id === editingClassId);
                          if (target) handleSafeDelete(target);
                        }}
                        className="h-9 px-3 rounded-[8px] border border-[#E2C1C5] bg-[#FAF0F2] hover:bg-[#F3E1E5] text-[#86222E] font-medium flex items-center gap-1.5 transition-colors duration-150"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete Class
                      </button>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="h-9 px-3.5 rounded-[8px] bg-white border border-[#DDD5C7] hover:bg-[#FAF8F4] text-[#2A2A2E] font-medium transition-colors duration-150"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="h-9 px-4 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium shadow-xs disabled:opacity-50 transition-colors duration-150"
                  >
                    {isSaving ? 'Saving...' : editingClassId ? 'Save Class Changes' : 'Create Class'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== SAFE PUPIL MIGRATION MODAL ==================== */}
      {migratingClass && (
        <div className="fixed inset-0 z-50 bg-[#2A2A2E]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-[10px] max-w-md w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] space-y-4">
            <div className="flex items-center justify-between border-b border-[#EFE9DF] pb-3">
              <h2 className="text-base font-semibold text-[#2A2A2E]">
                Reassign Pupils from {migratingClass.name}
              </h2>
              <button
                type="button"
                onClick={() => setMigratingClass(null)}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors duration-150"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmMigration} className="space-y-4 text-xs">
              <p className="text-[#5E5B56] leading-relaxed">
                This safely transfers all enrolled pupils currently placed in{' '}
                <strong className="text-[#2A2A2E]">{migratingClass.name}</strong> to the destination class below while preserving all historical attendance and terminal academic records.
              </p>

              <div>
                <label className="block font-semibold text-[#2A2A2E] mb-1">
                  Destination Class *
                </label>
                <select
                  required
                  value={migrateTargetId}
                  onChange={(e) => setMigrateTargetId(e.target.value)}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                >
                  <option value="">-- Select target class --</option>
                  {groupClassesBySection(
                    activeClassesForDropdown.filter((c) => c.id !== migratingClass.id)
                  ).map((g) => (
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

              <label className="flex items-center gap-2 p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] cursor-pointer">
                <input
                  type="checkbox"
                  checked={migrateDeactivateSource}
                  onChange={(e) => setMigrateDeactivateSource(e.target.checked)}
                  className="rounded border-[#DDD5C7] text-[#6B1020] focus:ring-[#6B1020]"
                />
                <span className="text-[#2A2A2E] font-medium">
                  Archive &ldquo;{migratingClass.name}&rdquo; after moving pupils
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#EFE9DF]">
                <button
                  type="button"
                  onClick={() => setMigratingClass(null)}
                  className="px-4 py-2 rounded-[8px] bg-white border border-[#DDD5C7] hover:bg-[#FAF8F4] text-[#2A2A2E] font-medium transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !migrateTargetId}
                  className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                >
                  <Archive className="w-3.5 h-3.5 inline mr-1" />
                  {isSaving ? 'Moving...' : 'Move Pupils'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
