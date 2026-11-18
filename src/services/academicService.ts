import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import { fitDimensionsInsideBox, loadImageForPdf } from './brandingService';
import {
  AcademicConfig,
  AcademicRecord,
  AcademicSession,
  AcademicTerm,
  AttendanceRecord,
  GradeBoundary,
  HeadTeacherTitle,
  ResultApprovalStatus,
  SchoolClass,
  SchoolSetting,
  Student,
  StudentResultReview,
  SubjectTeacherAssignment,
  Teacher,
  UserProfile,
  UserRole,
} from '../types';
import {
  DEFAULT_ACADEMIC_CONFIG,
  DEFAULT_ACADEMIC_SESSION,
  DEFAULT_SCHOOL_CLASSES,
} from '../data/sampleData';
import { extractFriendlyError } from './schoolService';
import { computeAttendanceSummary, AttendanceSummaryStats } from './attendanceService';
import {
  isPrimary6Class,
  isPrimary6ClassName,
  resolveClassSection,
  sortClassesByStructure,
} from '../utils/classUtils';

function stripUndefined<T extends Record<string, any>>(obj: T): Record<string, any> {
  const cleaned: Record<string, any> = {};
  Object.keys(obj).forEach((key) => {
    if (obj[key] !== undefined) {
      cleaned[key] = obj[key];
    }
  });
  return cleaned;
}

export function sanitizeAcademicIdPart(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

export function buildAcademicRecordId(
  session: string,
  term: AcademicTerm,
  className: string,
  subject: string,
  studentId: string
): string {
  const raw = `acad_${sanitizeAcademicIdPart(session)}_${sanitizeAcademicIdPart(term)}_${sanitizeAcademicIdPart(className)}_${sanitizeAcademicIdPart(subject)}_${sanitizeAcademicIdPart(studentId)}`;
  return raw.slice(0, 128);
}

export function buildResultReviewId(
  session: string,
  term: AcademicTerm,
  className: string,
  studentId: string
): string {
  const raw = `rev_${sanitizeAcademicIdPart(session)}_${sanitizeAcademicIdPart(term)}_${sanitizeAcademicIdPart(className)}_${sanitizeAcademicIdPart(studentId)}`;
  return raw.slice(0, 128);
}

export function buildSubjectAssignmentId(className: string, subject: string): string {
  const raw = `asgn_${sanitizeAcademicIdPart(className)}_${sanitizeAcademicIdPart(subject)}`;
  return raw.slice(0, 128);
}

// Compute grade & remark using configurable school grading boundaries
export function computeGradeFromConfig(
  percentage: number,
  gradingScale: GradeBoundary[]
): { grade: string; remark: string } {
  const rounded = Math.round(percentage);
  const sorted = [...gradingScale].sort((a, b) => b.minScore - a.minScore);
  const matched = sorted.find((b) => rounded >= b.minScore && rounded <= b.maxScore) ||
    sorted.find((b) => rounded >= b.minScore) ||
    sorted[sorted.length - 1];

  return matched
    ? { grade: matched.grade, remark: matched.remark }
    : { grade: 'F9', remark: 'Fail' };
}

export function formatOrdinal(n: number | null | undefined): string {
  if (!n || n <= 0) return '—';
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// ==================== SUBSCRIPTIONS ====================

export function subscribeAcademicSessions(
  onData: (sessions: AcademicSession[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'academicSessions'),
    (snap) => {
      if (snap.empty) {
        onData([DEFAULT_ACADEMIC_SESSION]);
        return;
      }
      const list = snap.docs.map((d) => ({ ...(d.data() as AcademicSession), id: d.id }));
      list.sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.name.localeCompare(a.name));
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'academicSessions');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load academic sessions.'));
      }
    }
  );
}

export function subscribeClasses(
  onData: (
    classes: SchoolClass[],
    isSeededInFirestore: boolean,
    missingStandardCount?: number
  ) => void,
  onError: (msg: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'classes'),
    (snap) => {
      if (snap.empty) {
        onData(
          sortClassesByStructure(DEFAULT_SCHOOL_CLASSES),
          false,
          DEFAULT_SCHOOL_CLASSES.length
        );
        return;
      }
      const firestoreList = snap.docs
        .map((d) => {
          const raw = { ...(d.data() as SchoolClass), id: d.id };
          return {
            ...raw,
            section: resolveClassSection(raw),
          };
        })
        .filter((cls) => !isPrimary6Class(cls));
      const existingIds = new Set(firestoreList.map((c) => c.id));
      const existingNames = new Set(firestoreList.map((c) => c.name.trim().toLowerCase()));
      const missingDefaults = DEFAULT_SCHOOL_CLASSES.filter(
        (std) => !existingIds.has(std.id) && !existingNames.has(std.name.trim().toLowerCase())
      );
      onData(
        sortClassesByStructure([...firestoreList, ...missingDefaults]),
        true,
        missingDefaults.length
      );
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'classes');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load classes.'));
      }
    }
  );
}

export function subscribeAcademicConfig(
  onData: (config: AcademicConfig) => void,
  onError: (msg: string) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'academicConfig', 'default'),
    (snap) => {
      if (!snap.exists()) {
        onData(DEFAULT_ACADEMIC_CONFIG);
        return;
      }
      onData({ ...(snap.data() as AcademicConfig), id: snap.id });
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, 'academicConfig/default');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load academic configuration.'));
      }
    }
  );
}

export function subscribeSubjectAssignments(
  onData: (assignments: SubjectTeacherAssignment[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'subjectAssignments'),
    (snap) => {
      const list = snap.docs.map((d) => ({
        ...(d.data() as SubjectTeacherAssignment),
        id: d.id,
      }));
      list.sort((a, b) => a.className.localeCompare(b.className) || a.subject.localeCompare(b.subject));
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'subjectAssignments');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load subject-teacher assignments.'));
      }
    }
  );
}

export function subscribeAcademicRecords(
  role: UserRole,
  currentUser: UserProfile | null,
  authEmail: string | null | undefined,
  onData: (records: AcademicRecord[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const colRef = collection(db, 'academics');

  if (role === 'teacher') {
    const classes = (currentUser?.assignedClasses || []).filter(Boolean);
    if (classes.length === 0) {
      onData([]);
      return () => {};
    }
    const q = query(colRef, where('className', 'in', classes.slice(0, 10)));
    return onSnapshot(
      q,
      (snap) => {
        onData(snap.docs.map((d) => ({ ...(d.data() as AcademicRecord), id: d.id })));
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'academics');
        } catch (w) {
          onError(extractFriendlyError(w, 'Failed to load class academic scores.'));
        }
      }
    );
  }

  if (role === 'parent') {
    const parentEmail = (authEmail || currentUser?.email || '').trim().toLowerCase();
    const linkedIds = (currentUser?.linkedStudentIds || []).filter(Boolean);

    if (parentEmail) {
      const q = query(
        colRef,
        where('guardianEmail', '==', parentEmail),
        where('isApproved', '==', true)
      );
      return onSnapshot(
        q,
        (snap) => {
          onData(snap.docs.map((d) => ({ ...(d.data() as AcademicRecord), id: d.id })));
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'academics');
          } catch (w) {
            onError(extractFriendlyError(w, 'Failed to load ward academic results.'));
          }
        }
      );
    }

    if (linkedIds.length > 0) {
      const q = query(
        colRef,
        where('studentId', 'in', linkedIds.slice(0, 10)),
        where('isApproved', '==', true)
      );
      return onSnapshot(
        q,
        (snap) => {
          onData(snap.docs.map((d) => ({ ...(d.data() as AcademicRecord), id: d.id })));
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'academics');
          } catch (w) {
            onError(extractFriendlyError(w, 'Failed to load ward academic results.'));
          }
        }
      );
    }

    onData([]);
    return () => {};
  }

  return onSnapshot(
    colRef,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as AcademicRecord), id: d.id })));
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'academics');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load academic records.'));
      }
    }
  );
}

export function subscribeResultReviews(
  role: UserRole,
  currentUser: UserProfile | null,
  authEmail: string | null | undefined,
  onData: (reviews: StudentResultReview[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const colRef = collection(db, 'resultReviews');

  if (role === 'teacher') {
    const classes = (currentUser?.assignedClasses || []).filter(Boolean);
    if (classes.length === 0) {
      onData([]);
      return () => {};
    }
    const q = query(colRef, where('className', 'in', classes.slice(0, 10)));
    return onSnapshot(
      q,
      (snap) => {
        onData(snap.docs.map((d) => ({ ...(d.data() as StudentResultReview), id: d.id })));
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'resultReviews');
        } catch (w) {
          onError(extractFriendlyError(w, 'Failed to load result reviews.'));
        }
      }
    );
  }

  if (role === 'parent') {
    const parentEmail = (authEmail || currentUser?.email || '').trim().toLowerCase();
    const linkedIds = (currentUser?.linkedStudentIds || []).filter(Boolean);
    if (parentEmail) {
      const q = query(
        colRef,
        where('guardianEmail', '==', parentEmail),
        where('status', '==', 'Approved')
      );
      return onSnapshot(
        q,
        (snap) => {
          onData(snap.docs.map((d) => ({ ...(d.data() as StudentResultReview), id: d.id })));
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'resultReviews');
          } catch (w) {
            onError(extractFriendlyError(w, 'Failed to load result approval status.'));
          }
        }
      );
    }
    if (linkedIds.length > 0) {
      const q = query(
        colRef,
        where('studentId', 'in', linkedIds.slice(0, 10)),
        where('status', '==', 'Approved')
      );
      return onSnapshot(
        q,
        (snap) => {
          onData(snap.docs.map((d) => ({ ...(d.data() as StudentResultReview), id: d.id })));
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'resultReviews');
          } catch (w) {
            onError(extractFriendlyError(w, 'Failed to load result approval status.'));
          }
        }
      );
    }
    onData([]);
    return () => {};
  }

  return onSnapshot(
    colRef,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as StudentResultReview), id: d.id })));
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'resultReviews');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load result reviews.'));
      }
    }
  );
}

