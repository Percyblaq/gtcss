import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import {
  AcademicTerm,
  AttendanceCorrectionLog,
  AttendanceRecord,
  SchoolClass,
  Student,
  UserProfile,
  UserRole,
} from '../types';
import { extractFriendlyError } from './schoolService';
import {
  doesStudentBelongToClass,
  inferSectionFromClassName,
  SECTION_ORDER,
} from '../utils/classUtils';

export type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'Excused';

export interface AttendanceSummaryStats {
  totalRecords: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  attendedCount: number;
  attendanceRate: number; // (Present + Late) / Total * 100
  punctualityRate: number; // Present / Total * 100
  uniqueDays: number;
  uniqueStudents: number;
}

export interface ClassAttendanceBreakdown {
  className: string;
  formTeacherName: string;
  enrolledCount: number;
  daysRecorded: number;
  stats: AttendanceSummaryStats;
}

// Recursively remove undefined values from objects and arrays before writing to Firestore
function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const cleaned: Record<string, any> = {};
    Object.keys(value as Record<string, any>).forEach((key) => {
      const prop = (value as Record<string, any>)[key];
      if (prop !== undefined) {
        cleaned[key] = stripUndefinedDeep(prop);
      }
    });
    return cleaned as T;
  }
  return value;
}

// Sanitize segment to match ^[a-zA-Z0-9_\-]+$
function sanitizeIdPart(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'item';
}

// Deterministic ID per (date, className, studentId) so duplicates are impossible in Firestore
export function buildAttendanceDocId(date: string, className: string, studentId: string): string {
  const id = `att_${sanitizeIdPart(date)}_${sanitizeIdPart(className)}_${sanitizeIdPart(studentId)}`;
  return id.slice(0, 128);
}

// Subscribe to actual saved attendance records scoped by user role
export function subscribeAttendance(
  role: UserRole,
  currentUser: UserProfile | null,
  authEmail: string | null | undefined,
  onData: (records: AttendanceRecord[]) => void,
  onError: (message: string) => void
): Unsubscribe {
  const colRef = collection(db, 'attendance');

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
        const list = snap.docs.map((d) => ({ ...(d.data() as AttendanceRecord), id: d.id }));
        list.sort((a, b) => b.date.localeCompare(a.date) || a.studentName.localeCompare(b.studentName));
        onData(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'attendance');
        } catch (wrapped) {
          onError(extractFriendlyError(wrapped, 'Unable to load class attendance records.'));
        }
      }
    );
  }

  if (role === 'parent') {
    const parentEmail = (authEmail || currentUser?.email || '').trim().toLowerCase();
    const linkedIds = (currentUser?.linkedStudentIds || []).filter(Boolean);

    if (parentEmail) {
      const q = query(colRef, where('guardianEmail', '==', parentEmail));
      return onSnapshot(
        q,
        (snap) => {
          const list = snap.docs.map((d) => ({ ...(d.data() as AttendanceRecord), id: d.id }));
          list.sort((a, b) => b.date.localeCompare(a.date));
          onData(list);
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'attendance');
          } catch (wrapped) {
            onError(extractFriendlyError(wrapped, 'Unable to load ward attendance history.'));
          }
        }
      );
    }

    if (linkedIds.length > 0) {
      const q = query(colRef, where('studentId', 'in', linkedIds.slice(0, 10)));
      return onSnapshot(
        q,
        (snap) => {
          const list = snap.docs.map((d) => ({ ...(d.data() as AttendanceRecord), id: d.id }));
          list.sort((a, b) => b.date.localeCompare(a.date));
          onData(list);
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'attendance');
          } catch (wrapped) {
            onError(extractFriendlyError(wrapped, 'Unable to load ward attendance history.'));
          }
        }
      );
    }

    onData([]);
    return () => {};
  }

  // Director & Principal see school-wide attendance
  return onSnapshot(
    colRef,
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as AttendanceRecord), id: d.id }));
      list.sort((a, b) => b.date.localeCompare(a.date) || a.className.localeCompare(b.className));
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'attendance');
      } catch (wrapped) {
        onError(extractFriendlyError(wrapped, 'Unable to load school attendance records.'));
      }
    }
  );
}

export interface SaveRegisterEntry {
  studentId: string;
  studentName: string;
  admissionNo: string;
  guardianEmail?: string;
  status: AttendanceStatus;
  remark: string;
}

