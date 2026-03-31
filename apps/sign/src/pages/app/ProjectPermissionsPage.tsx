import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { projectService } from '@/services/api/projectService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { ProjectMember, PermissionLevel, Project } from '@/types';

const PERMISSION_LEVELS: string[] = ['VIEWER', 'COMMENTER', 'EDITOR', 'APPROVER'];

const levelBadge: Record<string, { bg: string; text: string }> = {
  VIEWER: { bg: 'bg-gray-100', text: 'text-gray-700' },
  COMMENTER: { bg: 'bg-blue-50', text: 'text-blue-700' },
  EDITOR: { bg: 'bg-amber-50', text: 'text-amber-700' },
  APPROVER: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
};

export default function ProjectPermissionsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    Promise.all([
      projectService.getById(id),
      projectService.getMembers(id),
    ])
      .then(([proj, mems]) => {
        setProject(proj);
        setMembers(mems);
      })
      .catch(() => setError('Failed to load project members'))
      .finally(() => setLoading(false));
  }, [id]);

  const handlePermissionChange = async (
    userId: string,
    newLevel: string,
  ) => {
    if (!id) return;
    setSaving(userId);
    setError('');
    try {
      const updated = await projectService.updateMemberPermission(
        id,
        userId,
        newLevel as PermissionLevel,
      );
      setMembers((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, permission_level: updated.permission_level } : m)),
      );
    } catch {
      setError('Failed to update permission level');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-gray-400">
        <p className="text-sm font-medium">Project not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400">
        <button
          onClick={() => navigate('/app/projects')}
          className="transition-colors hover:text-primary"
        >
          Projects
        </button>
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <button
          onClick={() => navigate(`/app/projects/${id}`)}
          className="transition-colors hover:text-primary"
        >
          {project.name}
        </button>
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="font-medium text-gray-700">Permission Matrix</span>
      </nav>

      <div>
        <h1 className="text-xl font-bold text-gray-900">
          Permission Matrix — {project.name}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          View and manage permission levels for all project members. Changes
          apply only to this project.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200/80 bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  Member
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  Job Title
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  System Role
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  Permission Level
                </th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">
                  Override
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {members.map((member) => {
                const user = member.user;
                const currentLevel = member.permission_level || 'VIEWER';
                const badge = levelBadge[currentLevel] || levelBadge.VIEWER;
                const isOverridden = !!member.permission_level;

                return (
                  <tr
                    key={member.id}
                    className="transition-colors hover:bg-gray-50/50"
                  >
                    <td className="px-6 py-3.5">
                      <div>
                        <p className="font-medium text-gray-900">
                          {user?.first_name} {user?.last_name}
                        </p>
                        <p className="text-xs text-gray-400">{user?.email}</p>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-gray-600">
                      {user?.job_title || (
                        <span className="text-gray-300">Not set</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {user?.role?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}
                      >
                        {currentLevel}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <select
                          value={currentLevel}
                          onChange={(e) =>
                            handlePermissionChange(
                              member.user_id,
                              e.target.value,
                            )
                          }
                          disabled={saving === member.user_id}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                        >
                          {PERMISSION_LEVELS.map((lvl) => (
                            <option key={lvl} value={lvl}>
                              {lvl}
                            </option>
                          ))}
                        </select>
                        {saving === member.user_id && (
                          <LoadingSpinner size="sm" />
                        )}
                        {isOverridden && (
                          <span className="text-[10px] text-amber-500">
                            overridden
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {members.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                    No members in this project yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
