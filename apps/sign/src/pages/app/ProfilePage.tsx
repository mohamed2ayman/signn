import { useState, useEffect } from 'react';
import api from '@/services/api/axios';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import Button from '@/components/common/Button';
import type { User } from '@/types';
import { JOB_TITLES } from '@/types';

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    preferred_language: 'en',
    job_title: '',
  });

  useEffect(() => {
    api
      .get<User>('/users/me')
      .then((r) => {
        const u = r.data;
        setUser(u);
        setForm({
          first_name: u.first_name || '',
          last_name: u.last_name || '',
          preferred_language: u.preferred_language || 'en',
          job_title: u.job_title || '',
        });
      })
      .catch(() => setError('Failed to load profile'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await api.put<User>('/users/me', form);
      setUser(response.data);
      setSuccess('Profile updated successfully');
    } catch {
      setError('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Profile Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your personal information and job title.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-600">
          {success}
        </div>
      )}

      <form onSubmit={handleSave}>
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  First Name
                </label>
                <input
                  type="text"
                  value={form.first_name}
                  onChange={(e) =>
                    setForm({ ...form, first_name: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Last Name
                </label>
                <input
                  type="text"
                  value={form.last_name}
                  onChange={(e) =>
                    setForm({ ...form, last_name: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                type="email"
                disabled
                value={user?.email || ''}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                System Role
              </label>
              <input
                type="text"
                disabled
                value={user?.role?.replace(/_/g, ' ') || ''}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Job Title
              </label>
              <select
                value={form.job_title}
                onChange={(e) =>
                  setForm({ ...form, job_title: e.target.value })
                }
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Select a job title...</option>
                {JOB_TITLES.map((jt) => (
                  <option key={jt} value={jt}>
                    {jt}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                Your job title determines your default permission level when
                added to projects. It can be overridden per project by an admin.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Preferred Language
              </label>
              <select
                value={form.preferred_language}
                onChange={(e) =>
                  setForm({ ...form, preferred_language: e.target.value })
                }
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="en">English</option>
                <option value="ar">Arabic</option>
                <option value="fr">French</option>
              </select>
            </div>
          </div>

          <div className="mt-8 flex justify-end">
            <Button type="submit" isLoading={saving}>
              Save Changes
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
