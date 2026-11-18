import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  UserPlus,
  Mail,
  Phone,
  BookOpen,
  School,
  Award,
  X,
  Pencil,
  Eye,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Database,
  MapPin,
  Calendar,
  UserX,
  UserCheck,
  RefreshCw,
  Plus,
  Printer,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SchoolClass, Teacher } from '../types';
import {
  NIGERIAN_SUBJECTS_LIST,
  SAMPLE_CLASSES,
} from '../data/sampleData';
import { subscribeClasses } from '../services/academicService';
import {
  getActiveClasses,
  getGroupedSubjectsBySection,
  groupClassesBySection,
} from '../utils/classUtils';
import {
  deleteTeacherFromFirestore,
  extractFriendlyError,
  generateUniqueStaffId,
  saveTeacherToFirestore,
  seedSampleTeachersToFirestore,
  subscribeTeachers,
  updateTeacherStatusInFirestore,
} from '../services/schoolService';
import { SchoolLogo } from '../components/common/SchoolLogo';
import { FormDialog } from '../components/common/FormDialog';

type TeacherFormState = {
  id?: string;
  staffId: string;
  fullName: string;
  gender: 'Male' | 'Female';
  phone: string;
  email: string;
  address: string;
  qualifications: string;
  subjects: string[];
  assignedClasses: string[];
  roleType: 'Head of Department' | 'Form Teacher' | 'Subject Teacher' | 'Vice Principal';
  employmentDate: string;
  employmentStatus: 'Active' | 'On Leave' | 'Deactivated';
  createdAt?: string;
};

