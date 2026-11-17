import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
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
  AcademicTerm,
  FeeAuditLog,
  FeeCategory,
  FeeDeletionLog,
  FeePayment,
  FeeScheduleItem,
  ManualPaymentMethod,
  SchoolClass,
  SchoolSetting,
  Student,
  StudentFee,
  UserProfile,
  UserRole,
} from '../types';
import { DEFAULT_FEE_CATEGORIES } from '../data/sampleData';
import { extractFriendlyError } from './schoolService';
import {
  doesStudentBelongToClass,
  inferSectionFromClassName,
  SECTION_ORDER,
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

export function sanitizeFeeIdPart(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

export function formatNaira(amount: number): string {
  const num = Number.isFinite(amount) ? amount : 0;
  return '₦' + Math.round(num).toLocaleString('en-NG');
}

// jsPDF built-in Helvetica font does not contain the Unicode ₦ (U+20A6) glyph
export function formatPdfNaira(amount: number): string {
  const num = Number.isFinite(amount) ? amount : 0;
  return 'NGN ' + Math.round(num).toLocaleString('en-NG');
}

export function getTodayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isFeeOverdue(fee: Pick<StudentFee, 'balance' | 'dueDate'>, todayYmd = getTodayYmd()): boolean {
  const due = (fee.dueDate || '').trim();
  return fee.balance > 0 && due.length >= 8 && todayYmd > due;
}

export interface InstallmentHistoryEntry {
  payment: FeePayment;
  installmentNumber: number | null;
  cumulativePaidAfter: number;
  runningBalanceAfter: number;
}

export function computeInstallmentHistoryForFee(
  fee: Pick<StudentFee, 'amountDue'>,
  paymentsForFee: FeePayment[]
): InstallmentHistoryEntry[] {
  const sorted = [...paymentsForFee].sort(
    (a, b) =>
      (a.paymentDate || '').localeCompare(b.paymentDate || '') ||
      (a.createdAt || '').localeCompare(b.createdAt || '') ||
      a.id.localeCompare(b.id)
  );

  let cumulative = 0;
  let seq = 0;
  return sorted.map((p) => {
    const isActive = !p.isVoided && p.amount > 0;
    if (isActive) {
      seq += 1;
      cumulative += p.amount;
    }
    return {
      payment: p,
      installmentNumber: isActive ? seq : null,
      cumulativePaidAfter: cumulative,
      runningBalanceAfter: Math.max(0, fee.amountDue - cumulative),
    };
  });
}

export function buildFeeScheduleId(
  session: string,
  term: AcademicTerm,
  className: string,
  categoryId: string
): string {
  return `fsched_${sanitizeFeeIdPart(session)}_${sanitizeFeeIdPart(term)}_${sanitizeFeeIdPart(className)}_${sanitizeFeeIdPart(categoryId)}`.slice(
    0,
    128
  );
}

export function buildStudentFeeId(
  studentId: string,
  session: string,
  term: AcademicTerm,
  categoryId: string
): string {
  return `sfee_${sanitizeFeeIdPart(studentId)}_${sanitizeFeeIdPart(session)}_${sanitizeFeeIdPart(term)}_${sanitizeFeeIdPart(categoryId)}`.slice(
    0,
    128
  );
}

export function generateUniqueReceiptNumber(
  term: AcademicTerm,
  existingPayments: FeePayment[]
): string {
  const existingSet = new Set(existingPayments.map((p) => p.receiptNo));
  const termCode = term === 'First Term' ? 'T1' : term === 'Second Term' ? 'T2' : 'T3';
  const year = new Date().getFullYear();

  for (let attempt = 0; attempt < 25; attempt++) {
    const rand = Math.floor(100000 + Math.random() * 900000);
    const candidate = `RCT/${year}/${termCode}-${rand}`;
    if (!existingSet.has(candidate)) {
      return candidate;
    }
  }
  return `RCT/${year}/${termCode}-${Date.now().toString().slice(-8)}`;
}

// ==================== SUBSCRIPTIONS ====================

export function subscribeFeeCategories(
  onData: (categories: FeeCategory[], isSeededInFirestore: boolean) => void,
  onError: (msg: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'feeCategories'),
    (snap) => {
      if (snap.empty) {
        onData(DEFAULT_FEE_CATEGORIES, false);
        return;
      }
      const list = snap.docs.map((d) => ({ ...(d.data() as FeeCategory), id: d.id }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      onData(list, true);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'feeCategories');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load fee categories.'));
      }
    }
  );
}

export function subscribeFeeSchedules(
  onData: (schedules: FeeScheduleItem[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'feeSchedules'),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as FeeScheduleItem), id: d.id }));
      list.sort(
        (a, b) =>
          a.className.localeCompare(b.className) || a.categoryName.localeCompare(b.categoryName)
      );
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'feeSchedules');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load class fee schedules.'));
      }
    }
  );
}

export function subscribeStudentFees(
  role: UserRole,
  currentUser: UserProfile | null,
  authEmail: string | null | undefined,
  onData: (fees: StudentFee[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const colRef = collection(db, 'studentFees');

  if (role === 'teacher' || role === 'head_teacher') {
    onData([]);
    return () => {};
  }

  if (role === 'parent') {
    const parentEmail = (authEmail || currentUser?.email || '').trim().toLowerCase();
    const linkedIds = (currentUser?.linkedStudentIds || []).filter(Boolean);

    if (parentEmail) {
      const q = query(colRef, where('guardianEmail', '==', parentEmail));
      return onSnapshot(
        q,
        (snap) => {
          onData(snap.docs.map((d) => ({ ...(d.data() as StudentFee), id: d.id })));
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'studentFees');
          } catch (w) {
            onError(extractFriendlyError(w, 'Failed to load ward fee records.'));
          }
        }
      );
    }

    if (linkedIds.length > 0) {
      const q = query(colRef, where('studentId', 'in', linkedIds.slice(0, 10)));
      return onSnapshot(
        q,
        (snap) => {
          onData(snap.docs.map((d) => ({ ...(d.data() as StudentFee), id: d.id })));
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'studentFees');
          } catch (w) {
            onError(extractFriendlyError(w, 'Failed to load ward fee records.'));
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
      onData(snap.docs.map((d) => ({ ...(d.data() as StudentFee), id: d.id })));
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'studentFees');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load student fees.'));
      }
    }
  );
}

export function subscribeFeePayments(
  role: UserRole,
  currentUser: UserProfile | null,
  authEmail: string | null | undefined,
  onData: (payments: FeePayment[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const colRef = collection(db, 'feePayments');

  if (role === 'teacher' || role === 'head_teacher') {
    onData([]);
    return () => {};
  }

  if (role === 'parent') {
    const parentEmail = (authEmail || currentUser?.email || '').trim().toLowerCase();
    const linkedIds = (currentUser?.linkedStudentIds || []).filter(Boolean);

    if (parentEmail) {
      const q = query(colRef, where('guardianEmail', '==', parentEmail));
      return onSnapshot(
        q,
        (snap) => {
          const list = snap.docs.map((d) => ({ ...(d.data() as FeePayment), id: d.id }));
          list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          onData(list);
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'feePayments');
          } catch (w) {
            onError(extractFriendlyError(w, 'Failed to load payment receipts.'));
          }
        }
      );
    }

    if (linkedIds.length > 0) {
      const q = query(colRef, where('studentId', 'in', linkedIds.slice(0, 10)));
      return onSnapshot(
        q,
        (snap) => {
          const list = snap.docs.map((d) => ({ ...(d.data() as FeePayment), id: d.id }));
          list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          onData(list);
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'feePayments');
          } catch (w) {
            onError(extractFriendlyError(w, 'Failed to load payment receipts.'));
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
      const list = snap.docs.map((d) => ({ ...(d.data() as FeePayment), id: d.id }));
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'feePayments');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load payment records.'));
      }
    }
  );
}

export function subscribeFeeDeletionLogs(
  role: UserRole,
  onData: (logs: FeeDeletionLog[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  if (role !== 'director') {
    onData([]);
    return () => {};
  }

  return onSnapshot(
    collection(db, 'feeDeletionLogs'),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as FeeDeletionLog), id: d.id }));
      list.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'feeDeletionLogs');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load deleted fee audit entries.'));
      }
    }
  );
}

