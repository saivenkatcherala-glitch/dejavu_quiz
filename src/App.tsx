import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminAuthProvider, useAdminAuth } from '@/contexts/AdminAuthContext';
import { TeamSessionProvider } from '@/contexts/TeamSessionContext';
import { PageLoader } from '@/components/ui';
import { isConfigured } from '@/lib/supabase';

function ConfigBanner() {
  if (isConfigured) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[200] bg-amber-500 text-white px-4 py-2 text-center text-sm font-medium">
      ⚠ Supabase not configured — Edit <code className="bg-amber-600 px-1 rounded">.env</code> with your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server.
    </div>
  );
}

// Lazy load pages
const AdminLogin = React.lazy(() => import('@/pages/admin/AdminLogin'));
const AdminLayout = React.lazy(() => import('@/components/admin/AdminLayout'));
const Dashboard = React.lazy(() => import('@/pages/admin/Dashboard'));
const TeamsPage = React.lazy(() => import('@/pages/admin/TeamsPage'));
const QuestionsPage = React.lazy(() => import('@/pages/admin/QuestionsPage'));
const QuizControlPage = React.lazy(() => import('@/pages/admin/QuizControlPage'));
const AttemptsPage = React.lazy(() => import('@/pages/admin/AttemptsPage'));
const ViolationsPage = React.lazy(() => import('@/pages/admin/ViolationsPage'));
const LiveMonitorPage = React.lazy(() => import('@/pages/admin/LiveMonitorPage'));
const ResultsPage = React.lazy(() => import('@/pages/admin/ResultsPage'));
const ActivityLogPage = React.lazy(() => import('@/pages/admin/ActivityLogPage'));

const QuizLogin = React.lazy(() => import('@/pages/quiz/QuizLogin'));
const SystemCheck = React.lazy(() => import('@/pages/quiz/SystemCheck'));
const Instructions = React.lazy(() => import('@/pages/quiz/Instructions'));
const QuizPage = React.lazy(() => import('@/pages/quiz/QuizPage'));
const QuizResult = React.lazy(() => import('@/pages/quiz/QuizResult'));

// Protected Route for Admin
function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAdminAuth();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/admin/login" replace />;

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Home redirects to quiz login */}
      <Route path="/" element={<Navigate to="/quiz/login" replace />} />

      {/* Admin Routes */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        path="/admin"
        element={
          <ProtectedAdminRoute>
            <AdminLayout />
          </ProtectedAdminRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="questions" element={<QuestionsPage />} />
        <Route path="quiz-control" element={<QuizControlPage />} />
        <Route path="attempts" element={<AttemptsPage />} />
        <Route path="violations" element={<ViolationsPage />} />
        <Route path="live" element={<LiveMonitorPage />} />
        <Route path="results" element={<ResultsPage />} />
        <Route path="activity" element={<ActivityLogPage />} />
      </Route>

      {/* Quiz (Participant) Routes */}
      <Route path="/quiz/login" element={<QuizLogin />} />
      <Route path="/quiz/check" element={<SystemCheck />} />
      <Route path="/quiz/instructions" element={<Instructions />} />
      <Route path="/quiz" element={<QuizPage />} />
      <Route path="/quiz/result" element={<QuizResult />} />

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/quiz/login" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ConfigBanner />
      <AdminAuthProvider>
        <TeamSessionProvider>
          <React.Suspense fallback={<PageLoader />}>
            <AppRoutes />
          </React.Suspense>
        </TeamSessionProvider>
      </AdminAuthProvider>
    </BrowserRouter>
  );
}
