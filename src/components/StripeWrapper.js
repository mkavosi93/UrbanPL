// Web fallback — Stripe is native only, render children as-is
export default function StripeWrapper({ children }) {
  return children;
}