// ==================== FIRESTORE MUTATIONS ====================

export async function saveAcademicSessionToFirestore(
  session: AcademicSession,
  allSessions: AcademicSession[]
): Promise<void> {
  const now = new Date().toISOString();
  const docId = session.id || `sess-${sanitizeAcademicIdPart(session.name)}`;
  try {
    const batch = writeBatch(db);
    if (session.isActive) {
      allSessions.forEach((s) => {
        if (s.id !== docId && s.isActive) {
          batch.set(
            doc(db, 'academicSessions', s.id),
            stripUndefined({ ...s, isActive: false, updatedAt: now })
          );
        }
      });
    }
    batch.set(
      doc(db, 'academicSessions', docId),
      stripUndefined({
        ...session,
        id: docId,
        createdAt: session.createdAt || now,
        updatedAt: now,
      })
    );
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `academicSessions/${docId}`);
  }
}

export async function saveClassToFirestore(
  cls: SchoolClass,
  options?: {
    existingClasses?: SchoolClass[];
    previousName?: string;
  }
): Promise<SchoolClass> {
  const now = new Date().toISOString();
  const trimmedName = cls.name.trim();
  if (!trimmedName) {
    throw new Error('Class name is required.');
  }

  // Check for duplicate class names across Firestore or passed list
  let pool = options?.existingClasses;
  if (!pool) {
    try {
      const snap = await getDocs(collection(db, 'classes'));
      pool = snap.docs.map((d) => ({ ...(d.data() as SchoolClass), id: d.id }));
    } catch {
      pool = [];
    }
  }

  const normalizedName = trimmedName.toLowerCase();
  const duplicate = pool.find(
    (c) => c.id !== cls.id && c.name.trim().toLowerCase() === normalizedName
  );
  if (duplicate) {
    throw new Error(`A class named "${duplicate.name}" already exists. Class names must be unique.`);
  }

  const docId =
    cls.id && cls.id.trim()
      ? cls.id.trim()
      : `cls_${sanitizeAcademicIdPart(trimmedName).toLowerCase()}_${Date.now().toString(36)}`;

  const payload: SchoolClass = {
    ...cls,
    id: docId,
    name: trimmedName,
    section: resolveClassSection({ name: trimmedName, section: cls.section }),
    level: cls.level.trim() || trimmedName,
    arm: (cls.arm ?? '').trim() || 'Standard',
    formTeacherName: (cls.formTeacherName || '').trim() || 'Unassigned',
    formTeacherId: (cls.formTeacherId || '').trim(),
    capacity: Math.max(1, Math.min(500, Math.round(Number(cls.capacity) || 30))),
    totalStudents: Math.max(0, Number(cls.totalStudents) || 0),
    roomNumber: (cls.roomNumber || '').trim() || 'Main Block',
    subjects: Array.from(
      new Set((cls.subjects || []).map((s) => s.trim()).filter(Boolean))
    ),
    isActive: cls.isActive !== false,
    sortOrder: typeof cls.sortOrder === 'number' ? cls.sortOrder : 500,
    notes: (cls.notes || '').trim(),
    createdAt: cls.createdAt || now,
    updatedAt: now,
  };

  try {
    await setDoc(doc(db, 'classes', docId), stripUndefined(payload));

    // Propagate class name changes safely to active linked records without touching immutable historical snapshots
    const prevName = options?.previousName?.trim();
    if (prevName && prevName !== trimmedName) {
      const ops: Array<{ ref: ReturnType<typeof doc>; data: Record<string, any> }> = [];

      const [stuByIdSnap, stuByNameSnap, assignSnap, schedSnap, ttSnap, tchSnap] =
        await Promise.all([
          getDocs(query(collection(db, 'students'), where('classId', '==', docId))),
          getDocs(query(collection(db, 'students'), where('className', '==', prevName))),
          getDocs(query(collection(db, 'subjectAssignments'), where('className', '==', prevName))),
          getDocs(query(collection(db, 'feeSchedules'), where('className', '==', prevName))),
          getDocs(query(collection(db, 'timetable'), where('className', '==', prevName))),
          getDocs(
            query(collection(db, 'teachers'), where('assignedClasses', 'array-contains', prevName))
          ),
        ]);

      const seenStudentIds = new Set<string>();
      [...stuByIdSnap.docs, ...stuByNameSnap.docs].forEach((d) => {
        if (!seenStudentIds.has(d.id)) {
          seenStudentIds.add(d.id);
          ops.push({
            ref: d.ref,
            data: { classId: docId, className: trimmedName, updatedAt: now },
          });
        }
      });

      assignSnap.forEach((d) => {
        ops.push({ ref: d.ref, data: { className: trimmedName, updatedAt: now } });
      });
      schedSnap.forEach((d) => {
        ops.push({ ref: d.ref, data: { className: trimmedName, updatedAt: now } });
      });
      ttSnap.forEach((d) => {
        ops.push({ ref: d.ref, data: { className: trimmedName } });
      });
      tchSnap.forEach((d) => {
        const data = d.data() as Teacher;
        const nextClasses = Array.from(
          new Set((data.assignedClasses || []).map((c) => (c === prevName ? trimmedName : c)))
        );
        ops.push({ ref: d.ref, data: { assignedClasses: nextClasses, updatedAt: now } });
      });

      const CHUNK_SIZE = 400;
      for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
        const batch = writeBatch(db);
        ops.slice(i, i + CHUNK_SIZE).forEach((op) => batch.update(op.ref, op.data));
        await batch.commit();
      }
    }

    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `classes/${docId}`);
  }
}

export async function toggleClassActiveStatusInFirestore(
  classId: string,
  isActive: boolean
): Promise<void> {
  try {
    await updateDoc(doc(db, 'classes', classId), {
      isActive,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `classes/${classId}`);
  }
}

export async function getClassDependencyCounts(cls: SchoolClass): Promise<{
  studentsCount: number;
  academicsCount: number;
  attendanceCount: number;
  feesCount: number;
}> {
  try {
    const [stuIdSnap, stuNameSnap, acadSnap, attSnap, feeSnap] = await Promise.all([
      getDocs(query(collection(db, 'students'), where('classId', '==', cls.id))),
      getDocs(query(collection(db, 'students'), where('className', '==', cls.name))),
      getDocs(query(collection(db, 'academics'), where('className', '==', cls.name))),
      getDocs(query(collection(db, 'attendance'), where('className', '==', cls.name))),
      getDocs(query(collection(db, 'studentFees'), where('className', '==', cls.name))),
    ]);

    const uniqueStudents = new Set<string>();
    stuIdSnap.forEach((d) => uniqueStudents.add(d.id));
    stuNameSnap.forEach((d) => uniqueStudents.add(d.id));

    return {
      studentsCount: uniqueStudents.size,
      academicsCount: acadSnap.size,
      attendanceCount: attSnap.size,
      feesCount: feeSnap.size,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `classes/${cls.id}`);
  }
}

export async function deleteClassSafelyFromFirestore(cls: SchoolClass): Promise<void> {
  const deps = await getClassDependencyCounts(cls);
  if (
    deps.studentsCount > 0 ||
    deps.academicsCount > 0 ||
    deps.attendanceCount > 0 ||
    deps.feesCount > 0
  ) {
    const parts: string[] = [];
    if (deps.studentsCount > 0) parts.push(`${deps.studentsCount} pupil record(s)`);
    if (deps.academicsCount > 0) parts.push(`${deps.academicsCount} academic score(s)`);
    if (deps.attendanceCount > 0) parts.push(`${deps.attendanceCount} attendance log(s)`);
    if (deps.feesCount > 0) parts.push(`${deps.feesCount} fee record(s)`);
    throw new Error(
      `Cannot delete "${cls.name}" because it has linked data (${parts.join(', ')}). Reassign pupils or deactivate/archive this class instead.`
    );
  }

  try {
    await deleteDoc(doc(db, 'classes', cls.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `classes/${cls.id}`);
  }
}

export async function migrateClassStudentsInFirestore(params: {
  sourceClass: SchoolClass;
  targetClass: SchoolClass;
  deactivateSource?: boolean;
}): Promise<{ migratedCount: number }> {
  const { sourceClass, targetClass, deactivateSource = true } = params;
  if (sourceClass.id === targetClass.id) {
    throw new Error('Source and destination classes must be different.');
  }

  try {
    const [byIdSnap, byNameSnap] = await Promise.all([
      getDocs(query(collection(db, 'students'), where('classId', '==', sourceClass.id))),
      getDocs(query(collection(db, 'students'), where('className', '==', sourceClass.name))),
    ]);

    const seen = new Map<string, ReturnType<typeof doc>>();
    byIdSnap.forEach((d) => seen.set(d.id, d.ref));
    byNameSnap.forEach((d) => seen.set(d.id, d.ref));

    const now = new Date().toISOString();
    const refs = Array.from(seen.values());
    const CHUNK_SIZE = 400;

    for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      refs.slice(i, i + CHUNK_SIZE).forEach((ref) => {
        batch.update(ref, {
          classId: targetClass.id,
          className: targetClass.name,
          updatedAt: now,
        });
      });
      await batch.commit();
    }

    if (deactivateSource) {
      await updateDoc(doc(db, 'classes', sourceClass.id), {
        isActive: false,
        totalStudents: 0,
        updatedAt: now,
      });
    }

    return { migratedCount: refs.length };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `classes/${sourceClass.id}`);
  }
}

