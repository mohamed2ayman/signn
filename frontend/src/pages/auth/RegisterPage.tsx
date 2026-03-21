import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User, Building2, Globe, Check } from 'lucide-react';
import AuthLayout from '@/components/common/AuthLayout';
import FormInput from '@/components/common/FormInput';
import Button from '@/components/common/Button';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';
import { subscriptionService } from '@/services/api/subscriptionService';
import type { SubscriptionPlan } from '@/types';
import { cn } from '@/utils/cn';

const RegisterPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { register, isAuthenticated, isLoading, user } = useAuth();

  const [step, setStep] = useState(1);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState('');

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    first_name: '',
    last_name: '',
    organization_name: '',
    industry: '',
    country: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    if (isAuthenticated && user) {
      navigate('/app/dashboard', { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  useEffect(() => {
    const loadPlans = async () => {
      try {
        const data = await subscriptionService.getPlans();
        setPlans(data);
      } catch {
        setPlans([]);
      } finally {
        setPlansLoading(false);
      }
    };
    loadPlans();
  }, []);

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

  const validateStep2 = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.first_name.trim()) newErrors.first_name = 'common.required';
    if (!formData.last_name.trim()) newErrors.last_name = 'common.required';
    if (!formData.organization_name.trim()) newErrors.organization_name = 'common.required';
    if (!formData.email.trim()) {
      newErrors.email = 'common.required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'errors.validation';
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

  const handleSelectPlan = (planId: string) => {
    setSelectedPlanId(planId);
  };

  const handleContinue = () => {
    if (!selectedPlanId && plans.length > 0) return;
    setStep(2);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError('');

    if (!validateStep2()) return;

    const result = await register({
      email: formData.email,
      password: formData.password,
      first_name: formData.first_name,
      last_name: formData.last_name,
      organization_name: formData.organization_name,
      industry: formData.industry || undefined,
      country: formData.country || undefined,
      plan_id: selectedPlanId,
    });

    if (result.error) {
      setApiError(result.error);
    }
  };

  // Step 1: Plan Selection
  if (step === 1) {
    return (
      <AuthLayout>
        <div className="mb-6 text-center">
          <h2 className="text-xl font-bold text-navy-900">
            {t('auth.selectPlan')}
          </h2>
          <p className="mt-1.5 text-sm text-gray-400">
            {t('auth.selectPlanDescription', 'Choose a plan that fits your needs')}
          </p>
        </div>

        {plansLoading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : plans.length === 0 ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50">
              <svg className="h-6 w-6 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              {t('auth.noPlansAvailable', 'No plans available. Continue with free trial.')}
            </p>
            <Button
              onClick={() => setStep(2)}
              fullWidth
              size="lg"
            >
              {t('common.next')}
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-6">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => handleSelectPlan(plan.id)}
                  className={cn(
                    'w-full rounded-xl border-2 p-4 text-left transition-all',
                    'hover:border-primary/40 hover:shadow-sm',
                    selectedPlanId === plan.id
                      ? 'border-primary bg-primary/[0.03] shadow-sm'
                      : 'border-gray-200 bg-white'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-navy-900">{plan.name}</h3>
                        {selectedPlanId === plan.id && (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                            <Check className="h-3 w-3 text-white" />
                          </span>
                        )}
                      </div>
                      {plan.description && (
                        <p className="mt-1 text-sm text-gray-500">{plan.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-400">
                        <span className="flex items-center gap-1">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                          </svg>
                          {plan.max_projects} projects
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                          </svg>
                          {plan.max_users} users
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                          </svg>
                          {plan.max_contracts_per_project} contracts/project
                        </span>
                      </div>
                    </div>
                    <div className="text-right ltr:ml-4 rtl:mr-4">
                      <p className="text-2xl font-bold text-primary">
                        ${plan.price}
                      </p>
                      <p className="text-xs text-gray-400">
                        /{plan.duration_days}d
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <Button
              onClick={handleContinue}
              fullWidth
              size="lg"
              disabled={!selectedPlanId}
            >
              {t('common.next')}
            </Button>
          </>
        )}

        <p className="mt-6 text-center text-sm text-gray-400">
          {t('auth.hasAccount')}{' '}
          <Link
            to="/auth/login"
            className="font-semibold text-primary transition-colors hover:text-primary-600"
          >
            {t('auth.signIn')}
          </Link>
        </p>
      </AuthLayout>
    );
  }

  // Step 2: Account Details
  return (
    <AuthLayout>
      <div className="mb-6 text-center">
        {/* Step indicator */}
        <div className="mb-4 flex items-center justify-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary">
            <Check className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="h-0.5 w-8 rounded-full bg-primary" />
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
            2
          </div>
        </div>
        <h2 className="text-xl font-bold text-navy-900">
          {t('auth.register')}
        </h2>
        <p className="mt-1.5 text-sm text-gray-400">
          {t('auth.createAccountDescription', 'Create your account and organization')}
        </p>
      </div>

      <form onSubmit={handleRegister}>
        {apiError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
            <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            {t(apiError)}
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
          label="auth.email"
          name="email"
          type="email"
          placeholder="auth.email"
          value={formData.email}
          onChange={(e) => updateField('email', e.target.value)}
          icon={<Mail className="h-4 w-4" />}
          error={errors.email}
          required
          autoComplete="email"
        />

        <FormInput
          label="auth.organizationName"
          name="organization_name"
          placeholder="auth.organizationName"
          value={formData.organization_name}
          onChange={(e) => updateField('organization_name', e.target.value)}
          icon={<Building2 className="h-4 w-4" />}
          error={errors.organization_name}
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="auth.industry"
            name="industry"
            placeholder="auth.industry"
            value={formData.industry}
            onChange={(e) => updateField('industry', e.target.value)}
          />
          <FormInput
            label="auth.country"
            name="country"
            placeholder="auth.country"
            value={formData.country}
            onChange={(e) => updateField('country', e.target.value)}
            icon={<Globe className="h-4 w-4" />}
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

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="flex-shrink-0 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {t('common.back')}
          </button>
          <Button
            type="submit"
            fullWidth
            isLoading={isLoading}
            size="lg"
          >
            {t('auth.signUp')}
          </Button>
        </div>
      </form>

      <p className="mt-6 text-center text-sm text-gray-400">
        {t('auth.hasAccount')}{' '}
        <Link
          to="/auth/login"
          className="font-semibold text-primary transition-colors hover:text-primary-600"
        >
          {t('auth.signIn')}
        </Link>
      </p>
    </AuthLayout>
  );
};

export default RegisterPage;
