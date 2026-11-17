import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import { SchoolClass, Student, Teacher, UserProfile, UserRole } from '../types';
import { SAMPLE_STUDENTS, SAMPLE_TEACHERS } from '../data/sampleData';

// Remove undefined properties before writing to Firestore
function stripUndefined<T extends Record<string, any>>(obj: T): Record<string, any> {
  const cleaned: Record<string, any> = {};
  Object.keys(obj).forEach((key) => {
    if (obj[key] !== undefined) {
      cleaned[key] = obj[key];
    }
  });
  return cleaned;
}

// Parse friendly message from handleFirestoreError JSON or raw error
export function extractFriendlyError(err: unknown, fallback: string): string {
  if (!err) return fallback;
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error) {
      if (String(parsed.error).toLowerCase().includes('permission')) {
        return 'Permission denied by Cloud Firestore Security Rules. Verify your role and active account status.';
      }
      return String(parsed.error);
    }
  } catch {
    // Not JSON
  }
  if (raw.toLowerCase().includes('permission')) {
    return 'Permission denied by Cloud Firestore Security Rules. Verify your role and active account status.';
  }
  return raw || fallback;
}

// Generate an automatically unique Student Admission Number (e.g. CF/2026/0109)
export function generateUniqueAdmissionNo(existingStudents: Student[]): string {
  const year = new Date().getFullYear();
  const existingSet = new Set(existingStudents.map((s) => s.admissionNo.trim().toUpperCase()));
  let maxSeq = 100;

  existingStudents.forEach((s) => {
    const match = s.admissionNo.match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxSeq && num < 99999) {
        maxSeq = num;
      }
    }
  });

  let nextSeq = maxSeq + 1;
  let candidate = `CF/${year}/${String(nextSeq).padStart(4, '0')}`;
  while (existingSet.has(candidate.toUpperCase())) {
    nextSeq += 1;
    candidate = `CF/${year}/${String(nextSeq).padStart(4, '0')}`;
  }
  return candidate;
}

// Generate an automatically unique Teacher Staff ID (e.g. TR-2026-009)
export function generateUniqueStaffId(existingTeachers: Teacher[]): string {
  const year = new Date().getFullYear();
  const existingSet = new Set(existingTeachers.map((t) => t.staffId.trim().toUpperCase()));
  let maxSeq = 0;

  existingTeachers.forEach((t) => {
    const match = t.staffId.match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxSeq && num < 99999) {
        maxSeq = num;
      }
    }
  });

  let nextSeq = maxSeq + 1;
  let candidate = `TR-${year}-${String(nextSeq).padStart(3, '0')}`;
  while (existingSet.has(candidate.toUpperCase())) {
    nextSeq += 1;
    candidate = `TR-${year}-${String(nextSeq).padStart(3, '0')}`;
  }
  return candidate;
}