export interface Primary6DependencySummary {
  hasClassDoc: boolean;
  classDocs: SchoolClass[];
  studentsCount: number;
  academicsCount: number;
  resultReviewsCount: number;
  attendanceCount: number;
  feesCount: number;
  feeSchedulesCount: number;
  subjectAssignmentsCount: number;
  teachersCount: number;
  staffInvitesCount: number;
  timetableCount: number;
  hasFormTeacher: boolean;
  formTeacherNames: string[];
  affectedTeacherNames: string[];
  hasAnyAffectedData: boolean;
  needsDirectorAttention: boolean;
}

export async function inspectPrimary6Dependencies(): Promise<Primary6DependencySummary> {
  const classesSnap = await getDocs(collection(db, 'classes'));
  const classDocs = classesSnap.docs
    .map((d) => ({ ...(d.data() as SchoolClass), id: d.id }))
    .filter((c) => isPrimary6Class(c));

  const classNamesToMatch = Array.from(
    new Set(['Primary 6', ...classDocs.map((c) => c.name.trim()).filter(Boolean)])
  );
  const classIdsToMatch = Array.from(
    new Set(['cls-primary-6', ...classDocs.map((c) => c.id)])
  );

  const safeQuery = async (promise: Promise<Awaited<ReturnType<typeof getDocs>>>) => {
    try {
      return await promise;
    } catch {
      return null;
    }
  };

  const [
    stuByNameSnaps,
    stuByIdSnaps,
    acadSnap,
    revSnap,
    attSnap,
    feeSnap,
    schedSnap,
    subjSnap,
    ttSnap,
    teachersSnap,
    usersSnap,
    invitesSnap,
  ] = await Promise.all([
    Promise.all(
      classNamesToMatch.map((name) =>
        safeQuery(getDocs(query(collection(db, 'students'), where('className', '==', name))))
      )
    ),
    Promise.all(
      classIdsToMatch.map((id) =>
        safeQuery(getDocs(query(collection(db, 'students'), where('classId', '==', id))))
      )
    ),
    safeQuery(
      getDocs(query(collection(db, 'academics'), where('className', 'in', classNamesToMatch)))
    ),
    safeQuery(
      getDocs(query(collection(db, 'resultReviews'), where('className', 'in', classNamesToMatch)))
    ),
    safeQuery(
      getDocs(query(collection(db, 'attendance'), where('className', 'in', classNamesToMatch)))
    ),
    safeQuery(
      getDocs(query(collection(db, 'studentFees'), where('className', 'in', classNamesToMatch)))
    ),
    safeQuery(
      getDocs(query(collection(db, 'feeSchedules'), where('className', 'in', classNamesToMatch)))
    ),
    safeQuery(
      getDocs(
        query(collection(db, 'subjectAssignments'), where('className', 'in', classNamesToMatch))
      )
    ),
    safeQuery(
      getDocs(query(collection(db, 'timetable'), where('className', 'in', classNamesToMatch)))
    ),
    safeQuery(getDocs(collection(db, 'teachers'))),
    safeQuery(getDocs(collection(db, 'users'))),
    safeQuery(getDocs(collection(db, 'staffInvites'))),
  ]);

  const studentIds = new Set<string>();
  stuByNameSnaps.forEach((snap) => snap?.forEach((d) => studentIds.add(d.id)));
  stuByIdSnaps.forEach((snap) => snap?.forEach((d) => studentIds.add(d.id)));

  const formTeacherNames = Array.from(
    new Set(
      classDocs
        .map((c) => (c.formTeacherName || '').trim())
        .filter((name) => name && name.toLowerCase() !== 'unassigned')
    )
  );
  const hasFormTeacher = formTeacherNames.length > 0;

  const affectedTeacherKeys = new Set<string>();
  const affectedTeacherNamesSet = new Set<string>(formTeacherNames);

  teachersSnap?.forEach((d) => {
    const t = d.data() as Teacher;
    if ((t.assignedClasses || []).some((clsName) => isPrimary6ClassName(clsName))) {
      affectedTeacherKeys.add(`teacher:${d.id}`);
      if (t.fullName) affectedTeacherNamesSet.add(t.fullName);
    }
  });

  usersSnap?.forEach((d) => {
    const u = d.data() as UserProfile;
    if ((u.assignedClasses || []).some((clsName) => isPrimary6ClassName(clsName))) {
      affectedTeacherKeys.add(`user:${d.id}`);
      if (u.displayName) affectedTeacherNamesSet.add(u.displayName);
    }
  });

  let staffInvitesCount = 0;
  invitesSnap?.forEach((d) => {
    const inv = d.data() as { assignedClasses?: string[]; displayName?: string };
    if ((inv.assignedClasses || []).some((clsName) => isPrimary6ClassName(clsName))) {
      staffInvitesCount += 1;
      if (inv.displayName) affectedTeacherNamesSet.add(inv.displayName);
    }
  });

  const subjectAssignmentsCount = subjSnap?.size ?? 0;
  subjSnap?.forEach((d) => {
    const asgn = d.data() as SubjectTeacherAssignment;
    if (asgn.teacherName) affectedTeacherNamesSet.add(asgn.teacherName);
  });

  const studentsCount = studentIds.size;
  const academicsCount = acadSnap?.size ?? 0;
  const resultReviewsCount = revSnap?.size ?? 0;
  const attendanceCount = attSnap?.size ?? 0;
  const feesCount = feeSnap?.size ?? 0;
  const feeSchedulesCount = schedSnap?.size ?? 0;
  const timetableCount = ttSnap?.size ?? 0;
  const teachersCount = affectedTeacherKeys.size;

  const hasAnyAffectedData =
    studentsCount > 0 ||
    academicsCount > 0 ||
    resultReviewsCount > 0 ||
    attendanceCount > 0 ||
    feesCount > 0 ||
    feeSchedulesCount > 0 ||
    subjectAssignmentsCount > 0 ||
    teachersCount > 0 ||
    staffInvitesCount > 0 ||
    timetableCount > 0 ||
    hasFormTeacher;

  const needsDirectorAttention = classDocs.length > 0
    ? hasAnyAffectedData
    : studentsCount > 0 ||
      teachersCount > 0 ||
      subjectAssignmentsCount > 0 ||
      staffInvitesCount > 0 ||
      timetableCount > 0 ||
      feeSchedulesCount > 0;

  return {
    hasClassDoc: classDocs.length > 0,
    classDocs,
    studentsCount,
    academicsCount,
    resultReviewsCount,
    attendanceCount,
    feesCount,
    feeSchedulesCount,
    subjectAssignmentsCount,
    teachersCount,
    staffInvitesCount,
    timetableCount,
    hasFormTeacher,
    formTeacherNames,
    affectedTeacherNames: Array.from(affectedTeacherNamesSet),
    hasAnyAffectedData,
    needsDirectorAttention,
  };
}

export async function reconcilePrimary6Removal(
  canDeleteEmptyClass: boolean
): Promise<Primary6DependencySummary> {
  const summary = await inspectPrimary6Dependencies();

  // Only delete Primary 6 automatically when it has zero linked records of any kind.
  if (summary.hasClassDoc && !summary.hasAnyAffectedData && canDeleteEmptyClass) {
    await Promise.all(
      summary.classDocs.map((clsDoc) => deleteDoc(doc(db, 'classes', clsDoc.id)))
    );
    return {
      ...summary,
      hasClassDoc: false,
      classDocs: [],
      needsDirectorAttention: false,
    };
  }

  return summary;
}

export async function migratePrimary6StudentsToClass(
  targetClass: SchoolClass
): Promise<{ migratedCount: number }> {
  if (isPrimary6Class(targetClass)) {
    throw new Error('Cannot move pupils into Primary 6.');
  }

  const classesSnap = await getDocs(collection(db, 'classes'));
  const classDocs = classesSnap.docs
    .map((d) => ({ ...(d.data() as SchoolClass), id: d.id }))
    .filter((c) => isPrimary6Class(c));

  const classNamesToMatch = Array.from(
    new Set(['Primary 6', ...classDocs.map((c) => c.name.trim()).filter(Boolean)])
  );
  const classIdsToMatch = Array.from(
    new Set(['cls-primary-6', ...classDocs.map((c) => c.id)])
  );

  const [byNameSnaps, byIdSnaps] = await Promise.all([
    Promise.all(
      classNamesToMatch.map((name) =>
        getDocs(query(collection(db, 'students'), where('className', '==', name)))
      )
    ),
    Promise.all(
      classIdsToMatch.map((id) =>
        getDocs(query(collection(db, 'students'), where('classId', '==', id)))
      )
    ),
  ]);

  const seen = new Map<string, ReturnType<typeof doc>>();
  byNameSnaps.forEach((snap) => snap.forEach((d) => seen.set(d.id, d.ref)));
  byIdSnaps.forEach((snap) => snap.forEach((d) => seen.set(d.id, d.ref)));

  const now = new Date().toISOString();
  const refs = Array.from(seen.values());
  const CHUNK_SIZE = 400;

  for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    refs.slice(i, i + CHUNK_SIZE).forEach((ref) => {
      batch.update(ref, {
        classId: targetClass.id,
        className: targetClass.name,
        updatedAt: now,
      });
    });
    await batch.commit();
  }

  return { migratedCount: refs.length };
}

