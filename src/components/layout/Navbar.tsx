import React, { useEffect, useMemo, useState } from 'react';
import {
  Menu,
  Bell,
  Shield,
  ChevronDown,
  User,
  LogOut,
  Calendar,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Announcement, Student } from '../../types';
import { subscribeStudents } from '../../services/schoolService';
import { filterVisibleAnnouncements, subscribeAnnouncements } from '../../services/communicationService';
import { SchoolLogo } from '../common/SchoolLogo';

interface NavbarProps {
  onToggleSidebar: () => void;
  onNavigate: (page: string) => void;
  activePage: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  onToggleSidebar,
  onNavigate,
}) => {
  const { currentUser, role, firebaseUser, signOutUser, schoolSettings } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [rawAnnouncements, setRawAnnouncements] = useState<Announcement[]>([]);
  const [linkedStudents, setLinkedStudents] = useState<Student[]>([]);

  useEffect(() => {
    if (!firebaseUser || !firebaseUser.emailVerified || !currentUser) {
      setRawAnnouncements([]);
      setLinkedStudents([]);
      return;
    }

    const unsubAnn = subscribeAnnouncements(
      role,
      setRawAnnouncements,
      () => {
        // Silently keep empty on transient bell error
      }
    );

    let unsubStu: (() => void) | undefined;
    if (role === 'parent') {
      unsubStu = subscribeStudents(
        'parent',
        currentUser,
        firebaseUser.email,
        setLinkedStudents,
        () => {}
      );
    }

    return () => {
      unsubAnn();
      if (unsubStu) unsubStu();
    };
  }, [firebaseUser, role, currentUser]);

  const userClassNames = useMemo(() => {
    if (role === 'teacher') return currentUser?.assignedClasses || [];
    if (role === 'parent') {
      return Array.from(new Set(linkedStudents.map((s) => s.className).filter(Boolean)));
    }
    return [];
  }, [role, currentUser, linkedStudents]);

  const visibleNotices = useMemo(() => {
    const filtered = filterVisibleAnnouncements(rawAnnouncements, role, userClassNames);
    return filtered.filter((a) => (a.status || 'Published') === 'Published').slice(0, 6);
  }, [rawAnnouncements, role, userClassNames]);

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-[#E6DFD3]">
      <div className="px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Left: Hamburger & School Name */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
            aria-label="Toggle navigation menu"
            className="p-2 -ml-2 rounded-[8px] text-[#5E5B56] hover:text-[#6B1020] hover:bg-[#F7F4EF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6B1020] transition-colors duration-150"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2.5 min-w-0">
            <SchoolLogo
              logoDataUrl={schoolSettings.logoDataUrl}
              schoolName={schoolSettings.schoolName}
              size="sm"
              variant="default"
            />

            <div className="hidden sm:block min-w-0">
              <p className="font-serif font-semibold text-sm tracking-tight text-[#2A2A2E] truncate max-w-[240px] lg:max-w-[360px]">
                {schoolSettings.schoolName}
              </p>
              <p className="text-[11px] text-[#7F7A72] truncate">
                SchoolDesk Portal
              </p>
            </div>
          </div>
        </div>

        {/* Center: Academic Term Pill */}
        <div className="hidden md:flex items-center gap-2 text-xs text-[#5E5B56]">
          <Calendar className="w-3.5 h-3.5 text-[#6B1020]/70" />
          <span className="font-medium text-[#2A2A2E]">{schoolSettings.currentSession}</span>
          <span className="px-2.5 py-0.5 rounded-full bg-[#FAF0F2] border border-[#E7BCC4]/70 text-[#6B1020] font-medium">
            {schoolSettings.currentTerm}
          </span>
        </div>

        {/* Right: Role Pill, Notifications & Profile */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#FAF8F4] text-[#2A2A2E] border border-[#E0D7C8]">
            <Shield className="w-3.5 h-3.5 text-[#6B1020]" />
            <span className="capitalize">{role}</span>
          </div>

          {/* Notifications Popover */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label="View announcements and notifications"
              className="relative p-2 rounded-[8px] text-[#5E5B56] hover:text-[#6B1020] hover:bg-[#F7F4EF] transition-colors duration-150"
            >
              <Bell className="w-5 h-5" />
              {visibleNotices.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#6B1020] ring-2 ring-white" />
              )}
            </button>

            {showNotifications && (
              <div
                className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-[10px] shadow-[0_8px_28px_rgba(42,42,46,0.10)] border border-[#E6DFD3] py-2 z-50"
                onClick={() => setShowNotifications(false)}
              >
                <div className="px-4 py-2.5 border-b border-[#E6DFD3] flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-[#2A2A2E]">
                    School Circulars & Notices
                  </h4>
                  <span className="text-[11px] bg-[#FAF0F2] text-[#6B1020] font-medium px-2.5 py-0.5 rounded-full">
                    {visibleNotices.length} active
                  </span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-[#EFE9DF]">
                  {visibleNotices.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[#7F7A72]">
                      No active circulars for your role.
                    </div>
                  ) : (
                    visibleNotices.map((ann) => (
                      <div key={ann.id} className="p-3 hover:bg-[#FAF8F4] transition-colors duration-150">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs font-medium text-[#2A2A2E] line-clamp-1">
                            {ann.title}
                          </span>
                          <span className="text-[10px] text-[#6B1020] bg-[#FAF0F2] px-2 py-0.5 rounded-full font-medium">
                            {ann.priority}
                          </span>
                        </div>
                        <p className="text-xs text-[#5E5B56] line-clamp-2">{ann.body}</p>
                        <div className="flex items-center justify-between mt-1 text-[11px] text-[#7F7A72]">
                          <span>{ann.authorName}</span>
                          <span>{ann.publishDate || ann.date}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="p-2 border-t border-[#E6DFD3] text-center">
                  <button
                    onClick={() => onNavigate('announcements')}
                    className="text-xs font-medium text-[#6B1020] hover:underline transition-colors duration-150"
                  >
                    View all announcements →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* User Profile dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex items-center gap-2 p-1 rounded-[8px] hover:bg-[#F7F4EF] transition-colors duration-150"
            >
              {currentUser?.avatar ? (
                <img
                  src={currentUser.avatar}
                  alt={currentUser.displayName}
                  className="w-8 h-8 rounded-full object-cover border border-[#D8CFC0]"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-[#FAF0F2] border border-[#E7BCC4] text-[#6B1020] flex items-center justify-center font-semibold text-xs">
                  {currentUser?.displayName?.charAt(0) || 'U'}
                </div>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-[#5E5B56] hidden sm:block" />
            </button>

            {showProfileMenu && (
              <div
                className="absolute right-0 mt-2 w-64 bg-white rounded-[10px] shadow-[0_8px_28px_rgba(42,42,46,0.10)] border border-[#E6DFD3] py-2 z-50"
                onClick={() => setShowProfileMenu(false)}
              >
                <div className="px-4 py-2.5 border-b border-[#E6DFD3]">
                  <p className="text-xs font-semibold text-[#2A2A2E]">{currentUser?.displayName}</p>
                  <p className="text-xs text-[#7F7A72] truncate">{currentUser?.email}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-[11px] font-medium bg-[#FAF0F2] text-[#6B1020] px-2.5 py-0.5 rounded-full capitalize">
                      {role}
                    </span>
                    {firebaseUser && (
                      <span className="text-[11px] font-medium bg-[#EEF4F0] text-[#2A583B] px-2.5 py-0.5 rounded-full">
                        Verified
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-1.5 space-y-0.5 text-xs">
                  <button
                    onClick={() => onNavigate('settings')}
                    className="w-full text-left px-3 py-2 rounded-[8px] hover:bg-[#FAF8F4] text-[#2A2A2E] flex items-center gap-2 transition-colors duration-150"
                  >
                    <User className="w-3.5 h-3.5 text-[#6B1020]/75" />
                    School Profile & Settings
                  </button>
                  <button
                    onClick={() => onNavigate('login')}
                    className="w-full text-left px-3 py-2 rounded-[8px] hover:bg-[#FAF8F4] text-[#2A2A2E] flex items-center gap-2 transition-colors duration-150"
                  >
                    <Shield className="w-3.5 h-3.5 text-[#6B1020]/75" />
                    Authentication Portal
                  </button>
                  <div className="border-t border-[#E6DFD3] my-1"></div>
                  <button
                    onClick={signOutUser}
                    className="w-full text-left px-3 py-2 rounded-[8px] hover:bg-[#FAF0F2] text-[#86222E] flex items-center gap-2 font-medium transition-colors duration-150"
                  >
                    <LogOut className="w-3.5 h-3.5 text-[#86222E]" />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