export function subscribeFeeAuditLogs(
  role: UserRole,
  onData: (logs: FeeAuditLog[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  if (role !== 'director') {
    onData([]);
    return () => {};
  }

  return onSnapshot(
    collection(db, 'feeAuditLogs'),
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as FeeAuditLog), id: d.id }));
      list.sort((a, b) => (b.performedAt || '').localeCompare(a.performedAt || ''));
      onData(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'feeAuditLogs');
      } catch (w) {
        onError(extractFriendlyError(w, 'Failed to load fee edit & void audit logs.'));
      }
    }
  );
}

// ==================== MUTATIONS ====================

export async function seedDefaultFeeCategoriesToFirestore(): Promise<void> {
  const now = new Date().toISOString();
  try {
    const batch = writeBatch(db);
    DEFAULT_FEE_CATEGORIES.forEach((cat) => {
      batch.set(
        doc(db, 'feeCategories', cat.id),
        stripUndefined({ ...cat, createdAt: now, updatedAt: now })
      );
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'feeCategories');
  }
}

export async function saveFeeCategoryToFirestore(category: {
  id?: string;
  name: string;
  description?: string;
  isActive: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  const docId =
    category.id ||
    `cat-${sanitizeFeeIdPart(category.name).toLowerCase()}-${Date.now().toString().slice(-4)}`;
  try {
    await setDoc(
      doc(db, 'feeCategories', docId),
      stripUndefined({
        id: docId,
        name: category.name.trim(),
        description: category.description?.trim() || '',
        isActive: category.isActive,
        createdAt: now,
        updatedAt: now,
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `feeCategories/${docId}`);
  }
}

export async function deleteFeeCategoryFromFirestore(categoryId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'feeCategories', categoryId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `feeCategories/${categoryId}`);
  }
}

export async function saveFeeScheduleItemToFirestore(
  item: Omit<FeeScheduleItem, 'id' | 'updatedAt' | 'updatedBy'>,
  updatedBy: string
): Promise<void> {
  if (!Number.isFinite(item.amount) || item.amount <= 0) {
    throw new Error('Fee amount must be greater than ₦0.');
  }
  const docId = buildFeeScheduleId(item.session, item.term, item.className, item.categoryId);
  try {
    await setDoc(
      doc(db, 'feeSchedules', docId),
      stripUndefined({
        ...item,
        id: docId,
        amount: Math.round(item.amount),
        updatedBy,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `feeSchedules/${docId}`);
  }
}

export async function deleteFeeScheduleItemFromFirestore(scheduleId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'feeSchedules', scheduleId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `feeSchedules/${scheduleId}`);
  }
}

export async function assignSingleFeeToStudentInFirestore(params: {
  student: Student;
  session: string;
  term: AcademicTerm;
  category: FeeCategory;
  amountDue: number;
  dueDate: string;
  assignedBy: string;
  existingStudentFees: StudentFee[];
}): Promise<StudentFee> {
  const { student, session, term, category, amountDue, dueDate, assignedBy, existingStudentFees } =
    params;

  if (!Number.isFinite(amountDue) || amountDue <= 0) {
    throw new Error('Assigned fee amount must be greater than ₦0.');
  }

  const docId = buildStudentFeeId(student.id, session, term, category.id);
  if (existingStudentFees.some((f) => f.id === docId)) {
    throw new Error(
      `${category.name} is already assigned to ${student.fullName} for ${term} (${session}).`
    );
  }

  const now = new Date().toISOString();
  const roundedAmount = Math.round(amountDue);

  // Strictly initialized as unpaid with 0 amountPaid (never marked paid without payment records)
  const payload: StudentFee = {
    id: docId,
    studentId: student.id,
    studentName: student.fullName,
    admissionNo: student.admissionNo,
    guardianEmail: (student.guardianEmail || '').trim().toLowerCase(),
    className: student.className,
    session,
    term,
    categoryId: category.id,
    categoryName: category.name,
    amountDue: roundedAmount,
    amountPaid: 0,
    balance: roundedAmount,
    status: 'Pending',
    dueDate,
    assignedBy,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await setDoc(doc(db, 'studentFees', docId), stripUndefined(payload));
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `studentFees/${docId}`);
  }
}

export async function bulkAssignClassScheduleToStudentsInFirestore(params: {
  students: Student[];
  schedules: FeeScheduleItem[];
  session: string;
  term: AcademicTerm;
  className: string;
  assignedBy: string;
  existingStudentFees: StudentFee[];
}): Promise<{ assignedCount: number; skippedCount: number }> {
  const { students, schedules, session, term, className, assignedBy, existingStudentFees } = params;

  const classStudents = students.filter(
    (s) => s.className === className && s.status === 'Active'
  );
  const classSchedules = schedules.filter(
    (sc) => sc.className === className && sc.session === session && sc.term === term
  );

  if (classStudents.length === 0) {
    throw new Error(`No active students found in ${className}.`);
  }
  if (classSchedules.length === 0) {
    throw new Error(
      `No fee schedule items configured for ${className} in ${term} (${session}).`
    );
  }

  const existingIds = new Set(existingStudentFees.map((f) => f.id));
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  let assignedCount = 0;
  let skippedCount = 0;

  classStudents.forEach((student) => {
    classSchedules.forEach((sched) => {
      const docId = buildStudentFeeId(student.id, session, term, sched.categoryId);
      if (existingIds.has(docId)) {
        skippedCount += 1;
        return;
      }
      const rounded = Math.round(sched.amount);
      const payload: StudentFee = {
        id: docId,
        studentId: student.id,
        studentName: student.fullName,
        admissionNo: student.admissionNo,
        guardianEmail: (student.guardianEmail || '').trim().toLowerCase(),
        className: student.className,
        session,
        term,
        categoryId: sched.categoryId,
        categoryName: sched.categoryName,
        amountDue: rounded,
        amountPaid: 0,
        balance: rounded,
        status: 'Pending',
        dueDate: sched.dueDate,
        assignedBy,
        createdAt: now,
        updatedAt: now,
      };
      batch.set(doc(db, 'studentFees', docId), stripUndefined(payload));
      assignedCount += 1;
    });
  });

  if (assignedCount === 0) {
    return { assignedCount: 0, skippedCount };
  }

  try {
    await batch.commit();
    return { assignedCount, skippedCount };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'studentFees');
  }
}

