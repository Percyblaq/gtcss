import React, { useEffect, useMemo, useState } from 'react';
import {
  School,
  Calendar,
  Save,
  CheckCircle2,
  Database,
  Shield,
  CreditCard,
  UserPlus,
  AlertCircle,
  Lock,
  Pencil,
  X,
  RefreshCw,
  Image as ImageIcon,
  Search,
  Upload,
  Trash2,
  MessageSquare,
} from 'lucide-react';
import { useAuth, DIRECTOR_MASTER_EMAIL } from '../context/AuthContext';
import {
  AcademicTerm,
  HeadTeacherTitle,
  SchoolClass,
  SchoolSetting,
  StaffInvite,
  Student,
  UserProfile,
  UserRole,
} from '../types';
import { SAMPLE_CLASSES } from '../data/sampleData';
import { subscribeClasses } from '../services/academicService';
import {
  getActiveClasses,
  getGroupedSubjectsBySection,
  getProfileSubjects,
  groupClassesBySection,
} from '../utils/classUtils';
import {
  extractFriendlyError,
  subscribeStudents,
  syncProvisionedTeacherToFirestore,
} from '../services/schoolService';
import { saveSchoolSettingsToFirestore } from '../services/settingsAndTimetableService';
import { processSignatureImageToDataUrl } from '../services/brandingService';
import { SchoolBrandingSettings } from '../components/settings/SchoolBrandingSettings';

