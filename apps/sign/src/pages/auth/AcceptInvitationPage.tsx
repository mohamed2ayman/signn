import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Lock, User, CheckCircle } from 'lucide-react';
import AuthLayout from '@/components/common/AuthLayout';
import FormInput from '@/components/common/FormInput';
import Button from '@/components/common/Button';
import { authService } from '@/services/auth/authService';
import { useDispatch } from 'react-redux';
import { setCredentials } from '@/store/slices/authSlice';
import type { AppDispatch } from '@/store';

const AcceptInvitationPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    password: '',
    confirmPassword: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.first_name.trim()) {
      newErrors.first_name = 'common.required';
    }
    if (!formData.last_name.trim()) {
      newErrors.last_name = 'common.required';
    }
    if (!formData.password) {
      newErrors.password = 'common.required';
    } else if (!/^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/.test(formData.password)) {
      newErrors.password = 'auth.passwordRequirements';
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'auth.passwordMismatch';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validate()) return;

    if (!token) {
      setError('auth.invalidToken');
      return;
    }

    setIsLoading(true);
    try {
      const response = await authService.acceptInvitation({
        token,
        password: formData.password,
        first_name: formData.first_name,
        last_name: formData.last_name,
      });

      if (response.user && response.access_token) {
        dispatch(
          setCredentials({
            user: response.user,
            token: response.access_token,
            refreshToken: response.refresh_token,
          }),
        );
        // Redirect based on role
        const role = response.user.role;
        if (role === 'SYSTEM_ADMIN' || role === 'OPERATIONS') {
          navigate('/admin/dashboard', { replace: true });
        } else if (role.startsWith('CONTRACTOR_')) {
          navigate('/contractor/dashboard', { replace: true });
        } else {
          navigate('/app/dashboard', { replace: true });
        }
      }
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { message?: string } } };
      setError(apiError.response?.data?.message || 'errors.generic');
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-danger">
            {t('auth.invalidToken', 'Invalid or expired invitation')}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {t('auth.invalidInvitationDescription', 'This invitation link is invalid or has expired. Please contact your administrator.')}
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-text">
          {t('auth.acceptInvitation')}
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          {t('auth.acceptInvitationDescription', 'Set up your account to get started.')}
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">
            {t(error)}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="auth.firstName"
            name="first_name"
            placeholder="auth.firstName"
            value={formData.first_name}
            onChange={(e) => updateField('first_name', e.target.value)}
            icon={<User className="h-4 w-4" />}
            error={errors.first_name}
            required
          />
          <FormInput
            label="auth.lastName"
            name="last_name"
            placeholder="auth.lastName"
            value={formData.last_name}
            onChange={(e) => updateField('last_name', e.target.value)}
            error={errors.last_name}
            required
          />
        </div>

        <FormInput
          label="auth.password"
          name="password"
          type="password"
          placeholder="auth.password"
          value={formData.password}
          onChange={(e) => updateField('password', e.target.value)}
          icon={<Lock className="h-4 w-4" />}
          error={errors.password}
          required
          autoComplete="new-password"
        />

        <FormInput
          label="auth.confirmPassword"
          name="confirmPassword"
          type="password"
          placeholder="auth.confirmPassword"
          value={formData.confirmPassword}
          onChange={(e) => updateField('confirmPassword', e.target.value)}
          icon={<Lock className="h-4 w-4" />}
          error={errors.confirmPassword}
          required
          autoComplete="new-password"
        />

        <p className="mb-4 -mt-2 text-xs text-gray-400">
          {t('auth.passwordHint', 'Min 8 characters, 1 uppercase, 1 number, 1 special character')}
        </p>

        <Button
          type="submit"
          fullWidth
          isLoading={isLoading}
          size="lg"
        >
          {t('auth.acceptInvitation')}
        </Button>
      </form>
    </AuthLayout>
  );
};

export default AcceptInvitationPage;