export async function deleteUnpaidStudentFeeFromFirestore(fee: StudentFee): Promise<void> {
  if (fee.amountPaid > 0) {
    throw new Error('Cannot remove a fee item that already has recorded payments.');
  }
  try {
    await deleteDoc(doc(db, 'studentFees', fee.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `studentFees/${fee.id}`);
  }
}

export async function deleteSingleFeePaymentWithAuditInFirestore(params: {
  studentFee: StudentFee;
  payment: FeePayment;
  student?: Student;
  allStudentFeesForStudent: StudentFee[];
  existingPayments: FeePayment[];
  reason: string;
  deletedBy: string;
  deletedByUid: string;
}): Promise<{ updatedFee: StudentFee; log: FeeDeletionLog }> {
  const {
    studentFee,
    payment,
    student,
    allStudentFeesForStudent,
    existingPayments,
    reason,
    deletedBy,
    deletedByUid,
  } = params;

  const trimmedReason = reason.trim().slice(0, 300);
  if (!trimmedReason) {
    throw new Error('Please enter a reason for deleting this payment.');
  }

  const remainingForFee = existingPayments.filter(
    (p) => p.studentFeeId === studentFee.id && p.id !== payment.id
  );
  const newTotalPaid = Math.min(
    studentFee.amountDue,
    remainingForFee.reduce((sum, p) => sum + (p.amount > 0 ? p.amount : 0), 0)
  );
  const newBalance = Math.max(0, studentFee.amountDue - newTotalPaid);
  const newStatus: StudentFee['status'] =
    newTotalPaid <= 0 ? 'Pending' : newBalance === 0 ? 'Paid' : 'Partial';

  const now = new Date().toISOString();
  const logId = `fdel_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

  const logEntry: FeeDeletionLog = {
    id: logId,
    deletionType: 'payment',
    studentId: studentFee.studentId,
    studentName: studentFee.studentName,
    admissionNo: studentFee.admissionNo,
    className: studentFee.className,
    session: studentFee.session,
    term: studentFee.term,
    studentFeeId: studentFee.id,
    categoryId: studentFee.categoryId,
    categoryName: studentFee.categoryName,
    paymentId: payment.id,
    receiptNo: payment.receiptNo,
    amount: payment.amount,
    expectedAmount: studentFee.amountDue,
    paidAmount: newTotalPaid,
    paymentMethod: payment.paymentMethod,
    paymentDate: payment.paymentDate,
    reason: trimmedReason,
    deletedBy: (deletedBy || 'School Director').slice(0, 120),
    deletedByUid,
    deletedAt: now,
  };

  const batch = writeBatch(db);
  batch.delete(doc(db, 'feePayments', payment.id));
  batch.update(doc(db, 'studentFees', studentFee.id), {
    amountPaid: newTotalPaid,
    balance: newBalance,
    status: newStatus,
    updatedAt: now,
  });

  if (student) {
    const otherFees = allStudentFeesForStudent.filter((f) => f.id !== studentFee.id);
    const totalDueAll =
      studentFee.amountDue + otherFees.reduce((s, f) => s + f.amountDue, 0);
    const totalPaidAll =
      newTotalPaid +
      otherFees.reduce((s, f) => {
        const pSum = existingPayments
          .filter((p) => p.studentFeeId === f.id && p.id !== payment.id)
          .reduce((acc, p) => acc + p.amount, 0);
        return s + pSum;
      }, 0);

    const overallStatus: Student['feeStatus'] =
      totalPaidAll <= 0
        ? 'Pending'
        : totalPaidAll >= totalDueAll
        ? 'Paid'
        : 'Partial';

    batch.update(doc(db, 'students', student.id), {
      feeStatus: overallStatus,
      updatedAt: now,
    });
  }

  batch.set(doc(db, 'feeDeletionLogs', logId), stripUndefined(logEntry));

  try {
    await batch.commit();
    return {
      updatedFee: {
        ...studentFee,
        amountPaid: newTotalPaid,
        balance: newBalance,
        status: newStatus,
        updatedAt: now,
      },
      log: logEntry,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `feePayments/${payment.id}`);
  }
}

export async function deleteStudentFeeItemWithAuditInFirestore(params: {
  studentFee: StudentFee;
  student?: Student;
  allStudentFeesForStudent: StudentFee[];
  existingPayments: FeePayment[];
  reason: string;
  deletedBy: string;
  deletedByUid: string;
}): Promise<{ deletedPaymentsCount: number; log: FeeAuditLog }> {
  const {
    studentFee,
    student,
    allStudentFeesForStudent,
    existingPayments,
    reason,
    deletedBy,
    deletedByUid,
  } = params;

  const trimmedReason = reason.trim().slice(0, 300);
  if (!trimmedReason) {
    throw new Error('Please enter a reason for deleting this fee item.');
  }

  const activePayments = existingPayments.filter(
    (p) => p.studentFeeId === studentFee.id && !p.isVoided
  );
  if (activePayments.length > 0) {
    throw new Error(
      'Cannot delete this fee item because it has active recorded payments. Void all active payments first.'
    );
  }

  const voidedPaymentsForFee = existingPayments.filter(
    (p) => p.studentFeeId === studentFee.id && p.isVoided
  );
  const rawReceipts = voidedPaymentsForFee.map((p) => `${p.receiptNo} (Voided)`).join(', ');
  const receiptNoSummary =
    rawReceipts.length === 0
      ? 'No Active Payments'
      : rawReceipts.length > 480
      ? `${rawReceipts.slice(0, 477)}...`
      : rawReceipts;

  const now = new Date().toISOString();
  const logId = `faud_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const actorName = (deletedBy || 'School Director').slice(0, 120);

  const auditEntry: FeeAuditLog = {
    id: logId,
    actionType: 'delete_fee_item',
    studentId: studentFee.studentId,
    studentName: studentFee.studentName,
    admissionNo: studentFee.admissionNo,
    className: studentFee.className,
    session: studentFee.session,
    term: studentFee.term,
    studentFeeId: studentFee.id,
    categoryId: studentFee.categoryId,
    categoryName: studentFee.categoryName,
    receiptNo: receiptNoSummary,
    reason: trimmedReason,
    oldValues: {
      expectedAmount: studentFee.amountDue,
      paidAmount: studentFee.amountPaid,
      balance: studentFee.balance,
      status: studentFee.status,
    },
    newValues: {
      expectedAmount: 0,
      paidAmount: 0,
      balance: 0,
      status: 'Deleted',
    },
    performedBy: actorName,
    performedByUid: deletedByUid,
    performedAt: now,
  };

  const batch = writeBatch(db);
  batch.delete(doc(db, 'studentFees', studentFee.id));

  if (student) {
    const remainingFees = allStudentFeesForStudent.filter((f) => f.id !== studentFee.id);
    const totalDueAll = remainingFees.reduce((s, f) => s + f.amountDue, 0);
    const totalPaidAll = remainingFees.reduce((s, f) => {
      const pSum = existingPayments
        .filter((p) => p.studentFeeId === f.id && !p.isVoided)
        .reduce((acc, p) => acc + p.amount, 0);
      return s + pSum;
    }, 0);

    const overallStatus: Student['feeStatus'] =
      totalPaidAll <= 0
        ? 'Pending'
        : totalPaidAll >= totalDueAll
        ? 'Paid'
        : 'Partial';

    batch.update(doc(db, 'students', student.id), {
      feeStatus: overallStatus,
      updatedAt: now,
    });
  }

  batch.set(doc(db, 'feeAuditLogs', logId), stripUndefined(auditEntry));

  try {
    await batch.commit();
    return {
      deletedPaymentsCount: 0,
      log: auditEntry,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `studentFees/${studentFee.id}`);
  }
}

export async function editStudentFeeExpectedAmountWithAuditInFirestore(params: {
  studentFee: StudentFee;
  student?: Student;
  allStudentFeesForStudent: StudentFee[];
  existingPayments: FeePayment[];
  newExpectedAmount: number;
  reason: string;
  editedBy: string;
  editedByUid: string;
}): Promise<{ updatedFee: StudentFee; log: FeeAuditLog }> {
  const {
    studentFee,
    student,
    allStudentFeesForStudent,
    existingPayments,
    newExpectedAmount,
    reason,
    editedBy,
    editedByUid,
  } = params;

  const roundedExpected = Math.round(newExpectedAmount);
  if (!Number.isFinite(roundedExpected) || roundedExpected <= 0) {
    throw new Error('Expected amount must be a positive number greater than ₦0.');
  }
  const trimmedReason = reason.trim().slice(0, 300);
  if (!trimmedReason) {
    throw new Error('Please enter a reason for editing the expected amount.');
  }

  const activePaid = existingPayments
    .filter((p) => p.studentFeeId === studentFee.id && !p.isVoided && p.amount > 0)
    .reduce((sum, p) => sum + p.amount, 0);
  const newBalance = Math.max(0, roundedExpected - activePaid);
  const newStatus: StudentFee['status'] =
    activePaid <= 0 ? 'Pending' : newBalance === 0 ? 'Paid' : 'Partial';

  const now = new Date().toISOString();
  const logId = `faud_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const actorName = (editedBy || 'School Director').slice(0, 120);

  const auditEntry: FeeAuditLog = {
    id: logId,
    actionType: 'edit_expected_amount',
    studentId: studentFee.studentId,
    studentName: studentFee.studentName,
    admissionNo: studentFee.admissionNo,
    className: studentFee.className,
    session: studentFee.session,
    term: studentFee.term,
    studentFeeId: studentFee.id,
    categoryId: studentFee.categoryId,
    categoryName: studentFee.categoryName,
    receiptNo: 'Assigned Fee Item',
    reason: trimmedReason,
    oldValues: {
      expectedAmount: studentFee.amountDue,
      paidAmount: studentFee.amountPaid,
      balance: studentFee.balance,
      status: studentFee.status,
    },
    newValues: {
      expectedAmount: roundedExpected,
      paidAmount: activePaid,
      balance: newBalance,
      status: newStatus,
    },
    performedBy: actorName,
    performedByUid: editedByUid,
    performedAt: now,
  };

  const batch = writeBatch(db);
  batch.update(doc(db, 'studentFees', studentFee.id), {
    amountDue: roundedExpected,
    amountPaid: activePaid,
    balance: newBalance,
    status: newStatus,
    updatedAt: now,
  });

  if (student) {
    const otherFees = allStudentFeesForStudent.filter((f) => f.id !== studentFee.id);
    const totalDueAll = roundedExpected + otherFees.reduce((s, f) => s + f.amountDue, 0);
    const totalPaidAll =
      activePaid +
      otherFees.reduce((s, f) => {
        const pSum = existingPayments
          .filter((p) => p.studentFeeId === f.id && !p.isVoided && p.amount > 0)
          .reduce((acc, p) => acc + p.amount, 0);
        return s + pSum;
      }, 0);

    const overallStatus: Student['feeStatus'] =
      totalPaidAll <= 0
        ? 'Pending'
        : totalPaidAll >= totalDueAll
        ? 'Paid'
        : 'Partial';

    batch.update(doc(db, 'students', student.id), {
      feeStatus: overallStatus,
      updatedAt: now,
    });
  }

  batch.set(doc(db, 'feeAuditLogs', logId), stripUndefined(auditEntry));

  try {
    await batch.commit();
    return {
      updatedFee: {
        ...studentFee,
        amountDue: roundedExpected,
        amountPaid: activePaid,
        balance: newBalance,
        status: newStatus,
        updatedAt: now,
      },
      log: auditEntry,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `studentFees/${studentFee.id}`);
  }
}

export async function editStudentFeeDueDateWithAuditInFirestore(params: {
  studentFee: StudentFee;
  newDueDate: string;
  reason: string;
  editedBy: string;
  editedByUid: string;
}): Promise<{ updatedFee: StudentFee; log: FeeAuditLog }> {
  const { studentFee, newDueDate, reason, editedBy, editedByUid } = params;

  const trimmedDue = newDueDate.trim().slice(0, 20);
  if (trimmedDue && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDue)) {
    throw new Error('Please enter a valid due date (YYYY-MM-DD) or leave it blank.');
  }
  const trimmedReason = reason.trim().slice(0, 300);
  if (!trimmedReason) {
    throw new Error('Please enter a reason for updating the installment due date.');
  }

  const now = new Date().toISOString();
  const logId = `faud_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const actorName = (editedBy || 'School Director').slice(0, 120);

  const auditEntry: FeeAuditLog = {
    id: logId,
    actionType: 'edit_due_date',
    studentId: studentFee.studentId,
    studentName: studentFee.studentName,
    admissionNo: studentFee.admissionNo,
    className: studentFee.className,
    session: studentFee.session,
    term: studentFee.term,
    studentFeeId: studentFee.id,
    categoryId: studentFee.categoryId,
    categoryName: studentFee.categoryName,
    receiptNo: 'Assigned Fee Item',
    reason: trimmedReason,
    oldValues: {
      dueDate: studentFee.dueDate || 'Not set',
      balance: studentFee.balance,
      status: studentFee.status,
    },
    newValues: {
      dueDate: trimmedDue || 'Cleared (None)',
      balance: studentFee.balance,
      status: studentFee.status,
    },
    performedBy: actorName,
    performedByUid: editedByUid,
    performedAt: now,
  };

  const batch = writeBatch(db);
  batch.update(doc(db, 'studentFees', studentFee.id), {
    dueDate: trimmedDue,
    updatedAt: now,
  });
  batch.set(doc(db, 'feeAuditLogs', logId), stripUndefined(auditEntry));

  try {
    await batch.commit();
    return {
      updatedFee: {
        ...studentFee,
        dueDate: trimmedDue,
        updatedAt: now,
      },
      log: auditEntry,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `studentFees/${studentFee.id}`);
  }
}

export async function editFeePaymentWithAuditInFirestore(params: {
  studentFee: StudentFee;
  payment: FeePayment;
  student?: Student;
  allStudentFeesForStudent: StudentFee[];
  existingPayments: FeePayment[];
  amount: number;
  paymentDate: string;
  paymentMethod: ManualPaymentMethod;
  notes: string;
  reason: string;
  editedBy: string;
  editedByUid: string;
}): Promise<{ updatedPayment: FeePayment; updatedFee: StudentFee; log: FeeAuditLog }> {
  const {
    studentFee,
    payment,
    student,
    allStudentFeesForStudent,
    existingPayments,
    amount,
    paymentDate,
    paymentMethod,
    notes,
    reason,
    editedBy,
    editedByUid,
  } = params;

  if (payment.isVoided) {
    throw new Error('Voided payments cannot be edited.');
  }

  const roundedAmount = Math.round(amount);
  if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
    throw new Error('Payment amount must be a positive number greater than ₦0.');
  }
  if (!paymentDate || paymentDate.length !== 10) {
    throw new Error('Please provide a valid payment date (YYYY-MM-DD).');
  }
  const trimmedReason = reason.trim().slice(0, 300);
  if (!trimmedReason) {
    throw new Error('Please enter a reason for editing this payment.');
  }
  const trimmedNotes = notes.trim().slice(0, 300);

  const otherActivePaid = existingPayments
    .filter(
      (p) =>
        p.studentFeeId === studentFee.id &&
        p.id !== payment.id &&
        !p.isVoided &&
        p.amount > 0
    )
    .reduce((sum, p) => sum + p.amount, 0);

  const newTotalPaid = otherActivePaid + roundedAmount;
  const newBalance = Math.max(0, studentFee.amountDue - newTotalPaid);
  const newStatus: StudentFee['status'] =
    newTotalPaid <= 0 ? 'Pending' : newBalance === 0 ? 'Paid' : 'Partial';

  const now = new Date().toISOString();
  const logId = `faud_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const actorName = (editedBy || 'School Director').slice(0, 120);

  const auditEntry: FeeAuditLog = {
    id: logId,
    actionType: 'edit_payment',
    studentId: studentFee.studentId,
    studentName: studentFee.studentName,
    admissionNo: studentFee.admissionNo,
    className: studentFee.className,
    session: studentFee.session,
    term: studentFee.term,
    studentFeeId: studentFee.id,
    categoryId: studentFee.categoryId,
    categoryName: studentFee.categoryName,
    paymentId: payment.id,
    receiptNo: payment.receiptNo,
    reason: trimmedReason,
    oldValues: {
      amount: payment.amount,
      paymentDate: payment.paymentDate,
      paymentMethod: payment.paymentMethod,
      notes: payment.notes || '',
      paidAmount: studentFee.amountPaid,
      balance: studentFee.balance,
      status: studentFee.status,
    },
    newValues: {
      amount: roundedAmount,
      paymentDate,
      paymentMethod,
      notes: trimmedNotes,
      paidAmount: newTotalPaid,
      balance: newBalance,
      status: newStatus,
    },
    performedBy: actorName,
    performedByUid: editedByUid,
    performedAt: now,
  };

  const batch = writeBatch(db);
  batch.update(doc(db, 'feePayments', payment.id), {
    amount: roundedAmount,
    paymentDate,
    paymentMethod,
    notes: trimmedNotes,
    isEdited: true,
    editedAt: now,
    editedBy: actorName,
    editReason: trimmedReason,
  });

  batch.update(doc(db, 'studentFees', studentFee.id), {
    amountPaid: newTotalPaid,
    balance: newBalance,
    status: newStatus,
    updatedAt: now,
  });

  if (student) {
    const otherFees = allStudentFeesForStudent.filter((f) => f.id !== studentFee.id);
    const totalDueAll =
      studentFee.amountDue + otherFees.reduce((s, f) => s + f.amountDue, 0);
    const totalPaidAll =
      newTotalPaid +
      otherFees.reduce((s, f) => {
        const pSum = existingPayments
          .filter((p) => p.studentFeeId === f.id && !p.isVoided && p.amount > 0)
          .reduce((acc, p) => acc + p.amount, 0);
        return s + pSum;
      }, 0);

    const overallStatus: Student['feeStatus'] =
      totalPaidAll <= 0
        ? 'Pending'
        : totalPaidAll >= totalDueAll
        ? 'Paid'
        : 'Partial';

    batch.update(doc(db, 'students', student.id), {
      feeStatus: overallStatus,
      updatedAt: now,
    });
  }

  batch.set(doc(db, 'feeAuditLogs', logId), stripUndefined(auditEntry));

  try {
    await batch.commit();
    return {
      updatedPayment: {
        ...payment,
        amount: roundedAmount,
        paymentDate,
        paymentMethod,
        notes: trimmedNotes,
        isEdited: true,
        editedAt: now,
        editedBy: actorName,
        editReason: trimmedReason,
      },
      updatedFee: {
        ...studentFee,
        amountPaid: newTotalPaid,
        balance: newBalance,
        status: newStatus,
        updatedAt: now,
      },
      log: auditEntry,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `feePayments/${payment.id}`);
  }
}

export async function voidFeePaymentWithAuditInFirestore(params: {
  studentFee: StudentFee;
  payment: FeePayment;
  student?: Student;
  allStudentFeesForStudent: StudentFee[];
  existingPayments: FeePayment[];
  reason: string;
  voidedBy: string;
  voidedByUid: string;
}): Promise<{ updatedPayment: FeePayment; updatedFee: StudentFee; log: FeeAuditLog }> {
  const {
    studentFee,
    payment,
    student,
    allStudentFeesForStudent,
    existingPayments,
    reason,
    voidedBy,
    voidedByUid,
  } = params;

  if (payment.isVoided) {
    throw new Error('This payment has already been voided.');
  }

  const trimmedReason = reason.trim().slice(0, 300);
  if (!trimmedReason) {
    throw new Error('Please enter a reason for voiding this payment.');
  }

  const remainingActivePaid = existingPayments
    .filter(
      (p) =>
        p.studentFeeId === studentFee.id &&
        p.id !== payment.id &&
        !p.isVoided &&
        p.amount > 0
    )
    .reduce((sum, p) => sum + p.amount, 0);

  const newBalance = Math.max(0, studentFee.amountDue - remainingActivePaid);
  const newStatus: StudentFee['status'] =
    remainingActivePaid <= 0 ? 'Pending' : newBalance === 0 ? 'Paid' : 'Partial';

  const now = new Date().toISOString();
  const logId = `faud_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const actorName = (voidedBy || 'School Director').slice(0, 120);

  const auditEntry: FeeAuditLog = {
    id: logId,
    actionType: 'void_payment',
    studentId: studentFee.studentId,
    studentName: studentFee.studentName,
    admissionNo: studentFee.admissionNo,
    className: studentFee.className,
    session: studentFee.session,
    term: studentFee.term,
    studentFeeId: studentFee.id,
    categoryId: studentFee.categoryId,
    categoryName: studentFee.categoryName,
    paymentId: payment.id,
    receiptNo: payment.receiptNo,
    reason: trimmedReason,
    oldValues: {
      amount: payment.amount,
      paymentDate: payment.paymentDate,
      paymentMethod: payment.paymentMethod,
      paidAmount: studentFee.amountPaid,
      balance: studentFee.balance,
      status: studentFee.status,
    },
    newValues: {
      amount: 0,
      paidAmount: remainingActivePaid,
      balance: newBalance,
      status: newStatus,
    },
    performedBy: actorName,
    performedByUid: voidedByUid,
    performedAt: now,
  };

  const batch = writeBatch(db);
  batch.update(doc(db, 'feePayments', payment.id), {
    isVoided: true,
    voidedAt: now,
    voidedBy: actorName,
    voidedByUid,
    voidReason: trimmedReason,
  });

  batch.update(doc(db, 'studentFees', studentFee.id), {
    amountPaid: remainingActivePaid,
    balance: newBalance,
    status: newStatus,
    updatedAt: now,
  });

  if (student) {
    const otherFees = allStudentFeesForStudent.filter((f) => f.id !== studentFee.id);
    const totalDueAll =
      studentFee.amountDue + otherFees.reduce((s, f) => s + f.amountDue, 0);
    const totalPaidAll =
      remainingActivePaid +
      otherFees.reduce((s, f) => {
        const pSum = existingPayments
          .filter((p) => p.studentFeeId === f.id && !p.isVoided && p.amount > 0)
          .reduce((acc, p) => acc + p.amount, 0);
        return s + pSum;
      }, 0);

    const overallStatus: Student['feeStatus'] =
      totalPaidAll <= 0
        ? 'Pending'
        : totalPaidAll >= totalDueAll
        ? 'Paid'
        : 'Partial';

    batch.update(doc(db, 'students', student.id), {
      feeStatus: overallStatus,
      updatedAt: now,
    });
  }

  batch.set(doc(db, 'feeAuditLogs', logId), stripUndefined(auditEntry));

  try {
    await batch.commit();
    return {
      updatedPayment: {
        ...payment,
        isVoided: true,
        voidedAt: now,
        voidedBy: actorName,
        voidedByUid,
        voidReason: trimmedReason,
      },
      updatedFee: {
        ...studentFee,
        amountPaid: remainingActivePaid,
        balance: newBalance,
        status: newStatus,
        updatedAt: now,
      },
      log: auditEntry,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `feePayments/${payment.id}`);
  }
}

