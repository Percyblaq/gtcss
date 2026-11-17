import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Users,
  Search,
  UserPlus,
  Phone,
  Mail,
  MapPin,
  CheckCircle2,
  AlertCircle,
  X,
  Eye,
  Pencil,
  Printer,
  ArrowUpRight,
  Upload,
  Trash2,
  RefreshCw,
  Database,
  ShieldCheck,
  GraduationCap,
  UserX,
  Calendar,
  Camera,
  CheckSquare,
  Square,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SchoolClass, Student } from '../types';
import { SAMPLE_CLASSES } from '../data/sampleData';
import { subscribeClasses } from '../services/academicService';
import {
  getActiveClasses,
  groupClassesBySection,
  inferSectionFromClassName,
} from '../utils/classUtils';
import {
  compressPassportPhoto,
  deleteStudentsFromFirestore,
  extractFriendlyError,
  generateUniqueAdmissionNo,
  promoteStudentsInFirestore,
  saveStudentToFirestore,
  seedSampleStudentsToFirestore,
  subscribeStudents,
  updateStudentStatusInFirestore,
} from '../services/schoolService';
import { SchoolLogo } from '../components/common/SchoolLogo';

type StudentFormState = {
  id?: string;
  admissionNo: string;
  firstName: string;
  middleName: string;
  surname: string;
  dateOfBirth: string;
  gender: 'Male' | 'Female';
  classId: string;
  className: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  address: string;
  admissionDate: string;
  passportPhoto: string;
  status: 'Active' | 'Graduated' | 'Withdrawn';
  feeStatus: 'Paid' | 'Partial' | 'Pending';
  stateOfOrigin: string;
  bloodGroup: string;
  createdAt?: string;
};

const NIGERIAN_STATES = [
  'Lagos State',
  'Abuja (FCT)',
  'Abia State',
  'Adamawa State',
  'Akwa Ibom State',
  'Anambra State',
  'Bauchi State',
  'Bayelsa State',
  'Benue State',
  'Borno State',
  'Cross River State',
  'Delta State',
  'Ebonyi State',
  'Edo State',
  'Ekiti State',
  'Enugu State',
  'Gombe State',
  'Imo State',
  'Jigawa State',
  'Kaduna State',
  'Kano State',
  'Katsina State',
  'Kebbi State',
  'Kogi State',
  'Kwara State',
  'Nasarawa State',
  'Niger State',
  'Ogun State',
  'Ondo State',
  'Osun State',
  'Oyo State',
  'Plateau State',
  'Rivers State',
  'Sokoto State',
  'Taraba State',
  'Yobe State',
  'Zamfara State',
];

