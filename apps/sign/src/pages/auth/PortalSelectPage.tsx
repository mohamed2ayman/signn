import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Briefcase } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export default function PortalSelectPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
    : '';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="bg-white rounded-2xl shadow-lg p-10 flex flex-col items-center gap-6 w-full max-w-md">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <LayoutDashboard className="h-7 w-7 text-primary" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-navy-900">Choose Portal</h1>
          <p className="mt-2 text-sm text-gray-500">
            {displayName ? `Welcome, ${displayName}.` : 'Welcome.'} Where would you like to go?
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full">
          <button
            type="button"
            onClick={() => { sessionStorage.setItem('portal-chosen', '1'); navigate('/admin/dashboard', { replace: true }); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-white transition hover:bg-primary-600"
          >
            <LayoutDashboard className="h-4 w-4" />
            Admin Dashboard
          </button>
          <button
            type="button"
            onClick={() => { sessionStorage.setItem('portal-chosen', '1'); navigate('/app/dashboard', { replace: true }); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary py-3 font-semibold text-primary transition hover:bg-primary/5"
          >
            <Briefcase className="h-4 w-4" />
            Client Portal
          </button>
        </div>
      </div>
    </div>
  );
}
