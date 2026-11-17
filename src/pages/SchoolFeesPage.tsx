import React, { useEffect, useMemo, useState } from 'react';
import {
  Receipt,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  Download,
  Printer,
  FileText,
  Layers,
  CreditCard,
  Users,
  Trash2,
  Database,
  X,
  Info,
  Building2,
  UserCheck,
  FileSpreadsheet,
  AlertTriangle,
  History,
  Pencil,
  Ban,
  ChevronDown,
  ChevronRight,
  Calendar,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  AcademicSession,
  AcademicTerm,
  FeeAuditLog,
  FeeCategory,
  FeeDeletionLog,
  FeePayment,
  FeeScheduleItem,
  ManualPaymentMethod,
  SchoolClass,
  Student,
  StudentFee,
} from '../types';
import {
  DEFAULT_ACADEMIC_SESSION,
  DEFAULT_FEE_CATEGORIES,
  SAMPLE_CLASSES,
} from '../data/sampleData';
import { extractFriendlyError, subscribeStudents } from '../services/schoolService';
import { subscribeAcademicSessions, subscribeClasses } from '../services/academicService';
import { getActiveClasses, groupClassesBySection } from '../utils/classUtils';
import {
  assignSingleFeeToStudentInFirestore,
  bulkAssignClassScheduleToStudentsInFirestore,
  computeClassPaymentSummaries,
  computeInstallmentHistoryForFee,
  computeStudentStatement,
  deleteFeeCategoryFromFirestore,
  deleteFeeScheduleItemFromFirestore,
  deleteStudentFeeItemWithAuditInFirestore,
  downloadClassFeeSummaryPDF,
  downloadStudentStatementPDF,
  editFeePaymentWithAuditInFirestore,
  editStudentFeeDueDateWithAuditInFirestore,
  editStudentFeeExpectedAmountWithAuditInFirestore,
  exportClassSummaryCSV,
  exportPaymentsLedgerCSV,
  formatNaira,
  getTodayYmd,
  InstallmentHistoryEntry,
  isFeeOverdue,
  recordManualPaymentInFirestore,
  reconcileStudentFeesWithPayments,
  saveFeeCategoryToFirestore,
  saveFeeScheduleItemToFirestore,
  seedDefaultFeeCategoriesToFirestore,
  subscribeFeeAuditLogs,
  subscribeFeeCategories,
  subscribeFeeDeletionLogs,
  subscribeFeePayments,
  subscribeFeeSchedules,
  subscribeStudentFees,
  voidFeePaymentWithAuditInFirestore,
} from '../services/feesService';
import { ReceiptModal } from '../components/fees/ReceiptModal';
import { SchoolLogo } from '../components/common/SchoolLogo';

type FeesTab = 'billing' | 'statements' | 'summaries' | 'ledger' | 'setup';

const MANUAL_METHODS: ManualPaymentMethod[] = [
  'Bank Transfer',
  'POS',
  'Cash',
  'Cheque',
  'Bank Teller / Deposit',
];