export const SettingsPage: React.FC = () => {
  const {
    role,
    currentUser,
    firebaseUser,
    isFirebaseConnected,
    registeredUsers,
    staffInvites,
    schoolSettings,
    isSchoolSettingsPersisted,
    createStaffAccount,
    updateUserRoleAndStatus,
    toggleAccountStatus,
    toggleStaffInviteStatus,
    deleteStaffInvite,
  } = useAuth();

  const isLiveFirestore = Boolean(firebaseUser);
  const isDirector =
    Boolean(firebaseUser) &&
    (role === 'director' ||
      firebaseUser?.email?.toLowerCase() === DIRECTOR_MASTER_EMAIL.toLowerCase());

  const [activeTab, setActiveTab] = useState<'profile' | 'branding' | 'roles' | 'system'>('profile');
  const [settings, setSettings] = useState<SchoolSetting>(schoolSettings);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  // Live classes & students for staff/parent assignment dropdowns
  const [classesList, setClassesList] = useState<SchoolClass[]>(SAMPLE_CLASSES);
  const [studentsList, setStudentsList] = useState<Student[]>([]);

  useEffect(() => {
    setSettings(schoolSettings);
  }, [schoolSettings]);

  useEffect(() => {
    if (!firebaseUser) {
      setStudentsList([]);
      return;
    }

    const u1 = subscribeClasses(
      (cls) => setClassesList(cls.length > 0 ? cls : SAMPLE_CLASSES),
      (err) => setStatusMessage({ text: err, type: 'error' })
    );
    const u2 = subscribeStudents(
      role,
      currentUser,
      firebaseUser.email,
      setStudentsList,
      (err) => setStatusMessage({ text: err, type: 'error' })
    );

    return () => {
      u1();
      u2();
    };
  }, [firebaseUser, role, currentUser]);

  // New staff modal state (Director only)
  const [isNewStaffModalOpen, setIsNewStaffModalOpen] = useState(false);
  const [isCreatingStaff, setIsCreatingStaff] = useState(false);
  const [subjectSearchQuery, setSubjectSearchQuery] = useState('');
  const [newStaff, setNewStaff] = useState({
    displayName: '',
    email: '',
    role: 'teacher' as UserRole,
    title: 'Form Teacher',
    phone: '+234 ',
    assignedClasses: [] as string[],
    subjects: [] as string[],
    linkedStudentId: '',
  });

  // Edit user assignment modal (Director only)
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAssignedClasses, setEditAssignedClasses] = useState<string[]>([]);
  const [editAssignedSubjects, setEditAssignedSubjects] = useState<string[]>([]);
  const [editSubjectSearchQuery, setEditSubjectSearchQuery] = useState('');
  const [editLinkedStudentIds, setEditLinkedStudentIds] = useState<string[]>([]);
  const [isSavingUserEdit, setIsSavingUserEdit] = useState(false);

  const NON_TEACHING_TITLE_REGEX =
    /\b(director|proprietor|principal|vice principal|parent|guardian|bursar|accountant|cashier|clerk|secretary|receptionist|librarian|nurse|driver|security|cleaner|registrar|counselor)\b/i;

  const DEFAULT_ROLE_TITLES: Record<UserRole, string> = {
    director: 'School Director',
    principal: 'Principal',
    head_teacher: 'Headmaster / Headmistress',
    teacher: 'Form Teacher',
    parent: 'Parent / Guardian',
  };

  const showTeacherAssignments =
    newStaff.role === 'teacher' && !NON_TEACHING_TITLE_REGEX.test(newStaff.title);

  const activeClassesForPickers = useMemo(() => {
    const active = getActiveClasses(classesList);
    return active.length > 0 ? active : classesList;
  }, [classesList]);

  const groupedClassesForPickers = useMemo(
    () => groupClassesBySection(activeClassesForPickers),
    [activeClassesForPickers]
  );

  const allAvailableClassNames = useMemo(
    () => groupedClassesForPickers.flatMap((g) => g.classes.map((c) => c.name)),
    [groupedClassesForPickers]
  );

  const groupedSubjectsBySection = useMemo(
    () => getGroupedSubjectsBySection(activeClassesForPickers),
    [activeClassesForPickers]
  );

  const filteredGroupedSubjects = useMemo(() => {
    const q = subjectSearchQuery.trim().toLowerCase();
    if (!q) return groupedSubjectsBySection;
    return groupedSubjectsBySection
      .map((group) => ({
        ...group,
        subjects: group.subjects.filter((s) => s.toLowerCase().includes(q)),
      }))
      .filter((group) => group.subjects.length > 0);
  }, [groupedSubjectsBySection, subjectSearchQuery]);

  const visibleSubjectNames = useMemo(
    () => filteredGroupedSubjects.flatMap((g) => g.subjects),
    [filteredGroupedSubjects]
  );

  const filteredEditGroupedSubjects = useMemo(() => {
    const q = editSubjectSearchQuery.trim().toLowerCase();
    const knownLower = new Set(
      groupedSubjectsBySection.flatMap((g) => g.subjects.map((s) => s.toLowerCase()))
    );
    const customLegacy = editAssignedSubjects.filter((s) => !knownLower.has(s.toLowerCase()));
    const combined =
      customLegacy.length > 0
        ? [
            ...groupedSubjectsBySection,
            { section: 'Senior Secondary' as const, label: 'Additional Assigned Subjects', subjects: customLegacy },
          ]
        : groupedSubjectsBySection;

    if (!q) return combined;
    return combined
      .map((group) => ({
        ...group,
        subjects: group.subjects.filter((s) => s.toLowerCase().includes(q)),
      }))
      .filter((group) => group.subjects.length > 0);
  }, [groupedSubjectsBySection, editAssignedSubjects, editSubjectSearchQuery]);

  useEffect(() => {
    if (studentsList.length > 0 && !studentsList.some((s) => s.id === newStaff.linkedStudentId)) {
      setNewStaff((prev) => ({ ...prev, linkedStudentId: studentsList[0].id }));
    }
  }, [studentsList, newStaff.linkedStudentId]);

  const openEditUserModal = (user: UserProfile) => {
    setEditingUser(user);
    setEditTitle(user.title || '');
    setEditPhone(user.phone || '+234 ');
    setEditAssignedClasses(user.assignedClasses || []);
    setEditAssignedSubjects(getProfileSubjects(user));
    setEditSubjectSearchQuery('');
    setEditLinkedStudentIds(user.linkedStudentIds || []);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirector) {
      setStatusMessage({
        text: 'Restricted: Cloud Firestore rules restrict institutional profile & term changes exclusively to the School Director.',
        type: 'error',
      });
      return;
    }

    if (!settings.schoolName.trim() || !settings.currentSession.trim()) {
      setStatusMessage({
        text: 'School name and active academic session are required.',
        type: 'error',
      });
      return;
    }

    if (!isLiveFirestore) {
      setStatusMessage({
        text: 'Sign in as Director with a verified Firebase account to persist changes to Cloud Firestore.',
        type: 'error',
      });
      return;
    }

    setIsSavingSettings(true);
    setStatusMessage(null);
    try {
      await saveSchoolSettingsToFirestore(settings);
      setStatusMessage({
        text: 'School profile, academic calendar, and currency configuration saved to Cloud Firestore.',
        type: 'success',
      });
    } catch (err) {
      setStatusMessage({
        text: extractFriendlyError(err, 'Failed to save school configuration to Firestore.'),
        type: 'error',
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaff.displayName.trim() || !newStaff.email.trim()) return;

    setIsCreatingStaff(true);
    setStatusMessage(null);

    const linkedStu = studentsList.find((s) => s.id === newStaff.linkedStudentId);
    const finalClasses = showTeacherAssignments ? [...newStaff.assignedClasses] : [];
    const finalSubjects = showTeacherAssignments ? [...newStaff.subjects] : [];
    const primarySubject = finalSubjects[0] || undefined;

    const result = await createStaffAccount({
      displayName: newStaff.displayName.trim(),
      email: newStaff.email.trim().toLowerCase(),
      role: newStaff.role,
      isActive: true,
      title: newStaff.title.trim() || 'Staff Member',
      phone: newStaff.phone.trim(),
      assignedClasses: finalClasses,
      assignedSubjects: finalSubjects,
      subjects: finalSubjects,
      primarySubject,
      linkedStudentIds:
        newStaff.role === 'parent' && newStaff.linkedStudentId ? [newStaff.linkedStudentId] : [],
      linkedStudentNames:
        newStaff.role === 'parent' && linkedStu ? [linkedStu.fullName] : [],
      wardName: newStaff.role === 'parent' && linkedStu ? linkedStu.fullName : undefined,
      wardAdmissionNo: newStaff.role === 'parent' && linkedStu ? linkedStu.admissionNo : undefined,
    });

    if (result.success) {
      let directorySyncWarning = '';
      if (showTeacherAssignments) {
        try {
          await syncProvisionedTeacherToFirestore({
            displayName: newStaff.displayName.trim(),
            email: newStaff.email.trim().toLowerCase(),
            phone: newStaff.phone.trim(),
            title: newStaff.title.trim() || 'Form Teacher',
            assignedClasses: finalClasses,
            subjects: finalSubjects,
            classesList,
          });
        } catch (syncErr) {
          directorySyncWarning = ` (Teacher directory sync notice: ${extractFriendlyError(
            syncErr,
            'check Teachers directory'
          )})`;
        }
      }

      setIsCreatingStaff(false);
      setStatusMessage({
        text:
          (result.targetCollection === 'users'
            ? `Updated existing authenticated profile for ${newStaff.displayName} (${newStaff.role}).`
            : `Pre-provisioned invite saved for ${newStaff.email} (${newStaff.role}). When they sign up or sign in with Firebase Auth using this email, their role and assignments apply automatically.`) +
          directorySyncWarning,
        type: 'success',
      });
      setIsNewStaffModalOpen(false);
      setSubjectSearchQuery('');
      setNewStaff({
        displayName: '',
        email: '',
        role: 'teacher',
        title: 'Form Teacher',
        phone: '+234 ',
        assignedClasses: [],
        subjects: [],
        linkedStudentId: studentsList[0]?.id || '',
      });
    } else {
      setIsCreatingStaff(false);
      setStatusMessage({
        text: result.error || 'Failed to create staff account.',
        type: 'error',
      });
    }
  };

  const handleSaveUserEdits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !isDirector) return;
    setIsSavingUserEdit(true);

    const linkedNames = studentsList
      .filter((s) => editLinkedStudentIds.includes(s.id))
      .map((s) => s.fullName);

    const isTeachingUser =
      editingUser.role === 'teacher' && !NON_TEACHING_TITLE_REGEX.test(editTitle);
    const finalClasses = isTeachingUser ? editAssignedClasses : [];
    const finalSubjects = isTeachingUser ? editAssignedSubjects : [];
    const primarySubject = finalSubjects[0] || '';

    const res = await updateUserRoleAndStatus(editingUser.uid, {
      title: editTitle.trim(),
      phone: editPhone.trim(),
      assignedClasses: finalClasses,
      assignedSubjects: finalSubjects,
      subjects: finalSubjects,
      primarySubject,
      linkedStudentIds: editingUser.role === 'parent' ? editLinkedStudentIds : [],
      linkedStudentNames: editingUser.role === 'parent' ? linkedNames : [],
      wardName: editingUser.role === 'parent' ? linkedNames[0] || '' : undefined,
    });

    if (res.success && isTeachingUser) {
      try {
        await syncProvisionedTeacherToFirestore({
          displayName: editingUser.displayName,
          email: editingUser.email,
          phone: editPhone.trim(),
          title: editTitle.trim(),
          assignedClasses: finalClasses,
          subjects: finalSubjects,
          classesList,
        });
      } catch (syncErr) {
        setIsSavingUserEdit(false);
        setStatusMessage({
          text: `User assignments updated, but teacher directory sync reported: ${extractFriendlyError(
            syncErr,
            'sync error'
          )}`,
          type: 'error',
        });
        setEditingUser(null);
        return;
      }
    }

    setIsSavingUserEdit(false);
    if (res.success) {
      setStatusMessage({
        text: `Permissions and assignments updated for ${editingUser.displayName}.`,
        type: 'success',
      });
      setEditingUser(null);
    } else {
      setStatusMessage({
        text: res.error || 'Failed to update user assignments.',
        type: 'error',
      });
    }
  };

  const handleRoleChange = async (targetUid: string, newRole: UserRole) => {
    if (!isDirector) {
      setStatusMessage({
        text: 'Unauthorized: Only the School Director can reassign user roles.',
        type: 'error',
      });
      return;
    }

    const res = await updateUserRoleAndStatus(targetUid, { role: newRole });
    if (res.success) {
      setStatusMessage({ text: 'User role updated successfully in Firestore.', type: 'success' });
    } else {
      setStatusMessage({ text: res.error || 'Role change failed.', type: 'error' });
    }
  };

  const handleToggleActive = async (targetUid: string, currentStatus: boolean) => {
    if (!isDirector) {
      setStatusMessage({
        text: 'Unauthorized: Only the School Director has authority to activate or deactivate accounts.',
        type: 'error',
      });
      return;
    }

    const res = await toggleAccountStatus(targetUid, !currentStatus);
    if (res.success) {
      setStatusMessage({
        text: `User account ${!currentStatus ? 'activated' : 'deactivated'}. Security rules updated.`,
        type: 'success',
      });
    } else {
      setStatusMessage({ text: res.error || 'Operation failed.', type: 'error' });
    }
  };

  const toggleNewStaffClass = (clsName: string) => {
    setNewStaff((prev) => ({
      ...prev,
      assignedClasses: prev.assignedClasses.includes(clsName)
        ? prev.assignedClasses.filter((c) => c !== clsName)
        : [...prev.assignedClasses, clsName],
    }));
  };

  const toggleNewStaffSubject = (subj: string) => {
    setNewStaff((prev) => ({
      ...prev,
      subjects: prev.subjects.includes(subj)
        ? prev.subjects.filter((s) => s !== subj)
        : [...prev.subjects, subj],
    }));
  };

  const selectAllNewStaffSubjects = () => {
    setNewStaff((prev) => {
      const existingLower = new Set(prev.subjects.map((s) => s.toLowerCase()));
      const additions = visibleSubjectNames.filter((s) => !existingLower.has(s.toLowerCase()));
      return { ...prev, subjects: [...prev.subjects, ...additions] };
    });
  };

  const toggleClassAssignment = (clsName: string) => {
    setEditAssignedClasses((prev) =>
      prev.includes(clsName) ? prev.filter((c) => c !== clsName) : [...prev, clsName]
    );
  };

  const toggleSubjectAssignment = (subj: string) => {
    setEditAssignedSubjects((prev) =>
      prev.includes(subj) ? prev.filter((s) => s !== subj) : [...prev, subj]
    );
  };

  const toggleWardAssignment = (studentId: string) => {
    setEditLinkedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#2A2A2E] tracking-tight">
              School Configuration &amp; Role Management
            </h1>
            <span className="bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA] text-xs font-medium px-2.5 py-0.5 rounded-full capitalize">
              {role.replace('_', ' ')} View
            </span>
            {isLiveFirestore && (
              <span
                className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border ${
                  isSchoolSettingsPersisted
                    ? 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]'
                    : 'bg-[#FBF5E8] text-[#7D5A18] border-[#E3CFA6]'
                }`}
              >
                {isSchoolSettingsPersisted ? 'Persisted in Firestore' : 'Using Default Template'}
              </span>
            )}
          </div>
          <p className="text-xs text-[#6E6A63] mt-1">
            Role-based access control, Nigerian school calendar, currency, and staff permissions
          </p>
        </div>

        {/* Tab Buttons */}
        <div className="flex p-1 bg-[#FAF8F4] border border-[#E6DFD3] rounded-[10px] overflow-x-auto gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`px-3 py-1.5 text-xs font-medium rounded-[8px] transition-colors duration-150 whitespace-nowrap shrink-0 ${
              activeTab === 'profile'
                ? 'bg-[#6B1020] text-white shadow-xs'
                : 'text-[#5E5B56] hover:text-[#2A2A2E]'
            }`}
          >
            School Profile
          </button>
          {isDirector && (
            <button
              type="button"
              onClick={() => setActiveTab('branding')}
              className={`px-3 py-1.5 text-xs font-medium rounded-[8px] transition-colors duration-150 flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTab === 'branding'
                  ? 'bg-[#6B1020] text-white shadow-xs'
                  : 'text-[#5E5B56] hover:text-[#2A2A2E]'
              }`}
            >
              <ImageIcon className={`w-3.5 h-3.5 ${activeTab === 'branding' ? 'text-white' : 'text-[#6B1020]'}`} />
              School Branding
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('roles')}
            className={`px-3 py-1.5 text-xs font-medium rounded-[8px] transition-colors duration-150 flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'roles'
                ? 'bg-[#6B1020] text-white shadow-xs'
                : 'text-[#5E5B56] hover:text-[#2A2A2E]'
            }`}
          >
            <Shield className={`w-3.5 h-3.5 ${activeTab === 'roles' ? 'text-white' : 'text-[#6B1020]'}`} />
            Staff &amp; RBAC Accounts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('system')}
            className={`px-3 py-1.5 text-xs font-medium rounded-[8px] transition-colors duration-150 whitespace-nowrap shrink-0 ${
              activeTab === 'system'
                ? 'bg-[#6B1020] text-white shadow-xs'
                : 'text-[#5E5B56] hover:text-[#2A2A2E]'
            }`}
          >
            Database &amp; Security
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          className={`p-3.5 rounded-[8px] border text-xs flex items-center justify-between gap-2 ${
            statusMessage.type === 'success'
              ? 'bg-[#EEF4F0] border-[#C5D6CB] text-[#2A583B]'
              : 'bg-[#FAF0F2] border-[#E2C1C5] text-[#86222E]'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-[#2A583B] shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-[#86222E] shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-[11px] font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: SCHOOL PROFILE & CALENDAR */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSaveSettings} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-6">
            {!isDirector && (
              <div className="p-3.5 rounded-[8px] bg-[#FBF5E8] border border-[#E3CFA6] text-xs text-[#7D5A18] flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#B8913A] shrink-0" />
                <span>
                  Read-only view: Only the School Director can modify and save global school settings.
                </span>
              </div>
            )}

            {/* School Profile */}
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
              <h3 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2">
                <School className="w-4 h-4 text-[#6B1020]" />
                School Identification &amp; Leadership
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-[#2A2A2E] mb-1">
                    Official School Name *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!isDirector}
                    value={settings.schoolName}
                    onChange={(e) => setSettings({ ...settings, schoolName: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] font-semibold disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">School Motto</label>
                  <input
                    type="text"
                    disabled={!isDirector}
                    value={settings.motto}
                    onChange={(e) => setSettings({ ...settings, motto: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">State &amp; Country</label>
                  <input
                    type="text"
                    disabled={!isDirector}
                    value={settings.state}
                    onChange={(e) => setSettings({ ...settings, state: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-medium text-[#2A2A2E] mb-1">Campus Address</label>
                  <input
                    type="text"
                    disabled={!isDirector}
                    value={settings.address}
                    onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Official Telephone</label>
                  <input
                    type="text"
                    disabled={!isDirector}
                    value={settings.phone}
                    onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Official Email</label>
                  <input
                    type="email"
                    disabled={!isDirector}
                    value={settings.email}
                    onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-medium text-[#2A2A2E] mb-1">
                    Official Website (Optional)
                  </label>
                  <input
                    type="text"
                    disabled={!isDirector}
                    value={settings.website || ''}
                    onChange={(e) => setSettings({ ...settings, website: e.target.value })}
                    placeholder="https://www.greatgodstimeschool.edu.ng"
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Director / Proprietor</label>
                  <input
                    type="text"
                    disabled={!isDirector}
                    value={settings.directorName}
                    onChange={(e) => setSettings({ ...settings, directorName: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">School Principal</label>
                  <input
                    type="text"
                    disabled={!isDirector}
                    value={settings.principalName}
                    onChange={(e) => setSettings({ ...settings, principalName: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">
                    Head Teacher Title (Report Card)
                  </label>
                  <select
                    disabled={!isDirector}
                    value={settings.headTeacherTitle || 'Headmaster'}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        headTeacherTitle: e.target.value as HeadTeacherTitle,
                      })
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] font-medium bg-white disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  >
                    <option value="Headmaster">Headmaster</option>
                    <option value="Headmistress">Headmistress</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">
                    {settings.headTeacherTitle || 'Headmaster'}&apos;s Full Name
                  </label>
                  <input
                    type="text"
                    disabled={!isDirector}
                    placeholder={`Enter ${settings.headTeacherTitle || 'Headmaster'}'s name`}
                    value={settings.headTeacherName || ''}
                    onChange={(e) => setSettings({ ...settings, headTeacherName: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                {/* Headmaster / Headmistress Optional Signature Image */}
                <div className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="font-medium text-[#2A2A2E]">
                      {settings.headTeacherTitle || 'Headmaster'} Signature (Optional)
                    </label>
                    {isDirector && settings.headTeacherSignature && (
                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, headTeacherSignature: '' })}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#86222E] hover:underline"
                      >
                        <Trash2 className="w-3 h-3" />
                        Remove
                      </button>
                    )}
                  </div>
                  {settings.headTeacherSignature ? (
                    <div className="p-2 rounded-[6px] bg-white border border-[#E6DFD3] flex items-center justify-center h-14">
                      <img
                        src={settings.headTeacherSignature}
                        alt={`${settings.headTeacherTitle || 'Headmaster'} signature`}
                        className="max-h-10 max-w-full object-contain"
                      />
                    </div>
                  ) : (
                    <p className="text-[11px] text-[#7F7A72] italic">No signature uploaded</p>
                  )}
                  {isDirector && (
                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] bg-white hover:bg-[#FAF0F2] border border-[#DDD5C7] text-[#6B1020] text-[11px] font-medium cursor-pointer transition-colors">
                      <Upload className="w-3.5 h-3.5" />
                      {settings.headTeacherSignature ? 'Change Signature' : 'Upload Signature'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          try {
                            const res = await processSignatureImageToDataUrl(file);
                            setSettings((prev) => ({ ...prev, headTeacherSignature: res.dataUrl }));
                            setStatusMessage(null);
                          } catch (err) {
                            setStatusMessage({
                              text: extractFriendlyError(err, 'Invalid signature image.'),
                              type: 'error',
                            });
                          }
                        }}
                      />
                    </label>
                  )}
                </div>

                {/* Principal Optional Signature Image */}
                <div className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="font-medium text-[#2A2A2E]">
                      Principal Signature (Optional)
                    </label>
                    {isDirector && settings.principalSignature && (
                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, principalSignature: '' })}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#86222E] hover:underline"
                      >
                        <Trash2 className="w-3 h-3" />
                        Remove
                      </button>
                    )}
                  </div>
                  {settings.principalSignature ? (
                    <div className="p-2 rounded-[6px] bg-white border border-[#E6DFD3] flex items-center justify-center h-14">
                      <img
                        src={settings.principalSignature}
                        alt="Principal signature"
                        className="max-h-10 max-w-full object-contain"
                      />
                    </div>
                  ) : (
                    <p className="text-[11px] text-[#7F7A72] italic">No signature uploaded</p>
                  )}
                  {isDirector && (
                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] bg-white hover:bg-[#FAF0F2] border border-[#DDD5C7] text-[#6B1020] text-[11px] font-medium cursor-pointer transition-colors">
                      <Upload className="w-3.5 h-3.5" />
                      {settings.principalSignature ? 'Change Signature' : 'Upload Signature'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          try {
                            const res = await processSignatureImageToDataUrl(file);
                            setSettings((prev) => ({ ...prev, principalSignature: res.dataUrl }));
                            setStatusMessage(null);
                          } catch (err) {
                            setStatusMessage({
                              text: extractFriendlyError(err, 'Invalid signature image.'),
                              type: 'error',
                            });
                          }
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>

            {/* Nigerian Academic Calendar Configuration */}
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
              <h3 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#B8913A]" />
                Nigerian School Calendar &amp; Term Schedule
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">
                    Active Academic Session *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!isDirector}
                    value={settings.currentSession}
                    onChange={(e) => setSettings({ ...settings, currentSession: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] font-semibold text-[#2A2A2E] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Active Term</label>
                  <select
                    disabled={!isDirector}
                    value={settings.currentTerm}
                    onChange={(e) =>
                      setSettings({ ...settings, currentTerm: e.target.value as AcademicTerm })
                    }
                    className="w-full px-3 py-2 border border-[#E3CFA6] rounded-[8px] font-semibold text-[#7D5A18] bg-[#FBF5E8] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  >
                    <option value="First Term">First Term (Sept - Dec)</option>
                    <option value="Second Term">Second Term (Jan - April)</option>
                    <option value="Third Term">Third Term (May - July)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Term Resumption Date</label>
                  <input
                    type="date"
                    disabled={!isDirector}
                    value={settings.termBegins}
                    onChange={(e) => setSettings({ ...settings, termBegins: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#2A2A2E] mb-1">Term Vacation Date</label>
                  <input
                    type="date"
                    disabled={!isDirector}
                    value={settings.termEnds}
                    onChange={(e) => setSettings({ ...settings, termEnds: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-medium text-[#2A2A2E] mb-1">
                    Next Term Resumption Date (Shown on Report Cards)
                  </label>
                  <input
                    type="date"
                    disabled={!isDirector}
                    value={settings.nextTermResumption}
                    onChange={(e) =>
                      setSettings({ ...settings, nextTermResumption: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] text-[#2A2A2E] disabled:bg-[#FAF8F4] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                  />
                </div>
              </div>
            </div>

            {/* Report Card Comment Boxes Configuration */}
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
              <div>
                <h3 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[#6B1020]" />
                  Report Card Comment Boxes
                </h3>
                <p className="text-[11px] text-[#6E6A63] mt-0.5">
                  Choose which comment boxes appear on student report cards and printed/PDF sheets. Each box can be toggled independently.
                </p>
              </div>

              <div className="space-y-2.5 text-xs">
                <label className="flex items-center justify-between gap-3 p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] cursor-pointer">
                  <div>
                    <span className="font-semibold text-[#2A2A2E] block">
                      Form / Class Teacher&apos;s Comment
                    </span>
                    <span className="text-[11px] text-[#6E6A63]">
                      Editable by the class&apos;s assigned Form Teacher and School Director.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!isDirector}
                    checked={settings.enableTeacherComment !== false}
                    onChange={(e) =>
                      setSettings({ ...settings, enableTeacherComment: e.target.checked })
                    }
                    className="w-4 h-4 accent-[#6B1020] shrink-0"
                  />
                </label>

                <label className="flex items-center justify-between gap-3 p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] cursor-pointer">
                  <div>
                    <span className="font-semibold text-[#2A2A2E] block">
                      Headmaster&apos;s/Headmistress&apos;s Comment
                    </span>
                    <span className="text-[11px] text-[#6E6A63]">
                      Editable by Head Teacher (Headmaster / Headmistress) and School Director.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!isDirector}
                    checked={settings.enableHeadComment !== false}
                    onChange={(e) =>
                      setSettings({ ...settings, enableHeadComment: e.target.checked })
                    }
                    className="w-4 h-4 accent-[#6B1020] shrink-0"
                  />
                </label>

                <label className="flex items-center justify-between gap-3 p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] cursor-pointer">
                  <div>
                    <span className="font-semibold text-[#2A2A2E] block">
                      Principal&apos;s Comment &amp; Approval
                    </span>
                    <span className="text-[11px] text-[#6E6A63]">
                      Editable and approvable by the School Principal and School Director.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!isDirector}
                    checked={settings.enablePrincipalComment !== false}
                    onChange={(e) =>
                      setSettings({ ...settings, enablePrincipalComment: e.target.checked })
                    }
                    className="w-4 h-4 accent-[#6B1020] shrink-0"
                  />
                </label>
              </div>
            </div>

            {isDirector && (
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="px-6 py-2.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-xs shadow-xs transition-colors duration-150 flex items-center gap-2 disabled:opacity-50"
                >
                  {isSavingSettings ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {isSavingSettings ? 'Saving to Firestore...' : 'Save Configurations'}
                </button>
              </div>
            )}
          </div>

          <div className="lg:col-span-4 space-y-6">
            {/* Currency Card */}
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] border-t-2 border-t-[#B8913A] p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <h4 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2 mb-3">
                <CreditCard className="w-4 h-4 text-[#2A583B]" />
                Currency Settings
              </h4>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between items-center py-2 border-b border-[#EFE9DF]">
                  <span className="text-[#6E6A63]">Official Currency:</span>
                  <strong className="text-[#2A2A2E] font-semibold">Nigerian Naira (NGN)</strong>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-[#EFE9DF]">
                  <span className="text-[#6E6A63]">Currency Symbol:</span>
                  <span className="font-semibold text-base text-[#6B1020] bg-[#FAF0F2] border border-[#DFC7CA] px-2.5 py-0.5 rounded-[6px]">
                    {settings.currencySymbol || '₦'}
                  </span>
                </div>
              </div>
            </div>

            {/* Role Rights Summary */}
            <div className="bg-white rounded-[10px] border border-[#E6DFD3] border-t-2 border-t-[#B8913A] p-5 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
              <h4 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-[#6B1020]" />
                Active Access Level
              </h4>
              <div className="p-3 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-[#2A2A2E] capitalize">{role.replace('_', ' ')}</span>
                  <span className="text-[10px] bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA] font-medium px-2 py-0.5 rounded-[6px]">
                    {isDirector
                      ? 'Full Authority'
                      : role === 'principal' || role === 'head_teacher'
                        ? 'Academic Supervisor'
                        : 'Scoped Access'}
                  </span>
                </div>
                <p className="text-[11px] text-[#6E6A63]">
                  {isDirector &&
                    'Full authority to create staff profiles, assign roles, modify school settings, and deactivate accounts.'}
                  {role === 'principal' &&
                    'Academic leadership, reports, and staff supervision. Role & institutional profile changes restricted to Director.'}
                  {role === 'head_teacher' &&
                    "School-wide academic oversight and Headmaster's/Headmistress's Comment on report cards."}
                </p>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* TAB: SCHOOL BRANDING (DIRECTOR ONLY) */}
      {activeTab === 'branding' && (
        <SchoolBrandingSettings
          isDirector={isDirector}
          isLiveFirestore={isLiveFirestore}
          actorName={currentUser?.displayName || firebaseUser?.email || 'School Director'}
          schoolSettings={schoolSettings}
        />
      )}

      {/* TAB 2: STAFF & ROLE MANAGEMENT (DIRECTOR EXCLUSIVE CAPABILITIES) */}
      {activeTab === 'roles' && (
        <div className="space-y-6">
          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#EFE9DF]">
              <div>
                <h3 className="font-semibold text-base text-[#2A2A2E] flex items-center gap-2">
                  <Shield className="w-5 h-5 text-[#6B1020]" />
                  Staff Accounts & Role Management
                </h3>
                <p className="text-xs text-[#6E6A63] mt-0.5">
                  Director controls for provisioning user profiles, assigning roles/classes/wards, and toggling active status
                </p>
              </div>

              {isDirector ? (
                <button
                  type="button"
                  onClick={() => setIsNewStaffModalOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium shadow-xs transition-colors duration-150 w-fit"
                >
                  <UserPlus className="w-4 h-4" />
                  Provision Staff / User Profile
                </button>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6] text-xs font-medium">
                  <Lock className="w-3.5 h-3.5" />
                  Director Privilege Required for Account Modifications
                </div>
              )}
            </div>

            {/* Users Table */}
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAF8F4] border-b border-[#E6DFD3] text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                    <th className="py-3 px-4">Staff / User</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Role Assignment</th>
                    <th className="py-3 px-4">Assigned Classes / Wards</th>
                    <th className="py-3 px-4">Account Status</th>
                    <th className="py-3 px-4 text-right">Director Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE9DF]">
                  {registeredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-[#7F7A72]">
                        No authenticated user profiles loaded yet.
                      </td>
                    </tr>
                  ) : (
                    registeredUsers.map((u) => {
                      const isUserActive = u.isActive !== false;
                      const isDirectorMaster =
                        u.email.trim().toLowerCase() === DIRECTOR_MASTER_EMAIL.toLowerCase();

                      return (
                        <tr
                          key={u.uid}
                          className={`hover:bg-[#FAF8F4] transition-colors duration-150 ${
                            !isUserActive ? 'opacity-65 bg-[#FAF8F4]/70' : ''
                          }`}
                        >
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-[#6B1020] text-white font-semibold flex items-center justify-center shrink-0">
                                {u.displayName.charAt(0)}
                              </div>
                              <div>
                                <p className="font-semibold text-[#2A2A2E]">{u.displayName}</p>
                                <span className="text-[11px] text-[#7F7A72]">
                                  {u.title || 'Staff'}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 font-mono text-[#5E5B56]">{u.email}</td>

                          <td className="py-3.5 px-4">
                            {isDirector && !isDirectorMaster ? (
                              <select
                                value={u.role}
                                onChange={(e) => handleRoleChange(u.uid, e.target.value as UserRole)}
                                className="px-2.5 py-1 text-xs border border-[#DDD5C7] rounded-[8px] capitalize font-medium bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] transition-colors duration-150"
                              >
                                <option value="director">Director</option>
                                <option value="principal">Principal</option>
                                <option value="head_teacher">Head Teacher</option>
                                <option value="teacher">Teacher</option>
                                <option value="parent">Parent</option>
                              </select>
                            ) : (
                              <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-medium capitalize bg-[#FAF0F2] text-[#6B1020] border border-[#DFC7CA]">
                                {u.role.replace('_', ' ')}
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            {u.role === 'teacher' && (() => {
                              const userSubjects = getProfileSubjects(u);
                              const userClasses = u.assignedClasses || [];
                              return (
                                <div className="space-y-1.5">
                                  <div className="flex flex-wrap gap-1">
                                    {userClasses.length === 0 ? (
                                      <span className="text-[11px] text-[#7D5A18] italic">
                                        No classes assigned
                                      </span>
                                    ) : (
                                      userClasses.map((cls, i) => (
                                        <span
                                          key={i}
                                          className="bg-[#FAF8F4] text-[#5E5B56] border border-[#E6DFD3] px-1.5 py-0.5 rounded-[6px] text-[10px] font-medium"
                                        >
                                          {cls}
                                        </span>
                                      ))
                                    )}
                                  </div>
                                  {userSubjects.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {userSubjects.map((sub, i) => (
                                        <span
                                          key={`${sub}-${i}`}
                                          className={`px-1.5 py-0.5 rounded-[6px] text-[10px] font-medium border ${
                                            i === 0
                                              ? 'bg-[#FAF0F2] text-[#6B1020] border-[#DFC7CA]'
                                              : 'bg-white text-[#5E5B56] border-[#E6DFD3]'
                                          }`}
                                        >
                                          {sub}
                                          {i === 0 ? ' (Primary)' : ''}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {u.role === 'parent' && (
                              <span className="text-[11px] text-[#5E5B56]">
                                Wards:{' '}
                                <strong className="text-[#2A2A2E]">
                                  {u.linkedStudentNames?.join(', ') ||
                                    u.wardName ||
                                    'Matched by guardianEmail'}
                                </strong>
                              </span>
                            )}
                            {(u.role === 'director' || u.role === 'principal' || u.role === 'head_teacher') && (
                              <span className="text-[#7F7A72] italic text-[11px]">
                                All School Levels
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                                isUserActive
                                  ? 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]'
                                  : 'bg-[#FAF0F2] text-[#86222E] border-[#E2C1C5]'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  isUserActive ? 'bg-[#2A583B]' : 'bg-[#86222E]'
                                }`}
                              />
                              {isUserActive ? 'Active' : 'Deactivated'}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            {isDirector && !isDirectorMaster ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openEditUserModal(u)}
                                  className="px-2.5 py-1 rounded-[8px] text-xs font-medium bg-[#FAF0F2] text-[#6B1020] hover:bg-[#F3E1E5] border border-[#DFC7CA] inline-flex items-center gap-1 transition-colors duration-150"
                                >
                                  <Pencil className="w-3 h-3" />
                                  Assign
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleActive(u.uid, isUserActive)}
                                  className={`px-2.5 py-1 rounded-[8px] text-xs font-medium border transition-colors duration-150 ${
                                    isUserActive
                                      ? 'text-[#86222E] bg-[#FAF0F2] hover:bg-[#F3E1E5] border-[#E2C1C5]'
                                      : 'text-[#2A583B] bg-[#EEF4F0] hover:bg-[#E1ECE5] border-[#C5D6CB]'
                                  }`}
                                >
                                  {isUserActive ? 'Deactivate' : 'Reactivate'}
                                </button>
                              </div>
                            ) : (
                              <span className="text-[#7F7A72] text-[11px] italic">
                                {isDirectorMaster ? 'Protected Root' : 'View Only'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {isDirector && (() => {
              const registeredEmails = new Set(
                registeredUsers.map((u) => u.email.trim().toLowerCase())
              );
              const pendingInvites: StaffInvite[] = staffInvites.filter(
                (inv) => !registeredEmails.has(inv.email.trim().toLowerCase())
              );
              if (pendingInvites.length === 0) return null;

              return (
                <div className="mt-6 pt-5 border-t border-[#E6DFD3] space-y-3">
                  <div>
                    <h4 className="font-semibold text-sm text-[#2A2A2E]">
                      Pending Pre-Provisioned Invites ({pendingInvites.length})
                    </h4>
                    <p className="text-[11px] text-[#6E6A63]">
                      These staff or parents have been assigned roles in Firestore and are awaiting
                      their first Firebase Authentication sign-up or Google sign-in with the listed
                      email address.
                    </p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#FBF5E8] border-b border-[#E3CFA6] text-[11px] font-semibold uppercase tracking-wider text-[#7D5A18]">
                          <th className="py-2.5 px-4">Invited Name</th>
                          <th className="py-2.5 px-4">Email</th>
                          <th className="py-2.5 px-4">Role</th>
                          <th className="py-2.5 px-4">Assignments / Wards</th>
                          <th className="py-2.5 px-4">Invite Status</th>
                          <th className="py-2.5 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EFE9DF]">
                        {pendingInvites.map((inv) => (
                          <tr key={inv.id} className="hover:bg-[#FAF8F4] transition-colors duration-150">
                            <td className="py-3 px-4">
                              <p className="font-semibold text-[#2A2A2E]">{inv.displayName}</p>
                              <span className="text-[11px] text-[#7F7A72]">
                                {inv.title || 'Pre-provisioned'}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-[#5E5B56]">{inv.email}</td>
                            <td className="py-3 px-4">
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-medium capitalize bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6]">
                                {inv.role.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-[11px] text-[#5E5B56]">
                              {inv.role === 'teacher' ? (() => {
                                const invSubjects = getProfileSubjects(inv);
                                const invClasses = inv.assignedClasses || [];
                                return (
                                  <div className="space-y-1">
                                    <div>{invClasses.join(', ') || 'No classes yet'}</div>
                                    {invSubjects.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {invSubjects.map((sub, idx) => (
                                          <span
                                            key={`${sub}-${idx}`}
                                            className={`px-1.5 py-0.5 rounded-[6px] text-[10px] font-medium border ${
                                              idx === 0
                                                ? 'bg-[#FAF0F2] text-[#6B1020] border-[#DFC7CA]'
                                                : 'bg-white text-[#5E5B56] border-[#E6DFD3]'
                                            }`}
                                          >
                                            {sub}
                                            {idx === 0 ? ' (Primary)' : ''}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })() : inv.role === 'parent' ? (
                                (inv.linkedStudentNames || []).join(', ') ||
                                inv.wardName ||
                                'Matched by email'
                              ) : (
                                'All School Levels'
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                                  inv.isActive
                                    ? 'bg-[#EEF4F0] text-[#2A583B] border-[#C5D6CB]'
                                    : 'bg-[#FAF0F2] text-[#86222E] border-[#E2C1C5]'
                                }`}
                              >
                                {inv.isActive ? 'Active Invite' : 'Suspended'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right space-x-1.5">
                              <button
                                type="button"
                                onClick={async () => {
                                  const res = await toggleStaffInviteStatus(inv.id, !inv.isActive);
                                  if (!res.success && res.error) {
                                    setStatusMessage({ text: res.error, type: 'error' });
                                  }
                                }}
                                className="px-2.5 py-1 rounded-[8px] text-xs font-medium bg-white hover:bg-[#FAF8F4] text-[#2A2A2E] border border-[#DDD5C7] transition-colors duration-150"
                              >
                                {inv.isActive ? 'Suspend' : 'Enable'}
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  const res = await deleteStaffInvite(inv.id);
                                  if (res.success) {
                                    setStatusMessage({
                                      text: `Removed pending invite for ${inv.email}.`,
                                      type: 'success',
                                    });
                                  } else if (res.error) {
                                    setStatusMessage({ text: res.error, type: 'error' });
                                  }
                                }}
                                className="px-2.5 py-1 rounded-[8px] text-xs font-medium bg-[#FAF0F2] hover:bg-[#F3E1E5] text-[#86222E] border border-[#E2C1C5] transition-colors duration-150"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            <div className="mt-4 p-3.5 rounded-[8px] bg-[#FAF8F4] border border-[#E6DFD3] text-[11px] text-[#5E5B56]">
              <strong className="text-[#2A2A2E]">How Staff & Parent Provisioning Works:</strong> When the Director provisions an
              account here, any existing user with that email is updated immediately; otherwise a
              secure invite is stored in <code>/staffInvites</code>. Once that staff member or
              parent creates an account or signs in via Firebase Authentication with that exact
              email, Firestore Security Rules validate the invite and grant their exact role,
              classes, subjects, or linked wards.
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: SYSTEM, FIRESTORE & HARDENED RULES */}
      {activeTab === 'system' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gradient-to-br from-[#6B1020] to-[#540C19] text-white rounded-[10px] border border-[#B8913A]/40 p-6 shadow-[0_1px_2px_rgba(42,42,46,0.06),0_6px_16px_rgba(42,42,46,0.08)] space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/15">
              <span className="font-semibold text-[#E3CFA6] flex items-center gap-2 text-sm">
                <Database className="w-5 h-5 text-[#B8913A]" /> Cloud Firestore Connection
              </span>
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border ${
                  isFirebaseConnected
                    ? 'bg-white/10 text-[#C5D6CB] border-[#C5D6CB]/30'
                    : 'bg-white/10 text-[#E3CFA6] border-[#B8913A]/40'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isFirebaseConnected ? 'bg-[#7BB68D]' : 'bg-[#B8913A]'
                  }`}
                />
                {isFirebaseConnected ? 'Live & Verified' : 'Checking Connection'}
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[#E3CFA6]/80 uppercase text-[10px] font-semibold tracking-wider block">
                  Firebase Project ID
                </span>
                <span className="font-mono text-[#FAF8F4] text-sm">model-cooler-87cdj</span>
              </div>

              <div>
                <span className="text-[#E3CFA6]/80 uppercase text-[10px] font-semibold tracking-wider block">
                  Database Identifier
                </span>
                <span className="font-mono text-[#FAF8F4] text-xs break-all">
                  ai-studio-schooldesk-68c4e41b-1d28-46ff-bc1c-b0f364a1a835
                </span>
              </div>

              <div>
                <span className="text-[#E3CFA6]/80 uppercase text-[10px] font-semibold tracking-wider block">
                  Primary Director Authority
                </span>
                <span className="font-mono text-[#E3CFA6] text-xs">
                  Protected Root Administrator Account (Director Role)
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-6 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] space-y-4">
            <h4 className="font-semibold text-sm text-[#2A2A2E] flex items-center gap-2 pb-3 border-b border-[#EFE9DF]">
              <Shield className="w-5 h-5 text-[#6B1020]" />
              Hardened Firestore Security Rules
            </h4>

            <div className="space-y-2.5 text-xs text-[#5E5B56]">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#2A583B] shrink-0 mt-0.5" />
                <span>
                  <strong className="text-[#2A2A2E]">Global Catch-All:</strong> Default deny on unmatched collections.
                </span>
              </div>

              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#2A583B] shrink-0 mt-0.5" />
                <span>
                  <strong className="text-[#2A2A2E]">Deactivation Invariant:</strong> Inactive accounts (
                  <code>isActive == false</code>) are rejected at the database level.
                </span>
              </div>

              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#2A583B] shrink-0 mt-0.5" />
                <span>
                  <strong className="text-[#2A2A2E]">Teacher Scope:</strong> Teachers can only write attendance and CA scores
                  for classes in their <code>assignedClasses</code> array.
                </span>
              </div>

              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#2A583B] shrink-0 mt-0.5" />
                <span>
                  <strong className="text-[#2A2A2E]">Parent Isolation:</strong> Parents can only read records where{' '}
                  <code>guardianEmail == request.auth.token.email</code> or{' '}
                  <code>studentId in linkedStudentIds</code>.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE STAFF MODAL (Director Only) */}
      {isNewStaffModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs">
          <div className="bg-white rounded-[10px] max-w-xl w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-[#EFE9DF]">
              <div>
                <h3 className="font-semibold text-base text-[#2A2A2E]">
                  Provision Staff / User Profile (Director Action)
                </h3>
                <p className="text-xs text-[#6E6A63]">
                  Create RBAC profile and assign role, classes, subjects, or linked wards in Firestore
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsNewStaffModalOpen(false);
                  setSubjectSearchQuery('');
                }}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors duration-150"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateStaff} className="py-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-[#5E5B56] mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mr. Kelechi Nwankwo"
                  value={newStaff.displayName}
                  onChange={(e) => setNewStaff({ ...newStaff, displayName: e.target.value })}
                  className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    placeholder="k.nwankwo@crownfieldcollege.edu.ng"
                    value={newStaff.email}
                    onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                  />
                </div>

                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={newStaff.phone}
                    onChange={(e) => setNewStaff({ ...newStaff, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">Assigned Role *</label>
                  <select
                    value={newStaff.role}
                    onChange={(e) => {
                      const nextRole = e.target.value as UserRole;
                      setNewStaff((prev) => {
                        const isDefaultTitle = Object.values(DEFAULT_ROLE_TITLES).includes(
                          prev.title.trim()
                        );
                        return {
                          ...prev,
                          role: nextRole,
                          title: isDefaultTitle ? DEFAULT_ROLE_TITLES[nextRole] : prev.title,
                        };
                      });
                    }}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] font-medium focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                  >
                    <option value="principal">Principal</option>
                    <option value="head_teacher">Head Teacher</option>
                    <option value="teacher">Teacher</option>
                    <option value="parent">Parent</option>
                    <option value="director">Director</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">
                    Official Designation Title
                  </label>
                  <input
                    type="text"
                    list="staff-designation-suggestions"
                    placeholder="e.g. Teacher, Form Teacher, Head of Department"
                    value={newStaff.title}
                    onChange={(e) => setNewStaff({ ...newStaff, title: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none transition-colors duration-150"
                  />
                  <datalist id="staff-designation-suggestions">
                    <option value="Teacher" />
                    <option value="Form Teacher" />
                    <option value="Head of Department" />
                    <option value="Subject Teacher" />
                    <option value="Principal" />
                    <option value="School Director" />
                    <option value="Bursar" />
                    <option value="Librarian" />
                  </datalist>
                </div>
              </div>

              {showTeacherAssignments && (
                <div className="space-y-4 p-4 bg-[#FAF0F2] rounded-[10px] border border-[#DFC7CA]">
                  {/* Assigned Class Arm Multi-select */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <label className="font-semibold text-[#6B1020]">
                        Assigned Class Arm ({newStaff.assignedClasses.length} selected)
                      </label>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() =>
                            setNewStaff((prev) => ({
                              ...prev,
                              assignedClasses: [...allAvailableClassNames],
                            }))
                          }
                          className="font-medium text-[#6B1020] hover:underline"
                        >
                          Select All
                        </button>
                        <span className="text-[#DFC7CA]">|</span>
                        <button
                          type="button"
                          onClick={() =>
                            setNewStaff((prev) => ({ ...prev, assignedClasses: [] }))
                          }
                          className="font-medium text-[#5E5B56] hover:text-[#2A2A2E] hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {newStaff.assignedClasses.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {newStaff.assignedClasses.map((clsName) => (
                          <span
                            key={clsName}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-white border border-[#DFC7CA] text-[#6B1020] text-[11px] font-medium"
                          >
                            {clsName}
                            <button
                              type="button"
                              onClick={() => toggleNewStaffClass(clsName)}
                              aria-label={`Remove ${clsName}`}
                              className="text-[#6B1020]/70 hover:text-[#6B1020]"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="bg-white rounded-[8px] border border-[#E6DFD3] p-2.5 space-y-2.5 max-h-40 overflow-y-auto">
                      {groupedClassesForPickers.map((group) => (
                        <div key={group.section} className="space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                            {group.label}
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                            {group.classes.map((c) => {
                              const checked = newStaff.assignedClasses.includes(c.name);
                              return (
                                <label
                                  key={c.id}
                                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-[6px] border cursor-pointer transition-colors duration-150 ${
                                    checked
                                      ? 'bg-[#FAF0F2] border-[#DFC7CA] text-[#6B1020] font-medium'
                                      : 'bg-[#FAF8F4] border-[#E6DFD3] text-[#2A2A2E] hover:border-[#DFC7CA]'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleNewStaffClass(c.name)}
                                    className="accent-[#6B1020] shrink-0"
                                  />
                                  <span className="truncate text-[11px]">{c.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Searchable Subjects Multi-select */}
                  <div className="space-y-2 pt-3 border-t border-[#DFC7CA]/70">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <label className="font-semibold text-[#6B1020] block">
                          Subjects ({newStaff.subjects.length} selected)
                        </label>
                        <span className="text-[10px] text-[#6E6A63]">
                          First selected subject becomes the Primary Subject
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={selectAllNewStaffSubjects}
                          className="font-medium text-[#6B1020] hover:underline"
                        >
                          Select All
                        </button>
                        <span className="text-[#DFC7CA]">|</span>
                        <button
                          type="button"
                          onClick={() => setNewStaff((prev) => ({ ...prev, subjects: [] }))}
                          className="font-medium text-[#5E5B56] hover:text-[#2A2A2E] hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {newStaff.subjects.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {newStaff.subjects.map((sub, idx) => (
                          <span
                            key={sub}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] border text-[11px] font-medium ${
                              idx === 0
                                ? 'bg-[#6B1020] text-white border-[#6B1020]'
                                : 'bg-white text-[#2A2A2E] border-[#DFC7CA]'
                            }`}
                          >
                            <span>{sub}</span>
                            {idx === 0 && (
                              <span className="px-1 py-0.2 rounded-[4px] bg-[#B8913A] text-white text-[9px] font-semibold uppercase tracking-wide">
                                Primary Subject
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleNewStaffSubject(sub)}
                              aria-label={`Remove ${sub}`}
                              className={
                                idx === 0
                                  ? 'text-white/80 hover:text-white'
                                  : 'text-[#6E6A63] hover:text-[#6B1020]'
                              }
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#7F7A72]" />
                      <input
                        type="text"
                        placeholder="Search subjects across Creche to SS 3..."
                        value={subjectSearchQuery}
                        onChange={(e) => setSubjectSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-8 py-1.5 text-xs border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:ring-2 focus:ring-[#6B1020]/15 focus:border-[#6B1020]"
                      />
                      {subjectSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setSubjectSearchQuery('')}
                          className="absolute right-2.5 top-2 text-[#7F7A72] hover:text-[#2A2A2E]"
                          aria-label="Clear subject search"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="bg-white rounded-[8px] border border-[#E6DFD3] p-2.5 space-y-3 max-h-48 overflow-y-auto">
                      {filteredGroupedSubjects.length === 0 ? (
                        <p className="text-center py-4 text-[11px] text-[#7F7A72] italic">
                          No subjects match &ldquo;{subjectSearchQuery}&rdquo;.
                        </p>
                      ) : (
                        filteredGroupedSubjects.map((group) => (
                          <div key={group.section} className="space-y-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                              {group.label}
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {group.subjects.map((subj) => {
                                const selectedIndex = newStaff.subjects.indexOf(subj);
                                const checked = selectedIndex !== -1;
                                const isPrimary = selectedIndex === 0;
                                return (
                                  <label
                                    key={subj}
                                    className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-[6px] border cursor-pointer transition-colors duration-150 ${
                                      checked
                                        ? 'bg-[#FAF0F2] border-[#DFC7CA] text-[#6B1020] font-medium'
                                        : 'bg-[#FAF8F4] border-[#E6DFD3] text-[#2A2A2E] hover:border-[#DFC7CA]'
                                    }`}
                                  >
                                    <span className="flex items-center gap-1.5 min-w-0">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleNewStaffSubject(subj)}
                                        className="accent-[#6B1020] shrink-0"
                                      />
                                      <span className="truncate text-[11px]">{subj}</span>
                                    </span>
                                    {isPrimary && (
                                      <span className="px-1.5 py-0.5 rounded-[4px] bg-[#B8913A] text-white text-[9px] font-semibold uppercase tracking-wide shrink-0">
                                        Primary
                                      </span>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {newStaff.role === 'parent' && (
                <div className="p-3.5 bg-[#FBF5E8] rounded-[10px] border border-[#E3CFA6]">
                  <label className="block font-medium text-[#7D5A18] mb-1">
                    Linked Ward (Student)
                  </label>
                  <select
                    value={newStaff.linkedStudentId}
                    onChange={(e) => setNewStaff({ ...newStaff, linkedStudentId: e.target.value })}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                  >
                    {studentsList.length === 0 ? (
                      <option value="">No registered students yet</option>
                    ) : (
                      studentsList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.fullName} ({s.admissionNo}) - {s.className}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t border-[#EFE9DF]">
                <button
                  type="button"
                  onClick={() => {
                    setIsNewStaffModalOpen(false);
                    setSubjectSearchQuery('');
                  }}
                  className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingStaff}
                  className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium shadow-xs disabled:opacity-50 transition-colors duration-150"
                >
                  {isCreatingStaff ? 'Saving...' : 'Provision & Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT USER ASSIGNMENTS / WARDS MODAL (Director Only) */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs">
          <div className="bg-white rounded-[10px] max-w-xl w-full p-6 shadow-[0_12px_36px_rgba(42,42,46,0.18)] border border-[#E6DFD3] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-[#EFE9DF]">
              <div>
                <h3 className="font-semibold text-base text-[#2A2A2E]">
                  Edit Assignments — {editingUser.displayName}
                </h3>
                <p className="text-xs text-[#6E6A63] capitalize">
                  Role: {editingUser.role} • {editingUser.email}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors duration-150"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUserEdits} className="py-4 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">Designation Title</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#5E5B56] mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-[#DDD5C7] rounded-[8px] bg-[#FAF8F4] text-[#2A2A2E] focus:ring-2 focus:ring-[#6B1020]/20 focus:border-[#6B1020] focus:outline-none"
                  />
                </div>
              </div>

              {editingUser.role === 'teacher' && !NON_TEACHING_TITLE_REGEX.test(editTitle) && (
                <>
                  <div className="p-3.5 bg-[#FAF0F2] rounded-[10px] border border-[#DFC7CA] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="font-semibold text-[#6B1020]">
                        Assigned Classes ({editAssignedClasses.length} selected)
                      </label>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setEditAssignedClasses([...allAvailableClassNames])}
                          className="font-medium text-[#6B1020] hover:underline"
                        >
                          Select All
                        </button>
                        <span className="text-[#DFC7CA]">|</span>
                        <button
                          type="button"
                          onClick={() => setEditAssignedClasses([])}
                          className="font-medium text-[#5E5B56] hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2.5 max-h-48 overflow-y-auto">
                      {groupedClassesForPickers.map((group) => (
                        <div key={group.section} className="space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                            {group.label}
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                            {group.classes.map((c) => (
                              <label
                                key={c.id}
                                className="flex items-center gap-1.5 p-1.5 rounded-[8px] bg-white border border-[#E6DFD3] cursor-pointer text-[#2A2A2E]"
                              >
                                <input
                                  type="checkbox"
                                  checked={editAssignedClasses.includes(c.name)}
                                  onChange={() => toggleClassAssignment(c.name)}
                                  className="accent-[#6B1020]"
                                />
                                <span className="truncate font-medium">{c.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-3.5 bg-[#FAF8F4] rounded-[10px] border border-[#E6DFD3] space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <label className="font-semibold text-[#2A2A2E] block">
                          Assigned Subjects ({editAssignedSubjects.length} selected)
                        </label>
                        <span className="text-[10px] text-[#6E6A63]">
                          First selected subject is saved as Primary Subject
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => {
                            const visible = filteredEditGroupedSubjects.flatMap((g) => g.subjects);
                            setEditAssignedSubjects((prev) => {
                              const seen = new Set(prev.map((s) => s.toLowerCase()));
                              return [
                                ...prev,
                                ...visible.filter((s) => !seen.has(s.toLowerCase())),
                              ];
                            });
                          }}
                          className="font-medium text-[#6B1020] hover:underline"
                        >
                          Select All
                        </button>
                        <span className="text-[#DDD5C7]">|</span>
                        <button
                          type="button"
                          onClick={() => setEditAssignedSubjects([])}
                          className="font-medium text-[#5E5B56] hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {editAssignedSubjects.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {editAssignedSubjects.map((sub, idx) => (
                          <span
                            key={sub}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] border text-[11px] font-medium ${
                              idx === 0
                                ? 'bg-[#6B1020] text-white border-[#6B1020]'
                                : 'bg-white text-[#2A2A2E] border-[#DDD5C7]'
                            }`}
                          >
                            <span>{sub}</span>
                            {idx === 0 && (
                              <span className="px-1 py-0.2 rounded-[4px] bg-[#B8913A] text-white text-[9px] font-semibold uppercase tracking-wide">
                                Primary Subject
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleSubjectAssignment(sub)}
                              aria-label={`Remove ${sub}`}
                              className={
                                idx === 0
                                  ? 'text-white/80 hover:text-white'
                                  : 'text-[#6E6A63] hover:text-[#6B1020]'
                              }
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#7F7A72]" />
                      <input
                        type="text"
                        placeholder="Search subjects across Creche to SS 3..."
                        value={editSubjectSearchQuery}
                        onChange={(e) => setEditSubjectSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-8 py-1.5 text-xs border border-[#DDD5C7] rounded-[8px] bg-white text-[#2A2A2E] focus:outline-none focus:border-[#6B1020]"
                      />
                      {editSubjectSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setEditSubjectSearchQuery('')}
                          className="absolute right-2.5 top-2 text-[#7F7A72] hover:text-[#2A2A2E]"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="space-y-2.5 max-h-48 overflow-y-auto bg-white rounded-[8px] border border-[#E6DFD3] p-2.5">
                      {filteredEditGroupedSubjects.map((group) => (
                        <div key={group.label} className="space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5E5B56]">
                            {group.label}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {group.subjects.map((subj) => {
                              const idx = editAssignedSubjects.indexOf(subj);
                              const checked = idx !== -1;
                              return (
                                <label
                                  key={subj}
                                  className={`flex items-center justify-between gap-2 p-1.5 rounded-[6px] border cursor-pointer ${
                                    checked
                                      ? 'bg-[#FAF0F2] border-[#DFC7CA] text-[#6B1020] font-medium'
                                      : 'bg-[#FAF8F4] border-[#E6DFD3] text-[#2A2A2E]'
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5 min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleSubjectAssignment(subj)}
                                      className="accent-[#6B1020] shrink-0"
                                    />
                                    <span className="truncate text-[11px]">{subj}</span>
                                  </span>
                                  {idx === 0 && (
                                    <span className="px-1.5 py-0.5 rounded-[4px] bg-[#B8913A] text-white text-[9px] font-semibold uppercase tracking-wide shrink-0">
                                      Primary
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {editingUser.role === 'parent' && (
                <div className="p-3.5 bg-[#FBF5E8] rounded-[10px] border border-[#E3CFA6] space-y-2">
                  <label className="block font-semibold text-[#7D5A18]">
                    Linked Children / Wards ({editLinkedStudentIds.length} selected)
                  </label>
                  {studentsList.length === 0 ? (
                    <p className="text-[#6E6A63] italic">No students found in directory.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {studentsList.map((stu) => (
                        <label
                          key={stu.id}
                          className="flex items-center justify-between gap-2 p-2 rounded-[8px] bg-white border border-[#E6DFD3] cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={editLinkedStudentIds.includes(stu.id)}
                              onChange={() => toggleWardAssignment(stu.id)}
                              className="accent-[#6B1020]"
                            />
                            <span className="font-semibold text-[#2A2A2E]">{stu.fullName}</span>
                          </div>
                          <span className="text-[11px] text-[#6E6A63]">
                            {stu.admissionNo} • {stu.className}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t border-[#EFE9DF]">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingUserEdit}
                  className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium shadow-xs disabled:opacity-50 transition-colors duration-150"
                >
                  {isSavingUserEdit ? 'Saving...' : 'Save Assignments'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
