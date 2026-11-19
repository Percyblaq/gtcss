import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Save,
  CheckCircle2,
  Award,
  AlertCircle,
  Calendar,
  School,
  Sliders,
  FileText,
  Printer,
  Plus,
  Trash2,
  ShieldCheck,
  CheckSquare,
  X,
  UserCheck,
  Send,
  ThumbsUp,
  RotateCcw,
  Pencil,
  Database,
  ChevronDown,
  Globe,
  History,
  Clock,
  Users,
  Eye,
  Lock,
  GraduationCap,
  Mail,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  AcademicConfig,
  AcademicRecord,
  AcademicSession,
  AcademicTerm,
  AttendanceRecord,
  FeePayment,
  PublishedReportSnapshot,
  RankingPolicy,
  ReportPublishAuditLog,
  SchoolClass,
  SchoolSection,
  Student,
  StudentFee,
  StudentResultReview,
  SubjectTeacherAssignment,
  Teacher,
} from '../types';
import {
  DEFAULT_ACADEMIC_CONFIG,
  DEFAULT_ACADEMIC_SESSION,
  DEFAULT_SCHOOL_CLASSES,
  NIGERIAN_LEVELS_LIST,
  NIGERIAN_SUBJECTS_LIST,
} from '../data/sampleData';
import { extractFriendlyError, subscribeStudents, subscribeTeachers } from '../services/schoolService';
import { subscribeAttendance } from '../services/attendanceService';
import { subscribeFeePayments, subscribeStudentFees } from '../services/feesService';
import {
  batchApproveClassResultsInFirestore,
  buildPublishedReportId,
  buildSubjectAssignmentId,
  computeClassResultsSummary,
  computeGradeFromConfig,
  computeStudentFeeClearance,
  ComputedStudentResult,
  formatOrdinal,
  publishMultipleReportCardsToFirestore,
  publishSingleReportCardToFirestore,
  removeSubjectAssignmentFromFirestore,
  saveAcademicConfigToFirestore,
  saveAcademicSessionToFirestore,
  saveClassToFirestore,
  saveMultipleSubjectsScoresBatchToFirestore,
  saveStudentResultReviewToFirestore,
  saveSubjectAssignmentToFirestore,
  saveSubjectScoresBatchToFirestore,
  StudentFeeClearanceStatus,
  subscribeAcademicConfig,
  subscribeAcademicRecords,
  subscribeAcademicSessions,
  subscribeClasses,
  subscribePublishedReports,
  subscribeReportPublishAuditLogs,
  subscribeResultReviews,
  subscribeSubjectAssignments,
  syncStandardClassesToFirestore,
  unpublishReportCardFromFirestore,
} from '../services/academicService';
import {
  doesStudentBelongToClass,
  getActiveClasses,
  getProfileSubjects,
  groupClassesBySection,
  LEVELS_BY_SECTION,
  resolveClassSection,
  SCHOOL_SECTIONS,
  SECTION_LABELS,
} from '../utils/classUtils';
import { ReportCardView } from '../components/academics/ReportCardView';
import { PublishedReportSnapshotCard } from '../components/academics/PublishedReportSnapshotCard';

type AcademicTab = 'scores' | 'summary' | 'reports' | 'classes' | 'sessions' | 'config';

const SECTIONS: SchoolSection[] = SCHOOL_SECTIONS;

interface AcademicsPageProps {
  onRegisterLeaveGuard?: (guard: ((proceed: () => void) => boolean) | null) => void;
}