export const SchoolFeesPage: React.FC = () => {
  const { role, currentUser, firebaseUser, schoolSettings } = useAuth();
  const isLiveFirestore = Boolean(firebaseUser);
  const isDirector = role === 'director';
  const isBursar = role === 'bursar';
  const isAdmin = isDirector || role === 'principal';
  const canRecordPayments = isDirector || isBursar;
  const isStaffViewer = isAdmin || isBursar;
  const isParent = role === 'parent';

  const [activeTab, setActiveTab] = useState<FeesTab>(isParent ? 'statements' : 'billing');

  useEffect(() => {
    if (isParent && activeTab !== 'statements') {
      setActiveTab('statements');
    } else if (!isAdmin && activeTab === 'setup') {
      setActiveTab('billing');
    }
  }, [isParent, isAdmin, activeTab]);

  // Firestore Collections
  const [sessions, setSessions] = useState<AcademicSession[]>([DEFAULT_ACADEMIC_SESSION]);
  const [classesList, setClassesList] = useState<SchoolClass[]>(SAMPLE_CLASSES);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [categories, setCategories] = useState<FeeCategory[]>(DEFAULT_FEE_CATEGORIES);
  const [categoriesSeeded, setCategoriesSeeded] = useState<boolean>(false);
  const [schedules, setSchedules] = useState<FeeScheduleItem[]>([]);
  const [studentFeesRaw, setStudentFeesRaw] = useState<StudentFee[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [deletionLogs, setDeletionLogs] = useState<FeeDeletionLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<FeeAuditLog[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(isLiveFirestore);
  const [dataError, setDataError] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Subscriptions
  useEffect(() => {
    if (!firebaseUser) {
      setStudentsList([]);
      setDeletionLogs([]);
      setAuditLogs([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setDataError('');

    const u1 = subscribeAcademicSessions(setSessions, setDataError);
    const u2 = subscribeClasses((cls) => setClassesList(cls), setDataError);
    const u3 = subscribeStudents(role, currentUser, firebaseUser.email, setStudentsList, setDataError);
    const u4 = !isParent
      ? subscribeFeeCategories((cats, seeded) => {
          setCategories(cats);
          setCategoriesSeeded(seeded);
        }, setDataError)
      : (() => () => {})();
    const u5 = !isParent
      ? subscribeFeeSchedules(setSchedules, setDataError)
      : (() => () => {})();
    const u6 = subscribeStudentFees(
      role,
      currentUser,
      firebaseUser.email,
      (fees) => {
        setStudentFeesRaw(fees);
        setIsLoading(false);
      },
      (err) => {
        setDataError(err);
        setIsLoading(false);
      }
    );
    const u7 = subscribeFeePayments(
      role,
      currentUser,
      firebaseUser.email,
      setPayments,
      setDataError
    );
    const u8 = subscribeFeeDeletionLogs(role, setDeletionLogs, setDataError);
    const u9 = subscribeFeeAuditLogs(role, setAuditLogs, setDataError);

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
    };
  }, [firebaseUser, role, currentUser, isParent]);

  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(''), 6000);
    return () => clearTimeout(t);
  }, [successMsg]);

  // Strictly reconcile every StudentFee against real saved FeePayment documents
  const reconciledFees = useMemo(
    () => reconcileStudentFeesWithPayments(studentFeesRaw, payments),
    [studentFeesRaw, payments]
  );

  // Active Session / Term defaults
  const activeSessionObj = useMemo(
    () => sessions.find((s) => s.isActive) || sessions[0] || DEFAULT_ACADEMIC_SESSION,
    [sessions]
  );
  const activeTermObj = useMemo(
    () => activeSessionObj.terms.find((t) => t.isActive) || activeSessionObj.terms[0],
    [activeSessionObj]
  );

  const [selectedSession, setSelectedSession] = useState<string>(activeSessionObj.name);
  const [selectedTerm, setSelectedTerm] = useState<AcademicTerm | 'All'>(
    activeTermObj?.name || 'First Term'
  );
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Partial' | 'Paid'>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    if (!sessions.some((s) => s.name === selectedSession)) {
      setSelectedSession(activeSessionObj.name);
    }
  }, [sessions, activeSessionObj.name, selectedSession]);

  // Scoped fees & payments
  const scopedFees = useMemo(() => {
    return reconciledFees.filter((f) => {
      if (f.session !== selectedSession) return false;
      if (selectedTerm !== 'All' && f.term !== selectedTerm) return false;
      if (!isParent && selectedClassFilter !== 'All' && f.className !== selectedClassFilter) {
        return false;
      }
      if (statusFilter !== 'All' && f.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          f.studentName.toLowerCase().includes(q) ||
          f.admissionNo.toLowerCase().includes(q) ||
          f.categoryName.toLowerCase().includes(q) ||
          f.className.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [reconciledFees, selectedSession, selectedTerm, selectedClassFilter, statusFilter, searchQuery, isParent]);

  const scopedPayments = useMemo(() => {
    return payments.filter((p) => {
      if (p.session !== selectedSession) return false;
      if (selectedTerm !== 'All' && p.term !== selectedTerm) return false;
      if (!isParent && selectedClassFilter !== 'All' && p.className !== selectedClassFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          p.receiptNo.toLowerCase().includes(q) ||
          p.studentName.toLowerCase().includes(q) ||
          p.admissionNo.toLowerCase().includes(q) ||
          p.transactionRef.toLowerCase().includes(q) ||
          p.categoryName.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [payments, selectedSession, selectedTerm, selectedClassFilter, searchQuery, isParent]);

  const scopedDeletionLogs = useMemo(() => {
    if (!isDirector) return [];
    return deletionLogs.filter((log) => {
      if (log.session !== selectedSession) return false;
      if (selectedTerm !== 'All' && log.term !== selectedTerm) return false;
      if (selectedClassFilter !== 'All' && log.className !== selectedClassFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          log.studentName.toLowerCase().includes(q) ||
          log.admissionNo.toLowerCase().includes(q) ||
          log.receiptNo.toLowerCase().includes(q) ||
          log.categoryName.toLowerCase().includes(q) ||
          log.reason.toLowerCase().includes(q) ||
          log.deletedBy.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [deletionLogs, isDirector, selectedSession, selectedTerm, selectedClassFilter, searchQuery]);

  const scopedAuditLogs = useMemo(() => {
    if (!isDirector) return [];
    return auditLogs.filter((log) => {
      if (log.session !== selectedSession) return false;
      if (selectedTerm !== 'All' && log.term !== selectedTerm) return false;
      if (selectedClassFilter !== 'All' && log.className !== selectedClassFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          log.studentName.toLowerCase().includes(q) ||
          log.admissionNo.toLowerCase().includes(q) ||
          log.receiptNo.toLowerCase().includes(q) ||
          log.categoryName.toLowerCase().includes(q) ||
          log.reason.toLowerCase().includes(q) ||
          log.performedBy.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [auditLogs, isDirector, selectedSession, selectedTerm, selectedClassFilter, searchQuery]);

  const activeScopedPaymentCount = useMemo(
    () => scopedPayments.filter((p) => !p.isVoided).length,
    [scopedPayments]
  );

  // Financial KPI Totals (Expected vs Collected vs Outstanding)
  const kpiTotals = useMemo(() => {
    const totalExpected = scopedFees.reduce((s, f) => s + f.amountDue, 0);
    const totalCollected = scopedFees.reduce((s, f) => s + f.amountPaid, 0);
    const outstandingBalance = Math.max(0, totalExpected - totalCollected);
    const collectionRate =
      totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 1000) / 10 : 0;
    return { totalExpected, totalCollected, outstandingBalance, collectionRate };
  }, [scopedFees]);

  // ==================== STATEMENT STATE ====================
  const activeStudents = useMemo(
    () =>
      studentsList
        .filter((s) => s.status === 'Active')
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [studentsList]
  );

  const [statementStudentId, setStatementStudentId] = useState<string>('');

  useEffect(() => {
    if (activeStudents.length === 0) {
      setStatementStudentId('');
      return;
    }
    if (!activeStudents.some((s) => s.id === statementStudentId)) {
      setStatementStudentId(activeStudents[0].id);
    }
  }, [activeStudents, statementStudentId]);

  const activeStatement = useMemo(() => {
    const stu = activeStudents.find((s) => s.id === statementStudentId);
    if (!stu) return null;
    return computeStudentStatement({
      student: stu,
      reconciledFees,
      payments,
      session: selectedSession,
      term: selectedTerm,
    });
  }, [activeStudents, statementStudentId, reconciledFees, payments, selectedSession, selectedTerm]);

  // ==================== CLASS SUMMARY STATE ====================
  const classSummaryRows = useMemo(() => {
    return computeClassPaymentSummaries({
      classes: classesList,
      students: studentsList,
      reconciledFees,
      session: selectedSession,
      term: selectedTerm,
    });
  }, [classesList, studentsList, reconciledFees, selectedSession, selectedTerm]);

  const classSummaryTotals = useMemo(() => {
    const totalExpected = classSummaryRows.reduce((s, r) => s + r.totalExpected, 0);
    const totalCollected = classSummaryRows.reduce((s, r) => s + r.totalCollected, 0);
    const outstandingBalance = Math.max(0, totalExpected - totalCollected);
    return { totalExpected, totalCollected, outstandingBalance };
  }, [classSummaryRows]);

  const [drilldownClass, setDrilldownClass] = useState<string>('');

  // Expandable rows & installment history map
  const [expandedFeeIds, setExpandedFeeIds] = useState<Set<string>>(new Set());

  const toggleExpandFeeRow = (feeId: string) => {
    setExpandedFeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(feeId)) {
        next.delete(feeId);
      } else {
        next.add(feeId);
      }
      return next;
    });
  };

  const installmentHistoryByFeeId = useMemo(() => {
    const map = new Map<string, InstallmentHistoryEntry[]>();
    const grouped = new Map<string, FeePayment[]>();
    payments.forEach((p) => {
      const arr = grouped.get(p.studentFeeId) || [];
      arr.push(p);
      grouped.set(p.studentFeeId, arr);
    });
    reconciledFees.forEach((fee) => {
      const list = grouped.get(fee.id) || [];
      map.set(fee.id, computeInstallmentHistoryForFee(fee, list));
    });
    return map;
  }, [reconciledFees, payments]);

  const installmentEntryByPaymentId = useMemo(() => {
    const map = new Map<string, InstallmentHistoryEntry>();
    installmentHistoryByFeeId.forEach((entries) => {
      entries.forEach((entry) => {
        map.set(entry.payment.id, entry);
      });
    });
    return map;
  }, [installmentHistoryByFeeId]);

  // ==================== MODALS STATE ====================
  const [selectedReceipt, setSelectedReceipt] = useState<FeePayment | null>(null);

  // Record Manual Payment Modal
  const [paymentModalOpen, setPaymentModalOpen] = useState<boolean>(false);
  const [targetFeeId, setTargetFeeId] = useState<string>('');
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payDate, setPayDate] = useState<string>(getTodayYmd());
  const [payMethod, setPayMethod] = useState<ManualPaymentMethod>('Cash');
  const [payRef, setPayRef] = useState<string>('');
  const [payNotes, setPayNotes] = useState<string>('');
  const [payModalError, setPayModalError] = useState<string>('');

  const unpaidOrPartialFees = useMemo(
    () =>
      reconciledFees
        .filter((f) => f.balance > 0)
        .sort((a, b) => a.studentName.localeCompare(b.studentName)),
    [reconciledFees]
  );

  const selectedTargetFee = useMemo(
    () => reconciledFees.find((f) => f.id === targetFeeId) || null,
    [reconciledFees, targetFeeId]
  );

  const openPaymentModal = (fee?: StudentFee) => {
    if (!canRecordPayments) return;
    const chosen = fee || unpaidOrPartialFees[0];
    setTargetFeeId(chosen?.id || '');
    setPayAmount(chosen?.balance || 0);
    setPayDate(getTodayYmd());
    setPayMethod('Cash');
    setPayRef('');
    setPayNotes('');
    setPayModalError('');
    setPaymentModalOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canRecordPayments) {
      setPayModalError('Only an authenticated Bursar / Accountant or Director can record payments.');
      return;
    }
    if (!selectedTargetFee) {
      setPayModalError('Please select an assigned student fee item with an outstanding balance.');
      return;
    }
    const roundedPay = Math.round(Number(payAmount));
    if (!Number.isFinite(roundedPay) || roundedPay <= 0) {
      setPayModalError('Payment amount must be greater than ₦0.');
      return;
    }
    if (roundedPay > selectedTargetFee.balance) {
      setPayModalError(
        `Amount is more than the outstanding balance of ${formatNaira(selectedTargetFee.balance)}`
      );
      return;
    }
    if (!payDate || payDate.length !== 10) {
      setPayModalError('Please provide a valid payment date.');
      return;
    }

    setIsSaving(true);
    setPayModalError('');
    setDataError('');
    try {
      const stu = studentsList.find((s) => s.id === selectedTargetFee.studentId);
      const stuFees = reconciledFees.filter((f) => f.studentId === selectedTargetFee.studentId);

      const newPayment = await recordManualPaymentInFirestore({
        studentFee: selectedTargetFee,
        student: stu,
        allStudentFeesForStudent: stuFees,
        existingPayments: payments,
        amount: roundedPay,
        paymentDate: payDate,
        paymentMethod: payMethod,
        transactionRef: payRef,
        notes: payNotes,
        recordedBy: currentUser?.displayName || firebaseUser.email || 'School Bursar',
        recordedByUid: firebaseUser.uid,
      });

      setPaymentModalOpen(false);
      setPayModalError('');
      setSuccessMsg(
        `Payment of ${formatNaira(newPayment.amount)} recorded for ${newPayment.studentName}. Receipt: ${newPayment.receiptNo}`
      );
      setSelectedReceipt(newPayment);
    } catch (err) {
      const msg = extractFriendlyError(err, 'Failed to record payment.');
      setPayModalError(msg);
      setDataError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // Assign Single Fee Modal
  const [assignModalOpen, setAssignModalOpen] = useState<boolean>(false);
  const [assignStudentId, setAssignStudentId] = useState<string>('');
  const [assignCategoryId, setAssignCategoryId] = useState<string>('');
  const [assignTerm, setAssignTerm] = useState<AcademicTerm>(
    selectedTerm === 'All' ? 'First Term' : selectedTerm
  );
  const [assignAmount, setAssignAmount] = useState<number>(0);
  const [assignDueDate, setAssignDueDate] = useState<string>('');

  const openAssignModal = () => {
    const firstStu = activeStudents[0];
    const firstCat = categories.find((c) => c.isActive) || categories[0];
    const effectiveTerm = selectedTerm === 'All' ? 'First Term' : selectedTerm;
    const schedMatch =
      firstStu && firstCat
        ? schedules.find(
            (sc) =>
              sc.session === selectedSession &&
              sc.term === effectiveTerm &&
              sc.className === firstStu.className &&
              sc.categoryId === firstCat.id
          )
        : undefined;

    setAssignStudentId(firstStu?.id || '');
    setAssignCategoryId(firstCat?.id || '');
    setAssignTerm(effectiveTerm);
    setAssignAmount(schedMatch?.amount || 0);
    setAssignDueDate(schedMatch?.dueDate || '');
    setAssignModalOpen(true);
  };

  const handleAssignSingleFee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !isAdmin) return;
    const stu = studentsList.find((s) => s.id === assignStudentId);
    const cat = categories.find((c) => c.id === assignCategoryId);
    if (!stu || !cat) {
      setDataError('Please select a valid student and fee category.');
      return;
    }

    setIsSaving(true);
    setDataError('');
    try {
      await assignSingleFeeToStudentInFirestore({
        student: stu,
        session: selectedSession,
        term: assignTerm,
        category: cat,
        amountDue: assignAmount,
        dueDate: assignDueDate,
        assignedBy: currentUser?.displayName || 'School Administration',
        existingStudentFees: reconciledFees,
      });
      setAssignModalOpen(false);
      setSuccessMsg(
        `Assigned ${cat.name} (${formatNaira(assignAmount)}) to ${stu.fullName} as Pending (₦0 paid).`
      );
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to assign fee.'));
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== SETUP TAB FORMS ====================
  const [newCatName, setNewCatName] = useState<string>('');
  const [newCatDesc, setNewCatDesc] = useState<string>('');

  const [schedClass, setSchedClass] = useState<string>(classesList[0]?.name || '');
  const [schedTerm, setSchedTerm] = useState<AcademicTerm>(
    selectedTerm === 'All' ? 'First Term' : selectedTerm
  );
  const [schedCategoryId, setSchedCategoryId] = useState<string>(categories[0]?.id || '');
  const [schedAmount, setSchedAmount] = useState<number>(0);
  const [schedDueDate, setSchedDueDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [schedMandatory, setSchedMandatory] = useState<boolean>(true);

  useEffect(() => {
    if (classesList.length > 0 && !classesList.some((c) => c.name === schedClass)) {
      setSchedClass(classesList[0].name);
    }
  }, [classesList, schedClass]);

  useEffect(() => {
    if (categories.length > 0 && !categories.some((c) => c.id === schedCategoryId)) {
      setSchedCategoryId(categories[0].id);
    }
  }, [categories, schedCategoryId]);

  const handleSeedCategories = async () => {
    if (!firebaseUser || !isAdmin) return;
    setIsSaving(true);
    setDataError('');
    try {
      await seedDefaultFeeCategoriesToFirestore();
      setSuccessMsg('Default fee categories saved to Firestore.');
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to save default fee categories.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !isAdmin || !newCatName.trim()) return;
    setIsSaving(true);
    setDataError('');
    try {
      await saveFeeCategoryToFirestore({
        name: newCatName.trim(),
        description: newCatDesc.trim(),
        isActive: true,
      });
      setNewCatName('');
      setNewCatDesc('');
      setSuccessMsg(`Created fee category "${newCatName.trim()}".`);
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to save fee category.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveScheduleItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !isAdmin) return;
    const cat = categories.find((c) => c.id === schedCategoryId);
    if (!cat || !schedClass) {
      setDataError('Select a valid class and fee category.');
      return;
    }

    setIsSaving(true);
    setDataError('');
    try {
      await saveFeeScheduleItemToFirestore(
        {
          session: selectedSession,
          term: schedTerm,
          className: schedClass,
          categoryId: cat.id,
          categoryName: cat.name,
          amount: schedAmount,
          dueDate: schedDueDate,
          isMandatory: schedMandatory,
        },
        currentUser?.displayName || 'School Bursar'
      );
      setSuccessMsg(
        `Saved ${cat.name} (${formatNaira(schedAmount)}) for ${schedClass} — ${schedTerm}.`
      );
      setSchedAmount(0);
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to save fee schedule item.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleBulkAssignClass = async (className: string, term: AcademicTerm) => {
    if (!firebaseUser || !isAdmin) return;
    setIsSaving(true);
    setDataError('');
    try {
      const res = await bulkAssignClassScheduleToStudentsInFirestore({
        students: studentsList,
        schedules,
        session: selectedSession,
        term,
        className,
        assignedBy: currentUser?.displayName || 'School Bursar',
        existingStudentFees: reconciledFees,
      });
      if (res.assignedCount === 0) {
        setSuccessMsg(
          `All scheduled fees for ${className} (${term}) are already assigned to enrolled pupils.`
        );
      } else {
        setSuccessMsg(
          `Assigned ${res.assignedCount} fee items to students in ${className} (${res.skippedCount} already assigned skipped).`
        );
      }
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to assign class fees.'));
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== EDIT FEE / PAYMENT MODAL STATE (DIRECTOR ONLY) ====================
  const [editTargetFeeId, setEditTargetFeeId] = useState<string | null>(null);
  const [editExpectedAmountInput, setEditExpectedAmountInput] = useState<string>('');
  const [editExpectedReason, setEditExpectedReason] = useState<string>('');
  const [editExpectedError, setEditExpectedError] = useState<string>('');
  const [isSavingExpected, setIsSavingExpected] = useState<boolean>(false);

  const [editDueDateInput, setEditDueDateInput] = useState<string>('');
  const [editDueDateReason, setEditDueDateReason] = useState<string>('');
  const [editDueDateError, setEditDueDateError] = useState<string>('');
  const [isSavingDueDate, setIsSavingDueDate] = useState<boolean>(false);

  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editPayAmountInput, setEditPayAmountInput] = useState<string>('');
  const [editPayDate, setEditPayDate] = useState<string>('');
  const [editPayMethod, setEditPayMethod] = useState<ManualPaymentMethod>('Bank Transfer');
  const [editPayNotes, setEditPayNotes] = useState<string>('');
  const [editPayReason, setEditPayReason] = useState<string>('');
  const [editPayError, setEditPayError] = useState<string>('');
  const [isSavingEditedPayment, setIsSavingEditedPayment] = useState<boolean>(false);
  const [editModalFeedback, setEditModalFeedback] = useState<string>('');

  const editTargetFee = useMemo(
    () => (editTargetFeeId ? reconciledFees.find((f) => f.id === editTargetFeeId) || null : null),
    [editTargetFeeId, reconciledFees]
  );

  const editTargetPayments = useMemo(
    () => (editTargetFee ? payments.filter((p) => p.studentFeeId === editTargetFee.id) : []),
    [editTargetFee, payments]
  );

  const activePaidForEditFee = useMemo(
    () =>
      editTargetPayments
        .filter((p) => !p.isVoided && p.amount > 0)
        .reduce((sum, p) => sum + p.amount, 0),
    [editTargetPayments]
  );

  const openEditModal = (fee: StudentFee) => {
    if (!isDirector) return;
    setEditTargetFeeId(fee.id);
    setEditExpectedAmountInput(String(fee.amountDue));
    setEditExpectedReason('');
    setEditExpectedError('');
    setEditDueDateInput(fee.dueDate || '');
    setEditDueDateReason('');
    setEditDueDateError('');
    setEditingPaymentId(null);
    setEditPayAmountInput('');
    setEditPayDate('');
    setEditPayMethod('Bank Transfer');
    setEditPayNotes('');
    setEditPayReason('');
    setEditPayError('');
    setEditModalFeedback('');
  };

  const closeEditModal = () => {
    if (isSavingExpected || isSavingEditedPayment || isSavingDueDate) return;
    setEditTargetFeeId(null);
    setEditingPaymentId(null);
    setEditExpectedError('');
    setEditDueDateError('');
    setEditPayError('');
    setEditModalFeedback('');
  };

  const handleSaveDueDateEdit = async () => {
    if (!firebaseUser || !isDirector || !editTargetFee) {
      setEditDueDateError('Only the Director role can update installment due dates.');
      return;
    }

    const trimmedDue = editDueDateInput.trim();
    if (trimmedDue && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDue)) {
      setEditDueDateError('Please select a valid date (YYYY-MM-DD) or clear it.');
      return;
    }

    const trimmedReason = editDueDateReason.trim();
    if (!trimmedReason) {
      setEditDueDateError('Please enter a reason for updating the installment due date.');
      return;
    }

    setEditDueDateError('');
    setEditModalFeedback('');
    setDataError('');

    const actorName = currentUser?.displayName || firebaseUser.email || 'School Director';
    setIsSavingDueDate(true);
    try {
      await editStudentFeeDueDateWithAuditInFirestore({
        studentFee: editTargetFee,
        newDueDate: trimmedDue,
        reason: trimmedReason,
        editedBy: actorName,
        editedByUid: firebaseUser.uid,
      });

      setEditDueDateReason('');
      setEditModalFeedback(
        trimmedDue
          ? `Updated installment due date to ${trimmedDue} and logged audit entry.`
          : 'Cleared installment due date and logged audit entry.'
      );
      setSuccessMsg(
        trimmedDue
          ? `Updated due date for ${editTargetFee.studentName} (${editTargetFee.categoryName}) to ${trimmedDue}.`
          : `Cleared due date for ${editTargetFee.studentName} (${editTargetFee.categoryName}).`
      );
    } catch (err) {
      console.error('[SchoolFees] Edit due date failed:', err);
      const msg = extractFriendlyError(err, 'Failed to update installment due date.');
      setEditDueDateError(msg);
      setDataError(msg);
    } finally {
      setIsSavingDueDate(false);
    }
  };

  const startEditingPayment = (p: FeePayment) => {
    if (p.isVoided) return;
    setEditingPaymentId(p.id);
    setEditPayAmountInput(String(p.amount));
    setEditPayDate(p.paymentDate);
    setEditPayMethod(p.paymentMethod);
    setEditPayNotes(p.notes || '');
    setEditPayReason('');
    setEditPayError('');
    setEditModalFeedback('');
  };

  const handleSaveExpectedAmountEdit = async () => {
    if (!firebaseUser || !isDirector || !editTargetFee) {
      setEditExpectedError('Only the Director role can edit assigned fee amounts.');
      return;
    }

    const parsedAmount = Number(editExpectedAmountInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setEditExpectedError('Expected amount must be a positive number greater than ₦0.');
      return;
    }

    const trimmedReason = editExpectedReason.trim();
    if (!trimmedReason) {
      setEditExpectedError('Please enter a reason for editing the expected amount.');
      return;
    }

    setEditExpectedError('');
    setEditModalFeedback('');
    setDataError('');

    const stu = studentsList.find((s) => s.id === editTargetFee.studentId);
    const stuFees = reconciledFees.filter((f) => f.studentId === editTargetFee.studentId);
    const actorName = currentUser?.displayName || firebaseUser.email || 'School Director';

    setIsSavingExpected(true);
    try {
      await editStudentFeeExpectedAmountWithAuditInFirestore({
        studentFee: editTargetFee,
        student: stu,
        allStudentFeesForStudent: stuFees,
        existingPayments: payments,
        newExpectedAmount: parsedAmount,
        reason: trimmedReason,
        editedBy: actorName,
        editedByUid: firebaseUser.uid,
      });

      const roundedNew = Math.round(parsedAmount);
      setEditExpectedAmountInput(String(roundedNew));
      setEditExpectedReason('');
      setEditModalFeedback(
        `Updated expected amount to ${formatNaira(roundedNew)} and logged audit entry.`
      );
      setSuccessMsg(
        `Updated expected fee for ${editTargetFee.studentName} (${editTargetFee.categoryName}) to ${formatNaira(
          roundedNew
        )}. Balances and totals updated.`
      );
    } catch (err) {
      console.error('[SchoolFees] Edit expected amount failed:', err);
      const msg = extractFriendlyError(err, 'Failed to update expected amount.');
      setEditExpectedError(msg);
      setDataError(msg);
    } finally {
      setIsSavingExpected(false);
    }
  };

  const handleSavePaymentEdit = async () => {
    if (!firebaseUser || !isDirector || !editTargetFee || !editingPaymentId) {
      setEditPayError('Only the Director role can edit recorded payments.');
      return;
    }

    const paymentObj = editTargetPayments.find((p) => p.id === editingPaymentId);
    if (!paymentObj || paymentObj.isVoided) {
      setEditPayError('Selected payment is unavailable or already voided.');
      return;
    }

    const parsedAmount = Number(editPayAmountInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setEditPayError('Payment amount must be a positive number greater than ₦0.');
      return;
    }
    if (!editPayDate || editPayDate.length !== 10) {
      setEditPayError('Please enter a valid payment date.');
      return;
    }
    const trimmedReason = editPayReason.trim();
    if (!trimmedReason) {
      setEditPayError('Please enter a reason for editing this payment.');
      return;
    }

    setEditPayError('');
    setEditModalFeedback('');
    setDataError('');

    const stu = studentsList.find((s) => s.id === editTargetFee.studentId);
    const stuFees = reconciledFees.filter((f) => f.studentId === editTargetFee.studentId);
    const actorName = currentUser?.displayName || firebaseUser.email || 'School Director';

    setIsSavingEditedPayment(true);
    try {
      await editFeePaymentWithAuditInFirestore({
        studentFee: editTargetFee,
        payment: paymentObj,
        student: stu,
        allStudentFeesForStudent: stuFees,
        existingPayments: payments,
        amount: parsedAmount,
        paymentDate: editPayDate,
        paymentMethod: editPayMethod,
        notes: editPayNotes,
        reason: trimmedReason,
        editedBy: actorName,
        editedByUid: firebaseUser.uid,
      });

      setEditingPaymentId(null);
      setEditPayReason('');
      setEditModalFeedback(
        `Saved changes to receipt ${paymentObj.receiptNo} (${formatNaira(
          Math.round(parsedAmount)
        )}) and logged audit entry.`
      );
      setSuccessMsg(
        `Edited payment receipt ${paymentObj.receiptNo} (${formatNaira(
          Math.round(parsedAmount)
        )}) for ${editTargetFee.studentName}. Balances and totals updated.`
      );
    } catch (err) {
      console.error('[SchoolFees] Edit payment failed:', err);
      const msg = extractFriendlyError(err, 'Failed to edit recorded payment.');
      setEditPayError(msg);
      setDataError(msg);
    } finally {
      setIsSavingEditedPayment(false);
    }
  };

  // ==================== VOID / DELETE FEE OR PAYMENT MODAL STATE (DIRECTOR ONLY) ====================
  const [deleteTargetFeeId, setDeleteTargetFeeId] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<'void_payment' | 'fee_item'>('void_payment');
  const [selectedPaymentToVoidId, setSelectedPaymentToVoidId] = useState<string>('');
  const [deleteReason, setDeleteReason] = useState<string>('');
  const [deleteReasonError, setDeleteReasonError] = useState<string>('');
  const [deleteModalError, setDeleteModalError] = useState<string>('');
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const deleteTargetFee = useMemo(
    () => (deleteTargetFeeId ? reconciledFees.find((f) => f.id === deleteTargetFeeId) || null : null),
    [deleteTargetFeeId, reconciledFees]
  );

  const deleteTargetPayments = useMemo(
    () => (deleteTargetFee ? payments.filter((p) => p.studentFeeId === deleteTargetFee.id) : []),
    [deleteTargetFee, payments]
  );

  const activeDeleteTargetPayments = useMemo(
    () => deleteTargetPayments.filter((p) => !p.isVoided),
    [deleteTargetPayments]
  );

  const openVoidDeleteModal = (fee: StudentFee) => {
    if (!isDirector) return;
    const activePays = payments.filter((p) => p.studentFeeId === fee.id && !p.isVoided);
    setDeleteTargetFeeId(fee.id);
    setDeleteMode(activePays.length > 0 ? 'void_payment' : 'fee_item');
    setSelectedPaymentToVoidId(activePays[0]?.id || '');
    setDeleteReason('');
    setDeleteReasonError('');
    setDeleteModalError('');
  };

  const closeVoidDeleteModal = () => {
    if (isDeleting) return;
    setDeleteTargetFeeId(null);
    setSelectedPaymentToVoidId('');
    setDeleteReason('');
    setDeleteReasonError('');
    setDeleteModalError('');
  };

  const executeVoidOrDelete = async (
    overrideMode?: 'void_payment' | 'fee_item',
    overridePayment?: FeePayment
  ) => {
    if (!firebaseUser || !isDirector || !deleteTargetFee) {
      setDeleteModalError('Only the Director role can void or delete fee records.');
      return;
    }

    const modeToUse = overrideMode || deleteMode;
    if (overridePayment) {
      setDeleteMode('void_payment');
      setSelectedPaymentToVoidId(overridePayment.id);
    }

    const trimmedReason = deleteReason.trim();
    if (!trimmedReason) {
      setDeleteReasonError(
        modeToUse === 'void_payment'
          ? 'Please enter a reason for voiding this payment.'
          : 'Please enter a reason for deleting this fee item.'
      );
      return;
    }

    setDeleteReasonError('');
    setDeleteModalError('');
    setDataError('');

    const stu = studentsList.find((s) => s.id === deleteTargetFee.studentId);
    const stuFees = reconciledFees.filter((f) => f.studentId === deleteTargetFee.studentId);
    const actorName = currentUser?.displayName || firebaseUser.email || 'School Director';

    setIsDeleting(true);
    try {
      if (modeToUse === 'void_payment') {
        const paymentObj =
          overridePayment ||
          activeDeleteTargetPayments.find((p) => p.id === selectedPaymentToVoidId);
        if (!paymentObj) {
          setDeleteModalError('Please select an active recorded payment to void.');
          setIsDeleting(false);
          return;
        }

        await voidFeePaymentWithAuditInFirestore({
          studentFee: deleteTargetFee,
          payment: paymentObj,
          student: stu,
          allStudentFeesForStudent: stuFees,
          existingPayments: payments,
          reason: trimmedReason,
          voidedBy: actorName,
          voidedByUid: firebaseUser.uid,
        });

        setDeleteTargetFeeId(null);
        setSelectedPaymentToVoidId('');
        setDeleteReason('');
        setSuccessMsg(
          `Voided payment receipt ${paymentObj.receiptNo} (${formatNaira(
            paymentObj.amount
          )}) for ${deleteTargetFee.studentName}. Kept in ledger as Voided and excluded from totals.`
        );
      } else {
        if (activeDeleteTargetPayments.length > 0) {
          setDeleteModalError(
            'Cannot delete this fee item because it still has active payments. Void all active payments first.'
          );
          setIsDeleting(false);
          return;
        }

        await deleteStudentFeeItemWithAuditInFirestore({
          studentFee: deleteTargetFee,
          student: stu,
          allStudentFeesForStudent: stuFees,
          existingPayments: payments,
          reason: trimmedReason,
          deletedBy: actorName,
          deletedByUid: firebaseUser.uid,
        });

        setDeleteTargetFeeId(null);
        setSelectedPaymentToVoidId('');
        setDeleteReason('');
        setSuccessMsg(
          `Deleted ${deleteTargetFee.categoryName} fee item for ${deleteTargetFee.studentName}. Totals updated.`
        );
      }
    } catch (err) {
      console.error('[SchoolFees] Void/Delete failed:', err);
      const msg = extractFriendlyError(err, 'Failed to process void or deletion request.');
      setDeleteModalError(msg);
      setDataError(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  const renderStatusPill = (status: string, overdue = false) => {
    let pill: React.ReactNode;
    switch (status) {
      case 'Paid':
        pill = (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB]">
            Paid
          </span>
        );
        break;
      case 'Partial':
        pill = (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
            Partial
          </span>
        );
        break;
      default:
        pill = (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[#FAF0F2] text-[#86222E] border border-[#E2C1C5]">
            Pending
          </span>
        );
        break;
    }

    if (!overdue) return pill;

    return (
      <div className="inline-flex items-center gap-1 flex-wrap">
        {pill}
        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]">
          Overdue
        </span>
      </div>
    );
  };

  const classSchedulesForSelected = useMemo(
    () =>
      schedules.filter(
        (sc) => sc.session === selectedSession && sc.term === schedTerm && sc.className === schedClass
      ),
    [schedules, selectedSession, schedTerm, schedClass]
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 no-print">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#2A2A2E] tracking-tight">
              School Fees & Bursary
            </h1>
            <span className="bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6] text-xs font-medium px-2.5 py-0.5 rounded-full">
              Currency: Naira (₦)
            </span>
          </div>
          <p className="text-xs text-[#6E6A63] mt-1">
            Fee categories, class/term billing, manual bursary installment recording, unique receipts, and balance reconciliation.
          </p>
        </div>

        {(isAdmin || canRecordPayments) && (
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <button
                type="button"
                onClick={openAssignModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] border border-[#DDD5C7] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] text-xs font-medium transition-colors duration-150"
              >
                <Plus className="w-3.5 h-3.5 text-[#6B1020]" />
                Assign Fee to Student
              </button>
            )}
            {canRecordPayments && (
              <button
                type="button"
                onClick={() => openPaymentModal()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium shadow-xs transition-colors duration-150"
              >
                <CreditCard className="w-3.5 h-3.5 text-[#E3CFA6]" />
                Record Payment (₦)
              </button>
            )}
          </div>
        )}
      </div>

      {/* Explicit Manual Recording Notice */}
      <div className="flex items-start gap-2.5 bg-[#FAF0F2] border border-[#DFC7CA] text-[#2A2A2E] px-4 py-3 rounded-[10px] text-xs no-print">
        <Info className="w-4 h-4 text-[#6B1020] shrink-0 mt-0.5" />
        <div>
          <strong className="text-[#6B1020]">Manual Bursary Payment Recording:</strong> Online payment processing is not integrated. Fees support part payments (installments) and automatically update between <strong>Pending</strong>, <strong>Partial</strong>, and <strong>Paid</strong> strictly from active payments posted by the Bursar / Accountant or Director.
        </div>
      </div>

      {dataError && (
        <div className="flex items-center gap-2 bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] px-4 py-3 rounded-[10px] text-xs font-medium no-print">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{dataError}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-2 bg-[#EEF4F0] border border-[#C5D6CB] text-[#2A583B] px-4 py-3 rounded-[10px] text-xs font-medium no-print">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Global Session / Term / Class Filters */}
      <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-4 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] no-print">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
              Academic Session
            </label>
            <select
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] font-medium focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name} {s.isActive ? '(Active)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
              Academic Term
            </label>
            <select
              value={selectedTerm}
              onChange={(e) => setSelectedTerm(e.target.value as AcademicTerm | 'All')}
              className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] font-medium focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
            >
              <option value="First Term">First Term</option>
              <option value="Second Term">Second Term</option>
              <option value="Third Term">Third Term</option>
              <option value="All">All Terms (Full Session)</option>
            </select>
          </div>

          {!isParent && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                Filter by Class
              </label>
              <select
                value={selectedClassFilter}
                onChange={(e) => setSelectedClassFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] font-medium focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
              >
                <option value="All">All School Classes (Creche – SS 3)</option>
                {groupClassesBySection(classesList).map((g) => (
                  <optgroup key={g.section} label={g.label}>
                    {g.classes.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
              Search Records
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#7F7A72]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Student, admission no, receipt..."
                className="w-full pl-8 pr-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] placeholder:text-[#7F7A72] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Financial Overview Cards (Expected, Collected, Outstanding) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 no-print">
        <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
            Total Fees Expected ({selectedTerm === 'All' ? selectedSession : selectedTerm})
          </span>
          <div className="text-2xl sm:text-3xl font-bold text-[#2A2A2E] mt-1.5 tabular-nums">
            {formatNaira(kpiTotals.totalExpected)}
          </div>
          <span className="text-[11px] text-[#6E6A63] mt-1 block">
            Across {scopedFees.length} assigned fee item{scopedFees.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#2A583B]">
            Total Fees Collected (₦)
          </span>
          <div className="text-2xl sm:text-3xl font-bold text-[#2A583B] mt-1.5 tabular-nums">
            {formatNaira(kpiTotals.totalCollected)}
          </div>
          <span className="text-[11px] text-[#2A583B] font-medium mt-1 block">
            {kpiTotals.collectionRate}% Collection Rate • {activeScopedPaymentCount} active payment
            {activeScopedPaymentCount === 1 ? '' : 's'}
          </span>
        </div>

        <div className="bg-white rounded-[10px] p-5 border border-[#E6DFD3] border-t-2 border-t-[#B8913A] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7D5A18]">
            Outstanding Balances
          </span>
          <div className="text-2xl sm:text-3xl font-bold text-[#7D5A18] mt-1.5 tabular-nums">
            {formatNaira(kpiTotals.outstandingBalance)}
          </div>
          <span className="text-[11px] text-[#6E6A63] mt-1 block">
            Automatically calculated from expected minus recorded payments
          </span>
        </div>
      </div>

      {/* Staff Navigation Tabs */}
      {isStaffViewer && (
        <div className="flex flex-wrap gap-1.5 p-1 bg-[#FAF8F4] border border-[#E6DFD3] rounded-[10px] w-fit no-print">
          {(
            [
              { id: 'billing', label: 'Student Fees & Payments', icon: Receipt, show: true },
              { id: 'statements', label: 'Student Statements', icon: FileText, show: true },
              { id: 'summaries', label: 'Class Payment Summaries', icon: Building2, show: true },
              { id: 'ledger', label: 'Payment Ledger & Receipts', icon: FileSpreadsheet, show: true },
              { id: 'setup', label: 'Categories & Class Fees', icon: Layers, show: isAdmin },
            ] as const
          )
            .filter((t) => t.show)
            .map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-[8px] transition-colors duration-150 ${
                    activeTab === tab.id
                      ? 'bg-[#6B1020] text-white shadow-xs'
                      : 'text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
        </div>
      )}

      {isLoading ? (
        <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-12 text-center text-xs text-[#6E6A63]">
          Loading school fee schedules, student obligations, and payment records...
        </div>
      ) : (
        <>
          {/* ==================== TAB 1: STUDENT FEES & PAYMENTS ==================== */}
          {activeTab === 'billing' && isStaffViewer && (
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] overflow-hidden">
              <div className="p-4 border-b border-[#EFE9DF] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-[#2A2A2E]">Assigned Student Fees</h2>
                  <span className="text-xs font-medium text-[#6E6A63]">
                    ({scopedFees.length} items)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {(['All', 'Pending', 'Partial', 'Paid'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-3 py-1 rounded-[8px] text-xs font-medium border transition-colors duration-150 ${
                        statusFilter === st
                          ? 'bg-[#6B1020] text-white border-[#6B1020]'
                          : 'bg-white text-[#5E5B56] border-[#DDD5C7] hover:bg-[#FAF8F4]'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                      <th className="py-3 px-4">Student & Class</th>
                      <th className="py-3 px-4">Fee Category</th>
                      <th className="py-3 px-4">Term</th>
                      <th className="py-3 px-4">Expected (₦)</th>
                      <th className="py-3 px-4">Paid & Progress</th>
                      <th className="py-3 px-4">Balance (₦)</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFE9DF] text-xs">
                    {scopedFees.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-[#7F7A72]">
                          No student fee obligations found for this filter. Use{' '}
                          <strong className="text-[#2A2A2E]">Categories & Class Fees</strong> to configure class schedules and bulk-assign fees, or click <strong className="text-[#2A2A2E]">Assign Fee to Student</strong>.
                        </td>
                      </tr>
                    ) : (
                      scopedFees.map((fee) => {
                        const isExpanded = expandedFeeIds.has(fee.id);
                        const historyEntries = installmentHistoryByFeeId.get(fee.id) || [];
                        const activeInstallmentCount = historyEntries.filter(
                          (h) => h.installmentNumber !== null
                        ).length;
                        const pctPaid =
                          fee.amountDue > 0
                            ? Math.min(100, Math.round((fee.amountPaid / fee.amountDue) * 100))
                            : 0;
                        const overdue = isFeeOverdue(fee);

                        return (
                          <React.Fragment key={fee.id}>
                            <tr className="hover:bg-[#FAF8F4] transition-colors duration-150">
                              <td className="py-3.5 px-4">
                                <div className="flex items-start gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleExpandFeeRow(fee.id)}
                                    aria-expanded={isExpanded}
                                    aria-label={
                                      isExpanded
                                        ? `Collapse payment history for ${fee.studentName}`
                                        : `Expand payment history for ${fee.studentName}`
                                    }
                                    title={
                                      isExpanded
                                        ? 'Hide installment payment history'
                                        : 'Show installment payment history'
                                    }
                                    className="mt-0.5 p-1 rounded-[6px] text-[#6E6A63] hover:text-[#6B1020] hover:bg-[#FAF0F2] border border-transparent hover:border-[#DFC7CA] transition-colors duration-150 shrink-0"
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  <div>
                                    <p className="font-semibold text-[#2A2A2E]">{fee.studentName}</p>
                                    <span className="text-[11px] text-[#6E6A63]">
                                      {fee.admissionNo} • {fee.className}
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3.5 px-4">
                                <p className="font-medium text-[#2A2A2E]">{fee.categoryName}</p>
                                <span className="text-[10px] text-[#6E6A63]">
                                  {activeInstallmentCount === 0
                                    ? 'No installments yet'
                                    : `${activeInstallmentCount} installment${
                                        activeInstallmentCount === 1 ? '' : 's'
                                      }`}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-[#5E5B56]">
                                <p>{fee.term}</p>
                                {fee.dueDate && (
                                  <span
                                    className={`text-[10px] block ${
                                      overdue ? 'text-[#B91C1C] font-semibold' : 'text-[#7F7A72]'
                                    }`}
                                  >
                                    Due: {fee.dueDate}
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 font-semibold text-[#2A2A2E] tabular-nums">
                                {formatNaira(fee.amountDue)}
                              </td>
                              <td className="py-3.5 px-4 min-w-[165px]">
                                <div className="font-semibold text-[#2A583B] tabular-nums">
                                  {formatNaira(fee.amountPaid)}
                                </div>
                                <div className="mt-1 space-y-1">
                                  <div className="w-full h-1.5 rounded-full bg-[#EFE9DF] overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-300 ${
                                        pctPaid >= 100
                                          ? 'bg-[#2A583B]'
                                          : pctPaid > 0
                                          ? 'bg-[#B8913A]'
                                          : 'bg-[#DDD5C7]'
                                      }`}
                                      style={{ width: `${pctPaid}%` }}
                                    />
                                  </div>
                                  <span className="block text-[10px] text-[#6E6A63] tabular-nums">
                                    {formatNaira(fee.amountPaid)} of {formatNaira(fee.amountDue)} paid
                                  </span>
                                </div>
                              </td>
                              <td className="py-3.5 px-4 font-semibold text-[#7D5A18] tabular-nums">
                                {formatNaira(fee.balance)}
                              </td>
                              <td className="py-3.5 px-4">
                                {renderStatusPill(fee.status, overdue)}
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  {fee.balance > 0 && canRecordPayments && (
                                    <button
                                      type="button"
                                      onClick={() => openPaymentModal(fee)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-[#FAF0F2] hover:bg-[#F3E1E5] text-[#6B1020] border border-[#DFC7CA] font-medium transition-colors duration-150"
                                    >
                                      <CreditCard className="w-3.5 h-3.5" />
                                      Record Payment
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setStatementStudentId(fee.studentId);
                                      setActiveTab('statements');
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] font-medium transition-colors duration-150"
                                  >
                                    Statement
                                  </button>
                                  {isDirector && (
                                    <>
                                      <button
                                        type="button"
                                        title="Edit"
                                        aria-label="Edit"
                                        onClick={() => openEditModal(fee)}
                                        className="inline-flex items-center justify-center p-1.5 rounded-[8px] text-[#7D5A18] bg-[#FBF5E8] hover:bg-[#F4E9D0] border border-[#E3CFA6] transition-colors duration-150"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Void / Delete"
                                        aria-label="Void / Delete"
                                        onClick={() => openVoidDeleteModal(fee)}
                                        className="inline-flex items-center justify-center p-1 rounded-[7px] text-[#B91C1C] bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FECACA] transition-colors duration-150"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>

                            {isExpanded && (
                              <tr className="bg-[#FAF8F4]/80">
                                <td colSpan={8} className="px-6 py-3.5 border-t border-[#EFE9DF]">
                                  <div className="bg-white rounded-[8px] border border-[#E6DFD3] p-3.5 space-y-2.5">
                                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#EFE9DF]">
                                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                                        Payment History — {fee.categoryName} ({fee.studentName})
                                      </div>
                                      <div className="text-[11px] text-[#6E6A63] tabular-nums">
                                        Expected: <strong className="text-[#2A2A2E]">{formatNaira(fee.amountDue)}</strong> •{' '}
                                        Paid: <strong className="text-[#2A583B]">{formatNaira(fee.amountPaid)}</strong> •{' '}
                                        Balance: <strong className="text-[#7D5A18]">{formatNaira(fee.balance)}</strong>
                                      </div>
                                    </div>

                                    {historyEntries.length === 0 ? (
                                      <div className="py-3 text-center text-[#7F7A72] text-xs">
                                        No installment payments have been recorded for this fee item yet.
                                      </div>
                                    ) : (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs">
                                          <thead>
                                            <tr className="text-[10px] font-semibold uppercase tracking-wider text-[#5E5B56] border-b border-[#EFE9DF]">
                                              <th className="py-2 pr-3">Installment</th>
                                              <th className="py-2 px-3">Receipt No</th>
                                              <th className="py-2 px-3">Date</th>
                                              <th className="py-2 px-3">Method & Ref</th>
                                              <th className="py-2 px-3">Amount (₦)</th>
                                              <th className="py-2 px-3">Running Balance (₦)</th>
                                              <th className="py-2 pl-3 text-right">Receipt</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-[#EFE9DF]">
                                            {historyEntries.map((entry) => {
                                              const p = entry.payment;
                                              return (
                                                <tr
                                                  key={p.id}
                                                  className={p.isVoided ? 'bg-[#FEF2F2]/40' : ''}
                                                >
                                                  <td className="py-2 pr-3 font-medium text-[#5E5B56]">
                                                    {entry.installmentNumber ? (
                                                      <span>Inst. #{entry.installmentNumber}</span>
                                                    ) : (
                                                      <span className="text-[#B91C1C]">Voided</span>
                                                    )}
                                                  </td>
                                                  <td className="py-2 px-3">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                      <span
                                                        className={`font-mono font-semibold ${
                                                          p.isVoided
                                                            ? 'line-through text-[#7F7A72]'
                                                            : 'text-[#6B1020]'
                                                        }`}
                                                      >
                                                        {p.receiptNo}
                                                      </span>
                                                      {p.isEdited && !p.isVoided && (
                                                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
                                                          Edited
                                                        </span>
                                                      )}
                                                      {p.isVoided && (
                                                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]">
                                                          Voided
                                                        </span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-2 px-3 text-[#5E5B56]">
                                                    {p.paymentDate}
                                                  </td>
                                                  <td className="py-2 px-3 text-[#5E5B56]">
                                                    <span>{p.paymentMethod}</span>
                                                    {p.transactionRef && (
                                                      <span className="block text-[10px] font-mono text-[#7F7A72]">
                                                        {p.transactionRef}
                                                      </span>
                                                    )}
                                                  </td>
                                                  <td className="py-2 px-3 font-semibold tabular-nums">
                                                    {p.isVoided ? (
                                                      <span className="line-through text-[#B91C1C]">
                                                        {formatNaira(p.amount)}
                                                      </span>
                                                    ) : (
                                                      <span className="text-[#2A583B]">
                                                        {formatNaira(p.amount)}
                                                      </span>
                                                    )}
                                                  </td>
                                                  <td className="py-2 px-3 font-semibold tabular-nums">
                                                    {p.isVoided ? (
                                                      <span className="text-[11px] font-normal text-[#991B1B]">
                                                        Excluded
                                                      </span>
                                                    ) : entry.runningBalanceAfter === 0 ? (
                                                      <span className="text-[#2A583B]">
                                                        ₦0 (Fully Paid)
                                                      </span>
                                                    ) : (
                                                      <span className="text-[#7D5A18]">
                                                        {formatNaira(entry.runningBalanceAfter)}
                                                      </span>
                                                    )}
                                                  </td>
                                                  <td className="py-2 pl-3 text-right">
                                                    <button
                                                      type="button"
                                                      onClick={() => setSelectedReceipt(p)}
                                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-[7px] bg-[#FAF0F2] hover:bg-[#F3E1E5] text-[#6B1020] border border-[#DFC7CA] text-[11px] font-medium transition-colors duration-150"
                                                    >
                                                      <Receipt className="w-3 h-3" />
                                                      Receipt
                                                    </button>
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== TAB 2: INDIVIDUAL STUDENT FEE STATEMENTS ==================== */}
          {activeTab === 'statements' && (
            <div className="space-y-5">
              {/* Student Selector */}
              <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-4 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
                <div className="flex items-center gap-3 flex-1">
                  <UserCheck className="w-5 h-5 text-[#6B1020] shrink-0" />
                  <div className="flex-1 max-w-md">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-1">
                      {isParent ? 'Linked Child / Ward' : 'Select Student for Fee Statement'}
                    </label>
                    <select
                      value={statementStudentId}
                      onChange={(e) => setStatementStudentId(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] font-medium focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                    >
                      {activeStudents.length === 0 ? (
                        <option value="">No active student found</option>
                      ) : (
                        activeStudents.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.fullName} ({s.admissionNo}) — {s.className}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>

                {activeStatement && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await downloadStudentStatementPDF({
                          statement: activeStatement,
                          schoolSettings: schoolSettings,
                          session: selectedSession,
                          term: selectedTerm,
                        });
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#FBF5E8] hover:bg-[#F4E9D0] text-[#7D5A18] border border-[#E3CFA6] text-xs font-medium transition-colors duration-150"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Statement PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print Statement
                    </button>
                  </div>
                )}
              </div>

              {!activeStatement ? (
                <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-10 text-center text-xs text-[#6E6A63]">
                  No student statement available.
                </div>
              ) : (
                <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 sm:p-8 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] print-only-card space-y-6">
                  {/* Statement Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E6DFD3]">
                    <div className="flex items-center gap-3.5">
                      <SchoolLogo
                        logoDataUrl={schoolSettings.logoDataUrl}
                        schoolName={schoolSettings.schoolName}
                        size="md"
                        variant="print"
                      />
                      <div>
                        <h2 className="font-serif text-lg font-semibold text-[#6B1020] uppercase tracking-wide">
                          {schoolSettings.schoolName} — Student Fee Statement
                        </h2>
                        <p className="text-xs text-[#5E5B56] mt-0.5">
                          <strong className="text-[#2A2A2E]">{activeStatement.student.fullName}</strong> (
                          <span className="font-mono">{activeStatement.student.admissionNo}</span>) •{' '}
                          {activeStatement.student.className}
                        </p>
                        <p className="text-[11px] text-[#6E6A63]">
                          Period: {selectedSession} ({selectedTerm === 'All' ? 'All Terms' : selectedTerm})
                        </p>
                      </div>
                    </div>
                    <div>{renderStatusPill(activeStatement.overallStatus)}</div>
                  </div>

                  {/* Statement Totals */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-[#FAF8F4] p-4 rounded-[10px] border border-[#E6DFD3]">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] block">
                        Total Assigned Fees
                      </span>
                      <strong className="text-xl font-bold text-[#2A2A2E] tabular-nums">
                        {formatNaira(activeStatement.totalExpected)}
                      </strong>
                    </div>
                    <div className="bg-[#EEF4F0] p-4 rounded-[10px] border border-[#C5D6CB]">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#2A583B] block">
                        Total Recorded Payments
                      </span>
                      <strong className="text-xl font-bold text-[#2A583B] tabular-nums">
                        {formatNaira(activeStatement.totalPaid)}
                      </strong>
                    </div>
                    <div className="bg-[#FBF5E8] p-4 rounded-[10px] border border-[#E3CFA6]">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7D5A18] block">
                        Outstanding Balance
                      </span>
                      <strong className="text-xl font-bold text-[#7D5A18] tabular-nums">
                        {formatNaira(activeStatement.outstandingBalance)}
                      </strong>
                    </div>
                  </div>

                  {/* Assigned Fee Breakdown */}
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5E5B56] mb-2">
                      Assigned Fee Items
                    </h3>
                    <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                          <tr>
                            <th className="py-2.5 px-3">Fee Category</th>
                            <th className="py-2.5 px-3">Term</th>
                            <th className="py-2.5 px-3">Due Date</th>
                            <th className="py-2.5 px-3">Expected (₦)</th>
                            <th className="py-2.5 px-3">Paid (₦)</th>
                            <th className="py-2.5 px-3">Balance (₦)</th>
                            <th className="py-2.5 px-3">Status</th>
                            {canRecordPayments && (
                              <th className="py-2.5 px-3 text-right no-print">Action</th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EFE9DF]">
                          {activeStatement.fees.length === 0 ? (
                            <tr>
                              <td
                                colSpan={canRecordPayments ? 8 : 7}
                                className="py-6 text-center text-[#7F7A72]"
                              >
                                No fees assigned to this student for the selected period.
                              </td>
                            </tr>
                          ) : (
                            activeStatement.fees.map((f) => (
                              <tr key={f.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                                <td className="py-2.5 px-3 font-semibold text-[#2A2A2E]">
                                  {f.categoryName}
                                </td>
                                <td className="py-2.5 px-3 text-[#5E5B56]">{f.term}</td>
                                <td className="py-2.5 px-3 text-[#5E5B56]">
                                  {f.dueDate || '—'}
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-[#2A2A2E] tabular-nums">
                                  {formatNaira(f.amountDue)}
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-[#2A583B] tabular-nums">
                                  {formatNaira(f.amountPaid)}
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-[#7D5A18] tabular-nums">
                                  {formatNaira(f.balance)}
                                </td>
                                <td className="py-2.5 px-3">
                                  {renderStatusPill(f.status, isFeeOverdue(f))}
                                </td>
                                {canRecordPayments && (
                                  <td className="py-2.5 px-3 text-right no-print">
                                    {f.balance > 0 ? (
                                      <button
                                        type="button"
                                        onClick={() => openPaymentModal(f)}
                                        className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] underline"
                                      >
                                        Record Payment
                                      </button>
                                    ) : (
                                      <span className="text-[11px] text-[#2A583B] font-medium">
                                        Cleared
                                      </span>
                                    )}
                                  </td>
                                )}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Recorded Payment History (Chronological with Running Balance) */}
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5E5B56] mb-2">
                      Recorded Installments & Payment History (Chronological)
                    </h3>
                    <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                          <tr>
                            <th className="py-2.5 px-3">Date</th>
                            <th className="py-2.5 px-3">Receipt No</th>
                            <th className="py-2.5 px-3">Fee Category</th>
                            <th className="py-2.5 px-3">Method & Ref</th>
                            <th className="py-2.5 px-3">Amount Paid (₦)</th>
                            <th className="py-2.5 px-3">Running Balance (₦)</th>
                            <th className="py-2.5 px-3 text-right no-print">Receipt</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EFE9DF]">
                          {activeStatement.paymentEntries.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-6 text-center text-[#7F7A72]">
                                No payments have been recorded for this student in the selected period.
                              </td>
                            </tr>
                          ) : (
                            activeStatement.paymentEntries.map((entry) => {
                              const p = entry.payment;
                              return (
                                <tr
                                  key={p.id}
                                  className={`transition-colors duration-150 ${
                                    p.isVoided ? 'bg-[#FEF2F2]/40' : 'hover:bg-[#FAF8F4]'
                                  }`}
                                >
                                  <td className="py-2.5 px-3 text-[#5E5B56] whitespace-nowrap">
                                    {p.paymentDate}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span
                                        className={`font-mono font-semibold ${
                                          p.isVoided ? 'line-through text-[#7F7A72]' : 'text-[#6B1020]'
                                        }`}
                                      >
                                        {p.receiptNo}
                                      </span>
                                      {entry.installmentNumber && (
                                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FAF8F4] text-[#5E5B56] border border-[#DDD5C7]">
                                          Inst. #{entry.installmentNumber}
                                        </span>
                                      )}
                                      {p.isEdited && !p.isVoided && (
                                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
                                          Edited
                                        </span>
                                      )}
                                      {p.isVoided && (
                                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]">
                                          Voided
                                        </span>
                                      )}
                                    </div>
                                    {p.isVoided && p.voidReason && (
                                      <span className="block text-[10px] text-[#991B1B] mt-0.5">
                                        Reason: {p.voidReason}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 font-medium text-[#2A2A2E]">
                                    {p.categoryName}
                                  </td>
                                  <td className="py-2.5 px-3 text-[#5E5B56]">
                                    <span>{p.paymentMethod}</span>
                                    {p.transactionRef && (
                                      <span className="block text-[10px] font-mono text-[#7F7A72]">
                                        {p.transactionRef}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 font-semibold tabular-nums">
                                    {p.isVoided ? (
                                      <div>
                                        <span className="line-through text-[#B91C1C]">
                                          {formatNaira(p.amount)}
                                        </span>
                                        <span className="block text-[10px] font-normal text-[#991B1B]">
                                          Excluded
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="text-[#2A583B]">{formatNaira(p.amount)}</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 font-semibold tabular-nums">
                                    {p.isVoided ? (
                                      <span className="text-[11px] font-normal text-[#991B1B]">
                                        Excluded
                                      </span>
                                    ) : entry.itemRunningBalance === 0 ? (
                                      <span className="text-[#2A583B]">₦0 (Fully Paid)</span>
                                    ) : (
                                      <span className="text-[#7D5A18]">
                                        {formatNaira(entry.itemRunningBalance)}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-right no-print">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedReceipt(p)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-[#FAF0F2] hover:bg-[#F3E1E5] text-[#6B1020] border border-[#DFC7CA] font-medium transition-colors duration-150"
                                    >
                                      <Receipt className="w-3.5 h-3.5" />
                                      Receipt
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== TAB 3: CLASS PAYMENT SUMMARIES ==================== */}
          {activeTab === 'summaries' && isStaffViewer && (
            <div className="space-y-5">
              <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 sm:p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] print-only-card space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E6DFD3]">
                  <div className="flex items-center gap-3">
                    <SchoolLogo
                      logoDataUrl={schoolSettings.logoDataUrl}
                      schoolName={schoolSettings.schoolName}
                      size="md"
                      variant="print"
                    />
                    <div>
                      <h2 className="font-serif text-base font-semibold text-[#6B1020] uppercase tracking-wide">
                        {schoolSettings.schoolName} — Class Payment Summary Report
                      </h2>
                      <p className="text-xs text-[#6E6A63]">
                        {selectedSession} • {selectedTerm === 'All' ? 'All Terms' : selectedTerm}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 no-print">
                    <button
                      type="button"
                      onClick={() =>
                        exportClassSummaryCSV({
                          summaryRows: classSummaryRows,
                          session: selectedSession,
                          term: selectedTerm,
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] border border-[#DDD5C7] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] text-xs font-medium transition-colors duration-150"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-[#2A583B]" />
                      Export CSV
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await downloadClassFeeSummaryPDF({
                          summaryRows: classSummaryRows,
                          totals: classSummaryTotals,
                          schoolSettings: schoolSettings,
                          session: selectedSession,
                          term: selectedTerm,
                        });
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-[#FBF5E8] hover:bg-[#F4E9D0] text-[#7D5A18] border border-[#E3CFA6] text-xs font-medium transition-colors duration-150"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print Summary
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                      <tr>
                        <th className="py-3 px-3">Class</th>
                        <th className="py-3 px-3">Section</th>
                        <th className="py-3 px-3 text-center">Active / Billed</th>
                        <th className="py-3 px-3">Total Expected (₦)</th>
                        <th className="py-3 px-3">Total Collected (₦)</th>
                        <th className="py-3 px-3">Outstanding (₦)</th>
                        <th className="py-3 px-3 text-center">Rate</th>
                        <th className="py-3 px-3 text-center">Paid / Partial / Pending</th>
                        <th className="py-3 px-3 text-right no-print">Breakdown</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFE9DF]">
                      {classSummaryRows.map((row) => (
                        <tr key={row.className} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                          <td className="py-3 px-3 font-semibold text-[#2A2A2E]">{row.className}</td>
                          <td className="py-3 px-3 text-[#5E5B56]">{row.section || '—'}</td>
                          <td className="py-3 px-3 text-center text-[#5E5B56] tabular-nums">
                            {row.enrolledCount} / {row.billedStudentsCount}
                          </td>
                          <td className="py-3 px-3 font-semibold text-[#2A2A2E] tabular-nums">
                            {formatNaira(row.totalExpected)}
                          </td>
                          <td className="py-3 px-3 font-semibold text-[#2A583B] tabular-nums">
                            {formatNaira(row.totalCollected)}
                          </td>
                          <td className="py-3 px-3 font-semibold text-[#7D5A18] tabular-nums">
                            {formatNaira(row.outstandingBalance)}
                          </td>
                          <td className="py-3 px-3 text-center font-semibold text-[#6B1020] tabular-nums">
                            {row.collectionRate}%
                          </td>
                          <td className="py-3 px-3 text-center tabular-nums">
                            <span className="text-[#2A583B] font-semibold">{row.paidCount}</span> /{' '}
                            <span className="text-[#7D5A18] font-semibold">{row.partialCount}</span> /{' '}
                            <span className="text-[#86222E] font-semibold">{row.pendingCount}</span>
                          </td>
                          <td className="py-3 px-3 text-right no-print">
                            <button
                              type="button"
                              onClick={() =>
                                setDrilldownClass(
                                  drilldownClass === row.className ? '' : row.className
                                )
                              }
                              className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] underline"
                            >
                              {drilldownClass === row.className ? 'Hide Pupils' : 'View Pupils'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Drilldown Student Breakdown for Selected Class */}
              {drilldownClass && (
                <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-3 no-print">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[#2A2A2E] flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#6B1020]" />
                      Student Fee Breakdown — {drilldownClass}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setDrilldownClass('')}
                      className="text-xs font-medium text-[#6E6A63] hover:text-[#2A2A2E]"
                    >
                      Close
                    </button>
                  </div>

                  <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                        <tr>
                          <th className="py-2.5 px-3">Student</th>
                          <th className="py-2.5 px-3">Admission No</th>
                          <th className="py-2.5 px-3">Expected (₦)</th>
                          <th className="py-2.5 px-3">Paid (₦)</th>
                          <th className="py-2.5 px-3">Balance (₦)</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3 text-right">Statement</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EFE9DF]">
                        {studentsList
                          .filter((s) => s.className === drilldownClass && s.status === 'Active')
                          .map((stu) => {
                            const st = computeStudentStatement({
                              student: stu,
                              reconciledFees,
                              payments,
                              session: selectedSession,
                              term: selectedTerm,
                            });
                            return (
                              <tr key={stu.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                                <td className="py-2.5 px-3 font-semibold text-[#2A2A2E]">
                                  {stu.fullName}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-[#5E5B56]">
                                  {stu.admissionNo}
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-[#2A2A2E] tabular-nums">
                                  {formatNaira(st.totalExpected)}
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-[#2A583B] tabular-nums">
                                  {formatNaira(st.totalPaid)}
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-[#7D5A18] tabular-nums">
                                  {formatNaira(st.outstandingBalance)}
                                </td>
                                <td className="py-2.5 px-3">{renderStatusPill(st.overallStatus)}</td>
                                <td className="py-2.5 px-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setStatementStudentId(stu.id);
                                      setActiveTab('statements');
                                    }}
                                    className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] underline"
                                  >
                                    Open
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>

                  {/* Individual Installment Entries for Selected Class */}
                  <div className="pt-3 border-t border-[#EFE9DF] space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#5E5B56]">
                      Class Installment Payment Entries — {drilldownClass}
                    </h4>
                    <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                          <tr>
                            <th className="py-2.5 px-3">Date</th>
                            <th className="py-2.5 px-3">Receipt No</th>
                            <th className="py-2.5 px-3">Student</th>
                            <th className="py-2.5 px-3">Fee Category</th>
                            <th className="py-2.5 px-3">Method & Ref</th>
                            <th className="py-2.5 px-3">Amount (₦)</th>
                            <th className="py-2.5 px-3">Running Balance (₦)</th>
                            <th className="py-2.5 px-3 text-right">Receipt</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EFE9DF]">
                          {(() => {
                            const classPayments = payments
                              .filter(
                                (p) =>
                                  p.className === drilldownClass &&
                                  p.session === selectedSession &&
                                  (selectedTerm === 'All' || p.term === selectedTerm)
                              )
                              .sort(
                                (a, b) =>
                                  (a.paymentDate || '').localeCompare(b.paymentDate || '') ||
                                  (a.createdAt || '').localeCompare(b.createdAt || '')
                              );

                            if (classPayments.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={8} className="py-6 text-center text-[#7F7A72]">
                                    No installment payments recorded for {drilldownClass} in the selected period.
                                  </td>
                                </tr>
                              );
                            }

                            return classPayments.map((p) => {
                              const entry = installmentEntryByPaymentId.get(p.id);
                              return (
                                <tr
                                  key={p.id}
                                  className={p.isVoided ? 'bg-[#FEF2F2]/40' : 'hover:bg-[#FAF8F4]'}
                                >
                                  <td className="py-2.5 px-3 text-[#5E5B56] whitespace-nowrap">
                                    {p.paymentDate}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span
                                        className={`font-mono font-semibold ${
                                          p.isVoided
                                            ? 'line-through text-[#7F7A72]'
                                            : 'text-[#6B1020]'
                                        }`}
                                      >
                                        {p.receiptNo}
                                      </span>
                                      {entry?.installmentNumber && (
                                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FAF8F4] text-[#5E5B56] border border-[#DDD5C7]">
                                          Inst. #{entry.installmentNumber}
                                        </span>
                                      )}
                                      {p.isVoided && (
                                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]">
                                          Voided
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 font-semibold text-[#2A2A2E]">
                                    {p.studentName}
                                  </td>
                                  <td className="py-2.5 px-3 text-[#2A2A2E]">{p.categoryName}</td>
                                  <td className="py-2.5 px-3 text-[#5E5B56]">
                                    {p.paymentMethod}
                                    {p.transactionRef ? ` (${p.transactionRef})` : ''}
                                  </td>
                                  <td className="py-2.5 px-3 font-semibold tabular-nums">
                                    {p.isVoided ? (
                                      <span className="line-through text-[#B91C1C]">
                                        {formatNaira(p.amount)}
                                      </span>
                                    ) : (
                                      <span className="text-[#2A583B]">{formatNaira(p.amount)}</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 font-semibold tabular-nums">
                                    {p.isVoided ? (
                                      <span className="text-[11px] font-normal text-[#991B1B]">
                                        Excluded
                                      </span>
                                    ) : entry ? (
                                      entry.runningBalanceAfter === 0 ? (
                                        <span className="text-[#2A583B]">₦0 (Fully Paid)</span>
                                      ) : (
                                        <span className="text-[#7D5A18]">
                                          {formatNaira(entry.runningBalanceAfter)}
                                        </span>
                                      )
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedReceipt(p)}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-[7px] bg-[#FAF0F2] hover:bg-[#F3E1E5] text-[#6B1020] border border-[#DFC7CA] text-[11px] font-medium"
                                    >
                                      <Receipt className="w-3 h-3" />
                                      Receipt
                                    </button>
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== TAB 4: PAYMENT LEDGER & RECEIPTS ==================== */}
          {activeTab === 'ledger' && isStaffViewer && (
            <div className="space-y-6">
              <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] overflow-hidden">
                <div className="p-4 border-b border-[#EFE9DF] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[#2A2A2E]">
                      Manual Payment Ledger & Official Receipts
                    </h2>
                    <p className="text-[11px] text-[#6E6A63]">
                      Every installment payment appears as its own entry with a unique receipt number, payment date, method, and transaction reference.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      exportPaymentsLedgerCSV({
                        payments: scopedPayments,
                        session: selectedSession,
                        term: selectedTerm,
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] border border-[#DDD5C7] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] text-xs font-medium transition-colors duration-150"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-[#2A583B]" />
                    Export Ledger CSV
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                        <th className="py-3 px-4">Receipt No</th>
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4">Student & Class</th>
                        <th className="py-3 px-4">Fee Category</th>
                        <th className="py-3 px-4">Method & Ref</th>
                        <th className="py-3 px-4">Amount (₦)</th>
                        <th className="py-3 px-4">Recorded By</th>
                        <th className="py-3 px-4 text-right">Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFE9DF] text-xs">
                      {scopedPayments.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-10 text-center text-[#7F7A72]">
                            No recorded payments match the current filter.
                          </td>
                        </tr>
                      ) : (
                        scopedPayments.map((p) => {
                          const entry = installmentEntryByPaymentId.get(p.id);
                          return (
                            <tr
                              key={p.id}
                              className={`transition-colors duration-150 ${
                                p.isVoided ? 'bg-[#FEF2F2]/40' : 'hover:bg-[#FAF8F4]'
                              }`}
                            >
                              <td className="py-3.5 px-4">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span
                                    className={`font-mono font-semibold ${
                                      p.isVoided ? 'line-through text-[#7F7A72]' : 'text-[#6B1020]'
                                    }`}
                                  >
                                    {p.receiptNo}
                                  </span>
                                  {entry?.installmentNumber && (
                                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FAF8F4] text-[#5E5B56] border border-[#DDD5C7]">
                                      Inst. #{entry.installmentNumber}
                                    </span>
                                  )}
                                  {p.isEdited && !p.isVoided && (
                                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
                                      Edited
                                    </span>
                                  )}
                                  {p.isVoided && (
                                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]">
                                      Voided
                                    </span>
                                  )}
                                </div>
                                {p.isVoided && p.voidReason && (
                                  <span className="block text-[10px] text-[#991B1B] mt-0.5 max-w-[200px]">
                                    Void reason: {p.voidReason}
                                  </span>
                                )}
                                {p.isEdited && !p.isVoided && p.editReason && (
                                  <span className="block text-[10px] text-[#7D5A18] mt-0.5 max-w-[200px]">
                                    Edit note: {p.editReason}
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-[#5E5B56]">{p.paymentDate}</td>
                              <td className="py-3.5 px-4">
                                <p className="font-semibold text-[#2A2A2E]">{p.studentName}</p>
                                <span className="text-[11px] text-[#6E6A63]">
                                  {p.admissionNo} • {p.className}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 font-medium text-[#2A2A2E]">
                                {p.categoryName}
                              </td>
                              <td className="py-3.5 px-4">
                                <p className="font-medium text-[#2A2A2E]">{p.paymentMethod}</p>
                                <span className="text-[11px] font-mono text-[#6E6A63]">
                                  {p.transactionRef}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 font-semibold tabular-nums">
                                {p.isVoided ? (
                                  <div>
                                    <span className="line-through text-[#B91C1C]">
                                      {formatNaira(p.amount)}
                                    </span>
                                    <span className="block text-[10px] font-normal text-[#991B1B]">
                                      Excluded from totals
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-[#2A583B]">{formatNaira(p.amount)}</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-[#5E5B56]">{p.recordedBy}</td>
                              <td className="py-3.5 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => setSelectedReceipt(p)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-[#FAF0F2] hover:bg-[#F3E1E5] text-[#6B1020] border border-[#DFC7CA] font-medium transition-colors duration-150"
                                >
                                  <Receipt className="w-3.5 h-3.5" />
                                  Print / PDF
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Director-Only Full Audit Log (Edits, Voids & Deletions) */}
              {isDirector && (
                <div className="bg-white rounded-[10px] border border-[#E3CFA6] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] overflow-hidden">
                  <div className="p-4 border-b border-[#EFE9DF] bg-[#FBF5E8]/55 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6] flex items-center justify-center text-[#7D5A18]">
                        <History className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-[#2A2A2E]">
                            Audit Log — Edits, Voids & Deletions
                          </h3>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
                            {scopedAuditLogs.length}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FAF0F2] text-[#6B1020] border border-[#E2C1C5]">
                            Director Only
                          </span>
                        </div>
                        <p className="text-[11px] text-[#6E6A63]">
                          Immutable audit trail showing who made changes, when, reason, old values, and new values for{' '}
                          {selectedSession}
                          {selectedTerm !== 'All' ? ` — ${selectedTerm}` : ''}.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                          <th className="py-3 px-4">When</th>
                          <th className="py-3 px-4">Action & Student</th>
                          <th className="py-3 px-4">Fee Item & Receipt</th>
                          <th className="py-3 px-4">Old Values</th>
                          <th className="py-3 px-4">New Values</th>
                          <th className="py-3 px-4">Reason</th>
                          <th className="py-3 px-4">Performed By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EFE9DF] text-xs">
                        {scopedAuditLogs.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-[#7F7A72]">
                              No edit, void, or deletion audit entries recorded for the selected period.
                            </td>
                          </tr>
                        ) : (
                          scopedAuditLogs.map((log) => {
                            const actionLabel =
                              log.actionType === 'edit_payment'
                                ? 'Edited Payment'
                                : log.actionType === 'edit_expected_amount'
                                ? 'Edited Expected Fee'
                                : log.actionType === 'edit_due_date'
                                ? 'Edited Due Date'
                                : log.actionType === 'void_payment'
                                ? 'Voided Payment'
                                : 'Deleted Fee Item';

                            const actionBadgeClass =
                              log.actionType === 'void_payment' || log.actionType === 'delete_fee_item'
                                ? 'bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]'
                                : 'bg-[#FBF5E8] text-[#7D5A18] border-[#E3CFA6]';

                            return (
                              <tr key={log.id} className="hover:bg-[#FAF8F4] transition-colors duration-150 align-top">
                                <td className="py-3 px-4 text-[#5E5B56] whitespace-nowrap">
                                  {log.performedAt
                                    ? new Date(log.performedAt).toLocaleString('en-NG', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })
                                    : '—'}
                                </td>
                                <td className="py-3 px-4">
                                  <span
                                    className={`inline-block mb-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${actionBadgeClass}`}
                                  >
                                    {actionLabel}
                                  </span>
                                  <p className="font-semibold text-[#2A2A2E]">{log.studentName}</p>
                                  <span className="text-[11px] text-[#6E6A63]">
                                    {log.admissionNo} • {log.className}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <p className="font-medium text-[#2A2A2E]">
                                    {log.categoryName} ({log.term})
                                  </p>
                                  <span className="text-[11px] font-mono text-[#6B1020] block mt-0.5">
                                    {log.receiptNo}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-[11px] text-[#5E5B56] space-y-0.5 tabular-nums">
                                  {typeof log.oldValues.expectedAmount === 'number' && (
                                    <div>Expected: {formatNaira(log.oldValues.expectedAmount)}</div>
                                  )}
                                  {log.oldValues.dueDate && (
                                    <div>Due Date: {log.oldValues.dueDate}</div>
                                  )}
                                  {typeof log.oldValues.amount === 'number' && (
                                    <div>Amount: {formatNaira(log.oldValues.amount)}</div>
                                  )}
                                  {log.oldValues.paymentDate && (
                                    <div>Date: {log.oldValues.paymentDate}</div>
                                  )}
                                  {log.oldValues.paymentMethod && (
                                    <div>Method: {log.oldValues.paymentMethod}</div>
                                  )}
                                  {typeof log.oldValues.notes === 'string' && log.oldValues.notes && (
                                    <div className="truncate max-w-[160px]" title={log.oldValues.notes}>
                                      Note: {log.oldValues.notes}
                                    </div>
                                  )}
                                  {typeof log.oldValues.paidAmount === 'number' && (
                                    <div>Row Paid: {formatNaira(log.oldValues.paidAmount)}</div>
                                  )}
                                  {typeof log.oldValues.balance === 'number' && (
                                    <div>
                                      Balance: {formatNaira(log.oldValues.balance)} ({log.oldValues.status || '—'})
                                    </div>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-[11px] text-[#2A2A2E] space-y-0.5 tabular-nums font-medium">
                                  {typeof log.newValues.expectedAmount === 'number' && (
                                    <div>Expected: {formatNaira(log.newValues.expectedAmount)}</div>
                                  )}
                                  {log.newValues.dueDate && (
                                    <div>Due Date: {log.newValues.dueDate}</div>
                                  )}
                                  {typeof log.newValues.amount === 'number' && (
                                    <div>
                                      Amount:{' '}
                                      {log.actionType === 'void_payment'
                                        ? '₦0 (Voided)'
                                        : formatNaira(log.newValues.amount)}
                                    </div>
                                  )}
                                  {log.newValues.paymentDate && (
                                    <div>Date: {log.newValues.paymentDate}</div>
                                  )}
                                  {log.newValues.paymentMethod && (
                                    <div>Method: {log.newValues.paymentMethod}</div>
                                  )}
                                  {typeof log.newValues.notes === 'string' && log.newValues.notes && (
                                    <div className="truncate max-w-[160px]" title={log.newValues.notes}>
                                      Note: {log.newValues.notes}
                                    </div>
                                  )}
                                  {typeof log.newValues.paidAmount === 'number' && (
                                    <div>Row Paid: {formatNaira(log.newValues.paidAmount)}</div>
                                  )}
                                  {typeof log.newValues.balance === 'number' && (
                                    <div>
                                      Balance: {formatNaira(log.newValues.balance)} ({log.newValues.status || '—'})
                                    </div>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-[#2A2A2E] max-w-[220px]">
                                  {log.reason}
                                </td>
                                <td className="py-3 px-4 text-[#5E5B56]">{log.performedBy}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Legacy Deleted Entries (if any exist from prior records) */}
                  {scopedDeletionLogs.length > 0 && (
                    <div className="border-t border-[#E6DFD3]">
                      <div className="px-4 py-2.5 bg-[#FAF0F2]/40 border-b border-[#EFE9DF] flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#86222E]">
                          Historical Deleted Entries ({scopedDeletionLogs.length})
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <tbody className="divide-y divide-[#EFE9DF] text-xs">
                            {scopedDeletionLogs.map((log) => (
                              <tr key={log.id} className="hover:bg-[#FAF8F4]">
                                <td className="py-2.5 px-4 text-[#5E5B56] whitespace-nowrap">
                                  {log.deletedAt
                                    ? new Date(log.deletedAt).toLocaleString('en-NG', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })
                                    : '—'}
                                </td>
                                <td className="py-2.5 px-4 font-semibold text-[#2A2A2E]">
                                  {log.studentName} ({log.className})
                                </td>
                                <td className="py-2.5 px-4 text-[#2A2A2E]">
                                  {log.categoryName} ({log.term}) •{' '}
                                  <span className="font-mono text-[#6B1020]">{log.receiptNo}</span>
                                </td>
                                <td className="py-2.5 px-4 font-semibold text-[#86222E] tabular-nums">
                                  {formatNaira(log.amount)}
                                </td>
                                <td className="py-2.5 px-4 text-[#2A2A2E]">{log.reason}</td>
                                <td className="py-2.5 px-4 text-[#5E5B56]">{log.deletedBy}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ==================== TAB 5: CATEGORIES & CLASS FEE SCHEDULES ==================== */}
          {activeTab === 'setup' && isAdmin && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Fee Categories */}
              <div className="lg:col-span-5 bg-white rounded-[10px] border border-[#E6DFD3] p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-[#2A2A2E]">Fee Categories</h2>
                    <p className="text-[11px] text-[#6E6A63]">
                      Tuition, Examination, Development, Uniforms & charges
                    </p>
                  </div>
                  {isLiveFirestore && !categoriesSeeded && (
                    <button
                      type="button"
                      onClick={handleSeedCategories}
                      disabled={isSaving}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] bg-[#FBF5E8] hover:bg-[#F4E9D0] text-[#7D5A18] border border-[#E3CFA6] text-[11px] font-medium transition-colors duration-150"
                    >
                      <Database className="w-3 h-3" />
                      Save Defaults
                    </button>
                  )}
                </div>

                <form onSubmit={handleCreateCategory} className="space-y-2.5 bg-[#FAF8F4] p-3.5 rounded-[10px] border border-[#E6DFD3]">
                  <input
                    type="text"
                    required
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="New category name (e.g. Excursion Levy)"
                    className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] placeholder:text-[#7F7A72] focus:outline-none focus:border-[#6B1020]"
                  />
                  <input
                    type="text"
                    value={newCatDesc}
                    onChange={(e) => setNewCatDesc(e.target.value)}
                    placeholder="Short description (optional)"
                    className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] placeholder:text-[#7F7A72] focus:outline-none focus:border-[#6B1020]"
                  />
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="w-full py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150"
                  >
                    + Add Fee Category
                  </button>
                </form>

                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {categories.map((cat) => (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between p-3 rounded-[10px] border border-[#E6DFD3] bg-white hover:bg-[#FAF8F4] transition-colors duration-150"
                    >
                      <div>
                        <p className="text-xs font-semibold text-[#2A2A2E]">{cat.name}</p>
                        {cat.description && (
                          <p className="text-[11px] text-[#6E6A63]">{cat.description}</p>
                        )}
                      </div>
                      {isDirector && categoriesSeeded && (
                        <button
                          type="button"
                          onClick={() => deleteFeeCategoryFromFirestore(cat.id)}
                          className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#86222E] hover:bg-[#FAF0F2] transition-colors duration-150"
                          title="Delete category"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Class, Term & Session Fee Schedule */}
              <div className="lg:col-span-7 bg-white rounded-[10px] border border-[#E6DFD3] p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-[#2A2A2E]">
                      Set Fees by Class, Term & Session
                    </h2>
                    <p className="text-[11px] text-[#6E6A63]">
                      Session: <strong className="text-[#2A2A2E]">{selectedSession}</strong>
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isSaving || classSchedulesForSelected.length === 0}
                    onClick={() => handleBulkAssignClass(schedClass, schedTerm)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#2A583B] hover:bg-[#20452E] disabled:opacity-50 text-white text-xs font-medium shadow-xs transition-colors duration-150"
                  >
                    <Users className="w-3.5 h-3.5" />
                    Bulk Assign to {schedClass} Students
                  </button>
                </div>

                <form
                  onSubmit={handleSaveScheduleItem}
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-[#FAF8F4] p-4 rounded-[10px] border border-[#E6DFD3] text-xs"
                >
                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">Class</label>
                    <select
                      value={schedClass}
                      onChange={(e) => setSchedClass(e.target.value)}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                    >
                      {groupClassesBySection(getActiveClasses(classesList)).map((g) => (
                        <optgroup key={g.section} label={g.label}>
                          {g.classes.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">Term</label>
                    <select
                      value={schedTerm}
                      onChange={(e) => setSchedTerm(e.target.value as AcademicTerm)}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                    >
                      <option value="First Term">First Term</option>
                      <option value="Second Term">Second Term</option>
                      <option value="Third Term">Third Term</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">Fee Category</label>
                    <select
                      value={schedCategoryId}
                      onChange={(e) => setSchedCategoryId(e.target.value)}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                    >
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">
                      Amount (₦) *
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={schedAmount || ''}
                      onChange={(e) => setSchedAmount(Number(e.target.value))}
                      placeholder="e.g. 250000"
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white font-semibold text-[#2A2A2E] tabular-nums focus:outline-none focus:border-[#6B1020]"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">Due Date</label>
                    <input
                      type="date"
                      required
                      value={schedDueDate}
                      onChange={(e) => setSchedDueDate(e.target.value)}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                    />
                  </div>

                  <div className="flex flex-col justify-end">
                    <label className="inline-flex items-center gap-2 text-xs text-[#5E5B56] mb-2">
                      <input
                        type="checkbox"
                        checked={schedMandatory}
                        onChange={(e) => setSchedMandatory(e.target.checked)}
                        className="accent-[#6B1020]"
                      />
                      Mandatory Charge
                    </label>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="w-full py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium transition-colors duration-150"
                    >
                      Save Class Fee
                    </button>
                  </div>
                </form>

                {/* Schedule Table for Selected Class/Term */}
                <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                      <tr>
                        <th className="py-2.5 px-3">Fee Category</th>
                        <th className="py-2.5 px-3">Amount (₦)</th>
                        <th className="py-2.5 px-3">Due Date</th>
                        <th className="py-2.5 px-3">Type</th>
                        <th className="py-2.5 px-3 text-right">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EFE9DF]">
                      {classSchedulesForSelected.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-[#7F7A72]">
                            No fee schedule items configured for {schedClass} in {schedTerm} (
                            {selectedSession}).
                          </td>
                        </tr>
                      ) : (
                        classSchedulesForSelected.map((item) => (
                          <tr key={item.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                            <td className="py-2.5 px-3 font-semibold text-[#2A2A2E]">
                              {item.categoryName}
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-[#6B1020] tabular-nums">
                              {formatNaira(item.amount)}
                            </td>
                            <td className="py-2.5 px-3 text-[#5E5B56]">{item.dueDate}</td>
                            <td className="py-2.5 px-3">
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded-[6px] bg-[#FAF8F4] border border-[#E6DFD3] text-[#5E5B56]">
                                {item.isMandatory ? 'Mandatory' : 'Optional'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => deleteFeeScheduleItemFromFirestore(item.id)}
                                className="p-1 rounded-[8px] text-[#7F7A72] hover:text-[#86222E] hover:bg-[#FAF0F2] transition-colors duration-150"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {classSchedulesForSelected.length > 0 && (
                  <div className="flex justify-between items-center bg-[#FAF0F2] px-4 py-2.5 rounded-[10px] border border-[#DFC7CA] text-xs">
                    <span className="font-medium text-[#6B1020]">
                      Total Termly Schedule for {schedClass} ({schedTerm}):
                    </span>
                    <strong className="text-sm font-bold text-[#6B1020] tabular-nums">
                      {formatNaira(
                        classSchedulesForSelected.reduce((sum, i) => sum + i.amount, 0)
                      )}
                    </strong>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ==================== MODAL: RECORD MANUAL PAYMENT (DIRECTOR & BURSAR ONLY) ==================== */}
      {paymentModalOpen && canRecordPayments && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSaving) setPaymentModalOpen(false);
          }}
        >
          <div className="bg-white rounded-[10px] max-w-lg w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#EFE9DF]">
              <div>
                <h3 className="font-semibold text-base text-[#2A2A2E]">
                  Record Payment (₦)
                </h3>
                <p className="text-[11px] text-[#6E6A63]">
                  Record a full payment or installment. Generates a unique receipt automatically.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                disabled={isSaving}
                onClick={() => setPaymentModalOpen(false)}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] disabled:opacity-50 transition-colors duration-150"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form noValidate onSubmit={handleRecordPayment} className="py-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-[#5E5B56] mb-1">
                  Assigned Student Fee Obligation *
                </label>
                <select
                  value={targetFeeId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setTargetFeeId(id);
                    const found = reconciledFees.find((f) => f.id === id);
                    setPayAmount(found?.balance || 0);
                    setPayModalError('');
                  }}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] font-medium focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                >
                  {unpaidOrPartialFees.length === 0 ? (
                    <option value="">No pending or partial fees available</option>
                  ) : (
                    unpaidOrPartialFees.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.studentName} ({f.className}) — {f.categoryName} ({f.term}) | Bal:{' '}
                        {formatNaira(f.balance)}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {selectedTargetFee && (
                <div className="bg-[#FAF8F4] p-3.5 rounded-[10px] border border-[#E6DFD3] grid grid-cols-3 gap-2 text-[11px] text-[#5E5B56] tabular-nums">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                      Expected
                    </span>
                    <strong className="text-sm font-bold text-[#2A2A2E]">
                      {formatNaira(selectedTargetFee.amountDue)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#2A583B] block">
                      Already Paid
                    </span>
                    <strong className="text-sm font-bold text-[#2A583B]">
                      {formatNaira(selectedTargetFee.amountPaid)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7D5A18] block">
                      Current Balance
                    </span>
                    <strong className="text-sm font-bold text-[#7D5A18]">
                      {formatNaira(selectedTargetFee.balance)}
                    </strong>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">
                    Amount Paid (₦) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    step="1"
                    value={payAmount || ''}
                    onChange={(e) => {
                      setPayAmount(Number(e.target.value));
                      if (payModalError) setPayModalError('');
                    }}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-semibold text-[#2A2A2E] tabular-nums focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                  {selectedTargetFee && selectedTargetFee.balance > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setPayAmount(selectedTargetFee.balance);
                          if (payModalError) setPayModalError('');
                        }}
                        className="text-[10px] font-medium px-2.5 py-0.5 rounded-[6px] bg-[#FAF0F2] hover:bg-[#F3E1E5] border border-[#DFC7CA] text-[#6B1020] transition-colors duration-150"
                      >
                        Pay full balance ({formatNaira(selectedTargetFee.balance)})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPayAmount(Math.round(selectedTargetFee.balance / 2));
                          if (payModalError) setPayModalError('');
                        }}
                        className="text-[10px] font-medium px-2 py-0.5 rounded-[6px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#5E5B56] transition-colors duration-150"
                      >
                        50% Partial
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">
                    Payment Date *
                  </label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={(e) => {
                      setPayDate(e.target.value);
                      if (payModalError) setPayModalError('');
                    }}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
              </div>

              {selectedTargetFee && payAmount > selectedTargetFee.balance && (
                <div className="flex items-center gap-2 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] px-3 py-2 rounded-[8px] font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>
                    Amount is more than the outstanding balance of {formatNaira(selectedTargetFee.balance)}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">
                    Payment Method *
                  </label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as ManualPaymentMethod)}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  >
                    {MANUAL_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">
                    Reference / Teller Number (Optional)
                  </label>
                  <input
                    type="text"
                    value={payRef}
                    onChange={(e) => setPayRef(e.target.value)}
                    placeholder={
                      payMethod === 'Cash'
                        ? 'Cash desk receipt or leave blank'
                        : 'e.g. GTB-TRF-993812 or POS RRN'
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] font-mono focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-[#5E5B56] mb-1">
                  Note (Optional)
                </label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="e.g. Paid by mother, first installment"
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                />
              </div>

              {payModalError && (
                <div className="flex items-center gap-2 bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] px-3 py-2.5 rounded-[8px] font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{payModalError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-[#EFE9DF]">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setPaymentModalOpen(false)}
                  className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !selectedTargetFee}
                  className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                >
                  {isSaving ? 'Recording...' : 'Record Payment & Generate Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: ASSIGN SINGLE FEE TO STUDENT ==================== */}
      {assignModalOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs">
          <div className="bg-white rounded-[10px] max-w-md w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3]">
            <div className="flex items-center justify-between pb-3 border-b border-[#EFE9DF]">
              <h3 className="font-semibold text-base text-[#2A2A2E]">
                Assign Applicable Fee to Student
              </h3>
              <button
                type="button"
                onClick={() => setAssignModalOpen(false)}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors duration-150"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAssignSingleFee} className="py-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-[#5E5B56] mb-1">Student *</label>
                <select
                  required
                  value={assignStudentId}
                  onChange={(e) => setAssignStudentId(e.target.value)}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                >
                  {activeStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.admissionNo}) — {s.className}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">Term *</label>
                  <select
                    value={assignTerm}
                    onChange={(e) => setAssignTerm(e.target.value as AcademicTerm)}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  >
                    <option value="First Term">First Term</option>
                    <option value="Second Term">Second Term</option>
                    <option value="Third Term">Third Term</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">Fee Category *</label>
                  <select
                    value={assignCategoryId}
                    onChange={(e) => setAssignCategoryId(e.target.value)}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">
                    Amount Due (₦) *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={assignAmount || ''}
                    onChange={(e) => setAssignAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] font-semibold tabular-nums focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">
                    Due Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={assignDueDate}
                    onChange={(e) => setAssignDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#EFE9DF]">
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                >
                  {isSaving ? 'Assigning...' : 'Assign Fee (Pending)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: OFFICIAL PAYMENT RECEIPT ==================== */}
      {selectedReceipt && (
        <ReceiptModal
          payment={selectedReceipt}
          feeItem={reconciledFees.find((f) => f.id === selectedReceipt.studentFeeId)}
          paymentsForFee={payments.filter(
            (p) => p.studentFeeId === selectedReceipt.studentFeeId
          )}
          schoolSettings={schoolSettings}
          onClose={() => setSelectedReceipt(null)}
        />
      )}

      {/* ==================== MODAL: EDIT EXPECTED AMOUNT & PAYMENTS (DIRECTOR ONLY) ==================== */}
      {editTargetFee && isDirector && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEditModal();
          }}
        >
          <div className="bg-white rounded-[10px] max-w-2xl w-full shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] flex flex-col max-h-[92vh]">
            {/* Sticky Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#EFE9DF] shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6] flex items-center justify-center text-[#7D5A18]">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-[#2A2A2E]">
                    Edit Fee & Recorded Payments
                  </h3>
                  <p className="text-[11px] text-[#6E6A63]">
                    Adjust expected fee amount or edit recorded payment details. Receipt numbers stay unchanged.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                disabled={isSavingExpected || isSavingEditedPayment}
                onClick={closeEditModal}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] disabled:opacity-50 transition-colors duration-150"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="px-5 py-4 space-y-5 overflow-y-auto text-xs">
              {/* Fee Item Summary */}
              <div className="bg-[#FAF8F4] rounded-[10px] border border-[#E6DFD3] p-3.5 space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                      Student
                    </span>
                    <span className="font-semibold text-[#2A2A2E]">{editTargetFee.studentName}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                      Admission No
                    </span>
                    <span className="font-mono font-semibold text-[#2A2A2E]">
                      {editTargetFee.admissionNo}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                      Category
                    </span>
                    <span className="font-medium text-[#2A2A2E]">{editTargetFee.categoryName}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                      Term
                    </span>
                    <span className="font-medium text-[#2A2A2E]">
                      {editTargetFee.term} ({editTargetFee.session})
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-2 border-t border-[#E6DFD3] tabular-nums">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                      Expected
                    </span>
                    <span className="font-bold text-[#2A2A2E]">
                      {formatNaira(editTargetFee.amountDue)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#2A583B] block">
                      Paid
                    </span>
                    <span className="font-bold text-[#2A583B]">
                      {formatNaira(editTargetFee.amountPaid)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7D5A18] block">
                      Balance
                    </span>
                    <span className="font-bold text-[#7D5A18]">
                      {formatNaira(editTargetFee.balance)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                      Status
                    </span>
                    <div className="mt-0.5">{renderStatusPill(editTargetFee.status)}</div>
                  </div>
                </div>
              </div>

              {editModalFeedback && (
                <div className="flex items-center gap-2 bg-[#EEF4F0] border border-[#C5D6CB] text-[#2A583B] px-3.5 py-2.5 rounded-[8px] font-medium">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{editModalFeedback}</span>
                </div>
              )}

              {/* Section 1: Edit Expected Amount */}
              <div className="rounded-[10px] border border-[#E6DFD3] p-4 space-y-3 bg-white">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[#5E5B56]">
                    Expected Fee Amount
                  </h4>
                  <p className="text-[11px] text-[#6E6A63] mt-0.5">
                    Update the billed expected amount for this student&apos;s fee item.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">
                      Expected Amount (₦) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      step="1"
                      value={editExpectedAmountInput}
                      disabled={isSavingExpected || isSavingEditedPayment}
                      onChange={(e) => {
                        setEditExpectedAmountInput(e.target.value);
                        if (editExpectedError) setEditExpectedError('');
                      }}
                      className="w-full px-3 py-2 rounded-[8px] border border-[#DDD5C7] bg-[#FAF8F4] text-[#2A2A2E] font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">
                      Reason for editing expected amount *
                    </label>
                    <input
                      type="text"
                      maxLength={300}
                      value={editExpectedReason}
                      disabled={isSavingExpected || isSavingEditedPayment}
                      onChange={(e) => {
                        setEditExpectedReason(e.target.value);
                        if (editExpectedError) setEditExpectedError('');
                      }}
                      placeholder="e.g., Scholarship discount applied"
                      className="w-full px-3 py-2 rounded-[8px] border border-[#DDD5C7] bg-[#FAF8F4] text-[#2A2A2E] placeholder:text-[#7F7A72] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020]"
                    />
                  </div>
                </div>

                {Number(editExpectedAmountInput) > 0 &&
                  activePaidForEditFee > Math.round(Number(editExpectedAmountInput)) && (
                    <div className="flex items-start gap-2 bg-[#FBF5E8] border border-[#E3CFA6] text-[#7D5A18] px-3 py-2 rounded-[8px]">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        Warning: Total active payments ({formatNaira(activePaidForEditFee)}) exceed this
                        expected amount ({formatNaira(Math.round(Number(editExpectedAmountInput)))}).
                      </span>
                    </div>
                  )}

                {editExpectedError && (
                  <div className="flex items-center gap-2 bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] px-3 py-2 rounded-[8px] font-medium">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{editExpectedError}</span>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={isSavingExpected || isSavingEditedPayment || isSavingDueDate}
                    onClick={handleSaveExpectedAmountEdit}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {isSavingExpected ? 'Saving...' : 'Save Expected Amount'}
                  </button>
                </div>
              </div>

              {/* Section 1b: Optional Installment Due Date (Director Only) */}
              <div className="rounded-[10px] border border-[#E6DFD3] p-4 space-y-3 bg-white">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#5E5B56] flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-[#6B1020]" />
                      Installment Due Date (Optional)
                    </h4>
                    <p className="text-[11px] text-[#6E6A63] mt-0.5">
                      Set or clear a due date. Items with an outstanding balance past their due date display an Overdue tag.
                    </p>
                  </div>
                  {editDueDateInput && (
                    <button
                      type="button"
                      disabled={isSavingDueDate}
                      onClick={() => {
                        setEditDueDateInput('');
                        if (editDueDateError) setEditDueDateError('');
                      }}
                      className="text-[11px] font-medium text-[#6B1020] hover:underline shrink-0"
                    >
                      Clear date
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">
                      Due Date (Optional)
                    </label>
                    <input
                      type="date"
                      value={editDueDateInput}
                      disabled={isSavingExpected || isSavingEditedPayment || isSavingDueDate}
                      onChange={(e) => {
                        setEditDueDateInput(e.target.value);
                        if (editDueDateError) setEditDueDateError('');
                      }}
                      className="w-full px-3 py-2 rounded-[8px] border border-[#DDD5C7] bg-[#FAF8F4] text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">
                      Reason for updating due date *
                    </label>
                    <input
                      type="text"
                      maxLength={300}
                      value={editDueDateReason}
                      disabled={isSavingExpected || isSavingEditedPayment || isSavingDueDate}
                      onChange={(e) => {
                        setEditDueDateReason(e.target.value);
                        if (editDueDateError) setEditDueDateError('');
                      }}
                      placeholder="e.g., Approved installment extension"
                      className="w-full px-3 py-2 rounded-[8px] border border-[#DDD5C7] bg-[#FAF8F4] text-[#2A2A2E] placeholder:text-[#7F7A72] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020]"
                    />
                  </div>
                </div>

                {editDueDateError && (
                  <div className="flex items-center gap-2 bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] px-3 py-2 rounded-[8px] font-medium">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{editDueDateError}</span>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={isSavingExpected || isSavingEditedPayment || isSavingDueDate}
                    onClick={handleSaveDueDateEdit}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#2A2A2E] hover:bg-[#1E1E22] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    {isSavingDueDate ? 'Saving...' : 'Save Due Date'}
                  </button>
                </div>
              </div>

              {/* Section 2: Recorded Payments */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[#5E5B56]">
                    Recorded Payments ({editTargetPayments.length})
                  </h4>
                </div>

                {editTargetPayments.length === 0 ? (
                  <div className="p-3.5 rounded-[8px] border border-[#E6DFD3] bg-[#FAF8F4] text-[#6E6A63]">
                    No payments have been recorded for this fee item yet.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {editTargetPayments.map((p) => {
                      const isEditingThis = editingPaymentId === p.id;
                      const otherActivePaid = editTargetPayments
                        .filter((other) => other.id !== p.id && !other.isVoided && other.amount > 0)
                        .reduce((sum, other) => sum + other.amount, 0);
                      const projectedTotal =
                        isEditingThis && Number(editPayAmountInput) > 0
                          ? otherActivePaid + Math.round(Number(editPayAmountInput))
                          : activePaidForEditFee;

                      return (
                        <div
                          key={p.id}
                          className={`rounded-[10px] border p-3 transition-colors duration-150 ${
                            p.isVoided
                              ? 'border-[#FECACA] bg-[#FEF2F2]/40'
                              : isEditingThis
                              ? 'border-[#B8913A] bg-[#FBF5E8]/40'
                              : 'border-[#E6DFD3] bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`font-mono font-semibold ${
                                    p.isVoided ? 'line-through text-[#7F7A72]' : 'text-[#6B1020]'
                                  }`}
                                >
                                  {p.receiptNo}
                                </span>
                                <span
                                  className={`font-bold tabular-nums ${
                                    p.isVoided ? 'line-through text-[#B91C1C]' : 'text-[#2A583B]'
                                  }`}
                                >
                                  {formatNaira(p.amount)}
                                </span>
                                {p.isEdited && !p.isVoided && (
                                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
                                    Edited
                                  </span>
                                )}
                                {p.isVoided && (
                                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]">
                                    Voided
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-[#5E5B56] mt-0.5">
                                {p.paymentDate} • {p.paymentMethod}
                                {p.notes ? ` • ${p.notes}` : ''}
                              </p>
                              {p.isVoided && p.voidReason && (
                                <p className="text-[10px] text-[#991B1B] mt-0.5">
                                  Void reason: {p.voidReason}
                                </p>
                              )}
                            </div>

                            {p.isVoided ? (
                              <span className="text-[11px] font-medium text-[#991B1B] shrink-0">
                                Voided
                              </span>
                            ) : !isEditingThis ? (
                              <button
                                type="button"
                                disabled={isSavingExpected || isSavingEditedPayment}
                                onClick={() => startEditingPayment(p)}
                                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] bg-[#FBF5E8] hover:bg-[#F4E9D0] text-[#7D5A18] border border-[#E3CFA6] font-medium disabled:opacity-50 transition-colors duration-150"
                              >
                                <Pencil className="w-3 h-3" />
                                Edit
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isSavingEditedPayment}
                                onClick={() => {
                                  setEditingPaymentId(null);
                                  setEditPayError('');
                                }}
                                className="shrink-0 px-2.5 py-1 rounded-[8px] bg-white border border-[#DDD5C7] text-[#5E5B56] font-medium"
                              >
                                Cancel
                              </button>
                            )}
                          </div>

                          {/* Inline Payment Edit Form */}
                          {isEditingThis && !p.isVoided && (
                            <div className="mt-3 pt-3 border-t border-[#E3CFA6] space-y-3">
                              <div className="flex items-center justify-between bg-white px-3 py-1.5 rounded-[8px] border border-[#E6DFD3]">
                                <span className="text-[11px] text-[#6E6A63]">Receipt Number</span>
                                <span className="font-mono font-semibold text-[#6B1020]">
                                  {p.receiptNo} (Locked)
                                </span>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                <div>
                                  <label className="block font-semibold text-[#2A2A2E] mb-1">
                                    Amount (₦) *
                                  </label>
                                  <input
                                    type="number"
                                    min={1}
                                    step="1"
                                    value={editPayAmountInput}
                                    disabled={isSavingEditedPayment}
                                    onChange={(e) => {
                                      setEditPayAmountInput(e.target.value);
                                      if (editPayError) setEditPayError('');
                                    }}
                                    className="w-full px-3 py-2 rounded-[8px] border border-[#DDD5C7] bg-white text-[#2A2A2E] font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020]"
                                  />
                                </div>
                                <div>
                                  <label className="block font-semibold text-[#2A2A2E] mb-1">
                                    Payment Date *
                                  </label>
                                  <input
                                    type="date"
                                    value={editPayDate}
                                    disabled={isSavingEditedPayment}
                                    onChange={(e) => {
                                      setEditPayDate(e.target.value);
                                      if (editPayError) setEditPayError('');
                                    }}
                                    className="w-full px-3 py-2 rounded-[8px] border border-[#DDD5C7] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020]"
                                  />
                                </div>
                                <div>
                                  <label className="block font-semibold text-[#2A2A2E] mb-1">
                                    Payment Method *
                                  </label>
                                  <select
                                    value={editPayMethod}
                                    disabled={isSavingEditedPayment}
                                    onChange={(e) =>
                                      setEditPayMethod(e.target.value as ManualPaymentMethod)
                                    }
                                    className="w-full px-3 py-2 rounded-[8px] border border-[#DDD5C7] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020]"
                                  >
                                    {MANUAL_METHODS.map((m) => (
                                      <option key={m} value={m}>
                                        {m}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              <div>
                                <label className="block font-semibold text-[#2A2A2E] mb-1">
                                  Note (Optional)
                                </label>
                                <input
                                  type="text"
                                  maxLength={300}
                                  value={editPayNotes}
                                  disabled={isSavingEditedPayment}
                                  onChange={(e) => setEditPayNotes(e.target.value)}
                                  placeholder="Optional payment remark or teller note"
                                  className="w-full px-3 py-2 rounded-[8px] border border-[#DDD5C7] bg-white text-[#2A2A2E] placeholder:text-[#7F7A72] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020]"
                                />
                              </div>

                              <div>
                                <label className="block font-semibold text-[#2A2A2E] mb-1">
                                  Reason for editing this payment *
                                </label>
                                <textarea
                                  rows={2}
                                  maxLength={300}
                                  value={editPayReason}
                                  disabled={isSavingEditedPayment}
                                  onChange={(e) => {
                                    setEditPayReason(e.target.value);
                                    if (editPayError) setEditPayError('');
                                  }}
                                  placeholder="Explain why this payment amount, date, method, or note is being edited..."
                                  className="w-full px-3 py-2 rounded-[8px] border border-[#DDD5C7] bg-white text-[#2A2A2E] placeholder:text-[#7F7A72] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020]"
                                />
                              </div>

                              {projectedTotal > editTargetFee.amountDue && (
                                <div className="flex items-start gap-2 bg-[#FBF5E8] border border-[#E3CFA6] text-[#7D5A18] px-3 py-2 rounded-[8px]">
                                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                  <span>
                                    Warning: Total active payments ({formatNaira(projectedTotal)}) will
                                    exceed the expected fee amount ({formatNaira(editTargetFee.amountDue)}).
                                  </span>
                                </div>
                              )}

                              {editPayError && (
                                <div className="flex items-center gap-2 bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] px-3 py-2 rounded-[8px] font-medium">
                                  <AlertCircle className="w-4 h-4 shrink-0" />
                                  <span>{editPayError}</span>
                                </div>
                              )}

                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  disabled={isSavingEditedPayment}
                                  onClick={() => {
                                    setEditingPaymentId(null);
                                    setEditPayError('');
                                  }}
                                  className="px-3.5 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  disabled={isSavingEditedPayment}
                                  onClick={handleSavePaymentEdit}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {isSavingEditedPayment ? 'Saving...' : 'Save Payment Changes'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Sticky Footer */}
            <div className="flex justify-end px-5 py-3.5 border-t border-[#EFE9DF] bg-[#FAF8F4] rounded-b-[10px] shrink-0 text-xs">
              <button
                type="button"
                disabled={isSavingExpected || isSavingEditedPayment || isSavingDueDate}
                onClick={closeEditModal}
                className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium disabled:opacity-50 transition-colors duration-150"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: VOID PAYMENT OR DELETE FEE ITEM (DIRECTOR ONLY) ==================== */}
      {deleteTargetFee && isDirector && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeVoidDeleteModal();
          }}
        >
          <div className="bg-white rounded-[10px] max-w-xl w-full shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] flex flex-col max-h-[92vh]">
            {/* Sticky Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#EFE9DF] shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-[8px] bg-[#FEF2F2] border border-[#FECACA] flex items-center justify-center text-[#B91C1C]">
                  <Ban className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-[#2A2A2E]">
                    Void Payment or Delete Fee Item
                  </h3>
                  <p className="text-[11px] text-[#6E6A63]">
                    Void a wrong payment (kept in ledger) or delete a fee item with no active payments.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                disabled={isDeleting}
                onClick={closeVoidDeleteModal}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] disabled:opacity-50 transition-colors duration-150"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="px-5 py-4 space-y-4 overflow-y-auto text-xs">
              {/* Fee Item Details Card */}
              <div className="bg-[#FAF8F4] rounded-[10px] border border-[#E6DFD3] p-3.5 space-y-2.5">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                      Student Name
                    </span>
                    <span className="font-semibold text-[#2A2A2E]">
                      {deleteTargetFee.studentName}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                      Admission Number
                    </span>
                    <span className="font-mono font-semibold text-[#2A2A2E]">
                      {deleteTargetFee.admissionNo}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                      Fee Category
                    </span>
                    <span className="font-medium text-[#2A2A2E]">
                      {deleteTargetFee.categoryName}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                      Term
                    </span>
                    <span className="font-medium text-[#2A2A2E]">
                      {deleteTargetFee.term} ({deleteTargetFee.session})
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#E6DFD3] tabular-nums">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6A63] block">
                      Expected Amount
                    </span>
                    <span className="font-bold text-[#2A2A2E]">
                      {formatNaira(deleteTargetFee.amountDue)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#2A583B] block">
                      Paid Amount
                    </span>
                    <span className="font-bold text-[#2A583B]">
                      {formatNaira(deleteTargetFee.amountPaid)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7D5A18] block">
                      Balance
                    </span>
                    <span className="font-bold text-[#7D5A18]">
                      {formatNaira(deleteTargetFee.balance)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Choice Selector: Void a payment vs Delete this fee item */}
              <div>
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-2">
                  Select Action
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => {
                      setDeleteMode('void_payment');
                      setDeleteModalError('');
                      if (!selectedPaymentToVoidId && activeDeleteTargetPayments.length > 0) {
                        setSelectedPaymentToVoidId(activeDeleteTargetPayments[0].id);
                      }
                    }}
                    className={`text-left p-3 rounded-[10px] border transition-colors duration-150 ${
                      deleteMode === 'void_payment'
                        ? 'border-[#B91C1C] bg-[#FEF2F2]'
                        : 'border-[#DDD5C7] bg-white hover:bg-[#FAF8F4]'
                    }`}
                  >
                    <p className="font-semibold text-[#2A2A2E]">Void a payment</p>
                    <p className="text-[11px] text-[#6E6A63] mt-0.5">
                      Keeps receipt in ledger as Voided ({activeDeleteTargetPayments.length} active)
                    </p>
                  </button>

                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => {
                      setDeleteMode('fee_item');
                      setDeleteModalError('');
                    }}
                    className={`text-left p-3 rounded-[10px] border transition-colors duration-150 ${
                      deleteMode === 'fee_item'
                        ? 'border-[#B91C1C] bg-[#FEF2F2]'
                        : 'border-[#DDD5C7] bg-white hover:bg-[#FAF8F4]'
                    }`}
                  >
                    <p className="font-semibold text-[#2A2A2E]">Delete this fee item</p>
                    <p className="text-[11px] text-[#6E6A63] mt-0.5">
                      {activeDeleteTargetPayments.length > 0
                        ? 'Requires voiding active payments first'
                        : 'Removes this assigned fee item permanently'}
                    </p>
                  </button>
                </div>
              </div>

              {/* Active Payments List when "Void a payment" is selected */}
              {deleteMode === 'void_payment' ? (
                <div className="space-y-2">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                    Recorded Payments for this Fee Item
                  </span>
                  {activeDeleteTargetPayments.length === 0 ? (
                    <div className="p-3 rounded-[8px] border border-[#E6DFD3] bg-[#FAF8F4] text-[#6E6A63]">
                      No active payments remain for this fee item. You can switch to{' '}
                      <strong className="text-[#2A2A2E]">Delete this fee item</strong> to remove the assigned fee.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-0.5">
                      {activeDeleteTargetPayments.map((p) => {
                        const isSelected = selectedPaymentToVoidId === p.id;
                        return (
                          <div
                            key={p.id}
                            onClick={() => setSelectedPaymentToVoidId(p.id)}
                            className={`flex items-center justify-between gap-3 p-2.5 rounded-[8px] border cursor-pointer transition-colors duration-150 ${
                              isSelected
                                ? 'border-[#B91C1C] bg-[#FEF2F2]/70'
                                : 'border-[#E6DFD3] bg-white hover:bg-[#FAF8F4]'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono font-semibold text-[#6B1020]">
                                  {p.receiptNo}
                                </span>
                                <span className="font-bold text-[#2A583B] tabular-nums">
                                  {formatNaira(p.amount)}
                                </span>
                                {p.isEdited && (
                                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
                                    Edited
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-[#5E5B56] mt-0.5">
                                {p.paymentDate} • {p.paymentMethod}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={(e) => {
                                e.stopPropagation();
                                executeVoidOrDelete('void_payment', p);
                              }}
                              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] bg-[#B91C1C] hover:bg-[#991B1B] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                            >
                              <Ban className="w-3 h-3" />
                              Void
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : activeDeleteTargetPayments.length > 0 ? (
                <div className="p-3 rounded-[8px] border border-[#E3CFA6] bg-[#FBF5E8] text-[#7D5A18]">
                  <strong>Cannot delete yet:</strong> This fee item currently has{' '}
                  {activeDeleteTargetPayments.length} active payment
                  {activeDeleteTargetPayments.length === 1 ? '' : 's'} totaling{' '}
                  {formatNaira(deleteTargetFee.amountPaid)}. Switch to{' '}
                  <strong>Void a payment</strong> and void all active payments first.
                </div>
              ) : (
                <div className="p-3 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2]/60 text-[#7F1D1D]">
                  Deleting this fee item will permanently remove{' '}
                  <strong>{deleteTargetFee.categoryName}</strong> (
                  {formatNaira(deleteTargetFee.amountDue)}) for{' '}
                  <strong>{deleteTargetFee.studentName}</strong>.
                </div>
              )}

              {/* Required Reason */}
              <div>
                <label className="block font-semibold text-[#2A2A2E] mb-1">
                  {deleteMode === 'void_payment' ? 'Reason for voiding *' : 'Reason for deletion *'}
                </label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={deleteReason}
                  disabled={isDeleting}
                  onChange={(e) => {
                    setDeleteReason(e.target.value);
                    if (deleteReasonError) setDeleteReasonError('');
                  }}
                  placeholder={
                    deleteMode === 'void_payment'
                      ? 'Enter why this payment is being voided...'
                      : 'Enter why this fee item is being deleted...'
                  }
                  className={`w-full px-3 py-2 rounded-[8px] border bg-[#FAF8F4] text-[#2A2A2E] placeholder:text-[#7F7A72] focus:outline-none focus:ring-2 ${
                    deleteReasonError
                      ? 'border-[#B91C1C] focus:ring-[#B91C1C]/20'
                      : 'border-[#DDD5C7] focus:ring-[#6B1020]/20 focus:border-[#6B1020]'
                  }`}
                />
                {deleteReasonError && (
                  <p className="text-[11px] font-medium text-[#B91C1C] mt-1">
                    {deleteReasonError}
                  </p>
                )}
              </div>

              {/* Permanent Warning */}
              <div className="flex items-start gap-2 bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] px-3.5 py-2.5 rounded-[8px]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="font-medium">This cannot be undone.</span>
              </div>

              {deleteModalError && (
                <div className="flex items-center gap-2 bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] px-3.5 py-2.5 rounded-[8px] font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{deleteModalError}</span>
                </div>
              )}
            </div>

            {/* Sticky Footer */}
            <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[#EFE9DF] bg-[#FAF8F4] rounded-b-[10px] shrink-0 text-xs">
              <button
                type="button"
                disabled={isDeleting}
                onClick={closeVoidDeleteModal}
                className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium disabled:opacity-50 transition-colors duration-150"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  isDeleting ||
                  (deleteMode === 'void_payment'
                    ? activeDeleteTargetPayments.length === 0 || !selectedPaymentToVoidId
                    : activeDeleteTargetPayments.length > 0)
                }
                onClick={() => executeVoidOrDelete()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#B91C1C] hover:bg-[#991B1B] text-white font-medium disabled:opacity-50 transition-colors duration-150"
              >
                {deleteMode === 'void_payment' ? (
                  <>
                    <Ban className="w-3.5 h-3.5" />
                    {isDeleting ? 'Voiding...' : 'Void Payment'}
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    {isDeleting ? 'Deleting...' : 'Delete Fee Item'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
