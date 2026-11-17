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
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  AcademicSession,
  AcademicTerm,
  FeeCategory,
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
  computeStudentStatement,
  deleteFeeCategoryFromFirestore,
  deleteFeeScheduleItemFromFirestore,
  deleteUnpaidStudentFeeFromFirestore,
  downloadClassFeeSummaryPDF,
  downloadStudentStatementPDF,
  exportClassSummaryCSV,
  exportPaymentsLedgerCSV,
  formatNaira,
  recordManualPaymentInFirestore,
  reconcileStudentFeesWithPayments,
  saveFeeCategoryToFirestore,
  saveFeeScheduleItemToFirestore,
  seedDefaultFeeCategoriesToFirestore,
  subscribeFeeCategories,
  subscribeFeePayments,
  subscribeFeeSchedules,
  subscribeStudentFees,
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
  const isAdmin = role === 'director' || role === 'principal';
  const isDirector = role === 'director';
  const isParent = role === 'parent';

  const [activeTab, setActiveTab] = useState<FeesTab>(isParent ? 'statements' : 'billing');

  useEffect(() => {
    if (isParent && activeTab !== 'statements') {
      setActiveTab('statements');
    }
  }, [isParent, activeTab]);

  // Firestore Collections
  const [sessions, setSessions] = useState<AcademicSession[]>([DEFAULT_ACADEMIC_SESSION]);
  const [classesList, setClassesList] = useState<SchoolClass[]>(SAMPLE_CLASSES);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [categories, setCategories] = useState<FeeCategory[]>(DEFAULT_FEE_CATEGORIES);
  const [categoriesSeeded, setCategoriesSeeded] = useState<boolean>(false);
  const [schedules, setSchedules] = useState<FeeScheduleItem[]>([]);
  const [studentFeesRaw, setStudentFeesRaw] = useState<StudentFee[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(isLiveFirestore);
  const [dataError, setDataError] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Subscriptions
  useEffect(() => {
    if (!firebaseUser) {
      setStudentsList([]);
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

    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
      u7();
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

  // ==================== MODALS STATE ====================
  const [selectedReceipt, setSelectedReceipt] = useState<FeePayment | null>(null);

  // Record Manual Payment Modal
  const [paymentModalOpen, setPaymentModalOpen] = useState<boolean>(false);
  const [targetFeeId, setTargetFeeId] = useState<string>('');
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payDate, setPayDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [payMethod, setPayMethod] = useState<ManualPaymentMethod>('Bank Transfer');
  const [payRef, setPayRef] = useState<string>('');
  const [payNotes, setPayNotes] = useState<string>('');

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
    if (!isAdmin) return;
    const chosen = fee || unpaidOrPartialFees[0];
    setTargetFeeId(chosen?.id || '');
    setPayAmount(chosen?.balance || 0);
    setPayDate(new Date().toISOString().split('T')[0]);
    setPayMethod('Bank Transfer');
    setPayRef('');
    setPayNotes('');
    setPaymentModalOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !isAdmin) {
      setDataError('Only an authenticated Director or Principal can record payments.');
      return;
    }
    if (!selectedTargetFee) {
      setDataError('Please select an assigned student fee item with an outstanding balance.');
      return;
    }

    setIsSaving(true);
    setDataError('');
    try {
      const stu = studentsList.find((s) => s.id === selectedTargetFee.studentId);
      const stuFees = reconciledFees.filter((f) => f.studentId === selectedTargetFee.studentId);

      const newPayment = await recordManualPaymentInFirestore({
        studentFee: selectedTargetFee,
        student: stu,
        allStudentFeesForStudent: stuFees,
        existingPayments: payments,
        amount: payAmount,
        paymentDate: payDate,
        paymentMethod: payMethod,
        transactionRef: payRef,
        notes: payNotes,
        recordedBy: currentUser?.displayName || firebaseUser.email || 'School Bursar',
        recordedByUid: firebaseUser.uid,
      });

      setPaymentModalOpen(false);
      setSuccessMsg(
        `Payment of ${formatNaira(newPayment.amount)} recorded for ${newPayment.studentName}. Receipt: ${newPayment.receiptNo}`
      );
      setSelectedReceipt(newPayment);
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to record payment.'));
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
  const [assignDueDate, setAssignDueDate] = useState<string>(
    activeTermObj?.startDate || new Date().toISOString().split('T')[0]
  );

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
    setAssignDueDate(schedMatch?.dueDate || new Date().toISOString().split('T')[0]);
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

  const renderStatusPill = (status: string) => {
    switch (status) {
      case 'Paid':
        return (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB]">
            Paid
          </span>
        );
      case 'Partial':
        return (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
            Partial
          </span>
        );
      default:
        return (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[#FAF0F2] text-[#86222E] border border-[#E2C1C5]">
            Pending
          </span>
        );
    }
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
            Fee categories, class/term billing, manual bursary payment recording, unique receipts, and balance reconciliation.
          </p>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openAssignModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] border border-[#DDD5C7] bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] text-xs font-medium transition-colors duration-150"
            >
              <Plus className="w-3.5 h-3.5 text-[#6B1020]" />
              Assign Fee to Student
            </button>
            <button
              type="button"
              onClick={() => openPaymentModal()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium shadow-xs transition-colors duration-150"
            >
              <CreditCard className="w-3.5 h-3.5 text-[#E3CFA6]" />
              Record Payment (₦)
            </button>
          </div>
        )}
      </div>

      {/* Explicit Manual Recording Notice */}
      <div className="flex items-start gap-2.5 bg-[#FAF0F2] border border-[#DFC7CA] text-[#2A2A2E] px-4 py-3 rounded-[10px] text-xs no-print">
        <Info className="w-4 h-4 text-[#6B1020] shrink-0 mt-0.5" />
        <div>
          <strong className="text-[#6B1020]">Manual Bursary Payment Recording:</strong> Online payment processing is not integrated. Fees remain <strong>Pending</strong> until a verified manual payment record (Bank Transfer, POS, Cash, Cheque, or Bank Deposit) is posted by authorised school staff.
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
            {kpiTotals.collectionRate}% Collection Rate • {scopedPayments.length} recorded payment
            {scopedPayments.length === 1 ? '' : 's'}
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

      {/* Admin Navigation Tabs */}
      {isAdmin && (
        <div className="flex flex-wrap gap-1.5 p-1 bg-[#FAF8F4] border border-[#E6DFD3] rounded-[10px] w-fit no-print">
          {(
            [
              { id: 'billing', label: 'Student Fees & Payments', icon: Receipt },
              { id: 'statements', label: 'Student Statements', icon: FileText },
              { id: 'summaries', label: 'Class Payment Summaries', icon: Building2 },
              { id: 'ledger', label: 'Payment Ledger & Receipts', icon: FileSpreadsheet },
              { id: 'setup', label: 'Categories & Class Fees', icon: Layers },
            ] as const
          ).map((tab) => {
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
          {activeTab === 'billing' && isAdmin && (
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
                      <th className="py-3 px-4">Paid (₦)</th>
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
                      scopedFees.map((fee) => (
                        <tr key={fee.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                          <td className="py-3.5 px-4">
                            <p className="font-semibold text-[#2A2A2E]">{fee.studentName}</p>
                            <span className="text-[11px] text-[#6E6A63]">
                              {fee.admissionNo} • {fee.className}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-medium text-[#2A2A2E]">
                            {fee.categoryName}
                          </td>
                          <td className="py-3.5 px-4 text-[#5E5B56]">{fee.term}</td>
                          <td className="py-3.5 px-4 font-semibold text-[#2A2A2E] tabular-nums">
                            {formatNaira(fee.amountDue)}
                          </td>
                          <td className="py-3.5 px-4 font-semibold text-[#2A583B] tabular-nums">
                            {formatNaira(fee.amountPaid)}
                          </td>
                          <td className="py-3.5 px-4 font-semibold text-[#7D5A18] tabular-nums">
                            {formatNaira(fee.balance)}
                          </td>
                          <td className="py-3.5 px-4">{renderStatusPill(fee.status)}</td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {fee.balance > 0 && (
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
                              {isDirector && fee.amountPaid === 0 && (
                                <button
                                  type="button"
                                  title="Delete unpaid fee assignment"
                                  onClick={async () => {
                                    try {
                                      await deleteUnpaidStudentFeeFromFirestore(fee);
                                      setSuccessMsg(`Removed unpaid ${fee.categoryName} assignment.`);
                                    } catch (err) {
                                      setDataError(extractFriendlyError(err, 'Delete failed.'));
                                    }
                                  }}
                                  className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#86222E] hover:bg-[#FAF0F2] transition-colors duration-150"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
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
                            {isAdmin && <th className="py-2.5 px-3 text-right no-print">Action</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EFE9DF]">
                          {activeStatement.fees.length === 0 ? (
                            <tr>
                              <td
                                colSpan={isAdmin ? 8 : 7}
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
                                <td className="py-2.5 px-3 text-[#5E5B56]">{f.dueDate}</td>
                                <td className="py-2.5 px-3 font-semibold text-[#2A2A2E] tabular-nums">
                                  {formatNaira(f.amountDue)}
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-[#2A583B] tabular-nums">
                                  {formatNaira(f.amountPaid)}
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-[#7D5A18] tabular-nums">
                                  {formatNaira(f.balance)}
                                </td>
                                <td className="py-2.5 px-3">{renderStatusPill(f.status)}</td>
                                {isAdmin && (
                                  <td className="py-2.5 px-3 text-right no-print">
                                    {f.balance > 0 ? (
                                      <button
                                        type="button"
                                        onClick={() => openPaymentModal(f)}
                                        className="text-xs font-medium text-[#6B1020] hover:text-[#540C19] underline"
                                      >
                                        Pay
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

                  {/* Recorded Payment History */}
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5E5B56] mb-2">
                      Recorded Payment History & Receipts
                    </h3>
                    <div className="overflow-x-auto border border-[#E6DFD3] rounded-[10px]">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                          <tr>
                            <th className="py-2.5 px-3">Receipt No</th>
                            <th className="py-2.5 px-3">Date</th>
                            <th className="py-2.5 px-3">Fee Category</th>
                            <th className="py-2.5 px-3">Method</th>
                            <th className="py-2.5 px-3">Reference</th>
                            <th className="py-2.5 px-3">Amount Paid (₦)</th>
                            <th className="py-2.5 px-3 text-right no-print">Receipt</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EFE9DF]">
                          {activeStatement.payments.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-6 text-center text-[#7F7A72]">
                                No payments have been recorded for this student in the selected period.
                              </td>
                            </tr>
                          ) : (
                            activeStatement.payments.map((p) => (
                              <tr key={p.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                                <td className="py-2.5 px-3 font-mono font-semibold text-[#6B1020]">
                                  {p.receiptNo}
                                </td>
                                <td className="py-2.5 px-3 text-[#5E5B56]">{p.paymentDate}</td>
                                <td className="py-2.5 px-3 font-medium text-[#2A2A2E]">
                                  {p.categoryName}
                                </td>
                                <td className="py-2.5 px-3 text-[#5E5B56]">{p.paymentMethod}</td>
                                <td className="py-2.5 px-3 font-mono text-[#5E5B56]">
                                  {p.transactionRef}
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-[#2A583B] tabular-nums">
                                  {formatNaira(p.amount)}
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
                            ))
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
          {activeTab === 'summaries' && isAdmin && (
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
                </div>
              )}
            </div>
          )}

          {/* ==================== TAB 4: PAYMENT LEDGER & RECEIPTS ==================== */}
          {activeTab === 'ledger' && isAdmin && (
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] overflow-hidden">
              <div className="p-4 border-b border-[#EFE9DF] flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[#2A2A2E]">
                    Manual Payment Ledger & Official Receipts
                  </h2>
                  <p className="text-[11px] text-[#6E6A63]">
                    Every payment transaction carries a unique receipt number, payment date, method, and transaction reference.
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
                      scopedPayments.map((p) => (
                        <tr key={p.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                          <td className="py-3.5 px-4 font-mono font-semibold text-[#6B1020]">
                            {p.receiptNo}
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
                          <td className="py-3.5 px-4 font-semibold text-[#2A583B] tabular-nums">
                            {formatNaira(p.amount)}
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
                      ))
                    )}
                  </tbody>
                </table>
              </div>
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

      {/* ==================== MODAL: RECORD MANUAL PAYMENT ==================== */}
      {paymentModalOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs">
          <div className="bg-white rounded-[10px] max-w-lg w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#EFE9DF]">
              <div>
                <h3 className="font-semibold text-base text-[#2A2A2E]">
                  Record Manual Fee Payment (₦)
                </h3>
                <p className="text-[11px] text-[#6E6A63]">
                  Supports full and partial payments. Generates a unique receipt number automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPaymentModalOpen(false)}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors duration-150"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRecordPayment} className="py-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-[#5E5B56] mb-1">
                  Assigned Student Fee Obligation *
                </label>
                <select
                  required
                  value={targetFeeId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setTargetFeeId(id);
                    const found = reconciledFees.find((f) => f.id === id);
                    setPayAmount(found?.balance || 0);
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
                <div className="bg-[#FAF8F4] p-3 rounded-[10px] border border-[#E6DFD3] flex justify-between text-[11px] text-[#5E5B56] tabular-nums">
                  <span>
                    Billed: <strong className="text-[#2A2A2E]">{formatNaira(selectedTargetFee.amountDue)}</strong>
                  </span>
                  <span>
                    Paid So Far:{' '}
                    <strong className="text-[#2A583B]">
                      {formatNaira(selectedTargetFee.amountPaid)}
                    </strong>
                  </span>
                  <span>
                    Outstanding Balance:{' '}
                    <strong className="text-[#7D5A18]">
                      {formatNaira(selectedTargetFee.balance)}
                    </strong>
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">
                    Amount Paid (₦) *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={selectedTargetFee?.balance || undefined}
                    value={payAmount || ''}
                    onChange={(e) => setPayAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] font-semibold text-[#2A2A2E] tabular-nums focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                  {selectedTargetFee && selectedTargetFee.balance > 0 && (
                    <div className="flex gap-2 mt-1.5">
                      <button
                        type="button"
                        onClick={() => setPayAmount(Math.round(selectedTargetFee.balance / 2))}
                        className="text-[10px] font-medium px-2 py-0.5 rounded-[6px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#5E5B56] transition-colors duration-150"
                      >
                        50% Partial
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayAmount(selectedTargetFee.balance)}
                        className="text-[10px] font-medium px-2 py-0.5 rounded-[6px] bg-[#FAF0F2] hover:bg-[#F3E1E5] border border-[#DFC7CA] text-[#6B1020] transition-colors duration-150"
                      >
                        Full Balance ({formatNaira(selectedTargetFee.balance)})
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
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
              </div>

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
                    Transaction Reference {payMethod !== 'Cash' ? '*' : '(Optional)'}
                  </label>
                  <input
                    type="text"
                    required={payMethod !== 'Cash'}
                    value={payRef}
                    onChange={(e) => setPayRef(e.target.value)}
                    placeholder={
                      payMethod === 'Cash'
                        ? 'Cash desk reference'
                        : 'e.g. GTB-TRF-993812 or POS RRNs'
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] font-mono focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-[#5E5B56] mb-1">
                  Bursar Notes (Optional)
                </label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="e.g. Paid by mother, first installment"
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#EFE9DF]">
                <button
                  type="button"
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
                  <label className="block font-medium text-[#5E5B56] mb-1">Due Date *</label>
                  <input
                    type="date"
                    required
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
          schoolSettings={schoolSettings}
          onClose={() => setSelectedReceipt(null)}
        />
      )}
    </div>
  );
};