export interface SaveRegisterPayload {
  classId: string;
  className: string;
  date: string;
  term: AcademicTerm;
  session: string;
  entries: SaveRegisterEntry[];
  markedBy: string;
  markedByUid: string;
  allowCorrection: boolean;
  correctionReason?: string;
}

// Save class register to Firestore while preventing accidental duplicates and tracking correction audit logs
export async function saveClassAttendanceToFirestore(
  payload: SaveRegisterPayload
): Promise<{ createdCount: number; updatedCount: number; savedRecords: AttendanceRecord[] }> {
  const {
    classId,
    className,
    date,
    term,
    session,
    entries,
    markedBy,
    markedByUid,
    allowCorrection,
    correctionReason,
  } = payload;

  const cleanClassName = (className || '').trim().slice(0, 50);
  const cleanClassId = (classId || cleanClassName).trim().slice(0, 50);
  const cleanDate = (date || '').trim().slice(0, 10);
  const cleanSession = (session || 'Current Session').trim().slice(0, 40);
  const cleanActor = (markedBy || 'Staff').trim().slice(0, 120);
  const cleanActorUid = (markedByUid || 'staff').trim().slice(0, 128);
  const cleanReason = (correctionReason || '').trim().slice(0, 250);

  if (!cleanClassName || cleanDate.length !== 10 || entries.length === 0) {
    throw new Error('Class, valid date (YYYY-MM-DD), and at least one registered pupil are required.');
  }

  // Check Firestore for existing records matching (className, date) to prevent duplicates
  const existingByStudentId = new Map<string, { docId: string; data: AttendanceRecord }>();
  try {
    const q = query(
      collection(db, 'attendance'),
      where('className', '==', cleanClassName),
      where('date', '==', cleanDate)
    );
    const snap = await getDocs(q);
    snap.docs.forEach((d) => {
      const rec = d.data() as AttendanceRecord;
      existingByStudentId.set(rec.studentId, { docId: d.id, data: rec });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'attendance');
  }

  const duplicateEntries = entries.filter((e) => existingByStudentId.has(e.studentId));
  if (duplicateEntries.length > 0 && !allowCorrection) {
    throw new Error(
      `Duplicate Attendance Blocked: Attendance has already been recorded for ${duplicateEntries.length} pupil(s) in ${cleanClassName} on ${cleanDate}. Click "Correct Saved Register" to update existing entries.`
    );
  }

  if (duplicateEntries.length > 0 && allowCorrection && !cleanReason) {
    throw new Error('Please enter a reason for this correction before saving.');
  }

  const now = new Date().toISOString();
  const hasAnyDiffOrNew = entries.some((entry) => {
    const existing = existingByStudentId.get(entry.studentId);
    if (!existing) return true;
    const oldRemark = (existing.data.remark || '').trim().slice(0, 250);
    const newRemark = (entry.remark || '').trim().slice(0, 250);
    return existing.data.status !== entry.status || oldRemark !== newRemark;
  });

  const batch = writeBatch(db);
  const savedRecords: AttendanceRecord[] = [];
  let createdCount = 0;
  let updatedCount = 0;

  entries.forEach((entry) => {
    const existing = existingByStudentId.get(entry.studentId);
    const docId = existing ? existing.docId : buildAttendanceDocId(cleanDate, cleanClassName, entry.studentId);
    const ref = doc(db, 'attendance', docId);

    const safeStudentId = (existing?.data.studentId || entry.studentId).trim().slice(0, 128);
    const safeStudentName = (entry.studentName || existing?.data.studentName || 'Pupil').trim().slice(0, 150);
    const safeAdmissionNo =
      (entry.admissionNo || existing?.data.admissionNo || safeStudentId).trim().slice(0, 30) || 'N/A';
    const safeGuardianEmail = (entry.guardianEmail ?? existing?.data.guardianEmail ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 128);
    const cleanRemark = (entry.remark || '').trim().slice(0, 250);

    if (!existing) {
      const newRecord: AttendanceRecord = {
        id: docId,
        date: cleanDate,
        classId: cleanClassId,
        className: cleanClassName,
        term,
        session: cleanSession,
        studentId: safeStudentId,
        studentName: safeStudentName,
        admissionNo: safeAdmissionNo,
        guardianEmail: safeGuardianEmail,
        status: entry.status,
        remark: cleanRemark,
        markedBy: cleanActor,
        markedByUid: cleanActorUid,
        createdAt: now,
        updatedAt: now,
      };
      createdCount += 1;
      batch.set(ref, stripUndefinedDeep(newRecord));
      savedRecords.push(newRecord);
      return;
    }

    const oldRemark = (existing.data.remark || '').trim().slice(0, 250);
    const isModified = existing.data.status !== entry.status || oldRemark !== cleanRemark;
    const shouldWriteExisting = isModified || !hasAnyDiffOrNew;

    if (!shouldWriteExisting) {
      // Unchanged pupil in a partial correction: keep existing saved record untouched in Firestore
      savedRecords.push({ ...existing.data, id: docId });
      return;
    }

    const priorHistory = Array.isArray(existing.data.correctionHistory)
      ? existing.data.correctionHistory
      : [];
    const logEntry: AttendanceCorrectionLog = {
      correctedBy: cleanActor,
      correctedByUid: cleanActorUid,
      correctedAt: now,
      reason: cleanReason || 'Authorized register correction',
      oldStatus: existing.data.status,
      newStatus: entry.status,
      oldRemark,
      newRemark: cleanRemark,
    };
    const nextHistory = [...priorHistory, logEntry].slice(-50);

    const updatedRecord: AttendanceRecord = {
      id: docId,
      date: existing.data.date || cleanDate,
      classId: (existing.data.classId || cleanClassId).trim().slice(0, 50),
      className: existing.data.className || cleanClassName,
      term: term || existing.data.term,
      session: (existing.data.session || cleanSession).trim().slice(0, 40),
      studentId: safeStudentId,
      studentName: safeStudentName,
      admissionNo: safeAdmissionNo,
      guardianEmail: safeGuardianEmail,
      status: entry.status,
      remark: cleanRemark,
      markedBy: (existing.data.markedBy || cleanActor).trim().slice(0, 120),
      markedByUid: (existing.data.markedByUid || cleanActorUid).trim().slice(0, 128),
      updatedBy: cleanActor,
      updatedByUid: cleanActorUid,
      correctionReason: cleanReason || 'Authorized register correction',
      correctionHistory: nextHistory,
      createdAt: existing.data.createdAt || now,
      updatedAt: now,
    };

    updatedCount += 1;
    batch.set(ref, stripUndefinedDeep(updatedRecord));
    savedRecords.push(updatedRecord);
  });

  try {
    await batch.commit();
    return { createdCount, updatedCount, savedRecords };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'attendance');
  }
}

