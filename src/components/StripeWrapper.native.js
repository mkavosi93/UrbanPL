import { StripeProvider } from '@stripe/stripe-react-native';

const STRIPE_PUBLISHABLE_KEY = 'pk_live_51TOplrJMza4VY3OCdWWHgGNjRcdPHJZAkLwA4mNeUEa3J50rx0GVeUkUsW3Z4ajLuOjPSHTGJrivJJCxPFWSR7ZV00BC36teFw';

export default function StripeWrapper({ children }) {
  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
      {children}
    </StripeProvider>
  );
}