// Client-side image compression for passport photographs (fits comfortably in Firestore document)
export function compressPassportPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please select a valid image file (JPG, PNG, or WEBP).'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error('Image file is too large. Maximum allowed size is 10MB.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read the selected photograph file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unable to decode the selected image file.'));
      img.onload = () => {
        const maxDim = 240;
        let { width, height } = img;
        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas compression unavailable in this browser.'));
          return;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        if (dataUrl.length > 280000) {
          resolve(canvas.toDataURL('image/jpeg', 0.55));
        } else {
          resolve(dataUrl);
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// Role-scoped real-time subscription to /students
export function subscribeStudents(
  role: UserRole,
  currentUser: UserProfile | null,
  authEmail: string | null | undefined,
  onData: (students: Student[]) => void,
  onError: (message: string) => void
): Unsubscribe {
  const studentsRef = collection(db, 'students');

  if (role === 'teacher') {
    const classes = (currentUser?.assignedClasses || []).filter(Boolean);
    if (classes.length === 0) {
      onData([]);
      return () => {};
    }
    const q = query(studentsRef, where('className', 'in', classes.slice(0, 10)));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ ...(d.data() as Student), id: d.id }));
        list.sort((a, b) => a.admissionNo.localeCompare(b.admissionNo));
        onData(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'students');
        } catch (wrapped) {
          onError(extractFriendlyError(wrapped, 'Unable to load assigned class students.'));
        }
      }
    );
  }

  if (role === 'parent') {
    const linkedIds = (currentUser?.linkedStudentIds || []).filter(Boolean);
    const parentEmail = (authEmail || currentUser?.email || '').trim().toLowerCase();

    if (!parentEmail && linkedIds.length === 0) {
      onData([]);
      return () => {};
    }

    if (parentEmail) {
      const q = query(studentsRef, where('guardianEmail', '==', parentEmail));
      return onSnapshot(
        q,
        async (snap) => {
          const map = new Map<string, Student>();
          snap.docs.forEach((d) => {
            map.set(d.id, { ...(d.data() as Student), id: d.id });
          });

          // Also include explicitly linked wards via direct doc read
          for (const wardId of linkedIds) {
            if (!map.has(wardId)) {
              try {
                const wardSnap = await getDoc(doc(db, 'students', wardId));
                if (wardSnap.exists()) {
                  map.set(wardSnap.id, { ...(wardSnap.data() as Student), id: wardSnap.id });
                }
              } catch {
                // Ignore if ward doc doesn't exist or not linked
              }
            }
          }

          onData(Array.from(map.values()));
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'students');
          } catch (wrapped) {
            onError(extractFriendlyError(wrapped, 'Unable to load ward records.'));
          }
        }
      );
    }

    // Fallback when only linkedStudentIds exist
    let active = true;
    Promise.all(
      linkedIds.map(async (wardId) => {
        const wardSnap = await getDoc(doc(db, 'students', wardId));
        return wardSnap.exists() ? ({ ...(wardSnap.data() as Student), id: wardSnap.id }) : null;
      })
    )
      .then((results) => {
        if (active) {
          onData(results.filter((s): s is Student => s !== null));
        }
      })
      .catch((err) => {
        if (active) {
          onError(extractFriendlyError(err, 'Unable to load linked ward records.'));
        }
      });

    return () => {
      active = false;
    };
  }

  // Director & Principal see all students
  return onSnapshot(
    studentsRef,
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Student), id: d.id }));
      list.sort((a, b) => (b.createdAt || b.admissionDate || '').localeCompare(a.createdAt || a.admissionDate || ''));
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'students');
      } catch (wrapped) {
        onError(extractFriendlyError(wrapped, 'Unable to synchronize student records.'));
      }
    }
  );
}

// Real-time subscription to /teachers
export function subscribeTeachers(
  onData: (teachers: Teacher[]) => void,
  onError: (message: string) => void
): Unsubscribe {
  const teachersRef = collection(db, 'teachers');
  return onSnapshot(
    teachersRef,
    (snap) => {
      const list = snap.docs.map((d) => {
        const raw = d.data() as Record<string, any>;
        const rawSubjects = raw.subjects ?? raw.assignedSubjects ?? raw.primarySubject;
        const normalizedSubjects = Array.isArray(rawSubjects)
          ? rawSubjects.map((s) => String(s || '').trim()).filter(Boolean)
          : typeof rawSubjects === 'string' && rawSubjects.trim()
          ? [rawSubjects.trim()]
          : [];
        const normalizedClasses = Array.isArray(raw.assignedClasses)
          ? raw.assignedClasses.map((c) => String(c || '').trim()).filter(Boolean)
          : typeof raw.assignedClasses === 'string' && raw.assignedClasses.trim()
          ? [raw.assignedClasses.trim()]
          : [];
        return {
          ...(raw as Teacher),
          id: d.id,
          subjects: normalizedSubjects,
          assignedClasses: normalizedClasses,
        };
      });
      list.sort((a, b) => (a.staffId || '').localeCompare(b.staffId || ''));
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'teachers');
      } catch (wrapped) {
        onError(extractFriendlyError(wrapped, 'Unable to synchronize faculty records.'));
      }
    }
  );
}

