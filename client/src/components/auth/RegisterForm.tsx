import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, Lock, User, Folder, Globe, Building2, Users } from "lucide-react";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n";

interface Category {
  id: string;
  name: string;
  description?: string;
}

interface Company {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

interface Organization {
  id: string;
  name: string;
  code: string;
  companyId: string;
  isActive: boolean;
}

type RegisterFormData = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

interface RegisterFormProps {
  onSwitchToLogin: () => void;
}

export function RegisterForm({ onSwitchToLogin }: RegisterFormProps) {
  const { register: registerUser } = useAuth();
  const { toast } = useToast();
  const { i18n, t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>("");
  const [selectedLanguage, setSelectedLanguage] = useState<string>(i18n.language || 'ko');

  const registerSchema = z.object({
    name: z.string().min(1, t('auth.nameRequired')).max(50, t('auth.nameMax')),
    email: z.string().email(t('auth.emailInvalid')),
    password: z.string()
      .min(8, t('auth.passwordMinLength'))
      .regex(/[A-Z]/, t('auth.passwordUppercase'))
      .regex(/[a-z]/, t('auth.passwordLowercase'))
      .regex(/[0-9]/, t('auth.passwordNumber'))
      .regex(/[!@#$%^&*(),.?":{}|<>]/, t('auth.passwordSpecial')),
    confirmPassword: z.string().min(1, t('auth.confirmPasswordRequired')),
  }).refine((data) => data.password === data.confirmPassword, {
    message: t('auth.passwordMismatch'),
    path: ["confirmPassword"],
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['/api/public/companies'],
    queryFn: async () => {
      const res = await fetch('/api/public/companies');
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data.filter((c: Company) => c.isActive) : [];
    },
    staleTime: 1000 * 60 * 30,
  });

  const { data: organizations = [] } = useQuery<Organization[]>({
    queryKey: ['/api/public/organizations', selectedCompanyId],
    queryFn: async () => {
      if (!selectedCompanyId) return [];
      const res = await fetch(`/api/public/organizations?companyId=${selectedCompanyId}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data.filter((o: Organization) => o.isActive) : [];
    },
    enabled: !!selectedCompanyId,
    staleTime: 1000 * 60 * 30,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
    queryFn: async () => {
      const res = await fetch('/api/categories');
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 1000 * 60 * 30,
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: RegisterFormData) => {
    try {
      setIsLoading(true);
      const categoryToSubmit = selectedCategoryId && selectedCategoryId.length > 0 ? selectedCategoryId : undefined;
      const companyToSubmit = selectedCompanyId && selectedCompanyId.length > 0 ? selectedCompanyId : undefined;
      const organizationToSubmit = selectedOrganizationId && selectedOrganizationId.length > 0 ? selectedOrganizationId : undefined;
      await registerUser(data.email, data.password, data.name, categoryToSubmit, companyToSubmit, organizationToSubmit, selectedLanguage);
      i18n.changeLanguage(selectedLanguage);
      localStorage.setItem('preferredLanguage', selectedLanguage);
      toast({
        title: t('auth.registerSuccess'),
        description: t('auth.welcomeMessage'),
      });
    } catch (error: any) {
      console.error("Register error:", error);
      toast({
        title: t('auth.registerError'),
        description: error.message || t('auth.registerError'),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompanyChange = (value: string) => {
    setSelectedCompanyId(value);
    setSelectedOrganizationId("");
  };

  return (
    <Card className="w-full max-w-md mx-auto" data-testid="card-register">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl text-center" data-testid="text-register-title">
          {t('auth.registerTitle')}
        </CardTitle>
        <CardDescription className="text-center" data-testid="text-register-description">
          {t('auth.registerDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name" data-testid="label-name">
              {t('auth.name')}
            </Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                id="name"
                type="text"
                placeholder={t('auth.namePlaceholder')}
                className="pl-10"
                data-testid="input-name"
                {...register("name")}
              />
            </div>
            {errors.name && (
              <p className="text-sm text-red-500" data-testid="error-name">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="language" data-testid="label-language">
              {t('common.language')}
            </Label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4 z-10" />
              <Select
                value={selectedLanguage}
                onValueChange={(value) => {
                  setSelectedLanguage(value);
                  i18n.changeLanguage(value);
                }}
              >
                <SelectTrigger className="pl-10" data-testid="select-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      <span className="flex items-center gap-2">
                        <span>{lang.flag}</span>
                        <span>{lang.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="company" data-testid="label-company">
              {t('auth.company', '소속 회사')}
            </Label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4 z-10" />
              <Select
                value={selectedCompanyId}
                onValueChange={handleCompanyChange}
              >
                <SelectTrigger className="pl-10" data-testid="select-company">
                  <SelectValue placeholder={t('auth.companyPlaceholder', '회사를 선택하세요')} />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedCompanyId && (
            <div className="space-y-2">
              <Label htmlFor="organization" data-testid="label-organization">
                {t('auth.organization', '소속 조직')}
              </Label>
              <div className="relative">
                <Users className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4 z-10" />
                <Select
                  value={selectedOrganizationId}
                  onValueChange={setSelectedOrganizationId}
                >
                  <SelectTrigger className="pl-10" data-testid="select-organization">
                    <SelectValue placeholder={t('auth.organizationPlaceholder', '조직을 선택하세요')} />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="category" data-testid="label-category">
              {t('auth.category')}
            </Label>
            <div className="relative">
              <Folder className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4 z-10" />
              <Select
                value={selectedCategoryId}
                onValueChange={(value) => {
                  setSelectedCategoryId(value);
                }}
              >
                <SelectTrigger className="pl-10" data-testid="select-category">
                  <SelectValue placeholder={t('auth.categoryPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" data-testid="label-email">
              {t('auth.email')}
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                id="email"
                type="email"
                placeholder={t('auth.emailPlaceholder')}
                className="pl-10"
                data-testid="input-email"
                {...register("email")}
              />
            </div>
            {errors.email && (
              <p className="text-sm text-red-500" data-testid="error-email">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" data-testid="label-password">
              {t('auth.password')}
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                id="password"
                type="password"
                placeholder={t('auth.passwordHint')}
                className="pl-10"
                data-testid="input-password"
                {...register("password")}
              />
            </div>
            {errors.password && (
              <p className="text-sm text-red-500" data-testid="error-password">
                {errors.password.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword" data-testid="label-confirm-password">
              {t('auth.confirmPassword')}
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t('auth.confirmPasswordPlaceholder')}
                className="pl-10"
                data-testid="input-confirm-password"
                {...register("confirmPassword")}
              />
            </div>
            {errors.confirmPassword && (
              <p className="text-sm text-red-500" data-testid="error-confirm-password">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
            data-testid="button-register"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('auth.registering')}
              </>
            ) : (
              t('auth.registerButton')
            )}
          </Button>

          <div className="text-center text-sm">
            <span className="text-gray-600">{t('auth.hasAccount')} </span>
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="text-blue-600 hover:underline font-medium"
              data-testid="button-switch-to-login"
            >
              {t('auth.loginButton')}
            </button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
