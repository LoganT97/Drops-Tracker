export default function LoadingSpinner({ label = "Loading" }: { label?: string }) {
  return <span className="button-spinner" role="status" aria-label={label} />;
}