// Check duplicate admission number against Cloud Firestore
export async function checkDuplicateAdmissionNo(
  admissionNo: string,
  excludeId?: string
): Promise<boolean> {
  const normalized = admissionNo.trim().toUpperCase();
  try {
    const q = query(collection(db, 'students'), where('admissionNo', '==', admissionNo.trim()));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      if (d.id !== excludeId) return true;
    }
    // Also check uppercase variant if stored differently
    if (normalized !== admissionNo.trim()) {
      const qUpper = query(collection(db, 'students'), where('admissionNo', '==', normalized));
      const snapUpper = await getDocs(qUpper);
      for (const d of snapUpper.docs) {
        if (d.id !== excludeId) return true;
      }
    }
    return false;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'students');
  }
}

// Check duplicate Staff ID against Cloud Firestore
export async function checkDuplicateStaffId(staffId: string, excludeId?: string): Promise<boolean> {
  const normalized = staffId.trim().toUpperCase();
  try {
    const q = query(collection(db, 'teachers'), where('staffId', '==', staffId.trim()));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      if (d.id !== excludeId) return true;
    }
    if (normalized !== staffId.trim()) {
      const qUpper = query(collection(db, 'teachers'), where('staffId', '==', normalized));
      const snapUpper = await getDocs(qUpper);
      for (const d of snapUpper.docs) {
        if (d.id !== excludeId) return true;
      }
    }
    return false;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'teachers');
  }
}