export async function recordManualPaymentInFirestore(params: {
  studentFee: StudentFee;
  student?: Student;
  allStudentFeesForStudent: StudentFee[];
  existingPayments: FeePayment[];
  amount: number;
  paymentDate: string;
  paymentMethod: ManualPaymentMethod;
  transactionRef: string;
  notes?: string;
  recordedBy: string;
  recordedByUid: string;
}): Promise<FeePayment> {
  const {
    studentFee,
    student,
    allStudentFeesForStudent,
    existingPayments,
    amount,
    paymentDate,
    paymentMethod,
    transactionRef,
    notes,
    recordedBy,
    recordedByUid,
  } = params;

  const payAmount = Math.round(amount);
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    throw new Error('Payment amount must be greater than ₦0.');
  }
  if (!paymentDate || paymentDate.length !== 10) {
    throw new Error('Please provide a valid payment date (YYYY-MM-DD).');
  }

  // Reconcile paid amount strictly from existing active (non-voided) payment records
  const priorPaid = existingPayments
    .filter((p) => p.studentFeeId === studentFee.id && !p.isVoided && p.amount > 0)
    .reduce((sum, p) => sum + p.amount, 0);
  const currentBalance = Math.max(0, studentFee.amountDue - priorPaid);

  if (currentBalance <= 0) {
    throw new Error('This fee item has already been paid in full.');
  }
  if (payAmount > currentBalance) {
    throw new Error(`Amount is more than the outstanding balance of ${formatNaira(currentBalance)}`);
  }

  const receiptNo = generateUniqueReceiptNumber(studentFee.term, existingPayments);
  const paymentId = `pay_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const now = new Date().toISOString();
  const suffix = receiptNo.split('-').pop() || paymentId.slice(-6);

  const paymentRecord: FeePayment = {
    id: paymentId,
    receiptNo,
    studentFeeId: studentFee.id,
    studentId: studentFee.studentId,
    studentName: studentFee.studentName,
    admissionNo: studentFee.admissionNo,
    guardianEmail: (studentFee.guardianEmail || student?.guardianEmail || '').trim().toLowerCase(),
    className: studentFee.className,
    session: studentFee.session,
    term: studentFee.term,
    categoryId: studentFee.categoryId,
    categoryName: studentFee.categoryName,
    amount: payAmount,
    paymentDate,
    paymentMethod,
    transactionRef:
      transactionRef.trim() ||
      (paymentMethod === 'Cash' ? `CASH-${suffix}` : `REF-${suffix}`),
    notes: notes?.trim() || '',
    recordedBy,
    recordedByUid,
    createdAt: now,
  };

  const newTotalPaid = priorPaid + payAmount;
  const newBalance = Math.max(0, studentFee.amountDue - newTotalPaid);
  const newStatus: StudentFee['status'] =
    newBalance === 0 ? 'Paid' : newTotalPaid > 0 ? 'Partial' : 'Pending';

  const batch = writeBatch(db);
  batch.set(doc(db, 'feePayments', paymentId), stripUndefined(paymentRecord));
  batch.update(doc(db, 'studentFees', studentFee.id), {
    amountPaid: newTotalPaid,
    balance: newBalance,
    status: newStatus,
    updatedAt: now,
  });

  // Also sync overall feeStatus on student profile if student record is present
  if (student) {
    const otherFees = allStudentFeesForStudent.filter((f) => f.id !== studentFee.id);
    const totalDueAll =
      studentFee.amountDue + otherFees.reduce((s, f) => s + f.amountDue, 0);
    const totalPaidAll =
      newTotalPaid +
      otherFees.reduce((s, f) => {
        const pSum = existingPayments
          .filter((p) => p.studentFeeId === f.id && !p.isVoided && p.amount > 0)
          .reduce((acc, p) => acc + p.amount, 0);
        return s + pSum;
      }, 0);

    const overallStatus: Student['feeStatus'] =
      totalPaidAll <= 0
        ? 'Pending'
        : totalPaidAll >= totalDueAll
        ? 'Paid'
        : 'Partial';

    batch.update(doc(db, 'students', student.id), {
      feeStatus: overallStatus,
      updatedAt: now,
    });
  }

  try {
    await batch.commit();
    return paymentRecord;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `feePayments/${paymentId}`);
  }
}

// ==================== STRICT RECONCILIATION & SUMMARIES ====================

export function reconcileStudentFeesWithPayments(
  studentFees: StudentFee[],
  payments: FeePayment[]
): StudentFee[] {
  const paidByFeeId = new Map<string, number>();
  payments.forEach((p) => {
    if (!p.isVoided && p.amount > 0 && p.studentFeeId) {
      paidByFeeId.set(p.studentFeeId, (paidByFeeId.get(p.studentFeeId) || 0) + p.amount);
    }
  });

  return studentFees.map((fee) => {
    const verifiedPaid = paidByFeeId.get(fee.id) || 0;
    const balance = Math.max(0, fee.amountDue - verifiedPaid);
    const status: StudentFee['status'] =
      verifiedPaid <= 0 ? 'Pending' : balance === 0 ? 'Paid' : 'Partial';
    return {
      ...fee,
      amountPaid: verifiedPaid,
      balance,
      status,
    };
  });
}

export interface StatementPaymentRow {
  payment: FeePayment;
  installmentNumber: number | null;
  itemRunningBalance: number;
  statementRunningBalance: number;
}

export interface StudentFeeStatement {
  student: Student;
  fees: StudentFee[];
  payments: FeePayment[];
  paymentEntries: StatementPaymentRow[];
  totalExpected: number;
  totalPaid: number;
  outstandingBalance: number;
  overallStatus: 'Paid' | 'Partial' | 'Pending' | 'No Fees Assigned';
}

export function computeStudentStatement(params: {
  student: Student;
  reconciledFees: StudentFee[];
  payments: FeePayment[];
  session: string;
  term: AcademicTerm | 'All';
}): StudentFeeStatement {
  const { student, reconciledFees, payments, session, term } = params;

  const stuFees = reconciledFees
    .filter(
      (f) =>
        f.studentId === student.id &&
        f.session === session &&
        (term === 'All' || f.term === term)
    )
    .sort((a, b) => a.term.localeCompare(b.term) || a.categoryName.localeCompare(b.categoryName));

  // Chronological date order (ascending) so installments read cleanly with running balances
  const stuPayments = payments
    .filter(
      (p) =>
        p.studentId === student.id &&
        p.session === session &&
        (term === 'All' || p.term === term)
    )
    .sort(
      (a, b) =>
        (a.paymentDate || '').localeCompare(b.paymentDate || '') ||
        (a.createdAt || '').localeCompare(b.createdAt || '') ||
        a.id.localeCompare(b.id)
    );

  const totalExpected = stuFees.reduce((s, f) => s + f.amountDue, 0);
  const totalPaid = stuFees.reduce((s, f) => s + f.amountPaid, 0);
  const outstandingBalance = Math.max(0, totalExpected - totalPaid);

  const feeById = new Map(stuFees.map((f) => [f.id, f]));
  const paidPerFee = new Map<string, number>();
  const seqPerFee = new Map<string, number>();
  let cumulativeStatementPaid = 0;

  const paymentEntries: StatementPaymentRow[] = stuPayments.map((p) => {
    const isActive = !p.isVoided && p.amount > 0;
    const feeObj = feeById.get(p.studentFeeId);
    const feeExpected = feeObj?.amountDue ?? 0;

    let seq: number | null = null;
    if (isActive) {
      seq = (seqPerFee.get(p.studentFeeId) || 0) + 1;
      seqPerFee.set(p.studentFeeId, seq);
      paidPerFee.set(p.studentFeeId, (paidPerFee.get(p.studentFeeId) || 0) + p.amount);
      cumulativeStatementPaid += p.amount;
    }

    const itemPaidSoFar = paidPerFee.get(p.studentFeeId) || 0;
    const itemRunningBalance = feeObj ? Math.max(0, feeExpected - itemPaidSoFar) : 0;
    const statementRunningBalance = Math.max(0, totalExpected - cumulativeStatementPaid);

    return {
      payment: p,
      installmentNumber: seq,
      itemRunningBalance,
      statementRunningBalance,
    };
  });

  let overallStatus: StudentFeeStatement['overallStatus'] = 'No Fees Assigned';
  if (stuFees.length > 0) {
    overallStatus =
      totalPaid <= 0 ? 'Pending' : outstandingBalance === 0 ? 'Paid' : 'Partial';
  }

  return {
    student,
    fees: stuFees,
    payments: stuPayments,
    paymentEntries,
    totalExpected,
    totalPaid,
    outstandingBalance,
    overallStatus,
  };
}

export interface ClassPaymentSummaryRow {
  className: string;
  section?: string;
  enrolledCount: number;
  billedStudentsCount: number;
  totalExpected: number;
  totalCollected: number;
  outstandingBalance: number;
  collectionRate: number;
  paidCount: number;
  partialCount: number;
  pendingCount: number;
}

export function computeClassPaymentSummaries(params: {
  classes: SchoolClass[];
  students: Student[];
  reconciledFees: StudentFee[];
  session: string;
  term: AcademicTerm | 'All';
}): ClassPaymentSummaryRow[] {
  const { classes, students, reconciledFees, session, term } = params;

  const scopedFees = reconciledFees.filter(
    (f) => f.session === session && (term === 'All' || f.term === term)
  );

  const classNamesSet = new Set<string>(classes.map((c) => c.name));
  scopedFees.forEach((f) => classNamesSet.add(f.className));

  const rows: ClassPaymentSummaryRow[] = Array.from(classNamesSet).map((className) => {
    const clsObj = classes.find((c) => c.name === className);
    const activeStudents = students.filter(
      (s) =>
        s.status === 'Active' &&
        (clsObj ? doesStudentBelongToClass(s, clsObj) : s.className === className)
    );
    const clsFees = scopedFees.filter((f) => f.className === className);

    // Group by student inside this class
    const byStudent = new Map<string, { expected: number; paid: number }>();
    clsFees.forEach((f) => {
      const curr = byStudent.get(f.studentId) || { expected: 0, paid: 0 };
      curr.expected += f.amountDue;
      curr.paid += f.amountPaid;
      byStudent.set(f.studentId, curr);
    });

    let paidCount = 0;
    let partialCount = 0;
    let pendingCount = 0;
    byStudent.forEach((val) => {
      if (val.expected <= 0) return;
      if (val.paid >= val.expected) paidCount += 1;
      else if (val.paid > 0) partialCount += 1;
      else pendingCount += 1;
    });

    const totalExpected = clsFees.reduce((s, f) => s + f.amountDue, 0);
    const totalCollected = clsFees.reduce((s, f) => s + f.amountPaid, 0);
    const outstandingBalance = Math.max(0, totalExpected - totalCollected);
    const collectionRate =
      totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 1000) / 10 : 0;

    return {
      className,
      section: clsObj?.section,
      enrolledCount: activeStudents.length,
      billedStudentsCount: byStudent.size,
      totalExpected,
      totalCollected,
      outstandingBalance,
      collectionRate,
      paidCount,
      partialCount,
      pendingCount,
    };
  });

  const classMap = new Map(classes.map((c) => [c.name, c]));
  return rows.sort((a, b) => {
    const clsA = classMap.get(a.className);
    const clsB = classMap.get(b.className);
    const secA = a.section || clsA?.section || inferSectionFromClassName(a.className);
    const secB = b.section || clsB?.section || inferSectionFromClassName(b.className);
    const orderMap = SECTION_ORDER as Record<string, number>;
    const secDiff = (orderMap[secA] || 99) - (orderMap[secB] || 99);
    if (secDiff !== 0) return secDiff;
    const sortA = typeof clsA?.sortOrder === 'number' ? clsA.sortOrder : 999;
    const sortB = typeof clsB?.sortOrder === 'number' ? clsB.sortOrder : 999;
    if (sortA !== sortB) return sortA - sortB;
    return a.className.localeCompare(b.className, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

// ==================== PDF & CSV EXPORTS ====================

export async function downloadPaymentReceiptPDF(params: {
  payment: FeePayment;
  schoolSettings: SchoolSetting;
  feeItem?: StudentFee;
  paymentsForFee?: FeePayment[];
}): Promise<void> {
  const { payment, schoolSettings, feeItem, paymentsForFee } = params;
  const docPdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageWidth = docPdf.internal.pageSize.getWidth();

  const history =
    feeItem && paymentsForFee && paymentsForFee.length > 0
      ? computeInstallmentHistoryForFee(feeItem, paymentsForFee)
      : [];
  const historyMatch = history.find((h) => h.payment.id === payment.id);
  const totalPaidSoFar = historyMatch
    ? historyMatch.cumulativePaidAfter
    : feeItem?.amountPaid ?? payment.amount;
  const remainingBalance = historyMatch
    ? historyMatch.runningBalanceAfter
    : feeItem?.balance ?? 0;
  const isFullyPaid = !payment.isVoided && Boolean(feeItem) && remainingBalance === 0;

  // Header Logo
  const logoAsset = await loadImageForPdf(schoolSettings.logoDataUrl);
  if (logoAsset) {
    const fitted = fitDimensionsInsideBox(logoAsset.width, logoAsset.height, 16, 16);
    docPdf.addImage(
      logoAsset.dataUrl,
      logoAsset.format,
      12 + fitted.offsetX,
      10 + fitted.offsetY,
      fitted.drawWidth,
      fitted.drawHeight
    );
  } else {
    docPdf.setFillColor(90, 15, 30);
    docPdf.roundedRect(12, 10, 14, 15, 2.5, 2.5, 'F');
    docPdf.setDrawColor(217, 119, 6);
    docPdf.setLineWidth(0.7);
    docPdf.roundedRect(13, 11, 12, 13, 2, 2, 'S');
    docPdf.setTextColor(251, 191, 36);
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(9);
    docPdf.text('SD', 19, 19, { align: 'center' });
  }

  docPdf.setTextColor(15, 23, 42);
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(11.5);
  docPdf.text(schoolSettings.schoolName.toUpperCase(), pageWidth / 2 + 7, 15, {
    align: 'center',
  });
  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(7.5);
  docPdf.setTextColor(71, 85, 105);
  docPdf.text(schoolSettings.address || '', pageWidth / 2 + 7, 20, { align: 'center' });
  docPdf.text(
    [schoolSettings.phone && `Tel: ${schoolSettings.phone}`, schoolSettings.email]
      .filter(Boolean)
      .join(' | '),
    pageWidth / 2 + 7,
    24,
    { align: 'center' }
  );

  // Banner
  docPdf.setFillColor(payment.isVoided ? 153 : 122, payment.isVoided ? 27 : 20, payment.isVoided ? 27 : 36);
  docPdf.rect(12, 29, pageWidth - 24, 7, 'F');
  docPdf.setTextColor(253, 224, 71);
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(8.5);
  docPdf.text(
    payment.isVoided
      ? 'OFFICIAL BURSARY RECEIPT — VOIDED'
      : isFullyPaid
      ? 'OFFICIAL BURSARY PAYMENT RECEIPT — FULLY PAID'
      : payment.isEdited
      ? 'OFFICIAL BURSARY PAYMENT RECEIPT (EDITED)'
      : 'OFFICIAL BURSARY PAYMENT RECEIPT',
    pageWidth / 2,
    33.8,
    { align: 'center' }
  );

  // Receipt Details
  docPdf.setTextColor(15, 23, 42);
  docPdf.setFontSize(8.5);
  let y = 44;
  const rows: Array<[string, string]> = [
    ['Receipt Number:', payment.receiptNo],
    ['Payment Date:', payment.paymentDate],
    ['Student Name:', payment.studentName],
    ['Admission Number:', payment.admissionNo],
    ['Class:', payment.className],
    ['Session & Term:', `${payment.session} — ${payment.term}`],
    [
      'Fee Category:',
      historyMatch?.installmentNumber
        ? `${payment.categoryName} (Installment #${historyMatch.installmentNumber})`
        : payment.categoryName,
    ],
    ['Payment Method:', payment.paymentMethod],
    ['Transaction Reference:', payment.transactionRef],
    ['Recorded By:', payment.recordedBy],
  ];

  rows.forEach(([label, val]) => {
    docPdf.setFont('helvetica', 'bold');
    docPdf.text(label, 14, y);
    docPdf.setFont('helvetica', 'normal');
    docPdf.text(val, 58, y);
    y += 5.8;
  });

  // Amount Paid & Balance Summary Box
  y += 2;
  if (payment.isVoided) {
    docPdf.setFillColor(254, 242, 242);
    docPdf.setDrawColor(220, 38, 38);
  } else {
    docPdf.setFillColor(240, 253, 244);
    docPdf.setDrawColor(16, 185, 129);
  }
  docPdf.roundedRect(12, y, pageWidth - 24, feeItem ? 25 : 16, 2, 2, 'FD');
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(9);
  docPdf.setTextColor(payment.isVoided ? 153 : 6, payment.isVoided ? 27 : 95, payment.isVoided ? 27 : 70);
  docPdf.text(payment.isVoided ? 'VOIDED AMOUNT:' : 'THIS PAYMENT:', 16, y + 7.5);
  docPdf.setFontSize(13);
  docPdf.text(
    payment.isVoided ? `${formatPdfNaira(payment.amount)} (VOIDED)` : formatPdfNaira(payment.amount),
    pageWidth - 16,
    y + 8,
    { align: 'right' }
  );

  if (feeItem) {
    docPdf.setFontSize(7.5);
    docPdf.setFont('helvetica', 'normal');
    docPdf.setTextColor(51, 65, 85);
    docPdf.text(
      `Expected: ${formatPdfNaira(feeItem.amountDue)}  |  Total Paid So Far: ${formatPdfNaira(
        totalPaidSoFar
      )}`,
      16,
      y + 14.5
    );
    docPdf.setFont('helvetica', 'bold');
    docPdf.setTextColor(isFullyPaid ? 6 : 125, isFullyPaid ? 95 : 90, isFullyPaid ? 70 : 24);
    docPdf.text(
      isFullyPaid
        ? `Remaining Balance: ${formatPdfNaira(0)}  —  FULLY PAID`
        : `Remaining Balance: ${formatPdfNaira(remainingBalance)}`,
      16,
      y + 20.5
    );
  }

  y += feeItem ? 32 : 23;
  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(7.5);
  docPdf.setTextColor(100, 116, 139);
  docPdf.text(
    payment.isVoided
      ? `VOIDED${payment.voidReason ? `: ${payment.voidReason}` : ' — excluded from all school totals.'}`
      : 'This receipt confirms manual bursary recording of the stated amount.',
    12,
    y
  );
  docPdf.text('Authorized Bursar Signature', pageWidth - 12, y + 8, { align: 'right' });

  const safeRct = payment.receiptNo.replace(/[^a-zA-Z0-9_-]/g, '-');
  docPdf.save(`Receipt_${safeRct}.pdf`);
}