export async function removePrimary6ClassAndAssignments(): Promise<void> {
  const summary = await inspectPrimary6Dependencies();
  if (summary.studentsCount > 0) {
    throw new Error(
      `Primary 6 still has ${summary.studentsCount} enrolled pupil(s). Move those pupils to another class before removing Primary 6.`
    );
  }

  const classNamesToMatch = Array.from(
    new Set(['Primary 6', ...summary.classDocs.map((c) => c.name.trim()).filter(Boolean)])
  );

  const [subjSnap, ttSnap, schedSnap, teachersSnap, usersSnap, invitesSnap] = await Promise.all([
    getDocs(query(collection(db, 'subjectAssignments'), where('className', 'in', classNamesToMatch))),
    getDocs(query(collection(db, 'timetable'), where('className', 'in', classNamesToMatch))),
    getDocs(query(collection(db, 'feeSchedules'), where('className', 'in', classNamesToMatch))),
    getDocs(collection(db, 'teachers')),
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'staffInvites')),
  ]);

  const now = new Date().toISOString();
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  summary.classDocs.forEach((c) => {
    ops.push((batch) => batch.delete(doc(db, 'classes', c.id)));
  });

  subjSnap.forEach((d) => ops.push((batch) => batch.delete(d.ref)));
  ttSnap.forEach((d) => ops.push((batch) => batch.delete(d.ref)));
  schedSnap.forEach((d) => ops.push((batch) => batch.delete(d.ref)));

  teachersSnap.forEach((d) => {
    const t = d.data() as Teacher;
    if ((t.assignedClasses || []).some((clsName) => isPrimary6ClassName(clsName))) {
      ops.push((batch) =>
        batch.update(d.ref, {
          assignedClasses: (t.assignedClasses || []).filter((c) => !isPrimary6ClassName(c)),
          updatedAt: now,
        })
      );
    }
  });

  usersSnap.forEach((d) => {
    const u = d.data() as UserProfile;
    if ((u.assignedClasses || []).some((clsName) => isPrimary6ClassName(clsName))) {
      ops.push((batch) =>
        batch.update(d.ref, {
          assignedClasses: (u.assignedClasses || []).filter((c) => !isPrimary6ClassName(c)),
          updatedAt: now,
        })
      );
    }
  });

  invitesSnap.forEach((d) => {
    const inv = d.data() as { assignedClasses?: string[] };
    if ((inv.assignedClasses || []).some((clsName) => isPrimary6ClassName(clsName))) {
      ops.push((batch) =>
        batch.update(d.ref, {
          assignedClasses: (inv.assignedClasses || []).filter((c) => !isPrimary6ClassName(c)),
          updatedAt: now,
        })
      );
    }
  });

  const CHUNK_SIZE = 400;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    ops.slice(i, i + CHUNK_SIZE).forEach((applyOp) => applyOp(batch));
    await batch.commit();
  }
}

export async function syncStandardClassesToFirestore(
  existingClasses?: SchoolClass[]
): Promise<{ addedCount: number; updatedCount: number; skippedCount: number }> {
  const now = new Date().toISOString();
  try {
    let current = existingClasses;
    if (!current) {
      const snap = await getDocs(collection(db, 'classes'));
      current = snap.docs.map((d) => ({ ...(d.data() as SchoolClass), id: d.id }));
    }

    const existingIds = new Set(current.map((c) => c.id));
    const existingNames = new Set(current.map((c) => c.name.trim().toLowerCase()));
    const standardById = new Map(DEFAULT_SCHOOL_CLASSES.map((c) => [c.id, c]));
    const standardByName = new Map(
      DEFAULT_SCHOOL_CLASSES.map((c) => [c.name.trim().toLowerCase(), c])
    );

    const batch = writeBatch(db);
    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    // Repair section field on any existing standard class document in Firestore (e.g. Primary 1 -> Primary)
    current.forEach((cls) => {
      const stdCls =
        standardByName.get(cls.name.trim().toLowerCase()) || standardById.get(cls.id);
      if (!stdCls) return;
      const canonicalSection = stdCls.section || resolveClassSection(cls);
      if (cls.section !== canonicalSection) {
        const updates: Record<string, any> = {
          section: canonicalSection,
          updatedAt: now,
        };
        if (!cls.level || !cls.level.trim()) {
          updates.level = stdCls.level;
        }
        if (cls.arm === undefined || cls.arm === null) {
          updates.arm = stdCls.arm;
        }
        if (typeof cls.capacity !== 'number' || cls.capacity <= 0) {
          updates.capacity = stdCls.capacity;
        }
        batch.update(doc(db, 'classes', cls.id), updates);
        updatedCount += 1;
      }
    });

    DEFAULT_SCHOOL_CLASSES.forEach((stdCls) => {
      const exists =
        existingIds.has(stdCls.id) || existingNames.has(stdCls.name.trim().toLowerCase());
      if (exists) {
        skippedCount += 1;
        return;
      }
      batch.set(
        doc(db, 'classes', stdCls.id),
        stripUndefined({ ...stdCls, createdAt: now, updatedAt: now })
      );
      addedCount += 1;
    });

    if (addedCount > 0 || updatedCount > 0) {
      await batch.commit();
    }

    return { addedCount, updatedCount, skippedCount };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'classes');
  }
}

export async function seedDefaultClassesToFirestore(): Promise<void> {
  const now = new Date().toISOString();
  try {
    const batch = writeBatch(db);
    DEFAULT_SCHOOL_CLASSES.forEach((c) => {
      batch.set(
        doc(db, 'classes', c.id),
        stripUndefined({ ...c, createdAt: now, updatedAt: now })
      );
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'classes');
  }
}

export async function saveAcademicConfigToFirestore(
  config: AcademicConfig,
  updatedBy: string
): Promise<void> {
  try {
    await setDoc(
      doc(db, 'academicConfig', 'default'),
      stripUndefined({
        ...config,
        id: 'default',
        updatedBy,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'academicConfig/default');
  }
}

export async function saveSubjectAssignmentToFirestore(
  assignment: Omit<SubjectTeacherAssignment, 'id'>,
  teacherObj?: Teacher
): Promise<void> {
  const docId = buildSubjectAssignmentId(assignment.className, assignment.subject);
  const now = new Date().toISOString();
  try {
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'subjectAssignments', docId),
      stripUndefined({
        ...assignment,
        id: docId,
        updatedAt: now,
      })
    );

    if (teacherObj) {
      const updatedClasses = Array.from(
        new Set([...(teacherObj.assignedClasses || []), assignment.className])
      );
      const updatedSubjects = Array.from(
        new Set([...(teacherObj.subjects || []), assignment.subject])
      );
      batch.update(doc(db, 'teachers', teacherObj.id), {
        assignedClasses: updatedClasses,
        subjects: updatedSubjects,
        updatedAt: now,
      });
    }

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `subjectAssignments/${docId}`);
  }
}

export async function removeSubjectAssignmentFromFirestore(assignmentId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'subjectAssignments', assignmentId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `subjectAssignments/${assignmentId}`);
  }
}

export interface ScoreBatchEntry {
  student: Student;
  componentScores: Record<string, number>;
  remark?: string;
}

export async function saveSubjectScoresBatchToFirestore(params: {
  session: string;
  term: AcademicTerm;
  className: string;
  subject: string;
  config: AcademicConfig;
  entries: ScoreBatchEntry[];
  enteredBy: string;
  callerRole?: UserRole;
}): Promise<AcademicRecord[]> {
  const { session, term, className, subject, config, entries, enteredBy, callerRole } = params;

  const maxTotal = config.components.reduce((acc, c) => acc + c.maxMark, 0);
  if (maxTotal <= 0) {
    throw new Error('Assessment configuration must have a positive total maximum mark.');
  }

  // Strict validation against configured maximum marks
  for (const entry of entries) {
    for (const comp of config.components) {
      const val = entry.componentScores[comp.key] ?? 0;
      if (Number.isNaN(val) || val < 0) {
        throw new Error(
          `Invalid mark for ${entry.student.fullName} (${comp.label}): score cannot be negative.`
        );
      }
      if (val > comp.maxMark) {
        throw new Error(
          `Score Exceeds Maximum: ${entry.student.fullName} has ${val} in ${comp.label}, which exceeds the maximum allowed mark of ${comp.maxMark}.`
        );
      }
    }
  }

  // Only Principal/Director can preserve an existing Approved flag when editing scores;
  // Teachers always save with isApproved: false so edits require Principal approval.
  const approvedStudentIds = new Set<string>();
  if (callerRole === 'director' || callerRole === 'principal') {
    try {
      const revSnap = await getDocs(
        query(
          collection(db, 'resultReviews'),
          where('className', '==', className),
          where('session', '==', session),
          where('term', '==', term),
          where('status', '==', 'Approved')
        )
      );
      revSnap.forEach((d) => {
        const data = d.data() as StudentResultReview;
        if (data.studentId) approvedStudentIds.add(data.studentId);
      });
    } catch {
      // Fallback safely to false if review status lookup fails
    }
  }

  const now = new Date().toISOString();
  const batch = writeBatch(db);
  const saved: AcademicRecord[] = [];

  entries.forEach((entry) => {
    const docId = buildAcademicRecordId(session, term, className, subject, entry.student.id);
    const total = config.components.reduce(
      (sum, c) => sum + (Number(entry.componentScores[c.key]) || 0),
      0
    );
    const percentage = Math.round((total / maxTotal) * 1000) / 10;
    const { grade, remark: gradeRemark } = computeGradeFromConfig(
      percentage,
      config.gradingScale
    );

    const ca1 = Number(entry.componentScores['ca1'] ?? 0);
    const ca2 = Number(entry.componentScores['ca2'] ?? 0);
    const examComp = config.components.find((c) => c.isExam || c.key === 'exam');
    const exam = examComp ? Number(entry.componentScores[examComp.key] ?? 0) : 0;

    const record: AcademicRecord = {
      id: docId,
      studentId: entry.student.id,
      studentName: entry.student.fullName,
      admissionNo: entry.student.admissionNo,
      guardianEmail: (entry.student.guardianEmail || '').trim().toLowerCase(),
      className,
      term,
      session,
      subject,
      ca1,
      ca2,
      exam,
      componentScores: entry.componentScores,
      total,
      maxTotal,
      percentage,
      grade,
      remark: entry.remark?.trim() || gradeRemark,
      enteredBy,
      isApproved: approvedStudentIds.has(entry.student.id),
      updatedAt: now,
    };

    batch.set(doc(db, 'academics', docId), stripUndefined(record));
    saved.push(record);
  });

  try {
    await batch.commit();
    return saved;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'academics');
  }
}

