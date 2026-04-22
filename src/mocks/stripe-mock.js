// Web mock for @stripe/stripe-react-native — Stripe is native only
export const StripeProvider = ({ children }) => children;
export const useStripe = () => ({
  initPaymentSheet: async () => ({}),
  presentPaymentSheet: async () => ({}),
});
