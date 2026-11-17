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
  FeeCategory,
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
  if (paymentMethod !== 'Cash' && !transactionRef.trim()) {
    throw new Error(`Please provide a transaction reference or teller number for ${paymentMethod}.`);
  }

  // Reconcile paid amount strictly from existing valid payment records
  const priorPaid = existingPayments
    .filter((p) => p.studentFeeId === studentFee.id)
    .reduce((sum, p) => sum + p.amount, 0);
  const currentBalance = Math.max(0, studentFee.amountDue - priorPaid);

  if (currentBalance <= 0) {
    throw new Error('This fee item has already been paid in full.');
  }
  if (payAmount > currentBalance) {
    throw new Error(
      `Payment amount (${formatNaira(payAmount)}) exceeds outstanding balance (${formatNaira(
        currentBalance
      )}).`
    );
  }

  const receiptNo = generateUniqueReceiptNumber(studentFee.term, existingPayments);
  const paymentId = `pay_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const now = new Date().toISOString();

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
    transactionRef: transactionRef.trim() || `CASH-${receiptNo.split('-').pop()}`,
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
          .filter((p) => p.studentFeeId === f.id)
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
    if (p.amount > 0 && p.studentFeeId) {
      paidByFeeId.set(p.studentFeeId, (paidByFeeId.get(p.studentFeeId) || 0) + p.amount);
    }
  });

  return studentFees.map((fee) => {
    const verifiedPaid = Math.min(fee.amountDue, paidByFeeId.get(fee.id) || 0);
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

export interface StudentFeeStatement {
  student: Student;
  fees: StudentFee[];
  payments: FeePayment[];
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

  const stuPayments = payments
    .filter(
      (p) =>
        p.studentId === student.id &&
        p.session === session &&
        (term === 'All' || p.term === term)
    )
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.createdAt.localeCompare(a.createdAt));

  const totalExpected = stuFees.reduce((s, f) => s + f.amountDue, 0);
  const totalPaid = stuFees.reduce((s, f) => s + f.amountPaid, 0);
  const outstandingBalance = Math.max(0, totalExpected - totalPaid);

  let overallStatus: StudentFeeStatement['overallStatus'] = 'No Fees Assigned';
  if (stuFees.length > 0) {
    overallStatus =
      totalPaid <= 0 ? 'Pending' : outstandingBalance === 0 ? 'Paid' : 'Partial';
  }

  return {
    student,
    fees: stuFees,
    payments: stuPayments,
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
}): Promise<void> {
  const { payment, schoolSettings, feeItem } = params;
  const docPdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageWidth = docPdf.internal.pageSize.getWidth();

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
  docPdf.setFillColor(122, 20, 36);
  docPdf.rect(12, 29, pageWidth - 24, 7, 'F');
  docPdf.setTextColor(253, 224, 71);
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(8.5);
  docPdf.text('OFFICIAL BURSARY PAYMENT RECEIPT', pageWidth / 2, 33.8, { align: 'center' });

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
    ['Fee Category:', payment.categoryName],
    ['Payment Method:', payment.paymentMethod],
    ['Transaction Reference:', payment.transactionRef],
    ['Recorded By:', payment.recordedBy],
  ];

  rows.forEach(([label, val]) => {
    docPdf.setFont('helvetica', 'bold');
    docPdf.text(label, 14, y);
    docPdf.setFont('helvetica', 'normal');
    docPdf.text(val, 58, y);
    y += 6.2;
  });

  // Amount Paid Box
  y += 2;
  docPdf.setFillColor(240, 253, 244);
  docPdf.setDrawColor(16, 185, 129);
  docPdf.roundedRect(12, y, pageWidth - 24, 18, 2, 2, 'FD');
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(9);
  docPdf.setTextColor(6, 95, 70);
  docPdf.text('AMOUNT PAID:', 16, y + 7.5);
  docPdf.setFontSize(13);
  docPdf.text(formatPdfNaira(payment.amount), pageWidth - 16, y + 8, { align: 'right' });

  if (feeItem) {
    docPdf.setFontSize(7.5);
    docPdf.setFont('helvetica', 'normal');
    docPdf.setTextColor(51, 65, 85);
    docPdf.text(
      `Total Fee Billed: ${formatPdfNaira(feeItem.amountDue)}  |  Remaining Balance on Item: ${formatPdfNaira(feeItem.balance)}`,
      16,
      y + 14.2
    );
  }

  y += 28;
  docPdf.setFontSize(7.5);
  docPdf.setTextColor(100, 116, 139);
  docPdf.text('This receipt confirms manual bursary recording of the stated amount.', 12, y);
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
    head: [['Receipt No', 'Date', 'Fee Category', 'Method', 'Reference', 'Amount']],
    body:
      statement.payments.length === 0
        ? [['No payments recorded yet.', '', '', '', '', '']]
        : statement.payments.map((p) => [
            p.receiptNo,
            p.paymentDate,
            p.categoryName,
            p.paymentMethod,
            p.transactionRef,
            formatPdfNaira(p.amount),
          ]),
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
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
      String(p.amount),
      p.paymentMethod,
      p.transactionRef,
      p.recordedBy,
    ])
  );
}