// Create or update Student in Firestore
export async function saveStudentToFirestore(
  student: Omit<Student, 'id'> & { id?: string },
  isEdit: boolean
): Promise<Student> {
  const docId =
    isEdit && student.id
      ? student.id
      : `std-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const normalizedAdmissionNo = student.admissionNo.trim().toUpperCase();

  // Strictly prevent duplicate admission numbers in Firestore
  const isDuplicate = await checkDuplicateAdmissionNo(
    normalizedAdmissionNo,
    isEdit ? docId : undefined
  );
  if (isDuplicate) {
    throw new Error(
      `Duplicate Admission Number: "${normalizedAdmissionNo}" is already assigned to another student.`
    );
  }

  const now = new Date().toISOString();
  const fullName = [student.firstName.trim(), student.middleName?.trim(), student.surname.trim()]
    .filter(Boolean)
    .join(' ');

  const payload: Student = {
    ...student,
    id: docId,
    admissionNo: normalizedAdmissionNo,
    firstName: student.firstName.trim(),
    middleName: student.middleName?.trim() || '',
    surname: student.surname.trim(),
    fullName,
    guardianName: student.guardianName.trim(),
    guardianPhone: student.guardianPhone.trim(),
    guardianEmail: student.guardianEmail.trim().toLowerCase(),
    address: student.address.trim(),
    passportPhoto: student.passportPhoto || '',
    createdAt: isEdit ? student.createdAt || now : now,
    updatedAt: now,
  };

  try {
    const ref = doc(db, 'students', docId);
    if (isEdit) {
      await updateDoc(ref, stripUndefined(payload));
    } else {
      await setDoc(ref, stripUndefined(payload));
    }
    return payload;
  } catch (err) {
    handleFirestoreError(
      err,
      isEdit ? OperationType.UPDATE : OperationType.CREATE,
      `students/${docId}`
    );
  }
}

// Promote one or multiple students to a target class
export async function promoteStudentsInFirestore(
  studentIds: string[],
  targetClassId: string,
  targetClassName: string
): Promise<void> {
  if (studentIds.length === 0) return;
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    studentIds.forEach((id) => {
      const ref = doc(db, 'students', id);
      batch.update(ref, {
        classId: targetClassId,
        className: targetClassName,
        updatedAt: now,
      });
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'students');
  }
}

// Update student status (Active, Graduated, Withdrawn)
export async function updateStudentStatusInFirestore(
  studentId: string,
  status: 'Active' | 'Graduated' | 'Withdrawn'
): Promise<void> {
  try {
    const ref = doc(db, 'students', studentId);
    await updateDoc(ref, {
      status,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `students/${studentId}`);
  }
}

// Permanently delete one or more students and clean up all linked records (attendance, marks, reviews, fees, parent links)
export async function deleteStudentsFromFirestore(
  studentsToDelete: Array<Pick<Student, 'id' | 'admissionNo'>>
): Promise<{ deletedStudents: number; deletedLinkedRecords: number }> {
  const uniqueIds = Array.from(new Set(studentsToDelete.map((s) => s.id).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { deletedStudents: 0, deletedLinkedRecords: 0 };
  }

  const deletedIdSet = new Set(uniqueIds);
  const deletedAdmNoSet = new Set(
    studentsToDelete.map((s) => s.admissionNo?.trim().toUpperCase()).filter(Boolean)
  );
  const now = new Date().toISOString();

  type BatchOp =
    | { type: 'delete'; ref: ReturnType<typeof doc> }
    | { type: 'update'; ref: ReturnType<typeof doc>; data: Record<string, any> };

  const linkedOpsMap = new Map<string, BatchOp>();
  const linkedCollections = [
    'feePayments',
    'studentFees',
    'attendance',
    'academics',
    'resultReviews',
  ] as const;

  // Query linked records in chunks of 10 (Firestore 'in' / 'array-contains-any' limit)
  for (let i = 0; i < uniqueIds.length; i += 10) {
    const idChunk = uniqueIds.slice(i, i + 10);

    for (const colName of linkedCollections) {
      try {
        const snap = await getDocs(
          query(collection(db, colName), where('studentId', 'in', idChunk))
        );
        snap.docs.forEach((d) => {
          linkedOpsMap.set(d.ref.path, { type: 'delete', ref: d.ref });
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, colName);
      }
    }

    // Safely detach deleted student IDs from any linked parent user accounts or invites
    for (const parentCol of ['users', 'staffInvites'] as const) {
      try {
        const snap = await getDocs(
          query(collection(db, parentCol), where('linkedStudentIds', 'array-contains-any', idChunk))
        );
        snap.docs.forEach((d) => {
          if (linkedOpsMap.has(d.ref.path)) return;
          const data = d.data() as Record<string, any>;
          const oldIds: string[] = Array.isArray(data.linkedStudentIds)
            ? data.linkedStudentIds
            : [];
          const oldNames: string[] = Array.isArray(data.linkedStudentNames)
            ? data.linkedStudentNames
            : [];
          const keptIndices: number[] = [];
          oldIds.forEach((sid, idx) => {
            if (!deletedIdSet.has(sid)) keptIndices.push(idx);
          });

          if (keptIndices.length !== oldIds.length) {
            const nextIds = keptIndices.map((idx) => oldIds[idx]);
            const updates: Record<string, any> = {
              linkedStudentIds: nextIds,
              updatedAt: now,
            };

            if (Array.isArray(data.linkedStudentNames)) {
              updates.linkedStudentNames = keptIndices
                .map((idx) => oldNames[idx])
                .filter((val) => typeof val === 'string');
            }

            if (nextIds.length === 0) {
              if ('wardName' in data) updates.wardName = '';
              if ('wardAdmissionNo' in data) updates.wardAdmissionNo = '';
            } else if (
              typeof data.wardAdmissionNo === 'string' &&
              deletedAdmNoSet.has(data.wardAdmissionNo.trim().toUpperCase())
            ) {
              updates.wardName =
                (Array.isArray(updates.linkedStudentNames) && updates.linkedStudentNames[0]) || '';
              updates.wardAdmissionNo = '';
            }

            linkedOpsMap.set(d.ref.path, { type: 'update', ref: d.ref, data: updates });
          }
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, parentCol);
      }
    }
  }

  const linkedOps = Array.from(linkedOpsMap.values());
  const studentDeleteOps: BatchOp[] = uniqueIds.map((id) => ({
    type: 'delete',
    ref: doc(db, 'students', id),
  }));

  const allOps = [...linkedOps, ...studentDeleteOps];

  for (let i = 0; i < allOps.length; i += 450) {
    const chunk = allOps.slice(i, i + 450);
    const batch = writeBatch(db);
    chunk.forEach((op) => {
      if (op.type === 'delete') {
        batch.delete(op.ref);
      } else {
        batch.update(op.ref, op.data);
      }
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'students');
    }
  }

  return {
    deletedStudents: uniqueIds.length,
    deletedLinkedRecords: linkedOps.length,
  };
}

// Create or update Teacher in Firestore
export async function saveTeacherToFirestore(
  teacher: Omit<Teacher, 'id'> & { id?: string },
  isEdit: boolean
): Promise<Teacher> {
  const docId =
    isEdit && teacher.id
      ? teacher.id
      : `tch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const normalizedStaffId = teacher.staffId.trim().toUpperCase();

  // Strictly prevent duplicate Staff IDs in Firestore
  const isDuplicate = await checkDuplicateStaffId(
    normalizedStaffId,
    isEdit ? docId : undefined
  );
  if (isDuplicate) {
    throw new Error(
      `Duplicate Staff ID: "${normalizedStaffId}" is already assigned to another faculty member.`
    );
  }

  const now = new Date().toISOString();
  const payload: Teacher = {
    ...teacher,
    id: docId,
    staffId: normalizedStaffId,
    fullName: teacher.fullName.trim(),
    email: teacher.email.trim().toLowerCase(),
    phone: teacher.phone.trim(),
    address: teacher.address.trim(),
    qualifications: teacher.qualifications.trim(),
    subjects: teacher.subjects.filter(Boolean),
    assignedClasses: teacher.assignedClasses.filter(Boolean),
    createdAt: isEdit ? teacher.createdAt || now : now,
    updatedAt: now,
  };

  try {
    const ref = doc(db, 'teachers', docId);
    if (isEdit) {
      await updateDoc(ref, stripUndefined(payload));
    } else {
      await setDoc(ref, stripUndefined(payload));
    }
    return payload;
  } catch (err) {
    handleFirestoreError(
      err,
      isEdit ? OperationType.UPDATE : OperationType.CREATE,
      `teachers/${docId}`
    );
  }
}