// Correct a single saved attendance record in Firestore with full audit log
export async function correctAttendanceRecordInFirestore(
  recordId: string,
  updates: {
    status: AttendanceStatus;
    remark: string;
    correctionReason: string;
    updatedBy: string;
    updatedByUid?: string;
    oldStatus?: AttendanceStatus;
    oldRemark?: string;
    existingHistory?: AttendanceCorrectionLog[];
  }
): Promise<{ updatedAt: string; correctionHistory: AttendanceCorrectionLog[] }> {
  try {
    const ref = doc(db, 'attendance', recordId);
    let currentData: Partial<AttendanceRecord> | null = null;

    if (updates.oldStatus === undefined || updates.existingHistory === undefined) {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        currentData = snap.data() as AttendanceRecord;
      }
    }

    const now = new Date().toISOString();
    const cleanActor = (updates.updatedBy || 'Authorized Staff').trim().slice(0, 120);
    const cleanActorUid = updates.updatedByUid ? updates.updatedByUid.trim().slice(0, 128) : undefined;
    const cleanReason =
      (updates.correctionReason || '').trim().slice(0, 250) || 'Authorized attendance correction';
    const cleanRemark = (updates.remark || '').trim().slice(0, 250);
    const oldStatus = updates.oldStatus ?? currentData?.status ?? updates.status;
    const oldRemark = (updates.oldRemark ?? currentData?.remark ?? '').trim().slice(0, 250);

    const priorHistory = Array.isArray(updates.existingHistory)
      ? updates.existingHistory
      : Array.isArray(currentData?.correctionHistory)
      ? currentData.correctionHistory
      : [];

    const logEntry: AttendanceCorrectionLog = {
      correctedBy: cleanActor,
      ...(cleanActorUid ? { correctedByUid: cleanActorUid } : {}),
      correctedAt: now,
      reason: cleanReason,
      oldStatus,
      newStatus: updates.status,
      oldRemark,
      newRemark: cleanRemark,
    };

    const nextHistory = [...priorHistory, logEntry].slice(-50);

    await updateDoc(
      ref,
      stripUndefinedDeep({
        status: updates.status,
        remark: cleanRemark,
        correctionReason: cleanReason,
        updatedBy: cleanActor,
        ...(cleanActorUid ? { updatedByUid: cleanActorUid } : {}),
        correctionHistory: nextHistory,
        updatedAt: now,
      })
    );

    return { updatedAt: now, correctionHistory: nextHistory };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `attendance/${recordId}`);
  }
}