export async function saveMultipleSubjectsScoresBatchToFirestore(params: {
  session: string;
  term: AcademicTerm;
  className: string;
  subjectBatches: Array<{
    subject: string;
    entries: ScoreBatchEntry[];
  }>;
  config: AcademicConfig;
  enteredBy: string;
  callerRole?: UserRole;
}): Promise<{ saved: AcademicRecord[]; savedSubjects: string[] }> {
  const { session, term, className, subjectBatches, config, enteredBy, callerRole } = params;

  const maxTotal = config.components.reduce((acc, c) => acc + c.maxMark, 0);
  if (maxTotal <= 0) {
    throw new Error('Assessment configuration must have a positive total maximum mark.');
  }

  // Strict validation across all selected subjects before any Firestore write
  for (const sb of subjectBatches) {
    for (const entry of sb.entries) {
      for (const comp of config.components) {
        const val = entry.componentScores[comp.key] ?? 0;
        if (Number.isNaN(val) || val < 0) {
          throw new Error(
            `Invalid mark for ${entry.student.fullName} in ${sb.subject} (${comp.label}): score cannot be negative.`
          );
        }
        if (val > comp.maxMark) {
          throw new Error(
            `Score Exceeds Maximum: ${entry.student.fullName} has ${val} in ${sb.subject} (${comp.label}), which exceeds the maximum allowed mark of ${comp.maxMark}.`
          );
        }
      }
    }
  }

  // Query Approved result reviews once for this class/session/term
  const approvedStudentIds = new Set<string>();
  if (callerRole === 'director' || callerRole === 'principal') {
    try {
      const revSnap = await getDocs(
        query(
          collection(db, 'resultReviews'),
          where('className', '==', className),
          where('session', '==', session),
          where('term', '==', term),
          where('status', '==', 'Approved')
        )
      );
      revSnap.forEach((d) => {
        const data = d.data() as StudentResultReview;
        if (data.studentId) approvedStudentIds.add(data.studentId);
      });
    } catch {
      // Fallback safely to false if review status lookup fails
    }
  }

  const now = new Date().toISOString();
  const examComp = config.components.find((c) => c.isExam || c.key === 'exam');
  const recordsMap = new Map<string, AcademicRecord>();
  const savedSubjects: string[] = [];

  subjectBatches.forEach((sb) => {
    if (sb.entries.length === 0) return;
    savedSubjects.push(sb.subject);
    sb.entries.forEach((entry) => {
      const docId = buildAcademicRecordId(session, term, className, sb.subject, entry.student.id);
      const total = config.components.reduce(
        (sum, c) => sum + (Number(entry.componentScores[c.key]) || 0),
        0
      );
      const percentage = Math.round((total / maxTotal) * 1000) / 10;
      const { grade, remark: gradeRemark } = computeGradeFromConfig(
        percentage,
        config.gradingScale
      );

      const ca1 = Number(entry.componentScores['ca1'] ?? 0);
      const ca2 = Number(entry.componentScores['ca2'] ?? 0);
      const exam = examComp ? Number(entry.componentScores[examComp.key] ?? 0) : 0;

      const record: AcademicRecord = {
        id: docId,
        studentId: entry.student.id,
        studentName: entry.student.fullName,
        admissionNo: entry.student.admissionNo,
        guardianEmail: (entry.student.guardianEmail || '').trim().toLowerCase(),
        className,
        term,
        session,
        subject: sb.subject,
        ca1,
        ca2,
        exam,
        componentScores: entry.componentScores,
        total,
        maxTotal,
        percentage,
        grade,
        remark: entry.remark?.trim() || gradeRemark,
        enteredBy,
        isApproved: approvedStudentIds.has(entry.student.id),
        updatedAt: now,
      };

      recordsMap.set(docId, record);
    });
  });

  const saved = Array.from(recordsMap.values());
  if (saved.length === 0) {
    return { saved: [], savedSubjects: [] };
  }

  try {
    for (let i = 0; i < saved.length; i += 450) {
      const chunk = saved.slice(i, i + 450);
      const batch = writeBatch(db);
      chunk.forEach((record) => {
        batch.set(doc(db, 'academics', record.id), stripUndefined(record));
      });
      await batch.commit();
    }
    return { saved, savedSubjects };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'academics');
  }
}

export async function saveStudentResultReviewToFirestore(
  review: Omit<StudentResultReview, 'id'>,
  syncApproval = false
): Promise<void> {
  const docId = buildResultReviewId(
    review.session,
    review.term,
    review.className,
    review.studentId
  );
  const now = new Date().toISOString();
  const normalizedReview = {
    ...review,
    guardianEmail: (review.guardianEmail || '').trim().toLowerCase(),
    id: docId,
    updatedAt: now,
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'resultReviews', docId), stripUndefined(normalizedReview));

    if (syncApproval || review.status === 'Approved') {
      const nextApproved = review.status === 'Approved';
      const acadSnap = await getDocs(
        query(
          collection(db, 'academics'),
          where('studentId', '==', review.studentId),
          where('className', '==', review.className),
          where('session', '==', review.session),
          where('term', '==', review.term)
        )
      );
      acadSnap.forEach((d) => {
        batch.update(d.ref, {
          isApproved: nextApproved,
          updatedAt: now,
        });
      });
    }

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `resultReviews/${docId}`);
  }
}

export async function batchApproveClassResultsInFirestore(params: {
  students: Student[];
  existingReviews: StudentResultReview[];
  session: string;
  term: AcademicTerm;
  className: string;
  status: ResultApprovalStatus;
  actorName: string;
  returnNote?: string;
  syncApproval?: boolean;
}): Promise<void> {
  const {
    students,
    existingReviews,
    session,
    term,
    className,
    status,
    actorName,
    returnNote,
    syncApproval = status === 'Approved',
  } = params;
  if (students.length === 0) return;

  const now = new Date().toISOString();
  const reviewMap = new Map<string, StudentResultReview>();
  existingReviews.forEach((r) => {
    if (r.session === session && r.term === term && r.className === className) {
      reviewMap.set(r.studentId, r);
    }
  });

  const ops: Array<{ ref: ReturnType<typeof doc>; type: 'set' | 'update'; data: Record<string, any> }> = [];

  students.forEach((s) => {
    const existing = reviewMap.get(s.id);
    const docId = buildResultReviewId(session, term, className, s.id);
    const payload: StudentResultReview = {
      id: docId,
      studentId: s.id,
      studentName: s.fullName,
      admissionNo: s.admissionNo,
      guardianEmail: (s.guardianEmail || '').trim().toLowerCase(),
      className,
      term,
      session,
      status,
      teacherComment: existing?.teacherComment || '',
      teacherCommentBy: existing?.teacherCommentBy,
      teacherCommentAt: existing?.teacherCommentAt,
      headComment: existing?.headComment || '',
      headCommentBy: existing?.headCommentBy,
      headCommentTitle: existing?.headCommentTitle,
      headCommentAt: existing?.headCommentAt,
      headSignature: existing?.headSignature,
      principalComment: existing?.principalComment || '',
      principalCommentBy: existing?.principalCommentBy,
      principalCommentAt: existing?.principalCommentAt,
      principalSignature: existing?.principalSignature,
      reviewedBy: actorName,
      reviewedAt: now,
      approvedBy: status === 'Approved' ? actorName : existing?.approvedBy,
      approvedAt: status === 'Approved' ? now : existing?.approvedAt,
      returnNote: status === 'Returned for Correction' ? returnNote || '' : undefined,
      updatedAt: now,
    };
    ops.push({ ref: doc(db, 'resultReviews', docId), type: 'set', data: stripUndefined(payload) });
  });

  try {
    if (syncApproval) {
      const nextApproved = status === 'Approved';
      const studentIdSet = new Set(students.map((s) => s.id));
      const acadSnap = await getDocs(
        query(
          collection(db, 'academics'),
          where('className', '==', className),
          where('session', '==', session),
          where('term', '==', term)
        )
      );
      acadSnap.forEach((d) => {
        const rec = d.data() as AcademicRecord;
        if (studentIdSet.has(rec.studentId)) {
          ops.push({
            ref: d.ref,
            type: 'update',
            data: { isApproved: nextApproved, updatedAt: now },
          });
        }
      });
    }

    // Commit in safe Firestore batch chunks (< 500 ops per commit)
    const CHUNK_SIZE = 450;
    for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      const slice = ops.slice(i, i + CHUNK_SIZE);
      slice.forEach((op) => {
        if (op.type === 'set') batch.set(op.ref, op.data);
        else batch.update(op.ref, op.data);
      });
      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'resultReviews');
  }
}