export const TeachersPage: React.FC = () => {
  const { role, firebaseUser, schoolSettings } = useAuth();
  const isLiveFirestore = Boolean(firebaseUser);
  const isDirector = role === 'director';
  const canEditOrAssign = role === 'director' || role === 'principal';

  const [classesList, setClassesList] = useState<SchoolClass[]>(SAMPLE_CLASSES);
  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(isLiveFirestore);
  const [dataError, setDataError] = useState<string>('');
  const [bannerSuccess, setBannerSuccess] = useState<string>('');
  const [isSeeding, setIsSeeding] = useState(false);

  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('All');

  // Modals
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [assigningTeacher, setAssigningTeacher] = useState<Teacher | null>(null);
  const [assignSubjects, setAssignSubjects] = useState<string[]>([]);
  const [assignClasses, setAssignClasses] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [customSubjectInput, setCustomSubjectInput] = useState('');
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const buildEmptyForm = (existing: Teacher[]): TeacherFormState => ({
    staffId: generateUniqueStaffId(existing),
    fullName: '',
    gender: 'Male',
    phone: '+234 ',
    email: '',
    address: '',
    qualifications: '',
    subjects: [],
    assignedClasses: [],
    roleType: 'Subject Teacher',
    employmentDate: new Date().toISOString().split('T')[0],
    employmentStatus: 'Active',
  });

  const [formState, setFormState] = useState<TeacherFormState>(() => buildEmptyForm([]));

  // Sync from Cloud Firestore when authenticated
  useEffect(() => {
    if (!firebaseUser) {
      setTeachersList([]);
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
    const unsub = subscribeTeachers(
      (liveTeachers) => {
        setTeachersList(liveTeachers);
        setIsLoadingData(false);
        setSelectedTeacher((prev) =>
          prev ? liveTeachers.find((t) => t.id === prev.id) || null : null
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
  }, [firebaseUser]);

  useEffect(() => {
    if (!bannerSuccess) return;
    const t = setTimeout(() => setBannerSuccess(''), 5000);
    return () => clearTimeout(t);
  }, [bannerSuccess]);

  const filteredTeachers = useMemo(() => {
    return teachersList.filter((t) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        t.fullName.toLowerCase().includes(q) ||
        t.staffId.toLowerCase().includes(q) ||
        t.email.toLowerCase().includes(q) ||
        t.qualifications.toLowerCase().includes(q) ||
        t.subjects.some((s) => s.toLowerCase().includes(q));

      const matchesRole = selectedRole === 'All' || t.roleType === selectedRole;
      const matchesStatus = selectedStatus === 'All' || t.employmentStatus === selectedStatus;
      const matchesClass =
        selectedClassFilter === 'All' || t.assignedClasses.includes(selectedClassFilter);

      return matchesSearch && matchesRole && matchesStatus && matchesClass;
    });
  }, [teachersList, searchQuery, selectedRole, selectedStatus, selectedClassFilter]);

  const allSchoolSubjects = useMemo(() => {
    const classSubjects = getGroupedSubjectsBySection(classesList).flatMap((g) => g.subjects);
    return Array.from(new Set([...classSubjects, ...NIGERIAN_SUBJECTS_LIST]));
  }, [classesList]);

  const handleOpenAddModal = () => {
    if (!isDirector) return;
    setIsEditMode(false);
    setFormError('');
    setCustomSubjectInput('');
    setFormState(buildEmptyForm(teachersList));
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (teacher: Teacher) => {
    if (!canEditOrAssign) return;
    setIsEditMode(true);
    setFormError('');
    setCustomSubjectInput('');
    setFormState({
      id: teacher.id,
      staffId: teacher.staffId,
      fullName: teacher.fullName,
      gender: teacher.gender,
      phone: teacher.phone,
      email: teacher.email,
      address: teacher.address || '',
      qualifications: teacher.qualifications,
      subjects: [...teacher.subjects],
      assignedClasses: [...teacher.assignedClasses],
      roleType: teacher.roleType,
      employmentDate: teacher.employmentDate,
      employmentStatus: teacher.employmentStatus,
      createdAt: teacher.createdAt,
    });
    setIsFormModalOpen(true);
  };

  const toggleFormSubject = (subject: string) => {
    setFormState((prev) => ({
      ...prev,
      subjects: prev.subjects.includes(subject)
        ? prev.subjects.filter((s) => s !== subject)
        : [...prev.subjects, subject],
    }));
  };

  const toggleFormClass = (className: string) => {
    setFormState((prev) => ({
      ...prev,
      assignedClasses: prev.assignedClasses.includes(className)
        ? prev.assignedClasses.filter((c) => c !== className)
        : [...prev.assignedClasses, className],
    }));
  };

  const handleAddCustomSubject = () => {
    const val = customSubjectInput.trim();
    if (!val) return;
    if (!formState.subjects.includes(val)) {
      setFormState((prev) => ({ ...prev, subjects: [...prev.subjects, val] }));
    }
    setCustomSubjectInput('');
  };

  // Validate & Save Teacher
  const handleSaveTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditMode && !canEditOrAssign) {
      setFormError('Unauthorized: You do not have permission to edit teacher records.');
      return;
    }
    if (!isEditMode && !isDirector) {
      setFormError('Unauthorized: Only the School Director can register new faculty members.');
      return;
    }

    setFormError('');
    const trimmedStaffId = formState.staffId.trim().toUpperCase();
    const trimmedName = formState.fullName.trim();
    const trimmedPhone = formState.phone.trim();
    const trimmedEmail = formState.email.trim();
    const trimmedAddress = formState.address.trim();
    const trimmedQual = formState.qualifications.trim();

    if (!trimmedStaffId) {
      setFormError('Staff ID is required.');
      return;
    }
    if (!trimmedName) {
      setFormError('Full name is required.');
      return;
    }
    if (!trimmedPhone || trimmedPhone === '+234') {
      setFormError('Phone number is required.');
      return;
    }
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError('Please provide a valid official email address.');
      return;
    }
    if (!trimmedAddress) {
      setFormError('Residential address is required.');
      return;
    }
    if (!trimmedQual) {
      setFormError('Academic qualifications / certifications are required.');
      return;
    }
    if (!formState.employmentDate) {
      setFormError('Employment date is required.');
      return;
    }

    // Local duplicate Staff ID check
    const localDuplicate = teachersList.some(
      (t) =>
        t.staffId.trim().toUpperCase() === trimmedStaffId &&
        (!isEditMode || t.id !== formState.id)
    );
    if (localDuplicate) {
      setFormError(
        `Duplicate Staff ID: "${trimmedStaffId}" is already assigned to another faculty member.`
      );
      return;
    }

    setIsSaving(true);
    try {
      if (isLiveFirestore) {
        const saved = await saveTeacherToFirestore(
          {
            id: formState.id,
            staffId: trimmedStaffId,
            fullName: trimmedName,
            gender: formState.gender,
            phone: trimmedPhone,
            email: trimmedEmail,
            address: trimmedAddress,
            qualifications: trimmedQual,
            subjects: formState.subjects,
            assignedClasses: formState.assignedClasses,
            roleType: formState.roleType,
            employmentDate: formState.employmentDate,
            employmentStatus: formState.employmentStatus,
            createdAt: formState.createdAt,
          },
          isEditMode
        );
        if (selectedTeacher?.id === saved.id) setSelectedTeacher(saved);
        setBannerSuccess(
          isEditMode
            ? `Updated faculty record for ${saved.fullName} (${saved.staffId}) in Cloud Firestore.`
            : `Registered ${saved.fullName} (${saved.staffId}) in Cloud Firestore.`
        );
      } else {
        throw new Error('Authentication required to save faculty records.');
      }
      setIsFormModalOpen(false);
    } catch (err) {
      setFormError(extractFriendlyError(err, 'Failed to save faculty record.'));
    } finally {
      setIsSaving(false);
    }
  };

  // Dedicated Assign Subjects & Classes modal
  const handleOpenAssignModal = (teacher: Teacher) => {
    if (!canEditOrAssign) return;
    setAssigningTeacher(teacher);
    setAssignSubjects([...teacher.subjects]);
    setAssignClasses([...teacher.assignedClasses]);
  };

  const handleSaveAssignments = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningTeacher || !canEditOrAssign) return;
    setIsSaving(true);
    setDataError('');
    try {
      if (isLiveFirestore) {
        const updated = await saveTeacherToFirestore(
          {
            ...assigningTeacher,
            subjects: assignSubjects,
            assignedClasses: assignClasses,
          },
          true
        );
        if (selectedTeacher?.id === updated.id) setSelectedTeacher(updated);
        setBannerSuccess(
          `Updated subjects & class assignments for ${updated.fullName} in Cloud Firestore.`
        );
      } else {
        throw new Error('Authentication required to update teacher assignments.');
      }
      setAssigningTeacher(null);
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to update teacher assignments.'));
    } finally {
      setIsSaving(false);
    }
  };

  // Deactivate / Reactivate Teacher (Director Only)
  const handleToggleTeacherStatus = async (
    teacher: Teacher,
    newStatus: 'Active' | 'On Leave' | 'Deactivated'
  ) => {
    if (!isDirector || teacher.employmentStatus === newStatus) return;
    setDataError('');
    try {
      if (isLiveFirestore) {
        await updateTeacherStatusInFirestore(teacher.id, newStatus);
        setBannerSuccess(
          `${teacher.fullName} (${teacher.staffId}) status changed to ${newStatus} in Cloud Firestore.`
        );
      } else {
        throw new Error('Authentication required to update teacher status.');
      }
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to update teacher employment status.'));
    }
  };

  // Delete Teacher (Director Only)
  const handleOpenDeleteModal = (teacher: Teacher) => {
    if (!isDirector) return;
    setDeleteTarget(teacher);
  };

  const handleConfirmDelete = async () => {
    if (!isDirector || !deleteTarget) return;
    const target = deleteTarget;
    setIsDeleting(true);
    setDataError('');
    try {
      if (!isLiveFirestore) {
        throw new Error('Authentication required to delete teacher records.');
      }

      await deleteTeacherFromFirestore(target, firebaseUser?.uid);

      // Remove deleted teacher card from list immediately
      setTeachersList((prev) => prev.filter((t) => t.id !== target.id));
      setSelectedTeacher((prev) => (prev?.id === target.id ? null : prev));
      setAssigningTeacher((prev) => (prev?.id === target.id ? null : prev));
      setDeleteTarget(null);

      setBannerSuccess(
        `Deleted ${target.fullName} (${target.staffId}) from Cloud Firestore.`
      );
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to delete teacher record.'));
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSeedSampleTeachers = async () => {
    if (!isLiveFirestore || !isDirector) return;
    setIsSeeding(true);
    setDataError('');
    try {
      await seedSampleTeachersToFirestore();
      setBannerSuccess('Sample Nigerian faculty records seeded to Cloud Firestore.');
    } catch (err) {
      setDataError(extractFriendlyError(err, 'Failed to seed sample teachers.'));
    } finally {
      setIsSeeding(false);
    }
  };

  const getEmploymentBadge = (status: Teacher['employmentStatus']) => {
    switch (status) {
      case 'Active':
        return 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]';
      case 'On Leave':
        return 'bg-[#FBF5E8] text-[#7D5A18] border-[#E3CFA6]';
      case 'Deactivated':
        return 'bg-[#FAF0F2] text-[#86222E] border-[#E2C1C5]';
      default:
        return 'bg-[#FAF8F4] text-[#5E5B56] border-[#E6DFD3]';
    }
  };

  return (
    <>
      <div className={selectedTeacher ? 'space-y-5 no-print' : 'space-y-5'}>
        {/* Data Source Indicator Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB] text-xs text-[#2A583B]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#2A583B] shrink-0" />
            <span>
              <strong>Live Cloud Firestore Connected:</strong> Faculty records, subject
              allocations, class assignments, and employment statuses sync live with Firestore.
            </span>
          </div>
          {isDirector && teachersList.length === 0 && !isLoadingData && (
            <button
              onClick={handleSeedSampleTeachers}
              disabled={isSeeding}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-[8px] bg-[#2A583B] hover:bg-[#20452E] text-white font-medium text-[11px] transition-colors duration-150 disabled:opacity-50"
            >
              <Database className="w-3.5 h-3.5" />
              {isSeeding ? 'Seeding...' : 'Load Sample Teachers to Firestore'}
            </button>
          )}
        </div>

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#2A2A2E] tracking-tight">
                Teacher & Faculty Management
              </h1>
              <span className="bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6] text-xs font-medium px-2.5 py-0.5 rounded-full tabular-nums">
                {filteredTeachers.length} Teaching Staff
              </span>
            </div>
            <p className="text-xs text-[#6E6A63] mt-1">
              TRCN-certified instructors, staff IDs, subject allocations, assigned classes &
              employment records
            </p>
          </div>

          {isDirector && (
            <button
              onClick={handleOpenAddModal}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150"
            >
              <UserPlus className="w-4 h-4" />
              Register New Teacher
            </button>
          )}
        </div>

        {/* Feedback Banners */}
        {bannerSuccess && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 rounded-[10px] bg-[#EEF4F0] border border-[#C5D6CB] text-[#2A583B] text-xs font-medium">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#2A583B] shrink-0" />
              <span>{bannerSuccess}</span>
            </div>
            <button
              onClick={() => setBannerSuccess('')}
              className="text-[#2A583B] hover:opacity-75 transition-opacity"
            >
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

        {/* Search & Filters */}
        <div className="bg-white p-4 rounded-[10px] border border-[#E6DFD3] shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-5 relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#7F7A72]" />
              <input
                type="text"
                placeholder="Search by name, Staff ID (TR-2026-001), subject, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] text-[#2A2A2E] transition-colors duration-150"
              />
            </div>

            <div className="lg:col-span-3">
              <select
                value={selectedClassFilter}
                onChange={(e) => setSelectedClassFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] text-[#2A2A2E] transition-colors duration-150"
              >
                <option value="All">All Assigned Classes (Creche – SS 3)</option>
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

            <div className="lg:col-span-2">
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] text-[#2A2A2E] transition-colors duration-150"
              >
                <option value="All">All Designations</option>
                <option value="Head of Department">HOD</option>
                <option value="Form Teacher">Form Teacher</option>
                <option value="Subject Teacher">Subject Teacher</option>
                <option value="Vice Principal">Vice Principal</option>
              </select>
            </div>

            <div className="lg:col-span-2">
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-[#DDD5C7] rounded-[8px] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none bg-[#FAF8F4] text-[#2A2A2E] transition-colors duration-150"
              >
                <option value="All">All Statuses</option>
                <option value="Active">Active</option>
                <option value="On Leave">On Leave</option>
                <option value="Deactivated">Deactivated</option>
              </select>
            </div>
          </div>
        </div>

        {/* Teachers Grid */}
        {isLoadingData ? (
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-12 text-center text-xs text-[#7F7A72]">
            Synchronizing faculty directory from Cloud Firestore...
          </div>
        ) : filteredTeachers.length === 0 ? (
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-12 text-center space-y-2">
            <School className="w-8 h-8 mx-auto text-[#DDD5C7]" />
            <p className="text-xs font-medium text-[#5E5B56]">
              {teachersList.length === 0 && isLiveFirestore
                ? 'No faculty members registered in Cloud Firestore yet.'
                : 'No teachers match your search or filter criteria.'}
            </p>
            {isDirector && teachersList.length === 0 && isLiveFirestore && (
              <div className="pt-2 flex items-center justify-center gap-2">
                <button
                  onClick={handleOpenAddModal}
                  className="px-3 py-1.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-xs transition-colors duration-150"
                >
                  Register First Teacher
                </button>
                <button
                  onClick={handleSeedSampleTeachers}
                  disabled={isSeeding}
                  className="px-3 py-1.5 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium text-xs transition-colors duration-150"
                >
                  {isSeeding ? 'Loading...' : 'Seed Sample Teachers'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredTeachers.map((teacher) => (
              <div
                key={teacher.id}
                className={`bg-white rounded-[10px] border p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] transition-colors duration-150 flex flex-col justify-between ${
                  teacher.employmentStatus === 'Deactivated'
                    ? 'border-[#E2C1C5] bg-[#FAF0F2]/25 opacity-90'
                    : 'border-[#E6DFD3] hover:border-[#B8913A]/70'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-[10px] bg-[#6B1020] text-white font-semibold text-base flex items-center justify-center shrink-0">
                        {teacher.fullName.replace(/^(Mr\.|Mrs\.|Dr\.|Ms\.)\s*/i, '').charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm text-[#2A2A2E] leading-tight">
                          {teacher.fullName}
                        </h3>
                        <span className="text-[11px] font-mono font-medium text-[#6E6A63] block mt-0.5">
                          {teacher.staffId}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${getEmploymentBadge(
                          teacher.employmentStatus
                        )}`}
                      >
                        {teacher.employmentStatus}
                      </span>
                      <span className="text-[10px] font-medium text-[#6B1020] bg-[#FAF0F2] border border-[#DFC7CA] px-2 py-0.5 rounded-full">
                        {teacher.roleType}
                      </span>
                    </div>
                  </div>

                  {/* Qualifications */}
                  <div className="bg-[#FAF8F4] p-2.5 rounded-[8px] border border-[#E6DFD3] text-xs mb-3">
                    <div className="flex items-center gap-1.5 text-[#6E6A63] mb-0.5 text-[10px] uppercase font-semibold tracking-wider">
                      <Award className="w-3 h-3 text-[#B8913A]" />
                      Qualifications
                    </div>
                    <p className="text-[#2A2A2E] font-medium leading-relaxed line-clamp-2">
                      {teacher.qualifications}
                    </p>
                  </div>

                  {/* Subjects & Classes */}
                  <div className="space-y-2.5 text-xs">
                    <div>
                      <span className="text-[11px] font-medium text-[#7F7A72] block mb-1">
                        Subjects ({teacher.subjects.length}):
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {teacher.subjects.length === 0 ? (
                          <span className="text-[11px] text-[#7F7A72] italic">No subjects assigned</span>
                        ) : (
                          teacher.subjects.map((sub, i) => (
                            <span
                              key={i}
                              className={`px-2 py-0.5 rounded-[6px] text-[11px] font-medium border ${
                                i === 0
                                  ? 'bg-[#6B1020] text-white border-[#6B1020]'
                                  : 'bg-[#FAF0F2] text-[#6B1020] border-[#DFC7CA]'
                              }`}
                            >
                              {sub}
                              {i === 0 && (
                                <span className="ml-1 text-[9px] uppercase tracking-wide text-[#F3D999] font-semibold">
                                  (Primary)
                                </span>
                              )}
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    <div>
                      <span className="text-[11px] font-medium text-[#7F7A72] block mb-1">
                        Assigned Classes ({teacher.assignedClasses.length}):
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {teacher.assignedClasses.length === 0 ? (
                          <span className="text-[11px] text-[#7F7A72] italic">No classes assigned</span>
                        ) : (
                          teacher.assignedClasses.map((cls, i) => (
                            <span
                              key={i}
                              className="bg-[#FAF8F4] text-[#5E5B56] border border-[#E6DFD3] px-2 py-0.5 rounded-[6px] text-[11px]"
                            >
                              {cls}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action Footer */}
                <div className="pt-4 mt-4 border-t border-[#EFE9DF] space-y-2.5">
                  <div className="flex items-center justify-between text-[11px] text-[#6E6A63]">
                    <span className="truncate max-w-[175px]">{teacher.email}</span>
                    <span className="font-mono text-[#5E5B56]">{teacher.phone}</span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <button
                      onClick={() => setSelectedTeacher(teacher)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] bg-[#FAF0F2] hover:bg-[#F3E2E5] border border-[#DFC7CA] text-[#6B1020] font-medium text-[11px] transition-colors duration-150"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View Profile
                    </button>

                    {canEditOrAssign && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenAssignModal(teacher)}
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-[8px] bg-[#FBF5E8] hover:bg-[#F4E9D0] border border-[#E3CFA6] text-[#7D5A18] font-medium text-[11px] transition-colors duration-150"
                          title="Assign Subjects & Classes"
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                          Assign
                        </button>
                        <button
                          onClick={() => handleOpenEditModal(teacher)}
                          className="p-1.5 rounded-[8px] text-[#5E5B56] hover:text-[#6B1020] hover:bg-[#FAF8F4] transition-colors duration-150"
                          title="Edit Teacher Record"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {isDirector && (
                          <>
                            <button
                              onClick={() =>
                                handleToggleTeacherStatus(
                                  teacher,
                                  teacher.employmentStatus === 'Deactivated' ? 'Active' : 'Deactivated'
                                )
                              }
                              className={`p-1.5 rounded-[8px] transition-colors duration-150 ${
                                teacher.employmentStatus === 'Deactivated'
                                  ? 'text-[#2A583B] hover:bg-[#EEF4F0]'
                                  : 'text-[#86222E] hover:bg-[#FAF0F2]'
                              }`}
                              title={
                                teacher.employmentStatus === 'Deactivated'
                                  ? 'Reactivate Teacher'
                                  : 'Deactivate Teacher'
                              }
                            >
                              {teacher.employmentStatus === 'Deactivated' ? (
                                <UserCheck className="w-3.5 h-3.5" />
                              ) : (
                                <UserX className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenDeleteModal(teacher)}
                              className="p-1.5 rounded-[8px] text-[#86222E] hover:bg-[#FAF0F2] transition-colors duration-150"
                              title="Delete Teacher"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Register / Edit Teacher Modal */}
        {isFormModalOpen && (
          <FormDialog
            title={isEditMode ? 'Edit Teacher Record' : 'Teacher Registration Form'}
            subtitle={
              isEditMode
                ? `Updating faculty profile for ${formState.staffId}`
                : 'Register teaching staff with Staff ID, credentials, subjects & classes'
            }
            onClose={() => setIsFormModalOpen(false)}
            onSubmit={handleSaveTeacher}
            closeAriaLabel="Close teacher form modal"
            scrollResetKey={formState.id || 'new'}
            footer={
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  className="px-4 py-2 rounded-[8px] bg-white border border-[#DDD5C7] hover:bg-[#FAF8F4] text-[#2A2A2E] font-medium transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium shadow-xs disabled:opacity-50 transition-colors duration-150"
                >
                  {isSaving
                    ? 'Saving...'
                    : isEditMode
                    ? 'Save Changes'
                    : 'Register Teacher'}
                </button>
              </div>
            }
          >
                {formError && (
                  <div className="flex items-start gap-2 p-3 rounded-[8px] bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] text-xs">
                    <AlertCircle className="w-4 h-4 text-[#86222E] shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                {/* Staff ID & Full Name */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">Staff ID *</label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        required
                        placeholder="TR-2026-009"
                        value={formState.staffId}
                        onChange={(e) =>
                          setFormState({ ...formState, staffId: e.target.value.toUpperCase() })
                        }
                        className="flex-1 px-3 py-2 border border-[#DDD5C7] rounded-[8px] font-mono font-semibold text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                      />
                      {!isEditMode && (
                        <button
                          type="button"
                          onClick={() =>
                            setFormState({
                              ...formState,
                              staffId: generateUniqueStaffId(teachersList),
                            })
                          }
                          className="px-2.5 py-2 rounded-[8px] bg-[#FAF8F4] border border-[#DDD5C7] hover:bg-[#EFE9DF] text-[#2A2A2E] transition-colors duration-150"
                          title="Auto-generate Staff ID"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-[#2A2A2E] mb-1">
                      Full Name & Title *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Mr. Kelechi Nwankwo"
                      value={formState.fullName}
                      onChange={(e) => setFormState({ ...formState, fullName: e.target.value })}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Phone, Email, Gender */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">Phone Number *</label>
                    <input
                      type="tel"
                      required
                      placeholder="+234 803 000 0000"
                      value={formState.phone}
                      onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">Official Email *</label>
                    <input
                      type="email"
                      required
                      placeholder="name@crownfieldcollege.edu.ng"
                      value={formState.email}
                      onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">Gender *</label>
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
                </div>

                {/* Address & Qualifications */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">
                      Residential Address *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 14 Admiralty Road, Lekki Phase 1, Lagos"
                      value={formState.address}
                      onChange={(e) => setFormState({ ...formState, address: e.target.value })}
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">
                      Qualifications & Certifications *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. B.Sc (Ed) Physics (UNILAG), TRCN"
                      value={formState.qualifications}
                      onChange={(e) =>
                        setFormState({ ...formState, qualifications: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Designation, Employment Date, Employment Status */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">Designation</label>
                    <select
                      value={formState.roleType}
                      onChange={(e) =>
                        setFormState({ ...formState, roleType: e.target.value as any })
                      }
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    >
                      <option value="Subject Teacher">Subject Teacher</option>
                      <option value="Form Teacher">Form Teacher</option>
                      <option value="Head of Department">Head of Department (HOD)</option>
                      <option value="Vice Principal">Vice Principal</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">
                      Employment Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={formState.employmentDate}
                      onChange={(e) =>
                        setFormState({ ...formState, employmentDate: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-[#2A2A2E] mb-1">
                      Employment Status *
                    </label>
                    <select
                      value={formState.employmentStatus}
                      disabled={!isDirector}
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          employmentStatus: e.target.value as 'Active' | 'On Leave' | 'Deactivated',
                        })
                      }
                      className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] disabled:bg-[#FAF8F4] disabled:text-[#7F7A72] focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020] focus:outline-none"
                    >
                      <option value="Active">Active</option>
                      <option value="On Leave">On Leave</option>
                      <option value="Deactivated">Deactivated</option>
                    </select>
                    {!isDirector && (
                      <span className="text-[10px] text-[#7F7A72]">
                        Only the Director can change employment status.
                      </span>
                    )}
                  </div>
                </div>

                {/* Subjects Multi-select */}
                <div className="pt-3 border-t border-[#EFE9DF] space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <label className="font-semibold text-[#2A2A2E]">
                      Assigned Subjects ({formState.subjects.length} selected)
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        placeholder="Add custom subject..."
                        value={customSubjectInput}
                        onChange={(e) => setCustomSubjectInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCustomSubject();
                          }
                        }}
                        className="px-2.5 py-1 border border-[#DDD5C7] rounded-[8px] text-[11px] text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomSubject}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-[#FAF8F4] border border-[#DDD5C7] hover:bg-[#EFE9DF] text-[#2A2A2E] font-medium text-[11px] transition-colors duration-150"
                      >
                        <Plus className="w-3 h-3" /> Add
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2.5 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3]">
                    {Array.from(new Set([...allSchoolSubjects, ...formState.subjects])).map(
                      (sub) => {
                        const active = formState.subjects.includes(sub);
                        return (
                          <button
                            key={sub}
                            type="button"
                            onClick={() => toggleFormSubject(sub)}
                            className={`px-2.5 py-1 rounded-[6px] text-[11px] font-medium border transition-colors duration-150 ${
                              active
                                ? 'bg-[#6B1020] text-white border-[#6B1020]'
                                : 'bg-white text-[#2A2A2E] border-[#DDD5C7] hover:border-[#6B1020]'
                            }`}
                          >
                            {sub}
                          </button>
                        );
                      }
                    )}
                  </div>
                </div>

                {/* Assigned Classes Multi-select */}
                <div className="space-y-2">
                  <label className="block font-semibold text-[#2A2A2E]">
                    Assigned Classes ({formState.assignedClasses.length} selected)
                  </label>
                  <div className="space-y-3 p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] max-h-56 overflow-y-auto">
                    {groupClassesBySection(getActiveClasses(classesList)).map((group) => (
                      <div key={group.section} className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                          {group.label}
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          {group.classes.map((cls) => {
                            const active = formState.assignedClasses.includes(cls.name);
                            return (
                              <button
                                key={cls.id}
                                type="button"
                                onClick={() => toggleFormClass(cls.name)}
                                className={`px-2.5 py-1.5 rounded-[6px] text-[11px] font-medium border text-left transition-colors duration-150 ${
                                  active
                                    ? 'bg-[#B8913A] text-white border-[#B8913A] font-semibold'
                                    : 'bg-white text-[#2A2A2E] border-[#DDD5C7] hover:border-[#B8913A]'
                                }`}
                              >
                                {cls.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

          </FormDialog>
        )}

        {/* Dedicated Assign Subjects & Classes Modal */}
        {assigningTeacher && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs">
            <div className="bg-white rounded-[10px] max-w-xl w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#EFE9DF]">
                <div>
                  <h3 className="font-semibold text-base text-[#2A2A2E]">
                    Assign Subjects & Classes
                  </h3>
                  <p className="text-xs text-[#6E6A63] mt-0.5">
                    {assigningTeacher.fullName} ({assigningTeacher.staffId})
                  </p>
                </div>
                <button
                  onClick={() => setAssigningTeacher(null)}
                  className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors duration-150"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveAssignments} className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-[#2A2A2E] mb-1.5">
                    Subjects Taught ({assignSubjects.length} selected)
                  </label>
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3]">
                    {Array.from(new Set([...allSchoolSubjects, ...assignSubjects])).map(
                      (sub) => {
                        const active = assignSubjects.includes(sub);
                        return (
                          <button
                            key={sub}
                            type="button"
                            onClick={() =>
                              setAssignSubjects((prev) =>
                                prev.includes(sub)
                                  ? prev.filter((s) => s !== sub)
                                  : [...prev, sub]
                              )
                            }
                            className={`px-2.5 py-1 rounded-[6px] text-[11px] font-medium border transition-colors duration-150 ${
                              active
                                ? 'bg-[#6B1020] text-white border-[#6B1020]'
                                : 'bg-white text-[#2A2A2E] border-[#DDD5C7] hover:border-[#6B1020]'
                            }`}
                          >
                            {sub}
                          </button>
                        );
                      }
                    )}
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-[#2A2A2E] mb-1.5">
                    Assigned Classes ({assignClasses.length} selected)
                  </label>
                  <div className="space-y-3 p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] max-h-56 overflow-y-auto">
                    {groupClassesBySection(getActiveClasses(classesList)).map((group) => (
                      <div key={group.section} className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                          {group.label}
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {group.classes.map((cls) => {
                            const active = assignClasses.includes(cls.name);
                            return (
                              <button
                                key={cls.id}
                                type="button"
                                onClick={() =>
                                  setAssignClasses((prev) =>
                                    prev.includes(cls.name)
                                      ? prev.filter((c) => c !== cls.name)
                                      : [...prev, cls.name]
                                  )
                                }
                                className={`px-2.5 py-1.5 rounded-[6px] text-[11px] font-medium border text-left transition-colors duration-150 ${
                                  active
                                    ? 'bg-[#B8913A] text-white border-[#B8913A] font-semibold'
                                    : 'bg-white text-[#2A2A2E] border-[#DDD5C7] hover:border-[#B8913A]'
                                }`}
                              >
                                {cls.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-[#EFE9DF]">
                  <button
                    type="button"
                    onClick={() => setAssigningTeacher(null)}
                    className="px-4 py-2 rounded-[8px] bg-white border border-[#DDD5C7] hover:bg-[#FAF8F4] text-[#2A2A2E] font-medium transition-colors duration-150"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium disabled:opacity-50 transition-colors duration-150"
                  >
                    {isSaving ? 'Saving...' : 'Save Assignments'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Teacher Confirmation Modal (Director Only) */}
        {isDirector && deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs">
            <div className="bg-white rounded-[10px] max-w-md w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] space-y-4">
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#EFE9DF]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-[8px] bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] flex items-center justify-center shrink-0">
                    <Trash2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-[#2A2A2E]">Delete Teacher</h3>
                    <p className="text-xs text-[#6E6A63]">Permanent staff removal</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setDeleteTarget(null)}
                  className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] disabled:opacity-50 transition-colors duration-150"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="bg-[#FAF8F4] rounded-[8px] p-3 border border-[#E6DFD3] flex items-center justify-between gap-2">
                  <span className="font-semibold text-[#2A2A2E]">{deleteTarget.fullName}</span>
                  <span className="text-[11px] font-mono font-medium text-[#5E5B56] bg-white px-2 py-0.5 rounded-[6px] border border-[#DDD5C7]">
                    {deleteTarget.staffId}
                  </span>
                </div>

                <div className="p-3 rounded-[8px] bg-[#FAF0F2] border border-[#E2C1C5] text-[#86222E] space-y-1">
                  <p className="font-semibold">
                    This will permanently remove this teacher. This cannot be undone.
                  </p>
                  <p className="text-[11px] text-[#86222E]/90">
                    They will also be removed from form/subject class assignments, timetable slots,
                    and linked staff login accounts. Students, marks, and report sheets they entered
                    will be preserved.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 text-xs">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setDeleteTarget(null)}
                  className="px-4 py-2 rounded-[8px] bg-white border border-[#DDD5C7] hover:bg-[#FAF8F4] text-[#2A2A2E] font-medium disabled:opacity-50 transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleConfirmDelete}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[#86222E] hover:bg-[#6E1A24] text-white font-medium shadow-xs disabled:opacity-50 transition-colors duration-150"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Individual Teacher Profile Modal (Printable) */}
      {selectedTeacher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs overflow-y-auto print-only-container">
          <div className="bg-white rounded-[10px] max-w-2xl w-full shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] overflow-hidden my-6 print-only-card">
            <div className="flex items-center justify-between px-6 py-4 bg-[#FAF8F4] border-b border-[#E6DFD3] no-print">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#5E5B56]">
                Faculty Staff Profile
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-xs transition-colors duration-150"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Profile
                </button>
                {canEditOrAssign && (
                  <button
                    onClick={() => handleOpenEditModal(selectedTeacher)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-white border border-[#DDD5C7] hover:bg-[#EFE9DF] text-[#2A2A2E] font-medium text-xs transition-colors duration-150"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                )}
                <button
                  onClick={() => setSelectedTeacher(null)}
                  className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#EFE9DF] transition-colors duration-150"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 sm:p-8 space-y-6">
              <div className="flex items-center justify-between gap-4 border-b-2 border-[#6B1020] pb-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <SchoolLogo
                    logoDataUrl={schoolSettings.logoDataUrl}
                    schoolName={schoolSettings.schoolName}
                    size="lg"
                    variant="print"
                  />
                  <div className="min-w-0">
                    <h2 className="font-serif text-lg font-semibold text-[#6B1020] uppercase tracking-wide">
                      {schoolSettings.schoolName}
                    </h2>
                    <p className="text-[11px] text-[#6E6A63]">
                      {schoolSettings.address} • {schoolSettings.phone}
                    </p>
                    <p className="text-[10px] font-semibold text-[#B8913A] uppercase tracking-wider mt-0.5">
                      Faculty Employment & Academic Dossier
                    </p>
                  </div>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium border shrink-0 ${getEmploymentBadge(
                    selectedTeacher.employmentStatus
                  )}`}
                >
                  {selectedTeacher.employmentStatus}
                </span>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-[10px] bg-[#6B1020] text-white font-serif font-semibold text-2xl flex items-center justify-center shrink-0">
                  {selectedTeacher.fullName.replace(/^(Mr\.|Mrs\.|Dr\.|Ms\.)\s*/i, '').charAt(0)}
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-[#2A2A2E]">{selectedTeacher.fullName}</h3>
                  <div className="flex flex-wrap gap-2 mt-1 text-xs">
                    <span className="font-mono font-medium bg-[#FAF8F4] text-[#2A2A2E] px-2.5 py-0.5 rounded-[6px] border border-[#E6DFD3]">
                      STAFF ID: {selectedTeacher.staffId}
                    </span>
                    <span className="font-medium bg-[#FAF0F2] text-[#6B1020] px-2.5 py-0.5 rounded-[6px] border border-[#DFC7CA]">
                      {selectedTeacher.roleType}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="bg-[#FAF8F4] p-4 rounded-[8px] border border-[#E6DFD3] space-y-2.5">
                  <h4 className="font-semibold uppercase tracking-wider text-[#5E5B56] text-[10px]">
                    Contact & Employment
                  </h4>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#6E6A63] inline-flex items-center gap-1">
                      <Phone className="w-3 h-3" /> Phone:
                    </span>
                    <strong className="text-[#2A2A2E] font-medium tabular-nums">{selectedTeacher.phone}</strong>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#6E6A63] inline-flex items-center gap-1">
                      <Mail className="w-3 h-3" /> Email:
                    </span>
                    <strong className="text-[#2A2A2E] font-medium break-all text-right">
                      {selectedTeacher.email}
                    </strong>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#6E6A63] inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Employment Date:
                    </span>
                    <strong className="text-[#2A2A2E] font-medium tabular-nums">{selectedTeacher.employmentDate}</strong>
                  </div>
                  <div className="pt-1">
                    <span className="text-[#6E6A63] inline-flex items-center gap-1 block mb-0.5">
                      <MapPin className="w-3 h-3" /> Residential Address:
                    </span>
                    <strong className="text-[#2A2A2E] font-medium leading-relaxed block">
                      {selectedTeacher.address || '—'}
                    </strong>
                  </div>
                </div>

                <div className="bg-[#FAF8F4] p-4 rounded-[8px] border border-[#E6DFD3] space-y-3">
                  <div>
                    <h4 className="font-semibold uppercase tracking-wider text-[#5E5B56] text-[10px] mb-1">
                      Qualifications & Certifications
                    </h4>
                    <p className="text-[#2A2A2E] font-medium leading-relaxed">
                      {selectedTeacher.qualifications}
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold uppercase tracking-wider text-[#5E5B56] text-[10px] mb-1.5">
                      Assigned Subjects
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedTeacher.subjects.length === 0 ? (
                        <span className="text-[#7F7A72] italic">None assigned</span>
                      ) : (
                        selectedTeacher.subjects.map((sub, i) => (
                          <span
                            key={i}
                            className={`px-2 py-0.5 rounded-[6px] font-medium text-[11px] border ${
                              i === 0
                                ? 'bg-[#6B1020] text-white border-[#6B1020]'
                                : 'bg-[#FAF0F2] text-[#6B1020] border-[#DFC7CA]'
                            }`}
                          >
                            {sub}
                            {i === 0 ? ' (Primary)' : ''}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold uppercase tracking-wider text-[#5E5B56] text-[10px] mb-1.5">
                      Assigned Classes
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedTeacher.assignedClasses.length === 0 ? (
                        <span className="text-[#7F7A72] italic">None assigned</span>
                      ) : (
                        selectedTeacher.assignedClasses.map((cls, i) => (
                          <span
                            key={i}
                            className="bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6] px-2 py-0.5 rounded-[6px] font-medium text-[11px]"
                          >
                            {cls}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {isDirector && (
                <div className="bg-[#FAF0F2] border border-[#DFC7CA] rounded-[8px] p-4 flex flex-wrap items-center justify-between gap-3 no-print">
                  <span className="text-xs font-semibold text-[#6B1020]">
                    Director Employment Status Control:
                  </span>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {(['Active', 'On Leave', 'Deactivated'] as const).map((st) => (
                      <button
                        key={st}
                        onClick={() => handleToggleTeacherStatus(selectedTeacher, st)}
                        className={`px-3 py-1 rounded-[8px] font-medium border transition-colors duration-150 ${
                          selectedTeacher.employmentStatus === st
                            ? st === 'Active'
                              ? 'bg-[#2A583B] text-white border-[#2A583B]'
                              : st === 'On Leave'
                              ? 'bg-[#B8913A] text-white border-[#B8913A]'
                              : 'bg-[#86222E] text-white border-[#86222E]'
                            : 'bg-white text-[#2A2A2E] border-[#DDD5C7] hover:bg-[#FAF8F4]'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
