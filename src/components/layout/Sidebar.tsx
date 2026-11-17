import React from 'react';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  School,
  CalendarCheck,
  BookOpen,
  Receipt,
  CalendarDays,
  FileSpreadsheet,
  Megaphone,
  Settings,
  LogIn,
  ChevronLeft,
  ChevronRight,
  Shield,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../types';
import { SchoolLogo } from '../common/SchoolLogo';

interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
  category: 'core' | 'academic' | 'finance' | 'admin';
  badge?: string;
}

const CATEGORY_ORDER: Array<{ key: NavItem['category']; label: string }> = [
  { key: 'core', label: 'Overview' },
  { key: 'academic', label: 'Academics & Records' },
  { key: 'finance', label: 'Bursary' },
  { key: 'admin', label: 'Administration' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onNavigate,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
}) => {
  const { role, currentUser, schoolSettings } = useAuth();

  const navItems: NavItem[] = [
    {
      id: 'dashboard',
      label: 'Main Dashboard',
      icon: LayoutDashboard,
      roles: ['director', 'principal', 'head_teacher', 'teacher', 'parent'],
      category: 'core',
    },
    {
      id: 'announcements',
      label: 'Announcements',
      icon: Megaphone,
      roles: ['director', 'principal', 'head_teacher', 'teacher', 'parent'],
      category: 'core',
      badge: schoolSettings.currentTerm.replace(' Term', ''),
    },
    {
      id: 'students',
      label: 'Students',
      icon: Users,
      roles: ['director', 'principal', 'head_teacher', 'teacher', 'parent'],
      category: 'academic',
      badge: role === 'parent' ? 'My Ward' : undefined,
    },
    {
      id: 'teachers',
      label: 'Teachers',
      icon: GraduationCap,
      roles: ['director', 'principal', 'head_teacher', 'teacher'],
      category: 'academic',
    },
    {
      id: 'classes',
      label: 'Classes & Arms',
      icon: School,
      roles: ['director', 'principal', 'head_teacher', 'teacher'],
      category: 'academic',
    },
    {
      id: 'attendance',
      label: 'Attendance',
      icon: CalendarCheck,
      roles: ['director', 'principal', 'head_teacher', 'teacher', 'parent'],
      category: 'academic',
    },
    {
      id: 'academics',
      label: 'Academics & CA',
      icon: BookOpen,
      roles: ['director', 'principal', 'head_teacher', 'teacher', 'parent'],
      category: 'academic',
      badge: 'CA 1 & 2',
    },
    {
      id: 'timetable',
      label: 'Timetable',
      icon: CalendarDays,
      roles: ['director', 'principal', 'head_teacher', 'teacher', 'parent'],
      category: 'academic',
    },
    {
      id: 'reports',
      label: 'Report Sheets',
      icon: FileSpreadsheet,
      roles: ['director', 'principal', 'head_teacher', 'teacher', 'parent'],
      category: 'academic',
    },
    {
      id: 'fees',
      label: 'School Fees (₦)',
      icon: Receipt,
      roles: ['director', 'principal', 'parent'],
      category: 'finance',
      badge: 'Naira',
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      roles: ['director', 'principal'],
      category: 'admin',
    },
    {
      id: 'login',
      label: 'Auth & Login',
      icon: LogIn,
      roles: ['director', 'principal', 'head_teacher', 'teacher', 'parent'],
      category: 'admin',
    },
  ];

  const visibleGroups = CATEGORY_ORDER.map((group) => ({
    ...group,
    items: navItems.filter((item) => item.category === group.key && item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);

  const handleSelect = (id: string) => {
    onNavigate(id);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile Drawer Overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#2A2A2E]/35 backdrop-blur-[1px] lg:hidden transition-opacity duration-200"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar Container: Deep Maroon executive gradient with ivory text */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 bg-gradient-to-b from-[#6B1020] via-[#630E1D] to-[#520B17] text-[#F7F4EF] border-r border-[#490913] flex flex-col transition-all duration-200 ease-out ${
          isMobileOpen ? 'translate-x-0 w-72' : '-translate-x-full lg:translate-x-0'
        } ${isCollapsed ? 'lg:w-20' : 'lg:w-64'}`}
      >
        {/* Mobile Header / Brand with thin gold underline */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-[#B8913A]/55 lg:hidden">
          <div className="flex items-center gap-2.5 min-w-0">
            <SchoolLogo
              logoDataUrl={schoolSettings.logoDataUrl}
              schoolName={schoolSettings.schoolName}
              size="sm"
              variant="light"
            />
            <div className="min-w-0">
              <span className="font-serif font-semibold text-sm text-[#F7F4EF] block truncate">
                {schoolSettings.schoolName}
              </span>
              <span className="block text-[11px] text-[#DFC484]/90">SchoolDesk Portal</span>
            </div>
          </div>
          <button
            onClick={onCloseMobile}
            aria-label="Close navigation"
            className="p-1.5 rounded-lg text-[#E6DCD0] hover:text-white hover:bg-white/10 transition-colors duration-150 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Desktop Brand Header with thin gold line under school name */}
        <div className="hidden lg:flex h-16 items-center justify-between px-4 border-b border-[#B8913A]/55">
          {!isCollapsed && (
            <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
              <SchoolLogo
                logoDataUrl={schoolSettings.logoDataUrl}
                schoolName={schoolSettings.schoolName}
                size="sm"
                variant="light"
              />
              <div className="leading-tight truncate min-w-0">
                <div className="font-serif font-semibold text-sm text-[#F7F4EF] tracking-tight truncate">
                  {schoolSettings.schoolName}
                </div>
                <div className="text-[11px] text-[#DFC484]/90">SchoolDesk Portal</div>
              </div>
            </div>
          )}

          {isCollapsed && (
            <div className="mx-auto">
              <SchoolLogo
                logoDataUrl={schoolSettings.logoDataUrl}
                schoolName={schoolSettings.schoolName}
                size="sm"
                variant="light"
              />
            </div>
          )}

          <button
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden lg:flex p-1.5 rounded-lg text-[#E6DCD0] hover:text-white hover:bg-white/10 transition-colors duration-150 ml-auto"
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* User & Role Summary */}
        {!isCollapsed && (
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2 bg-[#5A0D1B]/60">
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#F7F4EF] truncate">
                {currentUser?.displayName}
              </p>
              <p className="text-[11px] text-[#DFC484]/90 capitalize flex items-center gap-1 mt-0.5">
                <Shield className="w-3 h-3 text-[#B8913A]" />
                {role.replace('_', ' ')} workspace
              </p>
            </div>
            <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full border border-[#B8913A]/60 text-[#F7F4EF] capitalize shrink-0">
              {role.replace('_', ' ')}
            </span>
          </div>
        )}

        {/* Navigation Items List */}
        <nav aria-label="Portal navigation" className="flex-1 overflow-y-auto px-3 py-3">
          {visibleGroups.map((group, groupIndex) => (
            <div key={group.key}>
              {groupIndex > 0 && (
                <div className="my-3 border-t border-white/10" role="separator" />
              )}
              {!isCollapsed && (
                <div className="px-3 pb-1.5 text-[11px] font-medium text-[#DFC484]/80 tracking-wide">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activePage === item.id;

                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item.id)}
                      title={isCollapsed ? item.label : undefined}
                      className={`relative w-full flex items-center gap-3 px-3 py-2 rounded-[8px] text-[13px] font-medium transition-colors duration-150 group ${
                        isActive
                          ? 'bg-[#821D2E]/85 text-white'
                          : 'text-[#EFE8DE]/85 hover:text-white hover:bg-white/8'
                      } ${isCollapsed ? 'justify-center px-2' : ''}`}
                    >
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-[#B8913A]"
                        />
                      )}

                      <Icon
                        className={`w-4 h-4 shrink-0 transition-colors duration-150 ${
                          isActive
                            ? 'text-[#DFC484]'
                            : 'text-[#EFE8DE]/75 group-hover:text-white'
                        }`}
                      />

                      {!isCollapsed && (
                        <div className="flex-1 flex items-center justify-between min-w-0">
                          <span className="truncate">{item.label}</span>
                          {item.badge && (
                            <span
                              className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                                isActive
                                  ? 'bg-[#540C19]/80 text-[#DFC484] border border-[#B8913A]/45'
                                  : 'bg-white/10 text-[#F7F4EF]/85'
                              }`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom Term & Currency Footer */}
        <div className="p-3.5 border-t border-[#B8913A]/35 bg-[#4C0A15]/75">
          {!isCollapsed ? (
            <div className="space-y-1.5 text-[11px] text-[#EFE8DE]/80">
              <div className="flex items-center justify-between">
                <span>Academic Term</span>
                <span className="text-[#F7F4EF] font-medium border border-[#B8913A]/60 px-2.5 py-0.5 rounded-full">
                  {schoolSettings.currentTerm}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Currency</span>
                <span className="font-medium text-[#DFC484]">
                  Naira ({schoolSettings.currencySymbol || '₦'})
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center font-semibold text-[#DFC484] text-xs">₦</div>
          )}
        </div>
      </aside>
    </>
  );
};