export const StudentsPage: React.FC = () => {
  const { role, currentUser, firebaseUser, schoolSettings } = useAuth();
  const isLiveFirestore = Boolean(firebaseUser);
  const canManageStudents = role === 'director' || role === 'principal';
  const isDirector = role === 'director';

  const [classesList, setClassesList] = useState<SchoolClass[]>(SAMPLE_CLASSES);
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(isLiveFirestore);
  const [dataError, setDataError] = useState<string>('');
  const [bannerSuccess, setBannerSuccess] = useState<string>('');

  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClass, setSelectedClass] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');

  // Modals & Selection states
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showCloseProfileConfirm, setShowCloseProfileConfirm] = useState(false);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [formError, setFormError] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);

  const activeClassesList = useMemo(() => getActiveClasses(classesList), [classesList]);

  // Promotion modal & multi-select
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [promoteTargets, setPromoteTargets] = useState<Student[]>([]);
  const [targetClassName, setTargetClassName] = useState<string>(SAMPLE_CLASSES[1]?.name || 'Nursery 1');
  const [isPromoting, setIsPromoting] = useState(false);

  // Delete confirmation modal (Director only)
  const [deleteTargets, setDeleteTargets] = useState<Student[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  // Seeding sample data
  const [isSeeding, setIsSeeding] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const buildEmptyForm = (existing: Student[]): StudentFormState => ({
    admissionNo: generateUniqueAdmissionNo(existing),
    firstName: '',
    middleName: '',
    surname: '',
    dateOfBirth: '2013-05-15',
    gender: 'Male',
    classId: activeClassesList[0]?.id || SAMPLE_CLASSES[0].id,
    className: activeClassesList[0]?.name || SAMPLE_CLASSES[0].name,
    guardianName: '',
    guardianPhone: '+234 ',
    guardianEmail: '',
    address: '',
    admissionDate: new Date().toISOString().split('T')[0],
    passportPhoto: '',
    status: 'Active',
    feeStatus: 'Pending',
    stateOfOrigin: 'Lagos State',
    bloodGroup: 'O+',
  });

  const [formState, setFormState] = useState<StudentFormState>(() => buildEmptyForm([]));

  const studentFormClasses = useMemo(() => {
    const base = activeClassesList.length > 0 ? activeClassesList : classesList;
    if (isEditMode && formState.className) {
      const exists = base.some(
        (c) =>
          (formState.classId && c.id === formState.classId) ||
          c.name.trim().toLowerCase() === formState.className.trim().toLowerCase()
      );
      if (!exists) {
        const matched = classesList.find(
          (c) =>
            (formState.classId && c.id === formState.classId) ||
            c.name.trim().toLowerCase() === formState.className.trim().toLowerCase()
        );
        if (matched) return [...base, matched];
        const fallbackClass: SchoolClass = {
          id: formState.classId || `legacy-${formState.className}`,
          name: formState.className,
          section: inferSectionFromClassName(formState.className),
          level: formState.className,
          arm: 'Standard',
          formTeacherId: '',
          formTeacherName: 'Unassigned',
          capacity: 30,
          totalStudents: 0,
          roomNumber: '',
          subjects: [],
          isActive: true,
        };
        return [...base, fallbackClass];
      }
    }
    return base;
  }, [activeClassesList, classesList, isEditMode, formState.classId, formState.className]);

  // Subscribe to Firestore when authenticated
  useEffect(() => {
    if (!firebaseUser) {
      setStudentsList([]);
      setIsLoadingData(false);
      setDataError('');
      return;
    }

    setIsLoadingData(true);
    setDataError('');
    const unsubClasses = subscribeClasses(
      (liveClasses) => setClassesList(liveClasses.length > 0 ? liveClasses : SAMPLE_CLASSES),
      (errMsg) => setDataError(errMsg)
    );
    const unsub = subscribeStudents(
      role,
      currentUser,
      firebaseUser.email,
      (liveStudents) => {
        setStudentsList(liveStudents);
        setIsLoadingData(false);
        const liveIds = new Set(liveStudents.map((s) => s.id));
        setSelectedStudentIds((prev) => prev.filter((id) => liveIds.has(id)));
        // Keep open profile modal synced with latest Firestore data (close if deleted)
        setSelectedStudent((prev) =>
          prev ? liveStudents.find((s) => s.id === prev.id) || null : null
        );
      },
      (errMsg) => {
        setDataError(errMsg);
        setIsLoadingData(false);
      }
    );

    return () => {
      unsubClasses();
      unsub();
    };
  }, [firebaseUser, role, currentUser]);

  // Clear banner after 5s
  useEffect(() => {
    if (!bannerSuccess) return;
    const t = setTimeout(() => setBannerSuccess(''), 5000);
    return () => clearTimeout(t);
  }, [bannerSuccess]);

  const hasProfileUnsavedChanges =
    isFormModalOpen || promoteTargets.length > 0 || isSaving || isPromoting || isDeleting;

  const handleCloseProfileImmediately = () => {
    setShowCloseProfileConfirm(false);
    setSelectedStudent(null);
  };

  const handleRequestCloseProfile = () => {
    if (hasProfileUnsavedChanges) {
      setShowCloseProfileConfirm(true);
      return;
    }
    handleCloseProfileImmediately();
  };

  // Close student profile dialog on Escape key
  useEffect(() => {
    if (!selectedStudent) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showCloseProfileConfirm) {
        setShowCloseProfileConfirm(false);
        return;
      }
      if (isFormModalOpen || promoteTargets.length > 0 || deleteTargets.length > 0) {
        return;
      }
      handleRequestCloseProfile();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // RBAC + Search + Class + Status filtering
  const filteredStudents = useMemo(() => {
    return studentsList.filter((s) => {
      if (!isLiveFirestore) {
        if (role === 'parent') {
          const linkedWards = currentUser?.linkedStudentIds || ['std-001'];
          if (
            !linkedWards.includes(s.id) &&
            s.guardianEmail.toLowerCase() !== (currentUser?.email || '').toLowerCase()
          ) {
            return false;
          }
        }
        if (role === 'teacher') {
          const teacherClasses = currentUser?.assignedClasses || [];
          if (teacherClasses.length > 0 && !teacherClasses.includes(s.className)) {
            return false;
          }
        }
      }

      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        s.fullName.toLowerCase().includes(q) ||
        s.firstName.toLowerCase().includes(q) ||
        (s.middleName || '').toLowerCase().includes(q) ||
        s.surname.toLowerCase().includes(q) ||
        s.admissionNo.toLowerCase().includes(q) ||
        s.guardianName.toLowerCase().includes(q);

      const matchesClass = selectedClass === 'All' || s.className === selectedClass;
      const matchesStatus = selectedStatus === 'All' || s.status === selectedStatus;

      return matchesSearch && matchesClass && matchesStatus;
    });
  }, [studentsList, isLiveFirestore, role, currentUser, searchQuery, selectedClass, selectedStatus]);

  // Open Create Modal
  const handleOpenAddModal = () => {
    if (!canManageStudents) return;
    setIsEditMode(false);
    setFormError('');
    setFormState(buildEmptyForm(studentsList));
    setIsFormModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (student: Student) => {
    if (!canManageStudents) return;
    setIsEditMode(true);
    setFormError('');
    setFormState({
      id: student.id,
      admissionNo: student.admissionNo,
      firstName: student.firstName,
      middleName: student.middleName || '',
      surname: student.surname,
      dateOfBirth: student.dateOfBirth,
      gender: student.gender,
      classId: student.classId,
      className: student.className,
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      guardianEmail: student.guardianEmail || '',
      address: student.address || '',
      admissionDate: student.admissionDate,
      passportPhoto: student.passportPhoto || '',
      status: student.status,
      feeStatus: student.feeStatus,
      stateOfOrigin: student.stateOfOrigin || 'Lagos State',
      bloodGroup: student.bloodGroup || 'O+',
      createdAt: student.createdAt,
    });
    setIsFormModalOpen(true);
  };

  // Handle Passport Photo Selection & Compression
  const handlePassportUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormError('');
    setIsCompressingPhoto(true);
    try {
      const compressed = await compressPassportPhoto(file);
      setFormState((prev) => ({ ...prev, passportPhoto: compressed }));
    } catch (err) {
      setFormError(extractFriendlyError(err, 'Unable to process passport photograph.'));
    } finally {
      setIsCompressingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Validate and Save Student (Create or Edit)
  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStudents) {
      setFormError('Unauthorized: Only the School Director or Principal can register or edit students.');
      return;
    }

    setFormError('');

    const trimmedAdmNo = formState.admissionNo.trim().toUpperCase();
    const trimmedFirst = formState.firstName.trim();
    const trimmedMiddle = formState.middleName.trim();
    const trimmedSurname = formState.surname.trim();
    const trimmedGuardian = formState.guardianName.trim();
    const trimmedPhone = formState.guardianPhone.trim();
    const trimmedEmail = formState.guardianEmail.trim();
    const trimmedAddress = formState.address.trim();

    if (!trimmedAdmNo) {
      setFormError('Admission number is required.');
      return;
    }
    if (!trimmedFirst || !trimmedSurname) {
      setFormError('First name and Surname are required.');
      return;
    }
    if (!formState.dateOfBirth) {
      setFormError('Date of birth is required.');
      return;
    }
    if (!formState.className) {
      setFormError('Assigned class is required.');
      return;
    }
    if (!trimmedGuardian || !trimmedPhone || trimmedPhone === '+234') {
      setFormError('Parent/Guardian full name and phone number are required.');
      return;
    }
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError('Please enter a valid Parent/Guardian email address.');
      return;
    }
    if (!trimmedAddress) {
      setFormError('Residential home address is required.');
      return;
    }
    if (!formState.admissionDate) {
      setFormError('Admission date is required.');
      return;
    }

    // Local duplicate admission number check
    const localDuplicate = studentsList.some(
      (s) =>
        s.admissionNo.trim().toUpperCase() === trimmedAdmNo &&
        (!isEditMode || s.id !== formState.id)
    );
    if (localDuplicate) {
      setFormError(
        `Duplicate Admission Number: "${trimmedAdmNo}" is already assigned to another student.`
      );
      return;
    }

    const matchedClass = classesList.find((c) => c.name === formState.className);
    const fullName = [trimmedFirst, trimmedMiddle, trimmedSurname].filter(Boolean).join(' ');

    setIsSaving(true);
    try {
      if (isLiveFirestore) {
        const saved = await saveStudentToFirestore(
          {
            id: formState.id,
            admissionNo: trimmedAdmNo,
            firstName: trimmedFirst,
            middleName: trimmedMiddle,
            surname: trimmedSurname,
            fullName,
            dateOfBirth: formState.dateOfBirth,
            gender: formState.gender,
            classId: matchedClass?.id || formState.classId || 'cls-jss1a',
            className: formState.className,
            guardianName: trimmedGuardian,
            guardianPhone: trimmedPhone,
            guardianEmail: trimmedEmail,
            address: trimmedAddress,
            admissionDate: formState.admissionDate,
            passportPhoto: formState.passportPhoto,
            status: formState.status,
            feeStatus: formState.feeStatus,
            stateOfOrigin: formState.stateOfOrigin,
            bloodGroup: formState.bloodGroup,
            createdAt: formState.createdAt,
          },
          isEditMode
        );
        if (selectedStudent && selectedStudent.id === saved.id) {
          setSelectedStudent(saved);
        }
        setBannerSuccess(
          isEditMode
            ? `Updated student profile for ${saved.fullName} (${saved.admissionNo}) in Cloud Firestore.`
            : `Enrolled ${saved.fullName} (${saved.admissionNo}) into Cloud Firestore.`
        );
      } else {
        throw new Error('Authentication required to save student records.');
      }
      setIsFormModalOpen(false);
    } catch (err) {
      setFormError(extractFriendlyError(err, 'Failed to save student record.'));
    } finally {
      setIsSaving(false);
    }
  };

  // Change student status (Active / Graduated / Withdrawn)
  const handleStatusChange = async (
    student: Student,
    newStatus: 'Active' | 'Graduated' | 'Withdrawn'
  ) => {
    if (!canManageStudents || student.status === newStatus) return;
    setDataError('');
    try {
      if (isLiveFirestore) {
        await updateStudentStatusInFirestore(student.id, newStatus);
        setBannerSuccess(`Marked ${student.fullName} as ${newStatus} in Cloud Firestore.`);
      } else {
        throw new Error('Authentication required to update student status.');
      }
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to update student status.'));
    }
  };

  // Open Promotion Modal (single or bulk)
  const handleOpenPromoteModal = (targets: Student[]) => {
    if (!canManageStudents || targets.length === 0) return;
    setPromoteTargets(targets);
    // Suggest next active class automatically if possible
    const pool = activeClassesList.length > 0 ? activeClassesList : classesList;
    const currentClassIdx = pool.findIndex((c) => c.name === targets[0].className);
    const suggested =
      currentClassIdx >= 0 && currentClassIdx + 1 < pool.length
        ? pool[currentClassIdx + 1].name
        : pool[0]?.name || SAMPLE_CLASSES[0].name;
    setTargetClassName(suggested);
  };

  const handleConfirmPromote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStudents || promoteTargets.length === 0) return;
    const targetCls = classesList.find((c) => c.name === targetClassName);
    if (!targetCls) return;

    setIsPromoting(true);
    setDataError('');
    try {
      const ids = promoteTargets.map((s) => s.id);
      if (isLiveFirestore) {
        await promoteStudentsInFirestore(ids, targetCls.id, targetCls.name);
        setBannerSuccess(
          `Promoted ${ids.length} ${ids.length === 1 ? 'student' : 'students'} to ${targetCls.name} in Cloud Firestore.`
        );
      } else {
        throw new Error('Authentication required to promote students.');
      }
      setPromoteTargets([]);
      setSelectedStudentIds([]);
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to promote selected students.'));
    } finally {
      setIsPromoting(false);
    }
  };

  // Open Delete Confirmation Modal (Director only, single or bulk)
  const handleOpenDeleteModal = (targets: Student[]) => {
    if (!isDirector || targets.length === 0) return;
    setDeleteTargets(targets);
  };

  const handleConfirmDelete = async () => {
    if (!isDirector || deleteTargets.length === 0) return;

    const targetsSnapshot = [...deleteTargets];
    const ids = targetsSnapshot.map((s) => s.id);
    const idSet = new Set(ids);

    setIsDeleting(true);
    setDataError('');
    try {
      if (!isLiveFirestore) {
        throw new Error('Authentication required to delete student records.');
      }

      const { deletedLinkedRecords } = await deleteStudentsFromFirestore(targetsSnapshot);

      // Remove deleted student(s) from UI state immediately
      setStudentsList((prev) => prev.filter((s) => !idSet.has(s.id)));
      setSelectedStudentIds((prev) => prev.filter((id) => !idSet.has(id)));
      setSelectedStudent((prev) => (prev && idSet.has(prev.id) ? null : prev));
      setDeleteTargets([]);

      const linkedNote =
        deletedLinkedRecords > 0
          ? ` and ${deletedLinkedRecords} linked ${deletedLinkedRecords === 1 ? 'record' : 'records'}`
          : '';
      if (targetsSnapshot.length === 1) {
        const target = targetsSnapshot[0];
        setBannerSuccess(
          `Deleted ${target.fullName} (${target.admissionNo})${linkedNote} from Cloud Firestore.`
        );
      } else {
        setBannerSuccess(
          `Deleted ${targetsSnapshot.length} students${linkedNote} from Cloud Firestore.`
        );
      }
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to delete selected student(s).'));
      setDeleteTargets([]);
    } finally {
      setIsDeleting(false);
    }
  };

  // Seed Sample Students into Firestore
  const handleSeedSampleStudents = async () => {
    if (!isLiveFirestore || !canManageStudents) return;
    setIsSeeding(true);
    setDataError('');
    try {
      await seedSampleStudentsToFirestore();
      setBannerSuccess('Sample Nigerian student records seeded to Cloud Firestore.');
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to seed sample students.'));
    } finally {
      setIsSeeding(false);
    }
  };

  const toggleSelectStudent = (id: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const allFilteredSelected =
    filteredStudents.length > 0 &&
    filteredStudents.every((s) => selectedStudentIds.includes(s.id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedStudentIds([]);
    } else {
      setSelectedStudentIds(filteredStudents.map((s) => s.id));
    }
  };

  const getStatusBadgeClasses = (status: Student['status']) => {
    switch (status) {
      case 'Active':
        return 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]';
      case 'Graduated':
        return 'bg-[#FAF0F2] text-[#6B1020] border-[#DFC7CA]';
      case 'Withdrawn':
        return 'bg-[#FAF0F2] text-[#86222E] border-[#E2C1C5]';
      default:
        return 'bg-[#FAF8F4] text-[#5E5B56] border-[#E6DFD3]';
    }
  };

  return (
    <>
      <div className={selectedStudent ? 'space-y-5 no-print' : 'space-y-5'}>
        {/* Data Source Indicator Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB] text-xs text-[#2A583B]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#2A583B] shrink-0" />
            <span>
              <strong>Live Cloud Firestore Connected:</strong> All student enrollments, passport
              photographs, promotions, and status changes persist securely in Firestore.
            </span>
          </div>
          {canManageStudents && studentsList.length === 0 && !isLoadingData && (
            <button
              onClick={handleSeedSampleStudents}
              disabled={isSeeding}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-[8px] bg-[#2A583B] hover:bg-[#20452E] text-white font-medium text-[11px] transition-colors duration-150 disabled:opacity-50"
            >
              <Database className="w-3.5 h-3.5" />
              {isSeeding ? 'Seeding...' : 'Load Sample Students to Firestore'}
            </button>
          )}
        </div>

        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#2A2A2E] tracking-tight">
                {role === 'parent' ? 'My Ward Information' : 'Student Management'}
              </h1>
              <span className="bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA] text-xs font-medium px-2.5 py-0.5 rounded-full tabular-nums">
                {filteredStudents.length} {filteredStudents.length === 1 ? 'Student' : 'Students'}
              </span>
            </div>
            <p className="text-xs text-[#6E6A63] mt-1">
              Registrations, unique admission numbers, class promotions, passport records & guardian
              biodata
            </p>
          </div>

          {canManageStudents && (
            <div className="flex items-center gap-2 flex-wrap">
              {selectedStudentIds.length > 0 && (
                <button
                  onClick={() =>
                    handleOpenPromoteModal(
                      studentsList.filter((s) => selectedStudentIds.includes(s.id))
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#FBF5E8] hover:bg-[#F4E9D0] border border-[#E3CFA6] text-[#7D5A18] text-xs font-medium transition-colors duration-150"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  Promote Selected ({selectedStudentIds.length})
                </button>
              )}
              {isDirector && selectedStudentIds.length > 0 && (
                <button
                  onClick={() =>
                    handleOpenDeleteModal(
                      studentsList.filter((s) => selectedStudentIds.includes(s.id))
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#86222E] hover:bg-[#6E1A24] text-white text-xs font-medium transition-colors duration-150"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Selected ({selectedStudentIds.length})
                </button>
              )}
              <button
                onClick={handleOpenAddModal}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150"
              >
                <UserPlus className="w-4 h-4" />
                Register New Student
              </button>
            </div>
          )}
        </div>

        {/* Feedback Banners */}
        {bannerSuccess && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB] text-[#2A583B] text-xs font-medium">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#2A583B] shrink-0" />
              <span>{bannerSuccess}</span>
            </div>
            <button onClick={() => setBannerSuccess('')} className="text-[#2A583B] hover:opacity-75 transition-opacity">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {dataError && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] text-xs font-medium">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-[#86222E] shrink-0" />
              <span>{dataError}</span>
            </div>
            <button onClick={() => setDataError('')} className="text-[#86222E] hover:opacity-75 transition-opacity">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Filters & Search */}
        <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
            {/* Search Box */}
            <div className="lg:col-span-6 relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#7F7A72]" />
              <input
                type="text"
                placeholder="Search by student name, admission number (e.g. CF/2026/0101), or guardian..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] text-[#2A2A2E] transition-colors duration-150"
              />
            </div>

            {/* Class Filter */}
            <div className="lg:col-span-3">
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] text-[#2A2A2E] transition-colors duration-150"
              >
                <option value="All">All Classes (Creche – SS 3)</option>
                {groupClassesBySection(classesList).map((g) => (
                  <optgroup key={g.section} label={g.label}>
                    {g.classes.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                        {c.isActive === false ? ' (Archived)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Enrollment Status Filter */}
            <div className="lg:col-span-3">
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] text-[#2A2A2E] transition-colors duration-150"
              >
                <option value="All">All Statuses</option>
                <option value="Active">Active Students</option>
                <option value="Graduated">Graduated</option>
                <option value="Withdrawn">Withdrawn</option>
              </select>
            </div>
          </div>
        </div>

        {/* Students Table */}
        <div className="bg-white rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                  {canManageStudents && (
                    <th className="py-3 pl-4 pr-2 w-8">
                      <button
                        type="button"
                        onClick={toggleSelectAllFiltered}
                        title="Select all visible students"
                        className="text-[#7F7A72] hover:text-[#6B1020] transition-colors duration-150"
                      >
                        {allFilteredSelected ? (
                          <CheckSquare className="w-4 h-4 text-[#6B1020]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>
                  )}
                  <th className="py-3 px-4">Student</th>
                  <th className="py-3 px-4">Admission No</th>
                  <th className="py-3 px-4">Class</th>
                  <th className="py-3 px-4">Parent / Guardian</th>
                  <th className="py-3 px-4">Admission Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFE9DF] text-xs">
                {isLoadingData ? (
                  <tr>
                    <td colSpan={canManageStudents ? 8 : 7} className="py-12 text-center text-[#7F7A72]">
                      Synchronizing student records from Cloud Firestore...
                    </td>
                  </tr>
                ) : filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={canManageStudents ? 8 : 7} className="py-12 text-center text-[#7F7A72]">
                      <div className="max-w-sm mx-auto space-y-2">
                        <Users className="w-8 h-8 mx-auto text-[#DDD5C7]" />
                        <p className="font-medium text-[#5E5B56]">
                          {studentsList.length === 0 && isLiveFirestore
                            ? 'No students are registered in Cloud Firestore yet.'
                            : 'No student records match your current search or filters.'}
                        </p>
                        {canManageStudents && studentsList.length === 0 && isLiveFirestore && (
                          <div className="pt-2 flex items-center justify-center gap-2">
                            <button
                              onClick={handleOpenAddModal}
                              className="px-3 py-1.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-xs transition-colors duration-150"
                            >
                              Register First Student
                            </button>
                            <button
                              onClick={handleSeedSampleStudents}
                              disabled={isSeeding}
                              className="px-3 py-1.5 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium text-xs transition-colors duration-150"
                            >
                              {isSeeding ? 'Loading...' : 'Seed Sample Records'}
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((std) => {
                    const isChecked = selectedStudentIds.includes(std.id);
                    return (
                      <tr
                        key={std.id}
                        className={`hover:bg-[#FAF8F4] transition-colors duration-150 ${
                          isChecked ? 'bg-[#FAF0F2]/50' : ''
                        }`}
                      >
                        {canManageStudents && (
                          <td className="py-3.5 pl-4 pr-2">
                            <button
                              type="button"
                              onClick={() => toggleSelectStudent(std.id)}
                              className="text-[#7F7A72] hover:text-[#6B1020] transition-colors duration-150"
                            >
                              {isChecked ? (
                                <CheckSquare className="w-4 h-4 text-[#6B1020]" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                          </td>
                        )}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            {std.passportPhoto ? (
                              <img
                                src={std.passportPhoto}
                                alt={std.fullName}
                                className="w-9 h-9 rounded-full object-cover border border-[#E6DFD3] shrink-0"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-[#FAF0F2] border border-[#DFC7CA] text-[#6B1020] font-semibold flex items-center justify-center shrink-0">
                                {std.firstName?.charAt(0) || std.fullName.charAt(0)}
                                {std.surname?.charAt(0) || ''}
                              </div>
                            )}
                            <div>
                              <p className="font-semibold text-[#2A2A2E]">{std.fullName}</p>
                              <span className="text-[10px] text-[#7F7A72]">
                                {std.gender} • DOB: {std.dateOfBirth}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 font-mono font-semibold text-[#2A2A2E]">
                          {std.admissionNo}
                        </td>

                        <td className="py-3.5 px-4">
                          <span className="inline-block px-2.5 py-0.5 rounded-[6px] font-medium text-[#6B1020] bg-[#FAF0F2] border border-[#DFC7CA]">
                            {std.className}
                          </span>
                        </td>

                        <td className="py-3.5 px-4">
                          <p className="font-medium text-[#2A2A2E]">{std.guardianName}</p>
                          <p className="text-[11px] text-[#6E6A63]">{std.guardianPhone}</p>
                        </td>

                        <td className="py-3.5 px-4 text-[#6E6A63] font-mono text-[11px] tabular-nums">
                          {std.admissionDate}
                        </td>

                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${getStatusBadgeClasses(
                              std.status
                            )}`}
                          >
                            {std.status}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => setSelectedStudent(std)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[#6B1020] bg-[#FAF0F2] hover:bg-[#F3E2E5] border border-[#DFC7CA] font-medium transition-colors duration-150"
                              title="View & Print Profile"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Profile
                            </button>

                            {canManageStudents && (
                              <>
                                <button
                                  onClick={() => handleOpenEditModal(std)}
                                  className="p-1.5 rounded-[8px] text-[#5E5B56] hover:text-[#6B1020] hover:bg-[#FAF8F4] transition-colors duration-150"
                                  title="Edit Student Information"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleOpenPromoteModal([std])}
                                  className="p-1.5 rounded-[8px] text-[#7D5A18] hover:bg-[#FBF5E8] transition-colors duration-150"
                                  title="Promote Student to Another Class"
                                >
                                  <ArrowUpRight className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            {isDirector && (
                              <button
                                onClick={() => handleOpenDeleteModal([std])}
                                className="p-1.5 rounded-[8px] text-[#86222E] hover:bg-[#FAF0F2] transition-colors duration-150"
                                title="Delete Student"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add / Edit Student Registration Modal */}
        {isFormModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white rounded-[10px] max-w-2xl w-full shadow-2xl border border-[#E6DFD3] my-6 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#E6DFD3] bg-[#FAF8F4]">
                <div>
                  <h3 className="font-semibold text-base text-[#2A2A2E]">
                    {isEditMode ? 'Edit Student Information' : 'Student Registration Form'}
                  </h3>
                  <p className="text-xs text-[#6E6A63]">
                    {isEditMode
                      ? `Updating record for ${formState.admissionNo}`
                      : 'Complete student biodata, guardian details & passport photograph'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#EFE9DF] transition-colors duration-150"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveStudent} className="p-6 space-y-5 text-xs max-h-[82vh] overflow-y-auto">
                {formError && (
                  <div className="flex items-start gap-2 p-3 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] text-xs">
                    <AlertCircle className="w-4 h-4 text-[#86222E] shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                {/* Passport Photo & Admission Number Row */}
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center bg-[#FAF8F4] p-4 rounded-[10px] border border-[#E6DFD3]">
                  <div className="relative shrink-0">
                    {formState.passportPhoto ? (
                      <img
                        src={formState.passportPhoto}
                        alt="Passport Preview"
                        className="w-20 h-24 rounded-[10px] object-cover border border-[#B8913A]/50 bg-white"
                      />
                    ) : (
                      <div className="w-20 h-24 rounded-[10px] border border-dashed border-[#DDD5C7] bg-white flex flex-col items-center justify-center text-[#7F7A72] text-[10px] text-center p-2">
                        <Camera className="w-5 h-5 mb-1 text-[#7F7A72]" />
                        Passport Photo
                      </div>
                    )}
                  </div>

                  <div className="flex-1 space-y-2.5 w-full">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handlePassportUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isCompressingPhoto}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-xs transition-colors duration-150 disabled:opacity-50"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {isCompressingPhoto
                          ? 'Processing...'
                          : formState.passportPhoto
                          ? 'Change Passport Photo'
                          : 'Upload Passport Photo'}
                      </button>
                      {formState.passportPhoto && (
                        <button
                          type="button"
                          onClick={() => setFormState((prev) => ({ ...prev, passportPhoto: '' }))}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] bg-[#FAF0F2] hover:bg-[#F3E2E5] border border-[#E2C1C5] text-[#86222E] font-medium text-xs transition-colors duration-150"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="block font-medium text-[#5E5B56] mb-1">
                        Admission Number (Auto-generated & Unique) *
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          required
                          value={formState.admissionNo}
                          onChange={(e) =>
                            setFormState({ ...formState, admissionNo: e.target.value.toUpperCase() })
                          }
                          className="flex-1 px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white font-mono font-semibold text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                        />
                        {!isEditMode && (
                          <button
                            type="button"
                            onClick={() =>
                              setFormState({
                                ...formState,
                                admissionNo: generateUniqueAdmissionNo(studentsList),
                              })
                            }
                            className="inline-flex items-center gap-1 px-3 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium transition-colors duration-150"
                            title="Regenerate unique admission number"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Auto
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Student Name Breakdown */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">First Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Chinedu"
                      value={formState.firstName}
                      onChange={(e) => setFormState({ ...formState, firstName: e.target.value })}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">Middle Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Victor"
                      value={formState.middleName}
                      onChange={(e) => setFormState({ ...formState, middleName: e.target.value })}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">Surname *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Okonkwo"
                      value={formState.surname}
                      onChange={(e) => setFormState({ ...formState, surname: e.target.value })}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>
                </div>

                {/* DOB, Gender, Class, Admission Date */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">Date of Birth *</label>
                    <input
                      type="date"
                      required
                      value={formState.dateOfBirth}
                      onChange={(e) => setFormState({ ...formState, dateOfBirth: e.target.value })}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">Gender *</label>
                    <select
                      value={formState.gender}
                      onChange={(e) =>
                        setFormState({ ...formState, gender: e.target.value as 'Male' | 'Female' })
                      }
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">Assigned Class *</label>
                    <select
                      value={formState.className}
                      onChange={(e) => {
                        const cls = classesList.find((c) => c.name === e.target.value);
                        setFormState({
                          ...formState,
                          className: e.target.value,
                          classId: cls?.id || formState.classId,
                        });
                      }}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    >
                      {groupClassesBySection(studentFormClasses).map((g) => (
                        <optgroup key={g.section} label={g.label}>
                          {g.classes.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                              {c.isActive === false ? ' (Archived)' : ''}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">Admission Date *</label>
                    <input
                      type="date"
                      required
                      value={formState.admissionDate}
                      onChange={(e) => setFormState({ ...formState, admissionDate: e.target.value })}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Parent / Guardian Info */}
                <div className="pt-3 border-t border-[#EFE9DF] space-y-3">
                  <h4 className="font-semibold text-[11px] uppercase tracking-wider text-[#5E5B56]">
                    Parent / Guardian & Address Details
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-medium text-[#5E5B56] mb-1">
                        Parent / Guardian Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Chief / Dr. / Mrs. Adeyemi"
                        value={formState.guardianName}
                        onChange={(e) =>
                          setFormState({ ...formState, guardianName: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-[#5E5B56] mb-1">
                        Parent Phone Number *
                      </label>
                      <input
                        type="tel"
                        required
                        placeholder="+234 803 000 0000"
                        value={formState.guardianPhone}
                        onChange={(e) =>
                          setFormState({ ...formState, guardianPhone: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-[#5E5B56] mb-1">
                        Parent Email *
                      </label>
                      <input
                        type="email"
                        required
                        placeholder="parent@domain.ng"
                        value={formState.guardianEmail}
                        onChange={(e) =>
                          setFormState({ ...formState, guardianEmail: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">Home Address *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Plot 12, Admiralty Way, Lekki Phase 1, Lagos"
                      value={formState.address}
                      onChange={(e) => setFormState({ ...formState, address: e.target.value })}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Supplementary Nigerian Academic Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#EFE9DF]">
                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">State of Origin</label>
                    <select
                      value={formState.stateOfOrigin}
                      onChange={(e) => setFormState({ ...formState, stateOfOrigin: e.target.value })}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E]"
                    >
                      {NIGERIAN_STATES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">
                      Enrollment Status
                    </label>
                    <select
                      value={formState.status}
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          status: e.target.value as 'Active' | 'Graduated' | 'Withdrawn',
                        })
                      }
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E]"
                    >
                      <option value="Active">Active</option>
                      <option value="Graduated">Graduated</option>
                      <option value="Withdrawn">Withdrawn</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-[#5E5B56] mb-1">Fee Status</label>
                    <select
                      value={formState.feeStatus}
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          feeStatus: e.target.value as 'Paid' | 'Partial' | 'Pending',
                        })
                      }
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E]"
                    >
                      <option value="Paid">Paid (₦)</option>
                      <option value="Partial">Partial Payment</option>
                      <option value="Pending">Pending</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-[#EFE9DF]">
                  <button
                    type="button"
                    onClick={() => setIsFormModalOpen(false)}
                    className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium transition-colors duration-150"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving || isCompressingPhoto}
                    className="px-5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium transition-colors duration-150 disabled:opacity-50"
                  >
                    {isSaving
                      ? 'Saving...'
                      : isEditMode
                      ? 'Save Changes'
                      : 'Complete Student Registration'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Promote Student(s) Modal */}
        {promoteTargets.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs">
            <div className="bg-white rounded-[10px] max-w-md w-full p-6 shadow-2xl border border-[#E6DFD3] space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#EFE9DF]">
                <div>
                  <h3 className="font-semibold text-base text-[#2A2A2E]">
                    Promote {promoteTargets.length}{' '}
                    {promoteTargets.length === 1 ? 'Student' : 'Students'}
                  </h3>
                  <p className="text-xs text-[#6E6A63]">
                    Move student record(s) to the next academic class arm
                  </p>
                </div>
                <button
                  onClick={() => setPromoteTargets([])}
                  className="p-1 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleConfirmPromote} className="space-y-4 text-xs">
                <div className="bg-[#FAF8F4] rounded-[8px] p-3 border border-[#E6DFD3] max-h-36 overflow-y-auto space-y-1.5">
                  {promoteTargets.map((s) => (
                    <div key={s.id} className="flex items-center justify-between">
                      <span className="font-semibold text-[#2A2A2E]">{s.fullName}</span>
                      <span className="text-[11px] font-mono text-[#6E6A63]">
                        {s.className} ({s.admissionNo})
                      </span>
                    </div>
                  ))}
                </div>

                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">
                    Select Destination Class *
                  </label>
                  <select
                    value={targetClassName}
                    onChange={(e) => setTargetClassName(e.target.value)}
                    className="w-full px-3 py-2.5 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                  >
                    {groupClassesBySection(activeClassesList.length > 0 ? activeClassesList : classesList).map((g) => (
                      <optgroup key={g.section} label={g.label}>
                        {g.classes.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name} ({c.arm})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setPromoteTargets([])}
                    className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium transition-colors duration-150"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPromoting}
                    className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium transition-colors duration-150 disabled:opacity-50"
                  >
                    {isPromoting ? 'Promoting...' : 'Confirm Promotion'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Student Confirmation Modal (Director Only) */}
        {isDirector && deleteTargets.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs">
            <div className="bg-white rounded-[10px] max-w-md w-full p-6 shadow-2xl border border-[#E6DFD3] space-y-4">
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#EFE9DF]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-[10px] bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] flex items-center justify-center shrink-0">
                    <Trash2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-[#2A2A2E]">
                      {deleteTargets.length === 1
                        ? 'Delete Student'
                        : `Delete ${deleteTargets.length} Selected Students`}
                    </h3>
                    <p className="text-xs text-[#6E6A63]">Permanent record removal</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setDeleteTargets([])}
                  className="p-1 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] disabled:opacity-50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="bg-[#FAF8F4] rounded-[8px] p-3 border border-[#E6DFD3] max-h-40 overflow-y-auto space-y-2">
                  {deleteTargets.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#2A2A2E]">{s.fullName}</span>
                      <span className="text-[11px] font-mono font-medium text-[#5E5B56] bg-white px-2 py-0.5 rounded-[6px] border border-[#DDD5C7]">
                        {s.admissionNo}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="p-3 rounded-[8px] bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] space-y-1">
                  <p className="font-semibold">
                    {deleteTargets.length === 1
                      ? 'This will permanently remove this student. This cannot be undone.'
                      : `This will permanently remove these ${deleteTargets.length} students. This cannot be undone.`}
                  </p>
                  <p className="text-[11px] opacity-90">
                    All linked attendance, academic marks, result reviews, and fee records for{' '}
                    {deleteTargets.length === 1 ? 'this student' : 'these students'} will also be
                    removed.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 text-xs">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setDeleteTargets([])}
                  className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium disabled:opacity-50 transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleConfirmDelete}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#86222E] hover:bg-[#6E1A24] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Printable Student Profile Modal */}
      {selectedStudent && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleRequestCloseProfile();
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#2A2A2E]/60 backdrop-blur-xs print-only-container"
          role="dialog"
          aria-modal="true"
          aria-label="Student Academic & Admission Profile"
        >
          <div className="bg-white rounded-[10px] max-w-2xl w-full shadow-2xl border border-[#E6DFD3] flex flex-col max-h-[92vh] overflow-hidden print-only-card">
            {/* Sticky Modal Screen Header */}
            <div className="sticky top-0 z-10 shrink-0 flex items-center justify-between gap-2 px-4 sm:px-6 py-3 bg-[#FAF8F4] border-b border-[#E6DFD3] no-print">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#5E5B56] truncate">
                Official Student Dossier
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-xs transition-colors duration-150"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Profile
                </button>
                {canManageStudents && (
                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(selectedStudent)}
                    className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium text-xs transition-colors duration-150"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleRequestCloseProfile}
                  aria-label="Close"
                  title="Close"
                  className="w-10 h-10 min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-full text-[#5E5B56] hover:text-[#2A2A2E] hover:bg-[#EFE9DF] active:bg-[#E6DFD3] transition-colors duration-150"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Printable Content */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-8 space-y-6">
              {/* School Letterhead (visible cleanly in print and modal) */}
              <div className="flex items-center justify-between gap-4 border-b-2 border-[#6B1020] pb-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <SchoolLogo
                    logoDataUrl={schoolSettings.logoDataUrl}
                    schoolName={schoolSettings.schoolName}
                    size="lg"
                    variant="print"
                  />
                  <div className="min-w-0">
                    <h2 className="font-serif text-lg font-semibold text-[#6B1020] tracking-tight">
                      {schoolSettings.schoolName}
                    </h2>
                    <p className="text-[11px] text-[#6E6A63]">
                      {schoolSettings.address} • {schoolSettings.phone}
                    </p>
                    <p className="text-[10px] font-medium text-[#7D5A18] uppercase tracking-wider mt-0.5">
                      Student Academic & Admission Profile — {schoolSettings.currentSession}
                    </p>
                  </div>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium border shrink-0 ${getStatusBadgeClasses(
                    selectedStudent.status
                  )}`}
                >
                  {selectedStudent.status}
                </span>
              </div>

              {/* Identity + Passport Photo */}
              <div className="flex flex-col sm:flex-row gap-5 items-start sm:items-center">
                {selectedStudent.passportPhoto ? (
                  <img
                    src={selectedStudent.passportPhoto}
                    alt={selectedStudent.fullName}
                    className="w-24 h-28 rounded-[10px] object-cover border border-[#E6DFD3] shrink-0"
                  />
                ) : (
                  <div className="w-24 h-28 rounded-[10px] bg-[#6B1020] text-white flex flex-col items-center justify-center font-semibold text-2xl shrink-0">
                    {selectedStudent.firstName?.charAt(0) || selectedStudent.fullName.charAt(0)}
                    {selectedStudent.surname?.charAt(0) || ''}
                  </div>
                )}

                <div className="space-y-1.5 flex-1">
                  <h3 className="text-xl font-semibold text-[#2A2A2E]">{selectedStudent.fullName}</h3>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="font-mono font-semibold bg-[#FAF8F4] text-[#2A2A2E] px-2.5 py-0.5 rounded-[6px] border border-[#E6DFD3]">
                      ADM NO: {selectedStudent.admissionNo}
                    </span>
                    <span className="font-medium bg-[#FAF0F2] text-[#6B1020] px-2.5 py-0.5 rounded-[6px] border border-[#DFC7CA]">
                      CLASS: {selectedStudent.className}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 text-xs text-[#5E5B56]">
                    <div>
                      <span className="text-[#7F7A72] block text-[10px] uppercase font-semibold">
                        Gender
                      </span>
                      <span className="font-medium text-[#2A2A2E]">{selectedStudent.gender}</span>
                    </div>
                    <div>
                      <span className="text-[#7F7A72] block text-[10px] uppercase font-semibold">
                        Date of Birth
                      </span>
                      <span className="font-medium text-[#2A2A2E]">
                        {selectedStudent.dateOfBirth}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#7F7A72] block text-[10px] uppercase font-semibold">
                        Admission Date
                      </span>
                      <span className="font-medium text-[#2A2A2E]">
                        {selectedStudent.admissionDate}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Biodata & Guardian Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="bg-[#FAF8F4] p-4 rounded-[10px] border border-[#E6DFD3] space-y-2.5">
                  <h4 className="font-semibold uppercase tracking-wider text-[#5E5B56] text-[10px]">
                    Student Biodata
                  </h4>
                  <div className="flex justify-between">
                    <span className="text-[#6E6A63]">First Name:</span>
                    <strong className="text-[#2A2A2E]">{selectedStudent.firstName}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6E6A63]">Middle Name:</span>
                    <strong className="text-[#2A2A2E]">
                      {selectedStudent.middleName || '—'}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6E6A63]">Surname:</span>
                    <strong className="text-[#2A2A2E]">{selectedStudent.surname}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6E6A63]">State of Origin:</span>
                    <strong className="text-[#2A2A2E]">{selectedStudent.stateOfOrigin}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6E6A63]">Term Fee Status:</span>
                    <strong
                      className={
                        selectedStudent.feeStatus === 'Paid'
                          ? 'text-[#2A583B]'
                          : selectedStudent.feeStatus === 'Partial'
                          ? 'text-[#7D5A18]'
                          : 'text-[#86222E]'
                      }
                    >
                      {selectedStudent.feeStatus}
                    </strong>
                  </div>
                </div>

                <div className="bg-[#FAF8F4] p-4 rounded-[10px] border border-[#E6DFD3] space-y-2.5">
                  <h4 className="font-semibold uppercase tracking-wider text-[#5E5B56] text-[10px]">
                    Parent / Guardian Contact
                  </h4>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#6E6A63]">Guardian:</span>
                    <strong className="text-[#2A2A2E] text-right">
                      {selectedStudent.guardianName}
                    </strong>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#6E6A63] inline-flex items-center gap-1">
                      <Phone className="w-3 h-3" /> Phone:
                    </span>
                    <strong className="text-[#2A2A2E]">{selectedStudent.guardianPhone}</strong>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#6E6A63] inline-flex items-center gap-1">
                      <Mail className="w-3 h-3" /> Email:
                    </span>
                    <strong className="text-[#2A2A2E] break-all text-right">
                      {selectedStudent.guardianEmail}
                    </strong>
                  </div>
                  <div className="pt-1">
                    <span className="text-[#6E6A63] inline-flex items-center gap-1 block mb-0.5">
                      <MapPin className="w-3 h-3" /> Residential Address:
                    </span>
                    <strong className="text-[#2A2A2E] leading-relaxed block">
                      {selectedStudent.address}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Status Management & Promotion Quick Actions (Hidden on print) */}
              {canManageStudents && (
                <div className="bg-[#FAF0F2]/50 border border-[#DFC7CA] rounded-[10px] p-4 space-y-3 no-print">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#6B1020]">
                      Administrative Status & Class Promotion
                    </span>
                    <button
                      onClick={() => handleOpenPromoteModal([selectedStudent])}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] bg-[#FBF5E8] hover:bg-[#F4E9D0] border border-[#E3CFA6] text-[#7D5A18] text-xs font-medium transition-colors duration-150"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      Promote to Another Class
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-[#5E5B56] font-medium mr-1">Mark Student As:</span>
                    <button
                      onClick={() => handleStatusChange(selectedStudent, 'Active')}
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-[8px] font-medium border transition-colors duration-150 ${
                        selectedStudent.status === 'Active'
                          ? 'bg-[#2A583B] text-white border-[#2A583B]'
                          : 'bg-white text-[#2A2A2E] border-[#DDD5C7] hover:bg-[#EEF4F0]'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Active
                    </button>
                    <button
                      onClick={() => handleStatusChange(selectedStudent, 'Graduated')}
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-[8px] font-medium border transition-colors duration-150 ${
                        selectedStudent.status === 'Graduated'
                          ? 'bg-[#6B1020] text-white border-[#6B1020]'
                          : 'bg-white text-[#2A2A2E] border-[#DDD5C7] hover:bg-[#FAF0F2]'
                      }`}
                    >
                      <GraduationCap className="w-3.5 h-3.5" />
                      Graduated
                    </button>
                    <button
                      onClick={() => handleStatusChange(selectedStudent, 'Withdrawn')}
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-[8px] font-medium border transition-colors duration-150 ${
                        selectedStudent.status === 'Withdrawn'
                          ? 'bg-[#86222E] text-white border-[#86222E]'
                          : 'bg-white text-[#2A2A2E] border-[#DDD5C7] hover:bg-[#FAF0F2]'
                      }`}
                    >
                      <UserX className="w-3.5 h-3.5" />
                      Withdrawn
                    </button>
                  </div>
                </div>
              )}

              {/* Bottom Action Bar (Hidden on print) */}
              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-4 border-t border-[#EFE9DF] no-print">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-xs transition-colors duration-150"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Profile
                </button>
                {canManageStudents && (
                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(selectedStudent)}
                    className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium text-xs transition-colors duration-150"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleRequestCloseProfile}
                  className="inline-flex items-center justify-center min-h-[40px] px-5 py-2 rounded-[8px] bg-[#FAF8F4] hover:bg-[#EFE9DF] border border-[#DDD5C7] text-[#2A2A2E] font-medium text-xs transition-colors duration-150"
                >
                  Close
                </button>
              </div>

              {/* Official Print Footer */}
              <div className="hidden print:grid grid-cols-2 gap-8 pt-10 text-xs text-[#5E5B56]">
                <div className="border-t border-[#5E5B56] pt-2">
                  <p className="font-semibold text-[#2A2A2E]">{schoolSettings.principalName}</p>
                  <p>Principal Signature & Date</p>
                </div>
                <div className="border-t border-[#5E5B56] pt-2 text-right">
                  <p className="font-semibold text-[#2A2A2E]">School Registrar / Stamp</p>
                  <p>Generated via SchoolDesk</p>
                </div>
              </div>
            </div>
          </div>

          {/* Unsaved Changes Confirmation Dialog */}
          {showCloseProfileConfirm && (
            <div
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowCloseProfileConfirm(false);
              }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs no-print"
            >
              <div className="bg-white rounded-[10px] max-w-sm w-full p-5 shadow-2xl border border-[#E6DFD3] space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6] text-[#7D5A18] flex items-center justify-center shrink-0">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#2A2A2E]">
                      Discard unsaved changes?
                    </h3>
                    <p className="text-xs text-[#6E6A63] mt-1">
                      You have pending changes or an open update in this student profile. Closing now will discard them and return to the student list.
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EFE9DF]">
                  <button
                    type="button"
                    onClick={() => setShowCloseProfileConfirm(false)}
                    className="min-h-[40px] px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] text-xs font-medium transition-colors duration-150"
                  >
                    Keep Editing
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsFormModalOpen(false);
                      setPromoteTargets([]);
                      handleCloseProfileImmediately();
                    }}
                    className="min-h-[40px] px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150"
                  >
                    Close Profile
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};
