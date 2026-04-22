import { StripeProvider } from '@stripe/stripe-react-native';

const STRIPE_PUBLISHABLE_KEY = 'pk_test_51TOn9CRl2cHtARaHUFhvWWRbMoMVqml5UQey9e4gMiMwhNoR6nTcJKcE3tY7TBWi7ie7VRNTExVkmhgUpgUcdMWa009WtlpIVr';

export default function StripeWrapper({ children }) {
  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
      {children}
    </StripeProvider>
  );
}
