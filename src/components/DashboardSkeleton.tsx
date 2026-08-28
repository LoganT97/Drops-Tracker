export default function DashboardSkeleton() {
  return (
    <main className="page dashboard-skeleton" aria-label="Loading dashboard">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-subtitle" />
      <div className="skeleton-tiles">{Array.from({ length: 6 }, (_, index) => <div className="skeleton" key={index} />)}</div>
      <div className="skeleton skeleton-tools" />
      <div className="panel skeleton-table">
        <div className="skeleton skeleton-table-head" />
        {Array.from({ length: 7 }, (_, index) => <div className="skeleton-row" key={index}><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>)}
      </div>
    </main>
  );
}