// Update teacher employment status (Director only for Deactivated/Active changes)
export async function updateTeacherStatusInFirestore(
  teacherId: string,
  employmentStatus: 'Active' | 'On Leave' | 'Deactivated'
): Promise<void> {
  try {
    const ref = doc(db, 'teachers', teacherId);
    await updateDoc(ref, {
      employmentStatus,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `teachers/${teacherId}`);
  }
}

// Permanently delete a teacher and remove them from class assignments (form/subject), timetable, and linked staff RBAC accounts.
// Preserves all students, marks (academics), attendance, and report sheets (resultReviews).
export async function deleteTeacherFromFirestore(
  teacher: Pick<Teacher, 'id' | 'staffId' | 'fullName' | 'email'>,
  callerUid?: string
): Promise<{
  clearedClasses: number;
  deletedSubjectAssignments: number;
  clearedTimetableSlots: number;
  deletedRbacAccounts: number;
}> {
  if (!teacher.id) {
    return {
      clearedClasses: 0,
      deletedSubjectAssignments: 0,
      clearedTimetableSlots: 0,
      deletedRbacAccounts: 0,
    };
  }

  const normalizedEmail = (teacher.email || '').trim().toLowerCase();
  const normalizedName = (teacher.fullName || '').trim().toLowerCase();
  const now = new Date().toISOString();

  type BatchOp =
    | { type: 'delete'; ref: ReturnType<typeof doc> }
    | { type: 'update'; ref: ReturnType<typeof doc>; data: Record<string, any> };

  const opsMap = new Map<string, BatchOp>();
  let clearedClasses = 0;
  let deletedSubjectAssignments = 0;
  let clearedTimetableSlots = 0;
  let deletedRbacAccounts = 0;

  // 1. Clear form teacher assignment on any matching classes
  try {
    const classesSnap = await getDocs(collection(db, 'classes'));
    classesSnap.docs.forEach((d) => {
      const data = d.data() as Record<string, any>;
      const matchesId = data.formTeacherId === teacher.id;
      const matchesName =
        Boolean(normalizedName) &&
        typeof data.formTeacherName === 'string' &&
        data.formTeacherName.trim().toLowerCase() === normalizedName;
      if (matchesId || matchesName) {
        opsMap.set(d.ref.path, {
          type: 'update',
          ref: d.ref,
          data: {
            formTeacherId: '',
            formTeacherName: 'Unassigned',
            updatedAt: now,
          },
        });
        clearedClasses += 1;
      }
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'classes');
  }

  // 2. Remove subject-teacher assignments referencing this teacher
  try {
    const subjSnap = await getDocs(collection(db, 'subjectAssignments'));
    subjSnap.docs.forEach((d) => {
      const data = d.data() as Record<string, any>;
      const matchesId = data.teacherId === teacher.id;
      const matchesEmail =
        Boolean(normalizedEmail) &&
        typeof data.teacherEmail === 'string' &&
        data.teacherEmail.trim().toLowerCase() === normalizedEmail;
      const matchesName =
        Boolean(normalizedName) &&
        typeof data.teacherName === 'string' &&
        data.teacherName.trim().toLowerCase() === normalizedName;
      if (matchesId || matchesEmail || matchesName) {
        opsMap.set(d.ref.path, { type: 'delete', ref: d.ref });
        deletedSubjectAssignments += 1;
      }
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'subjectAssignments');
  }

  // 3. Clear deleted teacher from timetable slots (keeping scheduled periods intact and satisfying isValidTimetableSlot)
  if (normalizedName) {
    try {
      const ttSnap = await getDocs(collection(db, 'timetable'));
      ttSnap.docs.forEach((d) => {
        const data = d.data() as Record<string, any>;
        if (
          !data.isBreak &&
          typeof data.teacherName === 'string' &&
          data.teacherName.trim().toLowerCase() === normalizedName
        ) {
          opsMap.set(d.ref.path, {
            type: 'update',
            ref: d.ref,
            data: {
              teacherName: 'Unassigned',
            },
          });
          clearedTimetableSlots += 1;
        }
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'timetable');
    }
  }

  // 4. Remove linked teacher RBAC accounts (users & staffInvites) matching this teacher's email
  if (normalizedEmail && normalizedEmail !== 'patrickpercy1989@gmail.com') {
    for (const rbacCol of ['users', 'staffInvites'] as const) {
      try {
        const rbacSnap = await getDocs(collection(db, rbacCol));
        rbacSnap.docs.forEach((d) => {
          const data = d.data() as Record<string, any>;
          const docEmail =
            typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
          if (
            docEmail === normalizedEmail &&
            data.role === 'teacher' &&
            (rbacCol !== 'users' || d.id !== callerUid)
          ) {
            opsMap.set(d.ref.path, { type: 'delete', ref: d.ref });
            deletedRbacAccounts += 1;
          }
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, rbacCol);
      }
    }
  }

  // 5. Delete the teacher document itself
  const teacherRef = doc(db, 'teachers', teacher.id);
  opsMap.set(teacherRef.path, { type: 'delete', ref: teacherRef });

  const allOps = Array.from(opsMap.values());
  for (let i = 0; i < allOps.length; i += 450) {
    const chunk = allOps.slice(i, i + 450);
    const batch = writeBatch(db);
    chunk.forEach((op) => {
      if (op.type === 'delete') {
        batch.delete(op.ref);
      } else {
        batch.update(op.ref, op.data);
      }
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `teachers/${teacher.id}`);
    }
  }

  return {
    clearedClasses,
    deletedSubjectAssignments,
    clearedTimetableSlots,
    deletedRbacAccounts,
  };
}

// Seed sample students into Firestore when collection is empty
export async function seedSampleStudentsToFirestore(): Promise<void> {
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    SAMPLE_STUDENTS.forEach((student) => {
      const ref = doc(db, 'students', student.id);
      batch.set(
        ref,
        stripUndefined({
          ...student,
          createdAt: now,
          updatedAt: now,
        })
      );
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'students');
  }
}

// Seed sample teachers into Firestore when collection is empty
export async function seedSampleTeachersToFirestore(): Promise<void> {
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    SAMPLE_TEACHERS.forEach((teacher) => {
      const ref = doc(db, 'teachers', teacher.id);
      batch.set(
        ref,
        stripUndefined({
          ...teacher,
          createdAt: now,
          updatedAt: now,
        })
      );
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'teachers');
  }
}

function sanitizeIdPart(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

function inferTeacherRoleType(
  title?: string,
  fallback: Teacher['roleType'] = 'Subject Teacher'
): Teacher['roleType'] {
  const lower = (title || '').toLowerCase();
  if (lower.includes('head of department') || lower.includes('hod')) return 'Head of Department';
  if (lower.includes('form teacher')) return 'Form Teacher';
  if (lower.includes('vice principal')) return 'Vice Principal';
  if (lower.includes('subject teacher')) return 'Subject Teacher';
  return fallback;
}

// Sync a teacher provisioned or updated in Settings > Staff & RBAC Accounts into /teachers and /subjectAssignments
export async function syncProvisionedTeacherToFirestore(params: {
  displayName: string;
  email: string;
  phone?: string;
  title?: string;
  assignedClasses: string[];
  subjects: string[];
  classesList: SchoolClass[];
}): Promise<void> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const trimmedName = params.displayName.trim();
  if (!normalizedEmail || !trimmedName) return;

  const cleanClasses = Array.from(
    new Set(params.assignedClasses.map((c) => c.trim()).filter(Boolean))
  ).slice(0, 30);
  const cleanSubjects = Array.from(
    new Set(params.subjects.map((s) => s.trim()).filter(Boolean))
  ).slice(0, 30);
  const now = new Date().toISOString();

  let allTeachers: Teacher[] = [];
  try {
    const tchSnap = await getDocs(collection(db, 'teachers'));
    allTeachers = tchSnap.docs.map((d) => ({ ...(d.data() as Teacher), id: d.id }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'teachers');
  }

  const existingTeacher = allTeachers.find(
    (t) => (t.email || '').trim().toLowerCase() === normalizedEmail
  );

  const teacherId =
    existingTeacher?.id || `tch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const safePhone =
    (params.phone || '').trim() || existingTeacher?.phone || '+234 800 000 0000';
  const safeQualifications =
    existingTeacher?.qualifications || (params.title || '').trim() || 'Teaching Staff';

  const teacherPayload: Teacher = {
    id: teacherId,
    staffId: existingTeacher?.staffId || generateUniqueStaffId(allTeachers),
    fullName: trimmedName.slice(0, 120),
    gender: existingTeacher?.gender || 'Male',
    phone: safePhone.slice(0, 30),
    email: normalizedEmail.slice(0, 128),
    address: (existingTeacher?.address || 'School Campus Staff Directory').slice(0, 300),
    qualifications: safeQualifications.slice(0, 250),
    subjects: cleanSubjects,
    assignedClasses: cleanClasses,
    roleType: inferTeacherRoleType(
      params.title,
      existingTeacher?.roleType || 'Subject Teacher'
    ),
    employmentDate: existingTeacher?.employmentDate || now.slice(0, 10),
    employmentStatus: existingTeacher?.employmentStatus || 'Active',
    createdAt: existingTeacher?.createdAt || now,
    updatedAt: now,
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'teachers', teacherId), stripUndefined(teacherPayload));

    if (cleanClasses.length > 0 && cleanSubjects.length > 0) {
      cleanClasses.forEach((clsName) => {
        const clsObj = params.classesList.find(
          (c) => c.name.trim().toLowerCase() === clsName.toLowerCase()
        );
        const classSubjects = clsObj?.subjects || [];
        const matchedForClass =
          classSubjects.length > 0
            ? cleanSubjects.filter((s) =>
                classSubjects.some((cs) => cs.trim().toLowerCase() === s.toLowerCase())
              )
            : [];
        const subjectsToAssign = matchedForClass.length > 0 ? matchedForClass : cleanSubjects;

        subjectsToAssign.forEach((subj) => {
          const assignId = `asgn_${sanitizeIdPart(clsName)}_${sanitizeIdPart(subj)}`.slice(0, 128);
          batch.set(doc(db, 'subjectAssignments', assignId), {
            id: assignId,
            className: clsName.slice(0, 60),
            subject: subj.slice(0, 100),
            teacherId,
            teacherName: trimmedName.slice(0, 120),
            teacherEmail: normalizedEmail.slice(0, 128),
            updatedAt: now,
          });
        });
      });
    }

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `teachers/${teacherId}`);
  }
}

