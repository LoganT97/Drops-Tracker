export default function OrdersLoading() {
  return (
    <main className="orders-shell" aria-label="Loading orders">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-subtitle" />
      <div className="order-summary-grid">
        {Array.from({ length: 4 }, (_, index) => <div className="skeleton order-summary" key={index} />)}
      </div>
      <div className="skeleton skeleton-tools" />
      <div className="skeleton-list">
        {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
      </div>
    </main>
  );
}
