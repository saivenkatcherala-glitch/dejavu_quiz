import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import {
  LayoutDashboard,
  Users,
  FileText,
  PlayCircle,
  AlertTriangle,
  Radio,
  BarChart3,
  History,
  LogOut,
  Menu,
  X,
  ClipboardList,
} from 'lucide-react';

const navItems = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/admin/teams', icon: Users, label: 'Teams' },
  { to: '/admin/questions', icon: FileText, label: 'Questions' },
  { to: '/admin/quiz-control', icon: PlayCircle, label: 'Quiz Control' },
  { to: '/admin/attempts', icon: ClipboardList, label: 'Attempts' },
  { to: '/admin/violations', icon: AlertTriangle, label: 'Violations' },
  { to: '/admin/live', icon: Radio, label: 'Live Monitor' },
  { to: '/admin/results', icon: BarChart3, label: 'Results' },
  { to: '/admin/activity', icon: History, label: 'Activity Log' },
];

export default function AdminLayout() {
  const { user, signOut } = useAdminAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/admin/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 lg:translate-x-0 lg:static lg:inset-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-indigo-600">DejaVu</h1>
          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">Admin</span>
          <button className="lg:hidden text-gray-400" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="p-4 space-y-1">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200">
          <div className="text-xs text-gray-500 mb-2 truncate">{user?.email}</div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-6 lg:hidden">
          <button onClick={() => setSidebarOpen(true)} className="text-gray-600">
            <Menu className="w-6 h-6" />
          </button>
          <h1 className="ml-4 text-lg font-bold text-indigo-600">DejaVu Admin</h1>
        </header>
        <main className="flex-1 p-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