export const AcademicsPage: React.FC<AcademicsPageProps> = ({ onRegisterLeaveGuard }) => {
  const { role, currentUser, firebaseUser, schoolSettings } = useAuth();
  const isLiveFirestore = Boolean(firebaseUser);
  const isAdmin = role === 'director' || role === 'principal';
  const isTeacher = role === 'teacher';
  const isParent = role === 'parent';

  const [activeTab, setActiveTab] = useState<AcademicTab>(isParent ? 'reports' : 'scores');

  useEffect(() => {
    if (isParent && activeTab !== 'reports') {
      setActiveTab('reports');
    } else if (!isAdmin && (activeTab === 'sessions' || activeTab === 'config')) {
      setActiveTab('scores');
    }
  }, [isParent, isAdmin, activeTab]);

  // Firestore-backed collections (zero invented scores/grades/comments!)
  const [sessions, setSessions] = useState<AcademicSession[]>([DEFAULT_ACADEMIC_SESSION]);
  const [classesList, setClassesList] = useState<SchoolClass[]>(DEFAULT_SCHOOL_CLASSES);
  const [classesSeeded, setClassesSeeded] = useState<boolean>(false);
  const [missingStandardCount, setMissingStandardCount] = useState<number>(0);
  const [config, setConfig] = useState<AcademicConfig>(DEFAULT_ACADEMIC_CONFIG);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [assignments, setAssignments] = useState<SubjectTeacherAssignment[]>([]);
  const [academicRecords, setAcademicRecords] = useState<AcademicRecord[]>([]);
  const [resultReviews, setResultReviews] = useState<StudentResultReview[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [publishedReports, setPublishedReports] = useState<PublishedReportSnapshot[]>([]);
  const [publishAuditLogs, setPublishAuditLogs] = useState<ReportPublishAuditLog[]>([]);
  const [studentFees, setStudentFees] = useState<StudentFee[]>([]);
  const [feePayments, setFeePayments] = useState<FeePayment[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(isLiveFirestore);
  const [dataError, setDataError] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  // Subscribe to all Academic Management collections when authenticated
  useEffect(() => {
    if (!firebaseUser) {
      setStudentsList([]);
      setTeachersList([]);
      setPublishedReports([]);
      setPublishAuditLogs([]);
      setStudentFees([]);
      setFeePayments([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setDataError('');

    const u1 = subscribeAcademicSessions(setSessions, setDataError);
    const u2 = subscribeClasses((cls, seeded, missingCount) => {
      setClassesList(cls);
      setClassesSeeded(seeded);
      setMissingStandardCount(missingCount ?? 0);
    }, setDataError);
    const u3 = subscribeAcademicConfig(setConfig, setDataError);
    const u4 = !isParent
      ? subscribeSubjectAssignments(setAssignments, setDataError)
      : (() => {
          setAssignments([]);
          return () => {};
        })();
    const u5 = subscribeStudents(role, currentUser, firebaseUser.email, setStudentsList, setDataError);
    const u6 = !isParent
      ? subscribeTeachers(setTeachersList, setDataError)
      : (() => {
          setTeachersList([]);
          return () => {};
        })();
    const u7 = subscribeAcademicRecords(
      role,
      currentUser,
      firebaseUser.email,
      (recs) => {
        setAcademicRecords(recs);
        setIsLoading(false);
      },
      (err) => {
        setDataError(err);
        setIsLoading(false);
      }
    );
    const u8 = subscribeResultReviews(
      role,
      currentUser,
      firebaseUser.email,
      setResultReviews,
      setDataError
    );
    const u9 = subscribeAttendance(
      role,
      currentUser,
      firebaseUser.email,
      setAttendanceRecords,
      setDataError
    );
    const u10 =
      isAdmin || role === 'head_teacher' || isParent
        ? subscribePublishedReports(
            role,
            currentUser,
            firebaseUser.email,
            setPublishedReports,
            setDataError
          )
        : (() => {
            setPublishedReports([]);
            return () => {};
          })();
    const u11 = isAdmin
      ? subscribeReportPublishAuditLogs(role, setPublishAuditLogs, setDataError)
      : (() => {
          setPublishAuditLogs([]);
          return () => {};
        })();
    const u12 = isAdmin
      ? subscribeStudentFees(role, currentUser, firebaseUser.email, setStudentFees, setDataError)
      : (() => {
          setStudentFees([]);
          return () => {};
        })();
    const u13 = isAdmin
      ? subscribeFeePayments(role, currentUser, firebaseUser.email, setFeePayments, setDataError)
      : (() => {
          setFeePayments([]);
          return () => {};
        })();

    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
      u7();
      u8();
      u9();
      u10();
      u11();
      u12();
      u13();
    };
  }, [firebaseUser, role, currentUser, isParent, isAdmin]);

  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(''), 5500);
    return () => clearTimeout(t);
  }, [successMsg]);

  // Active Session & Term defaults
  const activeSessionObj = useMemo(
    () => sessions.find((s) => s.isActive) || sessions[0] || DEFAULT_ACADEMIC_SESSION,
    [sessions]
  );
  const activeTermObj = useMemo(
    () => activeSessionObj.terms.find((t) => t.isActive) || activeSessionObj.terms[0],
    [activeSessionObj]
  );

  const [selectedSession, setSelectedSession] = useState<string>(activeSessionObj.name);
  const [selectedTerm, setSelectedTerm] = useState<AcademicTerm>(
    activeTermObj?.name || schoolSettings.currentTerm
  );

  useEffect(() => {
    if (!sessions.some((s) => s.name === selectedSession)) {
      setSelectedSession(activeSessionObj.name);
    }
  }, [sessions, selectedSession, activeSessionObj]);

  // Teacher Class & Subject Scoping
  const teacherAssignedClasses = useMemo(
    () => (currentUser?.assignedClasses || []).filter(Boolean),
    [currentUser]
  );
  const teacherAssignedSubjects = useMemo(
    () => getProfileSubjects(currentUser),
    [currentUser]
  );

  const activeClassesList = useMemo(() => getActiveClasses(classesList), [classesList]);

  const availableClasses = useMemo(() => {
    const basePool = activeTab === 'scores' ? activeClassesList : classesList;
    if (isTeacher) {
      const fromAssignments = assignments
        .filter(
          (a) =>
            a.teacherEmail?.toLowerCase() === currentUser?.email?.toLowerCase() ||
            a.teacherName === currentUser?.displayName
        )
        .map((a) => a.className);
      const allowedNames = new Set([...teacherAssignedClasses, ...fromAssignments]);
      return basePool.filter((c) => allowedNames.has(c.name));
    }
    return basePool;
  }, [isTeacher, activeTab, activeClassesList, classesList, assignments, currentUser, teacherAssignedClasses]);

  const [selectedSectionFilter, setSelectedSectionFilter] = useState<string>('All');
  const filteredClassesForDropdown = useMemo(() => {
    if (selectedSectionFilter === 'All') return availableClasses;
    return availableClasses.filter((c) => resolveClassSection(c) === selectedSectionFilter);
  }, [availableClasses, selectedSectionFilter]);

  const groupedClassesForDropdown = useMemo(
    () => groupClassesBySection(filteredClassesForDropdown),
    [filteredClassesForDropdown]
  );

  const groupedActiveClasses = useMemo(
    () => groupClassesBySection(activeClassesList),
    [activeClassesList]
  );

  const [selectedClass, setSelectedClass] = useState<string>(
    availableClasses[0]?.name || DEFAULT_SCHOOL_CLASSES[0].name
  );

  useEffect(() => {
    if (
      filteredClassesForDropdown.length > 0 &&
      !filteredClassesForDropdown.some((c) => c.name === selectedClass)
    ) {
      setSelectedClass(filteredClassesForDropdown[0].name);
    }
  }, [filteredClassesForDropdown, selectedClass]);

  const selectedClassObj = useMemo(
    () => classesList.find((c) => c.name === selectedClass) || null,
    [classesList, selectedClass]
  );

  const availableSubjectsForClass = useMemo(() => {
    const classSubjects =
      selectedClassObj?.subjects && selectedClassObj.subjects.length > 0
        ? selectedClassObj.subjects
        : NIGERIAN_SUBJECTS_LIST.slice(0, 10);

    if (isTeacher) {
      const assignedForClass = assignments
        .filter(
          (a) =>
            a.className === selectedClass &&
            (a.teacherEmail?.toLowerCase() === currentUser?.email?.toLowerCase() ||
              a.teacherName === currentUser?.displayName)
        )
        .map((a) => a.subject);
      const allowed = new Set([...teacherAssignedSubjects, ...assignedForClass]);
      const scoped = classSubjects.filter((s) => allowed.has(s));
      return scoped.length > 0 ? scoped : Array.from(allowed);
    }

    return classSubjects;
  }, [selectedClassObj, isTeacher, assignments, selectedClass, currentUser, teacherAssignedSubjects]);

  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(() =>
    availableSubjectsForClass[0] ? [availableSubjectsForClass[0]] : ['Mathematics']
  );
  const [isSubjectDropdownOpen, setIsSubjectDropdownOpen] = useState<boolean>(false);
  const subjectDropdownRef = useRef<HTMLDivElement | null>(null);
  const hasClearedSubjectsRef = useRef<boolean>(false);
  const prevSelectedClassRef = useRef<string>(selectedClass);

  useEffect(() => {
    if (prevSelectedClassRef.current !== selectedClass) {
      prevSelectedClassRef.current = selectedClass;
      hasClearedSubjectsRef.current = false;
    }
    setSelectedSubjects((prev) => {
      const valid = prev.filter((s) => availableSubjectsForClass.includes(s));
      if (valid.length > 0) return valid;
      if (hasClearedSubjectsRef.current) return [];
      return availableSubjectsForClass.length > 0 ? [availableSubjectsForClass[0]] : [];
    });
  }, [availableSubjectsForClass, selectedClass]);

  useEffect(() => {
    if (!isSubjectDropdownOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        subjectDropdownRef.current &&
        !subjectDropdownRef.current.contains(e.target as Node)
      ) {
        setIsSubjectDropdownOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSubjectDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isSubjectDropdownOpen]);

  // Scoped students
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

  const activeStudentsInClass = useMemo(() => {
    return scopedStudents
      .filter(
        (s) =>
          s.status === 'Active' &&
          (selectedClassObj
            ? doesStudentBelongToClass(s, selectedClassObj)
            : s.className === selectedClass)
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [scopedStudents, selectedClass, selectedClassObj]);

  // ==================== TAB 1: SCORE ENTRY STATE (MULTI-SUBJECT) ====================
  type SubjectDraftMap = Record<string, { components: Record<string, string>; remark: string }>;

  const [scoreDraftsBySubject, setScoreDraftsBySubject] = useState<
    Record<string, SubjectDraftMap>
  >({});
  const [savingSubject, setSavingSubject] = useState<string | null>(null);
  const [isSavingAllScores, setIsSavingAllScores] = useState<boolean>(false);
  const [unsavedPrompt, setUnsavedPrompt] = useState<{
    subjects: string[];
    onConfirm: () => void;
  } | null>(null);

  const buildSubjectDraftFromRecords = (
    subject: string,
    records: AcademicRecord[]
  ): SubjectDraftMap => {
    const next: SubjectDraftMap = {};
    const savedByStudent = new Map<string, AcademicRecord>();
    records.forEach((r) => {
      if (
        r.session === selectedSession &&
        r.term === selectedTerm &&
        r.className === selectedClass &&
        r.subject === subject
      ) {
        savedByStudent.set(r.studentId, r);
      }
    });

    activeStudentsInClass.forEach((stu) => {
      const saved = savedByStudent.get(stu.id);
      const compMap: Record<string, string> = {};
      config.components.forEach((comp) => {
        if (saved) {
          if (saved.componentScores && saved.componentScores[comp.key] !== undefined) {
            compMap[comp.key] = String(saved.componentScores[comp.key]);
          } else if (comp.key === 'ca1') {
            compMap[comp.key] = String(saved.ca1 ?? 0);
          } else if (comp.key === 'ca2') {
            compMap[comp.key] = String(saved.ca2 ?? 0);
          } else if (comp.key === 'exam' || comp.isExam) {
            compMap[comp.key] = String(saved.exam ?? 0);
          } else {
            compMap[comp.key] = '0';
          }
        } else {
          compMap[comp.key] = '';
        }
      });
      next[stu.id] = {
        components: compMap,
        remark: saved?.remark || '',
      };
    });

    return next;
  };

  const areSubjectDraftsEqual = (
    a: SubjectDraftMap | undefined,
    b: SubjectDraftMap | undefined
  ): boolean => {
    if (!a || !b) return false;
    for (const stu of activeStudentsInClass) {
      const da = a[stu.id];
      const dbDraft = b[stu.id];
      if (!da && !dbDraft) continue;
      if (!da || !dbDraft) return false;
      if ((da.remark || '') !== (dbDraft.remark || '')) return false;
      for (const comp of config.components) {
        if ((da.components[comp.key] ?? '') !== (dbDraft.components[comp.key] ?? '')) {
          return false;
        }
      }
    }
    return true;
  };

  // Baseline map built strictly from saved academicRecords for all selected subjects
  const savedBaselineBySubject = useMemo(() => {
    const map: Record<string, SubjectDraftMap> = {};
    selectedSubjects.forEach((sub) => {
      map[sub] = buildSubjectDraftFromRecords(sub, academicRecords);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedSubjects,
    academicRecords,
    activeStudentsInClass,
    selectedSession,
    selectedTerm,
    selectedClass,
    config.components,
  ]);

  const contextKey = `${selectedSession}__${selectedTerm}__${selectedClass}`;
  const prevContextKeyRef = useRef<string>(contextKey);
  const prevBaselineRef = useRef<Record<string, SubjectDraftMap>>({});
  const justSavedSubjectsRef = useRef<Set<string>>(new Set());

  // Sync scoreDraftsBySubject from saved academicRecords while preserving unsaved edits on dirty subjects
  useEffect(() => {
    const isContextChanged = prevContextKeyRef.current !== contextKey;
    prevContextKeyRef.current = contextKey;

    if (isContextChanged) {
      justSavedSubjectsRef.current.clear();
      prevBaselineRef.current = savedBaselineBySubject;
      setScoreDraftsBySubject(savedBaselineBySubject);
      return;
    }

    setScoreDraftsBySubject((prev) => {
      const next: Record<string, SubjectDraftMap> = {};
      selectedSubjects.forEach((sub) => {
        const baseline = savedBaselineBySubject[sub] || {};
        const prevSub = prev[sub];
        const prevBaseline = prevBaselineRef.current[sub];

        if (
          !prevSub ||
          justSavedSubjectsRef.current.has(sub) ||
          areSubjectDraftsEqual(prevSub, prevBaseline)
        ) {
          next[sub] = baseline;
        } else {
          // Keep user's unsaved inputs intact, populating any newly added students/components
          const merged: SubjectDraftMap = {};
          activeStudentsInClass.forEach((stu) => {
            const existingStu = prevSub[stu.id];
            const baseStu = baseline[stu.id] || { components: {}, remark: '' };
            if (!existingStu) {
              merged[stu.id] = baseStu;
            } else {
              const compMap: Record<string, string> = {};
              config.components.forEach((c) => {
                compMap[c.key] =
                  existingStu.components[c.key] !== undefined
                    ? existingStu.components[c.key]
                    : baseStu.components[c.key] ?? '';
              });
              merged[stu.id] = {
                components: compMap,
                remark: existingStu.remark ?? baseStu.remark ?? '',
              };
            }
          });
          next[sub] = merged;
        }
      });
      return next;
    });

    justSavedSubjectsRef.current.clear();
    prevBaselineRef.current = savedBaselineBySubject;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedBaselineBySubject, contextKey]);

  const dirtySubjects = useMemo(() => {
    if (activeTab !== 'scores' || isParent) return [];
    return selectedSubjects.filter((sub) => {
      const draft = scoreDraftsBySubject[sub];
      const baseline = savedBaselineBySubject[sub];
      if (!draft || !baseline) return false;
      return !areSubjectDraftsEqual(draft, baseline);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    isParent,
    selectedSubjects,
    scoreDraftsBySubject,
    savedBaselineBySubject,
    activeStudentsInClass,
    config.components,
  ]);

  const dirtySubjectSet = useMemo(() => new Set(dirtySubjects), [dirtySubjects]);
  const hasUnsavedScoreChanges = dirtySubjects.length > 0;

  const guardUnsavedChanges = (onProceed: () => void, targetSubjects?: string[]): boolean => {
    const subjectsToCheck = targetSubjects
      ? targetSubjects.filter((s) => dirtySubjectSet.has(s))
      : dirtySubjects;
    if (activeTab !== 'scores' || isParent || subjectsToCheck.length === 0) {
      onProceed();
      return true;
    }
    setUnsavedPrompt({
      subjects: subjectsToCheck,
      onConfirm: () => {
        setUnsavedPrompt(null);
        onProceed();
      },
    });
    return false;
  };

  const guardRef = useRef(guardUnsavedChanges);
  guardRef.current = guardUnsavedChanges;

  useEffect(() => {
    if (!onRegisterLeaveGuard) return;
    onRegisterLeaveGuard((proceed) => guardRef.current(proceed));
    return () => onRegisterLeaveGuard(null);
  }, [onRegisterLeaveGuard]);

  useEffect(() => {
    if (!hasUnsavedScoreChanges) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedScoreChanges]);

  const maxTotalMarks = useMemo(
    () => config.components.reduce((sum, c) => sum + c.maxMark, 0),
    [config.components]
  );

  // Validate all current inputs against component maxMarks, grouped by subject
  const scoreValidationErrorsBySubject = useMemo(() => {
    const bySubject: Record<string, Record<string, string>> = {};
    selectedSubjects.forEach((sub) => {
      const subErrors: Record<string, string> = {};
      const drafts = scoreDraftsBySubject[sub] || {};
      activeStudentsInClass.forEach((stu) => {
        const draft = drafts[stu.id];
        if (!draft) return;
        for (const comp of config.components) {
          const raw = draft.components[comp.key];
          if (raw === undefined || raw.trim() === '') continue;
          const num = Number(raw);
          if (Number.isNaN(num) || num < 0) {
            subErrors[`${stu.id}_${comp.key}`] = `${comp.label} cannot be negative`;
          } else if (num > comp.maxMark) {
            subErrors[`${stu.id}_${comp.key}`] = `Exceeds max (${comp.maxMark})`;
          }
        }
      });
      bySubject[sub] = subErrors;
    });
    return bySubject;
  }, [selectedSubjects, scoreDraftsBySubject, activeStudentsInClass, config.components]);

  const hasAnyScoreErrors = useMemo(
    () =>
      selectedSubjects.some(
        (sub) => Object.keys(scoreValidationErrorsBySubject[sub] || {}).length > 0
      ),
    [selectedSubjects, scoreValidationErrorsBySubject]
  );

  const handleToggleSubject = (subject: string) => {
    const isCurrentlySelected = selectedSubjects.includes(subject);
    if (isCurrentlySelected) {
      guardUnsavedChanges(() => {
        setSelectedSubjects((prev) => {
          const next = prev.filter((s) => s !== subject);
          if (next.length === 0) hasClearedSubjectsRef.current = true;
          return next;
        });
      }, [subject]);
    } else {
      hasClearedSubjectsRef.current = false;
      setSelectedSubjects((prev) => {
        const nextSet = new Set([...prev, subject]);
        return availableSubjectsForClass.filter((s) => nextSet.has(s));
      });
    }
  };

  const handleSelectAllSubjects = () => {
    hasClearedSubjectsRef.current = false;
    setSelectedSubjects([...availableSubjectsForClass]);
  };

  const handleClearSubjects = () => {
    guardUnsavedChanges(() => {
      hasClearedSubjectsRef.current = true;
      setSelectedSubjects([]);
      setIsSubjectDropdownOpen(false);
    });
  };

  const buildEntriesForSubject = (subject: string) => {
    const existingIds = new Set(
      academicRecords
        .filter(
          (r) =>
            r.session === selectedSession &&
            r.term === selectedTerm &&
            r.className === selectedClass &&
            r.subject === subject
        )
        .map((r) => r.studentId)
    );
    const drafts = scoreDraftsBySubject[subject] || {};

    return activeStudentsInClass
      .filter((stu) => {
        const draft = drafts[stu.id];
        if (!draft) return false;
        const hasAnyInput = config.components.some(
          (c) => (draft.components[c.key] ?? '').trim() !== ''
        );
        return hasAnyInput || existingIds.has(stu.id);
      })
      .map((stu) => {
        const draft = drafts[stu.id];
        const componentScores: Record<string, number> = {};
        config.components.forEach((c) => {
          const val = (draft?.components[c.key] ?? '').trim();
          componentScores[c.key] = val === '' ? 0 : Number(val);
        });
        return {
          student: stu,
          componentScores,
          remark: draft?.remark || '',
        };
      });
  };

  const applySavedRecordsToState = (savedRecords: AcademicRecord[], savedSubjectsList: string[]) => {
    if (savedRecords.length === 0) return;

    const mergedRecords = [...academicRecords];
    savedRecords.forEach((rec) => {
      const idx = mergedRecords.findIndex((r) => r.id === rec.id);
      if (idx >= 0) mergedRecords[idx] = rec;
      else mergedRecords.push(rec);
    });

    savedSubjectsList.forEach((sub) => justSavedSubjectsRef.current.add(sub));

    setAcademicRecords(mergedRecords);
    setScoreDraftsBySubject((prev) => {
      const next = { ...prev };
      savedSubjectsList.forEach((sub) => {
        next[sub] = buildSubjectDraftFromRecords(sub, mergedRecords);
      });
      return next;
    });
  };

  const buildLocalAcademicRecords = (
    subject: string,
    entries: ReturnType<typeof buildEntriesForSubject>,
    enteredBy: string,
    now: string
  ): AcademicRecord[] => {
    return entries.map((e) => {
      const id = `acad_${selectedSession}_${selectedTerm}_${selectedClass}_${subject}_${e.student.id}`;
      const total = config.components.reduce(
        (s, c) => s + (e.componentScores[c.key] || 0),
        0
      );
      const pct = Math.round((total / (maxTotalMarks || 100)) * 1000) / 10;
      const { grade, remark: gRemark } = computeGradeFromConfig(pct, config.gradingScale);
      return {
        id,
        studentId: e.student.id,
        studentName: e.student.fullName,
        admissionNo: e.student.admissionNo,
        guardianEmail: e.student.guardianEmail,
        className: selectedClass,
        term: selectedTerm,
        session: selectedSession,
        subject,
        ca1: e.componentScores['ca1'] ?? 0,
        ca2: e.componentScores['ca2'] ?? 0,
        exam: e.componentScores['exam'] ?? 0,
        componentScores: e.componentScores,
        total,
        maxTotal: maxTotalMarks,
        percentage: pct,
        grade,
        remark: e.remark?.trim() || gRemark,
        enteredBy,
        updatedAt: now,
      };
    });
  };

  const handleSaveSubjectScores = async (subject: string) => {
    if (isParent) return;
    const subErrors = scoreValidationErrorsBySubject[subject] || {};
    if (Object.keys(subErrors).length > 0) {
      setDataError(
        `Please fix highlighted scores in ${subject} that exceed the maximum allowed marks.`
      );
      return;
    }
    if (activeStudentsInClass.length === 0) {
      setDataError(`No active students enrolled in ${selectedClass}.`);
      return;
    }

    const entries = buildEntriesForSubject(subject);
    if (entries.length === 0) {
      setDataError(`Enter at least one student score for ${subject} before saving.`);
      return;
    }

    setSavingSubject(subject);
    setDataError('');
    try {
      const enteredBy = currentUser?.displayName || firebaseUser?.email || 'Staff';
      if (isLiveFirestore) {
        const saved = await saveSubjectScoresBatchToFirestore({
          session: selectedSession,
          term: selectedTerm,
          className: selectedClass,
          subject,
          config,
          entries,
          enteredBy,
          callerRole: role,
        });
        applySavedRecordsToState(saved, [subject]);
        setSuccessMsg(
          `Saved ${saved.length} score record(s) for ${subject} (${selectedClass}) to Cloud Firestore.`
        );
      } else {
        const now = new Date().toISOString();
        const saved = buildLocalAcademicRecords(subject, entries, enteredBy, now);
        applySavedRecordsToState(saved, [subject]);
        setSuccessMsg(
          `Saved ${entries.length} score record(s) for ${subject} (${selectedClass}) in current session.`
        );
      }
    } catch (err) {
      setDataError(extractFriendlyError(err, `Failed to save assessment scores for ${subject}.`));
    } finally {
      setSavingSubject(null);
    }
  };

  const handleSaveAllScores = async () => {
    if (isParent) return;
    if (selectedSubjects.length === 0) {
      setDataError('Select at least one subject before saving.');
      return;
    }
    const invalidSubjects = selectedSubjects.filter(
      (sub) => Object.keys(scoreValidationErrorsBySubject[sub] || {}).length > 0
    );
    if (invalidSubjects.length > 0) {
      setDataError(
        `Please fix highlighted scores that exceed the maximum allowed marks in: ${invalidSubjects.join(', ')}.`
      );
      return;
    }
    if (activeStudentsInClass.length === 0) {
      setDataError(`No active students enrolled in ${selectedClass}.`);
      return;
    }

    const subjectBatches = selectedSubjects
      .map((subject) => ({
        subject,
        entries: buildEntriesForSubject(subject),
      }))
      .filter((b) => b.entries.length > 0);

    if (subjectBatches.length === 0) {
      setDataError('Enter at least one student score before saving.');
      return;
    }

    setIsSavingAllScores(true);
    setDataError('');
    try {
      const enteredBy = currentUser?.displayName || firebaseUser?.email || 'Staff';
      if (isLiveFirestore) {
        const { saved, savedSubjects } = await saveMultipleSubjectsScoresBatchToFirestore({
          session: selectedSession,
          term: selectedTerm,
          className: selectedClass,
          subjectBatches,
          config,
          enteredBy,
          callerRole: role,
        });
        applySavedRecordsToState(saved, savedSubjects);
        setSuccessMsg(
          `Saved ${saved.length} score record(s) across ${savedSubjects.length} subject${savedSubjects.length > 1 ? 's' : ''}: ${savedSubjects.join(', ')} (${selectedClass}) to Cloud Firestore.`
        );
      } else {
        const now = new Date().toISOString();
        const saved: AcademicRecord[] = [];
        const savedSubjects: string[] = [];
        subjectBatches.forEach((b) => {
          savedSubjects.push(b.subject);
          saved.push(...buildLocalAcademicRecords(b.subject, b.entries, enteredBy, now));
        });
        applySavedRecordsToState(saved, savedSubjects);
        setSuccessMsg(
          `Saved ${saved.length} score record(s) across ${savedSubjects.length} subject${savedSubjects.length > 1 ? 's' : ''}: ${savedSubjects.join(', ')} (${selectedClass}) in current session.`
        );
      }
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to save assessment scores.'));
    } finally {
      setIsSavingAllScores(false);
    }
  };

  // ==================== CLASS RESULT SUMMARY & REVIEW ====================
  const computedClassResults = useMemo(() => {
    return computeClassResultsSummary({
      students: scopedStudents,
      academicRecords,
      config,
      reviews: resultReviews,
      attendanceRecords,
      session: selectedSession,
      term: selectedTerm,
      className: selectedClass,
    });
  }, [
    scopedStudents,
    academicRecords,
    config,
    resultReviews,
    attendanceRecords,
    selectedSession,
    selectedTerm,
    selectedClass,
  ]);

  // Review & Comment Modal state
  const [reviewModalResult, setReviewModalResult] = useState<ComputedStudentResult | null>(null);
  const [teacherCommentInput, setTeacherCommentInput] = useState<string>('');
  const [principalCommentInput, setPrincipalCommentInput] = useState<string>('');
  const [reviewStatusInput, setReviewStatusInput] = useState<
    'Draft' | 'Submitted for Review' | 'Approved' | 'Returned for Correction'
  >('Draft');
  const [returnNoteInput, setReturnNoteInput] = useState<string>('');
  const [isSavingReview, setIsSavingReview] = useState<boolean>(false);

  const openReviewModal = (res: ComputedStudentResult) => {
    setReviewModalResult(res);
    setTeacherCommentInput(res.review?.teacherComment || '');
    setPrincipalCommentInput(res.review?.principalComment || '');
    setReviewStatusInput(res.review?.status || 'Draft');
    setReturnNoteInput(res.review?.returnNote || '');
  };

  const handleSaveStudentReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewModalResult) return;

    const actor = currentUser?.displayName || firebaseUser?.email || 'Staff';
    const nextStatus =
      !isAdmin && (reviewStatusInput === 'Approved' || reviewStatusInput === 'Returned for Correction')
        ? 'Submitted for Review'
        : reviewStatusInput;

    const reviewPayload: Omit<StudentResultReview, 'id'> = {
      studentId: reviewModalResult.student.id,
      studentName: reviewModalResult.student.fullName,
      admissionNo: reviewModalResult.student.admissionNo,
      guardianEmail: (reviewModalResult.student.guardianEmail || '').trim().toLowerCase(),
      className: selectedClass,
      term: selectedTerm,
      session: selectedSession,
      status: nextStatus,
      teacherComment: teacherCommentInput.trim(),
      teacherCommentBy: teacherCommentInput.trim()
        ? reviewModalResult.review?.teacherCommentBy || actor
        : reviewModalResult.review?.teacherCommentBy,
      teacherCommentAt: reviewModalResult.review?.teacherCommentAt,
      headComment: reviewModalResult.review?.headComment || '',
      headCommentBy: reviewModalResult.review?.headCommentBy,
      headCommentTitle: reviewModalResult.review?.headCommentTitle,
      headCommentAt: reviewModalResult.review?.headCommentAt,
      headSignature: reviewModalResult.review?.headSignature,
      principalComment: isAdmin
        ? principalCommentInput.trim()
        : reviewModalResult.review?.principalComment || '',
      principalCommentBy:
        isAdmin && principalCommentInput.trim()
          ? actor
          : reviewModalResult.review?.principalCommentBy,
      principalCommentAt: reviewModalResult.review?.principalCommentAt,
      principalSignature: reviewModalResult.review?.principalSignature,
      reviewedBy: actor,
      reviewedAt: new Date().toISOString(),
      approvedBy:
        isAdmin && nextStatus === 'Approved' ? actor : reviewModalResult.review?.approvedBy,
      approvedAt:
        isAdmin && nextStatus === 'Approved'
          ? new Date().toISOString()
          : reviewModalResult.review?.approvedAt,
      returnNote: nextStatus === 'Returned for Correction' ? returnNoteInput.trim() : undefined,
    };

    setIsSavingReview(true);
    setDataError('');
    try {
      if (isLiveFirestore) {
        await saveStudentResultReviewToFirestore(reviewPayload, isAdmin);
        setSuccessMsg(
          `Saved comments & review status (${nextStatus}) for ${reviewModalResult.student.fullName} in Cloud Firestore.`
        );
      } else {
        const id = `rev_${selectedSession}_${selectedTerm}_${selectedClass}_${reviewModalResult.student.id}`;
        const full: StudentResultReview = { ...reviewPayload, id, updatedAt: new Date().toISOString() };
        setResultReviews((prev) => {
          const idx = prev.findIndex((r) => r.id === id);
          if (idx >= 0) return prev.map((r) => (r.id === id ? full : r));
          return [...prev, full];
        });
        setSuccessMsg(`Saved comments & status for ${reviewModalResult.student.fullName}.`);
      }
      setReviewModalResult(null);
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to save result review.'));
    } finally {
      setIsSavingReview(false);
    }
  };

  const handleBatchClassReviewStatus = async (
    targetStatus: 'Submitted for Review' | 'Approved'
  ) => {
    if (targetStatus === 'Approved' && !isAdmin) return;
    if (activeStudentsInClass.length === 0) return;
    const actor = currentUser?.displayName || firebaseUser?.email || 'Staff';
    setDataError('');
    try {
      if (isLiveFirestore) {
        await batchApproveClassResultsInFirestore({
          students: activeStudentsInClass,
          existingReviews: resultReviews,
          session: selectedSession,
          term: selectedTerm,
          className: selectedClass,
          status: targetStatus,
          actorName: actor,
          syncApproval: isAdmin,
        });
      } else {
        const now = new Date().toISOString();
        setResultReviews((prev) => {
          const copy = [...prev];
          activeStudentsInClass.forEach((s) => {
            const id = `rev_${selectedSession}_${selectedTerm}_${selectedClass}_${s.id}`;
            const idx = copy.findIndex((r) => r.id === id);
            const existing = idx >= 0 ? copy[idx] : undefined;
            const nextItem: StudentResultReview = {
              id,
              studentId: s.id,
              studentName: s.fullName,
              admissionNo: s.admissionNo,
              guardianEmail: s.guardianEmail,
              className: selectedClass,
              term: selectedTerm,
              session: selectedSession,
              status: targetStatus,
              teacherComment: existing?.teacherComment || '',
              teacherCommentBy: existing?.teacherCommentBy,
              principalComment: existing?.principalComment || '',
              principalCommentBy: existing?.principalCommentBy,
              reviewedBy: actor,
              reviewedAt: now,
              approvedBy: targetStatus === 'Approved' ? actor : existing?.approvedBy,
              approvedAt: targetStatus === 'Approved' ? now : existing?.approvedAt,
              updatedAt: now,
            };
            if (idx >= 0) copy[idx] = nextItem;
            else copy.push(nextItem);
          });
          return copy;
        });
      }
      setSuccessMsg(
        targetStatus === 'Approved'
          ? `Approved terminal results for ${selectedClass} (${selectedTerm}).`
          : `Submitted ${selectedClass} results for Principal/Director review.`
      );
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to update class review status.'));
    }
  };

  // ==================== TAB 3: REPORT CARDS STATE ====================
  const [reportStudentId, setReportStudentId] = useState<string>('');
  useEffect(() => {
    if (activeStudentsInClass.length > 0 && !activeStudentsInClass.some((s) => s.id === reportStudentId)) {
      setReportStudentId(activeStudentsInClass[0].id);
    } else if (isParent && scopedStudents.length > 0 && !scopedStudents.some((s) => s.id === reportStudentId)) {
      setReportStudentId(scopedStudents[0].id);
    }
  }, [activeStudentsInClass, scopedStudents, isParent, reportStudentId]);

  const activeReportResult = useMemo(() => {
    if (isParent) {
      const stu = scopedStudents.find((s) => s.id === reportStudentId) || scopedStudents[0];
      if (!stu) return null;
      const list = computeClassResultsSummary({
        students: [stu],
        academicRecords,
        config,
        reviews: resultReviews,
        attendanceRecords,
        session: selectedSession,
        term: selectedTerm,
        className: stu.className,
      });
      return list[0] || null;
    }
    return (
      computedClassResults.find((r) => r.student.id === reportStudentId) ||
      computedClassResults[0] ||
      null
    );
  }, [
    isParent,
    scopedStudents,
    reportStudentId,
    academicRecords,
    config,
    resultReviews,
    attendanceRecords,
    selectedSession,
    selectedTerm,
    computedClassResults,
  ]);

  // ==================== REPORT CARD PUBLISHING STATE & HANDLERS ====================
  const isDirector = role === 'director';
  const [isPublishingReport, setIsPublishingReport] = useState<boolean>(false);
  const [isPublishSelectedModalOpen, setIsPublishSelectedModalOpen] = useState<boolean>(false);
  const [publishSelectedStudentIds, setPublishSelectedStudentIds] = useState<string[]>([]);
  const [isPublishClassConfirmOpen, setIsPublishClassConfirmOpen] = useState<boolean>(false);
  const [isPublishAuditModalOpen, setIsPublishAuditModalOpen] = useState<boolean>(false);
  const [isTestAsParentModalOpen, setIsTestAsParentModalOpen] = useState<boolean>(false);
  const [testParentEmailInput, setTestParentEmailInput] = useState<string>('');
  const [testParentPreviewSnapshot, setTestParentPreviewSnapshot] =
    useState<PublishedReportSnapshot | null>(null);

  const publishedSnapshotsByReportId = useMemo(() => {
    const map = new Map<string, PublishedReportSnapshot>();
    publishedReports.forEach((snap) => {
      map.set(snap.id, snap);
      map.set(buildPublishedReportId(snap.session, snap.term, snap.studentId), snap);
    });
    return map;
  }, [publishedReports]);

  const feeClearanceByStudentId = useMemo(() => {
    const map = new Map<string, StudentFeeClearanceStatus>();
    computedClassResults.forEach((res) => {
      map.set(
        res.student.id,
        computeStudentFeeClearance({
          student: res.student,
          session: selectedSession,
          term: selectedTerm,
          studentFees,
          feePayments,
        })
      );
    });
    return map;
  }, [computedClassResults, selectedSession, selectedTerm, studentFees, feePayments]);

  const classPublishSummary = useMemo(() => {
    let approved = 0;
    let published = 0;
    let approvedUnpublished = 0;
    let draftOrPending = 0;

    computedClassResults.forEach((res) => {
      const reportId = buildPublishedReportId(selectedSession, selectedTerm, res.student.id);
      const snap = publishedSnapshotsByReportId.get(reportId);
      const isPub = Boolean(snap?.isPublished);
      const isApp = res.review?.status === 'Approved';
      if (isPub) published += 1;
      if (isApp) {
        approved += 1;
        if (!isPub) approvedUnpublished += 1;
      } else {
        draftOrPending += 1;
      }
    });

    return {
      total: computedClassResults.length,
      approved,
      published,
      approvedUnpublished,
      draftOrPending,
    };
  }, [computedClassResults, publishedSnapshotsByReportId, selectedSession, selectedTerm]);

  const formatShortPublishDate = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStudentReportStatusTag = (studentId: string): string => {
    const reportId = buildPublishedReportId(selectedSession, selectedTerm, studentId);
    const snap = publishedSnapshotsByReportId.get(reportId);
    if (snap?.isPublished) {
      const dateStr = formatShortPublishDate(snap.firstPublishedAt || snap.publishedAt);
      return dateStr ? `Published • ${dateStr}` : 'Published';
    }
    const res = computedClassResults.find((r) => r.student.id === studentId);
    return res?.review?.status || 'Draft';
  };

  const activeReportSnapshot = useMemo(() => {
    if (!activeReportResult) return null;
    const reportId = buildPublishedReportId(
      selectedSession,
      selectedTerm,
      activeReportResult.student.id
    );
    return publishedSnapshotsByReportId.get(reportId) || null;
  }, [activeReportResult, publishedSnapshotsByReportId, selectedSession, selectedTerm]);

  const activeReportFeeClearance = useMemo(() => {
    if (!activeReportResult) return undefined;
    return feeClearanceByStudentId.get(activeReportResult.student.id);
  }, [activeReportResult, feeClearanceByStudentId]);

  const activeNextTermResumption = useMemo(
    () =>
      activeSessionObj.terms.find((t) => t.name === selectedTerm)?.nextTermResumption ||
      schoolSettings.nextTermResumption,
    [activeSessionObj, selectedTerm, schoolSettings.nextTermResumption]
  );

  const handlePublishSingleReport = async (res: ComputedStudentResult) => {
    if (!isAdmin || !firebaseUser) return;
    if (res.review?.status !== 'Approved') {
      setDataError(
        `Cannot publish ${res.student.fullName}'s report card while status is "${res.review?.status || 'Draft'}". Approve the report card first.`
      );
      return;
    }

    const reportId = buildPublishedReportId(selectedSession, selectedTerm, res.student.id);
    const existing = publishedSnapshotsByReportId.get(reportId) || null;
    const actorName = currentUser?.displayName || firebaseUser.email || 'Admin';

    setIsPublishingReport(true);
    setDataError('');
    try {
      const outcome = await publishSingleReportCardToFirestore({
        result: res,
        existingSnapshot: existing,
        schoolSettings,
        config,
        session: selectedSession,
        term: selectedTerm,
        section: selectedClassObj?.section,
        nextTermResumption: activeNextTermResumption,
        studentFees,
        feePayments,
        actorName,
        actorRole: role,
        actorUid: firebaseUser.uid,
      });

      const actionWord = outcome.isRepublish ? 'Republished' : 'Published';
      const feeNote =
        schoolSettings.requireFullFeesBeforePublishReport && !outcome.feeClearance.cleared
          ? ' Note: Student has an unpaid fee balance, so parent view will show the fee clearance notice until settled.'
          : '';

      setSuccessMsg(
        `${actionWord} frozen report card snapshot for ${res.student.fullName} (${selectedTerm}, ${selectedSession}).${feeNote}`
      );
    } catch (err) {
      console.error('Publish single report card failed:', err);
      setDataError(extractFriendlyError(err, 'Failed to publish report card to parents.'));
    } finally {
      setIsPublishingReport(false);
    }
  };

  const handleUnpublishSingleReport = async (snapshot: PublishedReportSnapshot) => {
    if (!isAdmin || !firebaseUser) return;
    const actorName = currentUser?.displayName || firebaseUser.email || 'Admin';

    setIsPublishingReport(true);
    setDataError('');
    try {
      await unpublishReportCardFromFirestore({
        existingSnapshot: snapshot,
        actorName,
        actorRole: role,
        actorUid: firebaseUser.uid,
      });
      setSuccessMsg(
        `Unpublished report card for ${snapshot.studentName} (${snapshot.term}, ${snapshot.session}). Parents can no longer view it.`
      );
    } catch (err) {
      console.error('Unpublish report card failed:', err);
      setDataError(extractFriendlyError(err, 'Failed to unpublish report card.'));
    } finally {
      setIsPublishingReport(false);
    }
  };

  const handleOpenPublishSelectedModal = () => {
    const approvedIds = computedClassResults
      .filter((r) => r.review?.status === 'Approved')
      .map((r) => r.student.id);
    setPublishSelectedStudentIds(approvedIds);
    setIsPublishSelectedModalOpen(true);
  };

  const handleConfirmPublishSelected = async () => {
    if (!isAdmin || !firebaseUser) return;
    const targets = computedClassResults.filter((r) =>
      publishSelectedStudentIds.includes(r.student.id)
    );
    if (targets.length === 0) {
      setDataError('Select at least one Approved student report card to publish.');
      return;
    }

    const actorName = currentUser?.displayName || firebaseUser.email || 'Admin';
    setIsPublishingReport(true);
    setDataError('');
    try {
      const outcome = await publishMultipleReportCardsToFirestore({
        results: targets,
        existingSnapshotsByReportId: publishedSnapshotsByReportId,
        schoolSettings,
        config,
        session: selectedSession,
        term: selectedTerm,
        section: selectedClassObj?.section,
        nextTermResumption: activeNextTermResumption,
        studentFees,
        feePayments,
        actorName,
        actorRole: role,
        actorUid: firebaseUser.uid,
      });

      const parts: string[] = [];
      if (outcome.publishedCount > 0) parts.push(`${outcome.publishedCount} published`);
      if (outcome.republishedCount > 0) parts.push(`${outcome.republishedCount} republished`);
      if (outcome.skippedUnapprovedCount > 0) {
        parts.push(`${outcome.skippedUnapprovedCount} unapproved skipped`);
      }
      if (outcome.withheldForFeesCount > 0) {
        parts.push(`${outcome.withheldForFeesCount} withheld pending fee clearance`);
      }

      setSuccessMsg(
        `Report card batch complete for ${selectedClass} (${selectedTerm}): ${parts.join(', ')}.`
      );
      setIsPublishSelectedModalOpen(false);
    } catch (err) {
      console.error('Publish selected report cards failed:', err);
      setDataError(extractFriendlyError(err, 'Failed to publish selected report cards.'));
    } finally {
      setIsPublishingReport(false);
    }
  };

  const handleConfirmPublishWholeClass = async () => {
    if (!isAdmin || !firebaseUser) return;
    const actorName = currentUser?.displayName || firebaseUser.email || 'Admin';

    setIsPublishingReport(true);
    setDataError('');
    try {
      const outcome = await publishMultipleReportCardsToFirestore({
        results: computedClassResults,
        existingSnapshotsByReportId: publishedSnapshotsByReportId,
        schoolSettings,
        config,
        session: selectedSession,
        term: selectedTerm,
        section: selectedClassObj?.section,
        nextTermResumption: activeNextTermResumption,
        studentFees,
        feePayments,
        actorName,
        actorRole: role,
        actorUid: firebaseUser.uid,
      });

      const parts: string[] = [];
      if (outcome.publishedCount > 0) parts.push(`${outcome.publishedCount} newly published`);
      if (outcome.republishedCount > 0) parts.push(`${outcome.republishedCount} republished`);
      if (outcome.skippedUnapprovedCount > 0) {
        parts.push(`${outcome.skippedUnapprovedCount} draft/unapproved skipped`);
      }
      if (outcome.withheldForFeesCount > 0) {
        parts.push(`${outcome.withheldForFeesCount} withheld for unpaid fees`);
      }

      setSuccessMsg(
        `Published whole class (${selectedClass}, ${selectedTerm}): ${parts.join(', ')}.`
      );
      setIsPublishClassConfirmOpen(false);
    } catch (err) {
      console.error('Publish whole class report cards failed:', err);
      setDataError(extractFriendlyError(err, 'Failed to publish class report cards.'));
    } finally {
      setIsPublishingReport(false);
    }
  };

  // ==================== TAB 4: CLASSES, SUBJECTS & TEACHER ASSIGNMENTS ====================
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [classForm, setClassForm] = useState<{
    id?: string;
    previousName?: string;
    name: string;
    section: SchoolSection;
    level: string;
    arm: string;
    formTeacherId: string;
    formTeacherName: string;
    capacity: number;
    roomNumber: string;
    subjects: string[];
    isActive: boolean;
    sortOrder?: number;
    notes: string;
  }>({
    name: '',
    section: 'Primary',
    level: 'Primary 1',
    arm: 'Standard',
    formTeacherId: '',
    formTeacherName: '',
    capacity: 30,
    roomNumber: 'Primary Block, Room 1',
    subjects: ['Mathematics', 'English Language'],
    isActive: true,
    notes: '',
  });
  const [customClassSubject, setCustomClassSubject] = useState('');
  const [selectedClassSubjectOption, setSelectedClassSubjectOption] = useState('');
  const [useCustomClassLevel, setUseCustomClassLevel] = useState(false);

  // Teacher-Subject-Class Assignment state
  const [assignClass, setAssignClass] = useState<string>(
    activeClassesList[0]?.name || DEFAULT_SCHOOL_CLASSES[0].name
  );
  const [assignSubject, setAssignSubject] = useState<string>('Mathematics');
  const [assignTeacherId, setAssignTeacherId] = useState<string>(teachersList[0]?.id || '');

  useEffect(() => {
    if (
      activeClassesList.length > 0 &&
      !activeClassesList.some((c) => c.name === assignClass)
    ) {
      setAssignClass(activeClassesList[0].name);
    }
  }, [activeClassesList, assignClass]);

  useEffect(() => {
    if (teachersList.length > 0 && !teachersList.some((t) => t.id === assignTeacherId)) {
      setAssignTeacherId(teachersList[0].id);
    }
  }, [teachersList, assignTeacherId]);

  const handleOpenNewClassModal = () => {
    setUseCustomClassLevel(false);
    setSelectedClassSubjectOption('');
    setCustomClassSubject('');
    setClassForm({
      name: '',
      section: 'Primary',
      level: 'Primary 1',
      arm: 'Standard',
      formTeacherId: '',
      formTeacherName: '',
      capacity: 30,
      roomNumber: 'Primary Block',
      subjects: ['Mathematics', 'English Studies', 'Basic Science'],
      isActive: true,
      notes: '',
    });
    setIsClassModalOpen(true);
  };

  const handleOpenEditClassModal = (cls: SchoolClass) => {
    const section = resolveClassSection(cls);
    const sectionLevels = LEVELS_BY_SECTION[section] || NIGERIAN_LEVELS_LIST;
    setUseCustomClassLevel(
      Boolean(cls.level && !sectionLevels.includes(cls.level) && !NIGERIAN_LEVELS_LIST.includes(cls.level))
    );
    setSelectedClassSubjectOption('');
    setCustomClassSubject('');
    setClassForm({
      id: cls.id,
      previousName: cls.name,
      name: cls.name,
      section,
      level: cls.level,
      arm: cls.arm,
      formTeacherId: cls.formTeacherId || '',
      formTeacherName:
        cls.formTeacherName && cls.formTeacherName !== 'Unassigned' ? cls.formTeacherName : '',
      capacity: cls.capacity,
      roomNumber: cls.roomNumber,
      subjects: [...(cls.subjects || [])],
      isActive: cls.isActive !== false,
      sortOrder: cls.sortOrder,
      notes: cls.notes || '',
    });
    setIsClassModalOpen(true);
  };

  const handleSaveClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    const trimmedName = classForm.name.trim();
    if (!trimmedName || !classForm.level.trim()) {
      setDataError('Class name and level are required.');
      return;
    }
    const matchedTeacher = classForm.formTeacherId
      ? teachersList.find((t) => t.id === classForm.formTeacherId)
      : undefined;
    const finalTeacherName =
      classForm.formTeacherName.trim() || matchedTeacher?.fullName || 'Unassigned';
    const finalTeacherId =
      matchedTeacher &&
      matchedTeacher.fullName.trim().toLowerCase() === finalTeacherName.toLowerCase()
        ? matchedTeacher.id
        : '';

    const existingObj = classForm.id
      ? classesList.find((c) => c.id === classForm.id)
      : undefined;
    const enrolledCount = studentsList.filter(
      (s) =>
        s.status === 'Active' &&
        (existingObj ? doesStudentBelongToClass(s, existingObj) : s.className === trimmedName)
    ).length;

    const payload: SchoolClass = {
      id: classForm.id || '',
      name: trimmedName,
      section: classForm.section,
      level: classForm.level.trim(),
      arm: classForm.arm.trim() || 'Standard',
      formTeacherId: finalTeacherId,
      formTeacherName: finalTeacherName,
      capacity: Number(classForm.capacity) || 30,
      totalStudents: enrolledCount,
      roomNumber: classForm.roomNumber.trim() || 'Main Block',
      subjects: classForm.subjects,
      isActive: classForm.isActive,
      sortOrder: classForm.sortOrder,
      notes: classForm.notes.trim(),
    };

    try {
      if (isLiveFirestore) {
        await saveClassToFirestore(payload, {
          existingClasses: classesList,
          previousName: classForm.previousName,
        });
        setSuccessMsg(`Saved class "${payload.name}" (${payload.section}) to Cloud Firestore.`);
      } else {
        const fallbackId = payload.id || `cls-${Date.now()}`;
        const localClass = { ...payload, id: fallbackId };
        setClassesList((prev) => {
          const idx = prev.findIndex((c) => c.id === localClass.id);
          if (idx >= 0) return prev.map((c) => (c.id === localClass.id ? localClass : c));
          return [...prev, localClass];
        });
        setSuccessMsg(`Saved class "${payload.name}" in current session.`);
      }
      setIsClassModalOpen(false);
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to save class.'));
    }
  };

  const handleAssignTeacherToSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!assignClass || !assignSubject) {
      setDataError('Please select a class and subject.');
      return;
    }
    const teacher = teachersList.find((t) => t.id === assignTeacherId);
    if (!teacher) {
      setDataError('Please select a teacher.');
      return;
    }

    try {
      if (isLiveFirestore) {
        await saveSubjectAssignmentToFirestore(
          {
            className: assignClass,
            subject: assignSubject,
            teacherId: teacher.id,
            teacherName: teacher.fullName,
            teacherEmail: teacher.email,
          },
          teacher
        );
        setSuccessMsg(
          `Assigned ${teacher.fullName} to teach ${assignSubject} in ${assignClass} (Firestore synced).`
        );
      } else {
        const id = buildSubjectAssignmentId(assignClass, assignSubject);
        const item: SubjectTeacherAssignment = {
          id,
          className: assignClass,
          subject: assignSubject,
          teacherId: teacher.id,
          teacherName: teacher.fullName,
          teacherEmail: teacher.email,
          updatedAt: new Date().toISOString(),
        };
        setAssignments((prev) => {
          const idx = prev.findIndex((a) => a.id === id);
          if (idx >= 0) return prev.map((a) => (a.id === id ? item : a));
          return [...prev, item];
        });
        setSuccessMsg(`Assigned ${teacher.fullName} to ${assignSubject} (${assignClass}).`);
      }
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to assign teacher to subject/class.'));
    }
  };

  const handleRemoveAssignment = async (id: string) => {
    if (!isAdmin) return;
    try {
      if (isLiveFirestore) {
        await removeSubjectAssignmentFromFirestore(id);
      } else {
        setAssignments((prev) => prev.filter((a) => a.id !== id));
      }
      setSuccessMsg('Subject-teacher assignment removed.');
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to remove assignment.'));
    }
  };

  const handleSeedClasses = async () => {
    if (!isLiveFirestore || !isAdmin) return;
    try {
      const res = await syncStandardClassesToFirestore();
      setSuccessMsg(
        res.addedCount > 0 || res.updatedCount > 0
          ? `Synchronized classes in Cloud Firestore (${res.addedCount} added, ${res.updatedCount} section grouping fixed, ${res.skippedCount} preserved).`
          : 'All 15 standard classes (Creche – SS 3) are already saved in Cloud Firestore.'
      );
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to sync standard school classes.'));
    }
  };

  // ==================== TAB 5: SESSIONS & TERMS STATE ====================
  const [newSessionName, setNewSessionName] = useState('2027/2028 Session');
  const [newSessionStart, setNewSessionStart] = useState('2027-09-13');
  const [newSessionEnd, setNewSessionEnd] = useState('2028-07-21');
  const [makeNewSessionActive, setMakeNewSessionActive] = useState(false);

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !newSessionName.trim()) return;
    const yearStart = newSessionStart.slice(0, 4) || '2027';
    const yearEnd = newSessionEnd.slice(0, 4) || '2028';
    const newSess: AcademicSession = {
      id: `sess-${Date.now()}`,
      name: newSessionName.trim(),
      isActive: makeNewSessionActive,
      startDate: newSessionStart,
      endDate: newSessionEnd,
      terms: [
        {
          name: 'First Term',
          isActive: true,
          startDate: newSessionStart,
          endDate: `${yearStart}-12-18`,
          nextTermResumption: `${yearEnd}-01-10`,
        },
        {
          name: 'Second Term',
          isActive: false,
          startDate: `${yearEnd}-01-10`,
          endDate: `${yearEnd}-04-07`,
          nextTermResumption: `${yearEnd}-04-24`,
        },
        {
          name: 'Third Term',
          isActive: false,
          startDate: `${yearEnd}-04-24`,
          endDate: newSessionEnd,
          nextTermResumption: `${yearEnd}-09-11`,
        },
      ],
    };

    try {
      if (isLiveFirestore) {
        await saveAcademicSessionToFirestore(newSess, sessions);
      } else {
        setSessions((prev) => [
          newSess,
          ...prev.map((s) => (makeNewSessionActive ? { ...s, isActive: false } : s)),
        ]);
      }
      setSuccessMsg(`Created academic session "${newSess.name}" with First, Second & Third Terms.`);
      setNewSessionName('');
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to create academic session.'));
    }
  };

  const handleActivateSessionTerm = async (session: AcademicSession, termName: AcademicTerm) => {
    if (!isAdmin) return;
    const updatedSession: AcademicSession = {
      ...session,
      isActive: true,
      terms: session.terms.map((t) => ({ ...t, isActive: t.name === termName })),
    };
    try {
      if (isLiveFirestore) {
        await saveAcademicSessionToFirestore(updatedSession, sessions);
      } else {
        setSessions((prev) =>
          prev.map((s) => (s.id === session.id ? updatedSession : { ...s, isActive: false }))
        );
      }
      setSelectedSession(session.name);
      setSelectedTerm(termName);
      setSuccessMsg(`Activated ${session.name} — ${termName}.`);
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to activate session/term.'));
    }
  };

  // ==================== TAB 6: GRADING & ASSESSMENT CONFIGURATION ====================
  const [configDraft, setConfigDraft] = useState<AcademicConfig>(config);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  useEffect(() => {
    setConfigDraft(config);
  }, [config]);

  const draftComponentsTotal = configDraft.components.reduce(
    (sum, c) => sum + (Number(c.maxMark) || 0),
    0
  );

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (configDraft.components.length === 0) {
      setDataError('Add at least one assessment component.');
      return;
    }
    if (configDraft.gradingScale.length === 0) {
      setDataError('Add at least one grading boundary.');
      return;
    }

    setIsSavingConfig(true);
    setDataError('');
    try {
      const actor = currentUser?.displayName || firebaseUser?.email || 'Admin';
      if (isLiveFirestore) {
        await saveAcademicConfigToFirestore(configDraft, actor);
        setSuccessMsg(
          'Saved assessment components, grading boundaries, and ranking policy to Cloud Firestore.'
        );
      } else {
        setConfig({ ...configDraft, updatedBy: actor, updatedAt: new Date().toISOString() });
        setSuccessMsg('Updated assessment & grading configuration for this session.');
      }
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to save academic configuration.'));
    } finally {
      setIsSavingConfig(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Live Cloud Firestore Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB] text-xs text-[#2A583B] no-print">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#2A583B] shrink-0" />
          <span>
            <strong>Live Cloud Firestore Connected:</strong> Sessions, classes, subject
            assignments, assessment scores, grades, positions, approvals, and attendance summaries
            are calculated strictly from real saved records.
          </span>
        </div>
        {isAdmin && (!classesSeeded || missingStandardCount > 0) && (
          <button
            onClick={handleSeedClasses}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-[8px] bg-[#2A583B] hover:bg-[#20452E] text-white font-medium text-[11px] transition-colors duration-150"
          >
            <Database className="w-3.5 h-3.5" />
            {!classesSeeded
              ? 'Initialize 15 School Classes (Creche – SS 3)'
              : `Sync ${missingStandardCount} Missing Class${missingStandardCount > 1 ? 'es' : ''}`}
          </button>
        )}
      </div>

      {/* Header & Tabs */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 no-print">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#2A2A2E] tracking-tight">
              Academic Management
            </h1>
            <span className="bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA] text-xs font-medium px-2.5 py-0.5 rounded-full">
              {selectedTerm} • {selectedSession}
            </span>
          </div>
          <p className="text-xs text-[#5E5B56] mt-0.5">
            Creche, Nursery, Primary, Junior Secondary & Senior Secondary • Configurable CA/Exams,
            Grading, Rankings, Approvals & PDF Report Cards
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-1 bg-[#FAF8F4] p-1 rounded-[10px] border border-[#E6DFD3]">
          {!isParent && (
            <>
              <button
                onClick={() => setActiveTab('scores')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-all duration-150 ${
                  activeTab === 'scores'
                    ? 'bg-[#6B1020] text-white shadow-xs'
                    : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                Score Entry
              </button>
              <button
                onClick={() => guardUnsavedChanges(() => setActiveTab('summary'))}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-all duration-150 ${
                  activeTab === 'summary'
                    ? 'bg-[#6B1020] text-white shadow-xs'
                    : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
                }`}
              >
                <Award className="w-3.5 h-3.5" />
                Class Summary & Review
              </button>
            </>
          )}

          <button
            onClick={() => guardUnsavedChanges(() => setActiveTab('reports'))}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-all duration-150 ${
              activeTab === 'reports'
                ? 'bg-[#6B1020] text-white shadow-xs'
                : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Report Cards
          </button>

          {!isParent && (
            <button
              onClick={() => guardUnsavedChanges(() => setActiveTab('classes'))}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-all duration-150 ${
                activeTab === 'classes'
                  ? 'bg-[#6B1020] text-white shadow-xs'
                  : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
              }`}
            >
              <School className="w-3.5 h-3.5" />
              Classes & Teachers
            </button>
          )}

          {isAdmin && (
            <>
              <button
                onClick={() => guardUnsavedChanges(() => setActiveTab('sessions'))}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-all duration-150 ${
                  activeTab === 'sessions'
                    ? 'bg-[#6B1020] text-white shadow-xs'
                    : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                Sessions & Terms
              </button>
              <button
                onClick={() => guardUnsavedChanges(() => setActiveTab('config'))}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-all duration-150 ${
                  activeTab === 'config'
                    ? 'bg-[#6B1020] text-white shadow-xs'
                    : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                Grading & CA Setup
              </button>
            </>
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

      {/* Shared Session/Term/Section/Class Selector Bar for Scores, Summary, Reports */}
      {(activeTab === 'scores' || activeTab === 'summary' || activeTab === 'reports') && (
        <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] no-print space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-3">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                Academic Session
              </label>
              <select
                value={selectedSession}
                onChange={(e) => {
                  const val = e.target.value;
                  guardUnsavedChanges(() => setSelectedSession(val));
                }}
                className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name} {s.isActive ? '(Active)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                Term
              </label>
              <select
                value={selectedTerm}
                onChange={(e) => {
                  const val = e.target.value as AcademicTerm;
                  guardUnsavedChanges(() => setSelectedTerm(val));
                }}
                className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
              >
                <option value="First Term">First Term</option>
                <option value="Second Term">Second Term</option>
                <option value="Third Term">Third Term</option>
              </select>
            </div>

            {!isParent && (
              <>
                <div className="lg:col-span-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                    Section
                  </label>
                  <select
                    value={selectedSectionFilter}
                    onChange={(e) => {
                      const val = e.target.value;
                      guardUnsavedChanges(() => setSelectedSectionFilter(val));
                    }}
                    className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                  >
                    <option value="All">All Sections</option>
                    {SECTIONS.map((sec) => (
                      <option key={sec} value={sec}>
                        {SECTION_LABELS[sec]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={activeTab === 'scores' ? 'lg:col-span-2' : 'lg:col-span-5'}>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                    Class / Arm
                  </label>
                  <select
                    value={selectedClass}
                    onChange={(e) => {
                      const val = e.target.value;
                      guardUnsavedChanges(() => setSelectedClass(val));
                    }}
                    className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                  >
                    {groupedClassesForDropdown.map((group) => (
                      <optgroup key={group.section} label={group.label}>
                        {group.classes.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                            {c.isActive === false ? ' (Archived)' : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </>
            )}

            {activeTab === 'scores' && !isParent && (
              <div className="lg:col-span-3 relative" ref={subjectDropdownRef}>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                  Subjects
                </label>
                <button
                  type="button"
                  onClick={() => setIsSubjectDropdownOpen((prev) => !prev)}
                  className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] flex items-center justify-between gap-2 hover:border-[#6B1020]/50 focus:outline-none focus:ring-2 focus:ring-[#6B1020]/20 transition-colors duration-150"
                >
                  <span className="truncate">
                    {selectedSubjects.length === 0
                      ? 'Select subject(s)...'
                      : selectedSubjects.length === 1
                      ? selectedSubjects[0]
                      : `${selectedSubjects.length} subjects selected`}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-[#7F7A72] shrink-0 transition-transform ${
                      isSubjectDropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {isSubjectDropdownOpen && (
                  <div className="absolute left-0 right-0 mt-1.5 bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_12px_36px_rgba(42,42,46,0.14)] z-30 overflow-hidden">
                    <div className="px-3 py-2 bg-[#FAF8F4] border-b border-[#E6DFD3] flex items-center justify-between gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={handleSelectAllSubjects}
                        disabled={
                          availableSubjectsForClass.length === 0 ||
                          selectedSubjects.length === availableSubjectsForClass.length
                        }
                        className="font-semibold text-[#6B1020] hover:text-[#540C19] disabled:opacity-40 transition-colors"
                      >
                        Select All Subjects
                      </button>
                      <button
                        type="button"
                        onClick={handleClearSubjects}
                        disabled={selectedSubjects.length === 0}
                        className="font-medium text-[#5E5B56] hover:text-[#86222E] disabled:opacity-40 transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="max-h-60 overflow-y-auto divide-y divide-[#EFE9DF] p-1">
                      {availableSubjectsForClass.length === 0 ? (
                        <p className="px-3 py-4 text-center text-xs text-[#7F7A72]">
                          No subjects configured for this class.
                        </p>
                      ) : (
                        availableSubjectsForClass.map((sub) => {
                          const checked = selectedSubjects.includes(sub);
                          const isDirty = dirtySubjectSet.has(sub);
                          return (
                            <label
                              key={sub}
                              className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-[8px] text-xs cursor-pointer transition-colors ${
                                checked
                                  ? 'bg-[#FAF0F2] text-[#6B1020] font-semibold'
                                  : 'text-[#2A2A2E] hover:bg-[#FAF8F4]'
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => handleToggleSubject(sub)}
                                  className="w-3.5 h-3.5 rounded border-[#DDD5C7] accent-[#6B1020]"
                                />
                                <span className="truncate">{sub}</span>
                              </span>
                              {isDirty && (
                                <span
                                  className="w-2 h-2 rounded-full bg-[#B8913A] shrink-0"
                                  title="Unsaved changes"
                                />
                              )}
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'reports' && (
              <div className={isParent ? 'lg:col-span-7' : 'lg:col-span-3'}>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                  {isParent ? 'Select Ward' : 'Select Student'}
                </label>
                <select
                  value={reportStudentId}
                  onChange={(e) => setReportStudentId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                >
                  {(isParent ? scopedStudents : activeStudentsInClass).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.admissionNo}) — {getStudentReportStatusTag(s.id)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Selected Subjects Removable Chips */}
          {activeTab === 'scores' && !isParent && selectedSubjects.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#EFE9DF]">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7F7A72] mr-1">
                Selected ({selectedSubjects.length}):
              </span>
              {selectedSubjects.map((sub) => {
                const isDirty = dirtySubjectSet.has(sub);
                return (
                  <span
                    key={sub}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                      isDirty
                        ? 'bg-[#FBF5E8] border-[#E3CFA6] text-[#7D5A18]'
                        : 'bg-[#FAF0F2] border-[#DFC7CA] text-[#6B1020]'
                    }`}
                  >
                    {isDirty && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[#B8913A] shrink-0"
                        title="Unsaved changes"
                      />
                    )}
                    <span>{sub}</span>
                    <button
                      type="button"
                      onClick={() => handleToggleSubject(sub)}
                      className="p-0.5 rounded-full hover:bg-[#6B1020]/10 text-[#5E5B56] hover:text-[#2A2A2E] transition-colors"
                      title={`Remove ${sub}`}
                      aria-label={`Remove ${sub}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 1: SCORE ENTRY ==================== */}
      {activeTab === 'scores' && !isParent && (
        <div className="space-y-4">
          {/* Grading Key Banner */}
          <div className="bg-gradient-to-br from-[#6B1020] to-[#540C19] text-white p-3.5 rounded-[10px] border border-[#B8913A]/40 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-[#E3CFA6]" />
              <span className="font-semibold text-[#E3CFA6] uppercase text-[11px] tracking-wider">
                Active Grading Scale:
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
              {config.gradingScale.map((g) => (
                <span
                  key={g.grade}
                  className="px-2 py-0.5 rounded-[6px] bg-white/10 border border-white/15"
                >
                  {g.grade}: {g.minScore}–{g.maxScore}%
                </span>
              ))}
            </div>
          </div>

          {/* Multi-Subject Save All Bar */}
          {selectedSubjects.length > 1 && (
            <div className="bg-white p-3.5 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-[#2A2A2E]">
                  {selectedSubjects.length} Assessment Sheets Open ({selectedClass})
                </span>
                {hasUnsavedScoreChanges && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6] font-medium text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#B8913A]" />
                    Unsaved changes in {dirtySubjects.length} subject
                    {dirtySubjects.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleSaveAllScores}
                disabled={
                  isSavingAllScores ||
                  savingSubject !== null ||
                  hasAnyScoreErrors ||
                  activeStudentsInClass.length === 0
                }
                className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium shadow-xs disabled:opacity-50 transition-colors duration-150"
              >
                <Save className="w-4 h-4" />
                {isSavingAllScores
                  ? 'Saving All Scores...'
                  : `Save All Scores (${selectedSubjects.length} Subjects)`}
              </button>
            </div>
          )}

          {selectedSubjects.length === 0 ? (
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] p-10 text-center space-y-3">
              <BookOpen className="w-8 h-8 text-[#DDD5C7] mx-auto" />
              <div>
                <p className="font-semibold text-sm text-[#2A2A2E]">No Subjects Selected</p>
                <p className="text-xs text-[#5E5B56] mt-0.5">
                  Choose one or more subjects from the Subjects multi-select above to enter scores.
                </p>
              </div>
              {availableSubjectsForClass.length > 0 && (
                <button
                  type="button"
                  onClick={handleSelectAllSubjects}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium shadow-xs transition-colors duration-150"
                >
                  Select All Subjects
                </button>
              )}
            </div>
          ) : (
            selectedSubjects.map((subject) => {
              const subjectDrafts = scoreDraftsBySubject[subject] || {};
              const subjectErrors = scoreValidationErrorsBySubject[subject] || {};
              const subHasErrors = Object.keys(subjectErrors).length > 0;
              const isSubDirty = dirtySubjectSet.has(subject);
              const isSavingThis = savingSubject === subject;

              return (
                <div
                  key={subject}
                  className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] overflow-hidden"
                >
                  <div className="p-4 border-b border-[#EFE9DF] flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-sm text-[#2A2A2E]">
                          Assessment Sheet: {subject} — {selectedClass}
                        </h3>
                        {isSubDirty && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6] text-[10px] font-medium">
                            Unsaved changes
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#5E5B56]">
                        Max Marks:{' '}
                        {config.components.map((c) => `${c.label} (${c.maxMark})`).join(' + ')} ={' '}
                        <strong className="text-[#2A2A2E]">{maxTotalMarks} Marks</strong>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSaveSubjectScores(subject)}
                      disabled={
                        isSavingThis ||
                        isSavingAllScores ||
                        subHasErrors ||
                        activeStudentsInClass.length === 0
                      }
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium shadow-xs disabled:opacity-50 transition-colors duration-150"
                    >
                      <Save className="w-4 h-4" />
                      {isSavingThis ? 'Saving Scores...' : 'Save Subject Scores'}
                    </button>
                  </div>

                  {subHasErrors && (
                    <div className="px-4 py-2.5 bg-[#FAF0F2] border-b border-[#E2C1C5] text-xs text-[#86222E] font-medium flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-[#86222E] shrink-0" />
                      <span>
                        One or more scores exceed the maximum allowed mark or are negative. Correct
                        highlighted fields before saving.
                      </span>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                          <th className="py-3 px-4">Student</th>
                          <th className="py-3 px-4">Admission No</th>
                          {config.components.map((comp) => (
                            <th key={comp.id} className="py-3 px-3 text-center">
                              {comp.label} (Max {comp.maxMark})
                            </th>
                          ))}
                          <th className="py-3 px-3 text-center">Total ({maxTotalMarks})</th>
                          <th className="py-3 px-3 text-center">Grade</th>
                          <th className="py-3 px-4">Subject Teacher Remark</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EFE9DF] text-xs">
                        {isLoading ? (
                          <tr>
                            <td
                              colSpan={config.components.length + 5}
                              className="py-12 text-center text-[#7F7A72]"
                            >
                              Loading saved assessment records...
                            </td>
                          </tr>
                        ) : activeStudentsInClass.length === 0 ? (
                          <tr>
                            <td
                              colSpan={config.components.length + 5}
                              className="py-12 text-center text-[#7F7A72]"
                            >
                              No active students registered in {selectedClass}.
                            </td>
                          </tr>
                        ) : (
                          activeStudentsInClass.map((student) => {
                            const draft = subjectDrafts[student.id];
                            const hasEnteredAny =
                              draft &&
                              config.components.some(
                                (c) => (draft.components[c.key] ?? '').trim() !== ''
                              );
                            const total = draft
                              ? config.components.reduce(
                                  (sum, c) => sum + (Number(draft.components[c.key]) || 0),
                                  0
                                )
                              : 0;
                            const pct =
                              maxTotalMarks > 0
                                ? Math.round((total / maxTotalMarks) * 1000) / 10
                                : 0;
                            const { grade, remark } = hasEnteredAny
                              ? computeGradeFromConfig(pct, config.gradingScale)
                              : { grade: '—', remark: 'Not entered' };

                            return (
                              <tr key={student.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                                <td className="py-3 px-4 font-semibold text-[#2A2A2E]">
                                  {student.fullName}
                                </td>
                                <td className="py-3 px-4 font-mono text-[#5E5B56]">
                                  {student.admissionNo}
                                </td>
                                {config.components.map((comp) => {
                                  const errKey = `${student.id}_${comp.key}`;
                                  const fieldError = subjectErrors[errKey];
                                  const val = draft?.components[comp.key] ?? '';
                                  return (
                                    <td key={comp.id} className="py-3 px-3 text-center">
                                      <input
                                        type="number"
                                        min={0}
                                        max={comp.maxMark}
                                        step="0.5"
                                        placeholder="—"
                                        value={val}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setScoreDraftsBySubject((prev) => ({
                                            ...prev,
                                            [subject]: {
                                              ...(prev[subject] || {}),
                                              [student.id]: {
                                                components: {
                                                  ...(prev[subject]?.[student.id]?.components ||
                                                    {}),
                                                  [comp.key]: v,
                                                },
                                                remark:
                                                  prev[subject]?.[student.id]?.remark || '',
                                              },
                                            },
                                          }));
                                        }}
                                        className={`w-20 text-center py-1.5 border rounded-[8px] font-medium tabular-nums focus:outline-none focus:ring-2 transition-colors duration-150 ${
                                          fieldError
                                            ? 'border-[#86222E] bg-[#FAF0F2] text-[#86222E] focus:ring-[#86222E]/20'
                                            : 'border-[#DDD5C7] bg-[#FAF8F4] focus:bg-white focus:border-[#6B1020] focus:ring-[#6B1020]/20 text-[#2A2A2E]'
                                        }`}
                                      />
                                      {fieldError && (
                                        <span className="block text-[10px] text-[#86222E] font-medium mt-0.5">
                                          {fieldError}
                                        </span>
                                      )}
                                    </td>
                                  );
                                })}
                                <td className="py-3 px-3 text-center font-semibold text-sm text-[#2A2A2E] tabular-nums">
                                  {hasEnteredAny ? total : '—'}
                                </td>
                                <td className="py-3 px-3 text-center">
                                  <span
                                    className={`inline-block font-mono font-semibold px-2 py-0.5 rounded-[6px] text-xs border ${
                                      grade === '—'
                                        ? 'bg-[#FAF8F4] text-[#7F7A72] border-[#E6DFD3]'
                                        : grade.startsWith('A')
                                        ? 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]'
                                        : grade.startsWith('B')
                                        ? 'bg-[#FAF0F2] text-[#6B1020] border-[#DFC7CA]'
                                        : grade.startsWith('C')
                                        ? 'bg-[#FAF8F4] text-[#2A2A2E] border-[#DDD5C7]'
                                        : grade.startsWith('D') || grade.startsWith('E')
                                        ? 'bg-[#FBF5E8] text-[#7D5A18] border-[#E3CFA6]'
                                        : 'bg-[#FAF0F2] text-[#86222E] border-[#E2C1C5]'
                                    }`}
                                  >
                                    {grade}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <input
                                    type="text"
                                    placeholder={remark}
                                    value={draft?.remark || ''}
                                    onChange={(e) =>
                                      setScoreDraftsBySubject((prev) => ({
                                        ...prev,
                                        [subject]: {
                                          ...(prev[subject] || {}),
                                          [student.id]: {
                                            components:
                                              prev[subject]?.[student.id]?.components || {},
                                            remark: e.target.value,
                                          },
                                        },
                                      }))
                                    }
                                    className="w-full px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-xs text-[#2A2A2E] focus:border-[#6B1020] focus:ring-2 focus:ring-[#6B1020]/20 focus:outline-none transition-colors duration-150"
                                  />
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ==================== TAB 2: CLASS RESULT SUMMARY & APPROVAL ==================== */}
      {activeTab === 'summary' && !isParent && (
        <div className="space-y-4">
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] overflow-hidden print-only-card">
            <div className="p-5 border-b border-[#EFE9DF] flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="hidden print:block font-serif text-[11px] font-semibold uppercase tracking-wide text-[#7D5A18] mb-1">
                  {schoolSettings.schoolName} — Class Broadsheet Summary
                </p>
                <h3 className="font-semibold text-sm text-[#2A2A2E]">
                  Class Result Summary — {selectedClass} ({selectedTerm}, {selectedSession})
                </h3>
                <p className="text-xs text-[#5E5B56] mt-0.5">
                  <strong className="text-[#2A2A2E]">Ranking Policy:</strong>{' '}
                  {config.rankingPolicy === 'dense'
                    ? 'Dense Ranking (1, 2, 2, 3) by Term Average % across saved subjects.'
                    : 'Standard Competition Ranking (1, 2, 2, 4) by Term Average % across saved subjects.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 no-print">
                <button
                  onClick={() => handleBatchClassReviewStatus('Submitted for Review')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#FAF0F2] hover:bg-[#F3E1E5] text-[#6B1020] text-xs font-medium border border-[#DFC7CA] transition-colors duration-150"
                >
                  <Send className="w-3.5 h-3.5" />
                  Submit Class for Review
                </button>
                {isAdmin && (
                  <button
                    onClick={() => handleBatchClassReviewStatus('Approved')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#2A583B] hover:bg-[#20452E] text-white text-xs font-medium transition-colors duration-150"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    Approve All Results
                  </button>
                )}
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] text-xs font-medium transition-colors duration-150"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Summary
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                    <th className="py-3 px-4">Pos</th>
                    <th className="py-3 px-4">Student</th>
                    <th className="py-3 px-4">Admission No</th>
                    <th className="py-3 px-3 text-center">Subjects Saved</th>
                    <th className="py-3 px-3 text-center">Total Marks</th>
                    <th className="py-3 px-3 text-center">Term Avg (%)</th>
                    <th className="py-3 px-3 text-center">Grade</th>
                    <th className="py-3 px-3 text-center">Attendance</th>
                    <th className="py-3 px-3 text-center">Approval</th>
                    <th className="py-3 px-4 text-right no-print">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE9DF] text-xs">
                  {computedClassResults.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-[#7F7A72]">
                        No active students found in {selectedClass}.
                      </td>
                    </tr>
                  ) : (
                    computedClassResults.map((res) => (
                      <tr key={res.student.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                        <td className="py-3.5 px-4 font-semibold text-[#6B1020] tabular-nums">
                          {formatOrdinal(res.position)}
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-[#2A2A2E]">
                          {res.student.fullName}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-[#5E5B56]">
                          {res.student.admissionNo}
                        </td>
                        <td className="py-3.5 px-3 text-center font-medium tabular-nums text-[#2A2A2E]">
                          {res.subjectsCount}
                        </td>
                        <td className="py-3.5 px-3 text-center font-mono tabular-nums text-[#5E5B56]">
                          {res.subjectsCount > 0
                            ? `${res.totalMarksObtained} / ${res.totalMaxPossible}`
                            : '—'}
                        </td>
                        <td className="py-3.5 px-3 text-center font-semibold text-[#2A2A2E] tabular-nums">
                          {res.subjectsCount > 0 ? `${res.averagePercentage}%` : '—'}
                        </td>
                        <td className="py-3.5 px-3 text-center font-mono font-semibold text-[#6B1020]">
                          {res.overallGrade}
                        </td>
                        <td className="py-3.5 px-3 text-center text-[#5E5B56] tabular-nums">
                          {res.attendance.totalRecords > 0
                            ? `${res.attendance.attendedCount}/${res.attendance.totalRecords} (${res.attendance.attendanceRate}%)`
                            : '0 days'}
                        </td>
                        <td className="py-3.5 px-3 text-center">
                          <div className="inline-flex flex-col items-center gap-1">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                                res.review?.status === 'Approved'
                                  ? 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]'
                                  : res.review?.status === 'Submitted for Review'
                                  ? 'bg-[#FAF0F2] text-[#6B1020] border-[#DFC7CA]'
                                  : res.review?.status === 'Returned for Correction'
                                  ? 'bg-[#FAF0F2] text-[#86222E] border-[#E2C1C5]'
                                  : 'bg-[#FAF8F4] text-[#5E5B56] border-[#DDD5C7]'
                              }`}
                            >
                              {res.review?.status || 'Draft'}
                            </span>
                            {(() => {
                              const rid = buildPublishedReportId(
                                selectedSession,
                                selectedTerm,
                                res.student.id
                              );
                              const snap = publishedSnapshotsByReportId.get(rid);
                              if (!snap?.isPublished) return null;
                              const pubDate = formatShortPublishDate(
                                snap.firstPublishedAt || snap.publishedAt
                              );
                              return (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#6B1020] text-[#DFC484]">
                                  <Globe className="w-2.5 h-2.5" />
                                  Published{pubDate ? ` • ${pubDate}` : ''}
                                </span>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right no-print">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => openReviewModal(res)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-[#FBF5E8] hover:bg-[#F4E9D0] text-[#7D5A18] border border-[#E3CFA6] font-medium text-[11px] transition-colors duration-150"
                            >
                              <Pencil className="w-3 h-3" />
                              Comments / Review
                            </button>
                            <button
                              onClick={() => {
                                setReportStudentId(res.student.id);
                                setActiveTab('reports');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-[#FAF0F2] hover:bg-[#F3E1E5] text-[#6B1020] border border-[#DFC7CA] font-medium text-[11px] transition-colors duration-150"
                            >
                              <FileText className="w-3 h-3" />
                              Report Card
                            </button>
                          </div>
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

      {/* ==================== TAB 3: INDIVIDUAL REPORT CARDS ==================== */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          {isAdmin && (
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-4 shadow-[0_1px_2px_rgba(42,42,46,0.04)] flex flex-wrap items-center justify-between gap-3 no-print">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-[#2A2A2E] flex items-center gap-1.5">
                    <Globe className="w-4 h-4 text-[#6B1020]" />
                    Parent Publishing — {selectedClass} ({selectedTerm})
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
                    Draft / Pending: {classPublishSummary.draftOrPending}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB]">
                    Approved: {classPublishSummary.approved}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#6B1020] text-[#DFC484]">
                    Published: {classPublishSummary.published}
                  </span>
                </div>
                {schoolSettings.requireFullFeesBeforePublishReport && (
                  <p className="text-[11px] text-[#7D5A18]">
                    Fee clearance lock enabled in Settings: published reports are withheld from parents while school fees remain unpaid.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {computedClassResults.length > 0 && (
                  <>
                    <button
                      type="button"
                      disabled={isPublishingReport || classPublishSummary.approved === 0}
                      title={
                        classPublishSummary.approved === 0
                          ? 'Approve at least one student report before publishing'
                          : 'Choose specific Approved students to publish or republish'
                      }
                      onClick={handleOpenPublishSelectedModal}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckSquare className="w-3.5 h-3.5 text-[#6B1020]" />
                      Publish Selected
                    </button>
                    <button
                      type="button"
                      disabled={isPublishingReport || classPublishSummary.approved === 0}
                      title={
                        classPublishSummary.approved === 0
                          ? 'Approve at least one student report before publishing'
                          : 'Publish all Approved reports in this class to parents'
                      }
                      onClick={() => setIsPublishClassConfirmOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#2A583B] hover:bg-[#20452E] text-white text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Users className="w-3.5 h-3.5" />
                      Publish Whole Class ({classPublishSummary.approved})
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setIsPublishAuditModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#FAF8F4] hover:bg-[#FAF0F2] border border-[#E6DFD3] text-[#6B1020] text-xs font-medium transition-colors"
                >
                  <History className="w-3.5 h-3.5" />
                  Publish Audit Log ({publishAuditLogs.length})
                </button>
                {isDirector && (
                  <button
                    type="button"
                    onClick={() => {
                      setTestParentEmailInput(
                        activeReportResult?.student.guardianEmail || ''
                      );
                      setTestParentPreviewSnapshot(null);
                      setIsTestAsParentModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#FBF5E8] hover:bg-[#F4E9D0] border border-[#E3CFA6] text-[#7D5A18] text-xs font-medium transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Test as Parent
                  </button>
                )}
              </div>
            </div>
          )}

          {activeReportResult ? (
            <ReportCardView
              result={activeReportResult}
              classResults={computedClassResults}
              schoolSettings={schoolSettings}
              config={config}
              session={selectedSession}
              term={selectedTerm}
              section={selectedClassObj?.section}
              nextTermResumption={activeNextTermResumption}
              publishedSnapshot={activeReportSnapshot}
              feeClearance={activeReportFeeClearance}
              isPublishing={isPublishingReport}
              onPublish={
                isAdmin ? () => handlePublishSingleReport(activeReportResult) : undefined
              }
              onUnpublish={
                isAdmin && activeReportSnapshot
                  ? () => handleUnpublishSingleReport(activeReportSnapshot)
                  : undefined
              }
              onReviewUpdated={(updatedReview) => {
                setResultReviews((prev) => {
                  const idx = prev.findIndex((r) => r.id === updatedReview.id);
                  if (idx >= 0) return prev.map((r) => (r.id === updatedReview.id ? updatedReview : r));
                  return [...prev, updatedReview];
                });
              }}
            />
          ) : (
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-12 text-center text-xs text-[#7F7A72]">
              No student selected or registered in this scope yet.
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 4: CLASSES, SUBJECTS & TEACHER ASSIGNMENTS ==================== */}
      {activeTab === 'classes' && !isParent && (
        <div className="space-y-6">
          {/* Classes & Subjects Section */}
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-sm text-[#2A2A2E]">
                  Classes & Assigned Subjects (Creche, Nursery, Primary, JSS & SS)
                </h3>
                <p className="text-xs text-[#5E5B56]">
                  Manage subjects offered per class across all 5 school sections or manually assign form teachers
                </p>
              </div>
              {isAdmin && (
                <button
                  onClick={handleOpenNewClassModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create New Class
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {classesList.map((cls) => (
                <div
                  key={cls.id}
                  className={`p-4 rounded-[10px] border flex flex-col justify-between space-y-3 ${
                    cls.isActive === false
                      ? 'border-[#E6DFD3] bg-[#FAF8F4]/70 opacity-75'
                      : 'border-[#E6DFD3] bg-[#FAF8F4]'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-[6px] bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA]">
                            {SECTION_LABELS[cls.section || 'Primary']}
                          </span>
                          {cls.isActive === false && (
                            <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-[6px] bg-[#EFE9DF] text-[#5E5B56]">
                              Archived
                            </span>
                          )}
                        </div>
                        <h4 className="font-semibold text-sm text-[#2A2A2E] mt-1">{cls.name}</h4>
                        <p className="text-[11px] text-[#5E5B56]">
                          {cls.roomNumber} • Form Teacher: {cls.formTeacherName || 'Unassigned'}
                        </p>
                      </div>
                      {isAdmin && (
                        <button
                          onClick={() => handleOpenEditClassModal(cls)}
                          className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#6B1020] hover:bg-white transition-colors"
                          title="Edit Class & Assigned Subjects"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="mt-3">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7F7A72] block mb-1">
                        Assigned Subjects ({cls.subjects?.length || 0})
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {(cls.subjects || []).length === 0 ? (
                          <span className="text-[11px] text-[#7F7A72] italic">No subjects set</span>
                        ) : (
                          (cls.subjects || []).map((sub) => (
                            <span
                              key={sub}
                              className="px-2 py-0.5 rounded-[6px] bg-white border border-[#E6DFD3] text-[10px] font-medium text-[#2A2A2E]"
                            >
                              {sub}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Assign Teachers to Subjects & Classes */}
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
            <div>
              <h3 className="font-semibold text-sm text-[#2A2A2E]">
                Assign Teachers to Subjects & Classes
              </h3>
              <p className="text-xs text-[#5E5B56]">
                Map specific subject teachers to each active class subject
              </p>
            </div>

            {isAdmin && (
              <form
                onSubmit={handleAssignTeacherToSubject}
                className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-[#FAF8F4] p-3.5 rounded-[10px] border border-[#E6DFD3] text-xs items-end"
              >
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Class</label>
                  <select
                    value={assignClass}
                    onChange={(e) => setAssignClass(e.target.value)}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  >
                    <option value="">-- Select Class --</option>
                    {groupedActiveClasses.length === 0 ? (
                      <option value="" disabled>
                        No active classes available
                      </option>
                    ) : (
                      groupedActiveClasses.map((group) => (
                        <optgroup key={group.section} label={group.label}>
                          {group.classes.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </optgroup>
                      ))
                    )}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Subject</label>
                  <select
                    value={assignSubject}
                    onChange={(e) => setAssignSubject(e.target.value)}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  >
                    <option value="">-- Select Subject --</option>
                    {Array.from(
                      new Set([
                        ...(classesList.find((c) => c.name === assignClass)?.subjects || []),
                        ...NIGERIAN_SUBJECTS_LIST,
                      ])
                    ).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Teacher</label>
                  <select
                    value={assignTeacherId}
                    onChange={(e) => setAssignTeacherId(e.target.value)}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  >
                    <option value="">-- Select Teacher --</option>
                    {teachersList.length === 0 ? (
                      <option value="" disabled>
                        No registered teachers yet
                      </option>
                    ) : (
                      teachersList.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.fullName} ({t.staffId})
                          {t.subjects.length > 0
                            ? ` — ${t.subjects[0]}${t.subjects.length > 1 ? ` +${t.subjects.length - 1}` : ''}`
                            : ''}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium transition-colors duration-150"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  Assign Teacher
                </button>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                    <th className="py-2.5 px-4">Class</th>
                    <th className="py-2.5 px-4">Subject</th>
                    <th className="py-2.5 px-4">Assigned Teacher</th>
                    {isAdmin && <th className="py-2.5 px-4 text-right">Remove</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE9DF]">
                  {assignments.length === 0 ? (
                    <tr>
                      <td colSpan={isAdmin ? 4 : 3} className="py-8 text-center text-[#7F7A72]">
                        No subject-specific teacher assignments saved yet. Use the form above to
                        assign a teacher to a class subject.
                      </td>
                    </tr>
                  ) : (
                    assignments.map((a) => (
                      <tr key={a.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                        <td className="py-2.5 px-4 font-semibold text-[#2A2A2E]">{a.className}</td>
                        <td className="py-2.5 px-4 text-[#6B1020] font-medium">{a.subject}</td>
                        <td className="py-2.5 px-4 text-[#5E5B56]">{a.teacherName}</td>
                        {isAdmin && (
                          <td className="py-2.5 px-4 text-right">
                            <button
                              onClick={() => handleRemoveAssignment(a.id)}
                              className="p-1 text-[#86222E] hover:bg-[#FAF0F2] rounded-[6px] transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
        </div>
      )}

      {/* ==================== TAB 5: SESSIONS & TERMS ==================== */}
      {activeTab === 'sessions' && isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 bg-white rounded-[10px] border border-[#E6DFD3] p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4 h-fit">
            <h3 className="font-semibold text-sm text-[#2A2A2E]">Create Academic Session</h3>
            <form onSubmit={handleCreateSession} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-[#2A2A2E] mb-1">Session Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 2027/2028 Session"
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={newSessionStart}
                    onChange={(e) => setNewSessionStart(e.target.value)}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">End Date</label>
                  <input
                    type="date"
                    required
                    value={newSessionEnd}
                    onChange={(e) => setNewSessionEnd(e.target.value)}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-[#2A2A2E] font-medium pt-1">
                <input
                  type="checkbox"
                  checked={makeNewSessionActive}
                  onChange={(e) => setMakeNewSessionActive(e.target.checked)}
                  className="accent-[#6B1020]"
                />
                Set as current active school session
              </label>
              <p className="text-[11px] text-[#5E5B56]">
                Automatically creates First Term, Second Term, and Third Term schedules inside the
                session.
              </p>
              <button
                type="submit"
                className="w-full py-2.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium transition-colors duration-150"
              >
                Create Session & 3 Terms
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 space-y-4">
            {sessions.map((sess) => (
              <div
                key={sess.id}
                className={`bg-white rounded-[10px] border p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-3 ${
                  sess.isActive ? 'border-[#6B1020] ring-1 ring-[#6B1020]/20' : 'border-[#E6DFD3]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-sm text-[#2A2A2E]">{sess.name}</h4>
                    <p className="text-xs text-[#5E5B56]">
                      {sess.startDate} to {sess.endDate}
                    </p>
                  </div>
                  {sess.isActive && (
                    <span className="px-2.5 py-0.5 rounded-full bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB] text-[11px] font-medium">
                      Active Session
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  {sess.terms.map((term) => {
                    const isCurrentActive = sess.isActive && term.isActive;
                    return (
                      <div
                        key={term.name}
                        className={`p-3 rounded-[8px] border space-y-2 ${
                          isCurrentActive
                            ? 'bg-[#FAF0F2] border-[#DFC7CA]'
                            : 'bg-[#FAF8F4] border-[#E6DFD3]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <strong className="text-[#2A2A2E] font-semibold">{term.name}</strong>
                          {isCurrentActive && (
                            <span className="text-[10px] font-medium text-[#6B1020] bg-white border border-[#DFC7CA] px-1.5 py-0.5 rounded-[6px]">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#5E5B56]">
                          {term.startDate} → {term.endDate}
                        </p>
                        {!isCurrentActive && (
                          <button
                            type="button"
                            onClick={() => handleActivateSessionTerm(sess, term.name)}
                            className="w-full py-1 rounded-[8px] bg-white hover:bg-[#6B1020] hover:text-white text-[#6B1020] border border-[#DFC7CA] font-medium text-[11px] transition-colors duration-150"
                          >
                            Set Active Term
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ==================== TAB 6: GRADING, CA COMPONENTS & RANKING CONFIG ==================== */}
      {activeTab === 'config' && isAdmin && (
        <form onSubmit={handleSaveConfig} className="space-y-5">
          {/* Assessment Components */}
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-sm text-[#2A2A2E]">
                  Configurable Assessment Components & Maximum Marks
                </h3>
                <p className="text-xs text-[#5E5B56]">
                  Define continuous assessments and examination weights. Total Max Marks:{' '}
                  <strong
                    className={
                      draftComponentsTotal === 100 ? 'text-[#2A583B]' : 'text-[#7D5A18]'
                    }
                  >
                    {draftComponentsTotal} Marks
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setConfigDraft((prev) => ({
                    ...prev,
                    components: [
                      ...prev.components,
                      {
                        id: `comp-${Date.now()}`,
                        key: `ca${prev.components.length + 1}`,
                        label: `CA ${prev.components.length}`,
                        maxMark: 10,
                        isExam: false,
                      },
                    ],
                  }))
                }
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] text-xs font-medium transition-colors duration-150"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Component
              </button>
            </div>

            <div className="space-y-2 text-xs">
              {configDraft.components.map((comp, idx) => (
                <div
                  key={comp.id}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-[#FAF8F4] p-3 rounded-[10px] border border-[#E6DFD3]"
                >
                  <div className="sm:col-span-5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#7F7A72] block mb-0.5">
                      Component Label
                    </label>
                    <input
                      type="text"
                      required
                      value={comp.label}
                      onChange={(e) => {
                        const val = e.target.value;
                        setConfigDraft((prev) => ({
                          ...prev,
                          components: prev.components.map((c, i) =>
                            i === idx ? { ...c, label: val } : c
                          ),
                        }));
                      }}
                      className="w-full px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] bg-white font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#7F7A72] block mb-0.5">
                      Max Mark
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      required
                      value={comp.maxMark}
                      onChange={(e) => {
                        const val = Number(e.target.value) || 0;
                        setConfigDraft((prev) => ({
                          ...prev,
                          components: prev.components.map((c, i) =>
                            i === idx ? { ...c, maxMark: val } : c
                          ),
                        }));
                      }}
                      className="w-full px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] bg-white font-mono font-semibold text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-3 flex items-center gap-2 pt-4">
                    <input
                      type="checkbox"
                      checked={Boolean(comp.isExam)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setConfigDraft((prev) => ({
                          ...prev,
                          components: prev.components.map((c, i) =>
                            i === idx ? { ...c, isExam: checked } : c
                          ),
                        }));
                      }}
                      className="accent-[#6B1020]"
                    />
                    <span className="text-[#2A2A2E] font-medium">Terminal Exam</span>
                  </div>
                  <div className="sm:col-span-1 text-right pt-3">
                    {configDraft.components.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfigDraft((prev) => ({
                            ...prev,
                            components: prev.components.filter((_, i) => i !== idx),
                          }))
                        }
                        className="p-1.5 text-[#86222E] hover:bg-[#FAF0F2] rounded-[6px] transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Grading Boundaries & Ranking Policy */}
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-sm text-[#2A2A2E]">
                  Configurable Grading Boundaries & Ranking Policy
                </h3>
                <p className="text-xs text-[#5E5B56]">
                  Customize percentage thresholds, grade labels, remarks, and tie-breaking policy
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setConfigDraft((prev) => ({
                    ...prev,
                    gradingScale: [
                      ...prev.gradingScale,
                      { grade: 'P', minScore: 0, maxScore: 39, remark: 'Pass' },
                    ],
                  }))
                }
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] text-xs font-medium transition-colors duration-150"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Grade Row
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
              {configDraft.gradingScale.map((g, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-[10px] bg-[#FAF8F4] border border-[#E6DFD3] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      value={g.grade}
                      onChange={(e) => {
                        const v = e.target.value;
                        setConfigDraft((prev) => ({
                          ...prev,
                          gradingScale: prev.gradingScale.map((row, i) =>
                            i === idx ? { ...row, grade: v } : row
                          ),
                        }));
                      }}
                      className="w-16 px-2 py-1 border border-[#DDD5C7] rounded-[6px] font-mono font-semibold bg-white text-[#2A2A2E]"
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={g.minScore}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0;
                        setConfigDraft((prev) => ({
                          ...prev,
                          gradingScale: prev.gradingScale.map((row, i) =>
                            i === idx ? { ...row, minScore: v } : row
                          ),
                        }));
                      }}
                      className="w-16 px-2 py-1 border border-[#DDD5C7] rounded-[6px] font-mono bg-white text-[#2A2A2E]"
                    />
                    <span className="text-[#5E5B56]">–</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={g.maxScore}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0;
                        setConfigDraft((prev) => ({
                          ...prev,
                          gradingScale: prev.gradingScale.map((row, i) =>
                            i === idx ? { ...row, maxScore: v } : row
                          ),
                        }));
                      }}
                      className="w-16 px-2 py-1 border border-[#DDD5C7] rounded-[6px] font-mono bg-white text-[#2A2A2E]"
                    />
                    {configDraft.gradingScale.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfigDraft((prev) => ({
                            ...prev,
                            gradingScale: prev.gradingScale.filter((_, i) => i !== idx),
                          }))
                        }
                        className="text-[#86222E] hover:bg-[#FAF0F2] rounded p-1 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={g.remark}
                    placeholder="Remark (e.g. Excellent)"
                    onChange={(e) => {
                      const v = e.target.value;
                      setConfigDraft((prev) => ({
                        ...prev,
                        gradingScale: prev.gradingScale.map((row, i) =>
                          i === idx ? { ...row, remark: v } : row
                        ),
                      }));
                    }}
                    className="w-full px-2.5 py-1 border border-[#DDD5C7] rounded-[6px] bg-white text-[#2A2A2E]"
                  />
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-[#EFE9DF] grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs items-center">
              <div>
                <label className="block font-medium text-[#2A2A2E] mb-1">
                  Class Position Ranking Policy
                </label>
                <select
                  value={configDraft.rankingPolicy}
                  onChange={(e) =>
                    setConfigDraft((prev) => ({
                      ...prev,
                      rankingPolicy: e.target.value as RankingPolicy,
                    }))
                  }
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                >
                  <option value="standard_competition">
                    Standard Competition Ranking (1, 2, 2, 4) — Ties share rank, next skips
                  </option>
                  <option value="dense">
                    Dense Ranking (1, 2, 2, 3) — Ties share rank, next increments by 1
                  </option>
                </select>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium shadow-xs disabled:opacity-50 transition-colors duration-150"
                >
                  <Save className="w-4 h-4" />
                  {isSavingConfig ? 'Saving Configuration...' : 'Save Grading & Assessment Rules'}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* ==================== MODAL: CREATE / EDIT CLASS & SUBJECTS ==================== */}
      {isClassModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-[10px] max-w-2xl w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] my-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#EFE9DF]">
              <h3 className="font-semibold text-base text-[#2A2A2E]">
                {classForm.id ? 'Edit Class & Assigned Subjects' : 'Create New Class'}
              </h3>
              <button
                onClick={() => setIsClassModalOpen(false)}
                className="p-1 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveClass} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Section *</label>
                  <select
                    value={classForm.section}
                    onChange={(e) => {
                      const nextSection = e.target.value as SchoolSection;
                      const sectionLevels = LEVELS_BY_SECTION[nextSection] || NIGERIAN_LEVELS_LIST;
                      setClassForm({
                        ...classForm,
                        section: nextSection,
                        level: sectionLevels.includes(classForm.level)
                          ? classForm.level
                          : sectionLevels[0] || classForm.level,
                      });
                    }}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  >
                    <option value="" disabled>
                      -- Select Section --
                    </option>
                    {SECTIONS.map((sec) => (
                      <option key={sec} value={sec}>
                        {SECTION_LABELS[sec]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Class Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Creche, Nursery 1, Primary 3, JSS 1A, SS 2B"
                    value={classForm.name}
                    onChange={(e) => setClassForm({ ...classForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Level *</label>
                  {!useCustomClassLevel ? (
                    <select
                      required
                      value={
                        (LEVELS_BY_SECTION[classForm.section] || NIGERIAN_LEVELS_LIST).includes(
                          classForm.level
                        )
                          ? classForm.level
                          : ''
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '__custom__') {
                          setUseCustomClassLevel(true);
                          setClassForm({ ...classForm, level: '' });
                        } else {
                          setClassForm({ ...classForm, level: val });
                        }
                      }}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                    >
                      <option value="">-- Select Level --</option>
                      {(LEVELS_BY_SECTION[classForm.section] || NIGERIAN_LEVELS_LIST).map((lvl) => (
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
                        placeholder="e.g. Primary 2"
                        value={classForm.level}
                        onChange={(e) => setClassForm({ ...classForm, level: e.target.value })}
                        className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setUseCustomClassLevel(false);
                          const sectionLevels =
                            LEVELS_BY_SECTION[classForm.section] || NIGERIAN_LEVELS_LIST;
                          if (!sectionLevels.includes(classForm.level)) {
                            setClassForm({ ...classForm, level: sectionLevels[0] || 'Primary 1' });
                          }
                        }}
                        className="px-2 py-1 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium shrink-0"
                      >
                        List
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Arm / Stream</label>
                  <input
                    type="text"
                    placeholder="e.g. Standard, Arm A, Arm B"
                    value={classForm.arm}
                    onChange={(e) => setClassForm({ ...classForm, arm: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">
                    Classroom Location
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Block A, Room 2"
                    value={classForm.roomNumber}
                    onChange={(e) => setClassForm({ ...classForm, roomNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">
                    Max Class Capacity
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={classForm.capacity}
                    onChange={(e) =>
                      setClassForm({ ...classForm, capacity: Number(e.target.value) || 30 })
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#FAF8F4] p-3 rounded-[10px] border border-[#E6DFD3]">
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">
                    Form Teacher&apos;s Full Name (Manual Entry)
                  </label>
                  <input
                    type="text"
                    placeholder="Type any Form Teacher name (e.g. Mrs. Grace Okafor)"
                    value={classForm.formTeacherName}
                    onChange={(e) =>
                      setClassForm({
                        ...classForm,
                        formTeacherName: e.target.value,
                        formTeacherId: '',
                      })
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">
                    Or Quick-Pick Registered Staff (Optional)
                  </label>
                  <select
                    value={classForm.formTeacherId}
                    onChange={(e) => {
                      const chosenId = e.target.value;
                      const chosen = teachersList.find((t) => t.id === chosenId);
                      setClassForm({
                        ...classForm,
                        formTeacherId: chosenId,
                        formTeacherName: chosen ? chosen.fullName : classForm.formTeacherName,
                      });
                    }}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  >
                    <option value="">-- Optional: Pick from staff list --</option>
                    {teachersList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.fullName} ({t.staffId})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">
                    Class Notes (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Optional notes about room or schedule..."
                    value={classForm.notes}
                    onChange={(e) => setClassForm({ ...classForm, notes: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
                <label className="flex items-center gap-2 pt-4 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={classForm.isActive}
                    onChange={(e) => setClassForm({ ...classForm, isActive: e.target.checked })}
                    className="w-4 h-4 rounded border-[#DDD5C7] accent-[#6B1020]"
                  />
                  <span className="font-medium text-[#2A2A2E]">
                    Class is Active (visible in enrolment & score entry dropdowns)
                  </span>
                </label>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="font-medium text-[#2A2A2E]">
                    Assigned Subjects ({classForm.subjects.length})
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      aria-label="Add subject from curriculum"
                      value={selectedClassSubjectOption}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val && !classForm.subjects.includes(val)) {
                          setClassForm((prev) => ({
                            ...prev,
                            subjects: [...prev.subjects, val],
                          }));
                        }
                        setSelectedClassSubjectOption('');
                      }}
                      className="px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[11px] font-medium text-[#2A2A2E]"
                    >
                      <option value="">-- Choose subject to assign --</option>
                      {NIGERIAN_SUBJECTS_LIST.filter((s) => !classForm.subjects.includes(s)).map(
                        (sub) => (
                          <option key={sub} value={sub}>
                            {sub}
                          </option>
                        )
                      )}
                    </select>
                    <input
                      type="text"
                      placeholder="Custom subject..."
                      value={customClassSubject}
                      onChange={(e) => setCustomClassSubject(e.target.value)}
                      className="px-2.5 py-1.5 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-[11px] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const v = customClassSubject.trim();
                        if (v && !classForm.subjects.includes(v)) {
                          setClassForm((prev) => ({
                            ...prev,
                            subjects: [...prev.subjects, v],
                          }));
                        }
                        setCustomClassSubject('');
                      }}
                      className="px-2.5 py-1.5 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium text-[11px] transition-colors duration-150"
                    >
                      Add
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-3 rounded-[10px] bg-[#FAF8F4] border border-[#E6DFD3]">
                  {Array.from(new Set([...NIGERIAN_SUBJECTS_LIST, ...classForm.subjects])).map(
                    (sub) => {
                      const active = classForm.subjects.includes(sub);
                      return (
                        <button
                          key={sub}
                          type="button"
                          onClick={() =>
                            setClassForm((prev) => ({
                              ...prev,
                              subjects: prev.subjects.includes(sub)
                                ? prev.subjects.filter((s) => s !== sub)
                                : [...prev.subjects, sub],
                            }))
                          }
                          className={`px-2.5 py-1 rounded-[8px] text-[11px] font-medium border transition-colors duration-150 ${
                            active
                              ? 'bg-[#6B1020] text-white border-[#6B1020]'
                              : 'bg-white text-[#2A2A2E] border-[#DDD5C7] hover:bg-[#FAF8F4]'
                          }`}
                        >
                          {sub}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#EFE9DF]">
                <button
                  type="button"
                  onClick={() => setIsClassModalOpen(false)}
                  className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium transition-colors duration-150"
                >
                  Save Class
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: REVIEW, COMMENTS & APPROVAL ==================== */}
      {reviewModalResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs">
          <div className="bg-white rounded-[10px] max-w-lg w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#EFE9DF]">
              <div>
                <h3 className="font-semibold text-base text-[#2A2A2E]">
                  Result Review & Comments
                </h3>
                <p className="text-xs text-[#5E5B56]">
                  {reviewModalResult.student.fullName} ({reviewModalResult.student.admissionNo}) •
                  Avg: {reviewModalResult.averagePercentage}% • Pos:{' '}
                  {formatOrdinal(reviewModalResult.position)}
                </p>
              </div>
              <button
                onClick={() => setReviewModalResult(null)}
                className="p-1 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStudentReview} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-[#2A2A2E] mb-1">
                  Form / Class Teacher&apos;s Comment
                </label>
                <textarea
                  rows={3}
                  value={teacherCommentInput}
                  onChange={(e) => setTeacherCommentInput(e.target.value)}
                  placeholder="Enter authentic teacher comment based on student's term performance..."
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                />
              </div>

              {isAdmin && (
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">
                    Principal&apos;s Comment
                  </label>
                  <textarea
                    rows={3}
                    value={principalCommentInput}
                    onChange={(e) => setPrincipalCommentInput(e.target.value)}
                    placeholder="Enter Principal's official remark..."
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block font-medium text-[#2A2A2E] mb-1">
                  Approval Workflow Status
                </label>
                <select
                  value={reviewStatusInput}
                  onChange={(e) => setReviewStatusInput(e.target.value as any)}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-medium text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                >
                  <option value="Draft">Draft</option>
                  <option value="Submitted for Review">Submitted for Review</option>
                  {isAdmin && <option value="Approved">Approved (Official Release)</option>}
                  {isAdmin && (
                    <option value="Returned for Correction">Returned for Correction</option>
                  )}
                </select>
              </div>

              {isAdmin && reviewStatusInput === 'Returned for Correction' && (
                <div>
                  <label className="block font-medium text-[#86222E] mb-1">
                    Correction Note for Teacher
                  </label>
                  <input
                    type="text"
                    value={returnNoteInput}
                    onChange={(e) => setReturnNoteInput(e.target.value)}
                    placeholder="Specify what needs to be checked..."
                    className="w-full px-3 py-2 border border-[#E2C1C5] rounded-[8px] bg-[#FAF0F2] text-[#2A2A2E] focus:ring-2 focus:ring-[#86222E]/20 focus:outline-none"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-[#EFE9DF]">
                <button
                  type="button"
                  onClick={() => setReviewModalResult(null)}
                  className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingReview}
                  className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                >
                  {isSavingReview ? 'Saving...' : 'Save Review & Comments'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unsaved Score Changes Confirmation Modal */}
      {unsavedPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs no-print">
          <div className="bg-white rounded-[10px] max-w-md w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#EFE9DF]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[10px] bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6] flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-[#2A2A2E]">Unsaved Score Changes</h3>
                  <p className="text-xs text-[#5E5B56]">Changes have not been saved to Firestore</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUnsavedPrompt(null)}
                className="p-1 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-[#2A2A2E] leading-relaxed">
                You have unsaved score changes in the following subject
                {unsavedPrompt.subjects.length > 1 ? 's' : ''}:
              </p>
              <div className="flex flex-wrap gap-1.5 bg-[#FBF5E8] p-3 rounded-[10px] border border-[#E3CFA6]">
                {unsavedPrompt.subjects.map((sub) => (
                  <span
                    key={sub}
                    className="px-2.5 py-0.5 rounded-full bg-white border border-[#E3CFA6] text-[#7D5A18] font-medium text-[11px]"
                  >
                    {sub}
                  </span>
                ))}
              </div>
              <p className="text-[#86222E] font-medium">
                If you leave now without saving, these unsaved score changes will be lost.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 text-xs">
              <button
                type="button"
                onClick={() => setUnsavedPrompt(null)}
                className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium transition-colors duration-150"
              >
                Stay & Keep Editing
              </button>
              <button
                type="button"
                onClick={unsavedPrompt.onConfirm}
                className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF0F2] hover:text-[#86222E] hover:border-[#E2C1C5] text-[#2A2A2E] font-medium border border-[#DDD5C7] transition-colors duration-150"
              >
                Discard & Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: PUBLISH SELECTED REPORT CARDS ==================== */}
      {isAdmin && isPublishSelectedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs no-print">
          <div className="bg-white rounded-[10px] max-w-2xl w-full shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 bg-[#FAF8F4] border-b border-[#E6DFD3] flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-base text-[#2A2A2E] flex items-center gap-2">
                  <Globe className="w-4 h-4 text-[#6B1020]" />
                  Publish Selected Report Cards — {selectedClass}
                </h3>
                <p className="text-xs text-[#5E5B56] mt-0.5">
                  {selectedTerm} • {selectedSession} • Only Approved report cards can be selected for publishing.
                </p>
              </div>
              <button
                type="button"
                disabled={isPublishingReport}
                onClick={() => setIsPublishSelectedModalOpen(false)}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#EFE9DF]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-3 border-b border-[#EFE9DF] flex flex-wrap items-center justify-between gap-2 text-xs bg-white">
              <span className="font-medium text-[#5E5B56]">
                {publishSelectedStudentIds.length} of {classPublishSummary.approved} Approved student
                {classPublishSummary.approved === 1 ? '' : 's'} selected
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setPublishSelectedStudentIds(
                      computedClassResults
                        .filter((r) => r.review?.status === 'Approved')
                        .map((r) => r.student.id)
                    )
                  }
                  className="font-semibold text-[#6B1020] hover:underline"
                >
                  Select All Approved
                </button>
                <button
                  type="button"
                  onClick={() => setPublishSelectedStudentIds([])}
                  className="font-medium text-[#5E5B56] hover:underline"
                >
                  Clear Selection
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2 text-xs">
              {computedClassResults.map((res) => {
                const isApproved = res.review?.status === 'Approved';
                const reportId = buildPublishedReportId(selectedSession, selectedTerm, res.student.id);
                const snap = publishedSnapshotsByReportId.get(reportId);
                const isAlreadyPub = Boolean(snap?.isPublished);
                const clearance = feeClearanceByStudentId.get(res.student.id);
                const checked = publishSelectedStudentIds.includes(res.student.id);

                return (
                  <label
                    key={res.student.id}
                    className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-[8px] border transition-colors ${
                      !isApproved
                        ? 'bg-[#FAF8F4]/70 border-[#E6DFD3] opacity-65 cursor-not-allowed'
                        : checked
                          ? 'bg-[#FAF0F2]/60 border-[#DFC7CA] cursor-pointer'
                          : 'bg-white border-[#E6DFD3] hover:bg-[#FAF8F4] cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        disabled={!isApproved || isPublishingReport}
                        checked={checked}
                        onChange={() => {
                          if (!isApproved) return;
                          setPublishSelectedStudentIds((prev) =>
                            prev.includes(res.student.id)
                              ? prev.filter((id) => id !== res.student.id)
                              : [...prev, res.student.id]
                          );
                        }}
                        className="w-4 h-4 accent-[#6B1020] shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-[#2A2A2E] truncate">
                          {res.student.fullName}
                        </p>
                        <p className="text-[11px] text-[#6E6A63] font-mono">
                          {res.student.admissionNo} • Avg:{' '}
                          {res.subjectsCount > 0 ? `${res.averagePercentage}%` : '—'} •{' '}
                          {res.student.guardianEmail || 'No parent email'}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {schoolSettings.requireFullFeesBeforePublishReport &&
                        clearance &&
                        !clearance.cleared && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
                            Fees Unpaid
                          </span>
                        )}
                      {isAlreadyPub ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#6B1020] text-[#DFC484]">
                          Published (Will Republish)
                        </span>
                      ) : isApproved ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB]">
                          Approved • Ready
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FAF8F4] text-[#5E5B56] border border-[#DDD5C7]">
                          {res.review?.status || 'Draft'} (Approve first)
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="px-6 py-4 bg-[#FAF8F4] border-t border-[#E6DFD3] flex flex-wrap items-center justify-end gap-2 text-xs">
              <button
                type="button"
                disabled={isPublishingReport}
                onClick={() => setIsPublishSelectedModalOpen(false)}
                className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPublishingReport || publishSelectedStudentIds.length === 0}
                onClick={handleConfirmPublishSelected}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#2A583B] hover:bg-[#20452E] text-white font-medium disabled:opacity-50"
              >
                <Globe className="w-3.5 h-3.5" />
                {isPublishingReport
                  ? 'Publishing...'
                  : `Publish ${publishSelectedStudentIds.length} Selected Report${publishSelectedStudentIds.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: CONFIRM PUBLISH WHOLE CLASS ==================== */}
      {isAdmin && isPublishClassConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs no-print">
          <div className="bg-white rounded-[10px] max-w-md w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#EFE9DF]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[10px] bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB] flex items-center justify-center shrink-0">
                  <Globe className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-[#2A2A2E]">
                    Publish Whole Class to Parents
                  </h3>
                  <p className="text-xs text-[#5E5B56]">
                    {selectedClass} • {selectedTerm} ({selectedSession})
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isPublishingReport}
                onClick={() => setIsPublishClassConfirmOpen(false)}
                className="p-1 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-[#2A2A2E]">
              <p className="leading-relaxed">
                This will save frozen official report card snapshots for all{' '}
                <strong>{classPublishSummary.approved} Approved</strong> student
                {classPublishSummary.approved === 1 ? '' : 's'} in{' '}
                <strong>{selectedClass}</strong> (updating any already-published reports).
              </p>

              {classPublishSummary.draftOrPending > 0 && (
                <div className="p-3 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6] text-[#7D5A18] flex items-start gap-2">
                  <Clock className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>{classPublishSummary.draftOrPending}</strong> unapproved (Draft / Pending) student
                    {classPublishSummary.draftOrPending === 1 ? '' : 's'} will be skipped automatically.
                  </span>
                </div>
              )}

              {schoolSettings.requireFullFeesBeforePublishReport && (
                <div className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-[#5E5B56]">
                  Fee-gating setting is active: students with unpaid school fees will have their report card withheld in the Parent Portal until fees are settled.
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 text-xs">
              <button
                type="button"
                disabled={isPublishingReport}
                onClick={() => setIsPublishClassConfirmOpen(false)}
                className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPublishingReport || classPublishSummary.approved === 0}
                onClick={handleConfirmPublishWholeClass}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#2A583B] hover:bg-[#20452E] text-white font-medium disabled:opacity-50"
              >
                <Globe className="w-3.5 h-3.5" />
                {isPublishingReport
                  ? 'Publishing Class...'
                  : `Confirm Publish (${classPublishSummary.approved})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: REPORT PUBLISH AUDIT LOG ==================== */}
      {isAdmin && isPublishAuditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs no-print">
          <div className="bg-white rounded-[10px] max-w-3xl w-full shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-6 py-4 bg-[#FAF8F4] border-b border-[#E6DFD3] flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-base text-[#2A2A2E] flex items-center gap-2">
                  <History className="w-4 h-4 text-[#6B1020]" />
                  Report Card Publishing Audit Log
                </h3>
                <p className="text-xs text-[#5E5B56] mt-0.5">
                  Permanent record of who published, republished, or unpublished student report cards
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPublishAuditModalOpen(false)}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#EFE9DF]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {publishAuditLogs.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#7F7A72]">
                  No report card publish, republish, or unpublish events recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto border border-[#E6DFD3] rounded-[8px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase text-[#5E5B56]">
                        <th className="py-2.5 px-3">Date &amp; Time</th>
                        <th className="py-2.5 px-3">Action</th>
                        <th className="py-2.5 px-3">Student</th>
                        <th className="py-2.5 px-3">Class / Term</th>
                        <th className="py-2.5 px-3">Performed By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFE9DF]">
                      {publishAuditLogs.slice(0, 100).map((log) => (
                        <tr key={log.id} className="hover:bg-[#FAF8F4]">
                          <td className="py-2.5 px-3 text-[11px] text-[#5E5B56] whitespace-nowrap tabular-nums">
                            {new Date(log.performedAt).toLocaleString('en-NG', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${
                                log.action === 'published'
                                  ? 'bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB]'
                                  : log.action === 'republished'
                                    ? 'bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]'
                                    : 'bg-[#FAF0F2] text-[#86222E] border border-[#E2C1C5]'
                              }`}
                            >
                              {log.action}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-semibold text-[#2A2A2E] block">
                              {log.studentName}
                            </span>
                            <span className="text-[10px] font-mono text-[#6E6A63]">
                              {log.admissionNo}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-[#5E5B56]">
                            <span className="font-medium text-[#2A2A2E] block">
                              {log.className}
                            </span>
                            <span className="text-[11px]">
                              {log.term} ({log.session})
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-medium text-[#2A2A2E] block">
                              {log.performedBy}
                            </span>
                            <span className="text-[10px] uppercase text-[#6E6A63]">
                              {log.performedByRole}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="px-6 py-3 bg-[#FAF8F4] border-t border-[#E6DFD3] flex justify-end text-xs">
              <button
                type="button"
                onClick={() => setIsPublishAuditModalOpen(false)}
                className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: DIRECTOR "TEST AS PARENT" CHECK ==================== */}
      {isDirector && isTestAsParentModalOpen && (() => {
        const normalizedTestEmail = testParentEmailInput.trim().toLowerCase();
        const matchingStudents = normalizedTestEmail
          ? studentsList
              .filter((s) => (s.guardianEmail || '').trim().toLowerCase() === normalizedTestEmail)
              .sort((a, b) => a.fullName.localeCompare(b.fullName))
          : [];
        const matchingSnapshots = normalizedTestEmail
          ? publishedReports
              .filter(
                (r) =>
                  r.isPublished === true &&
                  (r.guardianEmail || '').trim().toLowerCase() === normalizedTestEmail
              )
              .sort((a, b) => {
                const sCmp = b.session.localeCompare(a.session);
                if (sCmp !== 0) return sCmp;
                return (b.publishedAt || '').localeCompare(a.publishedAt || '');
              })
          : [];

        const matchedStudentIds = new Set(matchingStudents.map((s) => s.id));
        const orphanSnapshots = matchingSnapshots.filter((snap) => !matchedStudentIds.has(snap.studentId));
        const quickSampleEmails = Array.from(
          new Set(
            activeStudentsInClass
              .map((s) => (s.guardianEmail || '').trim().toLowerCase())
              .filter(Boolean)
          )
        ).slice(0, 6);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs no-print">
            <div className="bg-white rounded-[10px] max-w-4xl w-full shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] flex flex-col max-h-[88vh] overflow-hidden">
              <div className="px-6 py-4 bg-[#FAF8F4] border-b border-[#E6DFD3] flex items-center justify-between gap-3 shrink-0">
                <div>
                  <h3 className="font-semibold text-base text-[#2A2A2E] flex items-center gap-2">
                    <Eye className="w-4 h-4 text-[#6B1020]" />
                    Test as Parent — Access Check
                  </h3>
                  <p className="text-xs text-[#5E5B56] mt-0.5">
                    Enter any Parent Google Email to preview which children and published report cards that account would see.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTestParentPreviewSnapshot(null);
                    setIsTestAsParentModalOpen(false);
                  }}
                  className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#EFE9DF]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 border-b border-[#EFE9DF] space-y-2.5 bg-white shrink-0">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Mail className="w-4 h-4 text-[#7F7A72] absolute left-3 top-2.5" />
                    <input
                      type="email"
                      value={testParentEmailInput}
                      onChange={(e) => {
                        setTestParentEmailInput(e.target.value);
                        setTestParentPreviewSnapshot(null);
                      }}
                      placeholder="Type parent email (e.g. parent@gmail.com)..."
                      className="w-full pl-9 pr-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] focus:bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>
                  {testParentEmailInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setTestParentEmailInput('');
                        setTestParentPreviewSnapshot(null);
                      }}
                      className="px-3 py-2 rounded-[8px] border border-[#DDD5C7] bg-white hover:bg-[#FAF8F4] text-xs font-medium text-[#5E5B56]"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {quickSampleEmails.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-[#6E6A63] font-medium">
                      Parent emails in {selectedClass}:
                    </span>
                    {quickSampleEmails.map((em) => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => {
                          setTestParentEmailInput(em);
                          setTestParentPreviewSnapshot(null);
                        }}
                        className={`px-2 py-0.5 rounded-full border font-mono transition-colors ${
                          normalizedTestEmail === em
                            ? 'bg-[#6B1020] text-white border-[#6B1020]'
                            : 'bg-[#FAF8F4] text-[#2A2A2E] border-[#E6DFD3] hover:border-[#6B1020]/50'
                        }`}
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-5 bg-[#F7F4EF]/60">
                {testParentPreviewSnapshot ? (
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => setTestParentPreviewSnapshot(null)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-xs font-medium text-[#2A2A2E]"
                    >
                      <ArrowLeft className="w-3.5 h-3.5 text-[#6B1020]" />
                      Back to Matched Children
                    </button>
                    <PublishedReportSnapshotCard
                      snapshot={testParentPreviewSnapshot}
                      schoolSettings={schoolSettings}
                    />
                  </div>
                ) : !normalizedTestEmail ? (
                  <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-8 text-center text-xs text-[#6E6A63]">
                    Enter a parent&apos;s Google email address above or pick one from {selectedClass} to check matched student profiles and published report cards.
                  </div>
                ) : matchingStudents.length === 0 && orphanSnapshots.length === 0 ? (
                  <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-8 text-center space-y-2">
                    <p className="font-serif text-base font-semibold text-[#2A2A2E]">
                      No students are linked to this email
                    </p>
                    <p className="text-xs text-[#5E5B56]">
                      No student record or published snapshot has <span className="font-mono text-[#6B1020]">{normalizedTestEmail}</span> as Parent Email.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[#2A2A2E]">
                        Matched for <span className="font-mono text-[#6B1020]">{normalizedTestEmail}</span>:
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB] font-medium text-[11px]">
                        {matchingStudents.length} Child{matchingStudents.length === 1 ? '' : 'ren'} •{' '}
                        {matchingSnapshots.length} Published Report{matchingSnapshots.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    {matchingStudents.map((child) => {
                      const childSnaps = matchingSnapshots.filter((r) => r.studentId === child.id);
                      const hasCaseMismatch =
                        (child.guardianEmail || '') !== normalizedTestEmail;

                      return (
                        <div
                          key={child.id}
                          className="bg-white rounded-[10px] border border-[#E6DFD3] overflow-hidden"
                        >
                          <div className="p-4 bg-[#FAF8F4] border-b border-[#E6DFD3] flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              {child.passportPhoto ? (
                                <img
                                  src={child.passportPhoto}
                                  alt={child.fullName}
                                  className="w-11 h-13 rounded-[8px] object-cover border border-[#DDD5C7]"
                                />
                              ) : (
                                <div className="w-11 h-13 rounded-[8px] bg-[#6B1020] text-[#DFC484] flex items-center justify-center font-semibold text-sm">
                                  {child.fullName.charAt(0)}
                                </div>
                              )}
                              <div>
                                <p className="font-semibold text-sm text-[#2A2A2E]">
                                  {child.fullName}
                                </p>
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#5E5B56] mt-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA] font-medium">
                                    <GraduationCap className="w-3 h-3" />
                                    {child.className}
                                  </span>
                                  <span className="font-mono">{child.admissionNo}</span>
                                </div>
                                {hasCaseMismatch && (
                                  <p className="text-[11px] text-[#7D5A18] mt-1">
                                    Warning: stored Parent Email &ldquo;{child.guardianEmail}&rdquo; has uppercase/whitespace characters. Edit and re-save student to normalize it to &ldquo;{normalizedTestEmail}&rdquo;.
                                  </p>
                                )}
                              </div>
                            </div>

                            <span className="text-[11px] font-medium px-2.5 py-1 rounded-[6px] bg-white border border-[#E6DFD3] text-[#2A2A2E]">
                              {childSnaps.length} Published Report{childSnaps.length === 1 ? '' : 's'}
                            </span>
                          </div>

                          <div className="p-4">
                            {childSnaps.length === 0 ? (
                              <p className="text-xs text-[#6E6A63] italic">
                                No published report cards available for this child yet.
                              </p>
                            ) : (
                              <div className="divide-y divide-[#EFE9DF] border border-[#E6DFD3] rounded-[8px]">
                                {childSnaps.map((snap) => {
                                  const clearance = computeStudentFeeClearance({
                                    student: child,
                                    session: snap.session,
                                    term: snap.term,
                                    studentFees,
                                    feePayments,
                                  });
                                  const isWithheld =
                                    schoolSettings.requireFullFeesBeforePublishReport === true &&
                                    !clearance.cleared;

                                  return (
                                    <div
                                      key={snap.id}
                                      className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                                    >
                                      <div>
                                        <p className="font-semibold text-[#2A2A2E]">
                                          {snap.session} • {snap.term} ({snap.className})
                                        </p>
                                        <p className="text-[11px] text-[#5E5B56] mt-0.5">
                                          Published: {formatShortPublishDate(snap.publishedAt)} • Avg:{' '}
                                          <strong>{snap.averagePercentage}%</strong> • Grade:{' '}
                                          <strong className="font-mono">{snap.overallGrade}</strong>
                                          {snap.position
                                            ? ` • Pos: ${formatOrdinal(snap.position)}/${snap.totalRankedStudents}`
                                            : ''}
                                        </p>
                                        {isWithheld && (
                                          <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded bg-[#FBF5E8] border border-[#E3CFA6] text-[#7D5A18] text-[10px] font-medium">
                                            <Lock className="w-3 h-3" />
                                            Withheld in Parent View (Outstanding Fees: ₦
                                            {clearance.outstanding.toLocaleString('en-NG')})
                                          </span>
                                        )}
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => setTestParentPreviewSnapshot(snap)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-[11px] font-medium"
                                      >
                                        <Eye className="w-3.5 h-3.5" />
                                        Preview Read-Only Report
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {orphanSnapshots.length > 0 && (
                      <div className="bg-white rounded-[10px] border border-[#E3CFA6] p-4 space-y-2 text-xs">
                        <p className="font-semibold text-[#7D5A18]">
                          Published Snapshots Matched by Email (Student Record Not Matched):
                        </p>
                        {orphanSnapshots.map((snap) => (
                          <div
                            key={snap.id}
                            className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3]"
                          >
                            <span>
                              <strong>{snap.studentName}</strong> ({snap.className}) — {snap.session} •{' '}
                              {snap.term}
                            </span>
                            <button
                              type="button"
                              onClick={() => setTestParentPreviewSnapshot(snap)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-[#6B1020] text-white text-[11px] font-medium"
                            >
                              Preview Report
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="px-6 py-3 bg-[#FAF8F4] border-t border-[#E6DFD3] flex justify-end text-xs shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setTestParentPreviewSnapshot(null);
                    setIsTestAsParentModalOpen(false);
                  }}
                  className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
