import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import { AuthProvider } from './src/context/AuthContext';
import { LanguageProvider } from './src/context/LanguageContext';
import Navigation from './src/navigation';

const queryClient = new QueryClient();

const STRIPE_PUBLISHABLE_KEY = 'pk_test_51TOn9CRl2cHtARaHUFhvWWRbMoMVqml5UQey9e4gMiMwhNoR6nTcJKcE3tY7TBWi7ie7VRNTExVkmhgUpgUcdMWa009WtlpIVr';

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <AuthProvider>
            <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
              <StatusBar style="light" />
              <Navigation />
            </StripeProvider>
          </AuthProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