export async function downloadStudentStatementPDF(params: {
  statement: StudentFeeStatement;
  schoolSettings: SchoolSetting;
  session: string;
  term: AcademicTerm | 'All';
}): Promise<void> {
  const { statement, schoolSettings, session, term } = params;
  const docPdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = docPdf.internal.pageSize.getWidth();

  const logoAsset = await loadImageForPdf(schoolSettings.logoDataUrl);
  if (logoAsset) {
    const fitted = fitDimensionsInsideBox(logoAsset.width, logoAsset.height, 18, 18);
    docPdf.addImage(
      logoAsset.dataUrl,
      logoAsset.format,
      14 + fitted.offsetX,
      12 + fitted.offsetY,
      fitted.drawWidth,
      fitted.drawHeight
    );
  } else {
    docPdf.setFillColor(90, 15, 30);
    docPdf.roundedRect(14, 12, 16, 18, 2.5, 2.5, 'F');
    docPdf.setTextColor(251, 191, 36);
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(10);
    docPdf.text('SD', 22, 23, { align: 'center' });
  }

  docPdf.setTextColor(15, 23, 42);
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(14);
  docPdf.text(schoolSettings.schoolName.toUpperCase(), pageWidth / 2 + 7, 17, {
    align: 'center',
  });
  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(8.5);
  docPdf.setTextColor(71, 85, 105);
  docPdf.text(`${schoolSettings.address} | ${schoolSettings.phone}`, pageWidth / 2 + 7, 23, {
    align: 'center',
  });

  docPdf.setFillColor(122, 20, 36);
  docPdf.rect(14, 33, pageWidth - 28, 8, 'F');
  docPdf.setTextColor(253, 224, 71);
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(9.5);
  docPdf.text(
    `STUDENT FEE STATEMENT — ${session.toUpperCase()} (${term.toUpperCase()})`,
    pageWidth / 2,
    38.3,
    { align: 'center' }
  );

  docPdf.setTextColor(15, 23, 42);
  docPdf.setFontSize(9);
  docPdf.setFont('helvetica', 'bold');
  docPdf.text('Student:', 14, 48);
  docPdf.text('Admission No:', 14, 54);
  docPdf.text('Class:', 14, 60);
  docPdf.setFont('helvetica', 'normal');
  docPdf.text(statement.student.fullName, 42, 48);
  docPdf.text(statement.student.admissionNo, 42, 54);
  docPdf.text(statement.student.className, 42, 60);

  docPdf.setFont('helvetica', 'bold');
  docPdf.text('Total Expected:', 120, 48);
  docPdf.text('Total Paid:', 120, 54);
  docPdf.text('Outstanding Balance:', 120, 60);
  docPdf.setFont('helvetica', 'normal');
  docPdf.text(formatPdfNaira(statement.totalExpected), 160, 48);
  docPdf.text(formatPdfNaira(statement.totalPaid), 160, 54);
  docPdf.setFont('helvetica', 'bold');
  docPdf.text(formatPdfNaira(statement.outstandingBalance), 160, 60);

  autoTable(docPdf, {
    startY: 67,
    head: [['Fee Category', 'Term', 'Expected', 'Paid', 'Balance', 'Status']],
    body:
      statement.fees.length === 0
        ? [['No fee items assigned for this period.', '', '', '', '', '']]
        : statement.fees.map((f) => [
            f.categoryName,
            f.term,
            formatPdfNaira(f.amountDue),
            formatPdfNaira(f.amountPaid),
            formatPdfNaira(f.balance),
            f.status,
          ]),
    theme: 'grid',
    headStyles: { fillColor: [122, 20, 36], textColor: [255, 255, 255], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
  });

  const nextY = ((docPdf as any).lastAutoTable?.finalY || 120) + 8;
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(9.5);
  docPdf.text('Recorded Payment History', 14, nextY);

  autoTable(docPdf, {
    startY: nextY + 3,
    head: [['Receipt No', 'Date', 'Fee Category', 'Method', 'Amount Paid', 'Running Balance']],
    body:
      statement.paymentEntries.length === 0
        ? [['No payments recorded yet.', '', '', '', '', '']]
        : statement.paymentEntries.map((entry) => {
            const p = entry.payment;
            const instLabel = entry.installmentNumber
              ? ` (Inst. #${entry.installmentNumber})`
              : '';
            return [
              p.isVoided
                ? `${p.receiptNo} [VOIDED]`
                : p.isEdited
                ? `${p.receiptNo} [EDITED]`
                : p.receiptNo,
              p.paymentDate,
              `${p.categoryName}${instLabel}`,
              `${p.paymentMethod}${p.transactionRef ? ` (${p.transactionRef})` : ''}`,
              p.isVoided ? `${formatPdfNaira(p.amount)} (Voided)` : formatPdfNaira(p.amount),
              p.isVoided
                ? 'Excluded'
                : entry.itemRunningBalance === 0
                ? `${formatPdfNaira(0)} (Fully Paid)`
                : formatPdfNaira(entry.itemRunningBalance),
            ];
          }),
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 8 },
    bodyStyles: { fontSize: 7.5 },
  });

  const safeAdm = statement.student.admissionNo.replace(/[^a-zA-Z0-9_-]/g, '-');
  docPdf.save(`FeeStatement_${safeAdm}.pdf`);
}

