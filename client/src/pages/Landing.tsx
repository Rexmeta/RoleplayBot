import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Users, Target, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Landing() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-4">
      <div className="max-w-4xl mx-auto text-center space-y-8">
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-3 mb-6">
            <Brain className="w-12 h-12 text-blue-600" />
            <h1 className="text-4xl font-bold text-gray-900">
              {t('landing.title')}
            </h1>
          </div>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            {t('landing.description')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-blue-200 bg-white/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-800">
                <Users className="w-5 h-5" />
                {t('landing.feature1Title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                {t('landing.feature1Desc')}
              </p>
            </CardContent>
          </Card>

          <Card className="border-purple-200 bg-white/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-purple-800">
                <Target className="w-5 h-5" />
                {t('landing.feature2Title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                {t('landing.feature2Desc')}
              </p>
            </CardContent>
          </Card>

          <Card className="border-green-200 bg-white/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-800">
                <Lightbulb className="w-5 h-5" />
                {t('landing.feature3Title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                {t('landing.feature3Desc')}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Button 
            onClick={() => window.location.href = '/api/login'}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 text-lg"
            data-testid="login-button"
          >
            {t('common.start')}
          </Button>
          <p className="text-sm text-gray-500">
            {t('landing.loginHint')}
          </p>
        </div>

        <div className="mt-12 p-6 bg-white/30 backdrop-blur-sm rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            {t('landing.demoTitle')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
            <div>• {t('landing.demoItem1')}</div>
            <div>• {t('landing.demoItem2')}</div>
            <div>• {t('landing.demoItem3')}</div>
            <div>• {t('landing.demoItem4')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