// Compute Mon–Fri date range for a given YYYY-MM-DD date
export function getSchoolWeekRange(dateStr: string): {
  start: string;
  end: string;
  days: string[];
  label: string;
} {
  const parts = dateStr.split('-').map((n) => parseInt(n, 10));
  const base =
    parts.length === 3 && !parts.some(Number.isNaN)
      ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
      : new Date();
  const dayOfWeek = base.getUTCDay(); // 0=Sun .. 6=Sat
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() + diffToMonday);

  const days: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    days.push(d.toISOString().split('T')[0]);
  }

  return {
    start: days[0],
    end: days[4],
    days,
    label: `${days[0]} to ${days[4]}`,
  };
}

// Compute YYYY-MM month start/end
export function getMonthDateRange(monthStr: string): {
  start: string;
  end: string;
  label: string;
} {
  const [yStr, mStr] = monthStr.split('-');
  const year = parseInt(yStr, 10) || new Date().getFullYear();
  const month = parseInt(mStr, 10) || new Date().getMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-NG', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
    label: monthName,
  };
}

// Calculate summary statistics strictly from actual saved AttendanceRecord items
export function computeAttendanceSummary(records: AttendanceRecord[]): AttendanceSummaryStats {
  const totalRecords = records.length;
  let present = 0;
  let late = 0;
  let absent = 0;
  let excused = 0;

  const daySet = new Set<string>();
  const studentSet = new Set<string>();

  records.forEach((r) => {
    daySet.add(r.date);
    studentSet.add(r.studentId);
    switch (r.status) {
      case 'Present':
        present += 1;
        break;
      case 'Late':
        late += 1;
        break;
      case 'Absent':
        absent += 1;
        break;
      case 'Excused':
        excused += 1;
        break;
    }
  });

  const attendedCount = present + late;
  const attendanceRate =
    totalRecords > 0 ? Math.round((attendedCount / totalRecords) * 1000) / 10 : 0;
  const punctualityRate =
    totalRecords > 0 ? Math.round((present / totalRecords) * 1000) / 10 : 0;

  return {
    totalRecords,
    present,
    late,
    absent,
    excused,
    attendedCount,
    attendanceRate,
    punctualityRate,
    uniqueDays: daySet.size,
    uniqueStudents: studentSet.size,
  };
}

// Compute class-by-class breakdown for School-Wide Overview (Director & Principal)
export function computeClassBreakdown(
  records: AttendanceRecord[],
  classes: SchoolClass[],
  students: Student[]
): ClassAttendanceBreakdown[] {
  const classNamesSet = new Set<string>(classes.map((c) => c.name));
  records.forEach((r) => classNamesSet.add(r.className));

  const items = Array.from(classNamesSet).map((className) => {
    const classMeta = classes.find((c) => c.name === className);
    const classRecords = records.filter((r) => r.className === className);
    const enrolledCount = students.filter(
      (s) =>
        s.status === 'Active' &&
        (classMeta ? doesStudentBelongToClass(s, classMeta) : s.className === className)
    ).length;
    const stats = computeAttendanceSummary(classRecords);

    return {
      classMeta,
      breakdown: {
        className,
        formTeacherName: classMeta?.formTeacherName || 'Unassigned',
        enrolledCount,
        daysRecorded: stats.uniqueDays,
        stats,
      },
    };
  });

  return items
    .sort((a, b) => {
      const secA = a.classMeta?.section || inferSectionFromClassName(a.breakdown.className);
      const secB = b.classMeta?.section || inferSectionFromClassName(b.breakdown.className);
      const secDiff = (SECTION_ORDER[secA] || 99) - (SECTION_ORDER[secB] || 99);
      if (secDiff !== 0) return secDiff;
      const sortA = typeof a.classMeta?.sortOrder === 'number' ? a.classMeta.sortOrder : 999;
      const sortB = typeof b.classMeta?.sortOrder === 'number' ? b.classMeta.sortOrder : 999;
      if (sortA !== sortB) return sortA - sortB;
      return a.breakdown.className.localeCompare(b.breakdown.className, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    })
    .map((entry) => entry.breakdown);
}