export type ReportCommentBoxType = 'teacher' | 'head' | 'principal';

export const QUICK_REPORT_COMMENTS: Array<{
  category: 'Excellent' | 'Good' | 'Average' | 'Needs Improvement';
  items: string[];
}> = [
  {
    category: 'Excellent',
    items: [
      'An outstanding academic performance this term. Keep up your exemplary diligence and character.',
      'Brilliant results across subjects. Demonstrates strong leadership, focus, and admirable discipline.',
      'Consistently high achievement and active class participation. A true credit to the class.',
    ],
  },
  {
    category: 'Good',
    items: [
      'A very good result this term. With sustained effort and focus, even greater heights are within reach.',
      'Commendable progress and positive attitude toward learning. Keep striving for excellence.',
      'Good performance overall. Extra attention to weaker topics will further strengthen next term’s grade.',
    ],
  },
  {
    category: 'Average',
    items: [
      'A fair performance this term. Greater consistency with classwork, homework, and revision is encouraged.',
      'Shows potential to do much better. Improved concentration in class and regular study habits are advised.',
      'Satisfactory effort overall, though more dedication is needed to raise overall subject averages.',
    ],
  },
  {
    category: 'Needs Improvement',
    items: [
      'Performance is below expectation this term. Urgent improvement in study habits and attendance is required.',
      'Needs closer supervision with homework and daily revision. Extra support is strongly recommended.',
      'Requires stronger focus during lessons and timely completion of assignments to improve next term.',
    ],
  },
];

export async function saveReportCardCommentBoxToFirestore(params: {
  student: Student;
  session: string;
  term: AcademicTerm;
  className: string;
  boxType: ReportCommentBoxType;
  comment: string;
  authorName: string;
  headTitle?: HeadTeacherTitle;
  signatureDataUrl?: string;
  approveReport?: boolean;
}): Promise<StudentResultReview> {
  const {
    student,
    session,
    term,
    className,
    boxType,
    comment,
    authorName,
    headTitle = 'Headmaster',
    signatureDataUrl,
    approveReport = false,
  } = params;

  const docId = buildResultReviewId(session, term, className, student.id);
  const now = new Date().toISOString();
  const trimmedComment = comment.trim().slice(0, 300);
  const trimmedAuthor = authorName.trim().slice(0, 120);
  const trimmedSig =
    signatureDataUrl !== undefined ? signatureDataUrl.trim().slice(0, 350000) : undefined;

  const docRef = doc(db, 'resultReviews', docId);

  try {
    const existingSnap = await getDoc(docRef);
    const existingData = existingSnap.exists()
      ? (existingSnap.data() as StudentResultReview)
      : null;

    const patch: Record<string, any> = {
      updatedAt: now,
    };

    if (boxType === 'teacher') {
      patch.teacherComment = trimmedComment;
      patch.teacherCommentBy = trimmedAuthor;
      patch.teacherCommentAt = now;
    } else if (boxType === 'head') {
      patch.headComment = trimmedComment;
      patch.headCommentBy = trimmedAuthor;
      patch.headCommentTitle = headTitle;
      patch.headCommentAt = now;
      if (trimmedSig !== undefined) {
        patch.headSignature = trimmedSig;
      }
    } else {
      patch.principalComment = trimmedComment;
      patch.principalCommentBy = trimmedAuthor;
      patch.principalCommentAt = now;
      if (trimmedSig !== undefined) {
        patch.principalSignature = trimmedSig;
      }
      if (approveReport) {
        patch.status = 'Approved';
        patch.reviewedBy = trimmedAuthor;
        patch.reviewedAt = now;
        patch.approvedBy = trimmedAuthor;
        patch.approvedAt = now;
      }
    }

    if (existingSnap.exists()) {
      await updateDoc(docRef, stripUndefined(patch));
    } else {
      const initialDoc: StudentResultReview = {
        id: docId,
        studentId: student.id,
        studentName: student.fullName.slice(0, 150),
        admissionNo: student.admissionNo.slice(0, 30),
        guardianEmail: (student.guardianEmail || '').trim().toLowerCase(),
        className: className.slice(0, 60),
        term,
        session: session.slice(0, 40),
        status: boxType === 'principal' && approveReport ? 'Approved' : 'Draft',
        teacherComment: boxType === 'teacher' ? trimmedComment : '',
        principalComment: boxType === 'principal' ? trimmedComment : '',
        ...patch,
      };
      await setDoc(docRef, stripUndefined(initialDoc));
    }

    if (boxType === 'principal' && approveReport) {
      const acadSnap = await getDocs(
        query(
          collection(db, 'academics'),
          where('studentId', '==', student.id),
          where('className', '==', className),
          where('session', '==', session),
          where('term', '==', term)
        )
      );
      if (!acadSnap.empty) {
        const batch = writeBatch(db);
        acadSnap.forEach((d) => {
          batch.update(d.ref, { isApproved: true, updatedAt: now });
        });
        await batch.commit();
      }
    }

    return {
      ...(existingData || {
        id: docId,
        studentId: student.id,
        studentName: student.fullName,
        admissionNo: student.admissionNo,
        guardianEmail: (student.guardianEmail || '').trim().toLowerCase(),
        className,
        term,
        session,
        status: 'Draft',
        teacherComment: '',
        principalComment: '',
      }),
      ...patch,
    } as StudentResultReview;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `resultReviews/${docId}`);
  }
}

export async function copyReportCardCommentToStudentsInFirestore(params: {
  students: Student[];
  existingReviews: StudentResultReview[];
  session: string;
  term: AcademicTerm;
  className: string;
  boxType: ReportCommentBoxType;
  comment: string;
  authorName: string;
  headTitle?: HeadTeacherTitle;
  signatureDataUrl?: string;
}): Promise<number> {
  const {
    students,
    existingReviews,
    session,
    term,
    className,
    boxType,
    comment,
    authorName,
    headTitle = 'Headmaster',
    signatureDataUrl,
  } = params;

  if (students.length === 0) return 0;

  const now = new Date().toISOString();
  const trimmedComment = comment.trim().slice(0, 300);
  const trimmedAuthor = authorName.trim().slice(0, 120);
  const trimmedSig =
    signatureDataUrl !== undefined ? signatureDataUrl.trim().slice(0, 350000) : undefined;

  const existingMap = new Map<string, StudentResultReview>();
  existingReviews.forEach((r) => {
    if (r.session === session && r.term === term && r.className === className) {
      existingMap.set(r.studentId, r);
    }
  });

  const patch: Record<string, any> = { updatedAt: now };
  if (boxType === 'teacher') {
    patch.teacherComment = trimmedComment;
    patch.teacherCommentBy = trimmedAuthor;
    patch.teacherCommentAt = now;
  } else if (boxType === 'head') {
    patch.headComment = trimmedComment;
    patch.headCommentBy = trimmedAuthor;
    patch.headCommentTitle = headTitle;
    patch.headCommentAt = now;
    if (trimmedSig !== undefined) patch.headSignature = trimmedSig;
  } else {
    patch.principalComment = trimmedComment;
    patch.principalCommentBy = trimmedAuthor;
    patch.principalCommentAt = now;
    if (trimmedSig !== undefined) patch.principalSignature = trimmedSig;
  }

  try {
    const CHUNK = 400;
    for (let i = 0; i < students.length; i += CHUNK) {
      const slice = students.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      slice.forEach((stu) => {
        const docId = buildResultReviewId(session, term, className, stu.id);
        const ref = doc(db, 'resultReviews', docId);
        const existing = existingMap.get(stu.id);
        if (existing) {
          batch.update(ref, stripUndefined(patch));
        } else {
          const initialDoc: StudentResultReview = {
            id: docId,
            studentId: stu.id,
            studentName: stu.fullName.slice(0, 150),
            admissionNo: stu.admissionNo.slice(0, 30),
            guardianEmail: (stu.guardianEmail || '').trim().toLowerCase(),
            className: className.slice(0, 60),
            term,
            session: session.slice(0, 40),
            status: 'Draft',
            teacherComment: boxType === 'teacher' ? trimmedComment : '',
            principalComment: boxType === 'principal' ? trimmedComment : '',
            ...patch,
          };
          batch.set(ref, stripUndefined(initialDoc));
        }
      });
      await batch.commit();
    }
    return students.length;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'resultReviews');
  }
}

// ==================== CLASS RESULT SUMMARY & RANKING ENGINE ====================

export interface ComputedStudentResult {
  student: Student;
  records: AcademicRecord[];
  subjectsCount: number;
  totalMarksObtained: number;
  totalMaxPossible: number;
  averagePercentage: number; // null if 0 subjects? kept as number with subjectsCount check
  overallGrade: string;
  overallRemark: string;
  position: number | null;
  totalRankedStudents: number;
  review: StudentResultReview | null;
  attendance: AttendanceSummaryStats;
}

