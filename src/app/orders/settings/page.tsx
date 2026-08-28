export default function OrderSettingsPage() {
  return (
    <main className="orders-shell order-subpage">
      <div className="orders-heading">
        <div><h1>Settings</h1><p>Order import behavior and data handling.</p></div>
      </div>
      <section className="order-settings-grid">
        <div className="order-setting-card">
          <span>↻</span><div><strong>Automatic scanning</strong><p>Checks for new Target emails when the dashboard has not been scanned for 15 minutes.</p></div><b>On</b>
        </div>
        <div className="order-setting-card">
          <span>◎</span><div><strong>Retailer</strong><p>Only Target order confirmations, cancellations, and shipping updates are imported.</p></div><b>Target</b>
        </div>
        <div className="order-setting-card">
          <span>▣</span><div><strong>Historical range</strong><p>The initial Gmail backfill scans up to two years of matching Target messages.</p></div><b>2 years</b>
        </div>
        <div className="order-setting-card">
          <span>⌁</span><div><strong>Email privacy</strong><p>Only parsed order details are stored. Raw email bodies are discarded after processing.</p></div><b>Protected</b>
        </div>
      </section>
    </main>
  );
}
