import React, { useRef, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { StudentsPage } from './pages/StudentsPage';
import { TeachersPage } from './pages/TeachersPage';
import { ClassesPage } from './pages/ClassesPage';
import { AttendancePage } from './pages/AttendancePage';
import { AcademicsPage } from './pages/AcademicsPage';
import { SchoolFeesPage } from './pages/SchoolFeesPage';
import { TimetablePage } from './pages/TimetablePage';
import { ReportsPage } from './pages/ReportsPage';
import { AnnouncementsPage } from './pages/AnnouncementsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShieldAlert, ArrowLeft, RefreshCw, LogOut } from 'lucide-react';
import { UserRole } from './types';
import { SchoolLogo } from './components/common/SchoolLogo';
import { Primary6WarningModal } from './components/common/Primary6WarningModal';
import { ParentPortalView } from './components/parent/ParentPortalView';

// Route permissions map
const PAGE_PERMISSIONS: Record<string, UserRole[]> = {
  dashboard: ['director', 'principal', 'bursar', 'head_teacher', 'teacher', 'parent'],
  students: ['director', 'principal', 'bursar', 'head_teacher', 'teacher', 'parent'],
  teachers: ['director', 'principal', 'head_teacher', 'teacher'],
  classes: ['director', 'principal', 'bursar', 'head_teacher', 'teacher'],
  attendance: ['director', 'principal', 'head_teacher', 'teacher', 'parent'],
  academics: ['director', 'principal', 'head_teacher', 'teacher', 'parent'],
  fees: ['director', 'principal', 'bursar', 'parent'], // Teachers & Head Teacher cannot access financial bursary
  timetable: ['director', 'principal', 'head_teacher', 'teacher', 'parent'],
  reports: ['director', 'principal', 'head_teacher', 'teacher', 'parent'],
  announcements: ['director', 'principal', 'bursar', 'head_teacher', 'teacher', 'parent'],
  settings: ['director', 'principal'], // Scoped to School Administration
};

function AccessRestrictedScreen({
  page,
  role,
  onGoHome,
}: {
  page: string;
  role: UserRole;
  onGoHome: () => void;
}) {
  return (
    <div className="bg-white rounded-[10px] border border-[#E6DFD3] p-8 sm:p-12 text-center max-w-xl mx-auto shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] my-8">
      <div className="w-16 h-16 rounded-[10px] bg-[#FAF0F2] text-[#86222E] flex items-center justify-center mx-auto mb-4 border border-[#E2C1C5]">
        <ShieldAlert className="w-8 h-8" />
      </div>
      <h2 className="font-serif text-xl font-semibold text-[#2A2A2E] tracking-tight">
        Access Restricted
      </h2>
      <p className="text-xs text-[#6E6A63] mt-2 leading-relaxed">
        Your current account role (<strong className="capitalize text-[#2A2A2E]">{role}</strong>) is not authorized to access the{' '}
        <strong className="text-[#2A2A2E] capitalize">{page}</strong> module.
      </p>
      <div className="mt-4 p-3.5 rounded-[8px] bg-[#FAF8F4] text-[#5E5B56] text-xs border border-[#E6DFD3] text-left">
        <p className="font-semibold text-[#2A2A2E] mb-1">Security Policy:</p>
        <p className="text-[11px] leading-relaxed">
          Access is enforced cryptographically by Cloud Firestore Security Rules and role assignments.
          If you require elevated clearance, please contact the School Director.
        </p>
      </div>
      <button
        onClick={onGoHome}
        className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-xs shadow-xs transition-colors duration-150"
      >
        <ArrowLeft className="w-4 h-4" />
        Return to Main Dashboard
      </button>
    </div>
  );
}

function AppContent() {
  const [activePage, setActivePage] = useState<string>('dashboard');
  const {
    firebaseUser,
    currentUser,
    isLoading,
    role,
    authNotice,
    clearAuthNotice,
    schoolSettings,
    primary6Warning,
    isPrimary6WarningModalOpen,
    dismissPrimary6WarningModal,
    refreshPrimary6Warning,
    signOutUser,
  } = useAuth();

  const academicsLeaveGuardRef = useRef<((proceed: () => void) => boolean) | null>(null);

  const handleNavigate = (page: string) => {
    if (
      activePage === 'academics' &&
      page !== 'academics' &&
      academicsLeaveGuardRef.current
    ) {
      const canLeaveImmediately = academicsLeaveGuardRef.current(() => {
        setActivePage(page);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      if (!canLeaveImmediately) return;
    }
    setActivePage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7F4EF] flex flex-col items-center justify-center p-6 text-center">
        <SchoolLogo
          logoDataUrl={schoolSettings.logoDataUrl}
          schoolName={schoolSettings.schoolName}
          size="xl"
          variant="default"
          className="mb-4"
        />
        <h1 className="font-serif text-lg font-semibold text-[#2A2A2E]">
          {schoolSettings.schoolName}
        </h1>
        <p className="text-xs font-medium text-[#6B1020] mt-0.5">SchoolDesk Portal</p>
        <div className="mt-3 flex items-center gap-2 text-xs text-[#6E6A63]">
          <RefreshCw className="w-4 h-4 animate-spin text-[#6B1020]" />
          <span>Verifying Firebase Authentication session...</span>
        </div>
      </div>
    );
  }

  // Strictly require verified Firebase Authentication + Firestore user profile
  if (!firebaseUser || !firebaseUser.emailVerified || !currentUser) {
    return (
      <div className="min-h-screen bg-[#F7F4EF]">
        <LoginPage onLoginSuccess={() => handleNavigate('dashboard')} />
      </div>
    );
  }

  // Dedicated Isolated Parent Portal ("My Children") — zero admin sidebar or other modules
  if (role === 'parent') {
    return (
      <div className="min-h-screen bg-[#F7F4EF] flex flex-col">
        <header className="sticky top-0 z-30 bg-white border-b border-[#E6DFD3] px-4 sm:px-8 py-3 shadow-[0_1px_2px_rgba(42,42,46,0.03)] no-print">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <SchoolLogo
                logoDataUrl={schoolSettings.logoDataUrl}
                schoolName={schoolSettings.schoolName}
                size="md"
                variant="default"
              />
              <div className="min-w-0">
                <p className="font-serif text-sm sm:text-base font-semibold text-[#6B1020] truncate">
                  {schoolSettings.schoolName}
                </p>
                <p className="text-[11px] text-[#5E5B56] truncate">
                  Parent Portal • My Children &amp; Announcements
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden sm:inline-block text-xs text-[#5E5B56] truncate max-w-[220px]">
                {firebaseUser.email || currentUser.email}
              </span>
              <button
                type="button"
                onClick={signOutUser}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#FAF8F4] hover:bg-[#FAF0F2] border border-[#DDD5C7] hover:border-[#DFC7CA] text-[#6B1020] text-xs font-medium transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 lg:p-8">
          <ParentPortalView />
        </main>
      </div>
    );
  }

  // Dedicated Auth & Account Screen when navigated from sidebar/navbar
  if (activePage === 'login') {
    return (
      <AppLayout activePage={activePage} onNavigate={handleNavigate}>
        <LoginPage onLoginSuccess={() => handleNavigate('dashboard')} />
      </AppLayout>
    );
  }

  // Route protection gate
  const allowedRoles = PAGE_PERMISSIONS[activePage] || ['director', 'principal', 'head_teacher', 'teacher', 'parent'];
  const isAuthorized = allowedRoles.includes(role);

  return (
    <AppLayout activePage={activePage} onNavigate={handleNavigate}>
      {authNotice && (
        <div className="mb-4 p-3.5 rounded-[8px] bg-[#FAF0F2] border border-[#E2C1C5] text-xs text-[#86222E] flex items-center justify-between gap-3 no-print">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#86222E] shrink-0" />
            <span>{authNotice}</span>
          </div>
          <button
            type="button"
            onClick={clearAuthNotice}
            className="text-xs font-semibold text-[#86222E] underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}
      {!isAuthorized ? (
        <AccessRestrictedScreen
          page={activePage}
          role={role}
          onGoHome={() => handleNavigate('dashboard')}
        />
      ) : (
        <>
          {activePage === 'dashboard' && <DashboardPage onNavigate={handleNavigate} />}
          {activePage === 'students' && <StudentsPage />}
          {activePage === 'teachers' && <TeachersPage />}
          {activePage === 'classes' && <ClassesPage onNavigate={handleNavigate} />}
          {activePage === 'attendance' && <AttendancePage />}
          {activePage === 'academics' && (
            <AcademicsPage
              onRegisterLeaveGuard={(guard) => {
                academicsLeaveGuardRef.current = guard;
              }}
            />
          )}
          {activePage === 'fees' && <SchoolFeesPage />}
          {activePage === 'timetable' && <TimetablePage />}
          {activePage === 'reports' && <ReportsPage />}
          {activePage === 'announcements' && <AnnouncementsPage />}
          {activePage === 'settings' && <SettingsPage />}
        </>
      )}
      <Primary6WarningModal
        isOpen={isPrimary6WarningModalOpen}
        summary={primary6Warning}
        userRole={role}
        onClose={dismissPrimary6WarningModal}
        onRefreshSummary={refreshPrimary6Warning}
      />
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