export function computeClassResultsSummary(params: {
  students: Student[];
  academicRecords: AcademicRecord[];
  config: AcademicConfig;
  reviews: StudentResultReview[];
  attendanceRecords: AttendanceRecord[];
  session: string;
  term: AcademicTerm;
  className: string;
}): ComputedStudentResult[] {
  const {
    students,
    academicRecords,
    config,
    reviews,
    attendanceRecords,
    session,
    term,
    className,
  } = params;

  const classStudents = students.filter(
    (s) => s.className === className && s.status === 'Active'
  );

  const termRecords = academicRecords.filter(
    (r) => r.className === className && r.session === session && r.term === term
  );

  const termAttendance = attendanceRecords.filter(
    (a) => a.session === session && a.term === term
  );

  const reviewMap = new Map<string, StudentResultReview>();
  reviews.forEach((r) => {
    if (r.className === className && r.session === session && r.term === term) {
      reviewMap.set(r.studentId, r);
    }
  });

  const maxConfigTotal = config.components.reduce((acc, c) => acc + c.maxMark, 0) || 100;

  const rawRows: ComputedStudentResult[] = classStudents.map((student) => {
    const stuRecords = termRecords
      .filter((r) => r.studentId === student.id)
      .sort((a, b) => a.subject.localeCompare(b.subject));

    const subjectsCount = stuRecords.length;
    const totalMarksObtained = stuRecords.reduce((sum, r) => sum + r.total, 0);
    const totalMaxPossible = stuRecords.reduce(
      (sum, r) => sum + (r.maxTotal || maxConfigTotal),
      0
    );
    const averagePercentage =
      totalMaxPossible > 0
        ? Math.round((totalMarksObtained / totalMaxPossible) * 1000) / 10
        : 0;

    const { grade: overallGrade, remark: overallRemark } =
      subjectsCount > 0
        ? computeGradeFromConfig(averagePercentage, config.gradingScale)
        : { grade: '—', remark: 'No scores entered' };

    const stuAttendance = termAttendance.filter((a) => a.studentId === student.id);
    const attendance = computeAttendanceSummary(stuAttendance);

    return {
      student,
      records: stuRecords,
      subjectsCount,
      totalMarksObtained,
      totalMaxPossible,
      averagePercentage,
      overallGrade,
      overallRemark,
      position: null,
      totalRankedStudents: 0,
      review: reviewMap.get(student.id) || null,
      attendance,
    };
  });

  // Rank only students who actually have saved academic scores
  const rankedPool = rawRows
    .filter((r) => r.subjectsCount > 0)
    .sort((a, b) => {
      if (b.averagePercentage !== a.averagePercentage) {
        return b.averagePercentage - a.averagePercentage;
      }
      return b.totalMarksObtained - a.totalMarksObtained;
    });

  const totalRanked = rankedPool.length;
  let lastPct: number | null = null;
  let lastRank = 0;

  rankedPool.forEach((row, index) => {
    let rank: number;
    if (lastPct !== null && row.averagePercentage === lastPct) {
      rank = lastRank;
    } else if (config.rankingPolicy === 'dense') {
      rank = lastRank + 1;
    } else {
      // standard_competition: 1, 2, 2, 4
      rank = index + 1;
    }
    lastPct = row.averagePercentage;
    lastRank = rank;
    row.position = rank;
    row.totalRankedStudents = totalRanked;
  });

  rawRows.forEach((r) => {
    r.totalRankedStudents = totalRanked;
  });

  // Return ranked students first (by position), then unranked alphabetically
  return rawRows.sort((a, b) => {
    if (a.position !== null && b.position !== null) return a.position - b.position;
    if (a.position !== null) return -1;
    if (b.position !== null) return 1;
    return a.student.fullName.localeCompare(b.student.fullName);
  });
}

// ==================== PDF REPORT CARD GENERATOR ====================