export async function downloadClassFeeSummaryPDF(params: {
  summaryRows: ClassPaymentSummaryRow[];
  totals: { totalExpected: number; totalCollected: number; outstandingBalance: number };
  schoolSettings: SchoolSetting;
  session: string;
  term: AcademicTerm | 'All';
}): Promise<void> {
  const { summaryRows, totals, schoolSettings, session, term } = params;
  const docPdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = docPdf.internal.pageSize.getWidth();

  const logoAsset = await loadImageForPdf(schoolSettings.logoDataUrl);
  if (logoAsset) {
    const fitted = fitDimensionsInsideBox(logoAsset.width, logoAsset.height, 16, 16);
    docPdf.addImage(
      logoAsset.dataUrl,
      logoAsset.format,
      14 + fitted.offsetX,
      8 + fitted.offsetY,
      fitted.drawWidth,
      fitted.drawHeight
    );
  } else {
    docPdf.setFillColor(90, 15, 30);
    docPdf.roundedRect(14, 9, 14, 14, 2.5, 2.5, 'F');
    docPdf.setTextColor(251, 191, 36);
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(9);
    docPdf.text('SD', 21, 17.5, { align: 'center' });
  }

  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(14);
  docPdf.setTextColor(15, 23, 42);
  docPdf.text(
    `${schoolSettings.schoolName.toUpperCase()} — CLASS PAYMENT SUMMARY REPORT`,
    pageWidth / 2 + 6,
    16,
    { align: 'center' }
  );
  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(9);
  docPdf.setTextColor(71, 85, 105);
  docPdf.text(
    `${session} • ${term} • Total Expected: ${formatPdfNaira(totals.totalExpected)} | Collected: ${formatPdfNaira(totals.totalCollected)} | Outstanding: ${formatPdfNaira(totals.outstandingBalance)}`,
    pageWidth / 2 + 6,
    22,
    { align: 'center' }
  );

  autoTable(docPdf, {
    startY: 28,
    head: [
      [
        'Class',
        'Section',
        'Active Pupils',
        'Billed Pupils',
        'Total Expected',
        'Total Collected',
        'Outstanding',
        'Rate %',
        'Paid / Partial / Unpaid',
      ],
    ],
    body: summaryRows.map((r) => [
      r.className,
      r.section || '—',
      String(r.enrolledCount),
      String(r.billedStudentsCount),
      formatPdfNaira(r.totalExpected),
      formatPdfNaira(r.totalCollected),
      formatPdfNaira(r.outstandingBalance),
      `${r.collectionRate}%`,
      `${r.paidCount} / ${r.partialCount} / ${r.pendingCount}`,
    ]),
    theme: 'grid',
    headStyles: { fillColor: [122, 20, 36], textColor: [255, 255, 255], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
  });

  docPdf.save(`Class_Payment_Summary_${sanitizeFeeIdPart(session)}.pdf`);
}

function triggerCsvDownload(filename: string, headers: string[], rows: string[][]): void {
  const escape = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
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

export function exportClassSummaryCSV(params: {
  summaryRows: ClassPaymentSummaryRow[];
  session: string;
  term: AcademicTerm | 'All';
}): void {
  const { summaryRows, session, term } = params;
  triggerCsvDownload(
    `Class_Payment_Summary_${sanitizeFeeIdPart(session)}_${sanitizeFeeIdPart(term)}.csv`,
    [
      'Class',
      'Section',
      'Active Students',
      'Billed Students',
      'Total Expected (NGN)',
      'Total Collected (NGN)',
      'Outstanding Balance (NGN)',
      'Collection Rate (%)',
      'Paid Count',
      'Partial Count',
      'Pending Count',
    ],
    summaryRows.map((r) => [
      r.className,
      r.section || '',
      String(r.enrolledCount),
      String(r.billedStudentsCount),
      String(r.totalExpected),
      String(r.totalCollected),
      String(r.outstandingBalance),
      String(r.collectionRate),
      String(r.paidCount),
      String(r.partialCount),
      String(r.pendingCount),
    ])
  );
}

export function exportPaymentsLedgerCSV(params: {
  payments: FeePayment[];
  session: string;
  term: AcademicTerm | 'All';
}): void {
  const { payments, session, term } = params;
  triggerCsvDownload(
    `Fee_Payments_Ledger_${sanitizeFeeIdPart(session)}_${sanitizeFeeIdPart(term)}.csv`,
    [
      'Receipt No',
      'Payment Date',
      'Student Name',
      'Admission No',
      'Class',
      'Session',
      'Term',
      'Fee Category',
      'Amount Paid (NGN)',
      'Payment Method',
      'Transaction Ref',
      'Recorded By',
      'Status',
    ],
    payments.map((p) => [
      p.receiptNo,
      p.paymentDate,
      p.studentName,
      p.admissionNo,
      p.className,
      p.session,
      p.term,
      p.categoryName,
      p.isVoided ? '0' : String(p.amount),
      p.paymentMethod,
      p.transactionRef,
      p.recordedBy,
      p.isVoided ? 'Voided' : p.isEdited ? 'Edited' : 'Active',
    ])
  );
}
