import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '@/services/api/axios';
import AuthLayout from '@/components/common/AuthLayout';
import Button from '@/components/common/Button';
import FormInput from '@/components/common/FormInput';
import type { ProjectParty } from '@/types';

export default function AcceptPartyInvitationPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [invitation, setInvitation] = useState<ProjectParty | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    contact_person: '',
    phone: '',
  });

  useEffect(() => {
    if (token) {
      api.get(`/public/parties/invitation/${token}`)
        .then((res) => {
          setInvitation(res.data);
          setFormData({
            name: res.data.name || '',
            contact_person: res.data.contact_person || '',
            phone: res.data.phone || '',
          });
        })
        .catch(() => setError(t('invitation.invalidOrExpired')))
        .finally(() => setLoading(false));
    } else {
      setError(t('invitation.noToken'));
      setLoading(false);
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.post('/public/parties/invitation/accept', {
        invitation_token: token,
        ...formData,
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.message || t('invitation.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AuthLayout>
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50">
            <svg className="h-7 w-7 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">{t('invitation.acceptedTitle')}</h2>
          <p className="mt-2 text-sm text-gray-500">
            {t('invitation.acceptedDescription')}
          </p>
          <Button className="mt-6" onClick={() => navigate('/auth/login')}>
            {t('invitation.goToLogin')}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-5 text-center">
        <h2 className="text-xl font-bold text-navy-900">{t('invitation.title')}</h2>
      </div>

      {error && !invitation && (
        <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-600">{error}</div>
      )}

      {invitation && (
        <div>
          <div className="mb-6 rounded-lg border border-primary/10 bg-primary/[0.03] p-4">
            <p className="text-sm text-gray-600">
              You've been invited as a <strong className="text-primary">{invitation.party_type.replace(/_/g, ' ')}</strong> on project <strong>"{invitation.project?.name}"</strong>.
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-600">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <FormInput
              label={t('invitation.companyName')}
              name="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <FormInput
              label={t('invitation.contactPerson')}
              name="contact_person"
              value={formData.contact_person}
              onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
              required
            />
            <FormInput
              label={t('invitation.phone')}
              name="phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
            <Button type="submit" isLoading={submitting} className="w-full">
              {t('invitation.accept')}
            </Button>
          </form>
        </div>
      )}
    </AuthLayout>
  );
}