export async function downloadReportCardPDF(params: {
  result: ComputedStudentResult;
  schoolSettings: SchoolSetting;
  config: AcademicConfig;
  session: string;
  term: AcademicTerm;
  section?: string;
  nextTermResumption?: string;
}): Promise<void> {
  const { result, schoolSettings, config, session, term, section, nextTermResumption } = params;
  const docPdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = docPdf.internal.pageSize.getWidth();

  // Header Logo (Uploaded School Logo if configured, otherwise Navy & Gold shield crest)
  const logoAsset = await loadImageForPdf(schoolSettings.logoDataUrl);
  if (logoAsset) {
    const fitted = fitDimensionsInsideBox(logoAsset.width, logoAsset.height, 20, 20);
    docPdf.addImage(
      logoAsset.dataUrl,
      logoAsset.format,
      14 + fitted.offsetX,
      12 + fitted.offsetY,
      fitted.drawWidth,
      fitted.drawHeight
    );
  } else {
    docPdf.setFillColor(90, 15, 30); // Deep maroon (#5A0F1E)
    docPdf.roundedRect(14, 12, 18, 20, 3, 3, 'F');
    docPdf.setDrawColor(217, 119, 6); // Gold border
    docPdf.setLineWidth(0.8);
    docPdf.roundedRect(15.2, 13.2, 15.6, 17.6, 2.2, 2.2, 'S');
    docPdf.setTextColor(251, 191, 36);
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(11);
    docPdf.text('SD', 23, 24, { align: 'center' });
  }

  // School Name & Contact Header
  docPdf.setTextColor(15, 23, 42);
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(14.5);
  docPdf.text(schoolSettings.schoolName.toUpperCase(), pageWidth / 2 + 8, 17, { align: 'center' });

  docPdf.setFont('helvetica', 'italic');
  docPdf.setFontSize(8.5);
  docPdf.setTextColor(180, 83, 9);
  docPdf.text(schoolSettings.motto || '', pageWidth / 2 + 8, 22, { align: 'center' });

  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(8);
  docPdf.setTextColor(71, 85, 105);
  const contactLine = [
    schoolSettings.address,
    schoolSettings.phone,
    schoolSettings.website ? schoolSettings.website : '',
  ]
    .filter(Boolean)
    .join(' | ');
  docPdf.text(contactLine, pageWidth / 2 + 8, 27, { align: 'center' });

  // Banner Strip
  docPdf.setFillColor(122, 20, 36); // Maroon (#7A1424)
  docPdf.rect(14, 35, pageWidth - 28, 8, 'F');
  docPdf.setTextColor(253, 224, 71);
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(9.5);
  docPdf.text(
    `TERMINAL ACADEMIC REPORT CARD — ${term.toUpperCase()} (${session.toUpperCase()})`,
    pageWidth / 2,
    40.3,
    { align: 'center' }
  );

  // Student Biodata & Attendance Box
  docPdf.setTextColor(15, 23, 42);
  docPdf.setDrawColor(203, 213, 225);
  docPdf.setLineWidth(0.3);
  docPdf.rect(14, 46, pageWidth - 28, 28, 'S');

  docPdf.setFontSize(8.5);
  docPdf.setFont('helvetica', 'bold');
  docPdf.text('Student Name:', 17, 52);
  docPdf.text('Admission No:', 17, 58);
  docPdf.text('Class & Section:', 17, 64);
  docPdf.text('Approval Status:', 17, 70);

  docPdf.setFont('helvetica', 'normal');
  docPdf.text(result.student.fullName, 48, 52);
  docPdf.text(result.student.admissionNo, 48, 58);
  docPdf.text(
    `${result.student.className}${section ? ` (${section})` : ''}`,
    48,
    64
  );
  docPdf.text(result.review?.status || 'Draft (Unapproved)', 48, 70);

  docPdf.setFont('helvetica', 'bold');
  docPdf.text('Term Average:', 115, 52);
  docPdf.text('Class Position:', 115, 58);
  docPdf.text('Attendance:', 115, 64);
  docPdf.text('Attendance Breakdown:', 115, 70);

  docPdf.setFont('helvetica', 'normal');
  docPdf.text(
    result.subjectsCount > 0 ? `${result.averagePercentage}%` : 'No scores recorded',
    152,
    52
  );
  docPdf.text(
    result.position
      ? `${formatOrdinal(result.position)} out of ${result.totalRankedStudents}`
      : '—',
    152,
    58
  );
  docPdf.text(
    result.attendance.totalRecords > 0
      ? `${result.attendance.attendedCount}/${result.attendance.totalRecords} days (${result.attendance.attendanceRate}%)`
      : '0 days recorded',
    152,
    64
  );
  docPdf.text(
    `P:${result.attendance.present}  L:${result.attendance.late}  A:${result.attendance.absent}  E:${result.attendance.excused}`,
    152,
    70
  );

  // Academic Subjects Table
  const componentHeaders = config.components.map((c) => `${c.label}\n(/${c.maxMark})`);
  const tableHeaders = [['Subject', ...componentHeaders, 'Total', '%', 'Grade', 'Remark']];

  const tableRows =
    result.records.length === 0
      ? [['No subject assessment scores saved for this term.', '', '', '', '', '', '']]
      : result.records.map((rec) => {
          const compVals = config.components.map((c) => {
            if (rec.componentScores && rec.componentScores[c.key] !== undefined) {
              return String(rec.componentScores[c.key]);
            }
            if (c.key === 'ca1') return String(rec.ca1 ?? 0);
            if (c.key === 'ca2') return String(rec.ca2 ?? 0);
            if (c.key === 'exam' || c.isExam) return String(rec.exam ?? 0);
            return '0';
          });
          const pct =
            rec.percentage !== undefined
              ? `${rec.percentage}%`
              : `${Math.round((rec.total / (rec.maxTotal || 100)) * 1000) / 10}%`;
          return [
            rec.subject,
            ...compVals,
            `${rec.total}/${rec.maxTotal || 100}`,
            pct,
            rec.grade,
            rec.remark,
          ];
        });

  autoTable(docPdf, {
    startY: 78,
    head: tableHeaders,
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [122, 20, 36],
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [30, 41, 59],
    },
    columnStyles: {
      0: { halign: 'left', fontStyle: 'bold', cellWidth: 42 },
    },
    styles: {
      halign: 'center',
      cellPadding: 2.3,
    },
  });

  const afterTableY = ((docPdf as any).lastAutoTable?.finalY || 140) + 6;

  // Grading Scale Legend & Ranking Policy
  docPdf.setFontSize(7.5);
  docPdf.setFont('helvetica', 'bold');
  docPdf.setTextColor(71, 85, 105);
  const scaleStr = config.gradingScale
    .map((g) => `${g.grade}: ${g.minScore}-${g.maxScore}%`)
    .join('  |  ');
  docPdf.text(`Grading Scale: ${scaleStr}`, 14, afterTableY, { maxWidth: pageWidth - 28 });

  const policyLabel =
    config.rankingPolicy === 'dense'
      ? 'Dense Ranking (1, 2, 2, 3)'
      : 'Standard Competition Ranking (1, 2, 2, 4)';
  docPdf.setFont('helvetica', 'normal');
  docPdf.text(`Class Ranking Policy: ${policyLabel}`, 14, afterTableY + 5);

  // Three-Tier Comments & Signatures (Strictly respecting Settings toggles & never printing empty placeholders)
  const pageHeight = docPdf.internal.pageSize.getHeight();
  let curY = afterTableY + 11;

  const ensureVerticalSpace = (needed: number) => {
    if (curY + needed > pageHeight - 16) {
      docPdf.addPage();
      curY = 18;
    }
  };

  const enableTeacher = schoolSettings.enableTeacherComment !== false;
  const enableHead = schoolSettings.enableHeadComment !== false;
  const enablePrincipal = schoolSettings.enablePrincipalComment !== false;

  const formatApprovalDate = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // 1. Form / Class Teacher's Comment
  if (enableTeacher) {
    const teacherText = (result.review?.teacherComment || '').trim();
    const teacherBy = (result.review?.teacherCommentBy || '').trim();
    const textLines = teacherText
      ? docPdf.splitTextToSize(`"${teacherText}"`, pageWidth - 36)
      : [];
    const boxHeight = Math.max(18, 10 + textLines.length * 4.2 + (teacherBy ? 5 : 2));
    ensureVerticalSpace(boxHeight + 4);

    docPdf.setDrawColor(203, 213, 225);
    docPdf.setFillColor(250, 248, 244);
    docPdf.roundedRect(14, curY, pageWidth - 28, boxHeight, 2, 2, 'FD');

    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(8.5);
    docPdf.setTextColor(42, 42, 46);
    docPdf.text("Form / Class Teacher's Comment:", 17, curY + 5.8);

    if (textLines.length > 0) {
      docPdf.setFont('helvetica', 'italic');
      docPdf.setFontSize(8.5);
      docPdf.setTextColor(30, 41, 59);
      docPdf.text(textLines, 17, curY + 11);
    }

    if (teacherBy) {
      docPdf.setFont('helvetica', 'normal');
      docPdf.setFontSize(7.5);
      docPdf.setTextColor(100, 116, 139);
      docPdf.text(`Signed: ${teacherBy}`, pageWidth - 17, curY + boxHeight - 3, { align: 'right' });
    }

    curY += boxHeight + 4;
  }

  // 2. Headmaster / Headmistress's Comment
  if (enableHead) {
    const headTitle: HeadTeacherTitle =
      result.review?.headCommentTitle ||
      schoolSettings.headTeacherTitle ||
      'Headmaster';
    const headText = (result.review?.headComment || '').trim();
    const headName = (result.review?.headCommentBy || schoolSettings.headTeacherName || '').trim();
    const headSigDataUrl = (result.review?.headSignature || schoolSettings.headTeacherSignature || '').trim();
    const headSigAsset = await loadImageForPdf(headSigDataUrl);

    const textLines = headText
      ? docPdf.splitTextToSize(`"${headText}"`, pageWidth - 36)
      : [];
    const sigFooterHeight = headSigAsset ? 13 : headName ? 6 : 2;
    const boxHeight = Math.max(20, 10 + textLines.length * 4.2 + sigFooterHeight);
    ensureVerticalSpace(boxHeight + 4);

    docPdf.setDrawColor(227, 207, 166);
    docPdf.setFillColor(251, 245, 232);
    docPdf.roundedRect(14, curY, pageWidth - 28, boxHeight, 2, 2, 'FD');

    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(8.5);
    docPdf.setTextColor(125, 90, 24);
    docPdf.text("Headmaster's/Headmistress's Comment:", 17, curY + 5.8);

    if (textLines.length > 0) {
      docPdf.setFont('helvetica', 'italic');
      docPdf.setFontSize(8.5);
      docPdf.setTextColor(30, 41, 59);
      docPdf.text(textLines, 17, curY + 11);
    }

    if (headSigAsset) {
      const fittedSig = fitDimensionsInsideBox(headSigAsset.width, headSigAsset.height, 28, 9);
      docPdf.addImage(
        headSigAsset.dataUrl,
        headSigAsset.format,
        pageWidth - 17 - 28 + fittedSig.offsetX,
        curY + boxHeight - 13 + fittedSig.offsetY,
        fittedSig.drawWidth,
        fittedSig.drawHeight
      );
    }

    if (headName) {
      docPdf.setFont('helvetica', 'normal');
      docPdf.setFontSize(7.5);
      docPdf.setTextColor(100, 116, 139);
      docPdf.text(`${headTitle}: ${headName}`, 17, curY + boxHeight - 3);
    }

    curY += boxHeight + 4;
  }

  // 3. Principal's Comment & Approval
  if (enablePrincipal) {
    const principalText = (result.review?.principalComment || '').trim();
    const principalName = (
      result.review?.approvedBy ||
      result.review?.principalCommentBy ||
      schoolSettings.principalName ||
      ''
    ).trim();
    const principalSigDataUrl = (
      result.review?.principalSignature ||
      schoolSettings.principalSignature ||
      ''
    ).trim();
    const principalSigAsset = await loadImageForPdf(principalSigDataUrl);
    const isApproved = result.review?.status === 'Approved';
    const approvedDateStr = isApproved ? formatApprovalDate(result.review?.approvedAt) : '';

    const textLines = principalText
      ? docPdf.splitTextToSize(`"${principalText}"`, pageWidth - 36)
      : [];
    const sigFooterHeight = principalSigAsset ? 14 : 7;
    const boxHeight = Math.max(22, 10 + textLines.length * 4.2 + sigFooterHeight);
    ensureVerticalSpace(boxHeight + 6);

    docPdf.setDrawColor(223, 199, 202);
    docPdf.setFillColor(250, 240, 242);
    docPdf.roundedRect(14, curY, pageWidth - 28, boxHeight, 2, 2, 'FD');

    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(8.5);
    docPdf.setTextColor(107, 16, 32);
    docPdf.text("Principal's Comment & Approval:", 17, curY + 5.8);

    if (isApproved) {
      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(7.5);
      docPdf.setTextColor(42, 88, 59);
      docPdf.text(
        approvedDateStr ? `APPROVED • ${approvedDateStr}` : 'APPROVED',
        pageWidth - 17,
        curY + 5.8,
        { align: 'right' }
      );
    }

    if (textLines.length > 0) {
      docPdf.setFont('helvetica', 'italic');
      docPdf.setFontSize(8.5);
      docPdf.setTextColor(30, 41, 59);
      docPdf.text(textLines, 17, curY + 11);
    }

    if (principalSigAsset) {
      const fittedSig = fitDimensionsInsideBox(
        principalSigAsset.width,
        principalSigAsset.height,
        28,
        9
      );
      docPdf.addImage(
        principalSigAsset.dataUrl,
        principalSigAsset.format,
        pageWidth - 17 - 28 + fittedSig.offsetX,
        curY + boxHeight - 13 + fittedSig.offsetY,
        fittedSig.drawWidth,
        fittedSig.drawHeight
      );
    }

    if (principalName) {
      docPdf.setFont('helvetica', 'normal');
      docPdf.setFontSize(7.5);
      docPdf.setTextColor(100, 116, 139);
      docPdf.text(`Principal: ${principalName}`, 17, curY + boxHeight - 3);
    }

    curY += boxHeight + 5;
  }

  // Footer Sign-off
  ensureVerticalSpace(10);
  const footerY = curY + 3;
  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(8);
  docPdf.setTextColor(71, 85, 105);
  docPdf.text(
    `Next Term Resumption: ${nextTermResumption || schoolSettings.nextTermResumption || 'To be announced'}`,
    14,
    footerY
  );
  docPdf.text(`School Official Stamp & Date`, pageWidth - 14, footerY, {
    align: 'right',
  });

  const safeAdm = result.student.admissionNo.replace(/[^a-zA-Z0-9_-]/g, '-');
  const safeTerm = term.replace(/\s+/g, '_');
  docPdf.save(`ReportCard_${safeAdm}_${safeTerm}.pdf`);
}
