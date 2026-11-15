export interface AuraStudyCapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  server?: {
    androidScheme?: 'https' | 'http';
    cleartext?: boolean;
  };
  android?: {
    allowMixedContent?: boolean;
    backgroundColor?: string;
  };
  plugins?: Record<string, Record<string, unknown>>;
}

const config: AuraStudyCapacitorConfig = {
  appId: 'com.aurastudy.app',
  appName: 'AuraStudy',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#f8fafc',
  },
};

export default config;
