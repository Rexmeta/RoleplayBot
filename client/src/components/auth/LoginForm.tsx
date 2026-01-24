import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, Lock } from "lucide-react";

type LoginFormData = {
  email: string;
  password: string;
  rememberMe: boolean;
};

interface LoginFormProps {
  onSwitchToRegister: () => void;
}

export function LoginForm({ onSwitchToRegister }: LoginFormProps) {
  const { login } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);

  const loginSchema = z.object({
    email: z.string().email(t('auth.emailInvalid')),
    password: z.string().min(1, t('auth.passwordRequired')),
    rememberMe: z.boolean().default(false),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
  });

  const rememberMe = watch("rememberMe");

  const onSubmit = async (data: LoginFormData) => {
    try {
      setIsLoading(true);
      await login(data.email, data.password, data.rememberMe);
      toast({
        title: t('auth.loginSuccess'),
        description: t('auth.welcomeBack'),
      });
    } catch (error: any) {
      console.error("Login error:", error);
      toast({
        title: t('auth.loginError'),
        description: error.message || t('auth.loginErrorMessage'),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto" data-testid="card-login">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl text-center" data-testid="text-login-title">
          {t('auth.loginTitle')}
        </CardTitle>
        <CardDescription className="text-center" data-testid="text-login-description">
          {t('auth.loginDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
                placeholder={t('auth.passwordPlaceholder')}
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

          <div className="flex items-center space-x-2">
            <Checkbox
              id="rememberMe"
              checked={rememberMe}
              onCheckedChange={(checked) => setValue("rememberMe", !!checked)}
              data-testid="checkbox-remember-me"
            />
            <Label
              htmlFor="rememberMe"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              data-testid="label-remember-me"
            >
              {t('auth.rememberMe')}
            </Label>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
            data-testid="button-login"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('auth.loggingIn')}
              </>
            ) : (
              t('auth.loginButton')
            )}
          </Button>

          <div className="text-center text-sm">
            <span className="text-gray-600">{t('auth.noAccount')} </span>
            <button
              type="button"
              onClick={onSwitchToRegister}
              className="text-blue-600 hover:underline font-medium"
              data-testid="button-switch-to-register"
            >
              {t('auth.registerButton')}
            </button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
